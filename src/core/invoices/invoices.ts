// Invoice Studio core (PROMPT.md §4.1 #15, §7 #7): business profile, customers, products, invoices,
// line items, numbering, payments. Exact bigint minor units only.
//
// ROUNDING RULE (the only one): half-up (away from zero), applied at exactly two points:
//   1. each line's extension  qty_milli × unit_price / 1000  → whole minor units;
//   2. VAT on the taxable base  taxable × vat_bps / 10 000  → whole minor units.
// Discounts, subtotal and total are exact integer sums of already-rounded values, so the printed
// columns always add up to the printed total.
import { toCalendarDate } from '../calendar/calendar';
import { divRoundHalfUp, MINOR_DIGITS, sumMinor, type CurrencyCode } from '../currency/money';
import { amountToPersianWords, numToPersianWords } from '../currency/numToPersianWords';
import { postLinkedTransaction, voidTransaction } from '../ledger/ledger';
import type { IVaultDatabase, VaultTx } from '../storage/IVaultDatabase';
import type { BusinessProfile, Customer, Invoice, InvoiceItem, Product, Transaction } from '../storage/schema';
import { onlyDigits } from '../utils/digits';
import { uuidv7 } from '../utils/uuidv7';
import { isValidEconomicCode, isValidLegalNationalId, isValidNationalId } from '../validators';

export class InvoiceError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'InvoiceError';
  }
}

export const DEFAULT_VAT_BPS = 1000;
export const PROFILE_ID = 'main';
export const MAX_ITEMS = 200;

// ---------- math ----------

export interface LineInput {
  quantity_milli: bigint;
  unit_price_minor: bigint;
  discount_minor: bigint;
}
export interface LineTotals {
  gross: bigint;
  discount: bigint;
  net: bigint;
}
export interface InvoiceTotals {
  lines: LineTotals[];
  subtotal: bigint;
  lineDiscounts: bigint;
  invoiceDiscount: bigint;
  taxable: bigint;
  vat: bigint;
  total: bigint;
}

export const lineGross = (l: Pick<LineInput, 'quantity_milli' | 'unit_price_minor'>): bigint => divRoundHalfUp(l.quantity_milli * l.unit_price_minor, 1000n);

/** Throws InvoiceError on any value the invoice cannot represent honestly. */
export function computeTotals(items: readonly LineInput[], invoiceDiscount: bigint, vatBps: number): InvoiceTotals {
  if (!Number.isInteger(vatBps) || vatBps < 0 || vatBps > 10_000) throw new InvoiceError('INVOICE_VAT');
  if (invoiceDiscount < 0n) throw new InvoiceError('INVOICE_DISCOUNT');
  const lines = items.map((l) => {
    if (l.quantity_milli <= 0n) throw new InvoiceError('INVOICE_QTY');
    if (l.unit_price_minor < 0n) throw new InvoiceError('INVOICE_PRICE');
    const gross = lineGross(l);
    if (l.discount_minor < 0n || l.discount_minor > gross) throw new InvoiceError('INVOICE_LINE_DISCOUNT');
    return { gross, discount: l.discount_minor, net: gross - l.discount_minor };
  });
  const subtotal = sumMinor(lines.map((l) => l.net));
  if (invoiceDiscount > subtotal) throw new InvoiceError('INVOICE_DISCOUNT');
  const taxable = subtotal - invoiceDiscount;
  const vat = divRoundHalfUp(taxable * BigInt(vatBps), 10_000n);
  return { lines, subtotal, lineDiscounts: sumMinor(lines.map((l) => l.discount)), invoiceDiscount, taxable, vat, total: taxable + vat };
}

