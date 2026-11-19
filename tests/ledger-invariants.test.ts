// Double-entry and balance invariants (PROMPT.md §4.2), run against both adapters.
import { describe, expect, it } from 'vitest';
import { ADAPTERS } from './helpers/vaults';
import type { IVaultDatabase } from '../src/core/storage/IVaultDatabase';
import type { CurrencyCode } from '../src/core/currency/money';
import {
  LedgerError,
  createTransaction,
  createTransfer,
  incomeExpenseTotals,
  newAccount,
  postLinkedTransaction,
  postPendingTransaction,
  purgeTrash,
  restoreTransaction,
  setSplits,
  softDeleteTransaction,
  TRASH_RETENTION_MS,
  updateTransaction,
  verifyLedger,
  voidTransaction,
} from '../src/core/ledger/ledger';

async function account(db: IVaultDatabase, initial = 0n, currency: CurrencyCode = 'IRR') {
  const a = newAccount({
    name: 'acc',
    type: 'bank_account',
    bank_code: null,
    card_last4: null,
    card_number_enc: null,
    account_number: null,
    iban_sheba: null,
    currency_code: currency,
    initial_balance_minor: initial,
    card_finish: 'emerald_silk',
    is_included_in_net_worth: true,
    is_archived: false,
    sort_order: 0,
    notes: '',
  });
  await db.put('accounts', a);
  return a;
}
const bal = async (db: IVaultDatabase, id: string) => (await db.get('accounts', id))!.current_balance_minor;
const clean = async (db: IVaultDatabase) => {
  const r = await verifyLedger(db);
  expect(r.drift).toEqual([]);
  expect(r.brokenPairs).toEqual([]);
  expect(r.orphans).toEqual([]);
  expect(r.splitMismatches).toEqual([]);
};

