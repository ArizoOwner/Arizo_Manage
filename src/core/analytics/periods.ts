// Period math for analytics and budgets. Every range is half-open [start, end) in UTC ms, computed
// from wall-clock midnights in a fixed zone (Asia/Tehran by default), never from the phone's zone.
import { addDays, addMonths, DEFAULT_TZ, monthLength, monthRange, startOfCalendarDay, toCalendarDate, weekdaySat0, type CalendarKind } from '../calendar/calendar';
import type { Budget } from '../storage/schema';

export const DAY = 86_400_000;

export interface Range {
  start: number;
  end: number;
}
export interface Period extends Range {
  cal: CalendarKind;
  y: number;
  m: number;
}

export function periodOf(cal: CalendarKind, y: number, m: number, tz = DEFAULT_TZ): Period {
  const first = { y, m, d: 1 };
  return { cal, y, m, start: startOfCalendarDay(first, cal, tz), end: startOfCalendarDay(addMonths(first, 1, cal), cal, tz) };
}

export const periodAt = (ms: number, cal: CalendarKind, tz = DEFAULT_TZ): Period => ({ cal, ...monthRange(ms, cal, tz) });

export function shiftPeriod(p: Period, n: number, tz = DEFAULT_TZ): Period {
  const d = addMonths({ y: p.y, m: p.m, d: 1 }, n, p.cal);
  return periodOf(p.cal, d.y, d.m, tz);
}

export const daysInPeriod = (p: Pick<Period, 'cal' | 'y' | 'm'>): number => monthLength(p.cal, p.y, p.m);

/** Week containing `ms`, starting Saturday (Iranian week) or Monday. */
export function weekRange(ms: number, weekStart: 'sat' | 'mon', tz = DEFAULT_TZ): Range {
  const d = toCalendarDate(ms, 'gregorian', tz);
  const sat0 = weekdaySat0(d, 'gregorian');
  const first = addDays(d, -(weekStart === 'sat' ? sat0 : (sat0 + 5) % 7), 'gregorian');
  return { start: startOfCalendarDay(first, 'gregorian', tz), end: startOfCalendarDay(addDays(first, 7, 'gregorian'), 'gregorian', tz) };
}

/** The budget window that contains `ms`. */
export function budgetRange(period: Budget['period'], ms: number, cal: CalendarKind, weekStart: 'sat' | 'mon', tz = DEFAULT_TZ): Range {
  if (period === 'weekly') return weekRange(ms, weekStart, tz);
  if (period === 'monthly_jalali') return periodAt(ms, 'jalali', tz);
  if (period === 'monthly_gregorian') return periodAt(ms, 'gregorian', tz);
  // shortcut: 'custom' has no start/end columns in the schema, so it follows the user's calendar month; add columns if custom windows are ever offered.
  return periodAt(ms, cal, tz);
}

/** Local midnights of every day in [from, to), then `to` itself: day i spans [out[i], out[i+1]). */
export function dayStarts(from: number, to: number, tz = DEFAULT_TZ): number[] {
  const out: number[] = [];
  let d = toCalendarDate(from, 'gregorian', tz);
  for (let t = startOfCalendarDay(d, 'gregorian', tz); t < to && out.length < 4000; t = startOfCalendarDay(d, 'gregorian', tz)) {
    out.push(Math.max(t, from));
    d = addDays(d, 1, 'gregorian');
  }
  out.push(to);
  return out;
}

export type StatementSpan = 'week' | 'month' | 'year';

/**
 * The statement window `offset` steps back from the one holding `now` (0 = current):
 * a Saturday-first (Jalali) or Monday-first (Gregorian) week, a calendar month, or a calendar year.
 * Half-open [start, end), local midnights in `tz`.
 */
export function statementRange(span: StatementSpan, now: number, offset: number, cal: CalendarKind, tz = DEFAULT_TZ): Range {
  if (span === 'month') {
    const p = shiftPeriod(periodAt(now, cal, tz), offset, tz);
    return { start: p.start, end: p.end };
  }
  if (span === 'year') {
    const y = toCalendarDate(now, cal, tz).y + offset;
    return { start: startOfCalendarDay({ y, m: 1, d: 1 }, cal, tz), end: startOfCalendarDay({ y: y + 1, m: 1, d: 1 }, cal, tz) };
  }
  const w = weekRange(now, cal === 'jalali' ? 'sat' : 'mon', tz);
  const first = addDays(toCalendarDate(w.start, 'gregorian', tz), offset * 7, 'gregorian');
  return { start: startOfCalendarDay(first, 'gregorian', tz), end: startOfCalendarDay(addDays(first, 7, 'gregorian'), 'gregorian', tz) };
}
