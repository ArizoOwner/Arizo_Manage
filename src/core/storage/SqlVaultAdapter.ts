// SQL storage shared by the Android SQLCipher adapter and the sql.js contract tests.
// Layout: one table per store with `id` PK, one TEXT column per INDEXED field (type-tagged value),
// UNIQUE indexes for UNIQUE fields, and the full row as lossless JSON in `data`.
// Confidentiality comes from SQLCipher encrypting the whole file; rows are not field-encrypted here.
import { decodeRow, encodeRow } from './codec';
import { UniqueViolation, type Row, type Where } from './IVaultDatabase';
import { INDEXED, STORE_NAMES, UNIQUE, type StoreName } from './schema';
import { StagedVault, type RawBackend, type WriteOp } from './StagedVault';
import { tagValue } from './WebEncryptedDexieAdapter';

export interface SqlStatement {
  sql: string;
  params: (string | number | null)[];
}

/** What a SQL engine must provide. Android: ArizoSqlCipherPlugin. Tests: sql.js. */
export interface SqlExecutor {
  query(sql: string, params?: (string | number | null)[]): Promise<Record<string, unknown>[]>;
  /** Run all statements in one transaction; roll back and reject on any error. */
  batch(statements: SqlStatement[]): Promise<void>;
  close(): Promise<void>;
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
const col = (field: string) => q(`ix_${field}`);

/** Ordered schema migrations. Append only; never edit a shipped entry. */
export const SQL_MIGRATIONS: { version: number; statements: () => string[] }[] = [
  {
    version: 1,
    statements: () =>
      STORE_NAMES.flatMap((s) => {
        const ix = INDEXED[s] as readonly string[];
        const uq = (UNIQUE[s] ?? []) as readonly string[];
        return [
          `CREATE TABLE IF NOT EXISTS ${q(s)} (id TEXT PRIMARY KEY NOT NULL, ${ix.map((f) => `${col(f)} TEXT`).join(', ')}${ix.length ? ', ' : ''}data TEXT NOT NULL)`,
          ...ix.map((f) =>
            uq.includes(f)
              ? `CREATE UNIQUE INDEX IF NOT EXISTS ${q(`ux_${s}_${f}`)} ON ${q(s)} (${col(f)})`
              : `CREATE INDEX IF NOT EXISTS ${q(`ix_${s}_${f}`)} ON ${q(s)} (${col(f)})`,
          ),
        ];
      }),
  },
];
export const SQL_SCHEMA_VERSION = SQL_MIGRATIONS[SQL_MIGRATIONS.length - 1]!.version;

export async function migrate(exec: SqlExecutor): Promise<number> {
  await exec.batch([{ sql: 'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)', params: [] }]);
  const done = new Set((await exec.query('SELECT version FROM schema_migrations')).map((r) => Number(r.version)));
  for (const m of SQL_MIGRATIONS) {
    if (done.has(m.version)) continue;
    await exec.batch([
      ...m.statements().map((sql) => ({ sql, params: [] })),
      { sql: 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', params: [m.version, Date.now()] },
    ]);
  }
  const rows = await exec.query('SELECT MAX(version) AS v FROM schema_migrations');
  return Number(rows[0]?.v ?? 0);
}

function isUniqueError(e: unknown): boolean {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|code 2067/i.test(e instanceof Error ? e.message : String(e));
}

class SqlBackend implements RawBackend {
  constructor(private exec: SqlExecutor) {}

  async get<K extends StoreName>(store: K, id: string): Promise<Row<K> | undefined> {
    const rows = await this.exec.query(`SELECT data FROM ${q(store)} WHERE id = ?`, [id]);
    return rows[0] ? decodeRow<Row<K>>(String(rows[0].data)) : undefined;
  }

  async find<K extends StoreName>(store: K, where: Where<K>): Promise<Row<K>[]> {
    const clauses: string[] = [];
    const params: (string | null)[] = [];
    for (const [f, v] of Object.entries(where)) {
      const t = tagValue(v);
      if (t === null) clauses.push(`${col(f)} IS NULL`);
      else {
        clauses.push(`${col(f)} = ?`);
        params.push(t);
      }
    }
    const sql = `SELECT data FROM ${q(store)}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`;
    return (await this.exec.query(sql, params)).map((r) => decodeRow<Row<K>>(String(r.data)));
  }

  async applyBatch(ops: WriteOp[]): Promise<void> {
    const stmts: SqlStatement[] = ops.map((op) => {
      if (!op.row) return { sql: `DELETE FROM ${q(op.store)} WHERE id = ?`, params: [op.id] };
      const ix = INDEXED[op.store] as readonly string[];
      const r = op.row as unknown as Record<string, unknown>;
      const cols = ['id', ...ix.map((f) => `ix_${f}`), 'data'];
      return {
        sql: `INSERT OR REPLACE INTO ${q(op.store)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        params: [op.id, ...ix.map((f) => tagValue(r[f])), encodeRow(op.row)],
      };
    });
    try {
      await this.exec.batch(stmts);
    } catch (e) {
      if (isUniqueError(e)) throw new UniqueViolation(ops[0]?.store ?? 'unknown', 'unique');
      throw e;
    }
  }

  async count(store: StoreName): Promise<number> {
    return Number((await this.exec.query(`SELECT COUNT(*) AS n FROM ${q(store)}`))[0]?.n ?? 0);
  }

  async clearAll(): Promise<void> {
    await this.exec.batch(STORE_NAMES.map((s) => ({ sql: `DELETE FROM ${q(s)}`, params: [] })));
  }

  close(): Promise<void> {
    return this.exec.close();
  }
}

export class SqlVaultAdapter extends StagedVault {
  private constructor(kind: 'android-sqlcipher' | 'memory', exec: SqlExecutor) {
    super(kind, new SqlBackend(exec));
  }

  /** Run migrations, then return a ready adapter. */
  static async open(exec: SqlExecutor, kind: 'android-sqlcipher' | 'memory'): Promise<SqlVaultAdapter> {
    await migrate(exec);
    return new SqlVaultAdapter(kind, exec);
  }
}
