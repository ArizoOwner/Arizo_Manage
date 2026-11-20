/// <reference lib="webworker" />
// One-shot backup worker: seals or opens one .arizo file (or packs a local snapshot) and is terminated.
import { BackupError } from './container';
import { directEngine, type EngineRequest } from './engine';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<EngineRequest>) => {
  const req = e.data;
  try {
    let result: unknown;
    if (req.op === 'seal') result = await directEngine.seal(req.snap, req.secrets, req.params);
    else if (req.op === 'open') result = await directEngine.open(req.file, req.secret);
    else if (req.op === 'pack') result = await directEngine.pack(req.snap);
    else result = await directEngine.unpack(req.bytes);
    self.postMessage({ ok: true, result }, result instanceof Uint8Array ? [result.buffer as ArrayBuffer] : []);
  } catch (err) {
    self.postMessage({ ok: false, code: err instanceof BackupError ? err.code : 'BACKUP_AUTH' });
  }
};
