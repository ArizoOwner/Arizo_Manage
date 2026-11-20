// Phase 6 gate: period boundary math, split-aware totals, transfer exclusion, budgets, health score,
// subscription detection, insights. Engine tests run on plain rows; the ledger round trip runs on both adapters.
import { describe, expect, it } from 'vitest';
import { ADAPTERS } from './helpers/vaults';
import { budgetRange, dayStarts, periodAt, periodOf, shiftPeriod, weekRange, daysInPeriod } from '../src/core/analytics/periods';
import { budgetStatus, computeAnalytics, detectSubscriptions, UNCATEGORIZED, type AnalyticsInput } from '../src/core/analytics/engine';
import { loadAnalyticsInput } from '../src/core/analytics/analyticsClient';
import { contributeGoal, deleteBudget, deleteCategory, deleteGoal, saveBudget, saveCategory, saveGoal } from '../src/core/analytics/plans';
import { createAccount, type AccountInput } from '../src/core/ledger/accounts';
import { createTransaction, createTransfer, setSplits } from '../src/core/ledger/ledger';
import { seedCategoryRows } from '../src/core/data/seedCategories';
import { seedDemoData } from '../src/core/utils/demoData';
import { startOfCalendarDay } from '../src/core/calendar/calendar';
import type { Account, Budget, Category, ExchangeRate, SavingsGoal, Transaction, TransactionSplit } from '../src/core/storage/schema';

const DAY = 86_400_000;
const H = 3_600_000;
const TEH = 3.5 * H; // Asia/Tehran has been UTC+03:30 all year since 2022.
const jal = (y: number, m: number, d: number, hour = 12) => startOfCalendarDay({ y, m, d }, 'jalali') + hour * H;
const greg = (y: number, m: number, d: number, hour = 12) => startOfCalendarDay({ y, m, d }, 'gregorian') + hour * H;

let seq = 0;
const base = (at = 0) => ({ id: `id${++seq}`, created_at: at, updated_at: at, deleted_at: null });
const acc = (over: Partial<Account> = {}): Account => ({
  ...base(),
  name: 'a',
  type: 'bank_card',
  bank_code: null,
  card_last4: null,
  card_number_enc: null,
  account_number: null,
  iban_sheba: null,
  currency_code: 'IRR',
  initial_balance_minor: 0n,
  current_balance_minor: 0n,
  card_finish: 'obsidian_carbon',
  is_included_in_net_worth: true,
  is_archived: false,
  sort_order: 0,
  notes: '',
  ...over,
});
const tx = (over: Partial<Transaction> & Pick<Transaction, 'account_id' | 'type' | 'amount_minor' | 'occurred_at'>): Transaction => ({
  ...base(over.occurred_at),
  transfer_pair_id: null,
  counterparty_account_id: null,
  currency_code: 'IRR',
  exchange_rate_to_base_ppm: null,
  category_id: null,
  merchant_name: '',
  note: '',
  source: 'manual',
  external_ref_code: null,
  sms_fingerprint_sha256: null,
  reported_balance_after_minor: null,
  linked_entity_type: null,
  linked_entity_id: null,
  status: 'posted',
  ...over,
});
const budget = (over: Partial<Budget> = {}): Budget => ({
  ...base(),
  category_id: null,
  period: 'monthly_jalali',
  limit_minor: 3_000_000n,
  currency_code: 'IRR',
  alert_thresholds_json: [50, 80, 100],
  rollover_unused: false,
  is_active: true,
  ...over,
});
const input = (over: Partial<AnalyticsInput> = {}): AnalyticsInput => ({
  accounts: [],
  transactions: [],
  splits: [],
  categories: seedCategoryRows(0),
  rates: [],
  budgets: [],
  goals: [],
  debts: [],
  settlements: [],
  installments: [],
  ...over,
});

