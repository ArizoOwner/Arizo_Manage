// Crypto engine: Argon2id vectors, AES-256-GCM tamper rejection, keyring slots, zeroization.
import { describe, expect, it } from 'vitest';
import { argon2id } from 'hash-wasm';
import { fromHex, randomBytes, te, td, timingSafeEqual, toB64, fromB64, toHex, zeroize, concatBytes } from '../src/core/crypto/bytes';
import { argon2idRaw, hkdfAesKey, importAesKey, importHkdfKey, open, seal, sha256, NONCE_LEN } from '../src/core/crypto/primitives';
import { createSlot, indexTag, recordAad, rewrapSlot, unlockKeyring, type Keyring } from '../src/core/crypto/keyring';

// Small params keep the suite fast; production uses ARGON2_DEFAULT (64 MiB, t=3).
const FAST = { m: 1024, t: 1, p: 1 };

describe('Argon2id (hash-wasm)', () => {
  it('matches the RFC 9106 §5.3 vector through an independent implementation, then pins hash-wasm', async () => {
    const nodeCrypto = await import('node:crypto');
    // Node's OpenSSL Argon2 reproduces the official RFC vector (with associated data)...
    const rfc = nodeCrypto.argon2Sync('argon2id', {
      message: Buffer.alloc(32, 1),
      nonce: Buffer.alloc(16, 2),
      secret: Buffer.alloc(8, 3),
      associatedData: Buffer.alloc(12, 4),
      parallelism: 4,
      tagLength: 32,
      memory: 32,
      passes: 3,
    });
    expect(rfc.toString('hex')).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
    // ...and hash-wasm (which has no AD input) must agree with it byte for byte on the app's parameter shape.
    const params = { password: 'password', salt: 'somesalt', iterations: 2, parallelism: 1, memorySize: 64, hashLength: 32 } as const;
    const ref = nodeCrypto.argon2Sync('argon2id', { message: Buffer.from('password'), nonce: Buffer.from('somesalt'), parallelism: 1, tagLength: 32, memory: 64, passes: 2 });
    expect(await argon2id({ ...params, outputType: 'hex' })).toBe(ref.toString('hex'));
    expect(ref.toString('hex')).toBe('16a1a498734609dd01456da406de9f3d9da93e6c86c300a12fc1465214ce4922');
  });

  it('is deterministic, salt- and password-sensitive, and zeroizes the password buffer', async () => {
    const salt = new Uint8Array(16).fill(7);
    const pw = te.encode('123456');
    const a = await argon2idRaw(pw, salt, FAST);
    expect(pw.every((b) => b === 0)).toBe(true);
    const b = await argon2idRaw(te.encode('123456'), salt, FAST);
    const c = await argon2idRaw(te.encode('123457'), salt, FAST);
    const d = await argon2idRaw(te.encode('123456'), new Uint8Array(16).fill(8), FAST);
    expect(a.length).toBe(32);
    expect(toHex(a)).toBe(toHex(b));
    expect(toHex(a)).not.toBe(toHex(c));
    expect(toHex(a)).not.toBe(toHex(d));
  });

  it('rejects short salts', async () => {
    await expect(argon2idRaw(te.encode('x'), new Uint8Array(8), FAST)).rejects.toThrow();
  });
});

