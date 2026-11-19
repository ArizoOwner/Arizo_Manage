// People, debts & receivables, partial settlements (PROMPT.md §4.1 #9, §7 #5).
// lent = they owe me (settlement is income); borrowed = I owe them (settlement is expense).
import { sumMinor, type CurrencyCode } from '../currency/money';
import { postLinkedTransaction, voidTransaction } from '../ledger/ledger';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import type { DebtReceivable, DebtSettlement, Person } from '../storage/schema';
import { normalizeIranMobile } from '../validators';
import { uuidv7 } from '../utils/uuidv7';

export function createPerson(db: IVaultDatabase, input: { name: string; phone: string; notes: string }, now = Date.now()) {
  return db.transaction(async (tx) => {
    if (!input.name.trim()) throw new Error('PERSON_NAME');
    const row: Person = { id: uuidv7(now), created_at: now, updated_at: now, deleted_at: null, name: input.name.trim(), phone: input.phone.trim() ? (normalizeIranMobile(input.phone) ?? input.phone.trim()) : null, notes: input.notes };
    await tx.put('people', row);
    return row;
  });
}

export interface DebtInput {
  person_id: string;
  direction: 'lent' | 'borrowed';
  amount_minor: bigint;
  currency_code: CurrencyCode;
  due_date_at: number | null;
  account_id: string | null;
  /** Lending money out of (or borrowing into) an account moves its balance now. */
  post_opening: boolean;
  note: string;
}

export function createDebt(db: IVaultDatabase, input: DebtInput, now = Date.now()) {
  return db.transaction(async (tx) => {
    if (input.amount_minor <= 0n) throw new Error('DEBT_AMOUNT');
    if (!(await tx.get('people', input.person_id))) throw new Error('PERSON_NOT_FOUND');
    const row: DebtReceivable = {
      id: uuidv7(now),
      created_at: now,
      updated_at: now,
      deleted_at: null,
      person_id: input.person_id,
      direction: input.direction,
      amount_minor: input.amount_minor,
      currency_code: input.currency_code,
      due_date_at: input.due_date_at,
      account_id: input.account_id,
      status: 'open',
      note: input.note,
    };
    await tx.put('debts_receivables', row);
    if (input.post_opening && input.account_id) {
      await postLinkedTransaction(
        db,
        {
          account_id: input.account_id,
          type: input.direction === 'lent' ? 'expense' : 'income',
          amount_minor: input.amount_minor,
          occurred_at: now,
          note: input.note,
          source: 'debt',
          linked_entity_type: 'debt_settlement',
          linked_entity_id: `${row.id}#opening`,
        },
        now,
      );
    }
    return row;
  });
}

export function remainingOf(debt: DebtReceivable, settlements: readonly DebtSettlement[]): bigint {
  return debt.amount_minor - sumMinor(settlements.filter((s) => s.debt_id === debt.id && s.deleted_at === null).map((s) => s.amount_minor));
}

/** Partial or full settlement. Cannot exceed what is left. Closes the debt when it reaches zero. */
export function settleDebt(db: IVaultDatabase, debtId: string, amount: bigint, account_id: string, now = Date.now()) {
  return db.transaction(async (tx) => {
    const debt = await tx.get('debts_receivables', debtId);
    if (!debt || debt.deleted_at !== null) throw new Error('DEBT_NOT_FOUND');
    const left = remainingOf(debt, await tx.find('debt_settlements', { debt_id: debtId }));
    if (amount <= 0n || amount > left) throw new Error('SETTLE_AMOUNT');
    const id = uuidv7(now);
    const person = await tx.get('people', debt.person_id);
    const res = await postLinkedTransaction(
      db,
      {
        account_id,
        type: debt.direction === 'lent' ? 'income' : 'expense',
        amount_minor: amount,
        occurred_at: now,
        merchant_name: person?.name ?? '',
        note: debt.note,
        source: 'debt',
        linked_entity_type: 'debt_settlement',
        linked_entity_id: id,
      },
      now,
    );
    const s: DebtSettlement = { id, created_at: now, updated_at: now, deleted_at: null, debt_id: debtId, amount_minor: amount, account_id, settled_at: now, tx_id: res.tx.id };
    await tx.put('debt_settlements', s);
    if (amount === left) await tx.put('debts_receivables', { ...debt, status: 'settled', updated_at: now });
    return s;
  });
}

/** Undo one settlement (voids its transaction, reopens the debt). */
export function undoSettlement(db: IVaultDatabase, settlementId: string, now = Date.now()) {
  return db.transaction(async (tx) => {
    const s = await tx.get('debt_settlements', settlementId);
    if (!s || s.deleted_at !== null) return;
    if (s.tx_id) await voidTransaction(db, s.tx_id, now);
    await tx.put('debt_settlements', { ...s, deleted_at: now, updated_at: now });
    const d = await tx.get('debts_receivables', s.debt_id);
    if (d && d.status === 'settled') await tx.put('debts_receivables', { ...d, status: 'open', updated_at: now });
  });
}

/** Per-person net: positive = they owe me, negative = I owe them. Per currency. */
export function personBalances(debts: readonly DebtReceivable[], settlements: readonly DebtSettlement[]) {
  const out = new Map<string, Map<CurrencyCode, bigint>>();
  for (const d of debts) {
    if (d.deleted_at !== null) continue;
    const left = remainingOf(d, settlements);
    const signed = d.direction === 'lent' ? left : -left;
    const m = out.get(d.person_id) ?? new Map<CurrencyCode, bigint>();
    m.set(d.currency_code, (m.get(d.currency_code) ?? 0n) + signed);
    out.set(d.person_id, m);
  }
  return out;
}
