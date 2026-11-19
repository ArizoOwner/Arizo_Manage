// Account repository: validation (Luhn, Sheba), balance-safe edits, archive, reconciliation.
import type { CurrencyCode } from '../currency/money';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import type { Account, AccountType, CardFinish } from '../storage/schema';
import { onlyDigits } from '../utils/digits';
import { isValidCardNumber, isValidSheba, normalizeSheba } from '../validators';
import { createTransaction, LedgerError, newAccount } from './ledger';

export interface AccountInput {
  name: string;
  type: AccountType;
  bank_code: string | null;
  card_number: string;
  iban_sheba: string;
  account_number: string;
  currency_code: CurrencyCode;
  initial_balance_minor: bigint;
  card_finish: CardFinish;
  is_included_in_net_worth: boolean;
  notes: string;
}

export type AccountFieldError = 'name' | 'card' | 'sheba';

export function validateAccount(input: AccountInput): AccountFieldError[] {
  const errors: AccountFieldError[] = [];
  if (!input.name.trim()) errors.push('name');
  if (input.card_number.trim() && !isValidCardNumber(input.card_number)) errors.push('card');
  if (input.iban_sheba.trim() && !isValidSheba(input.iban_sheba)) errors.push('sheba');
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
  iban_sheba: a.iban_sheba ?? '',
  account_number: a.account_number ?? '',
  currency_code: a.currency_code,
  initial_balance_minor: a.initial_balance_minor,
  card_finish: a.card_finish,
  is_included_in_net_worth: a.is_included_in_net_worth,
  notes: a.notes,
});
