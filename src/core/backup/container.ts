// The .arizo container, v1. The same TypeScript seals and opens it on Android and iOS/web, so a file
// made on one platform restores on the other byte for byte.
//
//   off  field                                   bytes
//   0    magic 'ARZO'                            4
//   4    format version (1)                      1
//   5    KDF id (1 = Argon2id)                   1
//   6    Argon2 m in KiB (u32 BE)                4
//   10   Argon2 t (u32 BE)                       4
//   14   Argon2 p (u8)                           1
//   15   salt                                    16
//   31   slot count n (1..2)                     1
//   32   n x slot: kind (1 passphrase, 2 recovery key) + nonce(12) + AES-GCM(KEK, file key)(32 + tag 16) = 61
//   ..   body nonce                              12
//   ..   AES-256-GCM(file key, gzip(payload)) || tag(16), AAD = every header byte above
//
// A random 256-bit file key encrypts the body; each slot wraps it under one secret (Argon2id of the
// passphrase, or HKDF of the 24-word Recovery Key). The whole header is the body's AAD and its fixed
// part is each slot's AAD, so flipping any header bit fails decryption like a ciphertext flip does.
import { buf, concatBytes, randomBytes, te, zeroize } from '../crypto/bytes';
import { argon2idRaw, hkdfAesKey, importAesKey, importHkdfKey, NONCE_LEN, open, SALT_LEN, seal, TAG_LEN, type Argon2Params } from '../crypto/primitives';

export const MAGIC = 'ARZO';
export const FORMAT_VERSION = 1;
const FIXED_LEN = 32;
const SLOT_LEN = 1 + NONCE_LEN + 32 + TAG_LEN;
/** Refuse files that would make us burn absurd memory or time before the passphrase is even checked. */
const MAX_M = 1 << 20; // 1 GiB
const MAX_T = 16;
const MAX_P = 8;
/** Gzip-bomb guard: a decompressed payload above this is refused. */
export const MAX_PAYLOAD = 512 * 1024 * 1024;

export type SlotKind = 'passphrase' | 'recovery';
const KIND_CODE: Record<SlotKind, number> = { passphrase: 1, recovery: 2 };

export type BackupErrorCode = 'BACKUP_FORMAT' | 'BACKUP_VERSION' | 'BACKUP_AUTH' | 'BACKUP_NO_RECOVERY' | 'BACKUP_TOO_LARGE' | 'BACKUP_TOO_NEW';
export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode) {
    super(code);
    this.name = 'BackupError';
  }
}

export interface Secrets {
  /** UTF-8 passphrase (NFKC). Zeroized here. */
  passphrase: Uint8Array;
  /** 32-byte Recovery Key entropy, or null. Zeroized here. */
  recovery: Uint8Array | null;
}
export type Secret = { kind: 'passphrase'; bytes: Uint8Array } | { kind: 'recovery'; entropy: Uint8Array };

export interface Header {
  params: Argon2Params;
  salt: Uint8Array;
  slots: { kind: SlotKind; sealed: Uint8Array }[];
  nonce: Uint8Array;
  /** Header bytes = body AAD. */
  aad: Uint8Array;
  bodyOffset: number;
}

const slotAad = (fixed: Uint8Array, kind: SlotKind) => concatBytes(te.encode('arizo/backup/v1/slot|'), fixed, Uint8Array.of(KIND_CODE[kind]));

async function kekFor(kind: SlotKind, secret: Uint8Array, salt: Uint8Array, params: Argon2Params): Promise<CryptoKey> {
  if (kind === 'passphrase') return importAesKey(await argon2idRaw(secret, salt, params));
  // The Recovery Key already carries 256 bits of entropy, so HKDF is enough (no Argon2 needed).
  return hkdfAesKey(await importHkdfKey(secret), 'arizo/backup/v1/recovery', salt);
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream, cap: number): Promise<Uint8Array> {
  const reader = (new Blob([buf(data)]).stream().pipeThrough(stream) as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel();
      throw new BackupError('BACKUP_TOO_LARGE');
    }
    chunks.push(value);
  }
  return concatBytes(...chunks);
}
export const gzip = (data: Uint8Array) => pipe(data, new CompressionStream('gzip'), Number.MAX_SAFE_INTEGER);
export async function gunzip(data: Uint8Array, cap = MAX_PAYLOAD): Promise<Uint8Array> {
  try {
    return await pipe(data, new DecompressionStream('gzip'), cap);
  } catch (e) {
    throw e instanceof BackupError ? e : new BackupError('BACKUP_FORMAT');
  }
}

function fixedPart(params: Argon2Params, salt: Uint8Array, slotCount: number): Uint8Array {
  const h = new Uint8Array(FIXED_LEN);
  h.set(te.encode(MAGIC), 0);
  const dv = new DataView(h.buffer);
  dv.setUint8(4, FORMAT_VERSION);
  dv.setUint8(5, 1);
  dv.setUint32(6, params.m);
  dv.setUint32(10, params.t);
  dv.setUint8(14, params.p);
  h.set(salt, 15);
  dv.setUint8(31, slotCount);
  return h;
}

