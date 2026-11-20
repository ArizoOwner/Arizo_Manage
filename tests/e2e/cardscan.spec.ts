import { expect, test } from '@playwright/test';

// Card scanner engine in the real build (strict CSP, no network): a synthetic card face is drawn on a
// canvas and goes through the same frame preparation, OCR worker and parser as a camera frame.
// The camera itself cannot be driven headless.
const LOCAL = /^(http:\/\/localhost:4173|blob:http:\/\/localhost:4173\/|data:)/;

test('on-device OCR reads a synthetic card: number, expiry, CVV2; zero network', async ({ page }) => {
  test.setTimeout(120_000);
  const external: string[] = [];
  page.on('request', (r) => {
    if (!LOCAL.test(r.url())) external.push(r.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => 'ocrCard' in ((window as unknown as { __arizoE2E?: object }).__arizoE2E ?? {}));
  const r = await page.evaluate(() =>
    (window as unknown as { __arizoE2E: { ocrCard(l: string[]): Promise<{ text: string; ms: number; number: string | null; expiry: string | null; cvv2: string | null }> } }).__arizoE2E.ocrCard([
      '6219 8612 3456 7898',
      'CVV2 731     1406/11',
    ]),
  );
  console.log(`[ocr] ${Math.round(r.ms)} ms, text=${JSON.stringify(r.text)}`);
  expect(r.number).toBe('6219861234567898');
  expect(r.expiry).toBe('11/06');
  expect(r.cvv2).toBe('731');
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('scan sheet: camera denied shows the fallback; manual expiry and CVV2 are validated and kept masked', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem('arizo.settings.v1', JSON.stringify({ lang: 'fa', theme: 'obsidian', calendar: 'jalali', irrUnit: 'toman' }));
    // No camera in headless Chromium: getUserMedia rejects as on a phone where the user said no.
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'شروع' }).click();
  await page.getByRole('button', { name: 'ادامه' }).click();
  for (let i = 0; i < 2; i++) {
    await expect(page.getByTestId('pin-pad').last()).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });
    for (const d of '482916') await page.keyboard.press(d);
    await page.getByTestId('pin-submit').click();
  }
  await page.getByRole('button', { name: 'متوجه شدم' }).click({ timeout: 20_000 });
  await page.getByRole('button', { name: 'بعداً' }).click();
  await page.getByRole('button', { name: 'ادامه' }).click();

  await page.getByTestId('scan-card').click();
  await expect(page.getByTestId('card-scanner')).toBeVisible();
  await expect(page.getByText('اجازهٔ دوربین داده نشد')).toBeVisible();
  await expect(page.getByTestId('scan-use')).toBeDisabled();
  await page.getByRole('button', { name: 'بستن اسکنر' }).click();
  await expect(page.getByTestId('card-scanner')).toHaveCount(0);

  await page.getByTestId('acc-name').fill('کارت سامان');
  await page.getByTestId('acc-card').fill('6219861234567898');
  await page.getByTestId('acc-expiry').fill('13/06');
  await page.getByTestId('acc-cvv2').fill('731');
  await expect(page.getByTestId('acc-cvv2')).toHaveAttribute('type', 'password');
  await page.getByTestId('acc-save').click();
  await expect(page.getByText('تاریخ انقضا را به شکل ماه/سال وارد کنید')).toBeVisible();
  await page.getByTestId('acc-expiry').fill('11/06');
  await page.getByTestId('acc-save').click();
  await expect(page.getByTestId('card-stack')).toBeVisible({ timeout: 20_000 });

  await page.evaluate(() => (location.hash = '#/accounts'));
  await page.getByText('کارت سامان').first().click();
  await expect(page.getByTestId('card-expiry')).toHaveText('••/••');
  await expect(page.getByTestId('card-cvv2')).toHaveText('•••');
  await page.getByTestId('reveal-card').click();
  // Inside the 60 s re-auth window (just unlocked) the reveal needs no PIN; otherwise the pad opens.
  if (await page.getByTestId('pin-pad').isVisible().catch(() => false)) {
    for (const d of '482916') await page.keyboard.press(d);
    await page.getByTestId('pin-submit').last().click();
  }
  await expect(page.getByTestId('card-expiry')).toHaveText('۱۱/۰۶');
  await expect(page.getByTestId('card-cvv2')).toHaveText('۷۳۱');
});
