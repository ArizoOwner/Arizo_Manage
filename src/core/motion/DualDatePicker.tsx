// Dual Jalali / Gregorian date picker. The grid starts Saturday in Shamsi, Monday in Gregorian.
// Keyboard: arrows move by day/week (RTL-aware), PageUp/PageDown by month, Enter selects.
import { useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import {
  addDays,
  addMonths,
  leadingBlanks,
  monthLength,
  monthName,
  startOfCalendarDay,
  toCalendarDate,
  WEEKDAYS_EN_MON0,
  WEEKDAYS_FA_SAT0,
  type CalendarKind,
  type YMD,
} from '../calendar/calendar';
import { localDigits } from '../i18n/format';
import { haptic } from './motion';

export interface DatePickerProps {
  /** Selected instant (UTC ms). */
  value: number;
  onChange: (ms: number) => void;
}

const same = (a: YMD, b: YMD) => a.y === b.y && a.m === b.m && a.d === b.d;

export function DualDatePicker({ value, onChange }: DatePickerProps) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const prefCal = useSettings((s) => s.calendar);
  const [cal, setCal] = useState<CalendarKind>(prefCal);
  const selected = toCalendarDate(value, cal);
  const today = toCalendarDate(Date.now(), cal);
  const [view, setView] = useState({ y: selected.y, m: selected.m });
  const [focus, setFocus] = useState<YMD>(selected);
  const rtl = lang === 'fa';
  const weekStart = cal === 'jalali' ? 'sat' : 'mon';

  const cells = useMemo(() => {
    const blanks = leadingBlanks(cal, view.y, view.m, weekStart);
    const len = monthLength(cal, view.y, view.m);
    return [...Array<null>(blanks).fill(null), ...Array.from({ length: len }, (_, i) => i + 1)];
  }, [cal, view, weekStart]);

  const switchCal = (next: CalendarKind) => {
    const sel = toCalendarDate(value, next);
    setCal(next);
    setView({ y: sel.y, m: sel.m });
    setFocus(sel);
  };
  const move = (months: number) => {
    const n = addMonths({ ...view, d: 1 }, months, cal);
    setView({ y: n.y, m: n.m });
    setFocus({ y: n.y, m: n.m, d: Math.min(focus.d, monthLength(cal, n.y, n.m)) });
  };
  const pick = (d: YMD) => {
    haptic.tick();
    // Noon local time: a date-only pick never flips day across zones.
    onChange(startOfCalendarDay(d, cal) + 12 * 3_600_000);
  };
  const onKey = (e: KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -7, ArrowDown: 7 };
    let next: YMD | null = null;
    if (e.key in step) next = addDays(focus, step[e.key]!, cal);
    else if (e.key === 'PageUp') next = addMonths(focus, -1, cal);
    else if (e.key === 'PageDown') next = addMonths(focus, 1, cal);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      return pick(focus);
    }
    if (!next) return;
    e.preventDefault();
    setFocus(next);
    setView({ y: next.y, m: next.m });
  };

  const weekdays = cal === 'jalali' ? WEEKDAYS_FA_SAT0 : WEEKDAYS_EN_MON0;
  const title = localDigits(`${monthName(cal, view.m, lang)} ${view.y}`, lang);

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-hairline bg-surface-2 p-4" aria-label={t('calendar.pick')}>
      <div className="flex rounded-xl bg-surface-3 p-1 text-[13px] font-semibold" role="radiogroup">
        {(['jalali', 'gregorian'] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={cal === c}
            onClick={() => switchCal(c)}
            className={`min-h-9 flex-1 rounded-lg transition-colors ${cal === c ? 'bg-surface-1 text-ink shadow-sm' : 'text-ink-2'}`}
          >
            {t(`calendar.${c}`)}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} aria-label={t('calendar.prevMonth')} className="grid h-11 w-11 place-items-center rounded-xl text-ink-2 hover:bg-surface-3">
          <span aria-hidden="true">{rtl ? '›' : '‹'}</span>
        </button>
        <div className="text-[15px] font-bold" aria-live="polite">
          {title}
        </div>
        <button type="button" onClick={() => move(1)} aria-label={t('calendar.nextMonth')} className="grid h-11 w-11 place-items-center rounded-xl text-ink-2 hover:bg-surface-3">
          <span aria-hidden="true">{rtl ? '‹' : '›'}</span>
        </button>
      </div>
      <div role="grid" tabIndex={0} onKeyDown={onKey} className="grid grid-cols-7 gap-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-azure rounded-xl">
        {weekdays.map((w) => (
          <div key={w} role="columnheader" className="pb-1 text-[11px] font-semibold text-ink-2">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} />;
          const ymd = { y: view.y, m: view.m, d };
          const isSel = same(ymd, selected);
          const isToday = same(ymd, today);
          const isFocus = same(ymd, focus);
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              tabIndex={-1}
              aria-selected={isSel}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => {
                setFocus(ymd);
                pick(ymd);
              }}
              className={`grid h-10 place-items-center rounded-xl text-[14px] font-semibold tabular transition-colors ${
                isSel ? 'bg-cta text-on-accent' : isToday ? 'text-emerald-text ring-1 ring-cta' : 'text-ink hover:bg-surface-3'
              } ${isFocus && !isSel ? 'outline outline-2 outline-azure' : ''}`}
            >
              {localDigits(d, lang)}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={() => pick(today)} className="min-h-10 self-center rounded-xl px-4 text-[13px] font-semibold text-emerald-text hover:bg-surface-3">
        {t('calendar.today')}
      </button>
    </div>
  );
}
