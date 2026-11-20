// Obsidian vault gate (PROMPT.md §7 #1): biometric prompt on open, PIN pad, exponential lockout.
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
        <div className="grid h-16 w-16 place-items-center rounded-3xl border border-specular bg-surface-2 text-gold-mark shadow-[0_0_40px_-10px_var(--arizo-accent-luxury)]">
          <Icon d={ICONS.lock} className="h-8 w-8" />
        </div>
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
