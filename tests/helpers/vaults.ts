// Test factories for both IVaultDatabase adapters.
// Web: real WebEncryptedDexieAdapter over fake-indexeddb. SQL: real SqlVaultAdapter over sql.js
// (the same SQL the Android SQLCipher plugin executes, minus the cipher).
import 'fake-indexeddb/auto';
import initSqlJs, { type Database } from 'sql.js';
import { createSlot } from '../../src/core/crypto/keyring';
import { te } from '../../src/core/crypto/bytes';
import type { IVaultDatabase } from '../../src/core/storage/IVaultDatabase';
import { SqlVaultAdapter, type SqlExecutor } from '../../src/core/storage/SqlVaultAdapter';
import { WebEncryptedDexieAdapter } from '../../src/core/storage/WebEncryptedDexieAdapter';
import { uuidv7 } from '../../src/core/utils/uuidv7';

export const FAST_ARGON = { m: 1024, t: 1, p: 1 };

let sqlJs: Awaited<ReturnType<typeof initSqlJs>> | null = null;

export function sqlJsExecutor(db: Database): SqlExecutor {
  return {
    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params);
        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally {
        stmt.free();
      }
    },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const s of statements) db.run(s.sql, s.params);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async close() {
      db.close();
    },
  };
}

export async function makeSqlVault(): Promise<IVaultDatabase> {
  sqlJs ??= await initSqlJs();
  return SqlVaultAdapter.open(sqlJsExecutor(new sqlJs.Database()), 'memory');
}

export async function makeWebVault(): Promise<WebEncryptedDexieAdapter> {
  const { keys } = await createSlot(te.encode('123456'), 'main', `test-${uuidv7()}`, FAST_ARGON);
  return new WebEncryptedDexieAdapter(keys);
}

export const ADAPTERS: [string, () => Promise<IVaultDatabase>][] = [
  ['WebEncryptedDexieAdapter', makeWebVault],
  ['SqlVaultAdapter (SQLCipher SQL via sql.js)', makeSqlVault],
];
