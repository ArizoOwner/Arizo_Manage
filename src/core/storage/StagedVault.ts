// Shared transaction core for both adapters.
// Writes inside transaction() are staged in memory and applied by the backend as ONE atomic batch.
// Why: IndexedDB auto-commits when a WebCrypto await yields, and the Android bridge is async, so
// neither can hold a native transaction open across JS awaits. Reads inside a tx see staged writes.
import { UniqueViolation, type IVaultDatabase, type Row, type VaultTx, type Where } from './IVaultDatabase';
import { INDEXED, UNIQUE, type StoreName } from './schema';

export interface WriteOp {
  store: StoreName;
  id: string;
  /** null = delete */
  row: Row<StoreName> | null;
}

export interface RawBackend {
  get<K extends StoreName>(store: K, id: string): Promise<Row<K> | undefined>;
  find<K extends StoreName>(store: K, where: Where<K>): Promise<Row<K>[]>;
  /** Apply all ops atomically. Must reject with UniqueViolation on a unique clash. */
  applyBatch(ops: WriteOp[]): Promise<void>;
  count(store: StoreName): Promise<number>;
  clearAll(): Promise<void>;
  close(): Promise<void>;
}

export function matches(row: unknown, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  const r = row as Record<string, unknown>;
  return Object.entries(where).every(([f, v]) => (v === null || v === undefined ? r[f] === null || r[f] === undefined : r[f] === v));
}

export function assertIndexed(store: StoreName, where: Record<string, unknown> | undefined): void {
  for (const f of Object.keys(where ?? {})) {
    if (!(INDEXED[store] as readonly string[]).includes(f)) throw new Error(`${store}.${f} is not indexed`);
  }
}

const key = (store: StoreName, id: string) => `${store}\u0000${id}`;

export class StagedVault implements IVaultDatabase {
  private backend: RawBackend | null;
  private staging: Map<string, WriteOp> | null = null;

  constructor(
    readonly kind: IVaultDatabase['kind'],
    backend: RawBackend,
  ) {
    this.backend = backend;
  }

  private be(): RawBackend {
    if (!this.backend) throw new Error('vault is locked');
    return this.backend;
  }

  private readonly staged: VaultTx = {
    get: async (store, id) => {
      const op = this.staging?.get(key(store, id));
      if (op) return (op.row ?? undefined) as Row<typeof store> | undefined;
      return this.be().get(store, id);
    },
    find: async (store, where) => {
      assertIndexed(store, where);
      const out = new Map((await this.be().find(store, where ?? {})).map((r) => [r.id, r]));
      for (const op of this.staging?.values() ?? []) {
        if (op.store !== store) continue;
        if (op.row && matches(op.row, where)) out.set(op.id, op.row as Row<typeof store>);
        else out.delete(op.id);
      }
      return [...out.values()];
    },
    put: async (store, row) => {
      if (!row.id) throw new Error('row.id required');
      for (const f of (UNIQUE[store] ?? []) as readonly string[]) {
        const v = (row as unknown as Record<string, unknown>)[f];
        if (v === null || v === undefined) continue;
        const clash = await this.staged.find(store, { [f]: v } as Where<typeof store>);
        if (clash.some((r) => r.id !== row.id)) throw new UniqueViolation(store, f);
      }
      this.staging!.set(key(store, row.id), { store, id: row.id, row: structuredClone(row) as Row<StoreName> });
    },
    delete: async (store, id) => {
      this.staging!.set(key(store, id), { store, id, row: null });
    },
  };

  async transaction<T>(fn: (tx: VaultTx) => Promise<T>): Promise<T> {
    if (this.staging) return fn(this.staged); // nested: join the outer transaction
    const be = this.be();
    this.staging = new Map();
    try {
      const result = await fn(this.staged);
      const ops = [...this.staging.values()];
      if (ops.length) await be.applyBatch(ops);
      return result;
    } finally {
      this.staging = null;
    }
  }

  get: VaultTx['get'] = (store, id) => this.staged.get(store, id);
  find: VaultTx['find'] = (store, where) => this.staged.find(store, where);
  put: VaultTx['put'] = (store, row) => this.transaction((tx) => tx.put(store, row));
  delete: VaultTx['delete'] = (store, id) => this.transaction((tx) => tx.delete(store, id));

  count(store: StoreName): Promise<number> {
    return this.be().count(store);
  }
  clearAll(): Promise<void> {
    return this.be().clearAll();
  }
  async close(): Promise<void> {
    const be = this.backend;
    this.backend = null;
    await be?.close();
  }
}
