import { describe, expect, it } from 'vitest';
import { amountToPersianWords, numToPersianWords } from '../src/core/currency/numToPersianWords';
import { allocateEvenly, applyBps, convertPpm, divRoundHalfUp, formatMinor, parseMajor, sumMinor, tomanToRial } from '../src/core/currency/money';
import {
  isValidCardNumber,
  isValidEconomicCode,
  isValidLegalNationalId,
  isValidNationalId,
  isValidSayadId,
  isValidSheba,
  maskCard,
  normalizeIranMobile,
  normalizeSheba,
} from '../src/core/validators';
import { detectBankByCard, BANKS } from '../src/core/data/banks';
import { toAsciiDigits, toPersianDigits } from '../src/core/utils/digits';
import { uuidv7, uuidv7Time } from '../src/core/utils/uuidv7';
import { redact } from '../src/core/utils/secureLogger';

describe('Luhn card validator', () => {
  it.each(['4111111111111111', '6219861034529007', '5022291070873466', '۶۲۱۹-۸۶۱۰-۳۴۵۲-۹۰۰۷'])('accepts %s', (c) => {
    expect(isValidCardNumber(c)).toBe(true);
  });
  it.each(['6037997599999995', '4111111111111112', '1234', '', 'abcd'])('rejects %s', (c) => {
    expect(isValidCardNumber(c)).toBe(false);
  });
  it('masks to first 4 and last 4', () => {
    expect(maskCard('6219 8610 3452 9007')).toBe('6219 •••• •••• 9007');
  });
});

describe('Sheba mod-97', () => {
  const valid = 'IR062960000000100324200001';
  it('accepts a known-valid Sheba with or without IR, with spaces or Persian digits', () => {
    expect(isValidSheba(valid)).toBe(true);
    expect(isValidSheba(valid.slice(2))).toBe(true);
    expect(isValidSheba('IR06 2960 0000 0010 0324 2000 01')).toBe(true);
    expect(isValidSheba('IR' + toPersianDigits(valid.slice(2)))).toBe(true);
  });
  it('rejects a one-digit change, a transposition and a wrong length', () => {
    expect(isValidSheba('IR062960000000100324200002')).toBe(false);
    expect(isValidSheba('IR602960000000100324200001')).toBe(false);
    expect(isValidSheba('IR06296000000010032420000')).toBe(false);
  });
  it('normalizes', () => {
    expect(normalizeSheba(' ir06 2960 0000 0010 0324 2000 01')).toBe(valid);
  });
});

describe('Iranian national ID (کد ملی)', () => {
  it.each(['0499370899', '0084575948', '0013542419', '۰۴۹۹۳۷۰۸۹۹'])('accepts %s', (id) => expect(isValidNationalId(id)).toBe(true));
  it.each(['0499370898', '1111111111', '0000000000', '123456789', '12345678901'])('rejects %s', (id) =>
    expect(isValidNationalId(id)).toBe(false),
  );
});

describe('Legal national ID and economic code', () => {
  // Independent construction from the published algorithm.
  const makeLegal = (ten: string) => {
    const dec = Number(ten[9]) + 2;
    const coef = [29, 27, 23, 19, 17];
    let s = 0;
    for (let i = 0; i < 10; i++) s += (Number(ten[i]) + dec) * coef[i % 5]!;
    return ten + String(s % 11 === 10 ? 0 : s % 11);
  };
  const legal = makeLegal('1010123456');
  it('accepts a correct legal ID and rejects a corrupted one', () => {
    expect(isValidLegalNationalId(legal)).toBe(true);
    expect(isValidLegalNationalId(legal.slice(0, 10) + String((Number(legal[10]) + 1) % 10))).toBe(false);
  });
  it('economic code accepts 12-digit legacy, personal and legal IDs', () => {
    expect(isValidEconomicCode('411111111111')).toBe(true);
    expect(isValidEconomicCode('0499370899')).toBe(true);
    expect(isValidEconomicCode(legal)).toBe(true);
    expect(isValidEconomicCode('0499370898')).toBe(false);
    expect(isValidEconomicCode('123')).toBe(false);
  });
});

describe('Sayad ID (16 digits)', () => {
  it('accepts 16 digits, including Persian digits', () => {
    expect(isValidSayadId('1234567890123456')).toBe(true);
    expect(isValidSayadId('۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶')).toBe(true);
  });
  it.each(['123456789012345', '12345678901234567', '0000000000000000', ''])('rejects %s', (s) => expect(isValidSayadId(s)).toBe(false));
});

describe('mobile normalization', () => {
  it.each([
    ['09121234567', '09121234567'],
    ['+989121234567', '09121234567'],
    ['00989121234567', '09121234567'],
    ['۰۹۱۲۱۲۳۴۵۶۷', '09121234567'],
  ])('%s → %s', (a, b) => expect(normalizeIranMobile(a)).toBe(b));
  it('rejects a landline', () => expect(normalizeIranMobile('0212345678')).toBeNull());
});

