// Net worth and cashflow in a base currency, using the manual offline exchange rates (PROMPT.md §4.1 #16).
// rate_ppm: 1 major unit of base_currency = rate_ppm / 1e6 major units of quote_currency.
import { divRoundHalfUp, MINOR_DIGITS, type CurrencyCode } from '../currency/money';
import type { Account, ExchangeRate, Transaction } from '../storage/schema';

export function latestRate(rates: readonly ExchangeRate[], base: CurrencyCode, quote: CurrencyCode, at: number): ExchangeRate | undefined {
  let best: ExchangeRate | undefined;
  for (const r of rates) {
    if (r.deleted_at !== null || r.base_currency !== base || r.quote_currency !== quote || r.effective_at > at) continue;
    if (!best || r.effective_at > best.effective_at) best = r;
  }
  return best;
}

/** Convert minor units of `from` into minor units of `to`. Null when no usable rate exists. */
export function convertMinor(minor: bigint, from: CurrencyCode, to: CurrencyCode, rates: readonly ExchangeRate[], at: number): bigint | null {
  if (from === to) return minor;
  const fd = 10n ** BigInt(MINOR_DIGITS[from]);
  const td = 10n ** BigInt(MINOR_DIGITS[to]);
  const direct = latestRate(rates, from, to, at);
  if (direct && direct.rate_ppm > 0n) return divRoundHalfUp(minor * direct.rate_ppm * td, 1_000_000n * fd);
  const inverse = latestRate(rates, to, from, at);
  if (inverse && inverse.rate_ppm > 0n) return divRoundHalfUp(minor * 1_000_000n * td, inverse.rate_ppm * fd);
  return null;
}

export interface NetWorth {
  totalMinor: bigint;
  base: CurrencyCode;
  perAccount: Map<string, bigint | null>;
  missingRates: CurrencyCode[];
}

/** Σ of live, non-archived, included accounts in `base`. Accounts without a rate are listed, not guessed. */
export function computeNetWorth(accounts: readonly Account[], rates: readonly ExchangeRate[], base: CurrencyCode = 'IRR', at = Date.now()): NetWorth {
  let total = 0n;
  const perAccount = new Map<string, bigint | null>();
  const missing = new Set<CurrencyCode>();
  for (const a of accounts) {
    if (a.deleted_at !== null || a.is_archived || !a.is_included_in_net_worth) continue;
    const v = convertMinor(a.current_balance_minor, a.currency_code, base, rates, at);
    perAccount.set(a.id, v);
    if (v === null) missing.add(a.currency_code);
    else total += v;
  }
  return { totalMinor: total, base, perAccount, missingRates: [...missing] };
}

/** Income and expense in `base` over [from, to). Transfers, pending, voided and trashed rows never count. */
export function cashflowInBase(txs: readonly Transaction[], rates: readonly ExchangeRate[], from: number, to: number, base: CurrencyCode = 'IRR') {
  let income = 0n;
  let expense = 0n;
  for (const t of txs) {
    if (t.status !== 'posted' || t.deleted_at !== null || t.occurred_at < from || t.occurred_at >= to) continue;
    if (t.type !== 'income' && t.type !== 'expense') continue;
    const v = convertMinor(t.amount_minor, t.currency_code, base, rates, t.occurred_at) ?? 0n;
    if (t.type === 'income') income += v;
    else expense += v;
  }
  return { income, expense, net: income - expense };
}
