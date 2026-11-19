import { expect, test, type Page } from '@playwright/test';

// Phase 4 E2E: cheque → clear moves the balance; loan preview + pay installment; debt + partial settle;
// the dashboard Upcoming strip lists obligations. Runs on the encrypted web vault under strict CSP.
const PIN = '482916';

async function typePin(page: Page, pin: string) {
  await expect(page.getByTestId('pin-pad').last()).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });
  for (const d of pin) await page.keyboard.press(d);
  await page.getByTestId('pin-submit').click();
}

async function keypad(page: Page, digits: string[]) {
  const pad = page.getByRole('group', { name: 'مبلغ به حروف' }).last();
  for (const k of digits) await pad.getByRole('button', { name: k, exact: true }).click();
  await pad.getByRole('button', { name: 'تأیید' }).click();
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

async function tool(page: Page, name: string) {
  await page.getByRole('link', { name: 'ابزارها' }).click();
  await page.getByRole('button', { name }).click();
}

test('cheque: Sayad validation, appears in Upcoming, clearing posts the expense', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  await tool(page, 'چک‌ها');
  await page.getByRole('button', { name: 'چک جدید' }).click();
  await page.getByTestId('cheque-sayad').fill('12345');
  await page.getByTestId('cheque-counterparty').fill('آقای رضایی');
  await page.getByTestId('cheque-amount').click();
  await keypad(page, ['۲', '۰۰۰', '۰۰۰']);
  await page.getByTestId('cheque-save').click();
  await expect(page.getByText('شناسهٔ صیادی باید ۱۶ رقم باشد')).toBeVisible();
  await page.getByTestId('cheque-sayad').fill('1234567890123456');
  await page.getByTestId('cheque-save').click();
  await expect(page.getByTestId('cheque-row')).toHaveCount(1);
  await expect(page.getByTestId('exposure-issued')).toHaveText('۲٬۰۰۰٬۰۰۰ تومان');

  await page.getByRole('link', { name: 'خانه' }).click();
  await expect(page.getByTestId('obligation-row').filter({ hasText: 'آقای رضایی' })).toBeVisible();

  await tool(page, 'چک‌ها');
  await page.getByTestId('cheque-row').click();
  await page.getByTestId('cheque-cleared').click();
  await expect(page.getByTestId('exposure-issued')).toHaveText('۰ تومان');
  await page.getByRole('link', { name: 'خانه' }).click();
  await expect(netWorth(page)).toHaveText('۸٬۰۰۰٬۰۰۰ تومان');
  expect(errors).toEqual([]);
});

test('loan: live installment preview, pay one installment, remaining drops', async ({ page }) => {
  await setup(page);
  await tool(page, 'وام و اقساط');
  await page.getByRole('button', { name: 'وام جدید' }).click();
  await page.getByTestId('loan-title').fill('وام قرض‌الحسنه');
  await page.getByTestId('loan-principal').click();
  await keypad(page, ['۱', '۲', '۰۰۰', '۰۰۰']);
  await page.getByTestId('loan-rate').fill('0');
  await page.getByTestId('loan-count').fill('12');
  await expect(page.getByTestId('loan-preview')).toHaveText('۱٬۰۰۰٬۰۰۰ تومان');
  await page.getByTestId('loan-save').click();
  await expect(page.getByTestId('loan-remaining')).toHaveText('۱۲٬۰۰۰٬۰۰۰ تومان');
  await page.getByTestId('loan-row').click();
  await expect(page.getByTestId('installment-row')).toHaveCount(12);
  await page.getByTestId('installment-pay').first().click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('loan-remaining')).toHaveText('۱۱٬۰۰۰٬۰۰۰ تومان');
  await page.getByRole('link', { name: 'خانه' }).click();
  await expect(netWorth(page)).toHaveText('۹٬۰۰۰٬۰۰۰ تومان');
});

test('debt: lend, partial settle, person net updates', async ({ page }) => {
  await setup(page);
  await tool(page, 'طلب و بدهی');
  await page.getByRole('button', { name: 'شخص جدید' }).click();
  await page.getByTestId('person-name').fill('علی');
  await page.getByTestId('person-save').click();
  await page.getByTestId('person-row').click();
  await page.getByTestId('debt-amount').click();
  await keypad(page, ['۳', '۰۰۰', '۰۰۰']);
  await page.getByTestId('debt-save').click();
  await expect(page.getByTestId('debt-row')).toHaveCount(1);
  await page.getByTestId('debt-settle').click();
  await page.getByRole('dialog').last().getByRole('button', { name: /مبلغ تسویه/ }).click();
  // The keypad opens pre-filled with the full remaining amount; clear it to enter a partial one.
  await page.getByRole('group', { name: 'مبلغ به حروف' }).last().getByRole('button', { name: 'پاک کردن' }).click();
  await keypad(page, ['۱', '۰۰۰', '۰۰۰']);
  await page.getByTestId('debt-settle-save').click();
  await expect(page.getByText(/باقی‌مانده: ۲٬۰۰۰٬۰۰۰ تومان/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('person-net')).toHaveText('۲٬۰۰۰٬۰۰۰ تومان');
  await page.getByRole('link', { name: 'خانه' }).click();
  // Lent 3 M out of the account, 1 M came back.
  await expect(netWorth(page)).toHaveText('۸٬۰۰۰٬۰۰۰ تومان');
});
