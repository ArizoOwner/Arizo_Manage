// Manual visual review helper, not part of the gate: `npx playwright test tests/e2e/screens.shoot.ts`.
// Writes screenshots of the main Phase 3 screens to test-results/shots/.
import { test } from '@playwright/test';

test.skip(!process.env.SHOOT, 'set SHOOT=1 to capture screenshots');

test('capture main screens', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('arizo.settings.v1', JSON.stringify({ lang: 'fa', theme: 'obsidian', calendar: 'jalali', irrUnit: 'toman' })));
  await page.goto('/');
  const shot = (n: string) => page.screenshot({ path: `test-results/shots/${n}.png` });
  await page.getByRole('button', { name: 'شروع' }).click();
  await page.getByRole('button', { name: 'ادامه' }).click();
  await shot('1-pin');
  for (const p of ['482916', '482916']) {
    await page.waitForSelector('[data-testid="pin-pad"][data-busy="false"]');
    for (const d of p) await page.keyboard.press(d);
    await page.getByTestId('pin-submit').click();
  }
  await page.getByRole('button', { name: 'متوجه شدم' }).click({ timeout: 20_000 });
  await page.getByRole('button', { name: 'بعداً' }).click();
  await page.getByRole('button', { name: 'ادامه' }).click();
  await shot('2-first-account');
  await page.getByTestId('onboarding-demo').click();
  await page.getByTestId('card-stack').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot('3-dashboard');
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(300);
  await shot('4-dashboard-lower');
  await page.getByRole('link', { name: 'دفتر' }).click();
  await page.waitForTimeout(400);
  await shot('5-ledger');
  await page.getByRole('button', { name: 'ثبت سریع' }).click();
  await page.waitForTimeout(500);
  await shot('6-entry');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'ابزارها' }).click();
  await page.getByRole('button', { name: 'تنظیمات و امنیت' }).click();
  await shot('7-settings');
  await page.getByRole('link', { name: 'تحلیل' }).click();
  await page.getByTestId('analytics-summary').waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/shots/9-analytics.png', fullPage: true });
  await page.getByRole('link', { name: 'خانه' }).click();
  await page.getByRole('button', { name: 'قفل', exact: true }).click();
  await shot('8-lock');
});
