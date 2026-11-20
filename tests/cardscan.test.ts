import { describe, expect, it } from 'vitest';
import { findCardNumber, findExpiry, mergeScans, normalizeOcr, parseCardText } from '../src/core/cardscan/parseCard';

// Synthetic card faces: Luhn-valid numbers on real BINs, never a real card.
const MELLI = '6037991234567893';
const SAMAN = '6219861234567898';
const SHEBA = 'IR062960000000100324200001';

describe('card scan parser', () => {
  it('reads the number from Persian digits, dashes and OCR lookalike letters', () => {
    expect(findCardNumber(normalizeOcr('۶۰۳۷ ۹۹۱۲ ۳۴۵۶ ۷۸۹۳'))).toBe(MELLI);
    expect(findCardNumber(normalizeOcr('6O37 99l2 3456 7893'))).toBe(MELLI);
    expect(findCardNumber(normalizeOcr('6219-8612-3456-7898'))).toBe(SAMAN);
  });

  it('never returns a number that fails Luhn', () => {
    expect(findCardNumber('6037 9912 3456 7894')).toBeNull();
    expect(findCardNumber('1234 5678 9012 3456')).toBeNull();
  });

  it('keeps words as words: only mostly-digit tokens get lookalike fixes', () => {
    expect(normalizeOcr('SAMAN BANK')).toBe('SAMAN BANK');
  });

  it('expiry: Jalali YY/MM and YYYY/MM on Iranian cards, MM/YY on international ones', () => {
    expect(findExpiry('انقضا 07/09', true)).toEqual({ value: '09/07', jalali: true });
    expect(findExpiry('1407/09', true)).toEqual({ value: '09/07', jalali: true });
    expect(findExpiry('VALID THRU 08/29', false)).toEqual({ value: '08/29', jalali: false });
    expect(findExpiry('08/2029', false)).toEqual({ value: '08/29', jalali: false });
    expect(findExpiry('13/45', true)).toBeNull();
  });

  it('full face: number, bank, CVV2, Jalali expiry and Sheba; card digits are never read as a date', () => {
    const s = parseCardText(`بانک سامان\n6219 8612 3456 7898\nCVV2 731  تاریخ انقضا 1406/11\n${SHEBA}`);
    expect(s.number).toBe(SAMAN);
    expect(s.bank?.code).toBe('saman');
    expect(s.cvv2).toBe('731');
    expect(s.expiry).toBe('11/06');
    expect(s.expiryJalali).toBe(true);
    expect(s.sheba).toBe(SHEBA);
  });

  it('CVV2 is only taken after its label', () => {
    expect(parseCardText('6219 8612 3456 7898 731').cvv2).toBeNull();
    expect(parseCardText('کد امنیتی: ۷۳۱').cvv2).toBe('731');
  });

  it('merge: the number from one frame, expiry and CVV2 only when two frames agree', () => {
    const a = parseCardText('6219 8612 3456 7898\nCVV2 731 1406/11');
    const b = parseCardText('6219 8612 3456 7898\nCVV2 781 1406/11');
    const m = mergeScans([a, b]);
    expect(m.number).toBe(SAMAN);
    expect(m.confident).toBe(true);
    expect(m.expiry).toBe('11/06');
    expect(m.cvv2).toBeNull();
    expect(mergeScans([a]).expiry).toBeNull();
  });
});
