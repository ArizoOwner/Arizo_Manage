// Exact money: integer minor units as bigint. Never a float anywhere in this module.
export type CurrencyCode = 'IRR' | 'USD' | 'EUR' | 'AED' | 'GBP' | 'USDT' | 'GOLD_GRAM' | 'COIN';

export const CURRENCIES: readonly CurrencyCode[] = ['IRR', 'USD', 'EUR', 'AED', 'GBP', 'USDT', 'GOLD_GRAM', 'COIN'];

/** Decimal places in one major unit. IRR minor = 1 Rial; GOLD_GRAM minor = 1 mg; COIN = whole coins. */
export const MINOR_DIGITS: Record<CurrencyCode, number> = {
  IRR: 0,
  USD: 2,
  EUR: 2,
  AED: 2,
  GBP: 2,
  USDT: 6,
  GOLD_GRAM: 3,
  COIN: 0,
};

export const RIAL_PER_TOMAN = 10n;

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Parse a user-typed decimal ("1,250.5", "۱۲۵۰") into minor units. Rejects excess precision. */
export function parseMajor(input: string, currency: CurrencyCode): bigint {
  const digits = MINOR_DIGITS[currency];
  const s = input
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[,٬\s]/g, '')
    .replace('٫', '.');
  const m = /^(-)?(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new RangeError('invalid amount');
  const frac = m[3] ?? '';
  if (frac.replace(/0+$/, '').length > digits) throw new RangeError('too many decimal places');
  const minor = BigInt(m[2]! + frac.padEnd(digits, '0').slice(0, digits));
  return m[1] ? -minor : minor;
}

/** Format minor units as a grouped decimal string with ASCII digits. */
export function formatMinor(minor: bigint, currency: CurrencyCode, group = ','): string {
  const digits = MINOR_DIGITS[currency];
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const base = 10n ** BigInt(digits);
  const int = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const frac = digits ? '.' + (abs % base).toString().padStart(digits, '0') : '';
  return (neg ? '-' : '') + int + frac;
}

export const tomanToRial = (toman: bigint): bigint => toman * RIAL_PER_TOMAN;

/** Half-up (away from zero) rounding of a/b. */
export function divRoundHalfUp(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError('division by zero');
  const neg = a < 0n !== b < 0n;
  const aa = a < 0n ? -a : a;
  const bb = b < 0n ? -b : b;
  const q = (aa * 2n + bb) / (bb * 2n);
  return neg ? -q : q;
}

/** Percentage in basis points (1% = 100 bps), rounded half-up. */
export const applyBps = (minor: bigint, bps: bigint): bigint => divRoundHalfUp(minor * bps, 10_000n);

/** Rate as parts-per-million: quote = base * rate_ppm / 1e6. */
export const convertPpm = (minor: bigint, ratePpm: bigint): bigint => divRoundHalfUp(minor * ratePpm, 1_000_000n);

/** Split total into n parts summing exactly to total; remainder goes to the first parts. */
export function allocateEvenly(total: bigint, n: number): bigint[] {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError('n must be a positive integer');
  const N = BigInt(n);
  const base = total / N;
  let rem = total - base * N;
  const step = rem < 0n ? -1n : 1n;
  return Array.from({ length: n }, () => {
    if (rem === 0n) return base;
    rem -= step;
    return base + step;
  });
}

export const sumMinor = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);
