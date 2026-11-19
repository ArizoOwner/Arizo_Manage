// Open-vault session state. The DB handle and keys live only in memory and are dropped on lock.
// `rev` bumps on every write so screens re-query; the DB is the single source of truth.
import { create } from 'zustand';
import type { IVaultDatabase } from '../../core/storage/IVaultDatabase';
import { vaultService, type OpenVault } from '../../core/security/vaultService';
import { LOCKOUT_INITIAL, registerFailure, registerSuccess, remainingLockMs, type LockoutState } from '../../core/security/lockout';
import { purgeTrash } from '../../core/ledger/ledger';
import { runDueRecurring } from '../../core/ledger/recurring';

const LOCKOUT_KEY = 'arizo.lockout.v1';
const AUTOLOCK_KEY = 'arizo.autolock.v1';
const WIPE_KEY = 'arizo.wipeOnFailures.v1';

export type AutoLock = 0 | 15_000 | 60_000 | 300_000;

const readLockout = (): LockoutState => {
  try {
    return { ...LOCKOUT_INITIAL, ...(JSON.parse(localStorage.getItem(LOCKOUT_KEY) ?? '{}') as Partial<LockoutState>) };
  } catch {
    return LOCKOUT_INITIAL;
  }
};

export interface VaultState {
  open: OpenVault | null;
  initialized: boolean;
  lockout: LockoutState;
  autoLockMs: AutoLock;
  wipeOnFailures: boolean;
  /** Bumped after every committed write; components depend on it to refetch. */
  rev: number;
  /** Re-auth grants expire after 60 s (reveal card, export, security settings). */
  reauthUntil: number;
  /** Set true by the privacy curtain while the app is backgrounded. */
  curtain: boolean;

  db(): IVaultDatabase;
  bump(): void;
  attemptPin(pin: string): Promise<'ok' | 'bad' | 'locked' | 'wiped'>;
  attemptBiometric(): Promise<boolean>;
  setOpen(open: OpenVault): Promise<void>;
  lock(): Promise<void>;
  reauthOk(): boolean;
  grantReauth(): void;
  setAutoLock(ms: AutoLock): void;
  setWipeOnFailures(on: boolean): void;
  setCurtain(on: boolean): void;
  refreshInitialized(): void;
}

export const useVault = create<VaultState>((set, get) => ({
  open: null,
  initialized: vaultService.isInitialized(),
  lockout: readLockout(),
  autoLockMs: (localStorage.getItem(AUTOLOCK_KEY) === null ? 60_000 : Number(localStorage.getItem(AUTOLOCK_KEY))) as AutoLock,
  wipeOnFailures: localStorage.getItem(WIPE_KEY) === '1',
  rev: 0,
  reauthUntil: 0,
  curtain: false,

  db() {
    const o = get().open;
    if (!o) throw new Error('vault is locked');
    return o.db;
  },
  bump: () => set((s) => ({ rev: s.rev + 1 })),

  async attemptPin(pin) {
    const now = Date.now();
    if (remainingLockMs(get().lockout, now) > 0) return 'locked';
    const open = await vaultService.unlockWithPin(pin);
    if (!open) {
      const { state, wipe } = registerFailure(get().lockout, now, get().wipeOnFailures);
      localStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
      set({ lockout: state });
      if (wipe) {
        await vaultService.wipeAll(null);
        localStorage.removeItem(LOCKOUT_KEY);
        set({ lockout: LOCKOUT_INITIAL, initialized: false });
        return 'wiped';
      }
      return 'bad';
    }
    await get().setOpen(open);
    return 'ok';
  },

  async attemptBiometric() {
    const open = await vaultService.unlockWithBiometric();
    if (!open) return false;
    await get().setOpen(open);
    return true;
  },

  async setOpen(open) {
    const s = registerSuccess();
    localStorage.setItem(LOCKOUT_KEY, JSON.stringify(s));
    // Housekeeping on every unlock: due recurring items and the 30-day Trash purge.
    await runDueRecurring(open.db).catch(() => 0);
    await purgeTrash(open.db).catch(() => 0);
    set({ open, lockout: s, initialized: true, reauthUntil: Date.now() + 60_000, rev: get().rev + 1 });
  },

  async lock() {
    const open = get().open;
    set({ open: null, reauthUntil: 0 });
    await vaultService.lock(open);
  },

  reauthOk: () => get().reauthUntil > Date.now(),
  grantReauth: () => set({ reauthUntil: Date.now() + 60_000 }),
  setAutoLock(ms) {
    localStorage.setItem(AUTOLOCK_KEY, String(ms));
    set({ autoLockMs: ms });
  },
  setWipeOnFailures(on) {
    localStorage.setItem(WIPE_KEY, on ? '1' : '0');
    set({ wipeOnFailures: on });
  },
  setCurtain: (on) => set({ curtain: on }),
  refreshInitialized: () => set({ initialized: vaultService.isInitialized() }),
}));

/** Run a write against the open vault, then notify subscribers. */
export async function mutate<T>(fn: (db: IVaultDatabase) => Promise<T>): Promise<T> {
  const v = useVault.getState();
  const out = await fn(v.db());
  v.bump();
  return out;
}
