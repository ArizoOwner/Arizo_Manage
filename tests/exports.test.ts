// Phase 7 gate (part 2): UTF-8 BOM CSV, .xlsx generation, CSV import mapping/validation/dedupe through
// the ledger, and ESC/POS byte output.
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ADAPTERS } from './helpers/vaults';
import { createAccount } from '../src/core/ledger/accounts';
import { verifyLedger } from '../src/core/ledger/ledger';
import { BOM, csvBytes, parseCsv, toCsv } from '../src/core/exports/csv';
import { buildXlsx, exactNumber } from '../src/core/exports/xlsx';
import { EXPORT_HEADERS, exportableTxs, ledgerRows } from '../src/core/exports/ledgerExport';
import { commitImport, guessMapping, parseAmount, parseDate, previewImport } from '../src/core/exports/csvImport';
import { EscPos, receiptJob, toMonochrome } from '../src/core/print/escpos';
import { startOfCalendarDay, toCalendarDate, zonedParts } from '../src/core/calendar/calendar';
import type { IVaultDatabase } from '../src/core/storage/IVaultDatabase';
import { seedCategories } from '../src/core/data/seedCategories';

const acct = (db: IVaultDatabase) =>
  createAccount(db, { name: 'ملت', type: 'bank_account', bank_code: 'mellat', card_number: '', iban_sheba: '', account_number: '', currency_code: 'IRR', initial_balance_minor: 0n, card_finish: 'obsidian_carbon', is_included_in_net_worth: true, notes: '' });

