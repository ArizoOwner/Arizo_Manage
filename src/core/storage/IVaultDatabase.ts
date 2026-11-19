// The contract both adapters implement and both pass in tests/storage-contract.test.ts.
import type { StoreMap, StoreName } from './schema';

export type Row<K extends StoreName> = StoreMap[K];

/** Equality filter on INDEXED fields only (both adapters can serve it without decrypting everything). */
export type Where<K extends StoreName> = Partial<{ [F in keyof Row<K>]: Row<K>[F] }>;

export interface VaultTx {
  get<K extends StoreName>(store: K, id: string): Promise<Row<K> | undefined>;
  /** Insert or replace by id. Enforces UNIQUE constraints; throws `UNIQUE:<store>.<field>`. */
  put<K extends StoreName>(store: K, row: Row<K>): Promise<void>;
  /** Hard delete (soft delete is a `put` with deleted_at). */
  delete<K extends StoreName>(store: K, id: string): Promise<void>;
  /** All rows matching every equality in `where` (empty = all), unordered. */
  find<K extends StoreName>(store: K, where?: Where<K>): Promise<Row<K>[]>;
}

export interface IVaultDatabase extends VaultTx {
  readonly kind: 'web-dexie' | 'android-sqlcipher' | 'memory';
  /** Atomic: either every write inside `fn` commits or none do. Nested calls join the outer tx. */
  transaction<T>(fn: (tx: VaultTx) => Promise<T>): Promise<T>;
  count<K extends StoreName>(store: K): Promise<number>;
  /** Remove every row of every store (Wipe All Data, Replace restore). */
  clearAll(): Promise<void>;
  /** Close and drop key material. The instance is unusable afterwards. */
  close(): Promise<void>;
}

export class UniqueViolation extends Error {
  constructor(store: string, field: string) {
    super(`UNIQUE:${store}.${field}`);
    this.name = 'UniqueViolation';
  }
}
