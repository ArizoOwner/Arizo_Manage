import { expect, test, type Page } from '@playwright/test';

// Phase 3 gate: the core user journey on the real build (strict CSP, encrypted IndexedDB, Argon2 in a
// worker; Argon2 cost is lowered only in this E2E build). Each test starts from an empty profile.
const PIN = '482916';

// blob:/data: URLs are in-page and never reach the network.
const LOCAL = /^(http:\/\/localhost:4173|blob:http:\/\/localhost:4173\/|data:)/;

async function typePin(page: Page, pin: string) {
  // The pad is disabled while Argon2 checks the previous attempt; keys pressed then are dropped.
  await expect(page.getByTestId('pin-pad').last()).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });
  for (const d of pin) await page.keyboard.press(d);
  await page.getByTestId('pin-submit').click();
}

async function onboard(page: Page, opts: { demo?: boolean; lang?: 'fa' | 'en' } = {}) {
  const lang = opts.lang ?? 'fa';
  await page.addInitScript((l) => {
    if (!localStorage.getItem('arizo.settings.v1')) localStorage.setItem('arizo.settings.v1', JSON.stringify({ lang: l, theme: 'obsidian', calendar: l === 'fa' ? 'jalali' : 'gregorian', irrUnit: 'toman' }));
  }, lang);
  await page.goto('/');
  const fa = lang === 'fa';
  await page.getByRole('button', { name: fa ? 'شروع' : 'Get started' }).click();
  await page.getByRole('button', { name: fa ? 'ادامه' : 'Continue' }).click();
  await typePin(page, PIN);
  await typePin(page, PIN);
  await page.getByRole('button', { name: fa ? 'متوجه شدم' : 'I understand' }).click({ timeout: 20_000 });
  await page.getByRole('button', { name: fa ? 'بعداً' : 'Not now' }).click();
  await page.getByRole('button', { name: fa ? 'ادامه' : 'Continue' }).click();
  if (opts.demo) await page.getByTestId('onboarding-demo').click();
}

