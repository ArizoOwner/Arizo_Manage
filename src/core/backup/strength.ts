// Passphrase strength meter (offline, no word list download): a conservative entropy estimate.
// Pool size from the character classes used, then penalties for the patterns guessers try first:
// repeats, keyboard/number sequences, a single class, and known weak words.
export type Strength = 0 | 1 | 2 | 3 | 4;
export const MIN_LENGTH = 10;
/** Backups need at least "fair". */
export const MIN_SCORE: Strength = 2;

const COMMON = ['password', 'passw0rd', 'qwerty', 'arizo', 'admin', 'letmein', 'iloveyou', '123456', 'abcdef', 'asdfgh', 'zxcvbn', 'parol', 'ramz'];
const SEQ = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

export function passphraseStrength(input: string): { score: Strength; bits: number } {
  const p = input.normalize('NFKC');
  const chars = [...p];
  if (chars.length === 0) return { score: 0, bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9۰-۹]/.test(p)) pool += 10;
  if (/[^\p{L}\p{N}]/u.test(p)) pool += 33;
  if (/[؀-ۿ]/.test(p)) pool += 32; // Persian letters
  // Count each character's contribution once per position, but repeats and sequences add almost nothing.
  const lower = p.toLowerCase();
  let effective = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!.toLowerCase();
    const prev = chars[i - 1]?.toLowerCase();
    if (c === prev) effective += 0.2;
    else if (prev && SEQ.some((s) => s.includes(prev + c) || s.includes(c + prev))) effective += 0.35;
    else effective += 1;
  }
  let bits = effective * Math.log2(Math.max(pool, 10));
  for (const w of COMMON) if (lower.includes(w)) bits -= w.length * 3;
  if (new Set(chars).size <= 3) bits = Math.min(bits, 15);
  bits = Math.max(0, Math.round(bits));
  const score: Strength = chars.length < 8 ? 0 : bits < 36 ? 1 : bits < 52 ? 2 : bits < 72 ? 3 : 4;
  return { score, bits };
}

export const acceptablePassphrase = (p: string) => [...p.normalize('NFKC')].length >= MIN_LENGTH && passphraseStrength(p).score >= MIN_SCORE;
