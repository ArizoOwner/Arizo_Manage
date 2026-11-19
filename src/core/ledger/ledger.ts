// Atomic double-entry ledger engine (PROMPT.md §4.2).
// Invariant: account.current_balance_minor === initial_balance_minor + Σ effect(tx) over its transactions.
// Every mutation below runs inside one vault transaction, so the balance and the rows change together.
import { sumMinor, type CurrencyCode } from '../currency/money';
import type { IVaultDatabase, VaultTx } from '../storage/IVaultDatabase';
import type { Account, Id, LinkedEntityType, Transaction, TransactionSplit, TxSource, TxType } from '../storage/schema';
import { uuidv7 } from '../utils/uuidv7';

export class LedgerError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'LedgerError';
  }
}

/** Signed effect of one transaction on its own account's balance. */
export function balanceEffect(tx: Pick<Transaction, 'type' | 'amount_minor' | 'status' | 'deleted_at'>): bigint {
  if (tx.status !== 'posted' || tx.deleted_at !== null) return 0n;
  switch (tx.type) {
    case 'income':
    case 'transfer_in':
    case 'adjustment':
      return tx.amount_minor;
    case 'expense':
    case 'transfer_out':
      return -tx.amount_minor;
  }
}

export interface NewTx {
  account_id: Id;
  type: Exclude<TxType, 'transfer_in' | 'transfer_out'>;
  amount_minor: bigint;
  occurred_at: number;
  category_id?: Id | null;
  merchant_name?: string;
  note?: string;
  source?: TxSource;
  status?: 'posted' | 'pending_review';
  external_ref_code?: string | null;
  sms_fingerprint_sha256?: string | null;
  reported_balance_after_minor?: bigint | null;
  linked_entity_type?: LinkedEntityType | null;
  linked_entity_id?: Id | null;
  exchange_rate_to_base_ppm?: bigint | null;
}

type BuildInput = Omit<NewTx, 'type'> & { type: TxType; transfer_pair_id?: Id | null; counterparty_account_id?: Id | null };

async function mustAccount(tx: VaultTx, id: Id): Promise<Account> {
  const a = await tx.get('accounts', id);
  if (!a || a.deleted_at !== null) throw new LedgerError('ACCOUNT_NOT_FOUND');
  return a;
}

async function applyDelta(tx: VaultTx, accountId: Id, delta: bigint, now: number): Promise<void> {
  if (delta === 0n) return;
  const a = await tx.get('accounts', accountId);
  if (!a) throw new LedgerError('ACCOUNT_NOT_FOUND');
  await tx.put('accounts', { ...a, current_balance_minor: a.current_balance_minor + delta, updated_at: now });
}

function validateAmount(type: TxType, amount: bigint): void {
  if (typeof amount !== 'bigint') throw new LedgerError('AMOUNT_NOT_BIGINT');
  if (type === 'adjustment' ? amount === 0n : amount <= 0n) throw new LedgerError('AMOUNT_INVALID');
}

function buildTx(input: BuildInput, currency: CurrencyCode, now: number): Transaction {
  return {
    id: uuidv7(now),
    created_at: now,
    updated_at: now,
    deleted_at: null,
    account_id: input.account_id,
    transfer_pair_id: input.transfer_pair_id ?? null,
    counterparty_account_id: input.counterparty_account_id ?? null,
    type: input.type,
    amount_minor: input.amount_minor,
    currency_code: currency,
    exchange_rate_to_base_ppm: input.exchange_rate_to_base_ppm ?? null,
    category_id: input.category_id ?? null,
    merchant_name: input.merchant_name ?? '',
    note: input.note ?? '',
    occurred_at: input.occurred_at,
    source: input.source ?? 'manual',
    external_ref_code: input.external_ref_code ?? null,
    sms_fingerprint_sha256: input.sms_fingerprint_sha256 ?? null,
    reported_balance_after_minor: input.reported_balance_after_minor ?? null,
    linked_entity_type: input.linked_entity_type ?? null,
    linked_entity_id: input.linked_entity_id ?? null,
    status: input.status ?? 'posted',
  };
}

