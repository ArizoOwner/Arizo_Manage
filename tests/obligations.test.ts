// Phase 4 gate: Sayad validation, loan schedules, atomic cheque/installment/debt postings, reminders.
import { describe, expect, it } from 'vitest';
import { ADAPTERS } from './helpers/vaults';
import { createAccount, type AccountInput } from '../src/core/ledger/accounts';
import { verifyLedger } from '../src/core/ledger/ledger';
import { annuityInstallment, buildSchedule, createLoan, loanProgress, payInstallment, refreshOverdue, unpayInstallment } from '../src/core/obligations/loans';
import { canTransition, chequeExposure, createCheque, setChequeStatus, validateCheque, type ChequeInput } from '../src/core/obligations/cheques';
import { createDebt, createPerson, personBalances, settleDebt, undoSettlement } from '../src/core/obligations/debts';
import { upcomingObligations } from '../src/core/obligations/upcoming';
import { planReminders, reminderId, type ReminderText } from '../src/core/obligations/reminders';
import { startOfCalendarDay, startOfDay, toCalendarDate } from '../src/core/calendar/calendar';
import { sumMinor } from '../src/core/currency/money';
import { isValidSayadId } from '../src/core/validators';
import type { IVaultDatabase } from '../src/core/storage/IVaultDatabase';

const NOON = 12 * 3_600_000;
const DAY = 86_400_000;
const jNoon = (y: number, m: number, d: number) => startOfCalendarDay({ y, m, d }, 'jalali') + NOON;

const acct = (db: IVaultDatabase, balance = 0n) =>
  createAccount(db, {
    name: 'ملت',
    type: 'bank_account',
    bank_code: 'mellat',
    card_number: '',
    iban_sheba: '',
    account_number: '',
    currency_code: 'IRR',
    initial_balance_minor: balance,
    card_finish: 'obsidian_carbon',
    is_included_in_net_worth: true,
    notes: '',
  } satisfies AccountInput);
const bal = async (db: IVaultDatabase, id: string) => (await db.get('accounts', id))!.current_balance_minor;
const clean = async (db: IVaultDatabase) => {
  const r = await verifyLedger(db);
  expect(r.drift).toEqual([]);
  expect(r.orphans).toEqual([]);
};

const cheque = (over: Partial<ChequeInput> = {}): ChequeInput => ({
  direction: 'issued',
  cheque_number: '123456',
  sayad_id: '1234567890123456',
  bank_code: 'mellat',
  amount_minor: 50_000_000n,
  currency_code: 'IRR',
  due_date_at: jNoon(1405, 9, 15),
  counterparty_name: 'آقای رضایی',
  account_id: null,
  reminder_days: [3, 1, 0],
  notes: '',
  ...over,
});

describe('Sayad ID validation', () => {
  it.each(['1234567890123456', '۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶', '1234 5678 9012 3456'])('accepts %s', (s) => expect(isValidSayadId(s)).toBe(true));
  it.each(['123456789012345', '12345678901234567', '0000000000000000', 'abcdabcdabcdabcd'])('rejects %s', (s) => expect(isValidSayadId(s)).toBe(false));
  it('cheque validation reports every bad field', () => {
    expect(validateCheque(cheque())).toEqual([]);
    expect(validateCheque(cheque({ sayad_id: '12', amount_minor: 0n, counterparty_name: ' ' }))).toEqual(['sayad', 'amount', 'counterparty']);
  });
});

