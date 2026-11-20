// Single entry point for creating, unlocking and locking the vault on both platforms.
// Android: PIN → Argon2id KEK (JS worker) → native unwraps the DEK → SQLCipher opens. JS never holds the DEK.
// iOS/web: PIN → keyring in the crypto worker → non-extractable CryptoKeys → encrypted Dexie.
import { terminateSmsWorker } from '../sms/smsClient';
import { terminateAnalyticsWorker } from '../analytics/analyticsClient';
import { terminateXlsxWorker } from '../exports/xlsxClient';
import { fromB64, randomBytes, toB64, zeroize } from '../crypto/bytes';
import { cryptoClient } from '../crypto/cryptoClient';
import type { Keyring, SlotKind } from '../crypto/keyring';
import { ARGON2_DEFAULT, type Argon2Params } from '../crypto/primitives';
import { ArizoSecurity, ArizoSqlCipher, isNative, sqlCipherExecutor } from '../bridge/native';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import { SqlVaultAdapter } from '../storage/SqlVaultAdapter';
import { WebEncryptedDexieAdapter } from '../storage/WebEncryptedDexieAdapter';
import { seedCategories } from '../data/seedCategories';
import { uuidv7 } from '../utils/uuidv7';
import { enrolPasskey, evaluatePrf } from './webauthn';

/** Metadata needed before unlock. Holds no secret: salts, params and ciphertext only. */
interface VaultMeta {
  v: 1;
  platform: 'android' | 'web';
  /** Web: the full keyring (wrapped DEKs, including the optional decoy and passkey slots). */
  ring?: Keyring;
  /** Android: Argon2 salt/params for the PIN KEK. The wrapped DEK lives in native app-private files. */
  android?: { saltB64: string; params: Argon2Params; vaultId: string };
}

const META_KEY = 'arizo.vault.meta.v1';

function readMeta(): VaultMeta | null {
  const raw = localStorage.getItem(META_KEY);
  return raw ? (JSON.parse(raw) as VaultMeta) : null;
}
const writeMeta = (m: VaultMeta) => localStorage.setItem(META_KEY, JSON.stringify(m));

export interface OpenVault {
  db: IVaultDatabase;
  vaultId: string;
  kind: SlotKind;
}

async function kekFor(pin: string, saltB64: string, params: Argon2Params): Promise<string> {
  const kek = await cryptoClient.argon2(pin, fromB64(saltB64), params);
  try {
    return toB64(kek);
  } finally {
    zeroize(kek);
  }
}

const code = (e: unknown) => (e as { code?: string }).code;
let params: Argon2Params = ARGON2_DEFAULT;