describe('AES-256-GCM seal/open', () => {
  const key = () => importAesKey(randomBytes(32));

  it('round-trips with a fresh 96-bit nonce each time', async () => {
    const k = await key();
    const msg = te.encode('مانده: ۱۲,۴۵۰,۰۰۰ ریال');
    const a = await seal(k, msg);
    const b = await seal(k, msg);
    expect(td.decode(await open(k, a))).toBe('مانده: ۱۲,۴۵۰,۰۰۰ ریال');
    expect(toHex(a.slice(0, NONCE_LEN))).not.toBe(toHex(b.slice(0, NONCE_LEN)));
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('rejects every single-bit flip in nonce, ciphertext and tag', async () => {
    const k = await key();
    const sealed = await seal(k, te.encode('secret ledger row'));
    for (let byte = 0; byte < sealed.length; byte++) {
      const t = sealed.slice();
      t[byte]! ^= 0x01;
      await expect(open(k, t)).rejects.toThrow(/decryption failed/);
    }
  });

  it('rejects the wrong key, wrong AAD, truncation', async () => {
    const k = await key();
    const sealed = await seal(k, te.encode('x'), te.encode('accounts|a'));
    await expect(open(await key(), sealed, te.encode('accounts|a'))).rejects.toThrow();
    await expect(open(k, sealed, te.encode('accounts|b'))).rejects.toThrow();
    await expect(open(k, sealed)).rejects.toThrow();
    await expect(open(k, sealed.slice(0, 20))).rejects.toThrow();
  });

  it('imported keys are non-extractable and the raw bytes are zeroized', async () => {
    const raw = randomBytes(32);
    const k = await importAesKey(raw);
    expect(raw.every((b) => b === 0)).toBe(true);
    expect(k.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', k)).rejects.toThrow();
  });

  it('HKDF sub-keys are domain-separated', async () => {
    const ikm = randomBytes(32);
    const base = await importHkdfKey(ikm.slice());
    const k1 = await hkdfAesKey(base, 'arizo/record/v1');
    const k2 = await hkdfAesKey(base, 'arizo/blob/v1');
    const sealed = await seal(k1, te.encode('row'));
    await expect(open(k2, sealed)).rejects.toThrow();
    const again = await hkdfAesKey(await importHkdfKey(ikm), 'arizo/record/v1');
    expect(td.decode(await open(again, sealed))).toBe('row');
  });
});

describe('keyring: main + decoy slots', () => {
  it('creates, unlocks with the right PIN, rejects a wrong PIN', async () => {
    const { slot, keys } = await createSlot(te.encode('482913'), 'main', 'vault-main', FAST);
    const ring: Keyring = { v: 1, slots: [slot] };
    const sealed = await seal(keys.record, te.encode('hello'), recordAad('accounts', 'x'));
    const unlocked = await unlockKeyring(ring, te.encode('482913'));
    expect(unlocked?.vaultId).toBe('vault-main');
    expect(td.decode(await open(unlocked!.record, sealed, recordAad('accounts', 'x')))).toBe('hello');
    expect(await unlockKeyring(ring, te.encode('482914'))).toBeNull();
  });

  it('the decoy PIN opens a different vault whose keys cannot read the main vault', async () => {
    const main = await createSlot(te.encode('111111'), 'main', 'vault-main', FAST);
    const decoy = await createSlot(te.encode('999999'), 'decoy', 'vault-decoy', FAST);
    const ring: Keyring = { v: 1, slots: [main.slot, decoy.slot] };
    const secret = await seal(main.keys.record, te.encode('real net worth'), recordAad('accounts', 'a'));
    const d = await unlockKeyring(ring, te.encode('999999'));
    expect(d?.kind).toBe('decoy');
    expect(d?.vaultId).toBe('vault-decoy');
    await expect(open(d!.record, secret, recordAad('accounts', 'a'))).rejects.toThrow();
  });

  it('the wrapped DEK cannot be moved to another vault id (AAD binding)', async () => {
    const { slot } = await createSlot(te.encode('222222'), 'main', 'vault-a', FAST);
    const forged: Keyring = { v: 1, slots: [{ ...slot, vaultId: 'vault-b' }] };
    expect(await unlockKeyring(forged, te.encode('222222'))).toBeNull();
  });

  it('a tampered slot never unlocks', async () => {
    const { slot } = await createSlot(te.encode('333333'), 'main', 'v', FAST);
    const w = fromB64(slot.wrappedDekB64);
    w[w.length - 1]! ^= 0x80;
    expect(await unlockKeyring({ v: 1, slots: [{ ...slot, wrappedDekB64: toB64(w) }] }, te.encode('333333'))).toBeNull();
  });

  it('PIN change keeps the same DEK; the old PIN stops working', async () => {
    const { slot, keys } = await createSlot(te.encode('444444'), 'main', 'v', FAST);
    const sealed = await seal(keys.record, te.encode('persisted row'));
    const next = await rewrapSlot(slot, te.encode('444444'), te.encode('55555555'));
    expect(next.saltB64).not.toBe(slot.saltB64);
    const ring: Keyring = { v: 1, slots: [next] };
    expect(await unlockKeyring(ring, te.encode('444444'))).toBeNull();
    const k = await unlockKeyring(ring, te.encode('55555555'));
    expect(td.decode(await open(k!.record, sealed))).toBe('persisted row');
    await expect(rewrapSlot(slot, te.encode('000000'), te.encode('1'))).rejects.toThrow('BAD_PIN');
  });

  it('index tags are deterministic per vault and differ across vaults and fields', async () => {
    const a = await createSlot(te.encode('1'), 'main', 'a', FAST);
    const b = await createSlot(te.encode('1'), 'main', 'b', FAST);
    const t1 = await indexTag(a.keys, 'transactions', 'account_id', 'acc1');
    expect(await indexTag(a.keys, 'transactions', 'account_id', 'acc1')).toBe(t1);
    expect(await indexTag(b.keys, 'transactions', 'account_id', 'acc1')).not.toBe(t1);
    expect(await indexTag(a.keys, 'transactions', 'category_id', 'acc1')).not.toBe(t1);
  });

  it('all derived keys are non-extractable', async () => {
    const { keys } = await createSlot(te.encode('1'), 'main', 'a', FAST);
    for (const k of [keys.record, keys.blob, keys.index]) expect(k.extractable).toBe(false);
  });
});

describe('byte helpers', () => {
  it('zeroize, hex, base64, constant-time compare, sha256', async () => {
    const b = new Uint8Array([1, 2, 3]);
    zeroize(b);
    expect([...b]).toEqual([0, 0, 0]);
    expect(toHex(fromHex('00ff10'))).toBe('00ff10');
    expect(() => fromHex('zz')).toThrow();
    const big = randomBytes(100_000);
    expect(toHex(fromB64(toB64(big)))).toBe(toHex(big));
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
    expect(toHex(await sha256(te.encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect([...concatBytes(new Uint8Array([1]), new Uint8Array([2, 3]))]).toEqual([1, 2, 3]);
  });
});
