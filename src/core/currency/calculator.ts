// Exact keypad calculator over minor units (PROMPT.md §3.3, §7.4). No floats anywhere.
// Values are kept as exact fractions (bigint num/den) until the final result, which rounds
// half-up to whole minor units. Precedence: × ÷ before + −, left to right.
import { divRoundHalfUp } from './money';

export type Op = '+' | '-' | '*' | '/';
export type Token = { kind: 'num'; text: string } | { kind: 'op'; op: Op };

export interface CalcState {
  tokens: Token[];
}

/** Largest magnitude accepted: 15 digits of the display unit (PROMPT.md §3.3). */
export const MAX_DIGITS = 15;

export const emptyCalc = (): CalcState => ({ tokens: [] });

const last = (s: CalcState) => s.tokens[s.tokens.length - 1];

export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '000' | '.' | Op | 'back' | 'clear';

/** Apply one key. `decimals` = allowed fraction digits in the display unit (0 for Rial/Toman). */
export function press(s: CalcState, key: Key, decimals: number): CalcState {
  const tokens = [...s.tokens];
  const top = last(s);
  if (key === 'clear') return emptyCalc();
  if (key === 'back') {
    if (!top) return s;
    if (top.kind === 'op') return { tokens: tokens.slice(0, -1) };
    const text = top.text.slice(0, -1);
    return { tokens: text ? [...tokens.slice(0, -1), { kind: 'num', text }] : tokens.slice(0, -1) };
  }
  if (key === '+' || key === '-' || key === '*' || key === '/') {
    if (!top) return s; // no leading operator
    if (top.kind === 'op') return { tokens: [...tokens.slice(0, -1), { kind: 'op', op: key }] }; // replace
    return { tokens: [...tokens, { kind: 'op', op: key }] };
  }
  const cur = top?.kind === 'num' ? top.text : '';
  if (key === '.') {
    if (decimals === 0 || cur.includes('.')) return s;
    return replaceNum(tokens, top, (cur || '0') + '.');
  }
  const base = cur === '0' ? '' : cur;
  if (key === '000' && !base) return s; // "000" on an empty number would just be zero
  const next = base + key;
  const [int, frac = ''] = next.split('.');
  if (frac.length > decimals) return s;
  if (int!.replace(/^0+/, '').length > MAX_DIGITS) return s;
  return replaceNum(tokens, top, next);
}

function replaceNum(tokens: Token[], top: Token | undefined, text: string): CalcState {
  return top?.kind === 'num'
    ? { tokens: [...tokens.slice(0, -1), { kind: 'num', text }] }
    : { tokens: [...tokens, { kind: 'num', text }] };
}

interface Frac {
  n: bigint;
  d: bigint;
}

function toFrac(text: string): Frac {
  const [int, frac = ''] = text.split('.');
  return { n: BigInt((int || '0') + frac), d: 10n ** BigInt(frac.length) };
}

export type CalcResult = { ok: true; value: bigint } | { ok: false; error: 'empty' | 'div_by_zero' | 'overflow' };

/**
 * Evaluate to an exact value in minor units of the display unit (scaled by 10^decimals).
 * A trailing operator is ignored, so the live preview works while typing.
 */
export function evaluate(s: CalcState, decimals: number): CalcResult {
  const toks = last(s)?.kind === 'op' ? s.tokens.slice(0, -1) : s.tokens;
  if (!toks.length) return { ok: false, error: 'empty' };
  const num = (i: number) => toFrac((toks[i] as { text: string }).text);
  // Pass 1: fold × and ÷ into terms. Pass 2: sum the terms.
  const terms: { sign: bigint; v: Frac }[] = [];
  let cur = num(0);
  let sign = 1n;
  for (let i = 1; i < toks.length; i += 2) {
    const op = (toks[i] as { op: Op }).op;
    const v = num(i + 1);
    if (op === '*') cur = { n: cur.n * v.n, d: cur.d * v.d };
    else if (op === '/') {
      if (v.n === 0n) return { ok: false, error: 'div_by_zero' };
      cur = { n: cur.n * v.d, d: cur.d * v.n };
    } else {
      terms.push({ sign, v: cur });
      sign = op === '+' ? 1n : -1n;
      cur = v;
    }
  }
  terms.push({ sign, v: cur });
  let total: Frac = { n: 0n, d: 1n };
  for (const t of terms) total = { n: total.n * t.v.d + t.sign * t.v.n * total.d, d: total.d * t.v.d };
  const scaled = divRoundHalfUp(total.n * 10n ** BigInt(decimals), total.d);
  const limit = 10n ** BigInt(MAX_DIGITS + decimals);
  if (scaled >= limit || scaled <= -limit) return { ok: false, error: 'overflow' };
  return { ok: true, value: scaled };
}

const OP_GLYPH: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/** Expression text with ASCII digits, e.g. "1250000 + 12 × 3". */
export const expressionText = (s: CalcState): string =>
  s.tokens.map((t) => (t.kind === 'num' ? t.text : OP_GLYPH[t.op])).join(' ');

export const hasOperator = (s: CalcState): boolean => s.tokens.some((t) => t.kind === 'op');

/** Start the calculator from an existing value (minor units of the display unit). */
export function fromValue(value: bigint, decimals: number): CalcState {
  if (value === 0n) return emptyCalc();
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const frac = decimals ? (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '') : '';
  const text = (abs / base).toString() + (frac ? `.${frac}` : '');
  // A negative start is expressed as 0 − x so the token grammar stays simple.
  return neg
    ? { tokens: [{ kind: 'num', text: '0' }, { kind: 'op', op: '-' }, { kind: 'num', text }] }
    : { tokens: [{ kind: 'num', text }] };
}
