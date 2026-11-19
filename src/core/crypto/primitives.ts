import { argon2id } from 'hash-wasm';
import { buf, concatBytes, randomBytes, te, zeroize } from './bytes';

/** PROMPT.md §5.1: m=64 MiB, t=3, p=1, 16-byte salt, 32-byte key. */
export interface Argon2Params {
  m: number; // KiB
  t: number;
  p: number;
}
export const ARGON2_DEFAULT: Argon2Params = { m: 65536, t: 3, p: 1 };
export const SALT_LEN = 16;
export const NONCE_LEN = 12;
export const TAG_LEN = 16;

/** Argon2id → 32 raw key bytes. Caller must zeroize the result. The password buffer is zeroized here. */
export async function argon2idRaw(password: Uint8Array, salt: Uint8Array, params: Argon2Params = ARGON2_DEFAULT): Promise<Uint8Array> {
  if (salt.length < SALT_LEN) throw new RangeError('salt too short');
  try {
    return await argon2id({
      password,
      salt,
      iterations: params.t,
      parallelism: params.p,
      memorySize: params.m,
      hashLength: 32,
      outputType: 'binary',
    });
  } finally {
    zeroize(password);
  }
}

/** Import 32 raw bytes as a non-extractable AES-256-GCM key, then zeroize the raw bytes. */
export async function importAesKey(raw: Uint8Array, usages: KeyUsage[] = ['encrypt', 'decrypt']): Promise<CryptoKey> {
  try {
    if (raw.length !== 32) throw new RangeError('AES-256 key must be 32 bytes');
    return await crypto.subtle.importKey('raw', buf(raw), { name: 'AES-GCM' }, false, usages);
  } finally {
    zeroize(raw);
  }
}

/** Import 32 raw bytes as an HKDF base key (non-extractable). Zeroizes raw. */
export async function importHkdfKey(raw: Uint8Array): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('raw', buf(raw), 'HKDF', false, ['deriveKey', 'deriveBits']);
  } finally {
    zeroize(raw);
  }
}

/** HKDF-SHA256 sub-key derivation with domain separation via `info`. */
export function hkdfAesKey(base: CryptoKey, info: string, salt: Uint8Array = new Uint8Array(32)): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(te.encode(info)) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function hkdfBits(base: CryptoKey, info: string, bits = 256): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: buf(te.encode(info)) }, base, bits),
  );
}

/** AES-256-GCM seal: returns nonce(12) || ciphertext||tag. `aad` binds context (record id, store name). */
export async function seal(key: CryptoKey, plaintext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const nonce = randomBytes(NONCE_LEN);
  const params: AesGcmParams = { name: 'AES-GCM', iv: buf(nonce), tagLength: 128 };
  if (aad) params.additionalData = buf(aad);
  const ct = new Uint8Array(await crypto.subtle.encrypt(params, key, buf(plaintext)));
  return concatBytes(nonce, ct);
}

/** AES-256-GCM open. Throws on any tamper, wrong key or wrong AAD. */
export async function open(key: CryptoKey, sealed: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < NONCE_LEN + TAG_LEN) throw new Error('ciphertext too short');
  const params: AesGcmParams = { name: 'AES-GCM', iv: buf(sealed.slice(0, NONCE_LEN)), tagLength: 128 };
  if (aad) params.additionalData = buf(aad);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(params, key, buf(sealed.slice(NONCE_LEN))));
  } catch {
    throw new Error('decryption failed: wrong key or tampered data');
  }
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf(data)));
}
