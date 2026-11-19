import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  gregorianToJalali,
  isValidDate,
  jalaliToGregorian,
  leadingBlanks,
  monthLength,
  monthRange,
  startOfCalendarDay,
  toCalendarDate,
  weekdaySat0,
  zonedParts,
} from '../src/core/calendar/calendar';
import { formatDate, formatMoney, moneyParts } from '../src/core/i18n/format';

describe('Jalali ↔ Gregorian', () => {
  it.each([
    [{ y: 2026, m: 3, d: 21 }, { y: 1405, m: 1, d: 1 }], // Nowruz 1405
    [{ y: 2025, m: 3, d: 21 }, { y: 1404, m: 1, d: 1 }],
    [{ y: 2026, m: 11, d: 19 }, { y: 1405, m: 8, d: 28 }],
    [{ y: 1979, m: 2, d: 11 }, { y: 1357, m: 11, d: 22 }],
    [{ y: 2000, m: 2, d: 29 }, { y: 1378, m: 12, d: 10 }],
  ])('%o ↔ %o', (g, j) => {
    expect(gregorianToJalali(g)).toEqual(j);
    expect(jalaliToGregorian(j)).toEqual(g);
  });

  it('round-trips every day across 10 years', () => {
    for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2030, 0, 1); t += 86_400_000) {
      const d = new Date(t);
      const g = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
      expect(jalaliToGregorian(gregorianToJalali(g))).toEqual(g);
    }
  });

  it('month lengths and Esfand leap years', () => {
    expect([1, 6, 7, 11].map((m) => monthLength('jalali', 1404, m))).toEqual([31, 31, 30, 30]);
    expect(monthLength('jalali', 1403, 12)).toBe(30); // 1403 is leap
    expect(monthLength('jalali', 1404, 12)).toBe(29);
    expect(monthLength('gregorian', 2024, 2)).toBe(29);
    expect(monthLength('gregorian', 2026, 2)).toBe(28);
    expect(isValidDate('jalali', { y: 1404, m: 12, d: 30 })).toBe(false);
    expect(isValidDate('jalali', { y: 1403, m: 12, d: 30 })).toBe(true);
    expect(isValidDate('gregorian', { y: 2026, m: 2, d: 29 })).toBe(false);
  });
});

describe('time zone boundaries (Asia/Tehran)', () => {
  it('an instant near midnight UTC belongs to the next Tehran day', () => {
    // 2026-03-20 21:00 UTC = 2026-03-21 00:30 Tehran (UTC+3:30) → 1 Farvardin 1405
    const ms = Date.UTC(2026, 2, 20, 21, 0);
    expect(toCalendarDate(ms, 'gregorian')).toEqual({ y: 2026, m: 3, d: 21 });
    expect(toCalendarDate(ms, 'jalali')).toEqual({ y: 1405, m: 1, d: 1 });
    expect(toCalendarDate(ms, 'gregorian', 'UTC')).toEqual({ y: 2026, m: 3, d: 20 });
  });

  it('start of a Jalali day is Tehran midnight', () => {
    const start = startOfCalendarDay({ y: 1405, m: 1, d: 1 }, 'jalali');
    expect(start).toBe(Date.UTC(2026, 2, 20, 20, 30));
    const p = zonedParts(start);
    expect([p.hh, p.mm]).toEqual([0, 0]);
  });

  it('Jalali month range is half-open and gap-free', () => {
    const mehr = monthRange(Date.UTC(2026, 9, 1, 12), 'jalali'); // inside Mehr 1405
    expect([mehr.y, mehr.m]).toEqual([1405, 7]);
    expect(mehr.end - mehr.start).toBe(30 * 86_400_000);
    const aban = monthRange(mehr.end, 'jalali');
    expect(aban.start).toBe(mehr.end);
    expect(aban.m).toBe(8);
  });
});

describe('date arithmetic', () => {
  it('addMonths clamps the day', () => {
    expect(addMonths({ y: 1404, m: 6, d: 31 }, 1, 'jalali')).toEqual({ y: 1404, m: 7, d: 30 });
    expect(addMonths({ y: 1404, m: 11, d: 30 }, 1, 'jalali')).toEqual({ y: 1404, m: 12, d: 29 });
    expect(addMonths({ y: 1404, m: 12, d: 1 }, 1, 'jalali')).toEqual({ y: 1405, m: 1, d: 1 });
    expect(addMonths({ y: 1405, m: 1, d: 15 }, -2, 'jalali')).toEqual({ y: 1404, m: 11, d: 15 });
    expect(addMonths({ y: 2026, m: 1, d: 31 }, 1, 'gregorian')).toEqual({ y: 2026, m: 2, d: 28 });
  });
  it('addDays crosses Nowruz', () => {
    expect(addDays({ y: 1404, m: 12, d: 29 }, 1, 'jalali')).toEqual({ y: 1405, m: 1, d: 1 });
    expect(addDays({ y: 1405, m: 1, d: 1 }, -1, 'jalali')).toEqual({ y: 1404, m: 12, d: 29 });
  });
  it('weekday (Saturday = 0) and grid offsets', () => {
    expect(weekdaySat0({ y: 1405, m: 1, d: 1 }, 'jalali')).toBe(0); // 21 March 2026 is a Saturday
    expect(weekdaySat0({ y: 2026, m: 11, d: 20 }, 'gregorian')).toBe(6); // Friday
    expect(leadingBlanks('jalali', 1405, 1, 'sat')).toBe(0);
    expect(leadingBlanks('gregorian', 2026, 11, 'mon')).toBe(6); // 1 Nov 2026 is a Sunday
  });
});

describe('money and date display', () => {
  it('Toman view with Persian digits and separators', () => {
    expect(moneyParts(12_450_000_000n, 'IRR', 'fa', 'toman')).toEqual({ number: '۱٬۲۴۵٬۰۰۰٬۰۰۰', unit: 'تومان', negative: false });
    expect(formatMoney(12_450_000_000n, 'IRR', 'fa', 'rial')).toBe('۱۲٬۴۵۰٬۰۰۰٬۰۰۰ ریال');
    expect(formatMoney(-125n, 'IRR', 'fa', 'toman')).toBe('−۱۲٫۵ تومان');
  });
  it('English and other currencies', () => {
    expect(formatMoney(125_050n, 'USD', 'en')).toBe('1,250.50 USD');
    expect(formatMoney(1_500n, 'GOLD_GRAM', 'en')).toBe('1.500 g gold');
    expect(formatMoney(-12_500_000n, 'IRR', 'en', 'toman')).toBe('-1,250,000 Toman');
  });
  it('dates in both calendars and languages', () => {
    const ms = Date.UTC(2026, 10, 19, 9);
    expect(formatDate(ms, 'jalali', 'fa')).toBe('۲۸ آبان ۱۴۰۵');
    expect(formatDate(ms, 'jalali', 'en')).toBe('28 Aban 1405');
    expect(formatDate(ms, 'gregorian', 'en', { withYear: false })).toBe('19 November');
  });
});
