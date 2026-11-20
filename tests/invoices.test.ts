// Phase 7 gate (part 1): exact minor-unit invoice math, totals in words, numbering uniqueness, payment
// posting idempotency, encrypted attachments, and statements, on both storage adapters.
import { describe, expect, it } from 'vitest';
import { ADAPTERS, makeWebVault } from './helpers/vaults';
import { createAccount, type AccountInput } from '../src/core/ledger/accounts';
import { createTransaction, verifyLedger } from '../src/core/ledger/ledger';
import {
  computeTotals,
  emptyProfile,
  formatQuantity,
  invoiceNumber,
  parseQuantity,
  postInvoicePayment,
  qrSummary,
  saveCustomer,
  saveInvoice,
  saveProfile,
  totalInWords,
  undoLastPayment,
  validateParty,
  type InvoiceInput,
} from '../src/core/invoices/invoices';
import { loadAttachment, saveImageAttachment, sniffImage } from '../src/core/attachments/attachments';
import { buildStatement } from '../src/core/exports/statement';
import { startOfCalendarDay } from '../src/core/calendar/calendar';
import { UniqueViolation, type IVaultDatabase } from '../src/core/storage/IVaultDatabase';
import { td } from '../src/core/crypto/bytes';

const NOON = 12 * 3_600_000;
const jNoon = (y: number, m: number, d: number) => startOfCalendarDay({ y, m, d }, 'jalali') + NOON;

const acct = (db: IVaultDatabase, currency: AccountInput['currency_code'] = 'IRR', balance = 0n) =>
  createAccount(db, { name: 'ملت', type: 'bank_account', bank_code: 'mellat', card_number: '', iban_sheba: '', account_number: '', currency_code: currency, initial_balance_minor: balance, card_finish: 'obsidian_carbon', is_included_in_net_worth: true, notes: '' });

const line = (qty: bigint, price: bigint, discount = 0n) => ({ quantity_milli: qty, unit_price_minor: price, discount_minor: discount });

const draft = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  kind: 'invoice',
  customer_id: null,
  issued_at: jNoon(1405, 8, 29),
  due_at: null,
  currency_code: 'IRR',
  discount_minor: 0n,
  vat_bps: 1000,
  template: 'official',
  notes: '',
  items: [{ product_id: null, description: 'طراحی لوگو', ...line(1000n, 25_000_000n) }],
  issue: true,
  ...over,
});

