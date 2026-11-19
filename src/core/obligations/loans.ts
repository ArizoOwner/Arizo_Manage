// Loans & installments (PROMPT.md §4.1 #8, §7 #5). Exact bigint math; no floats.
// Interest rate is annual, in basis points. Iranian bank loans quote a fixed monthly installment
// ("اقساط مساوی"); we compute it with the annuity formula in exact rationals and round once.
import { addMonths, DEFAULT_TZ, startOfCalendarDay, toCalendarDate, type CalendarKind } from '../calendar/calendar';
import { allocateEvenly, divRoundHalfUp, sumMinor, type CurrencyCode } from '../currency/money';
import { postLinkedTransaction, voidTransaction } from '../ledger/ledger';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import type { Loan, LoanInstallment } from '../storage/schema';
import { uuidv7 } from '../utils/uuidv7';

const NOON = 12 * 3_600_000;

/** Monthly payment for an annuity, exact up to the final half-up rounding. Rate 0 → equal split. */
export function annuityInstallment(principal: bigint, annualRateBps: number, months: number): bigint {
  if (months <= 0) throw new RangeError('months must be positive');
  if (principal <= 0n) throw new RangeError('principal must be positive');
  if (annualRateBps === 0) return divRoundHalfUp(principal, BigInt(months));
  // Monthly rate r = a/b with a = bps, b = 120 000 (12 months × 10 000 bps).
  // Payment = P·r·(1+r)^n / ((1+r)^n − 1) = P·a·(b+a)^n / (b·((b+a)^n − b^n)).
  const a = BigInt(annualRateBps);
  const b = 120_000n;
  const powN = (b + a) ** BigInt(months);
  const powD = b ** BigInt(months);
  return divRoundHalfUp(principal * a * powN, b * (powN - powD));
}

export interface ScheduleRow {
  sequence_no: number;
  due_date_at: number;
  amount_minor: bigint;
}

/**
 * Installment schedule: one row per month on the first due date's day (clamped to month length) in
 * the chosen calendar. At 0% the principal is split exactly (any remainder on the last rows);
 * otherwise every row is the rounded annuity payment, or the bank's printed amount if overridden.
 */
export function buildSchedule(opts: {
  principal: bigint;
  annualRateBps: number;
  count: number;
  firstDueAt: number;
  calendar: CalendarKind;
  installmentOverride?: bigint;
  tz?: string;
}): ScheduleRow[] {
  const tz = opts.tz ?? DEFAULT_TZ;
  const first = toCalendarDate(opts.firstDueAt, opts.calendar, tz);
  let amounts: bigint[];
  if (opts.installmentOverride !== undefined) amounts = Array.from({ length: opts.count }, () => opts.installmentOverride!);
  else if (opts.annualRateBps === 0) amounts = allocateEvenly(opts.principal, opts.count).reverse();
  else {
    const p = annuityInstallment(opts.principal, opts.annualRateBps, opts.count);
    amounts = Array.from({ length: opts.count }, () => p);
  }
  return amounts.map((amount_minor, i) => ({
    sequence_no: i + 1,
    due_date_at: startOfCalendarDay(addMonths(first, i, opts.calendar), opts.calendar, tz) + NOON,
    amount_minor,
  }));
}

export interface NewLoan {
  title: string;
  lender_name: string;
  principal_minor: bigint;
  interest_rate_bps: number;
  installment_count: number;
  first_due_at: number;
  account_id: string | null;
  currency_code: CurrencyCode;
  calendar: CalendarKind;
  /** When the bank's printed installment differs from the formula, use theirs. */
  installment_override_minor?: bigint;
  /** Post the received principal as income on `account_id`. */
  post_disbursement: boolean;
  notes: string;
}

