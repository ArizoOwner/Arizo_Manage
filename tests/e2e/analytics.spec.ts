import { expect, test, type Page } from '@playwright/test';

// Phase 6 gate: Analytics renders cleanly at 390x844 in fa (RTL) and en (LTR) on 90 days of demo data,
// under the strict CSP, with zero external requests; scrubbing shows the tooltip; budgets, goals and
// categories CRUD work end to end; the dashboard shows the budget snapshot.
const PIN = '482916';

// blob:/data: URLs are in-page and never reach the network.
const LOCAL = /^(http:\/\/localhost:4173|blob:http:\/\/localhost:4173\/|data:)/;

async function typePin(page: Page, pin: string) {
  await expect(page.getByTestId('pin-pad').last()).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });
  for (const d of pin) await page.keyboard.press(d);
  await page.getByTestId('pin-submit').click();
}

async function onboardDemo(page: Page, lang: 'fa' | 'en') {
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
    if (!LOCAL.test(r.url())) external.push(r.url());
  });
  return { problems, external };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

for (const lang of ['fa', 'en'] as const) {
  test(`analytics renders cleanly in ${lang === 'fa' ? 'fa RTL' : 'en LTR'}`, async ({ page }) => {
    const g = guard(page);
    await onboardDemo(page, lang);
    await page.getByRole('link', { name: lang === 'fa' ? 'تحلیل' : 'Analytics' }).click();
    await expect(page.getByTestId('analytics-summary')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
    for (const id of ['health', 'networth-chart', 'cashflow-chart', 'donut', 'sankey', 'heatmap', 'subscriptions']) await expect(page.getByTestId(id)).toBeVisible();
    // Every chart carries a text alternative.
    for (const id of ['cashflow-chart', 'donut', 'sankey']) expect((await page.getByTestId(id).getAttribute('aria-label'))?.length ?? 0).toBeGreaterThan(10);
    await expect(page.getByTestId('networth-chart').locator('svg')).toHaveAttribute('aria-label', /.{10,}/);
    await noOverflow(page);

    // Scrub the net worth spline: crosshair tooltip appears.
    await page.getByTestId('networth-chart').locator('svg').scrollIntoViewIfNeeded();
    const box = (await page.getByTestId('networth-chart').locator('svg').boundingBox())!;
    // A tap is what a phone does (pointerdown); on desktop Chromium it is the same handler.
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height / 2);
    await expect(page.getByTestId('chart-tooltip')).toBeVisible();

    // Drill down into the largest category.
    await page.getByTestId('category-list').getByRole('button').first().click();
    await expect(page.getByTestId('drilldown')).toBeVisible();

    // Previous period, then the Gregorian switch: still clean.
    await page.getByRole('button', { name: lang === 'fa' ? 'ماه قبل' : 'Previous month' }).click();
    await page.getByRole('radio', { name: lang === 'fa' ? 'میلادی' : 'Gregorian' }).click();
    await expect(page.getByTestId('analytics-summary')).toBeVisible();
    await noOverflow(page);

    // Privacy blur reaches the charts.
    await page.getByRole('link', { name: lang === 'fa' ? 'خانه' : 'Home' }).click();
    await page.getByRole('button', { name: lang === 'fa' ? 'پنهان کردن مبالغ' : 'Hide amounts' }).click();
    await page.getByRole('link', { name: lang === 'fa' ? 'تحلیل' : 'Analytics' }).click();
    await expect(page.getByTestId('cashflow-chart')).toHaveClass(/blur/);
    await expect(page.getByTestId('sum-expense').locator('xpath=..')).toHaveAttribute('data-private', 'hidden');
    expect(g.problems).toEqual([]);
    expect(g.external).toEqual([]);
  });
}

test('budget, goal and category CRUD; dashboard budget snapshot', async ({ page }) => {
  const g = guard(page);
  await onboardDemo(page, 'fa');
  const tool = async (name: string) => {
    await page.getByRole('link', { name: 'ابزارها' }).click();
    await page.getByRole('button', { name, exact: true }).click();
  };
  const keypad = async (digits: string[]) => {
    const pad = page.getByRole('group', { name: 'مبلغ به حروف' }).last();
    for (const k of digits) await pad.getByRole('button', { name: k, exact: true }).click();
    await pad.getByRole('button', { name: 'تأیید' }).click();
  };

  // Category: a sub-category under Food.
  await tool('دسته‌ها');
  await page.getByRole('button', { name: 'دستهٔ تازه' }).click();
  await page.getByTestId('category-name-fa').fill('کافه');
  await page.getByTestId('category-parent').selectOption({ label: 'خوراک و رستوران' });
  await page.getByTestId('category-save').click();
  await expect(page.getByTestId('category-row').filter({ hasText: 'کافه' })).toBeVisible();

  // Budget for Food: 5,000,000 Toman a month.
  await tool('بودجه‌ها');
  await page.getByRole('button', { name: 'بودجهٔ تازه' }).click();
  await page.getByTestId('budget-category').selectOption({ label: 'خوراک و رستوران' });
  await page.getByTestId('budget-limit').click();
  await keypad(['۵', '۰۰۰', '۰۰۰']);
  await page.getByTestId('budget-save').click();
  await expect(page.getByTestId('budget-row')).toHaveCount(1);
  await expect(page.getByTestId('budget-row')).toContainText('۵٬۰۰۰٬۰۰۰ تومان');
  // The same budget twice is refused.
  await page.getByRole('button', { name: 'بودجهٔ تازه' }).click();
  await page.getByTestId('budget-category').selectOption({ label: 'خوراک و رستوران' });
  await page.getByTestId('budget-limit').click();
  await keypad(['۱']);
  await page.getByTestId('budget-save').click();
  await expect(page.getByRole('alert')).toHaveText('برای این دسته و دوره، بودجهٔ فعال دیگری هست');
  await page.keyboard.press('Escape');

  // Goal: 20,000,000 target, add 5,000,000 → 25%.
  await tool('اهداف پس‌انداز');
  await page.getByRole('button', { name: 'هدف تازه' }).click();
  await page.getByTestId('goal-name').fill('سفر');
  await page.getByTestId('goal-target').click();
  await keypad(['۲', '۰', '۰۰۰', '۰۰۰']);
  await page.getByTestId('goal-save').click();
  await page.getByTestId('goal-contribute').click();
  await page.getByTestId('goal-amount').click();
  await keypad(['۵', '۰۰۰', '۰۰۰']);
  await page.getByTestId('goal-amount-save').click();
  await expect(page.getByTestId('goal-progress')).toHaveText('۵٬۰۰۰٬۰۰۰ تومان از ۲۰٬۰۰۰٬۰۰۰ تومان');

  // Dashboard snapshot shows the budget.
  await page.getByRole('link', { name: 'خانه' }).click();
  await expect(page.getByTestId('dash-budgets').getByTestId('budget-row')).toHaveCount(1);
  await noOverflow(page);
  expect(g.problems).toEqual([]);
  expect(g.external).toEqual([]);
});
