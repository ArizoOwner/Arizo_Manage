// ArizoOdometerAmount: each digit is a vertical strip that springs to its value (PROMPT.md §3.4 #1).
// Digits are keyed from the right so a growing number adds columns on the left without re-rolling
// the existing ones. Screen readers get the full formatted amount once, not the digit strips.
import { motion, useReducedMotion } from 'framer-motion';
import { useSettings } from '../../app/stores/settings';
import type { CurrencyCode } from '../currency/money';
import { formatMoney, moneyParts, type IrrUnit } from '../i18n/format';
import { SPRING, INSTANT } from './motion';
import { PrivacyBlur } from './PrivacyBlur';

const FA = '۰۱۲۳۴۵۶۷۸۹';

function DigitColumn({ digit, fa }: { digit: number; fa: boolean }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative inline-block h-[1em] overflow-hidden" style={{ width: '0.62em' }}>
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col items-center"
        initial={false}
        animate={{ y: `${-digit}em` }}
        transition={reduce ? INSTANT : SPRING.odometer}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="block h-[1em] leading-[1em]">
            {fa ? FA[i] : i}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

export interface OdometerProps {
  minor: bigint;
  currency: CurrencyCode;
  /** Defaults to the user's Toman/Rial preference. */
  irrUnit?: IrrUnit;
  className?: string;
  unitClassName?: string;
}

export function OdometerAmount({ minor, currency, irrUnit, className = '', unitClassName = '' }: OdometerProps) {
  const lang = useSettings((s) => s.lang);
  const prefUnit = useSettings((s) => s.irrUnit);
  const unit = irrUnit ?? prefUnit;
  const parts = moneyParts(minor, currency, lang, unit);
  const fa = lang === 'fa';
  const chars = [...parts.number];
  const n = chars.length;
  return (
    <PrivacyBlur>
      {/* Outer direction follows the language so the unit trails the number (left of it in RTL). */}
      <span className={`inline-flex items-baseline gap-[0.25em] whitespace-nowrap tabular ${className}`} dir={fa ? 'rtl' : 'ltr'}>
        <span className="sr-only">{formatMoney(minor, currency, lang, unit)}</span>
        <span aria-hidden="true" className="inline-flex items-baseline leading-none" dir="ltr">
          {parts.negative && <span>−</span>}
          {chars.map((ch, i) => {
            const d = fa ? FA.indexOf(ch) : ch >= '0' && ch <= '9' ? Number(ch) : -1;
            const key = `p${n - i}`; // position from the right
            return d >= 0 ? <DigitColumn key={key} digit={d} fa={fa} /> : <span key={key}>{ch}</span>;
          })}
        </span>
        <span aria-hidden="true" className={`text-[0.42em] font-semibold text-ink-2 ${unitClassName}`}>
          {parts.unit}
        </span>
      </span>
    </PrivacyBlur>
  );
}
