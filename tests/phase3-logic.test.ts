// Phase 3 gate: repository, split and recurring logic, net worth, demo seeder — on both adapters.
import { describe, expect, it } from 'vitest';
import { ADAPTERS } from './helpers/vaults';
import { accountToInput, createAccount, reconcileBalance, setArchived, updateAccount, validateAccount, type AccountInput } from '../src/core/ledger/accounts';
import { createTransaction, setSplits, verifyLedger } from '../src/core/ledger/ledger';
import { cashflowInBase, computeNetWorth, convertMinor } from '../src/core/ledger/networth';
import { dayOfPeriodFor, MAX_CATCHUP, nextOccurrence, payRecurringNow, runDueRecurring } from '../src/core/ledger/recurring';
import { seedDemoData } from '../src/core/utils/demoData';
import { startOfCalendarDay, toCalendarDate } from '../src/core/calendar/calendar';
import type { Account, ExchangeRate, RecurringRule, Transaction } from '../src/core/storage/schema';
import type { IVaultDatabase } from '../src/core/storage/IVaultDatabase';

const input = (over: Partial<AccountInput> = {}): AccountInput => ({
  name: 'ملت',
  type: 'bank_card',
  bank_code: 'mellat',
  card_number: '6219 8610 3452 9007',
  iban_sheba: 'IR06 2960 0000 0010 0324 2000 01',
  account_number: '',
  currency_code: 'IRR',
  initial_balance_minor: 1_000_000n,
  card_finish: 'obsidian_carbon',
  is_included_in_net_worth: true,
  notes: '',
  ...over,
});

const NOON = 12 * 3_600_000;
const jalaliNoon = (y: number, m: number, d: number) => startOfCalendarDay({ y, m, d }, 'jalali') + NOON;

describe('account validation', () => {
  it('requires a name and validates card (Luhn) and Sheba (mod-97) only when given', () => {
    expect(validateAccount(input())).toEqual([]);
    expect(validateAccount(input({ name: '  ' }))).toEqual(['name']);
    expect(validateAccount(input({ card_number: '6219861034529008' }))).toEqual(['card']);
    expect(validateAccount(input({ iban_sheba: 'IR062960000000100324200002' }))).toEqual(['sheba']);
    expect(validateAccount(input({ card_number: '', iban_sheba: '' }))).toEqual([]);
  });
});

describe('recurring schedule', () => {
  it('monthly Jalali clamps to the month length and steps month by month', () => {
    let at = jalaliNoon(1405, 6, 31); // 31 Shahrivar
    const seen: string[] = [];
    for (let i = 0; i < 7; i++) {
      at = nextOccurrence('monthly_jalali', 31, at);
      const d = toCalendarDate(at, 'jalali');
      seen.push(`${d.m}/${d.d}`);
    }
    expect(seen).toEqual(['7/30', '8/30', '9/30', '10/30', '11/30', '12/29', '1/31']);
  });

  it('weekly lands on the same weekday; daily is every day at noon', () => {
    const sat = jalaliNoon(1405, 1, 1); // a Saturday
    expect(nextOccurrence('weekly', 0, sat)).toBe(sat + 7 * 86_400_000);
    expect(nextOccurrence('weekly', 6, sat)).toBe(sat + 6 * 86_400_000);
    expect(nextOccurrence('daily', 0, sat)).toBe(sat + 86_400_000);
    expect(nextOccurrence('daily', 0, sat - 1)).toBe(sat);
  });

  it('yearly uses Jalali month×100+day and clamps 30 Esfand in common years', () => {
    const at = nextOccurrence('yearly', 1230, jalaliNoon(1403, 12, 30));
    expect(toCalendarDate(at, 'jalali')).toEqual({ y: 1404, m: 12, d: 29 });
    expect(dayOfPeriodFor('yearly', jalaliNoon(1405, 7, 15))).toBe(715);
    expect(() => nextOccurrence('yearly', 1300, 0)).toThrow();
  });

  it('monthly Gregorian follows the Gregorian calendar', () => {
    const at = nextOccurrence('monthly_gregorian', 31, Date.UTC(2026, 0, 31, 12));
    expect(toCalendarDate(at, 'gregorian')).toEqual({ y: 2026, m: 2, d: 28 });
  });
});