/** Seal a raw payload into a .arizo file. Secrets are zeroized. */
export async function sealContainer(payload: Uint8Array, secrets: Secrets, params: Argon2Params): Promise<Uint8Array> {
  const kinds: [SlotKind, Uint8Array][] = [['passphrase', secrets.passphrase]];
  if (secrets.recovery) kinds.push(['recovery', secrets.recovery]);
  const salt = randomBytes(SALT_LEN);
  const fixed = fixedPart(params, salt, kinds.length);
  const fileKey = randomBytes(32);
  const slots: Uint8Array[] = [];
  try {
    for (const [kind, secret] of kinds) {
      const kek = await kekFor(kind, secret, salt, params);
      slots.push(concatBytes(Uint8Array.of(KIND_CODE[kind]), await seal(kek, fileKey, slotAad(fixed, kind))));
    }
  } finally {
    for (const [, s] of kinds) zeroize(s);
  }
  const key = await importAesKey(fileKey); // zeroizes fileKey
  const nonce = randomBytes(NONCE_LEN);
  const aad = concatBytes(fixed, ...slots, nonce);
  const body = await gzip(payload);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce), additionalData: buf(aad), tagLength: 128 }, key, buf(body)));
  return concatBytes(aad, ct);
}

/** Parse the cleartext header. Throws BACKUP_FORMAT / BACKUP_VERSION; never needs a secret. */
export function readHeader(file: Uint8Array): Header {
  if (file.length < FIXED_LEN + SLOT_LEN + NONCE_LEN + TAG_LEN) throw new BackupError('BACKUP_FORMAT');
  if (String.fromCharCode(...file.subarray(0, 4)) !== MAGIC) throw new BackupError('BACKUP_FORMAT');
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (dv.getUint8(4) !== FORMAT_VERSION || dv.getUint8(5) !== 1) throw new BackupError('BACKUP_VERSION');
  const params = { m: dv.getUint32(6), t: dv.getUint32(10), p: dv.getUint8(14) };
  if (params.m < 8 || params.m > MAX_M || params.t < 1 || params.t > MAX_T || params.p < 1 || params.p > MAX_P) throw new BackupError('BACKUP_FORMAT');
  const n = dv.getUint8(31);
  const bodyOffset = FIXED_LEN + n * SLOT_LEN + NONCE_LEN;
  if (n < 1 || n > 2 || file.length < bodyOffset + TAG_LEN) throw new BackupError('BACKUP_FORMAT');
  const slots: Header['slots'] = [];
  for (let i = 0; i < n; i++) {
    const at = FIXED_LEN + i * SLOT_LEN;
    const code = file[at];
    const kind = code === 1 ? 'passphrase' : code === 2 ? 'recovery' : null;
    if (!kind) throw new BackupError('BACKUP_FORMAT');
    slots.push({ kind, sealed: file.slice(at + 1, at + SLOT_LEN) });
  }
  return { params, salt: file.slice(15, 31), slots, nonce: file.slice(bodyOffset - NONCE_LEN, bodyOffset), aad: file.slice(0, bodyOffset), bodyOffset };
}

/** Open a .arizo file with a passphrase or Recovery Key; returns the raw payload. The secret is zeroized. */
export async function openContainer(file: Uint8Array, secret: Secret): Promise<Uint8Array> {
  const kind: SlotKind = secret.kind;
  const bytes = secret.kind === 'passphrase' ? secret.bytes : secret.entropy;
  let h: Header;
  try {
    h = readHeader(file);
  } catch (e) {
    zeroize(bytes);
    throw e;
  }
  const slots = h.slots.filter((s) => s.kind === kind);
  if (!slots.length) {
    zeroize(bytes);
    throw new BackupError(kind === 'recovery' ? 'BACKUP_NO_RECOVERY' : 'BACKUP_FORMAT');
  }
  const kek = await kekFor(kind, bytes, h.salt, h.params); // zeroizes bytes
  const fixed = h.aad.subarray(0, FIXED_LEN);
  let key: CryptoKey | null = null;
  for (const s of slots) {
    try {
      key = await importAesKey(await open(kek, s.sealed, slotAad(fixed, kind)));
      break;
    } catch {
      /* try the next slot of this kind */
    }
  }
  if (!key) throw new BackupError('BACKUP_AUTH');
  let body: Uint8Array;
  try {
    body = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(h.nonce), additionalData: buf(h.aad), tagLength: 128 }, key, buf(file.subarray(h.bodyOffset))),
    );
  } catch {
    throw new BackupError('BACKUP_AUTH');
  }
  return gunzip(body);
}
