// Promise RPC to the crypto worker. Secret inputs are transferred (ownership moves to the worker),
// so no copy lingers on the UI thread.
import type { CryptoRequest } from './crypto.worker';
import type { Keyring, KeySlot, SlotKind, VaultKeys } from './keyring';
import type { Argon2Params } from './primitives';
import { te } from './bytes';

type Reply = { id: number; ok: boolean; result?: unknown; error?: string };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./crypto.worker.ts', import.meta.url), { type: 'module', name: 'arizo-crypto' });
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error ?? 'crypto error'));
  };
  return worker;
}

function call<T>(req: CryptoRequest, transfer: Transferable[]): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ id, req }, transfer);
  });
}

/** PINs exist as strings only at the UI edge and are encoded straight into a transferable buffer. */
const pinBytes = (pin: string): Uint8Array<ArrayBuffer> => te.encode(pin.normalize('NFKC'));

export const cryptoClient = {
  createSlot(pin: string, kind: SlotKind, vaultId: string, params?: Argon2Params) {
    const p = pinBytes(pin);
    const req: CryptoRequest = params
      ? { op: 'createSlot', pin: p, kind, vaultId, params }
      : { op: 'createSlot', pin: p, kind, vaultId };
    return call<{ slot: KeySlot; keys: VaultKeys }>(req, [p.buffer]);
  },
  unlock(ring: Keyring, pin: string) {
    const p = pinBytes(pin);
    return call<VaultKeys | null>({ op: 'unlock', ring, pin: p }, [p.buffer]);
  },
  rewrap(slot: KeySlot, oldPin: string, newPin: string) {
    const o = pinBytes(oldPin);
    const n = pinBytes(newPin);
    return call<KeySlot>({ op: 'rewrap', slot, oldPin: o, newPin: n }, [o.buffer, n.buffer]);
  },
  /** Android PIN path: derive the KEK off-thread; native unwraps the DEK in native memory. */
  argon2(password: string, salt: Uint8Array, params: Argon2Params) {
    const p = pinBytes(password);
    return call<Uint8Array>({ op: 'argon2', password: p, salt, params }, [p.buffer]);
  },
  /** Called on lock: kills the worker so no key material survives in its heap. */
  terminate() {
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new Error('crypto worker terminated'));
    pending.clear();
  },
};
