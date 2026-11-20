// Account repository: validation (Luhn, Sheba), balance-safe edits, archive, delete, reconciliation.
import type { CurrencyCode } from '../currency/money';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import type { Account, AccountType, CardFinish } from '../storage/schema';
import { onlyDigits } from '../utils/digits';
import { isValidCardNumber, isValidSheba, normalizeSheba } from '../validators';
import { createTransaction, LedgerError, newAccount, restoreTransaction, softDeleteTransaction } from './ledger';

export interface AccountInput {
  name: string;
  type: AccountType;
  bank_code: string | null;
  card_number: string;
  /** "MM/YY"; Jalali year on Iranian cards when `card_expiry_jalali`. */
  card_expiry?: string;
  card_expiry_jalali?: boolean;
  card_cvv2?: string;
  iban_sheba: string;
  account_number: string;
  currency_code: CurrencyCode;
  initial_balance_minor: bigint;
  card_finish: CardFinish;
  is_included_in_net_worth: boolean;
  notes: string;
}

export type AccountFieldError = 'name' | 'card' | 'sheba' | 'expiry' | 'cvv2';

export function validateAccount(input: AccountInput): AccountFieldError[] {
  const errors: AccountFieldError[] = [];
  if (!input.name.trim()) errors.push('name');
  if (input.card_number.trim() && !isValidCardNumber(input.card_number)) errors.push('card');
  if (input.iban_sheba.trim() && !isValidSheba(input.iban_sheba)) errors.push('sheba');
  const exp = onlyDigits(input.card_expiry ?? '');
  if (exp && (exp.length !== 4 || Number(exp.slice(0, 2)) < 1 || Number(exp.slice(0, 2)) > 12)) errors.push('expiry');
  const cvv = onlyDigits(input.card_cvv2 ?? '');
  if (cvv && (cvv.length < 3 || cvv.length > 4)) errors.push('cvv2');
  return errors;
}

function fields(input: AccountInput) {
  const card = onlyDigits(input.card_number);
  return {
    name: input.name.trim(),
    type: input.type,
    bank_code: input.bank_code,
    // Full PAN is protected by record (web) or whole-database (SQLCipher) encryption, and the UI
    // only reveals or copies it after re-authentication.
    card_number_enc: card || null,
    card_last4: card ? card.slice(-4) : null,
    card_expiry: onlyDigits(input.card_expiry ?? '').replace(/^(\d{2})(\d{2})$/, '$1/$2') || null,
    card_expiry_jalali: !!input.card_expiry_jalali,
    card_cvv2: onlyDigits(input.card_cvv2 ?? '') || null,
    iban_sheba: input.iban_sheba.trim() ? normalizeSheba(input.iban_sheba) : null,
    account_number: input.account_number.trim() || null,
    currency_code: input.currency_code,
    card_finish: input.card_finish,
    is_included_in_net_worth: input.is_included_in_net_worth,
    notes: input.notes,
  };
}

export function createAccount(db: IVaultDatabase, input: AccountInput, now = Date.now()): Promise<Account> {
  return db.transaction(async (tx) => {
    if (validateAccount(input).length) throw new LedgerError('ACCOUNT_INVALID');
    const sort_order = (await tx.find('accounts')).length;
    const row = newAccount({ ...fields(input), initial_balance_minor: input.initial_balance_minor, is_archived: false, sort_order }, now);
    await tx.put('accounts', row);
    return row;
  });
}

/** Changing the initial balance shifts the current balance by the same delta. Currency is locked once used. */
export function updateAccount(db: IVaultDatabase, id: string, input: AccountInput, now = Date.now()): Promise<Account> {
  return db.transaction(async (tx) => {
    if (validateAccount(input).length) throw new LedgerError('ACCOUNT_INVALID');
    const prev = await tx.get('accounts', id);
    if (!prev || prev.deleted_at !== null) throw new LedgerError('ACCOUNT_NOT_FOUND');
    if (input.currency_code !== prev.currency_code && (await tx.find('transactions', { account_id: id })).length) {
      throw new LedgerError('CURRENCY_LOCKED');
    }
    const delta = input.initial_balance_minor - prev.initial_balance_minor;
    const next: Account = {
      ...prev,
      ...fields(input),
      initial_balance_minor: input.initial_balance_minor,
      current_balance_minor: prev.current_balance_minor + delta,
      updated_at: now,
    };
    await tx.put('accounts', next);
    return next;
  });
}