describe('period boundary math (Asia/Tehran wall clock, half-open ranges)', () => {
  it('Nowruz: 1 Farvardin 1404 starts at local midnight of 21 March 2025', () => {
    const p = periodOf('jalali', 1404, 1);
    expect(p.start).toBe(Date.UTC(2025, 2, 21) - TEH);
    expect(new Date(p.start).toISOString()).toBe('2025-03-20T20:30:00.000Z');
    // The last millisecond of Esfand 1403 belongs to Esfand; local midnight belongs to Farvardin.
    expect(periodAt(p.start - 1, 'jalali')).toMatchObject({ y: 1403, m: 12 });
    expect(periodAt(p.start, 'jalali')).toMatchObject({ y: 1404, m: 1 });
  });

  it('Esfand has 30 days in a leap year (1403) and 29 otherwise (1404)', () => {
    expect(daysInPeriod(periodOf('jalali', 1403, 12))).toBe(30);
    expect(daysInPeriod(periodOf('jalali', 1404, 12))).toBe(29);
    const e = periodOf('jalali', 1403, 12);
    expect((e.end - e.start) / DAY).toBe(30);
    expect(e.end).toBe(periodOf('jalali', 1404, 1).start);
  });

  it('month edges: Farvardin–Shahrivar 31 days, Mehr–Bahman 30, ranges tile without gaps', () => {
    for (let m = 1; m <= 12; m++) {
      const p = periodOf('jalali', 1404, m);
      expect((p.end - p.start) / DAY).toBe(m <= 6 ? 31 : m <= 11 ? 30 : 29);
      expect(shiftPeriod(p, 1).start).toBe(p.end);
    }
    expect(shiftPeriod(periodOf('jalali', 1404, 12), 1)).toMatchObject({ y: 1405, m: 1 });
    expect(shiftPeriod(periodOf('jalali', 1404, 1), -1)).toMatchObject({ y: 1403, m: 12 });
  });

  it('Gregorian months follow Tehran midnight, including February in leap years', () => {
    const feb = periodOf('gregorian', 2028, 2);
    expect(feb.start).toBe(Date.UTC(2028, 1, 1) - TEH);
    expect((feb.end - feb.start) / DAY).toBe(29);
    expect(daysInPeriod(periodOf('gregorian', 2027, 2))).toBe(28);
    // 20:30 UTC on 31 Jan is already 1 Feb in Tehran.
    expect(periodAt(Date.UTC(2027, 0, 31, 20, 30), 'gregorian')).toMatchObject({ y: 2027, m: 2 });
    expect(periodAt(Date.UTC(2027, 0, 31, 20, 29), 'gregorian')).toMatchObject({ y: 2027, m: 1 });
  });

  it('Tehran midnight: a payment at 00:10 local counts on the new day', () => {
    const aban = periodOf('jalali', 1404, 8);
    const days = dayStarts(aban.start, aban.end);
    expect(days).toHaveLength(31); // 30 days + end
    const just = jal(1404, 8, 10, 0) + 10 * 60_000;
    expect(days.findIndex((d, k) => just >= d && just < days[k + 1]!)).toBe(9);
  });

  it('weeks start Saturday (fa) or Monday (en)', () => {
    const wed = greg(2026, 11, 18); // Wednesday
    expect(weekRange(wed, 'sat').start).toBe(greg(2026, 11, 14, 0));
    expect(weekRange(wed, 'mon').start).toBe(greg(2026, 11, 16, 0));
    expect(weekRange(wed, 'sat').end - weekRange(wed, 'sat').start).toBe(7 * DAY);
    expect(budgetRange('monthly_gregorian', wed, 'jalali', 'sat')).toMatchObject({ start: greg(2026, 11, 1, 0), end: greg(2026, 12, 1, 0) });
  });
});

