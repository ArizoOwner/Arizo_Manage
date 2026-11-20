// Bank statement for one account and a half-open range [from, to): opening balance, every posted row
// with its running balance, closing balance, and per-day closing balances for the chart snapshot.
// Opening = current balance walked back through every posted row at or after `from`, so it always agrees
// with the ledger (including the initial balance and adjustments).
import { balanceEffect } from '../ledger/ledger';
import type { Account, Transaction } from '../storage/schema';

export interface StatementRow {
  tx: Transaction;
  delta: bigint;
  balance: bigint;
}
export interface Statement {
  account: Account;
  from: number;
  to: number;
  opening: bigint;
  closing: bigint;
  inflow: bigint;
  outflow: bigint;
  rows: StatementRow[];
}

export function buildStatement(account: Account, txs: readonly Transaction[], from: number, to: number): Statement {
  if (to <= from) throw new RangeError('STATEMENT_RANGE');
  const own = txs.filter((t) => t.account_id === account.id && balanceEffect(t) !== 0n).sort((a, b) => a.occurred_at - b.occurred_at || a.id.localeCompare(b.id));
  let opening = account.current_balance_minor;
  for (const t of own) if (t.occurred_at >= from) opening -= balanceEffect(t);
  let balance = opening;
  let inflow = 0n;
  let outflow = 0n;
  const rows: StatementRow[] = [];
  for (const t of own) {
    if (t.occurred_at < from || t.occurred_at >= to) continue;
    const delta = balanceEffect(t);
    balance += delta;
    if (delta > 0n) inflow += delta;
    else outflow -= delta;
    rows.push({ tx: t, delta, balance });
  }
  return { account, from, to, opening, closing: balance, inflow, outflow, rows };
}

/** Balance after the last row on or before each day start + 1 day (for the snapshot line). */
export function dailyClosings(s: Statement, dayStarts: readonly number[]): bigint[] {
  let i = 0;
  let bal = s.opening;
  return dayStarts.map((d) => {
    const end = d + 86_400_000;
    while (i < s.rows.length && s.rows[i]!.tx.occurred_at < end) bal = s.rows[i++]!.balance;
    return bal;
  });
}
