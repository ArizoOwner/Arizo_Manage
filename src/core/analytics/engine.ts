// Analytics engine (PROMPT.md §7 #6, Phase 6). Pure and synchronous: it runs inside the analytics
// worker (analytics.worker.ts) and directly in tests. Money is bigint minor units end to end;
// percentages and the health score are small integers derived from bigint ratios.
// Income/expense semantics match cashflowInBase: posted, not trashed, type income|expense only, so
// transfers, fees-as-transfer pairs, adjustments, pending and voided rows never count.
import { addDays, DEFAULT_TZ, startOfCalendarDay, toCalendarDate, type CalendarKind } from '../calendar/calendar';
import { divRoundHalfUp, type CurrencyCode } from '../currency/money';
import { balanceEffect } from '../ledger/ledger';
import { convertMinor } from '../ledger/networth';
import type { Account, Budget, Category, DebtReceivable, DebtSettlement, ExchangeRate, LoanInstallment, SavingsGoal, Transaction, TransactionSplit } from '../storage/schema';
import { budgetRange, DAY, dayStarts, periodAt, periodOf, shiftPeriod, type Period, type Range } from './periods';

export interface AnalyticsInput {
  accounts: Account[];
  transactions: Transaction[];
  splits: TransactionSplit[];
  categories: Category[];
  rates: ExchangeRate[];
  budgets: Budget[];
  goals: SavingsGoal[];
  debts: DebtReceivable[];
  settlements: DebtSettlement[];
  installments: LoanInstallment[];
}

export interface AnalyticsOptions {
  now: number;
  cal: CalendarKind;
  /** Selected period (year/month in `cal`). */
  y: number;
  m: number;
  tz?: string;
  base?: CurrencyCode;
  weekStart?: 'sat' | 'mon';
}

export const UNCATEGORIZED = '__none__';

export interface CashflowTotals {
  income: bigint;
  expense: bigint;
  net: bigint;
}
export interface MonthPoint extends CashflowTotals {
  y: number;
  m: number;
  /** Savings rate in basis points of income (null without income). */
  savingsBps: number | null;
}
export interface TxRef {
  id: string;
  at: number;
  amount: bigint;
  merchant: string;
}
export interface CategoryTotal {
  id: string;
  total: bigint;
  /** Direct children with their own totals (the parent's own transactions appear as a child with the parent's id). */
  children: { id: string; total: bigint; txs: TxRef[] }[];
}
export interface BudgetStatus {
  id: string;
  category_id: string | null;
  currency_code: CurrencyCode;
  start: number;
  end: number;
  limit: bigint;
  carry: bigint;
  effectiveLimit: bigint;
  spent: bigint;
  remaining: bigint;
  /** Spent as a whole percentage of the effective limit. */
  usedPct: number;
  /** Highest configured threshold already reached, or null. */
  alert: number | null;
  daysTotal: number;
  daysElapsed: number;
  daysLeft: number;
  safePerDay: bigint;
  projected: bigint;
  projectedOver: boolean;
}
export interface GoalStatus {
  id: string;
  name: string;
  currency_code: CurrencyCode;
  deadline_at: number | null;
  linked_account_id: string | null;
  current: bigint;
  target: bigint;
  pct: number;
  remaining: bigint;
  daysLeft: number | null;
  /** Needed each month to reach the target by the deadline (null without a deadline or when done). */
  perMonth: bigint | null;
  overdue: boolean;
}
export interface HealthScore {
  /** 0–100, or null when there is no income or expense history to judge. */
  score: number | null;
  parts: { savings: number; emergency: number; debt: number; budgets: number; trend: number };
}
export type Cadence = 'weekly' | 'monthly' | 'yearly';
export interface Subscription {
  merchant: string;
  category_id: string | null;
  cadence: Cadence;
  amount: bigint;
  /** Cost normalised to one month (weekly × 52 / 12, yearly / 12). */
  monthly: bigint;
  count: number;
  last: number;
  next: number;
}
export type InsightKey = 'catUp' | 'catDown' | 'overspend' | 'saving' | 'budgetOver' | 'subs' | 'missingRates';
export interface Insight {
  key: InsightKey;
  tone: 'good' | 'warn' | 'info';
  cat?: string;
  pct?: number;
  amount?: bigint;
  n?: number;
  days?: number;
  currencies?: string;
}
export interface AnalyticsReport {
  base: CurrencyCode;
  period: Period;
  prev: Period;
  cashflow: CashflowTotals & { prev: CashflowTotals; savingsBps: number | null; deltaExpenseBps: number | null; deltaIncomeBps: number | null };
  months: MonthPoint[];
  netWorth: { at: number; value: bigint }[];
  categories: CategoryTotal[];
  incomeCategories: CategoryTotal[];
  heatmap: { start: number; expense: bigint }[];
  budgets: BudgetStatus[];
  goals: GoalStatus[];
  health: HealthScore;
  subscriptions: Subscription[];
  insights: Insight[];
  missingRates: CurrencyCode[];
}

