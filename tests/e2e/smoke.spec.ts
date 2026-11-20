import { expect, test } from '@playwright/test';

// Phase 0 smoke: the production build boots under the strict CSP, RTL, self-hosted fonts, no overflow.
// blob:/data: URLs are in-page and never reach the network.
const LOCAL = /^(http:\/\/localhost:4173|blob:http:\/\/localhost:4173\/|data:)/;

test('boots under strict CSP in Persian RTL', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  const external: string[] = [];
  page.on('request', (r) => { if (!LOCAL.test(r.url())) external.push(r.url()); });

  await page.goto('/');
  // A fresh profile boots into onboarding.
  await expect(page.getByRole('heading', { name: 'به آریزو خوش آمدید' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px Vazirmatn', 'آریزو'); })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(problems).toEqual([]);
  expect(external).toEqual([]);
});