/** Create an income, expense or adjustment and update the balance atomically. */
export function createTransaction(db: IVaultDatabase, input: NewTx, now = Date.now()): Promise<Transaction> {
  return db.transaction(async (tx) => {
    validateAmount(input.type, input.amount_minor);
    const account = await mustAccount(tx, input.account_id);
    const row = buildTx(input, account.currency_code, now);
    await tx.put('transactions', row);
    await applyDelta(tx, row.account_id, balanceEffect(row), now);
    return row;
  });
}

export interface NewTransfer {
  from_account_id: Id;
  to_account_id: Id;
  amount_minor: bigint;
  /** Amount credited to the destination; required when currencies differ. */
  to_amount_minor?: bigint;
  /** Optional bank fee, posted as a separate expense on the source account, sharing the pair id. */
  fee_minor?: bigint;
  fee_category_id?: Id | null;
  occurred_at: number;
  note?: string;
  source?: TxSource;
}

/** Internal transfer: a linked transfer_out + transfer_in pair, plus an optional fee expense. */
export function createTransfer(db: IVaultDatabase, input: NewTransfer, now = Date.now()) {
  return db.transaction(async (tx) => {
    if (input.from_account_id === input.to_account_id) throw new LedgerError('TRANSFER_SAME_ACCOUNT');
    const from = await mustAccount(tx, input.from_account_id);
    const to = await mustAccount(tx, input.to_account_id);
    if (from.currency_code !== to.currency_code && input.to_amount_minor === undefined) throw new LedgerError('TRANSFER_NEEDS_TO_AMOUNT');
    const toAmount = input.to_amount_minor ?? input.amount_minor;
    validateAmount('transfer_out', input.amount_minor);
    validateAmount('transfer_in', toAmount);
    const pairId = uuidv7(now);
    const common = { occurred_at: input.occurred_at, note: input.note ?? '', source: input.source ?? 'manual', transfer_pair_id: pairId };
    const out = buildTx({ ...common, account_id: from.id, type: 'transfer_out', amount_minor: input.amount_minor, counterparty_account_id: to.id }, from.currency_code, now);
    const inn = buildTx({ ...common, account_id: to.id, type: 'transfer_in', amount_minor: toAmount, counterparty_account_id: from.id }, to.currency_code, now);
    await tx.put('transactions', out);
    await tx.put('transactions', inn);
    await applyDelta(tx, from.id, balanceEffect(out), now);
    await applyDelta(tx, to.id, balanceEffect(inn), now);
    let fee: Transaction | null = null;
    if (input.fee_minor !== undefined && input.fee_minor > 0n) {
      fee = buildTx({ ...common, account_id: from.id, type: 'expense', amount_minor: input.fee_minor, category_id: input.fee_category_id ?? null }, from.currency_code, now);
      await tx.put('transactions', fee);
      await applyDelta(tx, from.id, balanceEffect(fee), now);
    }
    return { out, in: inn, fee };
  });
}

/** Every transaction sharing a transfer pair (out, in, fee), or just the row itself. */
async function groupOf(tx: VaultTx, row: Transaction): Promise<Transaction[]> {
  return row.transfer_pair_id ? tx.find('transactions', { transfer_pair_id: row.transfer_pair_id }) : [row];
}

/** Replace a row, moving its balance effect (possibly to another account). */
async function replaceRow(tx: VaultTx, prev: Transaction, next: Transaction, now: number): Promise<void> {
  await tx.put('transactions', { ...next, updated_at: now });
  await applyDelta(tx, prev.account_id, -balanceEffect(prev), now);
  await applyDelta(tx, next.account_id, balanceEffect(next), now);
}

export type TxPatch = Partial<Pick<Transaction, 'account_id' | 'amount_minor' | 'category_id' | 'merchant_name' | 'note' | 'occurred_at' | 'type'>>;

/** Edit an income/expense/adjustment. Transfers are edited by voiding and re-creating the pair. */
export function updateTransaction(db: IVaultDatabase, id: Id, patch: TxPatch, now = Date.now()): Promise<Transaction> {
  return db.transaction(async (tx) => {
    const prev = await tx.get('transactions', id);
    if (!prev || prev.deleted_at !== null) throw new LedgerError('TX_NOT_FOUND');
    if (prev.type === 'transfer_in' || prev.type === 'transfer_out') throw new LedgerError('TX_IS_TRANSFER');
    const next: Transaction = { ...prev, ...patch };
    if (next.type === 'transfer_in' || next.type === 'transfer_out') throw new LedgerError('TX_IS_TRANSFER');
    validateAmount(next.type, next.amount_minor);
    next.currency_code = (await mustAccount(tx, next.account_id)).currency_code;
    const splits = await tx.find('transaction_splits', { transaction_id: id });
    if (splits.length && sumMinor(splits.map((s) => s.amount_minor)) !== next.amount_minor) throw new LedgerError('SPLITS_SUM_MISMATCH');
    await replaceRow(tx, prev, next, now);
    return next;
  });
}