const LIQUID: ReadonlySet<Account['type']> = new Set(['cash', 'bank_card', 'bank_account', 'savings_vault', 'wallet']);
// Obligation postings are not discretionary spending patterns (installments look "monthly" but are loans).
const NOT_SUBSCRIPTION: ReadonlySet<Transaction['source']> = new Set(['loan', 'cheque', 'debt', 'invoice']);

export const countable = (t: Transaction): boolean => t.status === 'posted' && t.deleted_at === null && (t.type === 'income' || t.type === 'expense');

/** ratio a/b in basis points, rounded half-up; null when b is 0. */
const bps = (a: bigint, b: bigint): number | null => (b === 0n ? null : Number(divRoundHalfUp(a * 10_000n, b)));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

interface Piece {
  tx: Transaction;
  category: string;
  /** Amount in the base currency. */
  value: bigint;
}

export function computeAnalytics(input: AnalyticsInput, o: AnalyticsOptions): AnalyticsReport {
  const tz = o.tz ?? DEFAULT_TZ;
  const base = o.base ?? 'IRR';
  const missing = new Set<CurrencyCode>();
  const toBase = (minor: bigint, from: CurrencyCode, at: number, to: CurrencyCode = base): bigint | null => {
    const v = convertMinor(minor, from, to, input.rates, at);
    if (v === null) missing.add(from);
    return v;
  };

  const catById = new Map(input.categories.map((c) => [c.id, c]));
  const topOf = (id: string): string => {
    let c = catById.get(id);
    for (let i = 0; c?.parent_id && i < 8; i++) {
      const p = catById.get(c.parent_id);
      if (!p) break;
      c = p;
    }
    return c?.id ?? id;
  };

  // Split-aware pieces: a split transaction contributes one piece per split category.
  const splitsByTx = new Map<string, TransactionSplit[]>();
  for (const s of input.splits) {
    if (s.deleted_at !== null) continue;
    const list = splitsByTx.get(s.transaction_id) ?? [];
    list.push(s);
    splitsByTx.set(s.transaction_id, list);
  }
  const pieces: Piece[] = [];
  for (const t of input.transactions) {
    if (!countable(t)) continue;
    const parts = splitsByTx.get(t.id);
    const src = parts?.length ? parts.map((s) => [s.category_id, s.amount_minor] as const) : [[t.category_id ?? UNCATEGORIZED, t.amount_minor] as const];
    for (const [category, amount] of src) {
      const value = toBase(amount, t.currency_code, t.occurred_at);
      if (value !== null) pieces.push({ tx: t, category, value });
    }
  }
  pieces.sort((a, b) => a.tx.occurred_at - b.tx.occurred_at);

  const inRange = (r: Range) => pieces.filter((p) => p.tx.occurred_at >= r.start && p.tx.occurred_at < r.end);
  const totals = (r: Range): CashflowTotals => {
    let income = 0n;
    let expense = 0n;
    for (const p of inRange(r)) {
      if (p.tx.type === 'income') income += p.value;
      else expense += p.value;
    }
    return { income, expense, net: income - expense };
  };

  const period = periodOf(o.cal, o.y, o.m, tz);
  const prev = shiftPeriod(period, -1, tz);
  const cur = totals(period);
  const before = totals(prev);
  const months: MonthPoint[] = [];
  for (let i = -5; i <= 0; i++) {
    const p = shiftPeriod(period, i, tz);
    const tt = totals(p);
    months.push({ y: p.y, m: p.m, ...tt, savingsBps: bps(tt.net, tt.income) });
  }

  const categories = categoryTree(inRange(period), 'expense', topOf);
  const incomeCategories = categoryTree(inRange(period), 'income', topOf);

  const days = dayStarts(period.start, period.end, tz);
  const heatmap = days.slice(0, -1).map((start, i) => {
    let expense = 0n;
    for (const p of pieces) if (p.tx.type === 'expense' && p.tx.occurred_at >= start && p.tx.occurred_at < days[i + 1]!) expense += p.value;
    return { start, expense };
  });

  // The trajectory ends with today (inclusive), so entries dated later today already show.
  const endOfToday = startOfCalendarDay(addDays(toCalendarDate(o.now, 'gregorian', tz), 1, 'gregorian'), 'gregorian', tz);
  const netWorth = netWorthSeries(input, shiftPeriod(period, -5, tz).start, Math.min(period.end, endOfToday), tz, toBase);

  const weekStart = o.weekStart ?? (o.cal === 'jalali' ? 'sat' : 'mon');
  const budgets = input.budgets
    .filter((b) => b.deleted_at === null && b.is_active)
    .map((b) => budgetStatus(b, o.now, o.cal, weekStart, tz, (r, cur) => spentIn(input, splitsByTx, r, b.category_id, cur, toBase)));

  const goals = input.goals.filter((g) => g.deleted_at === null).map((g) => goalStatus(g, input.accounts, o.now, toBase));
  const subscriptions = detectSubscriptions(input.transactions, o.now, (t) => toBase(t.amount_minor, t.currency_code, t.occurred_at));

  const health = healthScore(input, { now: o.now, cal: o.cal, tz, firstAt: pieces[0]?.tx.occurred_at }, totals, budgets, toBase);

  const report: AnalyticsReport = {
    base,
    period,
    prev,
    cashflow: {
      ...cur,
      prev: before,
      savingsBps: bps(cur.net, cur.income),
      deltaExpenseBps: before.expense === 0n ? null : bps(cur.expense - before.expense, before.expense),
      deltaIncomeBps: before.income === 0n ? null : bps(cur.income - before.income, before.income),
    },
    months,
    netWorth,
    categories,
    incomeCategories,
    heatmap,
    budgets,
    goals,
    health,
    subscriptions,
    insights: [],
    missingRates: [],
  };
  report.insights = buildInsights(report, pieces, topOf, o.now, tz);
  report.missingRates = [...missing].sort();
  if (report.missingRates.length) report.insights.push({ key: 'missingRates', tone: 'info', currencies: report.missingRates.join(', ') });
  return report;
}