/** Parse "2.5" / "۲٫۵" into thousandths. At most 3 decimals; must be > 0. */
export function parseQuantity(input: string): bigint {
  const s = input.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace('٫', '.').trim();
  const m = /^(\d+)(?:\.(\d{0,3}))?$/.exec(s);
  if (!m) throw new InvoiceError('INVOICE_QTY');
  const q = BigInt(m[1]! + (m[2] ?? '').padEnd(3, '0'));
  if (q <= 0n) throw new InvoiceError('INVOICE_QTY');
  return q;
}
export function formatQuantity(milli: bigint): string {
  const int = milli / 1000n;
  const frac = (milli % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : String(int);
}

/** Total in Persian words. IRR follows the display unit; other currencies name the fraction (صدم, ...). */
export function totalInWords(total: bigint, currency: CurrencyCode, irrUnit: 'rial' | 'toman', unitLabel: string): string {
  if (currency === 'IRR') return amountToPersianWords(total, irrUnit);
  const digits = MINOR_DIGITS[currency];
  const base = 10n ** BigInt(digits);
  const int = total / base;
  const frac = total % base;
  const denom: Record<number, string> = { 1: 'دهم', 2: 'صدم', 3: 'هزارم', 6: 'میلیونیم' };
  const main = `${numToPersianWords(int)} ${unitLabel}`;
  return frac === 0n ? main : `${main} و ${numToPersianWords(frac)} ${denom[digits] ?? ''}`.trim();
}

// ---------- numbering ----------

const PREFIX_RE = /^[A-Z]{2,5}$/;
export const invoiceNumber = (prefix: string, jalaliYear: number, seq: number) => `${prefix}-${jalaliYear}-${String(seq).padStart(4, '0')}`;

/** Next free number for the issue date's Jalali year, e.g. ARZ-1405-0042. UNIQUE(invoices.number) backs it. */
export async function nextInvoiceNumber(tx: VaultTx, prefix: string, issuedAt: number): Promise<string> {
  const year = toCalendarDate(issuedAt, 'jalali').y;
  const head = `${prefix}-${year}-`;
  let max = 0;
  for (const inv of await tx.find('invoices')) {
    if (!inv.number.startsWith(head)) continue;
    const n = Number(inv.number.slice(head.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return invoiceNumber(prefix, year, max + 1);
}

// ---------- business profile, customers, products ----------

export type IdFieldError = 'name' | 'national_id' | 'economic_code' | 'prefix' | 'vat';

/** National ID may be personal (10 digits) or legal (11 digits); both optional, checked when present. */
export function validateParty(p: { name: string; national_id: string; economic_code: string }): IdFieldError[] {
  const e: IdFieldError[] = [];
  if (!p.name.trim()) e.push('name');
  const nid = onlyDigits(p.national_id);
  if (p.national_id.trim() && !(isValidNationalId(nid) || isValidLegalNationalId(nid))) e.push('national_id');
  if (p.economic_code.trim() && !isValidEconomicCode(p.economic_code)) e.push('economic_code');
  return e;
}

export type ProfileInput = Omit<BusinessProfile, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>;
export function validateProfile(p: ProfileInput): IdFieldError[] {
  const e = validateParty(p);
  if (!PREFIX_RE.test(p.invoice_prefix)) e.push('prefix');
  if (!Number.isInteger(p.default_vat_bps) || p.default_vat_bps < 0 || p.default_vat_bps > 10_000) e.push('vat');
  return e;
}

export const emptyProfile = (): ProfileInput => ({ name: '', national_id: '', economic_code: '', address: '', phone: '', logo_attachment_id: null, signature_attachment_id: null, default_vat_bps: DEFAULT_VAT_BPS, invoice_prefix: 'ARZ' });

export function saveProfile(db: IVaultDatabase, p: ProfileInput, now = Date.now()): Promise<BusinessProfile> {
  return db.transaction(async (tx) => {
    if (validateProfile(p).length) throw new InvoiceError('PROFILE_INVALID');
    const prev = await tx.get('business_profile', PROFILE_ID);
    const row: BusinessProfile = { ...p, name: p.name.trim(), national_id: onlyDigits(p.national_id), economic_code: onlyDigits(p.economic_code), id: PROFILE_ID, created_at: prev?.created_at ?? now, updated_at: now, deleted_at: null };
    await tx.put('business_profile', row);
    return row;
  });
}

export type CustomerInput = Pick<Customer, 'name' | 'national_id' | 'economic_code' | 'address' | 'phone'>;
export function saveCustomer(db: IVaultDatabase, c: CustomerInput & { id?: string }, now = Date.now()): Promise<Customer> {
  return db.transaction(async (tx) => {
    if (validateParty(c).length) throw new InvoiceError('CUSTOMER_INVALID');
    const prev = c.id ? await tx.get('customers', c.id) : undefined;
    const row: Customer = { id: prev?.id ?? uuidv7(now), created_at: prev?.created_at ?? now, updated_at: now, deleted_at: null, name: c.name.trim(), national_id: onlyDigits(c.national_id), economic_code: onlyDigits(c.economic_code), address: c.address.trim(), phone: c.phone.trim() };
    await tx.put('customers', row);
    return row;
  });
}

export type ProductInput = Pick<Product, 'name' | 'unit' | 'unit_price_minor' | 'currency_code'>;
export function saveProduct(db: IVaultDatabase, p: ProductInput & { id?: string }, now = Date.now()): Promise<Product> {
  return db.transaction(async (tx) => {
    if (!p.name.trim()) throw new InvoiceError('PRODUCT_NAME');
    if (p.unit_price_minor < 0n) throw new InvoiceError('INVOICE_PRICE');
    const prev = p.id ? await tx.get('products', p.id) : undefined;
    const row: Product = { id: prev?.id ?? uuidv7(now), created_at: prev?.created_at ?? now, updated_at: now, deleted_at: null, name: p.name.trim(), unit: p.unit.trim(), unit_price_minor: p.unit_price_minor, currency_code: p.currency_code };
    await tx.put('products', row);
    return row;
  });
}

/** Soft delete. Invoice lines keep their own description and price, so nothing printed changes. */
export function deleteCatalogRow(db: IVaultDatabase, store: 'customers' | 'products', id: string, now = Date.now()) {
  return db.transaction(async (tx) => {
    const row = await tx.get(store, id);
    if (row) await tx.put(store, { ...row, deleted_at: now, updated_at: now });
  });
}

// ---------- invoices ----------

export interface ItemInput extends LineInput {
  product_id: string | null;
  description: string;
}
export interface InvoiceInput {
  id?: string;
  kind: Invoice['kind'];
  customer_id: string | null;
  issued_at: number;
  due_at: number | null;
  currency_code: CurrencyCode;
  discount_minor: bigint;
  vat_bps: number;
  template: Invoice['template'];
  notes: string;
  items: ItemInput[];
  /** Issue it (unpaid) instead of keeping a draft. A proforma always stays a draft (a quote is never payable). */
  issue: boolean;
}

export function saveInvoice(db: IVaultDatabase, input: InvoiceInput, now = Date.now()): Promise<{ invoice: Invoice; items: InvoiceItem[] }> {
  return db.transaction(async (tx) => {
    if (!input.items.length || input.items.length > MAX_ITEMS) throw new InvoiceError('INVOICE_ITEMS');
    if (input.items.some((i) => !i.description.trim())) throw new InvoiceError('INVOICE_DESCRIPTION');
    computeTotals(input.items, input.discount_minor, input.vat_bps); // validates every value
    if (input.customer_id && !(await tx.get('customers', input.customer_id))) throw new InvoiceError('CUSTOMER_NOT_FOUND');
    const prev = input.id ? await tx.get('invoices', input.id) : undefined;
    if (input.id && (!prev || prev.deleted_at !== null)) throw new InvoiceError('INVOICE_NOT_FOUND');
    if (prev && prev.paid_minor > 0n) throw new InvoiceError('INVOICE_LOCKED');
    const profile = await tx.get('business_profile', PROFILE_ID);
    const number = prev?.number ?? (await nextInvoiceNumber(tx, profile?.invoice_prefix ?? 'ARZ', input.issued_at));
    const invoice: Invoice = {
      id: prev?.id ?? uuidv7(now),
      created_at: prev?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      number,
      kind: input.kind,
      customer_id: input.customer_id,
      issued_at: input.issued_at,
      due_at: input.due_at,
      currency_code: input.currency_code,
      discount_minor: input.discount_minor,
      vat_bps: input.vat_bps,
      status: input.kind === 'invoice' && (input.issue || prev?.status === 'unpaid') ? 'unpaid' : 'draft',
      paid_minor: 0n,
      linked_tx_id: null,
      template: input.template,
      notes: input.notes,
    };
    await tx.put('invoices', invoice);
    for (const old of await tx.find('invoice_items', { invoice_id: invoice.id })) await tx.delete('invoice_items', old.id);
    const items = input.items.map((it, i): InvoiceItem => ({
      id: uuidv7(now),
      created_at: now,
      updated_at: now,
      deleted_at: null,
      invoice_id: invoice.id,
      product_id: it.product_id,
      description: it.description.trim(),
      quantity_milli: it.quantity_milli,
      unit_price_minor: it.unit_price_minor,
      discount_minor: it.discount_minor,
      sort_order: i,
    }));
    for (const it of items) await tx.put('invoice_items', it);
    return { invoice, items };
  });
}

export async function loadInvoice(db: IVaultDatabase, id: string) {
  const invoice = await db.get('invoices', id);
  if (!invoice || invoice.deleted_at !== null) return null;
  const items = (await db.find('invoice_items', { invoice_id: id })).sort((a, b) => a.sort_order - b.sort_order);
  const customer = invoice.customer_id ? ((await db.get('customers', invoice.customer_id)) ?? null) : null;
  return { invoice, items, customer, totals: computeTotals(items, invoice.discount_minor, invoice.vat_bps) };
}

export function deleteInvoice(db: IVaultDatabase, id: string, now = Date.now()) {
  return db.transaction(async (tx) => {
    const inv = await tx.get('invoices', id);
    if (!inv) return;
    if (inv.paid_minor > 0n) throw new InvoiceError('INVOICE_LOCKED');
    await tx.put('invoices', { ...inv, deleted_at: now, updated_at: now });
  });
}

const statusFor = (paid: bigint, total: bigint): Invoice['status'] => (paid === 0n ? 'unpaid' : paid >= total ? 'paid' : 'partial');

/** Payment n of an invoice is linked as `<invoice id>#<n>`, so a repeated tap can never post twice. */
const payKey = (invoiceId: string, n: number) => `${invoiceId}#${n}`;

async function livePayments(tx: VaultTx, invoiceId: string): Promise<{ n: number; tx: Transaction }[]> {
  const out: { n: number; tx: Transaction }[] = [];
  for (let n = 1; n <= MAX_ITEMS; n++) {
    const rows = (await tx.find('transactions', { linked_entity_id: payKey(invoiceId, n) })).filter((t) => t.linked_entity_type === 'invoice');
    if (!rows.length) break;
    const live = rows.find((t) => t.deleted_at === null && t.status !== 'voided');
    if (live) out.push({ n, tx: live });
  }
  return out;
}

export interface PaymentInput {
  account_id: string;
  /** Defaults to everything still owed. */
  amount_minor?: bigint;
  occurred_at?: number;
}

/**
 * 1-tap "Post Payment to Account": an income transaction in the invoice currency, linked to the invoice
 * through postLinkedTransaction. Paying an invoice with nothing left owed returns the last payment with
 * `created: false`, so a double tap never posts twice.
 */
export function postInvoicePayment(db: IVaultDatabase, invoiceId: string, p: PaymentInput, now = Date.now()): Promise<{ invoice: Invoice; tx: Transaction; created: boolean }> {
  return db.transaction(async (tx) => {
    const inv = await tx.get('invoices', invoiceId);
    if (!inv || inv.deleted_at !== null) throw new InvoiceError('INVOICE_NOT_FOUND');
    if (inv.kind === 'proforma') throw new InvoiceError('INVOICE_PROFORMA');
    const items = await tx.find('invoice_items', { invoice_id: inv.id });
    const { total } = computeTotals(items, inv.discount_minor, inv.vat_bps);
    const payments = await livePayments(tx, inv.id);
    const remaining = total - inv.paid_minor;
    if (remaining <= 0n) {
      const last = payments[payments.length - 1];
      if (!last) throw new InvoiceError('INVOICE_NOTHING_DUE');
      return { invoice: inv, tx: last.tx, created: false };
    }
    const amount = p.amount_minor ?? remaining;
    if (amount <= 0n || amount > remaining) throw new InvoiceError('INVOICE_PAYMENT_AMOUNT');
    const account = await tx.get('accounts', p.account_id);
    if (!account || account.deleted_at !== null) throw new InvoiceError('ACCOUNT_NOT_FOUND');
    if (account.currency_code !== inv.currency_code) throw new InvoiceError('INVOICE_CURRENCY');
    const customer = inv.customer_id ? await tx.get('customers', inv.customer_id) : undefined;
    const n = (payments[payments.length - 1]?.n ?? 0) + 1;
    const posted = await postLinkedTransaction(
      db,
      {
        account_id: account.id,
        type: 'income',
        amount_minor: amount,
        occurred_at: p.occurred_at ?? now,
        category_id: 'cat_business',
        merchant_name: customer?.name ?? '',
        note: inv.number,
        source: 'invoice',
        external_ref_code: inv.number,
        linked_entity_type: 'invoice',
        linked_entity_id: payKey(inv.id, n),
      },
      now,
    );
    const paid = inv.paid_minor + (posted.created ? amount : 0n);
    const invoice: Invoice = { ...inv, paid_minor: paid, status: statusFor(paid, total), linked_tx_id: posted.tx.id, updated_at: now };
    await tx.put('invoices', invoice);
    return { invoice, tx: posted.tx, created: posted.created };
  });
}

/** Undo the most recent payment: voids its transaction (the balance follows) and reopens the invoice. */
export function undoLastPayment(db: IVaultDatabase, invoiceId: string, now = Date.now()): Promise<Invoice> {
  return db.transaction(async (tx) => {
    const inv = await tx.get('invoices', invoiceId);
    if (!inv) throw new InvoiceError('INVOICE_NOT_FOUND');
    const payments = await livePayments(tx, inv.id);
    const last = payments[payments.length - 1];
    if (!last) throw new InvoiceError('INVOICE_NO_PAYMENT');
    await voidTransaction(db, last.tx.id, now);
    const items = await tx.find('invoice_items', { invoice_id: inv.id });
    const { total } = computeTotals(items, inv.discount_minor, inv.vat_bps);
    const paid = inv.paid_minor - last.tx.amount_minor;
    const invoice: Invoice = { ...inv, paid_minor: paid, status: statusFor(paid, total), linked_tx_id: payments[payments.length - 2]?.tx.id ?? null, updated_at: now };
    await tx.put('invoices', invoice);
    return invoice;
  });
}

/** Text in the invoice QR: plain fields only (no URL), so scanning it never sends anyone online. */
export function qrSummary(p: { number: string; seller: string; seller_code: string; issued_at: number; total: bigint; currency: CurrencyCode }): string {
  const d = toCalendarDate(p.issued_at, 'jalali');
  const date = `${d.y}/${String(d.m).padStart(2, '0')}/${String(d.d).padStart(2, '0')}`;
  return [`INV:${p.number}`, `SELLER:${p.seller}`, p.seller_code ? `CODE:${p.seller_code}` : '', `DATE:${date}`, `TOTAL:${p.total} ${p.currency}`].filter(Boolean).join('\n');
}