function mutateGroup(db: IVaultDatabase, id: Id, mutate: (t: Transaction) => Transaction | null, now: number): Promise<Transaction[]> {
  return db.transaction(async (tx) => {
    const row = await tx.get('transactions', id);
    if (!row) throw new LedgerError('TX_NOT_FOUND');
    const changed: Transaction[] = [];
    for (const t of await groupOf(tx, row)) {
      const next = mutate(t);
      if (!next) continue;
      await replaceRow(tx, t, next, now);
      changed.push(next);
    }
    return changed;
  });
}

/** Void: keeps the row, removes its effect. Applies to the whole transfer group. */
export const voidTransaction = (db: IVaultDatabase, id: Id, now = Date.now()) =>
  mutateGroup(db, id, (t) => (t.status === 'voided' ? null : { ...t, status: 'voided' }), now);

/** Soft delete into the 30-day Trash. Applies to the whole transfer group. */
export const softDeleteTransaction = (db: IVaultDatabase, id: Id, now = Date.now()) =>
  mutateGroup(db, id, (t) => (t.deleted_at !== null ? null : { ...t, deleted_at: now }), now);

/** Restore from Trash. Applies to the whole transfer group. */
export const restoreTransaction = (db: IVaultDatabase, id: Id, now = Date.now()) =>
  mutateGroup(db, id, (t) => (t.deleted_at === null ? null : { ...t, deleted_at: null }), now);

/** Post a pending_review transaction (e.g. an SMS capture the user confirmed). */
export const postPendingTransaction = (db: IVaultDatabase, id: Id, now = Date.now()) =>
  mutateGroup(db, id, (t) => (t.status === 'pending_review' ? { ...t, status: 'posted' } : null), now);

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Hard-delete Trash rows older than 30 days (their balance effect is already zero). */
export function purgeTrash(db: IVaultDatabase, now = Date.now()): Promise<number> {
  return db.transaction(async (tx) => {
    const old = (await tx.find('transactions')).filter((t) => t.deleted_at !== null && now - t.deleted_at >= TRASH_RETENTION_MS);
    for (const t of old) {
      for (const s of await tx.find('transaction_splits', { transaction_id: t.id })) await tx.delete('transaction_splits', s.id);
      for (const g of await tx.find('transaction_tags', { transaction_id: t.id })) await tx.delete('transaction_tags', g.id);
      await tx.delete('transactions', t.id);
    }
    return old.length;
  });
}

export interface SplitInput {
  category_id: Id;
  amount_minor: bigint;
  note?: string;
}

/** Replace a transaction's splits. Invariant: Σ split amounts === parent amount. [] clears them. */
export function setSplits(db: IVaultDatabase, txId: Id, splits: SplitInput[], now = Date.now()): Promise<TransactionSplit[]> {
  return db.transaction(async (tx) => {
    const parent = await tx.get('transactions', txId);
    if (!parent || parent.deleted_at !== null) throw new LedgerError('TX_NOT_FOUND');
    if (parent.type !== 'income' && parent.type !== 'expense') throw new LedgerError('SPLITS_ONLY_INCOME_EXPENSE');
    if (splits.some((s) => typeof s.amount_minor !== 'bigint' || s.amount_minor <= 0n)) throw new LedgerError('AMOUNT_INVALID');
    if (splits.length && sumMinor(splits.map((s) => s.amount_minor)) !== parent.amount_minor) throw new LedgerError('SPLITS_SUM_MISMATCH');
    for (const old of await tx.find('transaction_splits', { transaction_id: txId })) await tx.delete('transaction_splits', old.id);
    const rows = splits.map<TransactionSplit>((s) => ({
      id: uuidv7(now),
      created_at: now,
      updated_at: now,
      deleted_at: null,
      transaction_id: txId,
      category_id: s.category_id,
      amount_minor: s.amount_minor,
      note: s.note ?? '',
    }));
    for (const r of rows) await tx.put('transaction_splits', r);
    return rows;
  });
}

