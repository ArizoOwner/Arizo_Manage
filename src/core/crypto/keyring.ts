// Web vault keyring (PROMPT.md §5.1, iOS PWA path).
// A random 256-bit DEK is wrapped by an Argon2id(PIN) KEK, one slot per PIN (main, decoy).
// The DEK never leaves this module as bytes: it becomes a non-extractable HKDF base key,
// from which record, blob and index keys are derived with domain separation.
import { buf, concatBytes, fromB64, randomBytes, te, toB64, zeroize } from './bytes';
import {
  ARGON2_DEFAULT,
  type Argon2Params,
  SALT_LEN,
  argon2idRaw,
  hkdfAesKey,
  hkdfBits,
  importAesKey,
  importHkdfKey,
  open,
  seal,
} from './primitives';

export type SlotKind = 'main' | 'decoy';

export interface KeySlot {
  kind: SlotKind;
  /** Which vault this PIN opens. Main and decoy vaults are separate databases with separate DEKs. */
  vaultId: string;
  saltB64: string;
  params: Argon2Params;
  /** AES-GCM(KEK, DEK), AAD = "arizo/slot/v1|<vaultId>". */
  wrappedDekB64: string;
}

export interface Keyring {
  v: 1;
  slots: KeySlot[];
}

export interface VaultKeys {
  vaultId: string;
  kind: SlotKind;
  /** AES-256-GCM key for record payloads. */
  record: CryptoKey;
  /** AES-256-GCM key for attachment blobs. */
  blob: CryptoKey;
  /** HMAC-SHA256 key producing opaque equality-index tags. */
  index: CryptoKey;
}

const slotAad = (vaultId: string) => te.encode(`arizo/slot/v1|${vaultId}`);

/** Derive the vault's working keys from raw DEK bytes. Zeroizes `dek`. */
export async function deriveVaultKeys(dek: Uint8Array, vaultId: string, kind: SlotKind): Promise<VaultKeys> {
  const base = await importHkdfKey(dek);
  const [record, blob, indexBits] = await Promise.all([
    hkdfAesKey(base, 'arizo/record/v1'),
    hkdfAesKey(base, 'arizo/blob/v1'),
    hkdfBits(base, 'arizo/index/v1'),
  ]);
  try {
    const index = await crypto.subtle.importKey('raw', buf(indexBits), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return { vaultId, kind, record, blob, index };
  } finally {
    zeroize(indexBits);
  }
}

async function wrapSlot(pin: Uint8Array, dek: Uint8Array, vaultId: string, kind: SlotKind, params: Argon2Params): Promise<KeySlot> {
  const salt = randomBytes(SALT_LEN);
  const kek = await importAesKey(await argon2idRaw(pin, salt, params));
  const wrapped = await seal(kek, dek, slotAad(vaultId));
  return { kind, vaultId, saltB64: toB64(salt), params, wrappedDekB64: toB64(wrapped) };
}

/** Create a slot with a fresh DEK. Zeroizes `pin`. Returns the slot to persist and the live keys. */
export async function createSlot(
  pin: Uint8Array,
  kind: SlotKind,
  vaultId: string,
  params: Argon2Params = ARGON2_DEFAULT,
): Promise<{ slot: KeySlot; keys: VaultKeys }> {
  const dek = randomBytes(32);
  try {
    const slot = await wrapSlot(pin, dek, vaultId, kind, params);
    return { slot, keys: await deriveVaultKeys(dek.slice(), vaultId, kind) };
  } finally {
    zeroize(dek, pin);
  }
}

/**
 * Try `pin` against every slot. All slots are always derived so timing does not reveal
 * whether a decoy slot exists or which one matched. Zeroizes `pin`. Null on no match.
 */
export async function unlockKeyring(ring: Keyring, pin: Uint8Array): Promise<VaultKeys | null> {
  let match: VaultKeys | null = null;
  try {
    for (const slot of ring.slots) {
      const kek = await importAesKey(await argon2idRaw(pin.slice(), fromB64(slot.saltB64), slot.params));
      let dek: Uint8Array | null;
      try {
        dek = await open(kek, fromB64(slot.wrappedDekB64), slotAad(slot.vaultId));
      } catch {
        dek = null;
      }
      if (dek && !match) match = await deriveVaultKeys(dek, slot.vaultId, slot.kind);
      else zeroize(dek);
    }
    return match;
  } finally {
    zeroize(pin);
  }
}

/** Re-wrap a slot's DEK under a new PIN (PIN change). Zeroizes both PINs. Throws BAD_PIN. */
export async function rewrapSlot(slot: KeySlot, oldPin: Uint8Array, newPin: Uint8Array): Promise<KeySlot> {
  const kek = await importAesKey(await argon2idRaw(oldPin, fromB64(slot.saltB64), slot.params));
  let dek: Uint8Array;
  try {
    dek = await open(kek, fromB64(slot.wrappedDekB64), slotAad(slot.vaultId));
  } catch {
    zeroize(newPin);
    throw new Error('BAD_PIN');
  }
  try {
    return await wrapSlot(newPin, dek, slot.vaultId, slot.kind, slot.params);
  } finally {
    zeroize(dek);
  }
}

/** Opaque deterministic 128-bit tag for an equality index (store, field, value), base64. */
export async function indexTag(keys: Pick<VaultKeys, 'index'>, store: string, field: string, value: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', keys.index, buf(te.encode(`${store}\u0000${field}\u0000${value}`))));
  return toB64(mac.subarray(0, 16));
}

export const recordAad = (store: string, id: string): Uint8Array => te.encode(`arizo/rec/v1|${store}|${id}`);
export const blobAad = (blobKey: string): Uint8Array => concatBytes(te.encode('arizo/blob/v1|'), te.encode(blobKey));
