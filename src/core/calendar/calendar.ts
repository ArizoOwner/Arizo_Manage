// Unified Jalali (Shamsi) / Gregorian calendar math. Wall-clock dates are computed in a fixed
// IANA zone (default Asia/Tehran) so "today", month boundaries and daily totals don't depend on
// the phone's zone. Timestamps stay UTC epoch ms everywhere else.
import { isValidJalaaliDate, jalaaliMonthLength, toGregorian, toJalaali } from 'jalaali-js';

export type CalendarKind = 'jalali' | 'gregorian';
export interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

export const DEFAULT_TZ = 'Asia/Tehran';

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    partsFmt.set(tz, f);
  }
  return f;
}

/** Wall-clock Gregorian parts of `ms` in `tz`. */
export function zonedParts(ms: number, tz = DEFAULT_TZ): YMD & { hh: number; mm: number; ss: number } {
  const p = Object.fromEntries(fmtFor(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, hh: +p.hour!, mm: +p.minute!, ss: +p.second! };
}

/** UTC ms of a wall-clock moment in `tz` (handles DST and historic offset changes). */
export function zonedToUtc(g: YMD, tz = DEFAULT_TZ, hh = 0, mm = 0, ss = 0): number {
  const target = Date.UTC(g.y, g.m - 1, g.d, hh, mm, ss);
  let t = target;
  // Two correction passes converge for every real zone transition.
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(t, tz);
    t += target - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  }
  return t;
}

export function gregorianToJalali(g: YMD): YMD {
  const j = toJalaali(g.y, g.m, g.d);
  return { y: j.jy, m: j.jm, d: j.jd };
}
export function jalaliToGregorian(j: YMD): YMD {
  const g = toGregorian(j.y, j.m, j.d);
  return { y: g.gy, m: g.gm, d: g.gd };
}

export const gregorianMonthLength = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthLength = (cal: CalendarKind, y: number, m: number): number =>
  cal === 'jalali' ? jalaaliMonthLength(y, m) : gregorianMonthLength(y, m);

export function isValidDate(cal: CalendarKind, d: YMD): boolean {
  if (cal === 'jalali') return isValidJalaaliDate(d.y, d.m, d.d);
  return d.m >= 1 && d.m <= 12 && d.d >= 1 && d.d <= gregorianMonthLength(d.y, d.m);
}

/** Calendar date (in `cal`) of an instant, as seen in `tz`. */
export function toCalendarDate(ms: number, cal: CalendarKind, tz = DEFAULT_TZ): YMD {
  const p = zonedParts(ms, tz);
  const g = { y: p.y, m: p.m, d: p.d };
  return cal === 'jalali' ? gregorianToJalali(g) : g;
}

/** UTC ms of the local midnight that starts the given calendar date. */
export function startOfCalendarDay(date: YMD, cal: CalendarKind, tz = DEFAULT_TZ): number {
  return zonedToUtc(cal === 'jalali' ? jalaliToGregorian(date) : date, tz);
}

export const startOfDay = (ms: number, tz = DEFAULT_TZ): number =>
  startOfCalendarDay(toCalendarDate(ms, 'gregorian', tz), 'gregorian', tz);

/** Add months, clamping the day (31 Shahrivar + 1 month → 30 Mehr). */
export function addMonths(date: YMD, n: number, cal: CalendarKind): YMD {
  const idx = date.y * 12 + (date.m - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (((idx % 12) + 12) % 12) + 1;
  return { y, m, d: Math.min(date.d, monthLength(cal, y, m)) };
}

/** Add days to a calendar date (exact, via the Gregorian day count). */
export function addDays(date: YMD, n: number, cal: CalendarKind): YMD {
  const g = cal === 'jalali' ? jalaliToGregorian(date) : date;
  const t = new Date(Date.UTC(g.y, g.m - 1, g.d + n));
  const out = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  return cal === 'jalali' ? gregorianToJalali(out) : out;
}

/** Half-open [start, end) UTC range of the calendar month containing `ms`. */
export function monthRange(ms: number, cal: CalendarKind, tz = DEFAULT_TZ): { start: number; end: number; y: number; m: number } {
  const d = toCalendarDate(ms, cal, tz);
  const first = { y: d.y, m: d.m, d: 1 };
  return { start: startOfCalendarDay(first, cal, tz), end: startOfCalendarDay(addMonths(first, 1, cal), cal, tz), y: d.y, m: d.m };
}

/** Day of week of a calendar date: 0 = Saturday … 6 = Friday (Iranian week). */
export function weekdaySat0(date: YMD, cal: CalendarKind): number {
  const g = cal === 'jalali' ? jalaliToGregorian(date) : date;
  return (new Date(Date.UTC(g.y, g.m - 1, g.d)).getUTCDay() + 1) % 7;
}

/** Blank cells before day 1 in a month grid whose week starts Saturday (fa) or Monday (en). */
export function leadingBlanks(cal: CalendarKind, y: number, m: number, weekStart: 'sat' | 'mon'): number {
  const sat0 = weekdaySat0({ y, m, d: 1 }, cal);
  return weekStart === 'sat' ? sat0 : (sat0 + 5) % 7;
}

export const JALALI_MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
export const JALALI_MONTHS_EN = ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'];
export const GREGORIAN_MONTHS_FA = ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن', 'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'];
export const GREGORIAN_MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS_FA_SAT0 = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
export const WEEKDAYS_EN_MON0 = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function monthName(cal: CalendarKind, m: number, lang: 'fa' | 'en'): string {
  const list =
    cal === 'jalali' ? (lang === 'fa' ? JALALI_MONTHS_FA : JALALI_MONTHS_EN) : lang === 'fa' ? GREGORIAN_MONTHS_FA : GREGORIAN_MONTHS_EN;
  return list[m - 1]!;
}
