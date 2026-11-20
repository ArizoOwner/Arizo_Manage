import { expect, test, type Page } from '@playwright/test';

// Phase 5 E2E on the encrypted web vault under strict CSP: Paste & Parse (OTP dropped, duplicate
// skipped), Review Queue approve moves the balance, Teach the Parser from the Inbox, and the iOS
// #/sms-ingest fragment is wiped from the URL before unlock and ingested after it.
const PIN = '482916';

async function typePin(page: Page, pin: string) {
  await expect(page.getByTestId('pin-pad').last()).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });
  for (const d of pin) await page.keyboard.press(d);
  await page.getByTestId('pin-submit').click();
}

const netWorth = (page: Page) => page.getByTestId('net-worth').locator('.sr-only');

async function setup(page: Page) {
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
  await page.getByTestId('acc-name').fill('حساب اصلی');
  await page.getByTestId('acc-balance').fill('10000000');
  await page.getByTestId('acc-save').click();
  await expect(netWorth(page)).toHaveText('۱۰٬۰۰۰٬۰۰۰ تومان');
}

async function openSms(page: Page) {
  await page.getByRole('link', { name: 'ابزارها' }).click();
  await page.getByRole('button', { name: 'مرکز پیامک' }).click();
}

const PURCHASE = 'بانک ملت\nخرید از اسنپ فود\nمبلغ 640,000 ریال\nمانده 99,360,000 ریال';

test('paste & parse: OTP dropped, duplicate skipped, approve posts and moves the balance', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:4173') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  await setup(page);
  await openSms(page);
  await page.getByRole('radio', { name: 'چسباندن' }).click();
  await page.getByTestId('paste-input').fill(`${PURCHASE}\n\nرمز پویا: 845123\nمبلغ: 2,000,000 ریال\n\n${PURCHASE}`);
  await page.getByTestId('paste-parse').click();
  const result = page.getByTestId('paste-result');
  await expect(result).toContainText('۱ تراکنش برای بازبینی');
  await expect(result).toContainText('۱ تکراری');
  await expect(result).toContainText('۱ رمز پویا یا تبلیغ');
  await result.getByRole('button', { name: 'ادامه' }).click();

  await expect(page.getByTestId('review-item')).toHaveCount(1);
  await expect(page.getByTestId('review-amount')).toHaveText('۶۴٬۰۰۰ تومان');
  await page.getByTestId('review-approve').click();
  await expect(page.getByTestId('review-item')).toHaveCount(0);
  // Bank reports 99,360,000 Rial and the ledger agrees: no drift badge.
  await expect(page.getByTestId('drift-badge')).toHaveCount(0);

  await page.getByRole('link', { name: 'خانه' }).click();
  await expect(netWorth(page)).toHaveText('۹٬۹۳۶٬۰۰۰ تومان');
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('teach the parser: tap amount and balance, the inbox message becomes a pending transaction', async ({ page }) => {
  await setup(page);
  await openSms(page);
  await page.getByRole('radio', { name: 'چسباندن' }).click();
  await page.getByTestId('paste-input').fill('Mellat\nTRX 45000 R\nREM 99955000 R');
  await page.getByTestId('paste-parse').click();
  await page.getByTestId('paste-result').getByRole('button', { name: 'ادامه' }).click();
  await expect(page.getByTestId('inbox-item')).toHaveCount(1);
  await page.getByTestId('teach-open').click();
  const tokens = page.getByTestId('teach-token');
  await tokens.nth(0).click();
  await tokens.nth(1).click();
  await expect(page.getByTestId('teach-preview')).toContainText('۴٬۵۰۰ تومان');
  await page.getByTestId('teach-save').click();
  await expect(page.getByTestId('inbox-item')).toHaveCount(0);
  await page.getByRole('radio', { name: /بازبینی/ }).click();
  await expect(page.getByTestId('review-amount')).toHaveText('۴٬۵۰۰ تومان');
  // Regex Studio lists the taught rule.
  await page.getByRole('radio', { name: 'قواعد' }).click();
  await expect(page.getByTestId('rule-row')).toHaveCount(1);
});

test('iOS shortcut fragment: wiped from the URL before unlock, ingested after unlock', async ({ page }) => {
  await setup(page);
  const b64 = Buffer.from('بانک ملی\nواریز 2,000,000 ریال\nمانده 102,000,000 ریال', 'utf8').toString('base64');
  // Cold start: the Shortcut opens Arizo (locked) with the message in the fragment.
  await page.goto('about:blank');
  await page.goto(`/#/sms-ingest?d=${encodeURIComponent(b64)}`);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/sms');
  expect(await page.evaluate(() => location.href)).not.toContain('sms-ingest');
  await typePin(page, PIN);
  await expect(page.getByTestId('review-item')).toHaveCount(1);
  await expect(page.getByTestId('review-amount')).toHaveText('۲۰۰٬۰۰۰ تومان');
});