describe('loan schedule math', () => {
  it('annuity matches the textbook formula to the Rial', () => {
    // Float reference 9,167,999.29 → half-up 9,167,999
    expect(annuityInstallment(100_000_000n, 1800, 12)).toBe(9_167_999n);
    // 4% over 36 months: reference 14,761,992.50 → half-up 14,761,993
    expect(annuityInstallment(500_000_000n, 400, 36)).toBe(14_761_993n);
  });

  it('0% splits the principal exactly, remainder on the last installments', () => {
    const rows = buildSchedule({ principal: 100_000_001n, annualRateBps: 0, count: 3, firstDueAt: jNoon(1405, 1, 10), calendar: 'jalali' });
    expect(rows.map((r) => r.amount_minor)).toEqual([33_333_333n, 33_333_334n, 33_333_334n]);
    expect(sumMinor(rows.map((r) => r.amount_minor))).toBe(100_000_001n);
  });

  it('Jalali due dates clamp to the month length and cross Nowruz', () => {
    const rows = buildSchedule({ principal: 12n, annualRateBps: 0, count: 8, firstDueAt: jNoon(1404, 6, 31), calendar: 'jalali' });
    expect(
      rows.map((r) => {
        const d = toCalendarDate(r.due_date_at, 'jalali');
        return `${d.y}/${d.m}/${d.d}`;
      }),
    ).toEqual(['1404/6/31', '1404/7/30', '1404/8/30', '1404/9/30', '1404/10/30', '1404/11/30', '1404/12/29', '1405/1/31']);
  });

  it('Gregorian schedules follow the Gregorian calendar', () => {
    const rows = buildSchedule({ principal: 3n, annualRateBps: 0, count: 2, firstDueAt: Date.UTC(2026, 0, 31, 9), calendar: 'gregorian' });
    expect(toCalendarDate(rows[1]!.due_date_at, 'gregorian')).toEqual({ y: 2026, m: 2, d: 28 });
  });

  it('the bank-printed installment overrides the formula', () => {
    const rows = buildSchedule({ principal: 100_000_000n, annualRateBps: 1800, count: 12, firstDueAt: jNoon(1405, 1, 1), calendar: 'jalali', installmentOverride: 9_200_000n });
    expect(rows.every((r) => r.amount_minor === 9_200_000n)).toBe(true);
  });

  it('rejects nonsense', () => {
    expect(() => annuityInstallment(0n, 1000, 12)).toThrow();
    expect(() => annuityInstallment(1n, 1000, 0)).toThrow();
  });
});