function categoryTree(list: Piece[], type: 'income' | 'expense', topOf: (id: string) => string): CategoryTotal[] {
  const tops = new Map<string, Map<string, { total: bigint; txs: TxRef[] }>>();
  for (const p of list) {
    if (p.tx.type !== type) continue;
    const top = p.category === UNCATEGORIZED ? UNCATEGORIZED : topOf(p.category);
    const kids = tops.get(top) ?? new Map<string, { total: bigint; txs: TxRef[] }>();
    const leaf = kids.get(p.category) ?? { total: 0n, txs: [] };
    leaf.total += p.value;
    leaf.txs.push({ id: p.tx.id, at: p.tx.occurred_at, amount: p.value, merchant: p.tx.merchant_name });
    kids.set(p.category, leaf);
    tops.set(top, kids);
  }
  return [...tops]
    .map(([id, kids]) => {
      const children = [...kids].map(([cid, v]) => ({ id: cid, total: v.total, txs: v.txs.sort((a, b) => b.at - a.at).slice(0, 100) })).sort((a, b) => cmpDesc(a.total, b.total));
      return { id, total: children.reduce((s, c) => s + c.total, 0n), children };
    })
    .sort((a, b) => cmpDesc(a.total, b.total));
}

/** The vault's history covers a period starting at `start` when its first entry falls within that period's first 3 days. */
const covers = (firstAt: number | undefined, start: number) => firstAt !== undefined && firstAt < start + 3 * DAY;

const cmpDesc = (a: bigint, b: bigint) => (a === b ? 0 : a > b ? -1 : 1);


/**
 * Net worth at the end of each day in [from, to). An account's balance at time T is its current
 * balance minus every posted effect at or after T; before the account was created it contributes 0
 * (the vault knows nothing about it then). Each point converts at the rates effective at that time.
 */
