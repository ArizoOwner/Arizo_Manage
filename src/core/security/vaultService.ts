// Single entry point for creating, unlocking and locking the vault on both platforms.
// Android: PIN → Argon2id KEK (JS worker) → native unwraps the DEK → SQLCipher opens. JS never holds the DEK.
// iOS/web: PIN → keyring in the crypto worker → non-extractable CryptoKeys → encrypted Dexie.
import { fromB64, randomBytes, toB64, zeroize } from '../crypto/bytes';
import { cryptoClient } from '../crypto/cryptoClient';
import type { Keyring, KeySlot, SlotKind } from '../crypto/keyring';
import { ARGON2_DEFAULT, type Argon2Params } from '../crypto/primitives';
import { ArizoSecurity, ArizoSqlCipher, isNative, sqlCipherExecutor } from '../bridge/native';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import { SqlVaultAdapter } from '../storage/SqlVaultAdapter';
import { WebEncryptedDexieAdapter } from '../storage/WebEncryptedDexieAdapter';
import { seedCategories } from '../data/seedCategories';
import { uuidv7 } from '../utils/uuidv7';

/** Metadata needed before unlock. Holds no secret: salts, params and ciphertext only. */
interface VaultMeta {
  v: 1;
  platform: 'android' | 'web';
  /** Web: the full keyring (wrapped DEKs). */
  ring?: Keyring;
  /** Android: the Argon2 salt/params for the PIN KEK. The wrapped DEK lives in native app-private files. */
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

export const vaultService = {
  isInitialized(): boolean {
    return readMeta() !== null;
  },

  /** First run: create the main vault with `pin`, seed categories, return it open. */
  async create(pin: string, params: Argon2Params = ARGON2_DEFAULT): Promise<OpenVault> {
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

  /** Web: add a decoy PIN that opens a separate, believable vault (PROMPT.md §5.2). */
  async addDecoy(pin: string, params: Argon2Params = ARGON2_DEFAULT): Promise<OpenVault> {
    const meta = readMeta();
    // shortcut: Android decoy needs a second native slot + DB file; lands with the Phase 3 duress flow.
    if (!meta?.ring) throw new Error('DECOY_NOT_SUPPORTED_ON_THIS_PLATFORM_YET');
    const vaultId = uuidv7();
    const { slot, keys } = await cryptoClient.createSlot(pin, 'decoy', vaultId, params);
    const slots: KeySlot[] = [...meta.ring.slots.filter((s) => s.kind !== 'decoy'), slot];
    writeMeta({ ...meta, ring: { v: 1, slots } });
    const db = new WebEncryptedDexieAdapter(keys);
    await seedCategories(db);
    return { db, vaultId, kind: 'decoy' };
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

  /** Android BIOMETRIC_STRONG unlock. Errors carry code BIO_INVALIDATED / BIO_CANCELLED for the UI. */
  async unlockWithBiometric(): Promise<OpenVault> {
    const { vaultId } = await ArizoSecurity.unlockWithBiometric();
    return this.openNative(vaultId);
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
  },

  /** PIN change for the main vault. Resolves false on a wrong old PIN. */
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
    const slot = meta.ring!.slots.find((s) => s.kind === 'main')!;
    try {
      const next = await cryptoClient.rewrap(slot, oldPin, newPin);
      writeMeta({ ...meta, ring: { v: 1, slots: meta.ring!.slots.map((s) => (s.kind === 'main' ? next : s)) } });
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
    for (const s of meta?.ring?.slots ?? []) await WebEncryptedDexieAdapter.destroy(s.vaultId);
    localStorage.removeItem(META_KEY);
    cryptoClient.terminate();
  },
};
