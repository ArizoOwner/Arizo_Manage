import { expect, test, type Page } from '@playwright/test';

// Phase 7 gate: Invoice Studio end to end on the real build (strict CSP, encrypted IndexedDB) at 390x844
// in fa RTL: business profile with validated IDs and a drawn signature, a customer, a 2-line invoice with
// VAT, a clean RTL print preview (print media: only the document, no overflow, Persian total in words),
// 1-tap payment posted once, a ledger receipt, an account statement, and the CSV import wizard.
// Zero console/CSP errors and zero external requests throughout.
const PIN = '482916';

async function typePin(page: Page, pin: string) {
  await expect(page.getByTestId('pin-pad').last()).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });
  for (const d of pin) await page.keyboard.press(d);
  await page.getByTestId('pin-submit').click();
}

async function onboardDemo(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('arizo.settings.v1')) localStorage.setItem('arizo.settings.v1', JSON.stringify({ lang: 'fa', theme: 'obsidian', calendar: 'jalali', irrUnit: 'toman' }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'شروع' }).click();
  await page.getByRole('button', { name: 'ادامه' }).click();
  await typePin(page, PIN);
  await typePin(page, PIN);
  await page.getByRole('button', { name: 'متوجه شدم' }).click({ timeout: 20_000 });
  await page.getByRole('button', { name: 'بعداً' }).click();
  await page.getByRole('button', { name: 'ادامه' }).click();
  await page.getByTestId('onboarding-demo').click();
  await expect(page.getByTestId('card-stack')).toBeVisible({ timeout: 30_000 });
}

function guard(page: Page) {
  const problems: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://localhost:4173') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  return { problems, external };
}

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

async function keypad(page: Page, digits: string[]) {
  const pad = page.getByRole('group', { name: 'مبلغ به حروف' }).last();
  for (const k of digits) await pad.getByRole('button', { name: k, exact: true }).click();
  await pad.getByRole('button', { name: 'تأیید' }).click();
}