describe('cashflow and categories', () => {
  const a = acc();
  const b = acc();
  const now = jal(1404, 8, 20);

  it('transfers, adjustments, pending, voided and trashed rows never count as income or expense', () => {
    const r = computeAnalytics(
      input({
        accounts: [a, b],
        transactions: [
          tx({ account_id: a.id, type: 'income', amount_minor: 10_000_000n, occurred_at: jal(1404, 8, 2), category_id: 'cat_salary' }),
          tx({ account_id: a.id, type: 'expense', amount_minor: 2_000_000n, occurred_at: jal(1404, 8, 3), category_id: 'cat_food' }),
          tx({ account_id: a.id, type: 'transfer_out', amount_minor: 5_000_000n, occurred_at: jal(1404, 8, 4), transfer_pair_id: 'p' }),
          tx({ account_id: b.id, type: 'transfer_in', amount_minor: 5_000_000n, occurred_at: jal(1404, 8, 4), transfer_pair_id: 'p' }),
          tx({ account_id: a.id, type: 'adjustment', amount_minor: -700_000n, occurred_at: jal(1404, 8, 5) }),
          tx({ account_id: a.id, type: 'expense', amount_minor: 9_000_000n, occurred_at: jal(1404, 8, 6), status: 'pending_review' }),
          tx({ account_id: a.id, type: 'expense', amount_minor: 9_000_000n, occurred_at: jal(1404, 8, 6), status: 'voided' }),
          tx({ account_id: a.id, type: 'expense', amount_minor: 9_000_000n, occurred_at: jal(1404, 8, 6), deleted_at: 1 }),
        ],
      }),
      { now, cal: 'jalali', y: 1404, m: 8 },
    );
    expect(r.cashflow).toMatchObject({ income: 10_000_000n, expense: 2_000_000n, net: 8_000_000n, savingsBps: 8000 });
    expect(r.categories.map((c) => [c.id, c.total])).toEqual([['cat_food', 2_000_000n]]);
    expect(r.sankey.links.reduce((s, l) => s + l.value, 0n)).toBe(12_000_000n);
  });

  it('a split transaction counts once per split category; sub-categories roll up with drill-down', () => {
    const sub: Category = { ...seedCategoryRows(0)[0]!, id: 'cat_food_cafe', parent_id: 'cat_food', name_fa: 'کافه', name_en: 'Cafe', is_system: false };
    const t1 = tx({ account_id: a.id, type: 'expense', amount_minor: 1_000_000n, occurred_at: jal(1404, 8, 7), category_id: 'cat_food', merchant_name: 'X' });
    const splits: TransactionSplit[] = [
      { ...base(), transaction_id: t1.id, category_id: 'cat_food_cafe', amount_minor: 300_000n, note: '' },
      { ...base(), transaction_id: t1.id, category_id: 'cat_grocery', amount_minor: 700_000n, note: '' },
    ];
    const t2 = tx({ account_id: a.id, type: 'expense', amount_minor: 200_000n, occurred_at: jal(1404, 8, 8), category_id: 'cat_food' });
    const t3 = tx({ account_id: a.id, type: 'expense', amount_minor: 50_000n, occurred_at: jal(1404, 8, 8) });
    const r = computeAnalytics(input({ accounts: [a], transactions: [t1, t2, t3], splits, categories: [...seedCategoryRows(0), sub] }), { now, cal: 'jalali', y: 1404, m: 8 });
    expect(r.cashflow.expense).toBe(1_250_000n);
    expect(r.categories.map((c) => [c.id, c.total])).toEqual([
      ['cat_grocery', 700_000n],
      ['cat_food', 500_000n],
      [UNCATEGORIZED, 50_000n],
    ]);
    const food = r.categories.find((c) => c.id === 'cat_food')!;
    expect(food.children.map((c) => [c.id, c.total])).toEqual([
      ['cat_food_cafe', 300_000n],
      ['cat_food', 200_000n],
    ]);
    expect(food.children[0]!.txs.map((x) => x.id)).toEqual([t1.id]);
  });

  it('foreign currency converts with manual rates; missing rates are listed, not guessed', () => {
    const usd = acc({ currency_code: 'USD' });
    const eur = acc({ currency_code: 'EUR' });
    const rate: ExchangeRate = { ...base(), base_currency: 'USD', quote_currency: 'IRR', rate_ppm: 1_000_000n * 1_000_000n, effective_at: 0 };
    const r = computeAnalytics(
      input({
        accounts: [usd, eur],
        rates: [rate],
        transactions: [
          tx({ account_id: usd.id, type: 'expense', amount_minor: 1_250n, currency_code: 'USD', occurred_at: jal(1404, 8, 2), category_id: 'cat_travel' }),
          tx({ account_id: eur.id, type: 'expense', amount_minor: 999n, currency_code: 'EUR', occurred_at: jal(1404, 8, 2), category_id: 'cat_travel' }),
        ],
      }),
      { now, cal: 'jalali', y: 1404, m: 8 },
    );
    expect(r.cashflow.expense).toBe(12_500_000n); // $12.50 × 1,000,000 Rial
    expect(r.missingRates).toEqual(['EUR']);
    expect(r.insights.some((i) => i.key === 'missingRates' && i.currencies === 'EUR')).toBe(true);
  });

  it('delta vs previous period, the 6-month series and the daily heatmap', () => {
    const r = computeAnalytics(
      input({
        accounts: [a],
        transactions: [
          tx({ account_id: a.id, type: 'expense', amount_minor: 1_000_000n, occurred_at: jal(1404, 7, 10), category_id: 'cat_food' }),
          tx({ account_id: a.id, type: 'expense', amount_minor: 1_500_000n, occurred_at: jal(1404, 8, 10), category_id: 'cat_food' }),
        ],
      }),
      { now, cal: 'jalali', y: 1404, m: 8 },
    );
    expect(r.cashflow.deltaExpenseBps).toBe(5000);
    expect(r.months.map((x) => x.m)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(r.months.at(-2)!.expense).toBe(1_000_000n);
    expect(r.heatmap).toHaveLength(30);
    expect(r.heatmap[9]!.expense).toBe(1_500_000n);
  });

  it('net worth trajectory walks balances back from the current balance', () => {
    const w = acc({ current_balance_minor: 7_000_000n, created_at: jal(1404, 1, 1) });
    const r = computeAnalytics(
      input({
        accounts: [w],
        transactions: [
          tx({ account_id: w.id, type: 'income', amount_minor: 10_000_000n, occurred_at: jal(1404, 8, 5) }),
          tx({ account_id: w.id, type: 'expense', amount_minor: 3_000_000n, occurred_at: jal(1404, 8, 15) }),
        ],
      }),
      { now, cal: 'jalali', y: 1404, m: 8 },
    );
    const at = (ms: number) => r.netWorth.filter((p) => p.at < ms).at(-1)!.value;
    expect(at(jal(1404, 8, 5, 0))).toBe(0n);
    expect(at(jal(1404, 8, 15, 0))).toBe(10_000_000n);
    expect(r.netWorth.at(-1)!.value).toBe(7_000_000n);
    expect(r.netWorth.at(-1)!.at).toBe(jal(1404, 8, 21, 0) - 1);
  });
});

describe('budgets: burn rate, safe-to-spend, rollover, alerts, velocity', () => {
  const spentFor = (map: Map<number, bigint>) => (r: { start: number }) => map.get(r.start) ?? 0n;
  const aban = periodOf('jalali', 1404, 8); // 30 days

  it('day 10 of 30 with 1,200,000 of 3,000,000 spent', () => {
    const s = budgetStatus(budget(), jal(1404, 8, 10), 'jalali', 'sat', 'Asia/Tehran', spentFor(new Map([[aban.start, 1_200_000n]])));
    expect(s).toMatchObject({ daysTotal: 30, daysElapsed: 10, daysLeft: 21, spent: 1_200_000n, remaining: 1_800_000n, usedPct: 40, alert: null });
    expect(s.safePerDay).toBe(85_714n); // 1,800,000 / 21 days (today included), rounded down
    expect(s.projected).toBe(3_600_000n); // velocity: 1,200,000 × 30 / 10
    expect(s.projectedOver).toBe(true);
  });

  it('alert thresholds 50/80/100 report the highest one reached', () => {
    const at = (spent: bigint) => budgetStatus(budget(), jal(1404, 8, 25), 'jalali', 'sat', 'Asia/Tehran', spentFor(new Map([[aban.start, spent]]))).alert;
    expect(at(1_499_999n)).toBe(null);
    expect(at(1_500_000n)).toBe(50);
    expect(at(2_400_000n)).toBe(80);
    expect(at(3_200_000n)).toBe(100);
  });

  it('overspent budgets have zero safe-to-spend; rollover carries only unused amounts', () => {
    const over = budgetStatus(budget(), jal(1404, 8, 10), 'jalali', 'sat', 'Asia/Tehran', spentFor(new Map([[aban.start, 3_100_000n]])));
    expect(over.safePerDay).toBe(0n);
    expect(over.remaining).toBe(-100_000n);
    const mehr = periodOf('jalali', 1404, 7);
    const roll = budgetStatus(budget({ rollover_unused: true }), jal(1404, 8, 1), 'jalali', 'sat', 'Asia/Tehran', spentFor(new Map([[mehr.start, 2_000_000n]])));
    expect(roll.carry).toBe(1_000_000n);
    expect(roll.effectiveLimit).toBe(4_000_000n);
    expect(roll.daysElapsed).toBe(1);
    const noCarry = budgetStatus(budget({ rollover_unused: true }), jal(1404, 8, 1), 'jalali', 'sat', 'Asia/Tehran', spentFor(new Map([[mehr.start, 3_500_000n]])));
    expect(noCarry.carry).toBe(0n);
  });

  it('category budgets include sub-categories and split pieces only', () => {
    const a = acc();
    const sub: Category = { ...seedCategoryRows(0)[0]!, id: 'cat_food_cafe', parent_id: 'cat_food', is_system: false };
    const t1 = tx({ account_id: a.id, type: 'expense', amount_minor: 1_000_000n, occurred_at: jal(1404, 8, 3) });
    const splits: TransactionSplit[] = [
      { ...base(), transaction_id: t1.id, category_id: 'cat_food_cafe', amount_minor: 400_000n, note: '' },
      { ...base(), transaction_id: t1.id, category_id: 'cat_fuel', amount_minor: 600_000n, note: '' },
    ];
    const r = computeAnalytics(
      input({
        accounts: [a],
        categories: [...seedCategoryRows(0), sub],
        transactions: [t1, tx({ account_id: a.id, type: 'expense', amount_minor: 100_000n, occurred_at: jal(1404, 8, 4), category_id: 'cat_food' })],
        splits,
        budgets: [budget({ category_id: 'cat_food' }), budget({ category_id: null, period: 'monthly_gregorian' })],
      }),
      { now: jal(1404, 8, 6), cal: 'jalali', y: 1404, m: 8 },
    );
    expect(r.budgets[0]!.spent).toBe(500_000n);
    expect(r.budgets[1]!.spent).toBe(1_100_000n);
  });
});

describe('savings goals', () => {
  it('tracks a linked account balance and computes the monthly amount needed', () => {
    const a = acc({ current_balance_minor: 25_000_000n });
    const now = jal(1404, 8, 1);
    const goal: SavingsGoal = { ...base(), name: 'g', target_minor: 100_000_000n, current_minor: 0n, currency_code: 'IRR', linked_account_id: a.id, deadline_at: now + 90 * DAY, icon_name: '', color_hex: '' };
    const manual: SavingsGoal = { ...goal, id: 'manual', linked_account_id: null, current_minor: 120_000_000n, deadline_at: null };
    const r = computeAnalytics(input({ accounts: [a], goals: [goal, manual] }), { now, cal: 'jalali', y: 1404, m: 8 });
    expect(r.goals[0]).toMatchObject({ current: 25_000_000n, pct: 25, remaining: 75_000_000n, daysLeft: 90, perMonth: 25_000_000n, overdue: false });
    expect(r.goals[1]).toMatchObject({ pct: 100, remaining: 0n, perMonth: null });
  });
});

describe('Financial Health Score (0–100)', () => {
  const now = jal(1404, 8, 20);
  const salary = (m: number, amount = 100_000_000n) => tx({ account_id: 'x', type: 'income', amount_minor: amount, occurred_at: jal(1404, m, 2) });
  const spend = (m: number, amount: bigint) => tx({ account_id: 'x', type: 'expense', amount_minor: amount, occurred_at: jal(1404, m, 3), category_id: 'cat_food' });

  it('is null without any history', () => {
    expect(computeAnalytics(input(), { now, cal: 'jalali', y: 1404, m: 8 }).health.score).toBe(null);
  });

  it('a perfect profile scores 100: ≥20% saved, 6+ months liquid, no debt, budgets on track, flat spending', () => {
    const a = acc({ id: 'x', current_balance_minor: 1_000_000_000n });
    const txs = [5, 6, 7, 8].flatMap((m) => [salary(m), spend(m, 50_000_000n)]);
    const r = computeAnalytics(input({ accounts: [a], transactions: txs, budgets: [budget({ limit_minor: 500_000_000n })] }), { now, cal: 'jalali', y: 1404, m: 8 });
    expect(r.health).toEqual({ score: 100, parts: { savings: 30, emergency: 25, debt: 20, budgets: 15, trend: 10 } });
  });

  it('each component scales linearly and the total is their sum', () => {
    // Savings 10% → 15; liquid 270M / 90M a month = 3 months → 12.5 → 13; debt 25% of assets → 10;
    // no budgets → 8 (neutral); expense flat vs the 3 months before → 10.
    const a = acc({ id: 'x', current_balance_minor: 270_000_000n });
    const debts = [{ ...base(), person_id: 'p', direction: 'borrowed' as const, amount_minor: 67_500_000n, currency_code: 'IRR' as const, due_date_at: null, account_id: null, status: 'open' as const, note: '' }];
    const txs = [5, 6, 7, 8].flatMap((m) => [salary(m), spend(m, 90_000_000n)]);
    const r = computeAnalytics(input({ accounts: [a], transactions: txs, debts }), { now, cal: 'jalali', y: 1404, m: 8 });
    expect(r.health.parts).toEqual({ savings: 15, emergency: 13, debt: 10, budgets: 8, trend: 10 });
    expect(r.health.score).toBe(56);
  });

  it('overspending, no cushion and rising expenses push it to the floor', () => {
    const a = acc({ id: 'x', current_balance_minor: 0n });
    const txs = [salary(5, 10_000_000n), spend(5, 10_000_000n), salary(6, 10_000_000n), spend(6, 10_000_000n), salary(7, 10_000_000n), spend(7, 10_000_000n), salary(8, 10_000_000n), spend(8, 30_000_000n)];
    const r = computeAnalytics(input({ accounts: [a], transactions: txs, budgets: [budget({ limit_minor: 1_000_000n })] }), { now, cal: 'jalali', y: 1404, m: 8 });
    expect(r.health.parts).toEqual({ savings: 0, emergency: 0, debt: 20, budgets: 0, trend: 0 });
    expect(r.health.score).toBe(20);
  });
});

describe('Subscription Detector', () => {
  const now = greg(2026, 11, 20);
  const ch = (merchant: string, daysAgo: number, amount: bigint, over: Partial<Transaction> = {}) =>
    tx({ account_id: 'a', type: 'expense', amount_minor: amount, occurred_at: now - daysAgo * DAY, merchant_name: merchant, category_id: 'cat_fun', ...over });
  const value = (t: Transaction) => t.amount_minor;

  it('finds a monthly merchant with a similar amount and a regular interval', () => {
    const subs = detectSubscriptions([ch('فیلیمو', 93, 1_990_000n), ch('فیلیمو ', 63, 1_990_000n), ch('فیلیمو', 33, 2_090_000n), ch('فیلیمو', 3, 1_990_000n)], now, value);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ merchant: 'فیلیمو', cadence: 'monthly', amount: 1_990_000n, monthly: 1_990_000n, count: 4 });
    expect(subs[0]!.next).toBe(now - 3 * DAY + 30 * DAY);
  });

  it('weekly and yearly cadences normalise to a monthly cost', () => {
    const subs = detectSubscriptions(
      [ch('gym', 21, 1_200_000n), ch('gym', 14, 1_200_000n), ch('gym', 7, 1_200_000n), ch('gym', 0, 1_200_000n), ch('icloud', 731, 12_000_000n), ch('icloud', 366, 12_000_000n), ch('icloud', 1, 12_000_000n)],
      now,
      value,
    );
    expect(subs.find((s) => s.merchant === 'gym')).toMatchObject({ cadence: 'weekly', monthly: 5_200_000n });
    expect(subs.find((s) => s.merchant === 'icloud')).toMatchObject({ cadence: 'yearly', monthly: 1_000_000n });
  });

  it('rejects irregular intervals, different amounts, too few charges, stale series and loan postings', () => {
    expect(detectSubscriptions([ch('snapp', 40, 500_000n), ch('snapp', 21, 500_000n), ch('snapp', 2, 500_000n)], now, value)).toEqual([]);
    expect(detectSubscriptions([ch('shop', 60, 500_000n), ch('shop', 30, 900_000n), ch('shop', 0, 500_000n)], now, value)).toEqual([]);
    expect(detectSubscriptions([ch('two', 30, 500_000n), ch('two', 0, 500_000n)], now, value)).toEqual([]);
    expect(detectSubscriptions([ch('old', 200, 500_000n), ch('old', 170, 500_000n), ch('old', 140, 500_000n)], now, value)).toEqual([]);
    expect(detectSubscriptions([ch('bank', 60, 9_000_000n, { source: 'loan' }), ch('bank', 30, 9_000_000n, { source: 'loan' }), ch('bank', 0, 9_000_000n, { source: 'loan' })], now, value)).toEqual([]);
    expect(detectSubscriptions([ch('t', 60, 1n, { type: 'transfer_out' }), ch('t', 30, 1n, { type: 'transfer_out' }), ch('t', 0, 1n, { type: 'transfer_out' })], now, value)).toEqual([]);
  });
});

