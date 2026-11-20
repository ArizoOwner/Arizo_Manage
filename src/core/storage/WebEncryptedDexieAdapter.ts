// iOS PWA / web storage: Dexie (IndexedDB) where every row is AES-256-GCM ciphertext.
// Cleartext on disk is only the row id (UUIDv7) and opaque HMAC tags for INDEXED fields.
// AAD binds each ciphertext to its store and id, so rows cannot be swapped between records.
import Dexie, { type Table } from 'dexie';
import { buf, td, te, toB64 } from '../crypto/bytes';
import { blobAad, indexTag, recordAad, type VaultKeys } from '../crypto/keyring';
import { open, seal } from '../crypto/primitives';
import { decodeRow, encodeRow } from './codec';
import { UniqueViolation, type Row, type Where } from './IVaultDatabase';
import { INDEXED, STORE_NAMES, UNIQUE, type StoreName } from './schema';
import { StagedVault, matches, type RawBackend, type WriteOp } from './StagedVault';

/** What actually lands in IndexedDB. */
export interface SealedRow {
  id: string;
  /** "field=tag" for each non-null INDEXED field (multiEntry index). */
  ix: string[];
  /** Same, for UNIQUE fields (unique multiEntry index). Omitted when empty. */
  ux?: string[];
  c: Uint8Array<ArrayBuffer>;
}

export const WEB_DB_VERSION = 2;
export const webDbName = (vaultId: string) => `arizo-vault-${vaultId}`;

class VaultDexie extends Dexie {
  constructor(name: string) {
    super(name);
    // Migrations: add `this.version(N).stores(...).upgrade(...)` here; never edit a shipped version.
    this.version(1).stores(Object.fromEntries(STORE_NAMES.map((s) => [s, 'id, *ix, &*ux'])));
    // v2 (Phase 7): attachment ciphertext, keyed by attachment id.
    this.version(2).stores({ blobs: 'id' });
  }
  blobs(): Table<{ id: string; c: Uint8Array<ArrayBuffer> }, string> {
    return this.table('blobs');
  }
  t(store: StoreName): Table<SealedRow, string> {
    return this.table(store);
  }
}

/** Type-tagged string for indexing, so 1 and "1" never collide. null → no tag. */
export const tagValue = (v: unknown): string | null =>
  v === null || v === undefined ? null : typeof v === 'bigint' ? `n:${v}` : `${typeof v}:${String(v)}`;

class DexieBackend implements RawBackend {
  constructor(
    private db: VaultDexie,
    private keys: VaultKeys,
  ) {}

  private async tags(store: StoreName, row: Record<string, unknown>): Promise<{ ix: string[]; ux: string[] }> {
    const ix: string[] = [];
    const ux: string[] = [];
    const uniq = (UNIQUE[store] ?? []) as readonly string[];
    for (const f of INDEXED[store] as readonly string[]) {
      const v = tagValue(row[f]);
      if (v === null) continue;
      const t = `${f}=${await indexTag(this.keys, store, f, v)}`;
      ix.push(t);
      if (uniq.includes(f)) ux.push(t);
    }
    return { ix, ux };
  }

  async seal(store: StoreName, row: Row<StoreName>): Promise<SealedRow> {
    const { ix, ux } = await this.tags(store, row as unknown as Record<string, unknown>);
    const c = buf(await seal(this.keys.record, te.encode(encodeRow(row)), recordAad(store, row.id)));
    return ux.length ? { id: row.id, ix, ux, c } : { id: row.id, ix, c };
  }

  private async open<K extends StoreName>(store: K, s: SealedRow): Promise<Row<K>> {
    return decodeRow<Row<K>>(td.decode(await open(this.keys.record, s.c, recordAad(store, s.id))));
  }

  async get<K extends StoreName>(store: K, id: string): Promise<Row<K> | undefined> {
    const s = await this.db.t(store).get(id);
    return s ? this.open(store, s) : undefined;
  }

  async find<K extends StoreName>(store: K, where: Where<K>): Promise<Row<K>[]> {
    const entries = Object.entries(where);
    const valued = entries.filter(([, v]) => tagValue(v) !== null);
    let rows: SealedRow[];
    if (valued.length) {
      const wanted = await Promise.all(valued.map(async ([f, v]) => `${f}=${await indexTag(this.keys, store, f, tagValue(v)!)}`));
      rows = (await this.db.t(store).where('ix').equals(wanted[0]!).toArray()).filter((r) => wanted.every((w) => r.ix.includes(w)));
    } else {
      rows = await this.db.t(store).toArray();
    }
    const opened = await Promise.all(rows.map((r) => this.open(store, r)));
    return opened.filter((r) => matches(r, where)); // also resolves "field = null" checks
  }

  async applyBatch(ops: WriteOp[]): Promise<void> {
    // Seal everything first: no awaits on WebCrypto may happen inside the IDB transaction.
    const sealed = await Promise.all(ops.map(async (op) => ({ op, s: op.row ? await this.seal(op.store, op.row) : null })));
    const stores = [...new Set(ops.map((o) => o.store))].map((s) => this.db.t(s));
    try {
      await this.db.transaction('rw', stores, async () => {
        for (const { op, s } of sealed) {
          if (s) await this.db.t(op.store).put(s);
          else await this.db.t(op.store).delete(op.id);
        }
      });
    } catch (e) {
      const name = (e as { name?: string; inner?: { name?: string } }).inner?.name ?? (e as { name?: string }).name;
      if (name === 'ConstraintError') throw new UniqueViolation(ops[0]?.store ?? 'unknown', 'unique');
      throw e;
    }
  }

  count(store: StoreName): Promise<number> {
    return this.db.t(store).count();
  }

  async clearAll(): Promise<void> {
    await this.db.transaction('rw', [...STORE_NAMES.map((s) => this.db.t(s)), this.db.blobs()], async () => {
      for (const s of STORE_NAMES) await this.db.t(s).clear();
      await this.db.blobs().clear();
    });
  }

  async putBlob(id: string, bytes: Uint8Array): Promise<{ nonce_b64: string }> {
    const c = buf(await seal(this.keys.blob, bytes, blobAad(id)));
    await this.db.blobs().put({ id, c });
    return { nonce_b64: toB64(c.slice(0, 12)) };
  }
  async getBlob(id: string): Promise<Uint8Array | undefined> {
    const r = await this.db.blobs().get(id);
    return r ? open(this.keys.blob, r.c, blobAad(id)) : undefined;
  }

  rawBlobs() {
    return this.db.blobs();
  }
  async deleteBlob(id: string): Promise<void> {
    await this.db.blobs().delete(id);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  raw(store: StoreName): Table<SealedRow, string> {
    return this.db.t(store);
  }
}

export class WebEncryptedDexieAdapter extends StagedVault {
  private readonly dexie: DexieBackend;

  constructor(keys: VaultKeys) {
    const backend = new DexieBackend(new VaultDexie(webDbName(keys.vaultId)), keys);
    super('web-dexie', backend);
    this.dexie = backend;
  }

  /** Delete a vault's whole IndexedDB database (Wipe All Data). */
  static async destroy(vaultId: string): Promise<void> {
    await Dexie.delete(webDbName(vaultId));
  }

  /** Raw on-disk rows. Used by tests to prove no plaintext is stored and tampering is caught. */
  rawTable(store: StoreName): Table<SealedRow, string> {
    return this.dexie.raw(store);
  }

  /** Raw on-disk attachment ciphertext. Used by tests to prove blobs are sealed and bound to their id. */
  rawBlobTable() {
    return this.dexie.rawBlobs();
  }
}
