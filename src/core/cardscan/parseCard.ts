// Turns the OCR text of a bank card photo into fields. Pure and offline: digits are normalised (Persian,
// Arabic, and the letters OCR confuses with digits), the card number must pass Luhn, the expiry must be
// a real month (Jalali YY/MM on Iranian cards, MM/YY on international ones), Sheba must pass mod-97.
// Several frames are merged by `mergeScans`: the card number is self-checking (Luhn), expiry and CVV2
// are accepted only when two frames agree.
import { detectBankByCard, type BankInfo } from '../data/banks';
import { isValidCardNumber, isValidSheba, normalizeSheba } from '../validators';
import { toAsciiDigits } from '../utils/digits';

export interface CardScan {
  number: string | null;
  /** "MM/YY" for display; `expiryJalali` says which calendar the year is in. */
  expiry: string | null;
  expiryJalali: boolean;
  cvv2: string | null;
  sheba: string | null;
  bank: BankInfo | undefined;
}

// Letters OCR reads in place of digits on embossed or printed card faces.
const LOOKALIKE: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', Z: '2', z: '2', S: '5', s: '5', B: '8', G: '6', b: '6', T: '7', g: '9', q: '9' };

/** Digits only where a token is mostly digits: "6O37 99l2" -> "6037 9912", but "SAMAN" stays text. */
export function normalizeOcr(text: string): string {
  return toAsciiDigits(text)
    .replace(/[٫،,]/g, ' ')
    .split(/(\s+)/)
    .map((tok) => {
      const digits = (tok.match(/\d/g) ?? []).length;
      const fixable = [...tok].filter((c) => c in LOOKALIKE).length;
      const len = tok.replace(/[^A-Za-z0-9|]/g, '').length;
      if (/^IR\d/i.test(tok)) return tok.slice(0, 2).toUpperCase() + tok.slice(2); // a Sheba keeps its "IR"
      return digits >= 2 && digits + fixable >= len * 0.75 ? [...tok].map((c) => LOOKALIKE[c] ?? c).join('') : tok;
    })
    .join('');
}

/** The card number: a Luhn-valid 16 (or 19/15) digit window inside a run of digits, spaces and dashes. */
export function findCardNumber(text: string): string | null {
  const runs = text.match(/\d(?:[\d \-–]{10,40})\d/g) ?? [];
  const found: string[] = [];
  for (const r of runs) {
    const d = r.replace(/\D/g, '');
    // A run can hold the number plus a neighbour (CVV2 on the same line): try every window.
    for (const len of [16, 19, 15]) for (let i = 0; i + len <= d.length; i++) {
      const c = d.slice(i, i + len);
      if (isValidCardNumber(c)) found.push(c);
    }
  }
  // Prefer a number whose BIN is a known bank, then 16 digits.
  found.sort((a, b) => Number(!!detectBankByCard(b)) - Number(!!detectBankByCard(a)) || Number(b.length === 16) - Number(a.length === 16));
  return found[0] ?? null;
}

/**
 * Expiry: "1405/08", "05/08", "08/27", "08 / 2027". Iranian cards print the Jalali year first (YY/MM or
 * YYYY/MM); international ones MM/YY. A label nearby ("انقضا", "EXP", "VALID THRU") is preferred.
 */
export function findExpiry(text: string, iranian: boolean): { value: string; jalali: boolean } | null {
  const near = /(انقضا|اعتبار|EXP|VALID|THRU|GOOD)/i;
  const cands: { value: string; jalali: boolean; score: number }[] = [];
  for (const m of text.matchAll(/(?<!\d)(\d{2}|\d{4})\s*[/\\\-.]\s*(\d{2}|\d{4})(?!\d)/g)) {
    const a = m[1]!;
    const b = m[2]!;
    const ctx = text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 4);
    const label = near.test(ctx) ? 2 : 0;
    // Jalali: year first (1400-1420 or 00-20), then month.
    const jy = a.length === 4 ? Number(a) - 1400 : Number(a);
    const jm = Number(b);
    if (b.length === 2 && jm >= 1 && jm <= 12 && jy >= 0 && jy <= 20)
      cands.push({ value: `${b}/${String(jy).padStart(2, '0')}`, jalali: true, score: label + (iranian ? 1 : 0) });
    // International: month first, then a 20xx year.
    const gm = Number(a);
    const gy = b.length === 4 ? Number(b) - 2000 : Number(b);
    if (a.length === 2 && gm >= 1 && gm <= 12 && gy >= 20 && gy <= 50)
      cands.push({ value: `${a}/${String(gy).padStart(2, '0')}`, jalali: false, score: label + (iranian ? 0 : 1) });
  }
  cands.sort((x, y) => y.score - x.score);
  return cands[0] ? { value: cands[0].value, jalali: cands[0].jalali } : null;
}

/** CVV2: 3 or 4 digits right after its label ("CVV2", "CVC", "کد امنیتی"). Never guessed without a label. */
export function findCvv2(text: string): string | null {
  const m = text.match(/(?:CVV\s*2?|CVC\s*2?|CW2|کد\s*امنیتی)\s*[:：]?\s*(\d{3,4})(?!\d)/i);
  return m ? m[1]! : null;
}

export function findSheba(text: string): string | null {
  for (const m of text.matchAll(/IR\s*((?:\d[\s-]?){24})/gi)) {
    const s = normalizeSheba('IR' + m[1]!.replace(/\D/g, ''));
    if (isValidSheba(s)) return s;
  }
  return null;
}

export function parseCardText(raw: string): CardScan {
  const text = normalizeOcr(raw);
  const number = findCardNumber(text);
  const bank = number ? detectBankByCard(number) : undefined;
  // Remove the card number before looking for dates and the CVV2, so its groups are never read as one.
  const rest = number ? text.replace(new RegExp(number.split('').join('[ \\-–]?')), ' ') : text;
  const exp = findExpiry(rest, !!bank || /[؀-ۿ]/.test(raw));
  return { number, expiry: exp?.value ?? null, expiryJalali: exp?.jalali ?? false, cvv2: findCvv2(rest), sheba: findSheba(text), bank };
}

/** Merge readings of several frames (see the file comment). `confident` = the number was read twice. */
export function mergeScans(scans: readonly CardScan[]): CardScan & { confident: boolean } {
  const vote = (vals: (string | null)[], need: number): string | null => {
    const n = new Map<string, number>();
    for (const v of vals) if (v) n.set(v, (n.get(v) ?? 0) + 1);
    let best: string | null = null;
    let bestN = 0;
    for (const [v, c] of n) if (c > bestN) [best, bestN] = [v, c];
    return bestN >= need ? best : null;
  };
  const number = vote(scans.map((s) => s.number), 1);
  const expiry = vote(scans.map((s) => s.expiry), 2);
  return {
    number,
    expiry,
    expiryJalali: scans.find((s) => s.expiry === expiry)?.expiryJalali ?? false,
    cvv2: vote(scans.map((s) => s.cvv2), 2),
    sheba: vote(scans.map((s) => s.sheba), 1),
    bank: number ? detectBankByCard(number) : undefined,
    confident: !!number && vote(scans.map((s) => s.number), 2) === number,
  };
}