describe.each(ADAPTERS)('obligations — %s', (_n, make) => {
  it('clearing an issued cheque posts one expense; re-clear is a no-op; bounce voids it', async () => {
    const db = await make();
    const a = await acct(db, 100_000_000n);
    const c = await createCheque(db, cheque({ account_id: a.id }));
    await setChequeStatus(db, c.id, 'cleared');
    expect(await bal(db, a.id)).toBe(50_000_000n);
    expect((await db.get('cheques', c.id))!.linked_tx_id).not.toBeNull();
    await setChequeStatus(db, c.id, 'cleared');
    expect(await bal(db, a.id)).toBe(50_000_000n);
    await setChequeStatus(db, c.id, 'bounced');
    expect(await bal(db, a.id)).toBe(100_000_000n);
    expect((await db.get('cheques', c.id))!.linked_tx_id).toBeNull();
    await setChequeStatus(db, c.id, 'cleared'); // re-presented and cleared
    expect(await bal(db, a.id)).toBe(50_000_000n);
    await clean(db);
  });

  it('a received cheque clears as income; transitions are guarded; duplicates are refused', async () => {
    const db = await make();
    const a = await acct(db);
    const c = await createCheque(db, cheque({ direction: 'received', account_id: a.id }));
    await expect(createCheque(db, cheque({ direction: 'received' }))).rejects.toThrow('CHEQUE_DUPLICATE_SAYAD');
    expect(canTransition('cancelled', 'cleared')).toBe(false);
    await setChequeStatus(db, c.id, 'cancelled');
    await expect(setChequeStatus(db, c.id, 'cleared')).rejects.toThrow('CHEQUE_BAD_TRANSITION');
    await setChequeStatus(db, c.id, 'pending');
    await setChequeStatus(db, c.id, 'cleared');
    expect(await bal(db, a.id)).toBe(50_000_000n);
    const noAcct = await createCheque(db, cheque({ sayad_id: '9999999999999999' }));
    await expect(setChequeStatus(db, noAcct.id, 'cleared')).rejects.toThrow('CHEQUE_NEEDS_ACCOUNT');
    await clean(db);
  });

  it('exposure sums only pending cheques by direction', async () => {
    const db = await make();
    const a = await acct(db);
    await createCheque(db, cheque({ sayad_id: '1111111111111111', amount_minor: 10n }));
    await createCheque(db, cheque({ sayad_id: '2222222222222222', direction: 'received', amount_minor: 3n }));
    const cleared = await createCheque(db, cheque({ sayad_id: '3333333333333333', amount_minor: 100n, account_id: a.id }));
    await setChequeStatus(db, cleared.id, 'cleared');
    expect(chequeExposure(await db.find('cheques'))).toEqual({ issued: 10n, received: 3n, net: -7n });
  });

  it('loan: disbursement income, each installment paid once, pay-off, undo', async () => {
    const db = await make();
    const a = await acct(db);
    const loan = await createLoan(db, {
      title: 'وام خرید خودرو',
      lender_name: 'بانک ملت',
      principal_minor: 100_000_000n,
      interest_rate_bps: 1800,
      installment_count: 3,
      first_due_at: jNoon(1405, 9, 1),
      account_id: a.id,
      currency_code: 'IRR',
      calendar: 'jalali',
      post_disbursement: true,
      notes: '',
    });
    expect(await bal(db, a.id)).toBe(100_000_000n);
    const insts = (await db.find('loan_installments', { loan_id: loan.id })).sort((x, y) => x.sequence_no - y.sequence_no);
    expect(insts.length).toBe(3);
    expect(insts.every((i) => i.amount_minor === loan.installment_amount_minor)).toBe(true);
    expect((await payInstallment(db, insts[0]!.id)).created).toBe(true);
    expect((await payInstallment(db, insts[0]!.id)).created).toBe(false);
    expect(await bal(db, a.id)).toBe(100_000_000n - loan.installment_amount_minor);
    await payInstallment(db, insts[1]!.id);
    await payInstallment(db, insts[2]!.id);
    expect((await db.get('loans', loan.id))!.status).toBe('paid_off');
    expect(loanProgress(await db.find('loan_installments', { loan_id: loan.id })).remaining).toBe(0n);
    await unpayInstallment(db, insts[2]!.id);
    expect((await db.get('loans', loan.id))!.status).toBe('active');
    expect(await bal(db, a.id)).toBe(100_000_000n - 2n * loan.installment_amount_minor);
    await clean(db);
  });

  it('overdue installments are flagged after their day; paying still works', async () => {
    const db = await make();
    const a = await acct(db);
    const loan = await createLoan(db, { title: 'قرض‌الحسنه', lender_name: 'رسالت', principal_minor: 30n, interest_rate_bps: 0, installment_count: 3, first_due_at: jNoon(1405, 1, 1), account_id: a.id, currency_code: 'IRR', calendar: 'jalali', post_disbursement: false, notes: '' });
    expect(await refreshOverdue(db, jNoon(1405, 2, 5))).toBe(2);
    const insts = await db.find('loan_installments', { loan_id: loan.id });
    expect(insts.filter((i) => i.status === 'overdue').length).toBe(2);
    const overdue = insts.find((i) => i.status === 'overdue')!;
    await payInstallment(db, overdue.id);
    expect((await db.get('loan_installments', overdue.id))!.status).toBe('paid');
    await expect(
      createLoan(db, { title: '', lender_name: '', principal_minor: 1n, interest_rate_bps: 0, installment_count: 1, first_due_at: 0, account_id: null, currency_code: 'IRR', calendar: 'jalali', post_disbursement: false, notes: '' }),
    ).rejects.toThrow('LOAN_TITLE');
  });

  it('debts: partial settlements, no overpay, full settle closes, undo reopens, per-person net', async () => {
    const db = await make();
    const a = await acct(db, 10_000_000n);
    const ali = await createPerson(db, { name: 'علی', phone: '+989121234567', notes: '' });
    expect(ali.phone).toBe('09121234567');
    const lent = await createDebt(db, { person_id: ali.id, direction: 'lent', amount_minor: 3_000_000n, currency_code: 'IRR', due_date_at: null, account_id: a.id, post_opening: true, note: '' });
    expect(await bal(db, a.id)).toBe(7_000_000n);
    await settleDebt(db, lent.id, 1_000_000n, a.id);
    await expect(settleDebt(db, lent.id, 2_000_001n, a.id)).rejects.toThrow('SETTLE_AMOUNT');
    const last = await settleDebt(db, lent.id, 2_000_000n, a.id);
    expect((await db.get('debts_receivables', lent.id))!.status).toBe('settled');
    expect(await bal(db, a.id)).toBe(10_000_000n);
    await undoSettlement(db, last.id);
    expect((await db.get('debts_receivables', lent.id))!.status).toBe('open');
    expect(await bal(db, a.id)).toBe(8_000_000n);
    await createDebt(db, { person_id: ali.id, direction: 'borrowed', amount_minor: 500_000n, currency_code: 'IRR', due_date_at: null, account_id: null, post_opening: false, note: '' });
    const net = personBalances(await db.find('debts_receivables'), await db.find('debt_settlements'));
    expect(net.get(ali.id)?.get('IRR')).toBe(2_000_000n - 500_000n);
    await clean(db);
  });
});