describe('invoice math (exact bigint, one rounding rule)', () => {
  it('line extension rounds half-up once per line', () => {
    // 2.5 × 1,333 = 3,332.5 → 3,333 ; 0.333 × 10 = 3.33 → 3
    const t = computeTotals([line(2500n, 1333n), line(333n, 10n)], 0n, 0);
    expect(t.lines.map((l) => l.gross)).toEqual([3333n, 3n]);
    expect(t.subtotal).toBe(3336n);
    expect(t.total).toBe(3336n);
  });

  it('line and invoice discounts, then VAT on the taxable base', () => {
    const t = computeTotals([line(3000n, 1_250_000n, 250_000n), line(1000n, 999_999n)], 100_000n, 1000);
    expect(t.lines[0]).toEqual({ gross: 3_750_000n, discount: 250_000n, net: 3_500_000n });
    expect(t.subtotal).toBe(4_499_999n);
    expect(t.lineDiscounts).toBe(250_000n);
    expect(t.taxable).toBe(4_399_999n);
    expect(t.vat).toBe(440_000n); // 439,999.9 → 440,000
    expect(t.total).toBe(4_839_999n);
  });

  it('VAT rounds half-up at exactly .5 and down below it', () => {
    expect(computeTotals([line(1000n, 5n)], 0n, 1000).vat).toBe(1n); // 0.5 → 1
    expect(computeTotals([line(1000n, 4n)], 0n, 1000).vat).toBe(0n); // 0.4 → 0
    expect(computeTotals([line(1000n, 15n)], 0n, 900).vat).toBe(1n); // 1.35 → 1
    expect(computeTotals([line(1000n, 100n)], 0n, 0).vat).toBe(0n);
  });

  it('cent currencies stay exact (USD)', () => {
    const t = computeTotals([line(1500n, 1999n)], 0n, 1000); // 1.5 × $19.99 = $29.985 → $29.99
    expect(t.subtotal).toBe(2999n);
    expect(t.vat).toBe(300n); // $2.999 → $3.00
    expect(t.total).toBe(3299n);
  });

  it('columns always add up to the total', () => {
    for (let s = 1; s < 60; s++) {
      const items = [line(BigInt(s * 137), BigInt(s * 9_871)), line(1000n, BigInt(s * 3), BigInt(s % 3))];
      const t = computeTotals(items, BigInt(s % 7), (s * 37) % 1500);
      expect(t.lines.reduce((a, l) => a + l.net, 0n)).toBe(t.subtotal);
      expect(t.subtotal - t.invoiceDiscount + t.vat).toBe(t.total);
    }
  });

  it('rejects values it cannot represent honestly', () => {
    expect(() => computeTotals([line(0n, 10n)], 0n, 1000)).toThrow('INVOICE_QTY');
    expect(() => computeTotals([line(1000n, -1n)], 0n, 1000)).toThrow('INVOICE_PRICE');
    expect(() => computeTotals([line(1000n, 10n, 11n)], 0n, 1000)).toThrow('INVOICE_LINE_DISCOUNT');
    expect(() => computeTotals([line(1000n, 10n)], 11n, 1000)).toThrow('INVOICE_DISCOUNT');
    expect(() => computeTotals([line(1000n, 10n)], 0n, 10_001)).toThrow('INVOICE_VAT');
    expect(() => computeTotals([line(1000n, 10n)], 0n, 9.5)).toThrow('INVOICE_VAT');
  });

  it('quantities parse to exact thousandths', () => {
    expect(parseQuantity('2.5')).toBe(2500n);
    expect(parseQuantity('۳٫۱۲۵')).toBe(3125n);
    expect(parseQuantity('7')).toBe(7000n);
    expect(() => parseQuantity('1.2345')).toThrow();
    expect(() => parseQuantity('0')).toThrow();
    expect(() => parseQuantity('-1')).toThrow();
    expect(formatQuantity(2500n)).toBe('2.5');
    expect(formatQuantity(7000n)).toBe('7');
    expect(formatQuantity(3125n)).toBe('3.125');
  });

  it('total in Persian words (Toman keeps the Rial remainder; Rial; cents)', () => {
    expect(totalInWords(27_500_000n, 'IRR', 'toman', 'تومان')).toBe('دو میلیون و هفتصد و پنجاه هزار تومان');
    expect(totalInWords(27_500_005n, 'IRR', 'toman', 'تومان')).toBe('دو میلیون و هفتصد و پنجاه هزار تومان و پنج ریال');
    expect(totalInWords(1_001_000n, 'IRR', 'rial', 'ریال')).toBe('یک میلیون و هزار ریال');
    expect(totalInWords(3299n, 'USD', 'toman', 'دلار')).toBe('سی و دو دلار و نود و نه صدم');
  });

  it('seller and buyer IDs use the national ID / economic code validators', () => {
    expect(validateParty({ name: 'آریزو', national_id: '0084575948', economic_code: '' })).toEqual([]);
    expect(validateParty({ name: 'آریزو', national_id: '', economic_code: '411111111111' })).toEqual([]);
    expect(validateParty({ name: '', national_id: '0084575940', economic_code: '12' })).toEqual(['name', 'national_id', 'economic_code']);
  });

  it('QR summary is plain text with no URL', () => {
    const q = qrSummary({ number: 'ARZ-1405-0001', seller: 'آریزو', seller_code: '411111111111', issued_at: jNoon(1405, 8, 29), total: 27_500_000n, currency: 'IRR' });
    expect(q).toContain('INV:ARZ-1405-0001');
    expect(q).toContain('DATE:1405/08/29');
    expect(q).toContain('TOTAL:27500000 IRR');
    expect(q).not.toMatch(/https?:/);
  });
});