export function createLoan(db: IVaultDatabase, input: NewLoan, now = Date.now()) {
  return db.transaction(async (tx) => {
    if (!input.title.trim()) throw new Error('LOAN_TITLE');
    if (input.principal_minor <= 0n) throw new Error('LOAN_PRINCIPAL');
    if (!Number.isInteger(input.installment_count) || input.installment_count < 1 || input.installment_count > 600) throw new Error('LOAN_COUNT');
    if (!Number.isInteger(input.interest_rate_bps) || input.interest_rate_bps < 0 || input.interest_rate_bps > 100_000) throw new Error('LOAN_RATE');
    const rows = buildSchedule({
      principal: input.principal_minor,
      annualRateBps: input.interest_rate_bps,
      count: input.installment_count,
      firstDueAt: input.first_due_at,
      calendar: input.calendar,
      ...(input.installment_override_minor !== undefined ? { installmentOverride: input.installment_override_minor } : {}),
    });
    const loan: Loan = {
      id: uuidv7(now),
      created_at: now,
      updated_at: now,
      deleted_at: null,
      title: input.title.trim(),
      lender_name: input.lender_name.trim(),
      principal_minor: input.principal_minor,
      interest_rate_bps: input.interest_rate_bps,
      installment_count: input.installment_count,
      installment_amount_minor: rows[0]!.amount_minor,
      start_date_at: input.first_due_at,
      account_id: input.account_id,
      currency_code: input.currency_code,
      notes: input.notes,
      status: 'active',
    };
    await tx.put('loans', loan);
    for (const r of rows) {
      await tx.put('loan_installments', {
        id: uuidv7(now),
        created_at: now,
        updated_at: now,
        deleted_at: null,
        loan_id: loan.id,
        sequence_no: r.sequence_no,
        due_date_at: r.due_date_at,
        amount_minor: r.amount_minor,
        status: 'upcoming',
        paid_at: null,
        paid_tx_id: null,
      });
    }
    if (input.post_disbursement && input.account_id) {
      await postLinkedTransaction(
        db,
        {
          account_id: input.account_id,
          type: 'income',
          amount_minor: input.principal_minor,
          occurred_at: now,
          category_id: 'cat_loans',
          merchant_name: input.lender_name || input.title,
          note: input.title,
          source: 'loan',
          linked_entity_type: 'loan_installment',
          linked_entity_id: `${loan.id}#disbursement`,
        },
        now,
      );
    }
    return loan;
  });
}

/** Pay one installment: posts exactly one expense (idempotent) and marks it paid. */
export function payInstallment(db: IVaultDatabase, installmentId: string, opts: { account_id?: string; paid_at?: number } = {}, now = Date.now()) {
  return db.transaction(async (tx) => {
    const inst = await tx.get('loan_installments', installmentId);
    if (!inst) throw new Error('INSTALLMENT_NOT_FOUND');
    const loan = await tx.get('loans', inst.loan_id);
    if (!loan) throw new Error('LOAN_NOT_FOUND');
    if (inst.status === 'paid') return { installment: inst, created: false };
    const account_id = opts.account_id ?? loan.account_id;
    if (!account_id) throw new Error('LOAN_NEEDS_ACCOUNT');
    const res = await postLinkedTransaction(
      db,
      {
        account_id,
        type: 'expense',
        amount_minor: inst.amount_minor,
        occurred_at: opts.paid_at ?? now,
        category_id: 'cat_loans',
        merchant_name: loan.lender_name || loan.title,
        note: `${loan.title} · ${inst.sequence_no}/${loan.installment_count}`,
        source: 'loan',
        linked_entity_type: 'loan_installment',
        linked_entity_id: inst.id,
      },
      now,
    );
    const paid: LoanInstallment = { ...inst, status: 'paid', paid_at: opts.paid_at ?? now, paid_tx_id: res.tx.id, updated_at: now };
    await tx.put('loan_installments', paid);
    const all = await tx.find('loan_installments', { loan_id: loan.id });
    if (all.every((i) => i.id === paid.id || i.status === 'paid')) await tx.put('loans', { ...loan, status: 'paid_off', updated_at: now });
    return { installment: paid, created: res.created };
  });
}

/** Undo a payment: voids the linked transaction and reopens the installment (and the loan). */
export function unpayInstallment(db: IVaultDatabase, installmentId: string, now = Date.now()) {
  return db.transaction(async (tx) => {
    const inst = await tx.get('loan_installments', installmentId);
    if (!inst || inst.status !== 'paid') return;
    if (inst.paid_tx_id) await voidTransaction(db, inst.paid_tx_id, now);
    await tx.put('loan_installments', { ...inst, status: inst.due_date_at < now ? 'overdue' : 'upcoming', paid_at: null, paid_tx_id: null, updated_at: now });
    const loan = await tx.get('loans', inst.loan_id);
    if (loan && loan.status === 'paid_off') await tx.put('loans', { ...loan, status: 'active', updated_at: now });
  });
}

/** Flip upcoming → overdue once the due day has passed. Returns how many changed. */
export function refreshOverdue(db: IVaultDatabase, now = Date.now()) {
  return db.transaction(async (tx) => {
    let n = 0;
    for (const i of await tx.find('loan_installments', { status: 'upcoming' })) {
      if (i.due_date_at + NOON < now) {
        await tx.put('loan_installments', { ...i, status: 'overdue', updated_at: now });
        n++;
      }
    }
    return n;
  });
}

export function loanProgress(installments: readonly LoanInstallment[]) {
  const live = installments.filter((i) => i.deleted_at === null);
  const total = sumMinor(live.map((i) => i.amount_minor));
  const paid = sumMinor(live.filter((i) => i.status === 'paid').map((i) => i.amount_minor));
  return {
    total,
    paid,
    remaining: total - paid,
    paidCount: live.filter((i) => i.status === 'paid').length,
    count: live.length,
    overdue: live.filter((i) => i.status === 'overdue').length,
  };
}
