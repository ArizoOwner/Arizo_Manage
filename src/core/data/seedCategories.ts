// Default categories (PROMPT.md §4.1). Ids are stable strings so seeding is idempotent
// and the SMS merchant map (Phase 5) can refer to them.
import type { Category, CategoryType } from '../storage/schema';
import type { IVaultDatabase } from '../storage/IVaultDatabase';

type Seed = [id: string, type: CategoryType, fa: string, en: string, icon: string, color: string];

export const SEED_CATEGORIES: readonly Seed[] = [
  ['cat_food', 'expense', 'خوراک و رستوران', 'Food & Dining', 'utensils', '#FF8A65'],
  ['cat_grocery', 'expense', 'سوپرمارکت', 'Groceries', 'shopping-basket', '#AED581'],
  ['cat_transport', 'expense', 'حمل‌ونقل', 'Transport', 'car', '#4DA6FF'],
  ['cat_fuel', 'expense', 'سوخت', 'Fuel', 'fuel', '#FFB547'],
  ['cat_bills', 'expense', 'قبوض', 'Bills & Utilities', 'receipt', '#90A4AE'],
  ['cat_housing', 'expense', 'اجاره و مسکن', 'Rent & Housing', 'home', '#A1887F'],
  ['cat_loans', 'expense', 'اقساط و وام', 'Loans & Installments', 'landmark', '#FF5C7A'],
  ['cat_health', 'expense', 'درمان', 'Health', 'heart-pulse', '#EF5350'],
  ['cat_education', 'expense', 'آموزش', 'Education', 'graduation-cap', '#7986CB'],
  ['cat_clothing', 'expense', 'پوشاک', 'Clothing', 'shirt', '#BA68C8'],
  ['cat_telecom', 'expense', 'اینترنت و موبایل', 'Internet & Mobile', 'smartphone', '#4FC3F7'],
  ['cat_fun', 'expense', 'تفریح', 'Entertainment', 'party-popper', '#F06292'],
  ['cat_travel', 'expense', 'سفر', 'Travel', 'plane', '#26C6DA'],
  ['cat_gift', 'expense', 'هدیه', 'Gifts', 'gift', '#E6C47A'],
  ['cat_charity', 'expense', 'خیریه', 'Charity', 'hand-heart', '#81C784'],
  ['cat_bank_fee', 'expense', 'کارمزد بانکی', 'Bank Fees', 'percent', '#8E9BB0'],
  ['cat_other_expense', 'expense', 'سایر', 'Other', 'circle-ellipsis', '#78909C'],
  ['cat_salary', 'income', 'حقوق', 'Salary', 'briefcase', '#00D69F'],
  ['cat_business', 'income', 'درآمد کسب‌وکار', 'Business Income', 'store', '#26A69A'],
  ['cat_interest', 'income', 'سود سپرده', 'Deposit Interest', 'piggy-bank', '#E6C47A'],
  ['cat_other_income', 'income', 'سایر', 'Other', 'circle-ellipsis', '#66BB6A'],
  ['cat_transfer', 'transfer', 'انتقال', 'Transfer', 'arrow-left-right', '#4DA6FF'],
];

export function seedCategoryRows(now = Date.now()): Category[] {
  return SEED_CATEGORIES.map(([id, type, name_fa, name_en, icon_name, color_hex], i) => ({
    id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    parent_id: null,
    name_fa,
    name_en,
    type,
    icon_name,
    color_hex,
    is_system: true,
    sort_order: i,
  }));
}

/** Insert any missing system category. Never overwrites user edits. */
export function seedCategories(db: IVaultDatabase, now = Date.now()): Promise<number> {
  return db.transaction(async (tx) => {
    let added = 0;
    for (const row of seedCategoryRows(now)) {
      if (await tx.get('categories', row.id)) continue;
      await tx.put('categories', row);
      added++;
    }
    return added;
  });
}