describe('insights', () => {
  it('flags a category 35% above its 3-month average', () => {
    const a = acc();
    const food = (m: number, v: bigint) => tx({ account_id: a.id, type: 'expense', amount_minor: v, occurred_at: jal(1404, m, 2), category_id: 'cat_food' });
    const r = computeAnalytics(input({ accounts: [a], transactions: [food(5, 1_000_000n), food(6, 1_000_000n), food(7, 1_000_000n), food(8, 1_350_000n)] }), {
      now: jal(1404, 8, 20),
      cal: 'jalali',
      y: 1404,
      m: 8,
    });
    expect(r.insights).toContainEqual({ key: 'catUp', tone: 'warn', cat: 'cat_food', pct: 35 });
  });

  it('stays quiet when the 3-month history starts mid-window (no misleading averages)', () => {
    const a = acc();
    const food = (m: number, d: number, v: bigint) => tx({ account_id: a.id, type: 'expense', amount_minor: v, occurred_at: jal(1404, m, d), category_id: 'cat_food' });
    const r = computeAnalytics(input({ accounts: [a], transactions: [food(5, 20, 100_000n), food(6, 5, 1_000_000n), food(7, 5, 1_000_000n), food(8, 5, 1_350_000n)] }), {
      now: jal(1404, 8, 20),
      cal: 'jalali',
      y: 1404,
      m: 8,
    });
    expect(r.insights.filter((i) => i.key === 'catUp' || i.key === 'catDown')).toEqual([]);
  });
});

