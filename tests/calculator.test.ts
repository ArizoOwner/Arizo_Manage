import { describe, expect, it } from 'vitest';
import { emptyCalc, evaluate, expressionText, fromValue, press, type CalcState, type Key } from '../src/core/currency/calculator';

const type = (keys: Key[], decimals = 0, start: CalcState = emptyCalc()) => keys.reduce((s, k) => press(s, k, decimals), start);
const val = (keys: Key[], decimals = 0) => evaluate(type(keys, decimals), decimals);

describe('keypad entry', () => {
  it('builds numbers, uses the 000 key, ignores leading zeros', () => {
    expect(val(['1', '2', '5', '000'])).toEqual({ ok: true, value: 125_000n });
    expect(val(['0', '0', '7'])).toEqual({ ok: true, value: 7n });
    expect(expressionText(type(['000']))).toBe(''); // 000 on an empty number does nothing
  });

  it('decimal point only when the unit has decimals, and caps fraction digits', () => {
    expect(expressionText(type(['1', '.', '5']))).toBe('15');
    expect(val(['1', '.', '2', '5', '9'], 2)).toEqual({ ok: true, value: 125n });
    expect(val(['.', '5'], 2)).toEqual({ ok: true, value: 50n });
  });

  it('operators: no leading operator, consecutive operators replace', () => {
    expect(type(['+']).tokens).toEqual([]);
    expect(expressionText(type(['5', '+', '*', '2']))).toBe('5 × 2');
  });

  it('backspace removes digits then operators', () => {
    expect(expressionText(type(['1', '2', '+', '3', 'back', 'back', 'back']))).toBe('1');
    expect(type(['back']).tokens).toEqual([]);
    expect(type(['1', 'clear']).tokens).toEqual([]);
  });

  it('caps magnitude at 15 digits', () => {
    const fifteen: Key[] = Array.from({ length: 15 }, () => '9');
    expect(expressionText(type([...fifteen, '9']))).toBe('9'.repeat(15));
    expect(expressionText(type([...(Array.from({ length: 13 }, () => '1') as Key[]), '000']))).toBe('1'.repeat(13));
  });
});

describe('exact evaluation', () => {
  it('respects precedence', () => {
    expect(val(['2', '+', '3', '*', '4'])).toEqual({ ok: true, value: 14n });
    expect(val(['1', '0', '-', '6', '/', '3'])).toEqual({ ok: true, value: 8n });
  });

  it('no float drift: 0.1 + 0.2 = 0.3', () => {
    expect(val(['.', '1', '+', '.', '2'], 2)).toEqual({ ok: true, value: 30n });
  });

  it('division rounds half-up only at the end', () => {
    expect(val(['1', '0', '/', '3', '*', '3'])).toEqual({ ok: true, value: 10n }); // exact fractions, not 9
    expect(val(['5', '/', '2'])).toEqual({ ok: true, value: 3n });
    expect(val(['1', '0', '0', '/', '3'], 2)).toEqual({ ok: true, value: 3333n });
  });

  it('a trailing operator is ignored for the live preview', () => {
    expect(val(['4', '5', '+'])).toEqual({ ok: true, value: 45n });
  });

  it('reports division by zero, empty input and overflow', () => {
    expect(val(['5', '/', '0'])).toEqual({ ok: false, error: 'div_by_zero' });
    expect(val([])).toEqual({ ok: false, error: 'empty' });
    const big: Key[] = Array.from({ length: 15 }, () => '9');
    expect(val([...big, '*', '1', '0'])).toEqual({ ok: false, error: 'overflow' });
  });

  it('handles 15-digit Iranian amounts exactly', () => {
    expect(val(['9', '9', '9', '000', '000', '000', '000', '+', '1'])).toEqual({ ok: true, value: 999_000_000_000_001n });
  });

  it('round-trips an existing value, including negatives and decimals', () => {
    expect(evaluate(fromValue(125_050n, 2), 2)).toEqual({ ok: true, value: 125_050n });
    expect(evaluate(fromValue(-42n, 0), 0)).toEqual({ ok: true, value: -42n });
    expect(fromValue(0n, 0).tokens).toEqual([]);
  });
});
