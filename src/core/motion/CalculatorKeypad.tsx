// TactileCalculatorKeypad: + − × ÷, a dedicated 000 key, live Persian amount-in-words (PROMPT.md §3.3, §7.4).
// The keypad edits in the DISPLAY unit (Toman or Rial for IRR) and reports exact Rial minor units.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { emptyCalc, evaluate, expressionText, fromValue, hasOperator, press, type CalcState, type Key } from '../currency/calculator';
import { MINOR_DIGITS, type CurrencyCode } from '../currency/money';
import { amountToPersianWords } from '../currency/numToPersianWords';
import { formatMoney, localDigits } from '../i18n/format';
import { haptic } from './motion';

const ROWS: Key[][] = [
  ['7', '8', '9', '/'],
  ['4', '5', '6', '*'],
  ['1', '2', '3', '-'],
  ['000', '0', '.', '+'],
];
const GLYPH: Partial<Record<Key, string>> = { '/': '÷', '*': '×', '-': '−', '+': '+' };

export interface KeypadProps {
  currency: CurrencyCode;
  /** Initial value in minor units of `currency` (Rial for IRR). */
  initialMinor?: bigint;
  onDone: (minor: bigint) => void;
}

export function CalculatorKeypad({ currency, initialMinor = 0n, onDone }: KeypadProps) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  // Display unit: IRR in Toman multiplies by 10 back to Rial; everything else is 1:1.
  const toman = currency === 'IRR' && irrUnit === 'toman';
  const decimals = currency === 'IRR' ? 0 : MINOR_DIGITS[currency];
  const [calc, setCalc] = useState<CalcState>(() => (initialMinor ? fromValue(toman ? initialMinor / 10n : initialMinor, decimals) : emptyCalc()));

  const result = useMemo(() => evaluate(calc, decimals), [calc, decimals]);
  const minor = result.ok ? (toman ? result.value * 10n : result.value) : 0n;

  const tap = (k: Key) => {
    haptic.tick();
    setCalc((s) => press(s, k, decimals));
  };

  const words = result.ok && currency === 'IRR' && result.value > 0n ? amountToPersianWords(minor, toman ? 'toman' : 'rial') : '';
  const error = !result.ok && result.error !== 'empty' ? t(result.error === 'div_by_zero' ? 'keypad.divByZero' : 'keypad.overflow') : '';

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-hairline bg-surface-2 px-4 py-3">
        <div className="min-h-5 text-end text-[13px] text-ink-2 tabular" dir="ltr" data-testid="keypad-expr">
          {hasOperator(calc) ? localDigits(expressionText(calc), lang) : ' '}
        </div>
        <output className="block text-end text-[clamp(1.75rem,8vw,2.4rem)] font-extrabold leading-tight text-ink tabular" dir="ltr" data-testid="keypad-value">
          {formatMoney(minor, currency, lang, irrUnit)}
        </output>
        <div className="mt-1 min-h-5 text-[13px] leading-6 text-gold-text" dir="rtl" lang="fa" aria-live="polite" data-testid="keypad-words">
          {error ? <span className="text-coral-text">{error}</span> : words}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label={t('keypad.inWords')}>
        {ROWS.flat().map((k) => {
          const isOp = k in GLYPH;
          const disabled = k === '.' && decimals === 0;
          return (
            <button
              key={k}
              type="button"
              disabled={disabled}
              onClick={() => tap(k)}
              className={`h-14 rounded-2xl text-xl font-bold tabular transition-transform active:scale-95 disabled:opacity-30 ${isOp ? 'bg-surface-2 text-azure-text' : 'bg-surface-3 text-ink'}`}
            >
              {GLYPH[k] ?? localDigits(k === '.' ? (lang === 'fa' ? '٫' : '.') : k, lang)}
            </button>
          );
        })}
        <button type="button" onClick={() => tap('clear')} className="h-14 rounded-2xl bg-surface-2 text-[15px] font-semibold text-coral-text active:scale-95">
          {t('keypad.clear')}
        </button>
        <button type="button" onClick={() => tap('back')} aria-label={t('keypad.backspace')} className="h-14 rounded-2xl bg-surface-2 text-xl text-ink active:scale-95">
          ⌫
        </button>
        <button
          type="button"
          disabled={!result.ok || minor === 0n}
          onClick={() => {
            haptic.medium();
            onDone(minor);
          }}
          className="col-span-2 h-14 rounded-2xl bg-cta text-[16px] font-bold text-on-accent active:scale-[0.98] disabled:opacity-40"
        >
          {t('keypad.done')}
        </button>
      </div>
    </div>
  );
}
