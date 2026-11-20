// CSV Import Wizard engine: column mapping → typed preview with per-row errors → dedupe → posting
// through the ledger (createTransaction, source csv_import). Pure until commitImport.
import { isValidDate, jalaliToGregorian, zonedToUtc, type CalendarKind } from '../calendar/calendar';
import { parseMajor, type CurrencyCode } from '../currency/money';
import { createTransaction } from '../ledger/ledger';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import type { Account, Category, Transaction } from '../storage/schema';
import { toAsciiDigits } from '../utils/digits';

export type ImportField = 'date' | 'time' | 'amount' | 'debit' | 'credit' | 'type' | 'category' | 'payee' | 'note' | 'reference';
export type ColumnMap = Partial<Record<ImportField, number>>;

export interface ImportOptions {
  account: Account;
  calendar: CalendarKind;
  /** IRR files written in Toman are multiplied by 10. Ignored for other currencies. */
  unit: 'rial' | 'toman';
  categories: readonly Category[];
  /** Header row present (skipped). */
  header: boolean;
}

export type RowError = 'date' | 'amount' | 'zero';
export interface PreviewRow {
  line: number;
  ok: boolean;
  error?: RowError;
  duplicate?: 'ledger' | 'file';
  type?: 'income' | 'expense';
  amount_minor?: bigint;
  occurred_at?: number;
  category_id?: string | null;
  merchant_name?: string;
  note?: string;
  external_ref_code?: string | null;
}

const HINTS: Record<ImportField, RegExp> = {
  date: /^(date|تاریخ|day)/i,
  time: /^(time|ساعت|زمان)/i,
  amount: /^(amount|مبلغ|sum|value)/i,
  debit: /^(debit|withdraw|برداشت|بدهکار)/i,
  credit: /^(credit|deposit|واریز|بستانکار)/i,
  type: /^(type|نوع)/i,
  category: /^(category|دسته)/i,
  payee: /^(payee|merchant|description|طرف|شرح|فروشنده)/i,
  note: /^(note|memo|توضیح|یادداشت)/i,
  reference: /^(ref|reference|کد پیگیری|پیگیری|شماره سند|id)/i,
};

/** Best-guess mapping from the header row; the wizard lets the user change every column. */
export function guessMapping(header: readonly string[]): ColumnMap {
  const map: ColumnMap = {};
  header.forEach((h, i) => {
    const name = h.trim();
    for (const f of Object.keys(HINTS) as ImportField[]) if (map[f] === undefined && HINTS[f].test(name)) return void (map[f] = i);
  });
  return map;
}