export function setArchived(db: IVaultDatabase, id: string, archived: boolean, now = Date.now()) {
  return db.transaction(async (tx) => {
    const a = await tx.get('accounts', id);
    if (!a) throw new LedgerError('ACCOUNT_NOT_FOUND');
    await tx.put('accounts', { ...a, is_archived: archived, updated_at: now });
  });
}

/**
 * Delete an account (soft, like every row): its transactions go to the Trash with it, a transfer's other
 * half goes too (so the other account's balance stays right), and recurring rules on the account stop.
 * Cheques, loans, debts and goals that named the account keep their history and simply lose the link.
 * One staged transaction: all of it lands, or none. Returns how many transactions moved to the Trash.
 */
export function deleteAccount(db: IVaultDatabase, id: string, now = Date.now()): Promise<number> {
  return db.transaction(async (tx) => {
    const a = await tx.get('accounts', id);
    if (!a || a.deleted_at !== null) throw new LedgerError('ACCOUNT_NOT_FOUND');
    let moved = 0;
    for (const t of await tx.find('transactions', { account_id: id })) {
      if (t.deleted_at !== null) continue;
      moved += (await softDeleteTransaction(db, t.id, now)).length;
    }
    for (const r of await tx.find('recurring_rules', { account_id: id })) {
      if (r.deleted_at === null) await tx.put('recurring_rules', { ...r, is_active: false, deleted_at: now, updated_at: now });
    }
    for (const store of ['cheques', 'loans', 'debts_receivables'] as const) {
      for (const row of await tx.find(store)) {
        if (row.account_id === id) await tx.put(store, { ...row, account_id: null, updated_at: now });
      }
    }
    for (const g of await tx.find('savings_goals')) {
      if (g.linked_account_id === id) await tx.put('savings_goals', { ...g, linked_account_id: null, updated_at: now });
    }
    await tx.put('accounts', { ...(await tx.get('accounts', id))!, deleted_at: now, updated_at: now });
    return moved;
  });
}

/**
 * Undo `deleteAccount` from the Trash: the account comes back with exactly the transactions (and
 * transfer halves, and recurring rules) that were removed with it, recognised by the same deletion
 * time. Rows trashed separately before stay in the Trash. Unlinked cheques/loans/debts stay unlinked.
 */
export function restoreAccount(db: IVaultDatabase, id: string, now = Date.now()): Promise<number> {
  return db.transaction(async (tx) => {
    const a = await tx.get('accounts', id);
    if (!a || a.deleted_at === null) throw new LedgerError('ACCOUNT_NOT_FOUND');
    const at = a.deleted_at;
    await tx.put('accounts', { ...a, deleted_at: null, updated_at: now });
    let back = 0;
    for (const t of await tx.find('transactions', { account_id: id })) {
      const cur = await tx.get('transactions', t.id);
      if (cur?.deleted_at === at) back += (await restoreTransaction(db, t.id, now)).length;
    }
    for (const r of await tx.find('recurring_rules', { account_id: id })) {
      if (r.deleted_at === at) await tx.put('recurring_rules', { ...r, is_active: true, deleted_at: null, updated_at: now });
    }
    return back;
  });
}

/** Reconcile to a real balance (e.g. the bank app's figure) by posting a signed adjustment. */
export function reconcileBalance(db: IVaultDatabase, id: string, actualMinor: bigint, now = Date.now()) {
  return db.transaction(async (tx) => {
    const a = await tx.get('accounts', id);
    if (!a) throw new LedgerError('ACCOUNT_NOT_FOUND');
    const delta = actualMinor - a.current_balance_minor;
    if (delta === 0n) return null;
    return createTransaction(db, { account_id: id, type: 'adjustment', amount_minor: delta, occurred_at: now, note: 'reconcile' }, now);
  });
}

export const accountToInput = (a: Account): AccountInput => ({
  name: a.name,
  type: a.type,
  bank_code: a.bank_code,
  card_number: a.card_number_enc ?? '',
  card_expiry: a.card_expiry ?? '',
  card_expiry_jalali: a.card_expiry_jalali ?? false,
  card_cvv2: a.card_cvv2 ?? '',
  iban_sheba: a.iban_sheba ?? '',
  account_number: a.account_number ?? '',
  currency_code: a.currency_code,
  initial_balance_minor: a.initial_balance_minor,
  card_finish: a.card_finish,
  is_included_in_net_worth: a.is_included_in_net_worth,
  notes: a.notes,
});