describe.each(ADAPTERS)('ledger round trip on %s', (_name, make) => {
  const accInput = (over: Partial<AccountInput> = {}): AccountInput => ({
    name: 'a',
    type: 'bank_card',
    bank_code: null,
    card_number: '',
    iban_sheba: '',
    account_number: '',
    currency_code: 'IRR',
    initial_balance_minor: 50_000_000n,
    card_finish: 'obsidian_carbon',
    is_included_in_net_worth: true,
    notes: '',
    ...over,
  });

  it('real splits and transfers through the ledger: splits count per category, transfers never', async () => {
    const db = await make();
    const now = jal(1404, 8, 20);
    const t0 = jal(1404, 1, 1);
    const a = await createAccount(db, accInput(), t0);
    const b = await createAccount(db, accInput({ name: 'b' }), t0);
    const split = await createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 900_000n, occurred_at: jal(1404, 8, 3), category_id: null, merchant_name: 'هایپر' }, now);
    await setSplits(db, split.id, [
      { category_id: 'cat_grocery', amount_minor: 600_000n },
      { category_id: 'cat_health', amount_minor: 300_000n },
    ]);
    await createTransfer(db, { from_account_id: a.id, to_account_id: b.id, amount_minor: 10_000_000n, fee_minor: 5_000n, fee_category_id: 'cat_bank_fee', occurred_at: jal(1404, 8, 4) }, now);
    const r = computeAnalytics(await loadAnalyticsInput(db), { now, cal: 'jalali', y: 1404, m: 8 });
    expect(r.cashflow.income).toBe(0n);
    const byId = Object.fromEntries(r.categories.map((c) => [c.id, c.total]));
    expect(byId.cat_grocery).toBe(600_000n);
    expect(byId.cat_health).toBe(300_000n);
    // The fee is a real expense; the transfer pair itself is not.
    expect(r.cashflow.expense).toBe(900_000n + (byId.cat_bank_fee ?? 0n));
    expect(r.cashflow.expense < 10_000_000n).toBe(true);
    expect(r.netWorth.at(-1)!.value).toBe(100_000_000n - r.cashflow.expense);
  });

  it('90 days of demo data produce a coherent report', async () => {
    const db = await make();
    // 00:00 local, so every row the seeder writes for "today" (09:00–15:00) is inside today.
    const now = greg(2026, 11, 20, 0);
    await seedDemoData(db, { now });
    const inp = await loadAnalyticsInput(db);
    const p = periodAt(now, 'jalali');
    const r = computeAnalytics(inp, { now, cal: 'jalali', y: p.y, m: p.m });
    expect(r.categories.reduce((s, c) => s + c.total, 0n)).toBe(r.cashflow.expense);
    expect(r.heatmap.reduce((s, d) => s + d.expense, 0n)).toBe(r.cashflow.expense);
    expect(r.health.score).not.toBe(null);
    expect(r.health.score!).toBeGreaterThanOrEqual(0);
    expect(r.health.score!).toBeLessThanOrEqual(100);
    expect(r.subscriptions.map((s) => s.merchant)).toContain('اجاره خانه');
    const nw = inp.accounts.reduce((s, a) => s + a.current_balance_minor, 0n);
    expect(r.netWorth.at(-1)!.value).toBe(nw);
  });
});

