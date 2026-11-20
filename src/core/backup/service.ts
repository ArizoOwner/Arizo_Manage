// Backup use cases over the open vault: create a .arizo file, inspect one without writing (Dry-Run),
// restore it (Safe Replace or Smart Merge, both behind an automatic pre-restore safety snapshot with
// rollback), rolling local auto-snapshots, the Recovery Key record and backup reminders.
// Audit rows carry the mode only: no amounts, names, counts or file names.
import { fromB64, te, toB64 } from '../crypto/bytes';
import { ARGON2_DEFAULT, type Argon2Params } from '../crypto/primitives';
import type { IVaultDatabase, VaultTx } from '../storage/IVaultDatabase';
import { STORE_NAMES } from '../storage/schema';
import { uuidv7 } from '../utils/uuidv7';
import { BackupError, type Secret } from './container';
import type { BackupEngine } from './engine';
import { checkBlobs, takeSnapshot, totalRows, type Manifest, type Snapshot } from './payload';
import { auditRow, mergeInto, replaceWith, type MergeReport } from './restore';

export const SNAPSHOTS_KEY = 'backup_snapshots';
export const STATE_KEY = 'backup_state';
export const RECOVERY_KEY = 'backup_recovery';
export const KEEP_SNAPSHOTS = 5;
export const AUTO_EVERY_MS = 24 * 3_600_000;
const DAY = 86_400_000;

export interface Deps {
  engine: BackupEngine;
  platform: Manifest['platform'];
  params?: Argon2Params;
  now?: number;
}

export interface BackupState {
  last_backup_at: number | null;
  last_restore_at: number | null;
  /** 0 = reminders off. */
  remind_days: number;
}
export interface SnapshotEntry {
  id: string;
  created_at: number;
  reason: 'auto' | 'pre_restore';
  rows: number;
  bytes: number;
}
export interface RecoveryRecord {
  entropy_b64: string;
  created_at: number;
}

async function readSetting<T>(db: IVaultDatabase | VaultTx, id: string, fallback: T): Promise<T> {
  const row = await db.get('settings', id);
  return row && row.deleted_at === null ? (row.value_json as T) : fallback;
}
async function writeSetting(tx: VaultTx, id: string, value: unknown, now: number) {
  const prev = await tx.get('settings', id);
  await tx.put('settings', { id, created_at: prev?.created_at ?? now, updated_at: now, deleted_at: null, value_json: value });
}

export const DEFAULT_STATE: BackupState = { last_backup_at: null, last_restore_at: null, remind_days: 7 };
export const backupState = (db: IVaultDatabase) => readSetting<BackupState>(db, STATE_KEY, DEFAULT_STATE).then((s) => ({ ...DEFAULT_STATE, ...s }));
export const setRemindDays = (db: IVaultDatabase, days: number, now = Date.now()) =>
  db.transaction(async (tx) => writeSetting(tx, STATE_KEY, { ...DEFAULT_STATE, ...(await readSetting(tx, STATE_KEY, DEFAULT_STATE)), remind_days: days }, now));

/** True when reminders are on and the last backup is older than the reminder window (or never, once the vault has data). */
export function backupDue(state: BackupState, hasData: boolean, now = Date.now()): boolean {
  if (!state.remind_days || !hasData) return false;
  return state.last_backup_at === null || now - state.last_backup_at >= state.remind_days * DAY;
}

// ---------- Recovery Key ----------

export const recoveryRecord = (db: IVaultDatabase) => readSetting<RecoveryRecord | null>(db, RECOVERY_KEY, null);
export const saveRecovery = (db: IVaultDatabase, entropy: Uint8Array, now = Date.now()) =>
  db.transaction((tx) => writeSetting(tx, RECOVERY_KEY, { entropy_b64: toB64(entropy), created_at: now } satisfies RecoveryRecord, now));
export const removeRecovery = (db: IVaultDatabase, now = Date.now()) =>
  db.transaction(async (tx) => {
    const prev = await tx.get('settings', RECOVERY_KEY);
    if (prev) await tx.put('settings', { ...prev, deleted_at: now, updated_at: now, value_json: null });
  });

// ---------- create / inspect / restore ----------

/** Snapshot the vault and seal it. With a stored Recovery Key the file also opens with the 24 words. */
export async function createBackup(db: IVaultDatabase, passphrase: string, deps: Deps): Promise<{ bytes: Uint8Array; manifest: Manifest }> {
  const now = deps.now ?? Date.now();
  const snap = await takeSnapshot(db, deps.platform, now);
  const rec = await recoveryRecord(db);
  const bytes = await deps.engine.seal(snap, { passphrase: te.encode(passphrase.normalize('NFKC')), recovery: rec ? fromB64(rec.entropy_b64) : null }, deps.params ?? ARGON2_DEFAULT);
  await db.transaction(async (tx) => {
    await tx.put('app_audit_log', auditRow('backup_created', rec ? 'file+recovery' : 'file', now));
    await writeSetting(tx, STATE_KEY, { ...DEFAULT_STATE, ...(await readSetting(tx, STATE_KEY, DEFAULT_STATE)), last_backup_at: now }, now);
  });
  return { bytes, manifest: snap.manifest };
}