/** "1405/08/29", "2026-11-20", "20/11/2026" (dmy when the first part ≤ 31 and the last has 4 digits). */
export function parseDate(raw: string, cal: CalendarKind, time = ''): number | null {
  const s = toAsciiDigits(raw).trim();
  const m = /^(\d{2,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/.exec(s);
  if (!m) return null;
  let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dmy = m[1]!.length <= 2 && m[3]!.length === 4;
  if (dmy) [a, c] = [c, a];
  // A 2-digit year (yy/mm/dd) belongs to the user's calendar century.
  const y = !dmy && m[1]!.length === 2 ? (cal === 'jalali' ? 1400 + a : 2000 + a) : a;
  const kind: CalendarKind = y < 1700 ? 'jalali' : 'gregorian';
  const ymd = { y, m: b, d: c };
  if (!isValidDate(kind, ymd)) return null;
  const g = kind === 'jalali' ? jalaliToGregorian(ymd) : ymd;
  const t = /(\d{1,2}):(\d{2})/.exec(toAsciiDigits(time || s.slice(m[0].length)));
  const hh = t ? Number(t[1]) : 12;
  const mm = t ? Number(t[2]) : 0;
  if (hh > 23 || mm > 59) return null;
  return zonedToUtc(g, undefined, hh, mm);
}

/** Exact parse of "1,250,000", "(500)", "-500", "۱۲٬۵۰۰", "500-" into a signed minor-unit bigint. */
export function parseAmount(raw: string, currency: CurrencyCode, unit: 'rial' | 'toman'): bigint | null {
  let s = toAsciiDigits(raw).replace(/[\s٬,]|ریال|تومان|IRR|USD|EUR|\$|€/g, '').replace('٫', '.');
  let neg = false;
  if (/^\(.*\)$/.test(s)) [s, neg] = [s.slice(1, -1), true];
  if (s.endsWith('-')) [s, neg] = [s.slice(0, -1), true];
  if (s.startsWith('-')) [s, neg] = [s.slice(1), !neg];
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  let v: bigint;
  if (currency === 'IRR' && unit === 'toman') {
    // 1 Toman = 10 Rial, so one decimal digit is exact (12.5 Toman = 125 Rial); more is refused, never rounded.
    const m = /^(\d+)(?:\.(\d)0*)?$/.exec(s);
    if (!m) return null;
    v = BigInt(m[1]!) * 10n + BigInt(m[2] ?? '0');
  } else {
    try {
      v = parseMajor(s, currency);
    } catch {
      return null;
    }
  }
  return neg ? -v : v;
}

const INCOME_WORDS = /^(income|credit|deposit|درآمد|واریز|بستانکار|\+)$/i;
const EXPENSE_WORDS = /^(expense|debit|withdraw|هزینه|برداشت|بدهکار|-)$/i;

/** Dedupe key: account + minute + signed amount + reference. Same key in the ledger or earlier in the file = duplicate. */
const keyOf = (accountId: string, at: number, signed: bigint, ref: string | null) => `${accountId}|${Math.floor(at / 60_000)}|${signed}|${ref ?? ''}`;
const txKey = (t: Transaction) => keyOf(t.account_id, t.occurred_at, t.type === 'expense' ? -t.amount_minor : t.amount_minor, t.external_ref_code);

export function previewImport(rows: readonly string[][], map: ColumnMap, o: ImportOptions, existing: readonly Transaction[]): PreviewRow[] {
  const cur = o.account.currency_code;
  const seen = new Set(existing.filter((t) => t.account_id === o.account.id && t.deleted_at === null && t.status !== 'voided').map(txKey));
  const byName = new Map(o.categories.filter((c) => c.deleted_at === null).flatMap((c) => [[c.name_fa.trim(), c], [c.name_en.trim().toLowerCase(), c]] as const));
  const get = (r: readonly string[], f: ImportField) => (map[f] === undefined ? '' : (r[map[f]!] ?? '').trim());
  const body = o.header ? rows.slice(1) : rows;
  return body.map((r, i): PreviewRow => {
    const line = i + (o.header ? 2 : 1);
    const at = parseDate(get(r, 'date'), o.calendar, get(r, 'time'));
    if (at === null) return { line, ok: false, error: 'date' };
    let signed: bigint | null;
    if (map.amount !== undefined) signed = parseAmount(get(r, 'amount'), cur, o.unit);
    else {
      const d = get(r, 'debit') ? parseAmount(get(r, 'debit'), cur, o.unit) : 0n;
      const c = get(r, 'credit') ? parseAmount(get(r, 'credit'), cur, o.unit) : 0n;
      signed = d === null || c === null ? null : c - (d < 0n ? -d : d);
    }
    if (signed === null) return { line, ok: false, error: 'amount' };
    const typeWord = get(r, 'type');
    if (EXPENSE_WORDS.test(typeWord) && signed > 0n) signed = -signed;
    if (INCOME_WORDS.test(typeWord) && signed < 0n) signed = -signed;
    if (signed === 0n) return { line, ok: false, error: 'zero' };
    const type = signed > 0n ? 'income' : 'expense';
    const catName = get(r, 'category');
    const cat = byName.get(catName) ?? byName.get(catName.toLowerCase());
    const ref = get(r, 'reference') || null;
    const k = keyOf(o.account.id, at, signed, ref);
    const duplicate = seen.has(k) ? (existing.some((t) => txKey(t) === k) ? 'ledger' : 'file') : undefined;
    seen.add(k);
    return {
      line,
      ok: true,
      ...(duplicate ? { duplicate } : {}),
      type,
      amount_minor: signed < 0n ? -signed : signed,
      occurred_at: at,
      category_id: cat && cat.type === type ? cat.id : null,
      merchant_name: get(r, 'payee').slice(0, 120),
      note: get(r, 'note').slice(0, 500),
      external_ref_code: ref,
    };
  });
}

/** Posts every valid, non-duplicate row. Each row is its own ledger transaction (balance stays exact). */
export async function commitImport(db: IVaultDatabase, accountId: string, rows: readonly PreviewRow[], now = Date.now()): Promise<{ posted: number; skipped: number }> {
  let posted = 0;
  for (const r of rows) {
    if (!r.ok || r.duplicate || !r.type || r.amount_minor === undefined || r.occurred_at === undefined) continue;
    await createTransaction(
      db,
      {
        account_id: accountId,
        type: r.type,
        amount_minor: r.amount_minor,
        occurred_at: r.occurred_at,
        category_id: r.category_id ?? null,
        merchant_name: r.merchant_name ?? '',
        note: r.note ?? '',
        external_ref_code: r.external_ref_code ?? null,
        source: 'csv_import',
      },
      now,
    );
    posted++;
  }
  return { posted, skipped: rows.length - posted };
}