describe.each(ADAPTERS)('budgets, goals and categories CRUD on %s', (_name, make) => {
  it('budget validation, duplicate guard, soft delete', async () => {
    const db = await make();
    const { seedCategories } = await import('../src/core/data/seedCategories');
    await seedCategories(db);
    const inp = { category_id: 'cat_food', period: 'monthly_jalali' as const, limit_minor: 5_000_000n, currency_code: 'IRR' as const, alert_thresholds_json: [100, 50, 80, 80], rollover_unused: false, is_active: true };
    const b = await saveBudget(db, inp);
    expect(b.alert_thresholds_json).toEqual([50, 80, 100]);
    await expect(saveBudget(db, inp)).rejects.toThrow('BUDGET_DUPLICATE');
    await expect(saveBudget(db, { ...inp, category_id: 'cat_salary' })).rejects.toThrow('CATEGORY_INVALID');
    await expect(saveBudget(db, { ...inp, limit_minor: 0n })).rejects.toThrow('LIMIT_INVALID');
    await expect(saveBudget(db, { ...inp, alert_thresholds_json: [] })).rejects.toThrow('THRESHOLDS_INVALID');
    expect((await saveBudget(db, { ...inp, limit_minor: 6_000_000n }, b.id)).limit_minor).toBe(6_000_000n);
    await deleteBudget(db, b.id);
    expect((await saveBudget(db, inp)).id).not.toBe(b.id);
  });

  it('goal contributions never go below zero; linked goals follow the account', async () => {
    const db = await make();
    const g = await saveGoal(db, { name: ' سفر ', target_minor: 10_000_000n, current_minor: 0n, currency_code: 'IRR', linked_account_id: null, deadline_at: null, icon_name: 'plane', color_hex: '#26C6DA' });
    expect(g.name).toBe('سفر');
    expect((await contributeGoal(db, g.id, 4_000_000n)).current_minor).toBe(4_000_000n);
    await expect(contributeGoal(db, g.id, -5_000_000n)).rejects.toThrow('CURRENT_INVALID');
    await expect(saveGoal(db, { ...g, target_minor: 0n })).rejects.toThrow('TARGET_INVALID');
    await deleteGoal(db, g.id);
    await expect(contributeGoal(db, g.id, 1n)).rejects.toThrow('NOT_FOUND');
  });

  it('categories: one level of sub-categories, system rows keep type and parent, guarded delete', async () => {
    const db = await make();
    const { seedCategories } = await import('../src/core/data/seedCategories');
    await seedCategories(db);
    const cafe = await saveCategory(db, { name_fa: 'کافه', name_en: 'Cafe', type: 'expense', parent_id: 'cat_food', icon_name: 'coffee', color_hex: '#FF8A65' });
    await expect(saveCategory(db, { name_fa: 'x', name_en: '', type: 'expense', parent_id: cafe.id, icon_name: '', color_hex: '#000000' })).rejects.toThrow('PARENT_INVALID');
    await expect(saveCategory(db, { name_fa: 'x', name_en: '', type: 'income', parent_id: 'cat_food', icon_name: '', color_hex: '#000000' })).rejects.toThrow('PARENT_INVALID');
    await expect(saveCategory(db, { name_fa: 'x', name_en: '', type: 'expense', parent_id: null, icon_name: '', color_hex: 'red' })).rejects.toThrow('COLOR_INVALID');
    const renamed = await saveCategory(db, { name_fa: 'غذا', name_en: 'Food', type: 'income', parent_id: 'cat_fuel', icon_name: 'utensils', color_hex: '#123456' }, 'cat_food');
    expect(renamed).toMatchObject({ name_fa: 'غذا', type: 'expense', parent_id: null, is_system: true });
    await expect(deleteCategory(db, 'cat_food')).rejects.toThrow('CATEGORY_SYSTEM');
    await saveBudget(db, { category_id: cafe.id, period: 'weekly', limit_minor: 1n, currency_code: 'IRR', alert_thresholds_json: [100], rollover_unused: false, is_active: true });
    await expect(deleteCategory(db, cafe.id)).rejects.toThrow('CATEGORY_HAS_BUDGET');
    const tea = await saveCategory(db, { name_fa: 'چای', name_en: '', type: 'expense', parent_id: null, icon_name: '', color_hex: '#00AA00' });
    expect(tea.name_en).toBe('چای');
    await deleteCategory(db, tea.id);
    expect((await db.get('categories', tea.id))!.deleted_at).not.toBe(null);
  });
});