function netWorthSeries(input: AnalyticsInput, from: number, to: number, tz: string, toBase: (m: bigint, c: CurrencyCode, at: number) => bigint | null) {
  const accounts = input.accounts.filter((a) => a.deleted_at === null && !a.is_archived && a.is_included_in_net_worth);
  if (!accounts.length || to <= from) return [];
  const ids = new Set(accounts.map((a) => a.id));
  const txs = input.transactions.filter((t) => ids.has(t.account_id) && balanceEffect(t) !== 0n).sort((a, b) => b.occurred_at - a.occurred_at);
  const bal = new Map(accounts.map((a) => [a.id, a.current_balance_minor]));
  const days = dayStarts(from, to, tz);
  const ends = days.slice(1).map((t) => Math.min(t, to));
  const out: { at: number; value: bigint }[] = [];
  let i = 0;
  // Walk back in time: undo every effect at or after each point.
  for (let k = ends.length - 1; k >= 0; k--) {
    const at = ends[k]!;
    for (; i < txs.length && txs[i]!.occurred_at >= at; i++) {
      const t = txs[i]!;
      bal.set(t.account_id, bal.get(t.account_id)! - balanceEffect(t));
    }
    let total = 0n;
    let any = false;
    for (const a of accounts) {
      if (a.created_at >= at) continue;
      any = true;
      total += toBase(bal.get(a.id)!, a.currency_code, at - 1) ?? 0n;
    }
    if (any) out.push({ at: at - 1, value: total });
  }
  return out.reverse();
}

/** Spend of one budget's category (and its sub-categories), split-aware, in the budget currency. */
function spentIn(
  input: AnalyticsInput,
  splitsByTx: Map<string, TransactionSplit[]>,
  r: Range,
  categoryId: string | null,
  currency: CurrencyCode,
  toBase: (m: bigint, c: CurrencyCode, at: number, to?: CurrencyCode) => bigint | null,
): bigint {
  const parent = new Map(input.categories.map((c) => [c.id, c.parent_id]));
  const under = (id: string) => {
    if (categoryId === null) return true;
    for (let c: string | null | undefined = id, i = 0; c && i < 8; i++) {
      if (c === categoryId) return true;
      c = parent.get(c);
    }
    return false;
  };
  let spent = 0n;
  for (const t of input.transactions) {
    if (!countable(t) || t.type !== 'expense' || t.occurred_at < r.start || t.occurred_at >= r.end) continue;
    const parts = splitsByTx.get(t.id);
    const src = parts?.length ? parts.map((s) => [s.category_id, s.amount_minor] as const) : [[t.category_id ?? UNCATEGORIZED, t.amount_minor] as const];
    for (const [cat, amount] of src) if (under(cat)) spent += toBase(amount, t.currency_code, t.occurred_at, currency) ?? 0n;
  }
  return spent;
}

/**
 * Budget burn rate. Days count the current day as elapsed; "safe to spend per day" spreads what is
 * left over the remaining days including today (rounded down, so following it never overspends).
 * Velocity: projected = spent × daysTotal / daysElapsed. Rollover carries only the unused part of the
 * previous window (one window back, never negative).
 */
export function budgetStatus(
  b: Budget,
  now: number,
  cal: CalendarKind,
  weekStart: 'sat' | 'mon',
  tz: string,
  spentFor: (r: Range, currency: CurrencyCode) => bigint,
): BudgetStatus {
  const r = budgetRange(b.period, now, cal, weekStart, tz);
  const spent = spentFor(r, b.currency_code);
  let carry = 0n;
  if (b.rollover_unused) {
    const prevR = budgetRange(b.period, r.start - 1, cal, weekStart, tz);
    const left = b.limit_minor - spentFor(prevR, b.currency_code);
    if (left > 0n) carry = left;
  }
  const effectiveLimit = b.limit_minor + carry;
  const daysTotal = dayStarts(r.start, r.end, tz).length - 1;
  const daysElapsed = clamp(dayStarts(r.start, Math.min(now, r.end - 1) + 1, tz).length - 1, 1, daysTotal);
  const daysLeft = daysTotal - daysElapsed + 1;
  const remaining = effectiveLimit - spent;
  const usedPct = effectiveLimit > 0n ? Number((spent * 100n) / effectiveLimit) : 0;
  const reached = b.alert_thresholds_json.filter((x) => usedPct >= x);
  const projected = divRoundHalfUp(spent * BigInt(daysTotal), BigInt(daysElapsed));
  return {
    id: b.id,
    category_id: b.category_id,
    currency_code: b.currency_code,
    start: r.start,
    end: r.end,
    limit: b.limit_minor,
    carry,
    effectiveLimit,
    spent,
    remaining,
    usedPct,
    alert: reached.length ? Math.max(...reached) : null,
    daysTotal,
    daysElapsed,
    daysLeft,
    safePerDay: remaining > 0n ? remaining / BigInt(daysLeft) : 0n,
    projected,
    projectedOver: projected > effectiveLimit,
  };
}