async function tool(page: Page, name: string) {
  await page.getByRole('link', { name: 'ابزارها' }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('invoice studio: profile, invoice, RTL print preview, payment once, receipt, statement', async ({ page }) => {
  test.setTimeout(120_000); // one long journey through five screens
  const g = guard(page);
  await onboardDemo(page);

  // Business profile: a bad national ID is refused, a valid one saves; draw a signature.
  await tool(page, 'فاکتورها');
  await page.getByTestId('invoice-setup').click();
  await page.getByTestId('profile-name').fill('استودیو آریزو');
  await page.getByTestId('profile-nid').fill('0084575940');
  await page.getByTestId('profile-save').click();
  await expect(page.getByText('شناسه/کد ملی معتبر نیست')).toBeVisible();
  await page.getByTestId('profile-nid').fill('0084575948');
  await page.getByTestId('profile-sign').click();
  // hover() waits until the sheet has finished sliding in, so the box below is the final one.
  await page.getByTestId('signature-canvas').hover();
  const pad = (await page.getByTestId('signature-canvas').boundingBox())!;
  await page.mouse.move(pad.x + 30, pad.y + 100);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(pad.x + 30 + i * 18, pad.y + 100 + (i % 2 ? -30 : 25));
  await page.mouse.up();
  await page.getByTestId('signature-save').click();
  await expect(page.getByRole('img', { name: 'امضا' })).toBeVisible();
  await page.getByTestId('profile-save').click();

  // New invoice (the dock's "Invoice" quick action opens this route; a reload would lock the vault,
  // so navigate in-app), a new customer, two lines.
  await expect(page).toHaveURL(/#\/invoices$/); // the profile save navigates back first
  await page.evaluate(() => (location.hash = '#/invoices/new'));
  await page.getByRole('button', { name: 'مشتری جدید' }).click();
  await page.getByTestId('customer-name').fill('شرکت نمونهٔ پارس');
  await page.getByTestId('customer-save').click();
  await expect(page.getByTestId('invoice-customer')).not.toHaveValue('');
  await page.getByTestId('item-description').first().fill('طراحی لوگو');
  await page.getByTestId('item-price').first().click();
  await keypad(page, ['۲', '۵', '۰۰۰', '۰۰۰']);
  await page.getByTestId('item-add').click();
  await page.getByTestId('item-description').nth(1).fill('چاپ کارت ویزیت');
  await page.getByTestId('item-qty').nth(1).fill('2.5');
  await page.getByTestId('item-price').nth(1).click();
  await keypad(page, ['۴', '۰', '۰', '۰۰۰']);
  // 25,000,000 + 2.5 × 400,000 = 26,000,000 Toman; VAT 10% = 2,600,000; total 28,600,000.
  await expect(page.getByTestId('invoice-total')).toHaveText('۲۸٬۶۰۰٬۰۰۰ تومان');
  await noOverflow(page);
  await page.getByTestId('invoice-issue').click();

  // Detail: number, status, clean preview.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^ARZ-\d{4}-0001$/);
  await expect(page.getByTestId('invoice-status')).toHaveText('پرداخت‌نشده');
  const doc = page.getByTestId('paper-preview').getByTestId('invoice-doc');
  await expect(doc).toHaveAttribute('dir', 'rtl');
  await expect(doc).toContainText('بیست و هشت میلیون و ششصد هزار تومان');
  await expect(doc).toContainText('شرکت نمونهٔ پارس');
  await expect(doc.getByRole('img', { name: 'کد QR خلاصهٔ فاکتور' })).toBeVisible();
  await noOverflow(page);

  // Print media: only the print copy shows, in RTL with Vazirmatn, nothing wider than the page.
  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => {
    const portal = document.querySelector<HTMLElement>('.print-portal');
    const docEl = portal?.querySelector<HTMLElement>('.doc');
    const visibleApp = [...document.body.children].filter((e) => !e.classList.contains('print-portal') && getComputedStyle(e).display !== 'none').length;
    return {
      shown: portal ? getComputedStyle(portal).display : 'none',
      dir: docEl?.dir,
      visibleApp,
      // The print copy has the A4 printable width (210 − 2 × 12 mm); every row must fit inside it.
      docWider: docEl ? docEl.scrollWidth > docEl.clientWidth + 1 : true,
      widthMm: portal ? Math.round((portal.getBoundingClientRect().width * 25.4) / 96) : 0,
      font: docEl ? getComputedStyle(docEl).fontFamily : '',
    };
  });
  expect(printed).toMatchObject({ shown: 'block', dir: 'rtl', visibleApp: 0, docWider: false, widthMm: 186 });
  expect(printed.font).toContain('Vazirmatn');
  await page.emulateMedia({ media: 'screen' });

  // Thermal paper also previews cleanly.
  await page.getByRole('radio', { name: 'حرارتی ۸۰' }).click();
  await expect(page.getByTestId('paper-preview').getByTestId('invoice-doc')).toHaveClass(/t-thermal/);
  await noOverflow(page);
  await page.getByRole('radio', { name: 'A4' }).click();

  // Post payment once: status paid, the button is gone, the ledger has exactly one linked income.
  await page.getByTestId('invoice-pay').click();
  await page.getByTestId('pay-confirm').click();
  await expect(page.getByTestId('invoice-status')).toHaveText('پرداخت‌شده');
  await expect(page.getByTestId('invoice-pay')).toHaveCount(0);
  await page.getByRole('link', { name: 'دفتر' }).click();
  await page.getByTestId('ledger-search').fill('شرکت نمونهٔ پارس');
  await expect(page.getByTestId('tx-row')).toHaveCount(1);
  await expect(page.getByTestId('tx-row')).toContainText('۲۸٬۶۰۰٬۰۰۰ تومان');

  // Receipt from that ledger row.
  await page.getByRole('button', { name: 'رسید', exact: true }).first().click();
  const receipt = page.getByTestId('paper-preview').getByTestId('receipt-doc');
  await expect(receipt).toContainText('رسید تراکنش');
  await expect(receipt).toContainText('۲۸٬۶۰۰٬۰۰۰');
  await noOverflow(page);
  await page.keyboard.press('Escape');

  // Account statement of the first account, then a CSV export (re-auth if the 60 s window has passed).
  await tool(page, 'حساب‌ها و دارایی‌ها');
  await page.getByTestId('account-row').first().click();
  await page.getByTestId('account-statement').click();
  const stmt = page.getByTestId('paper-preview').getByTestId('statement-doc');
  await expect(stmt).toContainText('مانده اول دوره');
  await expect(stmt).toContainText('مانده پایان دوره');
  await noOverflow(page);
  const download = page.waitForEvent('download');
  await page.getByTestId('statement-csv').click();
  if (await page.getByTestId('pin-pad').isVisible().catch(() => false)) await typePin(page, PIN);
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);

  expect(g.problems).toEqual([]);
  expect(g.external).toEqual([]);
});

test('CSV import wizard: map, preview with errors and duplicates, post once', async ({ page }) => {
  const g = guard(page);
  await onboardDemo(page);
  await tool(page, 'ورود از CSV');
  const csv = '﻿تاریخ,شرح,برداشت,واریز,کد پیگیری\r\n1405/08/01,کافه,120000,,X1\r\n1405/08/02,پروژه,,9000000,X2\r\n1405/08/02,پروژه,,9000000,X2\r\n1405/13/01,بد,5,,\r\n';
  await page.getByTestId('import-file').setInputFiles({ name: 'bank.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.getByText('۴ ردیف خوانده شد')).toBeVisible();
  await expect(page.getByTestId('map-date')).toHaveValue('0');
  await expect(page.getByTestId('map-debit')).toHaveValue('2');
  await page.getByTestId('import-preview').click();
  await expect(page.getByTestId('import-summary')).toHaveText('۲ ردیف آمادهٔ ثبت · ۱ تکراری · ۱ نامعتبر');
  await noOverflow(page);
  await page.getByTestId('import-commit').click();
  await expect(page.getByTestId('import-done')).toHaveText('۲ تراکنش ثبت شد؛ ۲ ردیف کنار گذاشته شد.');
  await page.getByRole('link', { name: 'دفتر' }).click();
  await page.getByTestId('ledger-search').fill('پروژه');
  await expect(page.getByTestId('tx-row')).toHaveCount(1);
  expect(g.problems).toEqual([]);
  expect(g.external).toEqual([]);
});

test('batch statements from the ledger: week/month/year, per-bank selection, one account per printed sheet', async ({ page }) => {
  const g = guard(page);
  await onboardDemo(page);
  await page.getByRole('link', { name: 'دفتر' }).click();
  await page.getByRole('button', { name: 'صورتحساب گروهی' }).click();
  await expect(page.getByRole('heading', { name: 'صورتحساب گروهی', level: 1 })).toBeVisible();

  const accounts = page.getByTestId('batch-account');
  const total = await accounts.count();
  expect(total).toBeGreaterThan(1);
  const docs = page.getByTestId('paper-preview').getByTestId('statement-doc');
  await expect(docs).toHaveCount(total); // every account by default

  // None, then one bank: only that bank's accounts are printed.
  await page.getByRole('button', { name: 'هیچ', exact: true }).click();
  await expect(page.getByTestId('batch-count')).toHaveText('دست‌کم یک حساب انتخاب کنید');
  await expect(page.getByTestId('paper-preview')).toHaveCount(0);
  const firstBank = page.getByTestId('batch-accounts').locator('fieldset').first();
  const inBank = await firstBank.getByTestId('batch-account').count();
  await firstBank.getByTestId('batch-bank').check();
  await expect(docs).toHaveCount(inBank);

  // Yearly and weekly windows, and stepping back a period.
  await page.getByRole('radio', { name: 'سالانه' }).click();
  await expect(page.getByTestId('batch-period')).toContainText('۱ فروردین');
  await page.getByRole('radio', { name: 'هفتگی' }).click();
  const thisWeek = await page.getByTestId('batch-period').textContent();
  await page.getByRole('button', { name: 'دورهٔ قبل' }).click();
  await expect(page.getByTestId('batch-period')).not.toHaveText(thisWeek!);
  await page.getByRole('radio', { name: 'ماهانه' }).click();

  // The hidden print copy holds the same statements, each on its own sheet.
  await page.getByRole('button', { name: 'همه', exact: true }).click();
  const printed = page.locator('.print-portal .doc-batch > .doc');
  await expect(printed).toHaveCount(total);
  await page.emulateMedia({ media: 'print' });
  expect(await printed.nth(1).evaluate((el) => getComputedStyle(el).breakBefore)).toBe('page');
  await page.emulateMedia({ media: 'screen' });
  await noOverflow(page);
  expect(g.external).toEqual([]);
  expect(g.problems).toEqual([]);
});
