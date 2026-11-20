// Stage 1 (firewall) and Stage 2 (normalizer) of the SMS engine (PROMPT.md §6.2).
import { toAsciiDigits } from '../utils/digits';

/** Persian/Arabic digits → ASCII, ي/ى→ی, ك→ک, strip ZWNJ/ZWJ/RLM/LRM/bidi marks/tatweel, unify signs and spaces. */
export function normalizeSms(raw: string): string {
  return toAsciiDigits(raw)
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[​-‏‪-‮⁦-⁩ـ﻿]/g, '')
    .replace(/[٬،]/g, ',')
    .replace(/٫/g, '.')
    .replace(/[−–—‐]/g, '-')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t  ]+/g, ' ')
    // Trailing sign ("2,000,000-", "500,000+") becomes leading; date and time parts are never touched.
    .replace(/(?<![\d/:.\-])(\d[\d,]*(?:\.\d+)?)([-+])(?![\p{L}\p{N}/:*])/gu, '$2$1')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
    .join('\n')
    .trim();
}

// Keywords are in normalized form (no ZWNJ, Persian ی/ک).
const OTP: RegExp[] = [
  /رمز ?پویا/,
  /رمز ?دوم/,
  /رمز ?یک ?بار ?مصرف/,
  /رمز ?موقت/,
  /کد ?تا[ئٔ]?یید/,
  /کد ?تأیید/,
  /کد ?احراز/,
  /کد ?ورود/,
  /کد ?امنیتی/,
  /ورود ?به/,
  /\bOTP\b/i,
  /verification ?code/i,
  /\b2FA\b/i,
  /\bCVV2?\b/i,
  /one[- ]?time ?(pass(word|code)?|code|pin)/i,
  /security ?code/i,
  /login ?code/i,
];
const SPAM: RegExp[] = [/جایزه/, /قرعه ?کشی/, /تخفیف ?ویژه/, /برنده/, /\bpromo/i, /\bprize\b/i, /\bwinner\b/i];

export type FirewallVerdict = 'otp' | 'spam' | null;

/** Runs first on every message. A non-null verdict means: drop it now, persist nothing. */
export function firewall(raw: string): FirewallVerdict {
  const s = normalizeSms(raw);
  if (OTP.some((r) => r.test(s))) return 'otp';
  if (SPAM.some((r) => r.test(s))) return 'spam';
  return null;
}
