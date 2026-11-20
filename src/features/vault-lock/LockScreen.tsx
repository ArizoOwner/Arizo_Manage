// Obsidian vault gate (PROMPT.md §7 #1): biometric prompt on open, PIN pad, exponential lockout.
import { motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { useVault } from '../../app/stores/vault';
import { localDigits } from '../../core/i18n/format';
import { remainingLockMs } from '../../core/security/lockout';
import { vaultService } from '../../core/security/vaultService';
import { Icon, ICONS } from '../../core/ui/ui';
import { PinPad } from './PinPad';

export function LockScreen() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const lockout = useVault((s) => s.lockout);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [bio, setBio] = useState(false);
  const remaining = remainingLockMs(lockout, now);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (remaining <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [remaining]);

  const tryBiometric = useCallback(async () => {
    setBusy(true);
    try {
      await useVault.getState().attemptBiometric();
    } catch {
      // BIO_INVALIDATED (new enrolment) or hardware error: fall back to the PIN silently.
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void vaultService.biometricStatus().then((s) => {
      setBio(s.enrolled);
      if (s.enrolled) void tryBiometric();
    }, () => setBio(false));
  }, [tryBiometric]);

  const submit = async (pin: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await useVault.getState().attemptPin(pin);
      if (res === 'bad') setError(t('lock.wrong'));
      else if (res === 'locked') setError(t('lock.lockedFor', { s: localDigits(Math.ceil(remainingLockMs(useVault.getState().lockout, Date.now()) / 1000), lang) }));
      else if (res === 'wiped') setError(t('lock.wiped'));
      setNow(Date.now());
    } catch {
      // A native or storage failure must never look like a frozen pad (device report after Phase 9).
      setError(t('lock.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-8 px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex flex-col items-center gap-3 text-center">
        <motion.div
          className="relative grid h-20 w-20 place-items-center"
          initial={reduce ? false : { scale: 0.6, opacity: 0, rotate: -20 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        >
          {/* A slow orbit around the vault; it spins fast while the PIN is being checked. */}
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-[28px] bg-[conic-gradient(from_0deg,transparent_0deg,var(--arizo-accent-luxury)_70deg,transparent_140deg,transparent_360deg)] p-[1.5px] ${reduce ? '' : busy ? 'animate-[spin_0.9s_linear_infinite]' : 'animate-[spin_6s_linear_infinite]'}`}
          >
            <span className="block h-full w-full rounded-[27px] bg-canvas" />
          </span>
          <span className="relative grid h-[4.6rem] w-[4.6rem] place-items-center rounded-[26px] border border-specular bg-surface-2 text-gold-mark shadow-[0_0_44px_-8px_var(--arizo-accent-luxury)]">
            <Icon d={ICONS.lock} className="h-9 w-9" />
          </span>
        </motion.div>
        <h1 className="text-[22px] font-extrabold">{t('lock.title')}</h1>
        <p className="text-[14px] text-ink-2">{busy ? t('lock.unlocking') : t('lock.enterPin')}</p>
      </div>
      {remaining > 0 && (
        <p role="alert" className="rounded-2xl bg-surface-2 px-4 py-2 text-[13px] font-semibold text-amber-text" data-testid="lockout">
          {t('lock.lockedFor', { s: localDigits(Math.ceil(remaining / 1000), lang) })}
        </p>
      )}
      <PinPad
        onSubmit={submit}
        error={error}
        disabled={busy || remaining > 0}
        working={busy}
        extra={
          bio ? (
            <button type="button" onClick={() => void tryBiometric()} aria-label={t('lock.biometric')} className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full text-emerald-text">
              <Icon d={ICONS.fingerprint} className="h-8 w-8" />
            </button>
          ) : null
        }
      />
    </main>
  );
}
