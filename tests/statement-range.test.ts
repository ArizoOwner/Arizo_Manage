import { describe, expect, it } from 'vitest';
import { statementRange } from '../src/core/analytics/periods';
import { toCalendarDate } from '../src/core/calendar/calendar';

const DAY = 86_400_000;
// 2026-11-20 12:00 Tehran = 1405/08/29 (a Friday).
const now = Date.UTC(2026, 10, 20, 8, 30);
const ymd = (ms: number, cal: 'jalali' | 'gregorian') => toCalendarDate(ms, cal);

describe('statementRange', () => {
  it('month: the Jalali and Gregorian month holding now, then stepping back', () => {
    const j = statementRange('month', now, 0, 'jalali');
    expect(ymd(j.start, 'jalali')).toEqual({ y: 1405, m: 8, d: 1 });
    expect(ymd(j.end, 'jalali')).toEqual({ y: 1405, m: 9, d: 1 });
    const g = statementRange('month', now, -1, 'gregorian');
    expect(ymd(g.start, 'gregorian')).toEqual({ y: 2026, m: 10, d: 1 });
    expect(ymd(g.end, 'gregorian')).toEqual({ y: 2026, m: 11, d: 1 });
  });

  it('year: Jalali year starts on 1 Farvardin, Gregorian on 1 January', () => {
    const j = statementRange('year', now, 0, 'jalali');
    expect(ymd(j.start, 'jalali')).toEqual({ y: 1405, m: 1, d: 1 });
    expect(ymd(j.end, 'jalali')).toEqual({ y: 1406, m: 1, d: 1 });
    const g = statementRange('year', now, -1, 'gregorian');
    expect(ymd(g.start, 'gregorian')).toEqual({ y: 2025, m: 1, d: 1 });
    expect(ymd(g.end, 'gregorian')).toEqual({ y: 2026, m: 1, d: 1 });
  });

  it('week: Saturday-first for Jalali, Monday-first for Gregorian, 7 days, contains now', () => {
    const j = statementRange('week', now, 0, 'jalali');
    expect(new Date(j.start + 12 * 3600_000).getUTCDay()).toBe(6); // Saturday
    expect(j.start <= now && now < j.end).toBe(true);
    expect(Math.round((j.end - j.start) / DAY)).toBe(7);
    const g = statementRange('week', now, 0, 'gregorian');
    expect(new Date(g.start + 12 * 3600_000).getUTCDay()).toBe(1); // Monday
    const prev = statementRange('week', now, -1, 'jalali');
    expect(prev.end).toBe(j.start);
  });
});
