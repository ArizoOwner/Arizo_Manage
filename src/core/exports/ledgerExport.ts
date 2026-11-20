// One table shape for every ledger export (CSV, XLSX, statements). Amounts are exact decimal strings
// built from bigint minor units (formatMinor without grouping), never floats.
import { toCalendarDate, zonedParts, type CalendarKind } from '../calendar/calendar';
import { formatMinor } from '../currency/money';
import { balanceEffect } from '../ledger/ledger';
import type { Account, Category, Transaction } from '../storage/schema';
import type { Cell } from './csv';

export interface ExportContext {
  accounts: readonly Account[];
  categories: readonly Category[];
  lang: 'fa' | 'en';
  cal: CalendarKind;
}

export const EXPORT_HEADERS = {
  fa: ['تاریخ', 'ساعت', 'حساب', 'نوع', 'دسته', 'طرف حساب', 'مبلغ', 'ارز', 'توضیح', 'کد پیگیری', 'شناسه'],
  en: ['Date', 'Time', 'Account', 'Type', 'Category', 'Payee', 'Amount', 'Currency', 'Note', 'Reference', 'ID'],
};

const TYPE_LABEL = {
  fa: { income: 'درآمد', expense: 'هزینه', transfer_in: 'انتقال ورودی', transfer_out: 'انتقال خروجی', adjustment: 'تعدیل' },
  en: { income: 'Income', expense: 'Expense', transfer_in: 'Transfer in', transfer_out: 'Transfer out', adjustment: 'Adjustment' },
};

const pad = (n: number) => String(n).padStart(2, '0');
export function dateCell(ms: number, cal: CalendarKind): string {
  const d = toCalendarDate(ms, cal);
  return `${d.y}/${pad(d.m)}/${pad(d.d)}`;
}
export function timeCell(ms: number): string {
  const p = zonedParts(ms);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

/** Signed amount: what the row did to its account (expense negative). */
export const signedAmount = (t: Transaction): bigint => balanceEffect({ ...t, status: 'posted', deleted_at: null });

/** Posted, not trashed rows only, oldest first. */
export function exportableTxs(txs: readonly Transaction[], from = -Infinity, to = Infinity): Transaction[] {
  return txs.filter((t) => t.deleted_at === null && t.status === 'posted' && t.occurred_at >= from && t.occurred_at < to).sort((a, b) => a.occurred_at - b.occurred_at || a.id.localeCompare(b.id));
}

export function ledgerRows(txs: readonly Transaction[], c: ExportContext): Cell[][] {
  const acc = new Map(c.accounts.map((a) => [a.id, a]));
  const cat = new Map(c.categories.map((x) => [x.id, x]));
  return txs.map((t) => {
    const category = t.category_id ? cat.get(t.category_id) : undefined;
    return [
      dateCell(t.occurred_at, c.cal),
      timeCell(t.occurred_at),
      acc.get(t.account_id)?.name ?? '',
      TYPE_LABEL[c.lang][t.type],
      category ? (c.lang === 'fa' ? category.name_fa : category.name_en) : '',
      t.merchant_name,
      formatMinor(signedAmount(t), t.currency_code, ''),
      t.currency_code,
      t.note,
      t.external_ref_code ?? '',
      t.id,
    ];
  });
}
