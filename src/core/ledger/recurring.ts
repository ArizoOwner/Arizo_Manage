// Recurring engine (PROMPT.md §4.1 #12, Phase 3). Occurrences fall at local noon on the rule's day.
// Each occurrence posts through postLinkedTransaction with id "<rule>@<occurrence ms>", so running
// the engine twice, or paying early from the dashboard, can never double-post.
import { addDays, addMonths, DEFAULT_TZ, monthLength, startOfCalendarDay, toCalendarDate, weekdaySat0, type CalendarKind } from '../calendar/calendar';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import type { Cadence, RecurringRule } from '../storage/schema';
import { postLinkedTransaction } from './ledger';

const NOON = 12 * 3_600_000;
/** Safety cap for catch-up after a long time away (a daily rule left for over a year). */
export const MAX_CATCHUP = 400;

const noonOf = (d: { y: number; m: number; d: number }, cal: CalendarKind, tz: string) => startOfCalendarDay(d, cal, tz) + NOON;

/**
 * First occurrence strictly after `afterMs`.
 * day_of_period: weekly = weekday (0 = Saturday … 6 = Friday); monthly = day 1–31, clamped to the
 * month's length; yearly = month × 100 + day in the Jalali calendar (e.g. 1230 = 30 Esfand, clamped).
 */
export function nextOccurrence(cadence: Cadence, dayOfPeriod: number, afterMs: number, tz = DEFAULT_TZ): number {
  const cal: CalendarKind = cadence === 'monthly_gregorian' ? 'gregorian' : 'jalali';
  const today = toCalendarDate(afterMs, cal, tz);
  const check = (d: { y: number; m: number; d: number }) => {
    const t = noonOf(d, cal, tz);
    return t > afterMs ? t : null;
  };
  switch (cadence) {
    case 'daily':
      return check(today) ?? noonOf(addDays(today, 1, cal), cal, tz);
    case 'weekly':
      for (let i = 0; i <= 7; i++) {
        const d = addDays(today, i, cal);
        if (weekdaySat0(d, cal) === dayOfPeriod) {
          const t = check(d);
          if (t) return t;
        }
      }
      break;
    case 'monthly_jalali':
    case 'monthly_gregorian':
      for (let k = 0; k <= 1; k++) {
        const first = addMonths({ y: today.y, m: today.m, d: 1 }, k, cal);
        const t = check({ ...first, d: Math.min(dayOfPeriod, monthLength(cal, first.y, first.m)) });
        if (t) return t;
      }
      break;
    case 'yearly': {
      const m = Math.floor(dayOfPeriod / 100);
      const d = dayOfPeriod % 100;
      if (m < 1 || m > 12 || d < 1) break;
      for (let k = 0; k <= 1; k++) {
        const y = today.y + k;
        const t = check({ y, m, d: Math.min(d, monthLength(cal, y, m)) });
        if (t) return t;
      }
      break;
    }
  }
  throw new RangeError(`invalid day_of_period ${dayOfPeriod} for ${cadence}`);
}

/** day_of_period for a rule whose first occurrence is `ms`. */
export function dayOfPeriodFor(cadence: Cadence, ms: number, tz = DEFAULT_TZ): number {
  const cal: CalendarKind = cadence === 'monthly_gregorian' ? 'gregorian' : 'jalali';
  const d = toCalendarDate(ms, cal, tz);
  if (cadence === 'weekly') return weekdaySat0(d, cal);
  if (cadence === 'yearly') return d.m * 100 + d.d;
  return cadence === 'daily' ? 0 : d.d;
}

const occurrenceId = (rule: RecurringRule, at: number) => `${rule.id}@${at}`;

function postOccurrence(db: IVaultDatabase, rule: RecurringRule, scheduledAt: number, occurredAt: number, now: number) {
  return postLinkedTransaction(
    db,
    {
      account_id: rule.account_id,
      type: rule.type,
      amount_minor: rule.amount_minor,
      occurred_at: occurredAt,
      category_id: rule.category_id,
      merchant_name: rule.title,
      source: 'recurring',
      status: rule.auto_post ? 'posted' : 'pending_review',
      linked_entity_type: 'recurring_rule',
      linked_entity_id: occurrenceId(rule, scheduledAt),
    },
    now,
  );
}

/** Post every due occurrence of every active rule, then advance next_run_at. Returns how many were posted. */
export async function runDueRecurring(db: IVaultDatabase, now = Date.now(), tz = DEFAULT_TZ): Promise<number> {
  let posted = 0;
  for (const rule of await db.find('recurring_rules')) {
    if (!rule.is_active || rule.deleted_at !== null || rule.next_run_at > now) continue;
    await db.transaction(async (tx) => {
      let at = rule.next_run_at;
      for (let i = 0; i < MAX_CATCHUP && at <= now; i++) {
        if ((await postOccurrence(db, rule, at, at, now)).created) posted++;
        at = nextOccurrence(rule.cadence, rule.day_of_period, at, tz);
      }
      await tx.put('recurring_rules', { ...rule, next_run_at: at, updated_at: now });
    });
  }
  return posted;
}

/** "Pay now" from the Upcoming strip: post the next scheduled occurrence today and advance the rule. */
export function payRecurringNow(db: IVaultDatabase, ruleId: string, now = Date.now(), tz = DEFAULT_TZ) {
  return db.transaction(async (tx) => {
    const rule = await tx.get('recurring_rules', ruleId);
    if (!rule || rule.deleted_at !== null) throw new Error('RULE_NOT_FOUND');
    const res = await postOccurrence(db, { ...rule, auto_post: true }, rule.next_run_at, now, now);
    await tx.put('recurring_rules', { ...rule, next_run_at: nextOccurrence(rule.cadence, rule.day_of_period, rule.next_run_at, tz), updated_at: now });
    return res;
  });
}