/** Dry-Run Restore Inspector: decrypt, validate and return the snapshot. Writes nothing. */
export async function inspectBackup(file: Uint8Array, secret: Secret, engine: BackupEngine): Promise<Snapshot> {
  const snap = await engine.open(file, secret);
  await checkBlobs(snap);
  return snap;
}

export type RestoreMode = 'replace' | 'merge';
export interface RestoreResult {
  mode: RestoreMode;
  safetySnapshotId: string;
  merge?: MergeReport;
}

const sameCounts = (a: Snapshot, b: Snapshot) => STORE_NAMES.every((s) => a.stores[s].length === b.stores[s].length) && a.manifest.blobs === b.manifest.blobs;

/**
 * Restore `snap` into the open vault. A safety snapshot of the current vault is stored first; if the
 * write fails, or a Replace does not read back with the expected counts, the vault is put back from it.
 */
export async function restoreBackup(db: IVaultDatabase, snap: Snapshot, mode: RestoreMode, deps: Deps): Promise<RestoreResult> {
  const now = deps.now ?? Date.now();
  await checkBlobs(snap);
  const before = await takeSnapshot(db, deps.platform, now);
  const safety = await saveSnapshot(db, before, 'pre_restore', deps.engine, now);
  let merge: MergeReport | undefined;
  try {
    if (mode === 'replace') {
      await replaceWith(db, snap, before);
      const after = await takeSnapshot(db, deps.platform, now);
      if (!sameCounts(after, snap)) {
        await replaceWith(db, before, after);
        throw new BackupError('BACKUP_FORMAT');
      }
    } else merge = await mergeInto(db, snap, before, now);
  } catch (e) {
    // The row batch is atomic and blobs are put back, so the vault is unchanged; say why it failed.
    throw e instanceof BackupError ? e : new BackupError('BACKUP_FORMAT');
  }
  await db.transaction(async (tx) => {
    await tx.put('app_audit_log', auditRow('backup_restored', mode, now));
    await writeSetting(tx, STATE_KEY, { ...DEFAULT_STATE, ...(await readSetting(tx, STATE_KEY, DEFAULT_STATE)), last_restore_at: now }, now);
  });
  return merge ? { mode, safetySnapshotId: safety.id, merge } : { mode, safetySnapshotId: safety.id };
}

// ---------- rolling local snapshots ----------
// Stored through the vault's own blob store (web: AES-256-GCM under the vault blob key; Android: inside
// the SQLCipher file), so they are as encrypted as the vault and need no second passphrase.

export const listSnapshots = (db: IVaultDatabase) => readSetting<SnapshotEntry[]>(db, SNAPSHOTS_KEY, []);

export async function saveSnapshot(db: IVaultDatabase, snap: Snapshot, reason: SnapshotEntry['reason'], engine: BackupEngine, now = Date.now(), keep = KEEP_SNAPSHOTS): Promise<SnapshotEntry> {
  const bytes = await engine.pack(snap);
  const entry: SnapshotEntry = { id: `snap_${uuidv7(now)}`, created_at: now, reason, rows: totalRows(snap.manifest), bytes: bytes.length };
  await db.putBlob(entry.id, bytes);
  const dropped = await db.transaction(async (tx) => {
    const list = [entry, ...(await readSetting<SnapshotEntry[]>(tx, SNAPSHOTS_KEY, []))];
    await writeSetting(tx, SNAPSHOTS_KEY, list.slice(0, keep), now);
    return list.slice(keep);
  });
  for (const d of dropped) await db.deleteBlob(d.id).catch(() => {});
  return entry;
}

export async function loadSnapshot(db: IVaultDatabase, id: string, engine: BackupEngine): Promise<Snapshot> {
  if (!(await listSnapshots(db)).some((s) => s.id === id)) throw new BackupError('BACKUP_FORMAT');
  const bytes = await db.getBlob(id);
  if (!bytes) throw new BackupError('BACKUP_FORMAT');
  return engine.unpack(bytes);
}

/** After a main-vault unlock: one auto-snapshot per day, only once the vault holds transactions. */
export async function maybeAutoSnapshot(db: IVaultDatabase, deps: Deps): Promise<SnapshotEntry | null> {
  const now = deps.now ?? Date.now();
  const last = (await listSnapshots(db)).find((s) => s.reason === 'auto');
  if (last && now - last.created_at < AUTO_EVERY_MS) return null;
  if ((await db.count('transactions')) === 0) return null;
  return saveSnapshot(db, await takeSnapshot(db, deps.platform, now), 'auto', deps.engine, now);
}