/**
 * Obligation settlement (cheque cleared, installment paid, debt settled, invoice paid):
 * posts exactly one live linked transaction per entity. A repeat call returns the existing one.
 */
export function postLinkedTransaction(
  db: IVaultDatabase,
  input: NewTx & { linked_entity_type: LinkedEntityType; linked_entity_id: Id },
  now = Date.now(),
): Promise<{ tx: Transaction; created: boolean }> {
  return db.transaction(async (tx) => {
    const existing = (await tx.find('transactions', { linked_entity_id: input.linked_entity_id })).find(
      (t) => t.linked_entity_type === input.linked_entity_type && t.deleted_at === null && t.status !== 'voided',
    );
    if (existing) return { tx: existing, created: false };
    return { tx: await createTransaction(db, input, now), created: true };
  });
}

export interface IntegrityReport {
  checked: number;
  drift: { account_id: Id; stored: bigint; computed: bigint }[];
  orphans: Id[];
  brokenPairs: Id[];
  splitMismatches: Id[];
}

/** "Verify & Recalculate Ledger Integrity". With fix=true, rewrites drifted balances. */
export function verifyLedger(db: IVaultDatabase, fix = false, now = Date.now()): Promise<IntegrityReport> {
  return db.transaction(async (tx) => {
    const accounts = await tx.find('accounts');
    const txs = await tx.find('transactions');
    const computed = new Map(accounts.map((a) => [a.id, a.initial_balance_minor]));
    const orphans: Id[] = [];
    for (const t of txs) {
      const cur = computed.get(t.account_id);
      if (cur === undefined) orphans.push(t.id);
      else computed.set(t.account_id, cur + balanceEffect(t));
    }
    const pairs = new Map<Id, Transaction[]>();
    for (const t of txs) {
      if (t.transfer_pair_id && (t.type === 'transfer_in' || t.type === 'transfer_out')) {
        pairs.set(t.transfer_pair_id, [...(pairs.get(t.transfer_pair_id) ?? []), t]);
      }
    }
    const brokenPairs = [...pairs]
      .filter(([, ts]) => ts.map((t) => t.type).sort().join() !== 'transfer_in,transfer_out' || new Set(ts.map((t) => `${t.status}|${t.deleted_at === null}`)).size !== 1)
      .map(([pid]) => pid);
    const txById = new Map(txs.map((t) => [t.id, t]));
    const splitSums = new Map<Id, bigint>();
    for (const s of await tx.find('transaction_splits')) splitSums.set(s.transaction_id, (splitSums.get(s.transaction_id) ?? 0n) + s.amount_minor);
    const splitMismatches = [...splitSums].filter(([tid, sum]) => txById.get(tid)?.amount_minor !== sum).map(([tid]) => tid);
    const drift: IntegrityReport['drift'] = [];
    for (const a of accounts) {
      const value = computed.get(a.id)!;
      if (a.current_balance_minor === value) continue;
      drift.push({ account_id: a.id, stored: a.current_balance_minor, computed: value });
      if (fix) await tx.put('accounts', { ...a, current_balance_minor: value, updated_at: now });
    }
    return { checked: txs.length, drift, orphans, brokenPairs, splitMismatches };
  });
}

/** Income/expense KPIs for [from, to). Transfers, voided, pending and trashed rows never count. */
export function incomeExpenseTotals(txs: readonly Transaction[], from: number, to: number, currency: CurrencyCode) {
  let income = 0n;
  let expense = 0n;
  for (const t of txs) {
    if (t.status !== 'posted' || t.deleted_at !== null || t.currency_code !== currency) continue;
    if (t.occurred_at < from || t.occurred_at >= to) continue;
    if (t.type === 'income') income += t.amount_minor;
    else if (t.type === 'expense') expense += t.amount_minor;
  }
  return { income, expense, net: income - expense };
}

export type NewAccountFields = Omit<Account, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'current_balance_minor'>;

/** New account row; the balance starts at the initial balance. */
export function newAccount(fields: NewAccountFields, now = Date.now()): Account {
  return { ...fields, id: uuidv7(now), created_at: now, updated_at: now, deleted_at: null, current_balance_minor: fields.initial_balance_minor };
}
