// Unified obligations feed for the dashboard strip and reminders: cheques, loan installments,
// debts with a due date, and recurring bills (PROMPT.md §7 #2 "Upcoming Obligations Strip").
import type { CurrencyCode } from '../currency/money';
import type { Cheque, DebtReceivable, DebtSettlement, Loan, LoanInstallment, Person, RecurringRule } from '../storage/schema';
import { remainingOf } from './debts';

export type ObligationKind = 'cheque' | 'installment' | 'debt' | 'recurring';

export interface Obligation {
  kind: ObligationKind;
  id: string;
  title: string;
  due_at: number;
  amount_minor: bigint;
  currency_code: CurrencyCode;
  /** +1 money comes in (received cheque, someone repays me), −1 money goes out. */
  flow: 1 | -1;
  overdue: boolean;
}

export interface ObligationSources {
  cheques: readonly Cheque[];
  loans: readonly Loan[];
  installments: readonly LoanInstallment[];
  debts: readonly DebtReceivable[];
  settlements: readonly DebtSettlement[];
  people: readonly Person[];
  rules: readonly RecurringRule[];
}

const DAY = 86_400_000;

/** Everything due up to `now + days`, overdue first, then by date. */
export function upcomingObligations(src: ObligationSources, now: number, days = 14): Obligation[] {
  const until = now + days * DAY;
  const out: Obligation[] = [];
  const loanById = new Map(src.loans.map((l) => [l.id, l]));
  const personById = new Map(src.people.map((p) => [p.id, p]));
  for (const c of src.cheques) {
    if (c.deleted_at !== null || c.status !== 'pending' || c.due_date_at > until) continue;
    out.push({ kind: 'cheque', id: c.id, title: c.counterparty_name, due_at: c.due_date_at, amount_minor: c.amount_minor, currency_code: c.currency_code, flow: c.direction === 'received' ? 1 : -1, overdue: c.due_date_at < now - DAY / 2 });
  }
  for (const i of src.installments) {
    const loan = loanById.get(i.loan_id);
    if (!loan || loan.deleted_at !== null || i.deleted_at !== null || i.status === 'paid' || i.due_date_at > until) continue;
    out.push({ kind: 'installment', id: i.id, title: `${loan.title} · ${i.sequence_no}/${loan.installment_count}`, due_at: i.due_date_at, amount_minor: i.amount_minor, currency_code: loan.currency_code, flow: -1, overdue: i.status === 'overdue' || i.due_date_at < now - DAY / 2 });
  }
  for (const d of src.debts) {
    if (d.deleted_at !== null || d.status !== 'open' || d.due_date_at === null || d.due_date_at > until) continue;
    const left = remainingOf(d, src.settlements);
    if (left <= 0n) continue;
    out.push({ kind: 'debt', id: d.id, title: personById.get(d.person_id)?.name ?? '—', due_at: d.due_date_at, amount_minor: left, currency_code: d.currency_code, flow: d.direction === 'lent' ? 1 : -1, overdue: d.due_date_at < now - DAY / 2 });
  }
  for (const r of src.rules) {
    if (!r.is_active || r.deleted_at !== null || r.next_run_at > until) continue;
    out.push({ kind: 'recurring', id: r.id, title: r.title, due_at: r.next_run_at, amount_minor: r.amount_minor, currency_code: r.currency_code, flow: r.type === 'income' ? 1 : -1, overdue: r.next_run_at < now - DAY / 2 });
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.due_at - b.due_at);
}
