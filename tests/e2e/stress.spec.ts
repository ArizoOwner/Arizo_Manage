import { expect, test, type Page } from '@playwright/test';
import { ALL } from '../sms-fixtures/vectors';

// Phase 9 stress gate (PROMPT.md §8): 20,000 transactions through the real ledger in the real build
// (minified, strict CSP, encrypted IndexedDB). Thresholds are deliberately CI-realistic:
// - scrolling: p95 frame interval ≤ 34 ms (two 60 Hz frames) and ≤ 5 % frames over 50 ms while the
//   virtualized ledger is scrolled 40 px per frame for ~4 s. Headless Chromium on a laptop is the floor
//   we can measure; a phone GPU is not this machine.
// - workers: median analytics aggregation of all 20,000 rows and SMS parsing of a 1,000-message batch
//   each < 150 ms, measured post → result (worker already started, as in the app after first use).
const PIN = '482916';
const TOTAL = 20_000;

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
  await expect(page.getByTestId('net-worth')).toBeVisible({ timeout: 30_000 });
}

type Hooks = {
  stress(n: number): Promise<{ count: number; checked: number; clean: boolean }>;
  analyticsMs(): Promise<{ rows: number; median: number; max: number }>;
  smsMs(texts: string[]): Promise<{ messages: number; median: number; max: number }>;
};

test('20,000 transactions: smooth virtualized scroll, workers under 150 ms, ledger stays consistent', async ({ page }) => {
  test.setTimeout(600_000);
  await onboard(page);
  const seeded = await page.evaluate((n) => (window as unknown as { __arizoE2E: Hooks }).__arizoE2E.stress(n), TOTAL);
  expect(seeded.count).toBeGreaterThanOrEqual(TOTAL);
  expect(seeded.clean).toBe(true);

  const analytics = await page.evaluate(() => (window as unknown as { __arizoE2E: Hooks }).__arizoE2E.analyticsMs());
  const texts = Array.from({ length: 1000 }, (_, i) => ALL[i % ALL.length]!.text);
  const sms = await page.evaluate((t) => (window as unknown as { __arizoE2E: Hooks }).__arizoE2E.smsMs(t), texts);

  await page.evaluate(() => (location.hash = '#/ledger'));
  const list = page.getByTestId('ledger-list');
  await expect(list).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  const frames = await list.evaluate(
    (el) =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        let last = performance.now();
        const start = last;
        const step = (t: number) => {
          out.push(t - last);
          last = t;
          el.scrollTop += 40;
          if (t - start < 4_000) requestAnimationFrame(step);
          else resolve(out.slice(1));
        };
        requestAnimationFrame(step);
      }),
  );
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  const long = frames.filter((f) => f > 50).length / frames.length;
  const scrolled = await list.evaluate((el) => el.scrollTop);
  console.log(`[stress] rows=${seeded.checked} analytics median=${analytics.median.toFixed(1)}ms max=${analytics.max.toFixed(1)}ms sms(${sms.messages}) median=${sms.median.toFixed(1)}ms max=${sms.max.toFixed(1)}ms frames=${frames.length} p95=${p95.toFixed(1)}ms long=${(long * 100).toFixed(1)}% scrolled=${scrolled}px`);

  expect(scrolled).toBeGreaterThan(5_000); // the list really moved through thousands of rows
  expect(p95).toBeLessThanOrEqual(34);
  expect(long).toBeLessThanOrEqual(0.05);
  expect(analytics.rows).toBeGreaterThanOrEqual(TOTAL);
  expect(analytics.median).toBeLessThan(150);
  expect(sms.median).toBeLessThan(150);
});
