// Privacy-safe local reminders (PROMPT.md §1.2 "Privacy-by-Default Notifications", Phase 4).
// Planning is pure and tested; scheduling goes through @capacitor/local-notifications on Android.
// Notifications never show amounts or names unless the user opts in (`detailed`).
import type { Cheque, LoanInstallment, Loan, DebtReceivable, Person } from '../storage/schema';

const DAY = 86_400_000;
/** Reminders fire at 09:00 local on the reminder day. */
const REMIND_HOUR_MS = 9 * 3_600_000;

export interface PlannedReminder {
  /** Stable 31-bit id so rescheduling replaces rather than duplicates. */
  id: number;
  at: number;
  title: string;
  body: string;
  kind: 'cheque' | 'installment' | 'debt';
  entityId: string;
}

export interface ReminderText {
  genericTitle: string;
  genericBody: string;
  cheque: (daysLeft: number, who: string, amount: string) => string;
  installment: (daysLeft: number, title: string, amount: string) => string;
  debt: (daysLeft: number, who: string, amount: string) => string;
}

/** FNV-1a → positive 31-bit int (Android notification ids are Java ints). */
export function reminderId(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0x7fffffff;
}

interface Inputs {
  cheques: readonly Cheque[];
  loans: readonly Loan[];
  installments: readonly LoanInstallment[];
  debts: readonly DebtReceivable[];
  people: readonly Person[];
}

export interface PlanOptions {
  now: number;
  /** Midnight-of-day function in the user's zone. */
  startOfDay: (ms: number) => number;
  detailed: boolean;
  text: ReminderText;
  formatAmount: (minor: bigint, currency: string) => string;
  /** Default lead days for installments and debts (cheques carry their own). */
  defaultDays?: number[];
  /** Android caps pending alarms; keep the soonest. */
  max?: number;
}

export function planReminders(src: Inputs, o: PlanOptions): PlannedReminder[] {
  const defaults = o.defaultDays ?? [3, 1, 0];
  const out: PlannedReminder[] = [];
  const push = (kind: PlannedReminder['kind'], entityId: string, dueAt: number, days: readonly number[], detail: (d: number) => string) => {
    const dueDay = o.startOfDay(dueAt);
    for (const d of days) {
      const at = dueDay - d * DAY + REMIND_HOUR_MS;
      if (at <= o.now) continue;
      out.push({
        id: reminderId(`${kind}:${entityId}:${d}`),
        at,
        title: o.text.genericTitle,
        body: o.detailed ? detail(d) : o.text.genericBody,
        kind,
        entityId,
      });
    }
  };
  for (const c of src.cheques) {
    if (c.deleted_at !== null || c.status !== 'pending') continue;
    push('cheque', c.id, c.due_date_at, c.reminder_days_json, (d) => o.text.cheque(d, c.counterparty_name, o.formatAmount(c.amount_minor, c.currency_code)));
  }
  const loanById = new Map(src.loans.map((l) => [l.id, l]));
  for (const i of src.installments) {
    const loan = loanById.get(i.loan_id);
    if (!loan || loan.deleted_at !== null || i.status === 'paid' || i.deleted_at !== null) continue;
    push('installment', i.id, i.due_date_at, defaults, (d) => o.text.installment(d, loan.title, o.formatAmount(i.amount_minor, loan.currency_code)));
  }
  const personById = new Map(src.people.map((p) => [p.id, p]));
  for (const debt of src.debts) {
    if (debt.deleted_at !== null || debt.status !== 'open' || debt.due_date_at === null) continue;
    push('debt', debt.id, debt.due_date_at, defaults, (d) => o.text.debt(d, personById.get(debt.person_id)?.name ?? '', o.formatAmount(debt.amount_minor, debt.currency_code)));
  }
  return out.sort((a, b) => a.at - b.at).slice(0, o.max ?? 60);
}