describe('upcoming obligations and reminders', () => {
  const now = jNoon(1405, 8, 28);
  const base = { created_at: 0, updated_at: 0, deleted_at: null };
  const pendingCheque = (id: string, direction: 'issued' | 'received', amount: bigint, due: number, who: string, days: number[]) => ({
    ...base,
    id,
    direction,
    cheque_number: id,
    sayad_id: '1234567890123456',
    bank_code: null,
    amount_minor: amount,
    currency_code: 'IRR' as const,
    due_date_at: due,
    counterparty_name: who,
    account_id: null,
    status: 'pending' as const,
    linked_tx_id: null,
    reminder_days_json: days,
    notes: '',
  });
  const src = {
    cheques: [pendingCheque('c1', 'issued', 50n, now + 3 * DAY, 'رضایی', [3, 1, 0]), pendingCheque('c2', 'received', 70n, now - 2 * DAY, 'کریمی', [1]), pendingCheque('c3', 'issued', 90n, now + 40 * DAY, 'دور', [0])],
    loans: [{ ...base, id: 'l1', title: 'وام', lender_name: 'ملت', principal_minor: 1n, interest_rate_bps: 0, installment_count: 2, installment_amount_minor: 5n, start_date_at: now, account_id: null, currency_code: 'IRR' as const, notes: '', status: 'active' as const }],
    installments: [
      { ...base, id: 'i1', loan_id: 'l1', sequence_no: 1, due_date_at: now + DAY, amount_minor: 5n, status: 'upcoming' as const, paid_at: null, paid_tx_id: null },
      { ...base, id: 'i2', loan_id: 'l1', sequence_no: 2, due_date_at: now + 31 * DAY, amount_minor: 5n, status: 'upcoming' as const, paid_at: null, paid_tx_id: null },
    ],
    debts: [{ ...base, id: 'd1', person_id: 'p1', direction: 'lent' as const, amount_minor: 100n, currency_code: 'IRR' as const, due_date_at: now + 5 * DAY, account_id: null, status: 'open' as const, note: '' }],
    settlements: [{ ...base, id: 's1', debt_id: 'd1', amount_minor: 40n, account_id: 'a', settled_at: 0, tx_id: null }],
    people: [{ ...base, id: 'p1', name: 'علی', phone: null, notes: '' }],
    rules: [],
  };

  it('collects the next 14 days, overdue first, debts net of settlements', () => {
    const list = upcomingObligations(src, now);
    expect(list.map((o) => o.id)).toEqual(['c2', 'i1', 'c1', 'd1']);
    expect(list[0]!.overdue).toBe(true);
    expect(list.find((o) => o.id === 'd1')!.amount_minor).toBe(60n);
    expect(list.find((o) => o.id === 'c2')!.flow).toBe(1);
  });

  const text: ReminderText = {
    genericTitle: 'یادآور مالی',
    genericBody: 'یک تعهد مالی نزدیک است',
    cheque: (d, who, amt) => `چک ${who} ${amt} (${d})`,
    installment: (d, t, amt) => `قسط ${t} ${amt} (${d})`,
    debt: (d, who, amt) => `طلب ${who} ${amt} (${d})`,
  };
  const plan = (detailed: boolean) => planReminders(src, { now, startOfDay: (ms) => startOfDay(ms), detailed, text, formatAmount: (m) => `${m}` });

  it('privacy by default: no names or amounts unless opted in', () => {
    const generic = plan(false);
    expect(generic.length).toBeGreaterThan(0);
    for (const r of generic) {
      expect(r.title).toBe('یادآور مالی');
      expect(r.body).toBe('یک تعهد مالی نزدیک است');
    }
    expect(plan(true).some((r) => r.body.includes('رضایی'))).toBe(true);
  });

  it('only future reminders, at 09:00 local, with stable unique 31-bit ids', () => {
    const rs = plan(false);
    expect(rs.every((r) => r.at > now)).toBe(true);
    expect(new Set(rs.map((r) => r.id)).size).toBe(rs.length);
    expect(rs.every((r) => r.id > 0 && r.id <= 0x7fffffff)).toBe(true);
    const c1 = rs.filter((r) => r.entityId === 'c1');
    // c1 is due in 3 days; its "3 days before" slot is 09:00 today, already past at noon → skipped.
    expect(c1.length).toBe(2); // 1 and 0 days before
    for (const r of c1) expect(r.at - startOfDay(r.at)).toBe(9 * 3_600_000);
    expect(rs.some((r) => r.entityId === 'c2')).toBe(false); // already past due
    expect(reminderId('cheque:c1:3')).toBe(reminderId('cheque:c1:3'));
  });
});