describe('numToPersianWords', () => {
  it.each<[bigint | number, string]>([
    [0, 'صفر'],
    [1, 'یک'],
    [10, 'ده'],
    [11, 'یازده'],
    [19, 'نوزده'],
    [20, 'بیست'],
    [21, 'بیست و یک'],
    [99, 'نود و نه'],
    [100, 'یکصد'],
    [101, 'یکصد و یک'],
    [110, 'یکصد و ده'],
    [999, 'نهصد و نود و نه'],
    [1000, 'هزار'],
    [1001, 'هزار و یک'],
    [2000, 'دو هزار'],
    [12_500, 'دوازده هزار و پانصد'],
    [100_000, 'یکصد هزار'],
    [1_000_000, 'یک میلیون'],
    [1_250_000, 'یک میلیون و دویست و پنجاه هزار'],
    [1_000_000_000, 'یک میلیارد'],
    [12_450_000_000, 'دوازده میلیارد و چهارصد و پنجاه میلیون'],
    [-5, 'منفی پنج'],
    [1_000_000_000_000n, 'یک تریلیون'],
    [
      999_999_999_999_999n,
      'نهصد و نود و نه تریلیون و نهصد و نود و نه میلیارد و نهصد و نود و نه میلیون و نهصد و نود و نه هزار و نهصد و نود و نه',
    ],
  ])('%s → %s', (n, words) => expect(numToPersianWords(n)).toBe(words));

  it('rejects unsafe numbers and absurd sizes', () => {
    expect(() => numToPersianWords(2 ** 60)).toThrow();
    expect(() => numToPersianWords(10n ** 21n)).toThrow();
  });

  it('amount in Toman and Rial', () => {
    expect(amountToPersianWords(12_500_000n, 'toman')).toBe('یک میلیون و دویست و پنجاه هزار تومان');
    expect(amountToPersianWords(12_500_000n, 'rial')).toBe('دوازده میلیون و پانصد هزار ریال');
    expect(amountToPersianWords(15n, 'toman')).toBe('یک تومان و پنج ریال');
  });
});

describe('exact money math', () => {
  it('parses major units without floats', () => {
    expect(parseMajor('1,250.50', 'USD')).toBe(125_050n);
    expect(parseMajor('۱۲۵۰٫۵', 'USD')).toBe(125_050n);
    expect(parseMajor('12,450,000,000', 'IRR')).toBe(12_450_000_000n);
    expect(parseMajor('0.1', 'USD') + parseMajor('0.2', 'USD')).toBe(parseMajor('0.3', 'USD'));
    expect(parseMajor('1.5', 'GOLD_GRAM')).toBe(1500n);
    expect(parseMajor('-3', 'IRR')).toBe(-3n);
    expect(() => parseMajor('1.234', 'USD')).toThrow();
    expect(() => parseMajor('12a', 'IRR')).toThrow();
  });
  it('formats', () => {
    expect(formatMinor(125_050n, 'USD')).toBe('1,250.50');
    expect(formatMinor(-5n, 'USD')).toBe('-0.05');
    expect(formatMinor(12_450_000_000n, 'IRR')).toBe('12,450,000,000');
    expect(formatMinor(999_999_999_999_999n, 'IRR')).toBe('999,999,999,999,999');
  });
  it('round-trips beyond float precision', () => {
    const big = 9_007_199_254_740_993n; // 2^53 + 1: not representable as a double
    expect(parseMajor(formatMinor(big, 'IRR'), 'IRR')).toBe(big);
  });
  it('rounds half-up and handles signs', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(() => divRoundHalfUp(1n, 0n)).toThrow();
  });
  it('VAT in basis points and ppm rates', () => {
    expect(applyBps(1_234_567n, 1000n)).toBe(123_457n); // 10% VAT
    expect(convertPpm(10_000n, 1_500_000n)).toBe(15_000n); // ×1.5
  });
  it('allocates evenly with an exact sum', () => {
    const parts = allocateEvenly(100n, 3);
    expect(parts).toEqual([34n, 33n, 33n]);
    expect(sumMinor(parts)).toBe(100n);
    expect(sumMinor(allocateEvenly(-100n, 3))).toBe(-100n);
    expect(sumMinor(allocateEvenly(1_000_000_007n, 12))).toBe(1_000_000_007n);
    expect(() => allocateEvenly(1n, 0)).toThrow();
  });
  it('toman ↔ rial', () => expect(tomanToRial(125n)).toBe(1250n));
});

describe('banks.json BIN detection', () => {
  it('has 30+ entries, unique codes, and every sender unverified', () => {
    expect(BANKS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(BANKS.map((b) => b.code)).size).toBe(BANKS.length);
    expect(BANKS.every((b) => b.verified === false)).toBe(true);
  });
  it.each([
    ['6037991234567890', 'melli'],
    ['6104331234567890', 'mellat'],
    ['6219861034529007', 'saman'],
    ['5022291070873466', 'pasargad'],
  ])('%s → %s', (card, code) => expect(detectBankByCard(card)?.code).toBe(code));
  it('unknown and short input', () => {
    expect(detectBankByCard('4111111111111111')).toBeUndefined();
    expect(detectBankByCard('603')).toBeUndefined();
  });
});

describe('utils', () => {
  it('digit conversion', () => {
    expect(toAsciiDigits('۱۲۳٤٥٦')).toBe('123456');
    expect(toPersianDigits('2026')).toBe('۲۰۲۶');
  });
  it('UUIDv7 shape, version, time and monotonic order', () => {
    const t = 1_763_600_000_000;
    const ids = Array.from({ length: 50 }, () => uuidv7(t));
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(uuidv7Time(id)).toBe(t);
    }
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(50);
  });
  it('SecureLogger redacts cards, Sheba, amounts and blobs', () => {
    const s = redact('card 6219861034529007 sheba IR062960000000100324200001 amount 1,250,000 key q83v9LwGkF0aZ1xYp2RtUe7Hs5Nm4Jc= otp ۱۲۳۴۵');
    expect(s).not.toMatch(/\d|[۰-۹]/);
    expect(s).toContain('[CARD]');
    expect(s).toContain('[SHEBA]');
    expect(s).toContain('[BLOB]');
    expect(redact({ amount_minor: 5n })).toBe('{"amount_minor":"[N]"}');
  });
});