describe.each(ADAPTERS)('ledger invariants — %s', (_n, make) => {
  it('income, expense and signed adjustment update the balance exactly', async () => {
    const db = await make();
    const a = await account(db, 1_000_000n);
    await createTransaction(db, { account_id: a.id, type: 'income', amount_minor: 250_000_000n, occurred_at: 1 });
    await createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 1_000_001n, occurred_at: 2 });
    await createTransaction(db, { account_id: a.id, type: 'adjustment', amount_minor: -5n, occurred_at: 3 });
    expect(await bal(db, a.id)).toBe(1_000_000n + 250_000_000n - 1_000_001n - 5n);
    await clean(db);
  });

  it('rejects invalid amounts and unknown accounts without side effects', async () => {
    const db = await make();
    const a = await account(db);
    for (const amount of [0n, -1n]) {
      await expect(createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: amount, occurred_at: 1 })).rejects.toBeInstanceOf(LedgerError);
    }
    await expect(createTransaction(db, { account_id: a.id, type: 'adjustment', amount_minor: 0n, occurred_at: 1 })).rejects.toThrow('AMOUNT_INVALID');
    await expect(createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 1 as unknown as bigint, occurred_at: 1 })).rejects.toThrow('AMOUNT_NOT_BIGINT');
    await expect(createTransaction(db, { account_id: 'nope', type: 'income', amount_minor: 1n, occurred_at: 1 })).rejects.toThrow('ACCOUNT_NOT_FOUND');
    expect(await db.count('transactions')).toBe(0);
  });

  it('transfer writes a linked pair + fee and is excluded from income/expense KPIs', async () => {
    const db = await make();
    const a = await account(db, 10_000_000n);
    const b = await account(db, 0n);
    const r = await createTransfer(db, { from_account_id: a.id, to_account_id: b.id, amount_minor: 3_000_000n, fee_minor: 5_000n, occurred_at: 10 });
    expect(r.out.transfer_pair_id).toBe(r.in.transfer_pair_id);
    expect(r.fee?.transfer_pair_id).toBe(r.out.transfer_pair_id);
    expect([r.out.counterparty_account_id, r.in.counterparty_account_id]).toEqual([b.id, a.id]);
    expect(await bal(db, a.id)).toBe(10_000_000n - 3_000_000n - 5_000n);
    expect(await bal(db, b.id)).toBe(3_000_000n);
    const kpi = incomeExpenseTotals(await db.find('transactions'), 0, 100, 'IRR');
    expect(kpi).toEqual({ income: 0n, expense: 5_000n, net: -5_000n }); // only the fee is an expense
    await clean(db);
  });

  it('transfer guards: same account, cross-currency needs a destination amount', async () => {
    const db = await make();
    const a = await account(db, 100n);
    const usd = await account(db, 0n, 'USD');
    await expect(createTransfer(db, { from_account_id: a.id, to_account_id: a.id, amount_minor: 1n, occurred_at: 1 })).rejects.toThrow('TRANSFER_SAME_ACCOUNT');
    await expect(createTransfer(db, { from_account_id: a.id, to_account_id: usd.id, amount_minor: 1n, occurred_at: 1 })).rejects.toThrow('TRANSFER_NEEDS_TO_AMOUNT');
    await createTransfer(db, { from_account_id: a.id, to_account_id: usd.id, amount_minor: 100n, to_amount_minor: 2n, occurred_at: 1 });
    expect(await bal(db, usd.id)).toBe(2n);
    await clean(db);
  });

  it('void, soft-delete and restore move the whole transfer pair together', async () => {
    const db = await make();
    const a = await account(db, 1000n);
    const b = await account(db, 0n);
    const { in: inn } = await createTransfer(db, { from_account_id: a.id, to_account_id: b.id, amount_minor: 400n, fee_minor: 10n, occurred_at: 1 });
    await softDeleteTransaction(db, inn.id, 50);
    expect([await bal(db, a.id), await bal(db, b.id)]).toEqual([1000n, 0n]);
    await clean(db);
    await restoreTransaction(db, inn.id, 60);
    expect([await bal(db, a.id), await bal(db, b.id)]).toEqual([590n, 400n]);
    await voidTransaction(db, inn.id);
    expect([await bal(db, a.id), await bal(db, b.id)]).toEqual([1000n, 0n]);
    expect((await voidTransaction(db, inn.id)).length).toBe(0); // idempotent
    await clean(db);
  });

  it('edit moves the effect between accounts and amounts atomically', async () => {
    const db = await make();
    const a = await account(db, 0n);
    const b = await account(db, 0n);
    const t = await createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 100n, occurred_at: 1 });
    await updateTransaction(db, t.id, { account_id: b.id, amount_minor: 250n });
    expect([await bal(db, a.id), await bal(db, b.id)]).toEqual([0n, -250n]);
    await updateTransaction(db, t.id, { type: 'income' });
    expect(await bal(db, b.id)).toBe(250n);
    await clean(db);
  });

  it('edits to transfers are refused', async () => {
    const db = await make();
    const a = await account(db, 10n);
    const b = await account(db, 0n);
    const { out } = await createTransfer(db, { from_account_id: a.id, to_account_id: b.id, amount_minor: 5n, occurred_at: 1 });
    await expect(updateTransaction(db, out.id, { amount_minor: 6n })).rejects.toThrow('TX_IS_TRANSFER');
    const t = await createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 1n, occurred_at: 1 });
    await expect(updateTransaction(db, t.id, { type: 'transfer_in' })).rejects.toThrow('TX_IS_TRANSFER');
  });

  it('split sum must equal the parent amount; edits keep that invariant', async () => {
    const db = await make();
    const a = await account(db);
    const t = await createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 1_000n, occurred_at: 1 });
    await expect(setSplits(db, t.id, [{ category_id: 'cat_food', amount_minor: 600n }, { category_id: 'cat_fun', amount_minor: 300n }])).rejects.toThrow('SPLITS_SUM_MISMATCH');
    await expect(setSplits(db, t.id, [{ category_id: 'cat_food', amount_minor: 0n }])).rejects.toThrow('AMOUNT_INVALID');
    await setSplits(db, t.id, [{ category_id: 'cat_food', amount_minor: 600n }, { category_id: 'cat_fun', amount_minor: 400n }]);
    expect(await db.count('transaction_splits')).toBe(2);
    await expect(updateTransaction(db, t.id, { amount_minor: 999n })).rejects.toThrow('SPLITS_SUM_MISMATCH');
    expect(await bal(db, a.id)).toBe(-1_000n); // failed edit changed nothing
    await setSplits(db, t.id, [{ category_id: 'cat_food', amount_minor: 1_000n }]);
    expect(await db.count('transaction_splits')).toBe(1);
    await setSplits(db, t.id, []);
    expect(await db.count('transaction_splits')).toBe(0);
    await clean(db);
  });

  it('pending_review rows have no effect until posted', async () => {
    const db = await make();
    const a = await account(db, 100n);
    const t = await createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 40n, occurred_at: 1, status: 'pending_review', source: 'sms_auto' });
    expect(await bal(db, a.id)).toBe(100n);
    await postPendingTransaction(db, t.id);
    expect(await bal(db, a.id)).toBe(60n);
    await clean(db);
  });

  it('linked obligation transactions are posted exactly once', async () => {
    const db = await make();
    const a = await account(db, 0n);
    const input = { account_id: a.id, type: 'expense' as const, amount_minor: 5_000_000n, occurred_at: 1, linked_entity_type: 'cheque' as const, linked_entity_id: 'chq-1', source: 'cheque' as const };
    const first = await postLinkedTransaction(db, input);
    const second = await postLinkedTransaction(db, input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.tx.id).toBe(first.tx.id);
    expect(await bal(db, a.id)).toBe(-5_000_000n);
    await voidTransaction(db, first.tx.id);
    expect((await postLinkedTransaction(db, input)).created).toBe(true); // re-post after void is allowed
    await clean(db);
  });

  it('purges Trash only after 30 days, with its splits', async () => {
    const db = await make();
    const a = await account(db);
    const t = await createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 10n, occurred_at: 1 });
    await setSplits(db, t.id, [{ category_id: 'cat_food', amount_minor: 10n }]);
    await softDeleteTransaction(db, t.id, 1_000);
    expect(await purgeTrash(db, 1_000 + TRASH_RETENTION_MS - 1)).toBe(0);
    expect(await purgeTrash(db, 1_000 + TRASH_RETENTION_MS)).toBe(1);
    expect(await db.count('transactions')).toBe(0);
    expect(await db.count('transaction_splits')).toBe(0);
    expect(await bal(db, a.id)).toBe(0n);
  });

  it('verify detects drift and recalculates it', async () => {
    const db = await make();
    const a = await account(db, 50n);
    await createTransaction(db, { account_id: a.id, type: 'income', amount_minor: 25n, occurred_at: 1 });
    const acc = (await db.get('accounts', a.id))!;
    await db.put('accounts', { ...acc, current_balance_minor: 1n });
    const r = await verifyLedger(db);
    expect(r.drift).toEqual([{ account_id: a.id, stored: 1n, computed: 75n }]);
    await verifyLedger(db, true);
    expect(await bal(db, a.id)).toBe(75n);
    await clean(db);
  });

  it('randomized: 300 mixed operations keep every balance equal to its recomputation', async () => {
    const db = await make();
    const accts = [await account(db, 1_000_000_000n), await account(db, 0n), await account(db, 42n)];
    let seed = 1234567;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) {
      const op = rnd(7);
      const acc = accts[rnd(3)]!.id;
      const amt = BigInt(rnd(10_000_000) + 1);
      if (op <= 2) ids.push((await createTransaction(db, { account_id: acc, type: op === 0 ? 'income' : 'expense', amount_minor: amt, occurred_at: i })).id);
      else if (op === 3) {
        const to = accts[(accts.findIndex((x) => x.id === acc) + 1) % 3]!.id;
        ids.push((await createTransfer(db, { from_account_id: acc, to_account_id: to, amount_minor: amt, occurred_at: i })).out.id);
      } else if (ids.length) {
        const id = ids[rnd(ids.length)]!;
        if (op === 4) await voidTransaction(db, id);
        else if (op === 5) await softDeleteTransaction(db, id, i);
        else await restoreTransaction(db, id, i);
      }
    }
    await clean(db);
  }, 60_000);
});
