// Budgets, savings goals and categories CRUD (PROMPT.md §4.1 #2, #10, #11). Soft delete everywhere,
// so past analytics keep their category names and history stays explainable.
import type { CurrencyCode } from '../currency/money';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import type { Budget, Category, CategoryType, SavingsGoal } from '../storage/schema';
import { uuidv7 } from '../utils/uuidv7';

export class PlanError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'PlanError';
  }
}

export interface BudgetInput {
  category_id: string | null;
  period: Budget['period'];
  limit_minor: bigint;
  currency_code: CurrencyCode;
  alert_thresholds_json: number[];
  rollover_unused: boolean;
  is_active: boolean;
}

export function validateThresholds(xs: number[]): number[] {
  const out = [...new Set(xs)].filter((x) => Number.isInteger(x) && x >= 1 && x <= 200).sort((a, b) => a - b);
  if (!out.length) throw new PlanError('THRESHOLDS_INVALID');
  return out;
}

/** Create (no id) or update a budget. One active budget per category, period and currency. */
export function saveBudget(db: IVaultDatabase, input: BudgetInput, id: string | null = null, now = Date.now()): Promise<Budget> {
  return db.transaction(async (tx) => {
    if (typeof input.limit_minor !== 'bigint' || input.limit_minor <= 0n) throw new PlanError('LIMIT_INVALID');
    const thresholds = validateThresholds(input.alert_thresholds_json);
    if (input.category_id !== null) {
      const c = await tx.get('categories', input.category_id);
      if (!c || c.deleted_at !== null || c.type !== 'expense') throw new PlanError('CATEGORY_INVALID');
    }
    const clash = (await tx.find('budgets')).find(
      (b) => b.id !== id && b.deleted_at === null && b.is_active && b.category_id === input.category_id && b.period === input.period && b.currency_code === input.currency_code,
    );
    if (clash && input.is_active) throw new PlanError('BUDGET_DUPLICATE');
    const old = id ? await tx.get('budgets', id) : undefined;
    if (id && (!old || old.deleted_at !== null)) throw new PlanError('NOT_FOUND');
    const row: Budget = { ...(old ?? { id: uuidv7(now), created_at: now, deleted_at: null }), ...input, alert_thresholds_json: thresholds, updated_at: now };
    await tx.put('budgets', row);
    return row;
  });
}

export interface GoalInput {
  name: string;
  target_minor: bigint;
  current_minor: bigint;
  currency_code: CurrencyCode;
  linked_account_id: string | null;
  deadline_at: number | null;
  icon_name: string;
  color_hex: string;
}

export function saveGoal(db: IVaultDatabase, input: GoalInput, id: string | null = null, now = Date.now()): Promise<SavingsGoal> {
  return db.transaction(async (tx) => {
    const name = input.name.trim();
    if (!name) throw new PlanError('NAME_REQUIRED');
    if (typeof input.target_minor !== 'bigint' || input.target_minor <= 0n) throw new PlanError('TARGET_INVALID');
    if (typeof input.current_minor !== 'bigint' || input.current_minor < 0n) throw new PlanError('CURRENT_INVALID');
    if (input.linked_account_id !== null) {
      const a = await tx.get('accounts', input.linked_account_id);
      if (!a || a.deleted_at !== null) throw new PlanError('ACCOUNT_INVALID');
      if (a.currency_code !== input.currency_code) throw new PlanError('CURRENCY_MISMATCH');
    }
    const old = id ? await tx.get('savings_goals', id) : undefined;
    if (id && (!old || old.deleted_at !== null)) throw new PlanError('NOT_FOUND');
    const row: SavingsGoal = { ...(old ?? { id: uuidv7(now), created_at: now, deleted_at: null }), ...input, name, updated_at: now };
    await tx.put('savings_goals', row);
    return row;
  });
}