function goalStatus(g: SavingsGoal, accounts: Account[], now: number, toBase: (m: bigint, c: CurrencyCode, at: number, to?: CurrencyCode) => bigint | null): GoalStatus {
  const linked = g.linked_account_id ? accounts.find((a) => a.id === g.linked_account_id && a.deleted_at === null) : undefined;
  const raw = linked ? (toBase(linked.current_balance_minor, linked.currency_code, now, g.currency_code) ?? 0n) : g.current_minor;
  const current = raw < 0n ? 0n : raw;
  const remaining = current >= g.target_minor ? 0n : g.target_minor - current;
  const pct = g.target_minor > 0n ? Math.min(100, Number((current * 100n) / g.target_minor)) : 0;
  const daysLeft = g.deadline_at === null ? null : Math.ceil((g.deadline_at - now) / DAY);
  let perMonth: bigint | null = null;
  if (daysLeft !== null && remaining > 0n) {
    const monthsLeft = BigInt(Math.max(1, Math.ceil(daysLeft / 30)));
    perMonth = (remaining + monthsLeft - 1n) / monthsLeft;
  }
  return { id: g.id, name: g.name, currency_code: g.currency_code, deadline_at: g.deadline_at, linked_account_id: g.linked_account_id, current, target: g.target_minor, pct, remaining, daysLeft, perMonth, overdue: daysLeft !== null && daysLeft < 0 && remaining > 0n };
}

/**
 * Financial Health Score, 0–100 (documented in CLAUDE.md, pinned by tests/analytics.test.ts):
 *  - Savings rate, 30 pts: (income − expense) / income over the last 3 periods; 20 % or more = 30, linear to 0 at 0 %.
 *  - Emergency fund, 25 pts: liquid balances / average monthly expense of those periods (averaged over the
 *    periods that have any activity); 6 months = 25, linear.
 *  - Debt load, 20 pts: (borrowed debts left + unpaid loan installments) / total assets; 0 % = 20, linear to 0 at 50 %.
 *  - Budgets, 15 pts: share of active budgets not projected over their limit; no budgets = 8 (neutral).
 *  - Trend, 10 pts: this period's expense vs the average of the up to 3 prior periods the vault fully covers;
 *    ≤ 100 % = 10, linear to 0 at 150 %; no covered prior period = 5 (neutral).
 * Null when the last 3 periods have neither income nor expense.
 */
