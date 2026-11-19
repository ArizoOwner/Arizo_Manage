// Realistic Persian demo data (PROMPT.md Phase 3 and §7 #9 "Demo Data Seeder (dev/testing)").
// Deterministic (seeded PRNG) so tests and screenshots are stable. It goes through the real ledger,
// so every balance stays consistent with its transactions. Card numbers are Luhn-valid test PANs.
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import { createAccount, type AccountInput } from '../ledger/accounts';
import { createTransaction, createTransfer } from '../ledger/ledger';
import { dayOfPeriodFor, nextOccurrence } from '../ledger/recurring';
import { seedCategories } from '../data/seedCategories';
import { uuidv7 } from './uuidv7';

const DAY = 86_400_000;
const HOUR = 3_600_000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const EXPENSES: [category: string, merchant: string, lo: number, hi: number][] = [
  ['cat_food', 'اسنپ‌فود', 1_800_000, 6_500_000],
  ['cat_grocery', 'افق کوروش', 2_500_000, 14_000_000],
  ['cat_transport', 'اسنپ', 600_000, 3_200_000],
  ['cat_fuel', 'جایگاه سوخت', 1_500_000, 4_000_000],
  ['cat_telecom', 'همراه اول', 1_000_000, 3_000_000],
  ['cat_clothing', 'دیجی‌کالا', 8_000_000, 40_000_000],
  ['cat_fun', 'سینما', 1_500_000, 5_000_000],
  ['cat_health', 'داروخانه', 900_000, 7_500_000],
];

export interface DemoOptions {
  /** Days of history ending at `now`. */
  days?: number;
  /** Decoy vaults get small, believable numbers (PROMPT.md §5.2). */
  modest?: boolean;
  now?: number;
  seed?: number;
}

const blank = { account_number: '', currency_code: 'IRR' as const, is_included_in_net_worth: true, notes: '', bank_code: null, card_number: '', iban_sheba: '' };

export async function seedDemoData(db: IVaultDatabase, opts: DemoOptions = {}): Promise<{ accounts: number; transactions: number }> {
  const now = opts.now ?? Date.now();
  const days = opts.days ?? 90;
  const scale = opts.modest ? 25n : 1n;
  const r = rng(opts.seed ?? 1405);
  const amount = (lo: number, hi: number) => (BigInt(Math.round((lo + r() * (hi - lo)) / 10_000)) * 10_000n) / scale;
  const start = now - days * DAY;
  await seedCategories(db, now);

  const acc = (input: Omit<AccountInput, keyof typeof blank> & Partial<AccountInput>) => createAccount(db, { ...blank, ...input }, start);
  const salary = await acc({
    name: 'حساب حقوق',
    type: 'bank_card',
    bank_code: 'saman',
    card_number: '6219861034529007',
    iban_sheba: 'IR062960000000100324200001',
    initial_balance_minor: 850_000_000n / scale,
    card_finish: 'midnight_sapphire',
  });
  const daily = await acc({ name: 'کارت روزمره', type: 'bank_card', bank_code: 'pasargad', card_number: '5022291070873466', initial_balance_minor: 120_000_000n / scale, card_finish: 'obsidian_carbon' });
  const savings = await acc({ name: 'پس‌انداز', type: 'savings_vault', initial_balance_minor: 2_400_000_000n / scale, card_finish: 'emerald_silk' });
  const cash = await acc({ name: 'نقدی', type: 'cash', initial_balance_minor: 15_000_000n / scale, card_finish: 'champagne_titanium' });

  let count = 0;
  const post = async (account_id: string, type: 'income' | 'expense', minor: bigint, at: number, category_id: string, merchant_name: string) => {
    await createTransaction(db, { account_id, type, amount_minor: minor, occurred_at: at, category_id, merchant_name }, at);
    count++;
  };

  for (let d = days; d >= 0; d--) {
    const day = now - d * DAY;
    if (d % 30 === 3) await post(salary.id, 'income', 480_000_000n / scale, day + 9 * HOUR, 'cat_salary', 'حقوق ماهانه');
    if (d % 30 === 5) {
      await createTransfer(db, { from_account_id: salary.id, to_account_id: daily.id, amount_minor: 150_000_000n / scale, fee_minor: 50_000n, fee_category_id: 'cat_bank_fee', occurred_at: day + 10 * HOUR }, day);
      await createTransfer(db, { from_account_id: salary.id, to_account_id: savings.id, amount_minor: 100_000_000n / scale, occurred_at: day + 10 * HOUR + 60_000 }, day);
      count += 5;
    }
    if (d % 30 === 7) await post(salary.id, 'expense', 180_000_000n / scale, day + 11 * HOUR, 'cat_housing', 'اجاره خانه');
    if (d % 30 === 15) await post(savings.id, 'income', 36_000_000n / scale, day + 8 * HOUR, 'cat_interest', 'سود سپرده');
    const n = Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const [cat, merchant, lo, hi] = EXPENSES[Math.floor(r() * EXPENSES.length)]!;
      await post(r() < 0.15 ? cash.id : daily.id, 'expense', amount(lo, hi), day + (12 + i * 3) * HOUR, cat, merchant);
    }
  }

  // A monthly internet bill so the Upcoming strip has a recurring item.
  const firstRun = nextOccurrence('monthly_jalali', 20, now);
  await db.put('recurring_rules', {
    id: uuidv7(now),
    created_at: now,
    updated_at: now,
    deleted_at: null,
    title: 'اینترنت خانه',
    type: 'expense',
    account_id: daily.id,
    category_id: 'cat_telecom',
    amount_minor: 4_500_000n / scale,
    currency_code: 'IRR',
    cadence: 'monthly_jalali',
    day_of_period: dayOfPeriodFor('monthly_jalali', firstRun),
    next_run_at: firstRun,
    auto_post: false,
    is_active: true,
  });

  return { accounts: 4, transactions: count };
}
