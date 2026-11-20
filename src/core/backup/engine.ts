// The CPU-heavy half of backups (JSON encoding, gzip, Argon2id, AES-GCM). `directEngine` runs it in the
// current thread (the worker itself, and Vitest); `workerEngine` sends it to a one-shot backup worker that
// is terminated when done and on lock, so no passphrase or plaintext snapshot lingers in a worker heap.
import type { Argon2Params } from '../crypto/primitives';
import { BackupError, gunzip, gzip, openContainer, sealContainer, type BackupErrorCode, type Secret, type Secrets } from './container';
import { decodeSnapshot, encodeSnapshot, type Snapshot } from './payload';

export interface BackupEngine {
  seal(snap: Snapshot, secrets: Secrets, params: Argon2Params): Promise<Uint8Array>;
  open(file: Uint8Array, secret: Secret): Promise<Snapshot>;
  /** Local auto-snapshots: gzip only, because the vault already encrypts the blob at rest. */
  pack(snap: Snapshot): Promise<Uint8Array>;
  unpack(bytes: Uint8Array): Promise<Snapshot>;
}

export const directEngine: BackupEngine = {
  seal: (snap, secrets, params) => sealContainer(encodeSnapshot(snap), secrets, params),
  open: async (file, secret) => decodeSnapshot(await openContainer(file, secret)),
  pack: (snap) => gzip(encodeSnapshot(snap)),
  unpack: async (bytes) => decodeSnapshot(await gunzip(bytes)),
};

export type EngineRequest =
  | { op: 'seal'; snap: Snapshot; secrets: Secrets; params: Argon2Params }
  | { op: 'open'; file: Uint8Array; secret: Secret }
  | { op: 'pack'; snap: Snapshot }
  | { op: 'unpack'; bytes: Uint8Array };

const live = new Set<Worker>();

function run<T>(req: EngineRequest, transfer: Transferable[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./backup.worker.ts', import.meta.url), { type: 'module', name: 'arizo-backup' });
    live.add(w);
    const done = () => {
      w.terminate();
      live.delete(w);
    };
    w.onmessage = (e: MessageEvent<{ ok: boolean; result?: T; code?: BackupErrorCode }>) => {
      done();
      if (e.data.ok) resolve(e.data.result as T);
      else reject(new BackupError(e.data.code ?? 'BACKUP_FORMAT'));
    };
    w.onerror = () => {
      done();
      reject(new BackupError('BACKUP_FORMAT'));
    };
    w.postMessage(req, transfer);
  });
}

const secretBuffers = (s: Secrets): Transferable[] => [s.passphrase.buffer as ArrayBuffer, ...(s.recovery ? [s.recovery.buffer as ArrayBuffer] : [])];

export const workerEngine: BackupEngine = {
  seal: (snap, secrets, params) => run({ op: 'seal', snap, secrets, params }, secretBuffers(secrets)),
  open: (file, secret) => run({ op: 'open', file, secret }, [(secret.kind === 'passphrase' ? secret.bytes : secret.entropy).buffer as ArrayBuffer]),
  pack: (snap) => run({ op: 'pack', snap }, []),
  unpack: (bytes) => run({ op: 'unpack', bytes }, []),
};

/** Called on lock and wipe: a backup in flight is abandoned with the session. */
export function terminateBackupWorkers(): void {
  for (const w of live) w.terminate();
  live.clear();
}
