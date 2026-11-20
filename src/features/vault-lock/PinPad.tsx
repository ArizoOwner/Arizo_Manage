// Luxury tactile PIN pad. Digits are typed into a local buffer and handed to `onSubmit` as one string;
// the buffer is cleared right after. Physical keyboard digits work too (desktop / hardware keyboards).
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { localDigits } from '../../core/i18n/format';
import { haptic } from '../../core/motion/motion';
import { toAsciiDigits } from '../../core/utils/digits';

export const PIN_MIN = 6;
export const PIN_MAX = 8;

export interface PinPadProps {
  onSubmit: (pin: string) => void | Promise<void>;
  /** Shake and clear when this becomes a new non-null message. */
  error?: string | null;
  disabled?: boolean;
  /** Slot left of 0 (the biometric button on the lock screen). */
  extra?: ReactNode;
  submitLabel?: string;
}

export function PinPad({ onSubmit, error, disabled, extra, submitLabel }: PinPadProps) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const reduce = useReducedMotion();
  const shake = useAnimationControls();
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (!error) return;
    // No setPin('') here: submit() already emptied the pad. This effect runs after paint, so clearing
    // again wiped the first digits of the next try when the user typed straight after a wrong PIN.
    haptic.medium();
    if (!reduce) void shake.start({ x: [0, -12, 12, -8, 8, 0], transition: { duration: 0.4 } });
  }, [error, reduce, shake]);

  const submit = useCallback(() => {
    if (pin.length < PIN_MIN || disabled) return;
    const value = pin;
    setPin('');
    void onSubmit(value);
  }, [pin, disabled, onSubmit]);

  const press = useCallback(
    (d: string) => {
      if (disabled) return;
      haptic.tick();
      setPin((p) => (p.length >= PIN_MAX ? p : p + d));
    },
    [disabled],
  );

  // One listener for the pad's lifetime: re-adding it on every digit let fast typing on WebKit
  // land between remove and add, so digits were dropped.
  const keys = useRef({ press, submit });
  keys.current = { press, submit };
  // Layout effect: attached before the pad is painted, so the first keys after a reload are not lost.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const d = toAsciiDigits(e.key);
      if (/^[0-9]$/.test(d)) keys.current.press(d);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') keys.current.submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shown = Math.max(PIN_MIN, pin.length);
  return (
    <div className="flex w-full flex-col items-center gap-6" data-testid="pin-pad" data-busy={disabled ? 'true' : 'false'}>
      <motion.div
        animate={shake}
        className="flex gap-3"
        role="status"
        aria-live="polite"
        aria-label={t('lock.pinDots', { n: localDigits(pin.length, lang), max: localDigits(PIN_MAX, lang) })}
        data-testid="pin-dots"
        data-count={pin.length}
      >
        {Array.from({ length: shown }, (_, i) => (
          <span key={i} className={`h-3.5 w-3.5 rounded-full border transition-colors ${i < pin.length ? 'border-gold-mark bg-gold-mark' : 'border-specular bg-transparent'}`} />
        ))}
      </motion.div>
      {error && (
        <p role="alert" className="-mt-2 text-center text-[13px] font-semibold text-coral-text">
          {error}
        </p>
      )}
      {/* Phone keypads are laid out 1-2-3 left to right in every language. */}
      <div className="grid w-full max-w-[19rem] grid-cols-3 gap-3" dir="ltr">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} label={localDigits(d, lang)} onClick={() => press(d)} disabled={disabled} />
        ))}
        <div className="grid place-items-center">{extra}</div>
        <Key label={localDigits('0', lang)} onClick={() => press('0')} disabled={disabled} />
        <button
          type="button"
          aria-label={t('lock.backspace')}
          onClick={() => setPin((p) => p.slice(0, -1))}
          disabled={disabled || !pin}
          className="grid h-[4.5rem] place-items-center rounded-full text-2xl text-ink-2 disabled:opacity-30"
        >
          ⌫
        </button>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={disabled || pin.length < PIN_MIN}
        className="min-h-12 w-full max-w-[19rem] rounded-2xl bg-cta text-[16px] font-bold text-on-accent disabled:opacity-30"
        data-testid="pin-submit"
      >
        {submitLabel ?? t('lock.submit')}
      </button>
    </div>
  );
}

function Key({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean | undefined }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-[4.5rem] rounded-full border border-hairline bg-surface-2 text-[26px] font-bold text-ink shadow-[inset_0_1px_0_var(--arizo-border-highlight)] transition-transform active:scale-95 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-azure"
    >
      {label}
    </button>
  );
}

/** Reject trivially guessable PINs: all-same digits and straight ascending/descending runs. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const d = [...pin].map(Number);
  const step = d[1]! - d[0]!;
  return Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1]! === step);
}