describe.each(ADAPTERS)('invoices — %s', (_n, make) => {
  it('auto-numbers per Jalali year with zero padding, and numbers stay unique', async () => {
    const db = await make();
    await saveProfile(db, { ...emptyProfile(), name: 'استودیو آریزو', invoice_prefix: 'ARZ' });
    const a = await saveInvoice(db, draft());
    const b = await saveInvoice(db, draft());
    const c = await saveInvoice(db, draft({ issued_at: jNoon(1406, 1, 2) }));
    expect([a.invoice.number, b.invoice.number, c.invoice.number]).toEqual(['ARZ-1405-0001', 'ARZ-1405-0002', 'ARZ-1406-0001']);
    expect(invoiceNumber('ARZ', 1405, 42)).toBe('ARZ-1405-0042');
    // Editing keeps the number; a forced clash is refused by UNIQUE(invoices.number).
    const edited = await saveInvoice(db, { ...draft(), id: a.invoice.id, notes: 'x' });
    expect(edited.invoice.number).toBe('ARZ-1405-0001');
    await expect(db.put('invoices', { ...b.invoice, id: 'other', number: 'ARZ-1405-0001' })).rejects.toBeInstanceOf(UniqueViolation);
    expect((await saveInvoice(db, draft())).invoice.number).toBe('ARZ-1405-0003');
  });

  it('a proforma never becomes payable', async () => {
    const db = await make();
    const acc = await acct(db);
    const { invoice } = await saveInvoice(db, draft({ kind: 'proforma' }));
    expect(invoice.status).toBe('draft');
    await expect(postInvoicePayment(db, invoice.id, { account_id: acc.id })).rejects.toThrow('INVOICE_PROFORMA');
  });

  it('1-tap payment posts exactly once; partial then full; undo reopens', async () => {
    const db = await make();
    const acc = await acct(db, 'IRR', 1_000_000n);
    const cust = await saveCustomer(db, { name: 'شرکت نمونه', national_id: '', economic_code: '', address: '', phone: '' });
    const { invoice } = await saveInvoice(db, draft({ customer_id: cust.id }));
    expect(invoice.status).toBe('unpaid');
    const total = 27_500_000n;

    const part = await postInvoicePayment(db, invoice.id, { account_id: acc.id, amount_minor: 7_500_000n });
    expect(part.created).toBe(true);
    expect(part.invoice.status).toBe('partial');
    const full = await postInvoicePayment(db, invoice.id, { account_id: acc.id });
    expect(full.tx.amount_minor).toBe(total - 7_500_000n);
    expect(full.invoice.status).toBe('paid');
    // Double tap: nothing new is posted.
    const again = await postInvoicePayment(db, invoice.id, { account_id: acc.id });
    expect(again.created).toBe(false);
    expect(again.tx.id).toBe(full.tx.id);
    const linked = (await db.find('transactions', { account_id: acc.id })).filter((t) => t.linked_entity_type === 'invoice' && t.status === 'posted');
    expect(linked).toHaveLength(2);
    expect(linked.every((t) => t.source === 'invoice' && t.type === 'income' && t.category_id === 'cat_business' && t.merchant_name === 'شرکت نمونه')).toBe(true);
    expect((await db.get('accounts', acc.id))!.current_balance_minor).toBe(1_000_000n + total);
    await expect(saveInvoice(db, { ...draft(), id: invoice.id })).rejects.toThrow('INVOICE_LOCKED');

    const reopened = await undoLastPayment(db, invoice.id);
    expect(reopened.status).toBe('partial');
    expect(reopened.paid_minor).toBe(7_500_000n);
    expect((await db.get('accounts', acc.id))!.current_balance_minor).toBe(1_000_000n + 7_500_000n);
    await expect(postInvoicePayment(db, invoice.id, { account_id: acc.id, amount_minor: total })).rejects.toThrow('INVOICE_PAYMENT_AMOUNT');
    const repaid = await postInvoicePayment(db, invoice.id, { account_id: acc.id });
    expect(repaid.created).toBe(true);
    expect(repaid.invoice.status).toBe('paid');
    expect((await verifyLedger(db)).drift).toEqual([]);
  });

  it('refuses a payment into an account of another currency', async () => {
    const db = await make();
    const usd = await acct(db, 'USD');
    const { invoice } = await saveInvoice(db, draft());
    await expect(postInvoicePayment(db, invoice.id, { account_id: usd.id })).rejects.toThrow('INVOICE_CURRENCY');
  });

  it('logo/signature attachments round-trip and are type-checked by magic bytes', async () => {
    const db = await make();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
    expect(sniffImage(png)).toBe('image/png');
    await expect(saveImageAttachment(db, { owner_type: 'business_profile', owner_id: 'main' }, new TextEncoder().encode('<svg onload=x>'))).rejects.toThrow('ATTACHMENT_TYPE');
    const row = await saveImageAttachment(db, { owner_type: 'business_profile', owner_id: 'main' }, png);
    const back = await loadAttachment(db, row.id);
    expect(back?.bytes).toEqual(png);
    expect(back?.row.mime_type).toBe('image/png');
    await db.clearAll();
    expect(await db.getBlob(row.encrypted_blob_key)).toBeUndefined();
  });

  it('statement: opening, running and closing balances agree with the ledger', async () => {
    const db = await make();
    const acc = await acct(db, 'IRR', 10_000_000n);
    const d = (day: number) => jNoon(1405, 8, day);
    await createTransaction(db, { account_id: acc.id, type: 'expense', amount_minor: 1_000_000n, occurred_at: d(1) });
    await createTransaction(db, { account_id: acc.id, type: 'income', amount_minor: 5_000_000n, occurred_at: d(10) });
    await createTransaction(db, { account_id: acc.id, type: 'expense', amount_minor: 2_500_000n, occurred_at: d(20) });
    await createTransaction(db, { account_id: acc.id, type: 'income', amount_minor: 700_000n, occurred_at: jNoon(1405, 9, 2) });
    const a = (await db.get('accounts', acc.id))!;
    const from = startOfCalendarDay({ y: 1405, m: 8, d: 5 }, 'jalali');
    const to = startOfCalendarDay({ y: 1405, m: 9, d: 1 }, 'jalali');
    const s = buildStatement(a, await db.find('transactions', { account_id: acc.id }), from, to);
    expect(s.opening).toBe(9_000_000n);
    expect(s.rows.map((r) => r.balance)).toEqual([14_000_000n, 11_500_000n]);
    expect(s.closing).toBe(11_500_000n);
    expect(s.inflow).toBe(5_000_000n);
    expect(s.outflow).toBe(2_500_000n);
  });
});

describe('attachments at rest (web)', () => {
  it('the stored blob is AES-GCM ciphertext bound to its id', async () => {
    const db = await makeWebVault();
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode('SECRET-LOGO-PIXELS')]);
    const row = await saveImageAttachment(db, { owner_type: 'business_profile', owner_id: 'main' }, bytes);
    const t = db.rawBlobTable();
    const raw = await t.get(row.encrypted_blob_key);
    expect(raw).toBeDefined();
    expect(td.decode(raw!.c)).not.toContain('SECRET-LOGO');
    expect(row.nonce_b64.length).toBeGreaterThan(10);
    // Moving the ciphertext under another id fails authentication (AAD = id).
    await t.put({ id: 'other', c: raw!.c });
    await expect(db.getBlob('other')).rejects.toThrow();
    // A flipped bit is caught.
    const bad = new Uint8Array(raw!.c);
    bad[bad.length - 1]! ^= 1;
    await t.put({ id: row.encrypted_blob_key, c: bad });
    expect(await loadAttachment(db, row.id)).toBeNull();
  });
});