/** Add (or with a negative amount, withdraw) to a manual goal. Never below zero. */
export function contributeGoal(db: IVaultDatabase, id: string, delta: bigint, now = Date.now()): Promise<SavingsGoal> {
  return db.transaction(async (tx) => {
    const g = await tx.get('savings_goals', id);
    if (!g || g.deleted_at !== null) throw new PlanError('NOT_FOUND');
    if (g.linked_account_id !== null) throw new PlanError('GOAL_LINKED');
    const next = g.current_minor + delta;
    if (next < 0n) throw new PlanError('CURRENT_INVALID');
    const row = { ...g, current_minor: next, updated_at: now };
    await tx.put('savings_goals', row);
    return row;
  });
}

export interface CategoryInput {
  name_fa: string;
  name_en: string;
  type: CategoryType;
  parent_id: string | null;
  icon_name: string;
  color_hex: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Create or edit a category. Sub-categories are one level deep and share their parent's type.
 * System categories can be renamed and recoloured, but their type and parent never change
 * (the SMS merchant map and the transfer category depend on them).
 */
export function saveCategory(db: IVaultDatabase, input: CategoryInput, id: string | null = null, now = Date.now()): Promise<Category> {
  return db.transaction(async (tx) => {
    const name_fa = input.name_fa.trim();
    const name_en = input.name_en.trim() || name_fa;
    if (!name_fa && !name_en) throw new PlanError('NAME_REQUIRED');
    if (!HEX.test(input.color_hex)) throw new PlanError('COLOR_INVALID');
    if (input.type === 'transfer') throw new PlanError('TYPE_INVALID');
    const all = await tx.find('categories');
    const old = id ? all.find((c) => c.id === id) : undefined;
    if (id && (!old || old.deleted_at !== null)) throw new PlanError('NOT_FOUND');
    const type = old?.is_system ? old.type : input.type;
    const parent_id = old?.is_system ? old.parent_id : input.parent_id;
    if (parent_id !== null) {
      const p = all.find((c) => c.id === parent_id);
      if (!p || p.deleted_at !== null || p.parent_id !== null || p.type !== type || p.id === id) throw new PlanError('PARENT_INVALID');
      if (id && all.some((c) => c.parent_id === id && c.deleted_at === null)) throw new PlanError('PARENT_INVALID');
    }
    const row: Category = {
      ...(old ?? { id: uuidv7(now), created_at: now, deleted_at: null, is_system: false, sort_order: all.length }),
      name_fa: name_fa || name_en,
      name_en,
      type,
      parent_id,
      icon_name: input.icon_name,
      color_hex: input.color_hex,
      updated_at: now,
    };
    await tx.put('categories', row);
    return row;
  });
}

/** Soft delete a user category without live sub-categories or budgets. Past transactions keep the id. */
export function deleteCategory(db: IVaultDatabase, id: string, now = Date.now()): Promise<void> {
  return db.transaction(async (tx) => {
    const c = await tx.get('categories', id);
    if (!c || c.deleted_at !== null) throw new PlanError('NOT_FOUND');
    if (c.is_system) throw new PlanError('CATEGORY_SYSTEM');
    if ((await tx.find('categories', { parent_id: id })).some((x) => x.deleted_at === null)) throw new PlanError('CATEGORY_HAS_CHILDREN');
    if ((await tx.find('budgets', { category_id: id })).some((b) => b.deleted_at === null)) throw new PlanError('CATEGORY_HAS_BUDGET');
    await tx.put('categories', { ...c, deleted_at: now, updated_at: now });
  });
}

export function deleteBudget(db: IVaultDatabase, id: string, now = Date.now()) {
  return softDelete(db, 'budgets', id, now);
}
export function deleteGoal(db: IVaultDatabase, id: string, now = Date.now()) {
  return softDelete(db, 'savings_goals', id, now);
}
function softDelete(db: IVaultDatabase, store: 'budgets' | 'savings_goals', id: string, now: number): Promise<void> {
  return db.transaction(async (tx) => {
    const r = await tx.get(store, id);
    if (!r || r.deleted_at !== null) throw new PlanError('NOT_FOUND');
    await tx.put(store, { ...r, deleted_at: now, updated_at: now });
  });
}
