// The plaintext inside a .arizo file (and inside a local auto-snapshot): a manifest, every row of every
// store, and the attachment bytes. Encoded as lossless JSON (bigint via the row codec, bytes as base64).
// Reading the vault happens where the DB handle lives; encoding/compression/encryption run in the worker.
import { fromB64, te, td, toB64, toHex } from '../crypto/bytes';
import { sha256 } from '../crypto/primitives';
import { decodeRow, encodeRow } from '../storage/codec';
import type { IVaultDatabase, Row } from '../storage/IVaultDatabase';
import { STORE_NAMES, type StoreName } from '../storage/schema';
import { SQL_SCHEMA_VERSION } from '../storage/SqlVaultAdapter';
import { WEB_DB_VERSION } from '../storage/WebEncryptedDexieAdapter';
import { BackupError } from './container';

export const APP_VERSION = '1.1.3';
export const PAYLOAD_VERSION = 1;

/** Settings rows that describe this device's backups; never exported, never overwritten by a restore. */
export const DEVICE_LOCAL_SETTINGS = ['backup_snapshots', 'backup_state'] as const;

export interface Manifest {
  format: typeof PAYLOAD_VERSION;
  app_version: string;
  sql_schema: number;
  web_db: number;
  platform: 'android' | 'web';
  created_at: number;
  counts: Record<StoreName, number>;
  blobs: number;
  blob_bytes: number;
  /** Attachment rows whose bytes could not be read on the source device. */
  missing_blobs: number;
}

export type Stores = { [K in StoreName]: Row<K>[] };
export interface Snapshot {
  manifest: Manifest;
  stores: Stores;
  /** encrypted_blob_key → plaintext bytes. */
  blobs: Record<string, Uint8Array>;
}

const isLocalSetting = (store: StoreName, id: string) => store === 'settings' && (DEVICE_LOCAL_SETTINGS as readonly string[]).includes(id);

/** Read every store and every attachment blob of the open vault. */
export async function takeSnapshot(db: IVaultDatabase, platform: Manifest['platform'], now = Date.now()): Promise<Snapshot> {
  const stores = await db.transaction(async (tx) => {
    const out = {} as Record<StoreName, Row<StoreName>[]>;
    for (const s of STORE_NAMES) out[s] = (await tx.find(s)).filter((r) => !isLocalSetting(s, r.id));
    return out as Stores;
  });
  const blobs: Record<string, Uint8Array> = {};
  let bytes = 0;
  let missing = 0;
  for (const a of stores.attachments) {
    const b = await db.getBlob(a.encrypted_blob_key).catch(() => undefined);
    if (!b) {
      missing++;
      continue;
    }
    blobs[a.encrypted_blob_key] = b;
    bytes += b.length;
  }
  const counts = Object.fromEntries(STORE_NAMES.map((s) => [s, stores[s].length])) as Record<StoreName, number>;
  return {
    manifest: { format: PAYLOAD_VERSION, app_version: APP_VERSION, sql_schema: SQL_SCHEMA_VERSION, web_db: WEB_DB_VERSION, platform, created_at: now, counts, blobs: Object.keys(blobs).length, blob_bytes: bytes, missing_blobs: missing },
    stores,
    blobs,
  };
}

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const blobs = Object.fromEntries(Object.entries(s.blobs).map(([k, v]) => [k, toB64(v)]));
  return te.encode(encodeRow({ v: PAYLOAD_VERSION, manifest: s.manifest, stores: s.stores, blobs }));
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Trust boundary: the bytes are authenticated, but still checked for shape, version and counts. */
export function decodeSnapshot(bytes: Uint8Array): Snapshot {
  let raw: unknown;
  try {
    raw = decodeRow(td.decode(bytes));
  } catch {
    throw new BackupError('BACKUP_FORMAT');
  }
  if (!isObj(raw) || raw.v !== PAYLOAD_VERSION || !isObj(raw.manifest) || !isObj(raw.stores) || !isObj(raw.blobs)) throw new BackupError('BACKUP_FORMAT');
  const m = raw.manifest as unknown as Manifest;
  if (m.format !== PAYLOAD_VERSION || typeof m.created_at !== 'number' || !isObj(m.counts)) throw new BackupError('BACKUP_FORMAT');
  if (m.sql_schema > SQL_SCHEMA_VERSION || m.web_db > WEB_DB_VERSION) throw new BackupError('BACKUP_TOO_NEW');
  for (const k of Object.keys(raw.stores)) if (!(STORE_NAMES as string[]).includes(k)) throw new BackupError('BACKUP_TOO_NEW');
  const stores = {} as Record<StoreName, Row<StoreName>[]>;
  for (const s of STORE_NAMES) {
    const rows = raw.stores[s] ?? [];
    if (!Array.isArray(rows) || rows.some((r) => !isObj(r) || typeof r.id !== 'string' || !r.id)) throw new BackupError('BACKUP_FORMAT');
    if (rows.length !== (m.counts[s] ?? 0)) throw new BackupError('BACKUP_FORMAT');
    stores[s] = (rows as Row<StoreName>[]).filter((r) => !isLocalSetting(s, r.id));
  }
  const blobs: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(raw.blobs)) {
    if (typeof v !== 'string') throw new BackupError('BACKUP_FORMAT');
    try {
      blobs[k] = fromB64(v);
    } catch {
      throw new BackupError('BACKUP_FORMAT');
    }
  }
  if (Object.keys(blobs).length !== m.blobs) throw new BackupError('BACKUP_FORMAT');
  return { manifest: m, stores: stores as Stores, blobs };
}

/** Every shipped blob must match its attachment row's SHA-256 before anything is written. */
export async function checkBlobs(s: Snapshot): Promise<void> {
  for (const a of s.stores.attachments) {
    const b = s.blobs[a.encrypted_blob_key];
    if (b && toHex(await sha256(b)) !== a.sha256_hash) throw new BackupError('BACKUP_FORMAT');
  }
}

export const totalRows = (m: Manifest) => Object.values(m.counts).reduce((n, c) => n + c, 0);