export const vaultService = {
  /** Tests only: cheaper Argon2 so E2E runs in seconds. Production always uses ARGON2_DEFAULT. */
  useArgonParamsForTesting(p: Argon2Params) {
    params = p;
  },

  isInitialized(): boolean {
    return readMeta() !== null;
  },

  platform(): 'android' | 'web' {
    return isNative() ? 'android' : 'web';
  },

  hasDecoy(): boolean {
    return !!readMeta()?.ring?.slots.some((s) => s.kind === 'decoy');
  },

  /** Web passkey slot (Face ID / Touch ID with PRF). */
  passkeySlot() {
    return readMeta()?.ring?.slots.find((s) => s.method === 'prf');
  },

  /** First run: create the main vault with `pin`, seed categories, return it open. */
  async create(pin: string): Promise<OpenVault> {
    if (readMeta()) throw new Error('VAULT_EXISTS');
    const vaultId = uuidv7();
    if (isNative()) {
      const saltB64 = toB64(randomBytes(16));
      await ArizoSecurity.createVault({ kekB64: await kekFor(pin, saltB64, params), vaultId });
      writeMeta({ v: 1, platform: 'android', android: { saltB64, params, vaultId } });
      const open = await this.openNative(vaultId);
      await seedCategories(open.db);
      return open;
    }
    const { slot, keys } = await cryptoClient.createSlot(pin, 'main', vaultId, params);
    writeMeta({ v: 1, platform: 'web', ring: { v: 1, slots: [slot] } });
    await navigator.storage?.persist?.();
    const db = new WebEncryptedDexieAdapter(keys);
    await seedCategories(db);
    return { db, vaultId, kind: 'main' };
  },

  /** Add or replace the decoy PIN. It opens a separate, believable vault (PROMPT.md §5.2). */
  async setDecoy(pin: string): Promise<OpenVault> {
    const meta = readMeta();
    // shortcut: on Android the decoy needs a second native key slot and DB file; until then the
    // option is hidden there (Settings checks platform()). Upgrade with a native slot API.
    if (!meta?.ring) throw new Error('DECOY_WEB_ONLY');
    const vaultId = uuidv7();
    const { slot, keys } = await cryptoClient.createSlot(pin, 'decoy', vaultId, params);
    for (const old of meta.ring.slots.filter((s) => s.kind === 'decoy')) await WebEncryptedDexieAdapter.destroy(old.vaultId);
    writeMeta({ ...meta, ring: { v: 1, slots: [...meta.ring.slots.filter((s) => s.kind !== 'decoy'), slot] } });
    const db = new WebEncryptedDexieAdapter(keys);
    await seedCategories(db);
    return { db, vaultId, kind: 'decoy' };
  },

  async removeDecoy(): Promise<void> {
    const meta = readMeta();
    if (!meta?.ring) return;
    for (const s of meta.ring.slots.filter((x) => x.kind === 'decoy')) await WebEncryptedDexieAdapter.destroy(s.vaultId);
    writeMeta({ ...meta, ring: { v: 1, slots: meta.ring.slots.filter((s) => s.kind !== 'decoy') } });
  },

  /** PIN unlock. Resolves null on a wrong PIN (the lockout policy counts it). */
  async unlockWithPin(pin: string): Promise<OpenVault | null> {
    const meta = readMeta();
    if (!meta) throw new Error('NO_VAULT');
    if (meta.platform === 'android' && meta.android) {
      try {
        const { vaultId } = await ArizoSecurity.unlockWithKek({ kekB64: await kekFor(pin, meta.android.saltB64, meta.android.params) });
        return await this.openNative(vaultId);
      } catch (e) {
        if (code(e) === 'BAD_PIN') return null;
        throw e;
      }
    }
    const keys = await cryptoClient.unlock(meta.ring!, pin);
    return keys ? { db: new WebEncryptedDexieAdapter(keys), vaultId: keys.vaultId, kind: keys.kind } : null;
  },

  /** Check a PIN for re-authentication without opening anything new. Main PIN only. */
  async verifyPin(pin: string, forBiometric = false): Promise<boolean> {
    const meta = readMeta();
    if (!meta) return false;
    if (meta.platform === 'android' && meta.android) {
      // Checks the KEK natively without re-opening the DB or leaving a DEK copy behind.
      try {
        await ArizoSecurity.verifyKek({ kekB64: await kekFor(pin, meta.android.saltB64, meta.android.params), forBiometric });
        return true;
      } catch {
        return false;
      }
    }
    const main = { v: 1 as const, slots: meta.ring!.slots.filter((s) => s.kind === 'main' && s.method !== 'prf') };
    return (await cryptoClient.unlock(main, pin)) !== null;
  },

  /** Biometric unlock: Android BIOMETRIC_STRONG, or a web passkey with PRF. Null when cancelled. */
  async unlockWithBiometric(): Promise<OpenVault | null> {
    if (isNative()) {
      try {
        const { vaultId } = await ArizoSecurity.unlockWithBiometric();
        return await this.openNative(vaultId);
      } catch (e) {
        if (code(e) === 'BIO_CANCELLED') return null;
        throw e;
      }
    }
    const slot = this.passkeySlot();
    if (!slot?.credentialIdB64) return null;
    const prf = await evaluatePrf(slot.credentialIdB64);
    if (!prf) return null;
    const keys = await cryptoClient.unlockPrf(slot, prf);
    return keys ? { db: new WebEncryptedDexieAdapter(keys), vaultId: keys.vaultId, kind: keys.kind } : null;
  },

  /** Enrol biometrics. Android: right after an unlock. Web: needs the PIN to unwrap the DEK once. */
  async enableBiometric(pin: string): Promise<'enabled' | 'unsupported' | 'bad_pin'> {
    if (isNative()) {
      if (!(await this.verifyPin(pin, true))) return 'bad_pin';
      await ArizoSecurity.enableBiometric();
      return 'enabled';
    }
    const meta = readMeta();
    if (!meta?.ring) return 'unsupported';
    const reg = await enrolPasskey('Arizo');
    if (!reg) return 'unsupported';
    try {
      const slot = await cryptoClient.addPrf(meta.ring, pin, reg.prf, reg.credentialIdB64);
      writeMeta({ ...meta, ring: { v: 1, slots: [...meta.ring.slots.filter((s) => s.method !== 'prf'), slot] } });
      return 'enabled';
    } catch (e) {
      if (e instanceof Error && e.message === 'BAD_PIN') return 'bad_pin';
      throw e;
    }
  },

  async disableBiometric(): Promise<void> {
    const meta = readMeta();
    if (meta?.ring) writeMeta({ ...meta, ring: { v: 1, slots: meta.ring.slots.filter((s) => s.method !== 'prf') } });
  },

  async biometricStatus(): Promise<{ available: boolean; enrolled: boolean }> {
    if (isNative()) {
      const s = await ArizoSecurity.status();
      return { available: s.biometricAvailable, enrolled: s.biometricEnrolled };
    }
    const { isPlatformAuthenticatorAvailable } = await import('./webauthn');
    return { available: await isPlatformAuthenticatorAvailable(), enrolled: !!this.passkeySlot() };
  },

  async openNative(vaultId: string): Promise<OpenVault> {
    const { cipherVersion } = await ArizoSqlCipher.open({ vaultId });
    if (cipherVersion === '') throw new Error('SQLCIPHER_INACTIVE');
    return { db: await SqlVaultAdapter.open(sqlCipherExecutor(), 'android-sqlcipher'), vaultId, kind: 'main' };
  },

  /** Lock: close the DB, drop native key material, kill the crypto worker heap. */
  async lock(open: OpenVault | null): Promise<void> {
    await open?.db.close();
    if (isNative()) await ArizoSecurity.lock();
    cryptoClient.terminate();
    terminateSmsWorker();
    terminateAnalyticsWorker();
    terminateXlsxWorker();
  },

  /** PIN change for the main vault. Resolves false on a wrong old PIN. A passkey slot stays valid (same DEK). */
  async changePin(oldPin: string, newPin: string): Promise<boolean> {
    const meta = readMeta();
    if (!meta) throw new Error('NO_VAULT');
    if (meta.platform === 'android' && meta.android) {
      const saltB64 = toB64(randomBytes(16));
      try {
        await ArizoSecurity.rewrapPin({
          oldKekB64: await kekFor(oldPin, meta.android.saltB64, meta.android.params),
          newKekB64: await kekFor(newPin, saltB64, meta.android.params),
        });
      } catch (e) {
        if (code(e) === 'BAD_PIN') return false;
        throw e;
      }
      writeMeta({ ...meta, android: { ...meta.android, saltB64 } });
      return true;
    }
    const slot = meta.ring!.slots.find((s) => s.kind === 'main' && s.method !== 'prf')!;
    try {
      const next = await cryptoClient.rewrap(slot, oldPin, newPin);
      writeMeta({ ...meta, ring: { v: 1, slots: meta.ring!.slots.map((s) => (s === slot ? next : s)) } });
      return true;
    } catch (e) {
      if (e instanceof Error && e.message === 'BAD_PIN') return false;
      throw e;
    }
  },

  /** Wipe All Data: delete every vault database and every wrapped key. Irreversible. */
  async wipeAll(open: OpenVault | null): Promise<void> {
    const meta = readMeta();
    await open?.db.close();
    if (meta?.platform === 'android' && meta.android) {
      await ArizoSqlCipher.destroy({ vaultId: meta.android.vaultId });
      await ArizoSecurity.destroyVault();
    }
    for (const id of new Set((meta?.ring?.slots ?? []).map((s) => s.vaultId))) await WebEncryptedDexieAdapter.destroy(id);
    localStorage.removeItem(META_KEY);
    cryptoClient.terminate();
    terminateAnalyticsWorker();
    terminateXlsxWorker();
  },
};