export function healthScore(
  input: AnalyticsInput,
  o: { now: number; cal: CalendarKind; tz: string; firstAt: number | undefined },
  totals: (r: Range) => CashflowTotals,
  budgets: BudgetStatus[],
  toBase: (m: bigint, c: CurrencyCode, at: number) => bigint | null,
): HealthScore {
  const nowP = periodAt(o.now, o.cal, o.tz);
  const last3 = [shiftPeriod(nowP, -2, o.tz), shiftPeriod(nowP, -1, o.tz), nowP];
  const sums = last3.map(totals);
  const income = sums.reduce((s, x) => s + x.income, 0n);
  const expense = sums.reduce((s, x) => s + x.expense, 0n);
  if (income === 0n && expense === 0n) return { score: null, parts: { savings: 0, emergency: 0, debt: 0, budgets: 0, trend: 0 } };

  const rate = income > 0n ? Number(((income - expense) * 10_000n) / income) : -1;
  const savings = rate <= 0 ? 0 : Math.round(clamp(rate / 2000, 0, 1) * 30);

  let liquid = 0n;
  let assets = 0n;
  for (const a of input.accounts) {
    if (a.deleted_at !== null || a.is_archived || !a.is_included_in_net_worth) continue;
    const v = toBase(a.current_balance_minor, a.currency_code, o.now) ?? 0n;
    if (v > 0n) assets += v;
    if (LIQUID.has(a.type) && v > 0n) liquid += v;
  }
  const active = BigInt(Math.max(1, sums.filter((x) => x.income > 0n || x.expense > 0n).length));
  const avgExpense = expense / active;
  const monthsCovered = avgExpense > 0n ? Number((liquid * 100n) / avgExpense) / 100 : liquid > 0n ? 6 : 0;
  const emergency = Math.round(clamp(monthsCovered / 6, 0, 1) * 25);

  let owed = 0n;
  for (const d of input.debts) {
    if (d.deleted_at !== null || d.direction !== 'borrowed' || d.status !== 'open') continue;
    const paid = input.settlements.filter((s) => s.debt_id === d.id && s.deleted_at === null).reduce((s, x) => s + x.amount_minor, 0n);
    owed += toBase(d.amount_minor - paid, d.currency_code, o.now) ?? 0n;
  }
  for (const i of input.installments) if (i.deleted_at === null && i.status !== 'paid') owed += i.amount_minor; // shortcut: installments carry no currency; loans here are IRR (the only loan currency offered in the UI).
  const debtRatio = assets > 0n ? Number((owed * 10_000n) / assets) : owed > 0n ? 10_000 : 0;
  const debt = Math.round(clamp(1 - debtRatio / 5000, 0, 1) * 20);

  const budgetPts = budgets.length === 0 ? 8 : Math.round((budgets.filter((b) => !b.projectedOver).length / budgets.length) * 15);

  // Only prior periods the vault fully covers count; with none, the trend is neutral (5).
  const prior = [shiftPeriod(nowP, -3, o.tz), shiftPeriod(nowP, -2, o.tz), shiftPeriod(nowP, -1, o.tz)].filter((p) => covers(o.firstAt, p.start)).map((p) => totals(p).expense);
  const priorAvg = prior.length ? prior.reduce((s, x) => s + x, 0n) / BigInt(prior.length) : 0n;
  const thisExp = sums[2]!.expense;
  const trend = priorAvg > 0n ? Math.round(clamp((15_000 - Number((thisExp * 10_000n) / priorAvg)) / 5000, 0, 1) * 10) : 5;

  const parts = { savings, emergency, debt, budgets: budgetPts, trend };
  return { score: savings + emergency + debt + budgetPts + trend, parts };
}

const CADENCES: { cadence: Cadence; days: number; tol: number }[] = [
  { cadence: 'weekly', days: 7, tol: 2 },
  { cadence: 'monthly', days: 30, tol: 4 },
  { cadence: 'yearly', days: 365, tol: 12 },
];

export const normalizeMerchant = (s: string): string => s.trim().toLowerCase().replace(/[‌‍]/g, ' ').replace(/\s+/g, ' ');

/**
 * Subscription Detector: the same merchant, a similar amount (each within 15 % of the median) and a
 * regular interval (every gap within the cadence tolerance), over at least 3 posted expenses.
 * Only the latest run (up to 6 charges) is judged, so a merchant that became regular is caught.
 * Stale series (no charge within 1.5 intervals of now) are dropped as cancelled.
 */
