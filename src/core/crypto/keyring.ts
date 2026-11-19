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
  /** 'pin' (default): KEK = Argon2id(PIN). 'prf': KEK = HKDF(WebAuthn PRF output); unlocked by Face ID / Touch ID. */
  method?: 'pin' | 'prf';
  /** For 'prf' slots: the passkey credential id. */
  credentialIdB64?: string;
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
    for (const slot of ring.slots.filter((s) => s.method !== 'prf')) {
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

/** KEK from a WebAuthn PRF output (32 bytes), domain-separated through HKDF. Zeroizes `prf`. */
async function prfKek(prf: Uint8Array): Promise<CryptoKey> {
  if (prf.length < 32) {
    zeroize(prf);
    throw new RangeError('PRF output too short');
  }
  return hkdfAesKey(await importHkdfKey(prf), 'arizo/prf-kek/v1');
}

/**
 * Enrol Face ID / Touch ID: open the main PIN slot with `pin`, wrap the same DEK under the PRF KEK.
 * Zeroizes `pin` and `prf`. Throws BAD_PIN when the PIN does not open the main slot.
 */
export async function addPrfSlot(ring: Keyring, pin: Uint8Array, prf: Uint8Array, credentialIdB64: string): Promise<KeySlot> {
  const main = ring.slots.find((s) => s.kind === 'main' && s.method !== 'prf');
  if (!main) {
    zeroize(pin, prf);
    throw new Error('NO_MAIN_SLOT');
  }
  const kek = await importAesKey(await argon2idRaw(pin, fromB64(main.saltB64), main.params));
  let dek: Uint8Array;
  try {
    dek = await open(kek, fromB64(main.wrappedDekB64), slotAad(main.vaultId));
  } catch {
    zeroize(prf);
    throw new Error('BAD_PIN');
  }
  try {
    const wrapped = await seal(await prfKek(prf), dek, slotAad(main.vaultId));
    return { kind: 'main', vaultId: main.vaultId, saltB64: '', params: main.params, wrappedDekB64: toB64(wrapped), method: 'prf', credentialIdB64 };
  } finally {
    zeroize(dek);
  }
}

/** Unlock with a PRF output. Zeroizes `prf`. Null when it does not open the slot. */
export async function unlockWithPrf(slot: KeySlot, prf: Uint8Array): Promise<VaultKeys | null> {
  if (slot.method !== 'prf') {
    zeroize(prf);
    return null;
  }
  try {
    const dek = await open(await prfKek(prf), fromB64(slot.wrappedDekB64), slotAad(slot.vaultId));
    return await deriveVaultKeys(dek, slot.vaultId, slot.kind);
  } catch {
    return null;
  }
}

/** Opaque deterministic 128-bit tag for an equality index (store, field, value), base64. */
export async function indexTag(keys: Pick<VaultKeys, 'index'>, store: string, field: string, value: string): Promise<string> {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', keys.index, buf(te.encode(`${store}\u0000${field}\u0000${value}`))));
  return toB64(mac.subarray(0, 16));
}

export const recordAad = (store: string, id: string): Uint8Array => te.encode(`arizo/rec/v1|${store}|${id}`);
export const blobAad = (blobKey: string): Uint8Array => concatBytes(te.encode('arizo/blob/v1|'), te.encode(blobKey));
