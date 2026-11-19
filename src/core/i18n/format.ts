// Locale-aware display of money and dates. Money input is always bigint minor units.
import { formatMinor, type CurrencyCode } from '../currency/money';
import { toPersianDigits } from '../utils/digits';
import { DEFAULT_TZ, monthName, toCalendarDate, type CalendarKind } from '../calendar/calendar';

export type Lang = 'fa' | 'en';
/** How IRR amounts are shown. Storage is always Rial. */
export type IrrUnit = 'toman' | 'rial';

const UNIT_LABEL: Record<Lang, Record<CurrencyCode | 'TOMAN', string>> = {
  fa: { IRR: 'ریال', TOMAN: 'تومان', USD: 'دلار', EUR: 'یورو', AED: 'درهم', GBP: 'پوند', USDT: 'تتر', GOLD_GRAM: 'گرم طلا', COIN: 'سکه' },
  en: { IRR: 'IRR', TOMAN: 'Toman', USD: 'USD', EUR: 'EUR', AED: 'AED', GBP: 'GBP', USDT: 'USDT', GOLD_GRAM: 'g gold', COIN: 'coin' },
};

export interface MoneyParts {
  /** Grouped digits, localized (Persian digits and separators in fa). Sign excluded. */
  number: string;
  unit: string;
  negative: boolean;
}

/** Split for rendering: odometer digits and the unit label separately. */
export function moneyParts(minor: bigint, currency: CurrencyCode, lang: Lang, irrUnit: IrrUnit = 'toman'): MoneyParts {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  let text: string;
  let unit: string;
  if (currency === 'IRR' && irrUnit === 'toman') {
    // A Rial remainder shows as one decimal digit, so the Toman view never hides money.
    const r = abs % 10n;
    text = formatMinor(abs / 10n, 'IRR') + (r ? `.${r}` : '');
    unit = UNIT_LABEL[lang].TOMAN;
  } else {
    text = formatMinor(abs, currency);
    unit = UNIT_LABEL[lang][currency];
  }
  if (lang === 'fa') text = toPersianDigits(text).replace(/,/g, '٬').replace('.', '٫');
  return { number: text, unit, negative };
}

export function formatMoney(minor: bigint, currency: CurrencyCode, lang: Lang, irrUnit: IrrUnit = 'toman'): string {
  const p = moneyParts(minor, currency, lang, irrUnit);
  const sign = p.negative ? (lang === 'fa' ? '−' : '-') : '';
  return `${sign}${p.number} ${p.unit}`;
}

export const localDigits = (s: string | number, lang: Lang): string => (lang === 'fa' ? toPersianDigits(String(s)) : String(s));

export function formatDate(ms: number, cal: CalendarKind, lang: Lang, opts: { withYear?: boolean; tz?: string } = {}): string {
  const d = toCalendarDate(ms, cal, opts.tz ?? DEFAULT_TZ);
  return localDigits(`${d.d} ${monthName(cal, d.m, lang)}${opts.withYear === false ? '' : ` ${d.y}`}`, lang);
}