describe('CSV (UTF-8 BOM)', () => {
  it('starts with EF BB BF and uses CRLF', () => {
    const b = csvBytes([['a', 'ب'], [1, 2n]]);
    expect([...b.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(b)).toBe(`${BOM}a,ب\r\n1,2\r\n`);
  });
  it('quotes separators, quotes and newlines; neutralises formulas', () => {
    expect(toCsv([['x,y', 'he said "hi"', 'a\nb', '=SUM(A1)', '-2+3', '@cmd']])).toBe(`${BOM}"x,y","he said ""hi""","a\nb",'=SUM(A1),'-2+3,'@cmd\r\n`);
  });
  it('round-trips through the parser (incl. ; and tab files)', () => {
    const rows = [['تاریخ', 'مبلغ', 'شرح'], ['1405/08/29', '-1250000', 'خرید "ویژه", نقدی'], ['1405/08/30', '500', 'خط\nدوم']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(parseCsv('a;b\r\n1;2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('.xlsx', () => {
  it('builds a real workbook (zip) with RTL sheet, bold header and exact amounts', async () => {
    const bytes = await buildXlsx([{ name: 'تراکنش‌ها', rtl: true, amountCols: [1], rows: [['شرح', 'مبلغ'], ['حقوق', '125000000'], ['بزرگ', '12345678901234567.89'], ['کسری', '-12.5']] }]);
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]); // PK zip
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe('تراکنش‌ها');
    expect(ws.views[0]?.rightToLeft).toBe(true);
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.getCell('B2').value).toBe(125000000);
    expect(ws.getCell('B3').value).toBe('12345678901234567.89'); // too long for a double: exact text
    expect(ws.getCell('B4').value).toBe(-12.5);
    expect(ws.getCell('A2').value).toBe('حقوق');
  });
  it('only short decimals become numbers', () => {
    expect(exactNumber('999999999999999')).toBe(999999999999999);
    expect(exactNumber('9999999999999999')).toBeNull();
    expect(exactNumber('12a')).toBeNull();
  });
});

describe('CSV import parsing', () => {
  it('dates: Jalali, Gregorian, d/m/y, Persian digits, 2-digit Jalali year; invalid refused', () => {
    const j = parseDate('1405/08/29', 'jalali', '14:30')!;
    expect(toCalendarDate(j, 'jalali')).toEqual({ y: 1405, m: 8, d: 29 });
    expect(zonedParts(j).hh).toBe(14);
    expect(toCalendarDate(parseDate('۱۴۰۵/۰۸/۲۹', 'jalali')!, 'jalali')).toEqual({ y: 1405, m: 8, d: 29 });
    expect(toCalendarDate(parseDate('05/08/29', 'jalali')!, 'jalali')).toEqual({ y: 1405, m: 8, d: 29 });
    expect(toCalendarDate(parseDate('2026-11-20', 'jalali')!, 'gregorian')).toEqual({ y: 2026, m: 11, d: 20 });
    expect(toCalendarDate(parseDate('20/11/2026', 'gregorian')!, 'gregorian')).toEqual({ y: 2026, m: 11, d: 20 });
    expect(parseDate('1405/13/01', 'jalali')).toBeNull();
    expect(parseDate('2026-02-30', 'gregorian')).toBeNull();
    expect(parseDate('yesterday', 'gregorian')).toBeNull();
  });
  it('amounts: exact, signed, Toman×10, refuses floats beyond precision', () => {
    expect(parseAmount('1,250,000', 'IRR', 'rial')).toBe(1_250_000n);
    expect(parseAmount('۱۲٬۵۰۰', 'IRR', 'toman')).toBe(125_000n);
    expect(parseAmount('12.5', 'IRR', 'toman')).toBe(125n);
    expect(parseAmount('12.55', 'IRR', 'toman')).toBeNull();
    expect(parseAmount('(500)', 'IRR', 'rial')).toBe(-500n);
    expect(parseAmount('500-', 'IRR', 'rial')).toBe(-500n);
    expect(parseAmount('$19.99', 'USD', 'rial')).toBe(1999n);
    expect(parseAmount('19.999', 'USD', 'rial')).toBeNull();
    expect(parseAmount('abc', 'IRR', 'rial')).toBeNull();
  });
  it('guesses the mapping from fa and en headers', () => {
    expect(guessMapping(['تاریخ', 'شرح', 'برداشت', 'واریز', 'کد پیگیری'])).toEqual({ date: 0, payee: 1, debit: 2, credit: 3, reference: 4 });
    expect(guessMapping(['Date', 'Amount', 'Category', 'Note'])).toEqual({ date: 0, amount: 1, category: 2, note: 3 });
  });
});

describe.each(ADAPTERS)('CSV import + export — %s', (_n, make) => {
  it('previews, flags errors and duplicates, posts once through the ledger', async () => {
    const db = await make();
    await seedCategories(db);
    const acc = await acct(db);
    const categories = await db.find('categories');
    const csv = toCsv([
      ['تاریخ', 'شرح', 'برداشت', 'واریز', 'دسته', 'کد پیگیری'],
      ['1405/08/01', 'اسنپ', '250000', '', 'حمل‌ونقل', 'R1'],
      ['1405/08/02', 'حقوق آبان', '', '450000000', 'حقوق', 'R2'],
      ['1405/08/02', 'حقوق آبان', '', '450000000', 'حقوق', 'R2'], // duplicate within the file
      ['1405/13/40', 'بد', '1', '', '', ''], // bad date
      ['1405/08/03', 'بد', 'xyz', '', '', ''], // bad amount
      ['1405/08/04', 'صفر', '0', '', '', ''], // zero
    ]);
    const rows = parseCsv(csv);
    const map = guessMapping(rows[0]!);
    const opts = { account: acc, calendar: 'jalali' as const, unit: 'rial' as const, categories, header: true };
    const preview = previewImport(rows, map, opts, []);
    expect(preview.map((p) => (p.ok ? (p.duplicate ?? 'ok') : p.error))).toEqual(['ok', 'ok', 'file', 'date', 'amount', 'zero']);
    expect(preview[0]).toMatchObject({ line: 2, type: 'expense', amount_minor: 250_000n, category_id: 'cat_transport', merchant_name: 'اسنپ', external_ref_code: 'R1' });
    expect(preview[1]).toMatchObject({ type: 'income', amount_minor: 450_000_000n, category_id: 'cat_salary' });

    expect(await commitImport(db, acc.id, preview)).toEqual({ posted: 2, skipped: 4 });
    const txs = await db.find('transactions', { account_id: acc.id });
    expect(txs).toHaveLength(2);
    expect(txs.every((t) => t.source === 'csv_import' && t.status === 'posted')).toBe(true);
    expect((await db.get('accounts', acc.id))!.current_balance_minor).toBe(450_000_000n - 250_000n);
    expect((await verifyLedger(db)).drift).toEqual([]);

    // Importing the same file again: everything is a ledger duplicate.
    const again = previewImport(rows, map, opts, txs);
    expect(again.filter((p) => p.ok).every((p) => p.duplicate)).toBe(true);
    expect((await commitImport(db, acc.id, again)).posted).toBe(0);

    // Export: exact signed amounts, header, BOM.
    const out = parseCsv(toCsv([EXPORT_HEADERS.fa, ...ledgerRows(exportableTxs(txs), { accounts: [acc], categories, lang: 'fa', cal: 'jalali' })]));
    expect(out[0]).toEqual(EXPORT_HEADERS.fa);
    expect(out.slice(1).map((r) => [r[0], r[6], r[7]])).toEqual([
      ['1405/08/01', '-250000', 'IRR'],
      ['1405/08/02', '450000000', 'IRR'],
    ]);
  });
});

describe('ESC/POS', () => {
  it('init, align, bold, ASCII text, feed and cut bytes', () => {
    const b = new EscPos().init().align('center').bold(true).line('ARZ-1405-0001').bold(false).text('ریال').feed(3).cut().bytes();
    expect([...b]).toEqual([0x1b, 0x40, 0x1b, 0x61, 1, 0x1b, 0x45, 1, ...new TextEncoder().encode('ARZ-1405-0001\n'), 0x1b, 0x45, 0, 0x3f, 0x3f, 0x3f, 0x3f, 0x1b, 0x64, 3, 0x1d, 0x56, 0x42, 0x00]);
  });
  it('GS v 0 raster packs bits MSB-first, pads rows to bytes, bands at 255 rows', () => {
    // 10 x 2 image: row 0 = first and last dot black, row 1 = all white.
    const bits = new Uint8Array(20);
    bits[0] = 1;
    bits[9] = 1;
    const b = [...new EscPos().raster(bits, 10, 2).bytes()];
    expect(b).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 2, 0, 0b10000000, 0b01000000, 0, 0]);
    const tall = [...new EscPos().raster(new Uint8Array(8 * 300), 8, 300).bytes()];
    expect(tall.slice(0, 8)).toEqual([0x1d, 0x76, 0x30, 0, 1, 0, 255, 0]);
    expect(tall.slice(8 + 255, 8 + 255 + 8)).toEqual([0x1d, 0x76, 0x30, 0, 1, 0, 45, 0]);
    expect(tall).toHaveLength(8 + 255 + 8 + 45);
    expect(() => new EscPos().raster(new Uint8Array(3), 2, 2)).toThrow('RASTER_SIZE');
  });
  it('monochrome conversion treats transparency as paper; a full job ends with feed + cut', () => {
    const rgba = Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 120, 120, 120, 255]);
    expect([...toMonochrome(rgba, 4, 1)]).toEqual([1, 0, 0, 1]);
    const job = receiptJob(Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]), 8, 1);
    expect([...job.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x61, 1]);
    expect([...job.slice(-7)]).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0]);
  });
});

it('statement range helpers use calendar day starts', () => {
  expect(startOfCalendarDay({ y: 1405, m: 1, d: 1 }, 'jalali')).toBeLessThan(startOfCalendarDay({ y: 1405, m: 1, d: 2 }, 'jalali'));
});