async function rule(db: IVaultDatabase, accountId: string, over: Partial<RecurringRule> = {}): Promise<RecurringRule> {
  const r: RecurringRule = {
    id: 'rule-1',
    created_at: 0,
    updated_at: 0,
    deleted_at: null,
    title: 'اینترنت',
    type: 'expense',
    account_id: accountId,
    category_id: 'cat_telecom',
    amount_minor: 4_500_000n,
    currency_code: 'IRR',
    cadence: 'monthly_jalali',
    day_of_period: 10,
    next_run_at: jalaliNoon(1405, 5, 10),
    auto_post: true,
    is_active: true,
    ...over,
  };
  await db.put('recurring_rules', r);
  return r;
}

describe.each(ADAPTERS)('Phase 3 repositories — %s', (_n, make) => {
  it('creates accounts with normalized card/Sheba and last4', async () => {
    const db = await make();
    const a = await createAccount(db, input());
    expect(a.card_last4).toBe('9007');
    expect(a.card_number_enc).toBe('6219861034529007');
    expect(a.iban_sheba).toBe('IR062960000000100324200001');
    expect(a.current_balance_minor).toBe(1_000_000n);
    await expect(createAccount(db, input({ card_number: '1234' }))).rejects.toThrow('ACCOUNT_INVALID');
  });

  it('editing the initial balance shifts the current balance; currency locks once used', async () => {
    const db = await make();
    const a = await createAccount(db, input());
    await createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 300_000n, occurred_at: 1 });
    const edited = await updateAccount(db, a.id, { ...accountToInput(a), initial_balance_minor: 2_000_000n });
    expect(edited.current_balance_minor).toBe(1_700_000n);
    await expect(updateAccount(db, a.id, { ...accountToInput(edited), currency_code: 'USD' })).rejects.toThrow('CURRENCY_LOCKED');
    expect((await verifyLedger(db)).drift).toEqual([]);
  });

  it('reconcile posts a signed adjustment; archive excludes from net worth', async () => {
    const db = await make();
    const a = await createAccount(db, input());
    const adj = await reconcileBalance(db, a.id, 750_000n);
    expect(adj?.amount_minor).toBe(-250_000n);
    expect(await reconcileBalance(db, a.id, 750_000n)).toBeNull();
    expect(computeNetWorth(await db.find('accounts'), []).totalMinor).toBe(750_000n);
    await setArchived(db, a.id, true);
    expect(computeNetWorth(await db.find('accounts'), []).totalMinor).toBe(0n);
  });

  it('split transactions keep Σ = parent and survive the integrity check', async () => {
    const db = await make();
    const a = await createAccount(db, input());
    const t = await createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 900_000n, occurred_at: 1 });
    await setSplits(db, t.id, [
      { category_id: 'cat_food', amount_minor: 600_000n },
      { category_id: 'cat_grocery', amount_minor: 300_000n },
    ]);
    const report = await verifyLedger(db);
    expect(report.splitMismatches).toEqual([]);
    expect(report.drift).toEqual([]);
  });

  it('recurring: catches up missed months exactly once, then is idempotent', async () => {
    const db = await make();
    const a = await createAccount(db, input({ initial_balance_minor: 0n }));
    await rule(db, a.id);
    const now = jalaliNoon(1405, 8, 12); // 10 Mordad, 10 Shahrivar, 10 Mehr, 10 Aban are due
    expect(await runDueRecurring(db, now)).toBe(4);
    expect(await runDueRecurring(db, now)).toBe(0);
    expect((await db.get('accounts', a.id))!.current_balance_minor).toBe(-18_000_000n);
    const r = (await db.get('recurring_rules', 'rule-1'))!;
    expect(toCalendarDate(r.next_run_at, 'jalali')).toEqual({ y: 1405, m: 9, d: 10 });
  });

  it('recurring without auto_post creates pending rows with no balance effect', async () => {
    const db = await make();
    const a = await createAccount(db, input({ initial_balance_minor: 0n }));
    await rule(db, a.id, { auto_post: false });
    await runDueRecurring(db, jalaliNoon(1405, 5, 11));
    expect((await db.find('transactions', { status: 'pending_review' })).length).toBe(1);
    expect((await db.get('accounts', a.id))!.current_balance_minor).toBe(0n);
  });

  it('inactive rules never run; catch-up is capped', async () => {
    const db = await make();
    const a = await createAccount(db, input({ initial_balance_minor: 0n }));
    await rule(db, a.id, { is_active: false });
    expect(await runDueRecurring(db, jalaliNoon(1406, 1, 1))).toBe(0);
    await rule(db, a.id, { id: 'daily', cadence: 'daily', day_of_period: 0, next_run_at: jalaliNoon(1403, 1, 1) });
    expect(await runDueRecurring(db, jalaliNoon(1405, 1, 1))).toBe(MAX_CATCHUP);
  }, 120_000);

  it('pay-now posts once and advances; the scheduled run then skips that occurrence', async () => {
    const db = await make();
    const a = await createAccount(db, input({ initial_balance_minor: 0n }));
    await rule(db, a.id, { next_run_at: jalaliNoon(1405, 9, 10) });
    expect((await payRecurringNow(db, 'rule-1', jalaliNoon(1405, 9, 2))).created).toBe(true);
    expect(await runDueRecurring(db, jalaliNoon(1405, 9, 11))).toBe(0);
    expect((await db.get('accounts', a.id))!.current_balance_minor).toBe(-4_500_000n);
  });

  it('demo seeder produces a consistent, believable ledger (and a modest decoy)', async () => {
    const db = await make();
    const res = await seedDemoData(db, { days: 60, now: jalaliNoon(1405, 8, 28) });
    expect(res.accounts).toBe(4);
    expect(res.transactions).toBeGreaterThan(40);
    const report = await verifyLedger(db);
    expect(report.drift).toEqual([]);
    expect(report.brokenPairs).toEqual([]);
    const nw = computeNetWorth(await db.find('accounts'), []).totalMinor;
    expect(nw).toBeGreaterThan(1_000_000_000n);
    const decoy = await make();
    await seedDemoData(decoy, { days: 60, modest: true, now: jalaliNoon(1405, 8, 28) });
    expect(computeNetWorth(await decoy.find('accounts'), []).totalMinor).toBeLessThan(nw / 10n);
  }, 120_000);
});