export function detectSubscriptions(txs: readonly Transaction[], now: number, value: (t: Transaction) => bigint | null): Subscription[] {
  const by = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (!countable(t) || t.type !== 'expense' || NOT_SUBSCRIPTION.has(t.source)) continue;
    const k = normalizeMerchant(t.merchant_name);
    if (!k) continue;
    const list = by.get(k) ?? [];
    list.push(t);
    by.set(k, list);
  }
  const out: Subscription[] = [];
  for (const list of by.values()) {
    if (list.length < 3) continue;
    const run = list.sort((a, b) => a.occurred_at - b.occurred_at).slice(-6);
    const gaps = run.slice(1).map((t, i) => (t.occurred_at - run[i]!.occurred_at) / DAY);
    const c = CADENCES.find((x) => gaps.every((g) => Math.abs(g - x.days) <= x.tol));
    if (!c) continue;
    const amounts = run.map(value).filter((v): v is bigint => v !== null);
    if (amounts.length !== run.length) continue;
    const med = [...amounts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[Math.floor(amounts.length / 2)]!;
    if (amounts.some((a) => (a > med ? a - med : med - a) * 100n > med * 15n)) continue;
    const last = run[run.length - 1]!;
    if (now - last.occurred_at > c.days * 1.5 * DAY) continue;
    const monthly = c.cadence === 'weekly' ? divRoundHalfUp(med * 52n, 12n) : c.cadence === 'yearly' ? divRoundHalfUp(med, 12n) : med;
    out.push({ merchant: last.merchant_name.trim(), category_id: last.category_id, cadence: c.cadence, amount: med, monthly, count: run.length, last: last.occurred_at, next: last.occurred_at + c.days * DAY });
  }
  return out.sort((a, b) => cmpDesc(a.monthly, b.monthly));
}

/**
 * Rule-based insights, computed only from data in the vault:
 *  - catUp: a category's spend this period is ≥ 25 % above its average over the 3 previous periods
 *    (only once the vault holds those 3 full periods).
 *  - catDown: ≥ 25 % below that average (only once the period is over, so a partial month never looks thrifty).
 *  - overspend: expense exceeds income this period. saving: savings rate ≥ 20 %.
 *  - budgetOver: a budget is projected to end over its limit. subs: detected subscriptions per month.
 */
function buildInsights(r: AnalyticsReport, pieces: Piece[], topOf: (id: string) => string, now: number, tz: string): Insight[] {
  const out: Insight[] = [];
  const sumBy = (p: Range) => {
    const m = new Map<string, bigint>();
    for (const x of pieces) {
      if (x.tx.type !== 'expense' || x.tx.occurred_at < p.start || x.tx.occurred_at >= p.end) continue;
      const k = x.category === UNCATEGORIZED ? UNCATEGORIZED : topOf(x.category);
      m.set(k, (m.get(k) ?? 0n) + x.value);
    }
    return m;
  };
  const cur = sumBy(r.period);
  // A 3-month average needs 3 full months: skip when the vault's history starts mid-window.
  const hist = covers(pieces[0]?.tx.occurred_at, shiftPeriod(r.period, -3, tz).start) ? [1, 2, 3].map((n) => sumBy(shiftPeriod(r.period, -n, tz))) : [];
  const done = now >= r.period.end;
  const moves: { cat: string; pct: number; diff: bigint }[] = [];
  for (const cat of new Set([...cur.keys(), ...hist.flatMap((h) => [...h.keys()])])) {
    if (cat === UNCATEGORIZED || !hist.length || hist.some((h) => !h.size)) continue;
    const avg = hist.reduce((s, h) => s + (h.get(cat) ?? 0n), 0n) / 3n;
    if (avg <= 0n) continue;
    const c = cur.get(cat) ?? 0n;
    const pct = Number(divRoundHalfUp((c - avg) * 100n, avg));
    if (pct >= 25 || (done && pct <= -25)) moves.push({ cat, pct, diff: c - avg });
  }
  moves.sort((a, b) => cmpDesc(a.diff < 0n ? -a.diff : a.diff, b.diff < 0n ? -b.diff : b.diff));
  for (const m of moves.slice(0, 3)) out.push(m.pct > 0 ? { key: 'catUp', tone: 'warn', cat: m.cat, pct: m.pct } : { key: 'catDown', tone: 'good', cat: m.cat, pct: -m.pct });

  const cf = r.cashflow;
  if (cf.income > 0n && cf.expense > cf.income) out.push({ key: 'overspend', tone: 'warn', amount: cf.expense - cf.income });
  else if (cf.savingsBps !== null && cf.savingsBps >= 2000) out.push({ key: 'saving', tone: 'good', pct: Math.round(cf.savingsBps / 100) });

  for (const b of r.budgets) if (b.projectedOver && now < b.end) out.push({ key: 'budgetOver', tone: 'warn', cat: b.category_id ?? '', amount: b.projected - b.effectiveLimit, days: b.daysLeft });

  if (r.subscriptions.length) out.push({ key: 'subs', tone: 'info', n: r.subscriptions.length, amount: r.subscriptions.reduce((s, x) => s + x.monthly, 0n) });
  return out;
}
