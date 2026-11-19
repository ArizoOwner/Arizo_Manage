// Cheques (چک صیادی) — PROMPT.md §4.1 #7, §7 #5.
// Clearing posts exactly one linked transaction (issued → expense, received → income).
// Bouncing / cancelling / transferring after a clear voids that transaction, so balances stay right.
import type { CurrencyCode } from '../currency/money';
import { postLinkedTransaction, voidTransaction } from '../ledger/ledger';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import type { Cheque, ChequeStatus } from '../storage/schema';
import { onlyDigits } from '../utils/digits';
import { uuidv7 } from '../utils/uuidv7';
import { isValidSayadId } from '../validators';

export interface ChequeInput {
  direction: 'issued' | 'received';
  cheque_number: string;
  sayad_id: string;
  bank_code: string | null;
  amount_minor: bigint;
  currency_code: CurrencyCode;
  due_date_at: number;
  counterparty_name: string;
  account_id: string | null;
  reminder_days: number[];
  notes: string;
}

export type ChequeFieldError = 'sayad' | 'amount' | 'counterparty';

export function validateCheque(c: ChequeInput): ChequeFieldError[] {
  const e: ChequeFieldError[] = [];
  if (!isValidSayadId(c.sayad_id)) e.push('sayad');
  if (c.amount_minor <= 0n) e.push('amount');
  if (!c.counterparty_name.trim()) e.push('counterparty');
  return e;
}

/** Allowed transitions. Terminal states can be reopened to pending to fix a mistake. */
const NEXT: Record<ChequeStatus, ChequeStatus[]> = {
  pending: ['cleared', 'bounced', 'cancelled', 'transferred'],
  cleared: ['pending', 'bounced'],
  bounced: ['pending', 'cleared'],
  cancelled: ['pending'],
  transferred: ['pending'],
};
export const canTransition = (from: ChequeStatus, to: ChequeStatus) => NEXT[from].includes(to);

export function createCheque(db: IVaultDatabase, input: ChequeInput, now = Date.now()) {
  return db.transaction(async (tx) => {
    if (validateCheque(input).length) throw new Error('CHEQUE_INVALID');
    const sayad = onlyDigits(input.sayad_id);
    const dup = (await tx.find('cheques')).find((c) => c.deleted_at === null && c.sayad_id === sayad && c.direction === input.direction);
    if (dup) throw new Error('CHEQUE_DUPLICATE_SAYAD');
    const row: Cheque = {
      id: uuidv7(now),
      created_at: now,
      updated_at: now,
      deleted_at: null,
      direction: input.direction,
      cheque_number: input.cheque_number.trim(),
      sayad_id: sayad,
      bank_code: input.bank_code,
      amount_minor: input.amount_minor,
      currency_code: input.currency_code,
      due_date_at: input.due_date_at,
      counterparty_name: input.counterparty_name.trim(),
      account_id: input.account_id,
      status: 'pending',
      linked_tx_id: null,
      reminder_days_json: [...new Set(input.reminder_days)].filter((d) => d >= 0 && d <= 30).sort((a, b) => b - a),
      notes: input.notes,
    };
    await tx.put('cheques', row);
    return row;
  });
}

export function setChequeStatus(db: IVaultDatabase, id: string, to: ChequeStatus, opts: { account_id?: string; occurred_at?: number } = {}, now = Date.now()) {
  return db.transaction(async (tx) => {
    const c = await tx.get('cheques', id);
    if (!c) throw new Error('CHEQUE_NOT_FOUND');
    if (c.status === to) return c;
    if (!canTransition(c.status, to)) throw new Error('CHEQUE_BAD_TRANSITION');
    let linked = c.linked_tx_id;
    if (to === 'cleared') {
      const account_id = opts.account_id ?? c.account_id;
      if (!account_id) throw new Error('CHEQUE_NEEDS_ACCOUNT');
      const res = await postLinkedTransaction(
        db,
        {
          account_id,
          type: c.direction === 'issued' ? 'expense' : 'income',
          amount_minor: c.amount_minor,
          occurred_at: opts.occurred_at ?? now,
          merchant_name: c.counterparty_name,
          note: `چک ${c.cheque_number || c.sayad_id.slice(-6)}`,
          source: 'cheque',
          linked_entity_type: 'cheque',
          linked_entity_id: c.id,
        },
        now,
      );
      linked = res.tx.id;
    } else if (c.status === 'cleared' && linked) {
      await voidTransaction(db, linked, now);
      linked = null;
    }
    const next: Cheque = { ...c, status: to, linked_tx_id: linked, account_id: opts.account_id ?? c.account_id, updated_at: now };
    await tx.put('cheques', next);
    return next;
  });
}

/** Total open exposure: pending issued (money that will leave) and pending received (money expected). */
export function chequeExposure(cheques: readonly Cheque[], currency: CurrencyCode = 'IRR') {
  let issued = 0n;
  let received = 0n;
  for (const c of cheques) {
    if (c.deleted_at !== null || c.status !== 'pending' || c.currency_code !== currency) continue;
    if (c.direction === 'issued') issued += c.amount_minor;
    else received += c.amount_minor;
  }
  return { issued, received, net: received - issued };
}
