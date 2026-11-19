/// <reference lib="webworker" />
// Dedicated worker: Argon2id (CPU-bound WASM) and keyring operations never run on the UI thread.
// Raw key bytes are created, used and zeroized here; only non-extractable CryptoKeys are posted back.
import { createSlot, rewrapSlot, unlockKeyring, type Keyring, type KeySlot, type SlotKind } from './keyring';
import { argon2idRaw, type Argon2Params } from './primitives';

export type CryptoRequest =
  | { op: 'createSlot'; pin: Uint8Array; kind: SlotKind; vaultId: string; params?: Argon2Params }
  | { op: 'unlock'; ring: Keyring; pin: Uint8Array }
  | { op: 'rewrap'; slot: KeySlot; oldPin: Uint8Array; newPin: Uint8Array }
  | { op: 'argon2'; password: Uint8Array; salt: Uint8Array; params: Argon2Params };

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<{ id: number; req: CryptoRequest }>) => {
  const { id, req } = e.data;
  try {
    let result: unknown;
    switch (req.op) {
      case 'createSlot':
        result = await createSlot(req.pin, req.kind, req.vaultId, req.params);
        break;
      case 'unlock':
        result = await unlockKeyring(req.ring, req.pin);
        break;
      case 'rewrap':
        result = await rewrapSlot(req.slot, req.oldPin, req.newPin);
        break;
      case 'argon2': {
        const out = await argon2idRaw(req.password, req.salt, req.params);
        self.postMessage({ id, ok: true, result: out }, [out.buffer]);
        return;
      }
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : 'crypto error' });
  }
};