describe('net worth and currency conversion', () => {
  const rate = (base: ExchangeRate['base_currency'], quote: ExchangeRate['quote_currency'], ppm: bigint, at: number): ExchangeRate => ({
    id: `${base}${quote}${at}`,
    created_at: 0,
    updated_at: 0,
    deleted_at: null,
    base_currency: base,
    quote_currency: quote,
    rate_ppm: ppm,
    effective_at: at,
  });
  // 1 USD = 1,000,000 Rial at t=10, 1,100,000 Rial at t=20.
  const rates = [rate('USD', 'IRR', 1_000_000_000_000n, 10), rate('USD', 'IRR', 1_100_000_000_000n, 20)];

  it('uses the latest rate at the time, and the inverse when only that exists', () => {
    expect(convertMinor(150n, 'USD', 'IRR', rates, 15)).toBe(1_500_000n); // $1.50
    expect(convertMinor(150n, 'USD', 'IRR', rates, 25)).toBe(1_650_000n);
    expect(convertMinor(1_100_000n, 'IRR', 'USD', rates, 25)).toBe(100n); // via the inverse
    expect(convertMinor(1n, 'EUR', 'IRR', rates, 25)).toBeNull();
    expect(convertMinor(5n, 'USD', 'IRR', rates, 5)).toBeNull(); // no rate yet
  });

  it('lists currencies without rates instead of guessing', () => {
    const acc = (id: string, c: 'USD' | 'EUR' | 'IRR', bal: bigint): Account => ({
      id,
      created_at: 0,
      updated_at: 0,
      deleted_at: null,
      name: id,
      type: 'cash',
      bank_code: null,
      card_last4: null,
      card_number_enc: null,
      account_number: null,
      iban_sheba: null,
      currency_code: c,
      initial_balance_minor: bal,
      current_balance_minor: bal,
      card_finish: 'obsidian_carbon',
      is_included_in_net_worth: true,
      is_archived: false,
      sort_order: 0,
      notes: '',
    });
    const nw = computeNetWorth([acc('a', 'IRR', 5n), acc('b', 'USD', 100n), acc('c', 'EUR', 100n)], rates, 'IRR', 25);
    expect(nw.totalMinor).toBe(5n + 1_100_000n);
    expect(nw.missingRates).toEqual(['EUR']);
    expect(nw.perAccount.get('c')).toBeNull();
  });

  it('cashflow excludes transfers and converts foreign amounts', () => {
    const tx = (type: 'income' | 'expense' | 'transfer_out', amount: bigint, currency: 'IRR' | 'USD') =>
      ({ type, amount_minor: amount, currency_code: currency, occurred_at: 15, status: 'posted', deleted_at: null }) as Transaction;
    const cf = cashflowInBase([tx('income', 1_000n, 'IRR'), tx('expense', 100n, 'USD'), tx('transfer_out', 999n, 'IRR')], rates, 0, 100);
    expect(cf).toEqual({ income: 1_000n, expense: 1_000_000n, net: -999_000n });
  });
});
