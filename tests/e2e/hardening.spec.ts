import { expect, test, type Page } from '@playwright/test';

// Phase 9 audit checks that need a real browser:
// 1. Auto-lock reaches into every open modal: with "Immediate" auto-lock, the app being hidden while
//    the entry sheet, a re-auth sheet or a receipt sheet is open drops the whole tree to the lock screen
//    and leaves no dialog (and no decrypted text) behind.
// 2. Airplane mode: after the service worker has installed, the PWA loads and unlocks with the network off.
const PIN = '482916';

async function typePin(page: Page, pin: string) {
  await expect(page.getByTestId('pin-pad').last()).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });
  for (const d of pin) await page.keyboard.press(d);
  await page.getByTestId('pin-submit').click();
}

async function onboard(page: Page) {
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

const lockScreen = (page: Page) => page.getByRole('heading', { name: 'گاوصندوق قفل است' });

/** The same signal Android's onPause sends; on the web, visibilitychange takes the same path. */
const hide = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('arizoNativePause')));

test('auto-lock from inside every kind of modal leaves no dialog or vault text behind', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('arizo.autolock.v1', '0')); // "Immediate"
  await onboard(page);

  const cases: [string, () => Promise<void>][] = [
    ['entry sheet', async () => {
      await page.getByRole('button', { name: 'ثبت سریع' }).click();
    }],
    ['receipt sheet', async () => {
      await page.evaluate(() => (location.hash = '#/ledger'));
      await page.getByRole('button', { name: 'رسید' }).first().click();
    }],
    ['re-auth sheet', async () => {
      // The 60 s re-auth window from the unlock must lapse first: move the page clock past it.
      await page.evaluate(() => {
        const real = Date.now.bind(Date);
        Date.now = () => real() + 120_000;
      });
      await page.evaluate(() => (location.hash = '#/export'));
      await page.getByTestId('export-xlsx').click();
    }],
  ];

  for (const [name, open] of cases) {
    await open();
    await expect(page.getByRole('dialog'), name).toBeVisible();
    await hide(page);
    await page.evaluate(() => window.dispatchEvent(new Event('arizoNativeResume'))); // back to the app
    await expect(lockScreen(page), name).toBeVisible();
    // Regression (Phase 9): the privacy curtain used to stay over the lock screen after an auto-lock.
    expect(await page.evaluate(() => document.querySelector('div.fixed.inset-0.z-\\[100\\]') === null), name).toBe(true);
    await expect(page.getByRole('dialog'), name).toHaveCount(0);
    await expect(page.getByTestId('tx-row'), name).toHaveCount(0);
    expect(await page.evaluate(() => document.body.innerText.includes('اسنپ')), name).toBe(false); // no merchant text left in the DOM
    await typePin(page, PIN);
    await expect(lockScreen(page), name).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('dialog'), name).toHaveCount(0); // nothing reopens by itself after unlock
    await page.evaluate(() => (location.hash = '#/'));
  }
});

test('airplane mode: the installed PWA loads and unlocks with the network off', async ({ page, context }) => {
  test.setTimeout(120_000);
  await onboard(page);
  // registerType 'prompt' never calls clients.claim(): wait until the worker is active (precache done),
  // then reload once so the page is served and controlled by it, still online.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect(lockScreen(page)).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  await page.reload();
  await expect(lockScreen(page)).toBeVisible({ timeout: 20_000 });
  await typePin(page, PIN);
  await expect(page.getByTestId('card-stack')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('tx-row').first()).toBeVisible();
  await page.evaluate(() => (location.hash = '#/analytics'));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(failed).toEqual([]);
  await context.setOffline(false);
});