function guard(page: Page) {
  const problems: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('request', (r) => {
    if (!LOCAL.test(r.url())) external.push(r.url());
  });
  return { problems, external };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

const netWorth = (page: Page) => page.getByTestId('net-worth').locator('.sr-only');

test('onboarding → first account with Luhn check and BIN detection → dashboard', async ({ page }) => {
  const g = guard(page);
  await onboard(page);
  await page.getByTestId('acc-name').fill('کارت ملی');
  await page.getByTestId('acc-card').fill('6037991234567890');
  await expect(page.getByText('شمارهٔ کارت معتبر نیست')).toHaveCount(0); // errors appear only after submit
  await page.getByTestId('acc-save').click();
  await expect(page.getByText('شمارهٔ کارت معتبر نیست')).toBeVisible(); // Luhn fails
  await page.getByTestId('acc-card').fill('6037991234567893');
  await expect(page.getByText('بانک تشخیص داده شد: بانک ملی ایران')).toBeVisible();
  await page.getByTestId('acc-balance').fill('2500000');
  await page.getByTestId('acc-save').click();
  await expect(netWorth(page)).toHaveText('۲٬۵۰۰٬۰۰۰ تومان');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await noOverflow(page);
  expect(g.problems).toEqual([]);
  expect(g.external).toEqual([]);
});

test('lightning entry with keypad, split guard, ledger search, delete + undo, trash restore', async ({ page }) => {
  await onboard(page);
  await page.getByTestId('acc-name').fill('نقدی');
  await page.getByTestId('acc-balance').fill('1000000');
  await page.getByTestId('acc-save').click();
  await expect(netWorth(page)).toHaveText('۱٬۰۰۰٬۰۰۰ تومان');

  await page.getByRole('button', { name: 'ثبت سریع' }).click();
  const pad = page.getByRole('group', { name: 'مبلغ به حروف' });
  for (const k of ['۱', '۲', '۰۰۰', '۰']) await pad.getByRole('button', { name: k, exact: true }).click();
  await expect(page.getByTestId('keypad-words')).toHaveText('یکصد و بیست هزار تومان');
  await pad.getByRole('button', { name: 'تأیید' }).click();
  await page.getByTestId('entry-merchant').fill('اسنپ‌فود');
  await page.getByRole('switch', { name: 'تقسیم بین دسته‌ها' }).click();
  await expect(page.getByText(/باقی‌مانده:/)).toBeVisible();
  await expect(page.getByTestId('entry-save')).toBeDisabled(); // parts do not add up yet
  await page.getByRole('switch', { name: 'تقسیم بین دسته‌ها' }).click();
  await page.getByTestId('entry-save').click();

  await expect(netWorth(page)).toHaveText('۸۸۰٬۰۰۰ تومان');
  await expect(page.getByTestId('month-expense')).toHaveText('۱۲۰٬۰۰۰ تومان');

  await page.getByRole('link', { name: 'دفتر' }).click();
  await page.getByTestId('ledger-search').fill('اسنپ');
  await expect(page.getByTestId('tx-row')).toHaveCount(1);
  await page.getByTestId('ledger-search').fill('وجود ندارد');
  await expect(page.getByText('تراکنشی پیدا نشد')).toBeVisible();
  await page.getByTestId('ledger-search').fill('');
  await page.getByRole('button', { name: 'حذف', exact: true }).first().click();
  await expect(page.getByTestId('undo-toast')).toBeVisible();
  await page.getByRole('button', { name: 'برگرداندن' }).click();
  await expect(page.getByTestId('tx-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'حذف', exact: true }).first().click();
  await expect(page.getByText('تراکنشی پیدا نشد')).toBeVisible();
  await page.getByRole('button', { name: 'سطل بازیافت' }).click();
  await expect(page.getByTestId('trash-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'بازگردانی' }).click();
  await expect(page.getByTestId('trash-row')).toHaveCount(0);
  await page.getByRole('link', { name: 'خانه' }).click();
  await expect(netWorth(page)).toHaveText('۸۸۰٬۰۰۰ تومان');
  await noOverflow(page);
});

test('lock → wrong PIN → right PIN; 5 failures trigger the 30 s lockout', async ({ page }) => {
  await onboard(page, { demo: true });
  await expect(page.getByTestId('card-stack')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'قفل', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'گاوصندوق قفل است' })).toBeVisible();
  await typePin(page, '111222');
  await expect(page.getByRole('alert')).toHaveText('رمز نادرست است');
  await typePin(page, PIN);
  await expect(page.getByTestId('card-stack')).toBeVisible();
  await expect(page.getByTestId('tx-row').first()).toBeVisible(); // data decrypted again after unlock

  await page.getByRole('button', { name: 'قفل', exact: true }).click();
  for (let i = 0; i < 5; i++) await typePin(page, '000111');
  await expect(page.getByTestId('lockout')).toBeVisible();
  await expect(page.getByTestId('pin-submit')).toBeDisabled();
});

test('settings: integrity check, Toman ⇄ Rial, theme and language persist across reload', async ({ page }) => {
  await onboard(page, { demo: true });
  await expect(page.getByTestId('card-stack')).toBeVisible({ timeout: 30_000 });
  const before = await netWorth(page).textContent();
  await page.getByTestId('unit-switch').click();
  await expect(netWorth(page)).toContainText('ریال');
  expect(await netWorth(page).textContent()).not.toBe(before);
  await page.getByRole('button', { name: 'تنظیمات' }).click();
  await page.getByTestId('integrity').click();
  await expect(page.getByTestId('settings-message')).toContainText('دفتر سالم است');
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('radio', { name: 'Alabaster (light)' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'alabaster');
  await noOverflow(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Vault locked' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'alabaster');
  await typePin(page, PIN);
  // The hash route survives the reload, so the app reopens on Settings.
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(netWorth(page)).toContainText('IRR');
});

test('duress PIN opens the decoy vault, not the real one', async ({ page }) => {
  await onboard(page, { demo: true });
  await expect(page.getByTestId('card-stack')).toBeVisible({ timeout: 30_000 });
  const real = await netWorth(page).textContent();
  await page.getByRole('button', { name: 'تنظیمات' }).click();
  await page.getByTestId('decoy-set').click(); // re-auth is still fresh from the unlock
  await typePin(page, '736051');
  await expect(page.getByTestId('settings-message')).toHaveText('رمز اضطراری تنظیم شد', { timeout: 30_000 });
  await page.getByRole('link', { name: 'خانه' }).click();
  await page.getByRole('button', { name: 'قفل', exact: true }).click();
  await typePin(page, '736051');
  await expect(page.getByTestId('card-stack')).toBeVisible({ timeout: 30_000 });
  expect(await netWorth(page).textContent()).not.toBe(real);
  await page.getByRole('button', { name: 'تنظیمات' }).click();
  await expect(page.getByTestId('decoy-set')).toHaveCount(0); // the decoy hides security controls
});

test('English LTR journey has no overflow and no external requests', async ({ page }) => {
  const g = guard(page);
  await onboard(page, { lang: 'en', demo: true });
  await expect(page.getByTestId('card-stack')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await noOverflow(page);
  for (const tab of ['Ledger', 'Analytics', 'Tools', 'Home']) {
    await page.getByRole('link', { name: tab }).click();
    await noOverflow(page);
  }
  expect(g.problems).toEqual([]);
  expect(g.external).toEqual([]);
});
