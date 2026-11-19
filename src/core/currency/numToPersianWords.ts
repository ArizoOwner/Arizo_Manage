// Integer to Persian words, up to the quadrillions.
const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'یکصد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون', 'کوادریلیون'];
const AND = ' و ';

function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(HUNDREDS[h]!);
  if (r >= 10 && r < 20) parts.push(TEENS[r - 10]!);
  else {
    if (r >= 20) parts.push(TENS[Math.floor(r / 10)]!);
    if (r % 10) parts.push(ONES[r % 10]!);
  }
  return parts.join(AND);
}

export function numToPersianWords(value: bigint | number): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new RangeError('unsafe integer');
  let n = BigInt(value);
  if (n === 0n) return 'صفر';
  const neg = n < 0n;
  if (neg) n = -n;
  const groups: number[] = [];
  while (n > 0n) {
    groups.push(Number(n % 1000n));
    n /= 1000n;
  }
  if (groups.length > SCALES.length) throw new RangeError('number too large');
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (!g) continue;
    // Persian says «هزار», not «یک هزار», for exactly one thousand.
    const head = i === 1 && g === 1 ? '' : under1000(g);
    words.push([head, SCALES[i]].filter(Boolean).join(' '));
  }
  return (neg ? 'منفی ' : '') + words.join(AND);
}

/** Rial amount in words, shown in Rial or Toman (e.g. 12,500,000 Rial → «یک میلیون و دویست و پنجاه هزار تومان»). */
export function amountToPersianWords(rial: bigint, unit: 'rial' | 'toman'): string {
  if (unit === 'rial') return `${numToPersianWords(rial)} ریال`;
  const toman = rial / 10n;
  const rem = rial % 10n;
  const main = `${numToPersianWords(toman)} تومان`;
  return rem === 0n ? main : `${main}${AND}${numToPersianWords(rem < 0n ? -rem : rem)} ریال`;
}
