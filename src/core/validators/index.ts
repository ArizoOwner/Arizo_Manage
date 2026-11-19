import { onlyDigits } from '../utils/digits';

/** Luhn mod-10 card check (Iranian Shetab cards are 16 digits). */
export function isValidCardNumber(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length < 12 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
  }
  return sum % 10 === 0;
}

/** Strip to "IR" + digits. Accepts input with or without the IR prefix. */
export const normalizeSheba = (raw: string): string => 'IR' + onlyDigits(raw.replace(/^\s*IR/i, ''));

/** ISO 13616 mod-97 for an Iranian Sheba: "IR" + 24 digits. */
export function isValidSheba(raw: string): boolean {
  const s = normalizeSheba(raw).slice(2);
  if (s.length !== 24) return false;
  // Move "IR" + check digits to the end; I=18, R=27.
  const rearranged = s.slice(2) + '1827' + s.slice(0, 2);
  let rem = 0;
  for (const ch of rearranged) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

/** Iranian personal National ID (کد ملی): 10 digits, weighted mod-11 check digit. */
export function isValidNationalId(raw: string): boolean {
  const d = onlyDigits(raw);
  if (!/^\d{10}$/.test(d) || /^(\d)\1{9}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
  const r = sum % 11;
  const check = Number(d[9]);
  return r < 2 ? check === r : check === 11 - r;
}

/** Legal-entity National ID (شناسه ملی اشخاص حقوقی): 11 digits. */
export function isValidLegalNationalId(raw: string): boolean {
  const d = onlyDigits(raw);
  if (!/^\d{11}$/.test(d)) return false;
  const dec = Number(d[9]) + 2;
  const coef = [29, 27, 23, 19, 17];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (Number(d[i]) + dec) * coef[i % 5]!;
  let r = sum % 11;
  if (r === 10) r = 0;
  return r === Number(d[10]);
}

/** Economic code (کد اقتصادی): 12-digit legacy code, or a valid 10/11-digit national ID used as the new code. */
export function isValidEconomicCode(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length === 10) return isValidNationalId(d);
  if (d.length === 11) return isValidLegalNationalId(d);
  return /^\d{12}$/.test(d);
}

/**
 * Sayad cheque ID (شناسه صیادی): exactly 16 digits.
 * shortcut: the Central Bank publishes no checksum, so only shape is checked; add one if it is ever published.
 */
export function isValidSayadId(raw: string): boolean {
  const d = onlyDigits(raw);
  return /^\d{16}$/.test(d) && !/^0{16}$/.test(d);
}

/** Iranian mobile number to 09xxxxxxxxx (accepts +98 / 0098), or null. */
export function normalizeIranMobile(raw: string): string | null {
  const d = onlyDigits(raw).replace(/^(0098|98)/, '0');
  return /^09\d{9}$/.test(d) ? d : null;
}

export function maskCard(raw: string): string {
  const d = onlyDigits(raw);
  return d.length < 8 ? d : `${d.slice(0, 4)} •••• •••• ${d.slice(-4)}`;
}
