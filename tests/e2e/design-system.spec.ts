import { expect, test, type Page } from '@playwright/test';

// Phase 2 gate: the Design Gallery renders at 390x844 in Persian RTL and English LTR, in both
// themes, with zero horizontal overflow, zero console/CSP errors and zero external requests.
// blob:/data: URLs are in-page and never reach the network.
const LOCAL = /^(http:\/\/localhost:4173|blob:http:\/\/localhost:4173\/|data:)/;

async function open(page: Page, lang: 'fa' | 'en', theme: 'obsidian' | 'alabaster') {
  await page.addInitScript(
    ([l, t]) => localStorage.setItem('arizo.settings.v1', JSON.stringify({ lang: l, theme: t, calendar: l === 'fa' ? 'jalali' : 'gregorian', irrUnit: 'toman' })),
    [lang, theme],
  );
  const problems: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  const external: string[] = [];
  page.on('request', (r) => { if (!LOCAL.test(r.url())) external.push(r.url()); });
  await page.goto('/#/gallery');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return { problems, external };
}

async function noHorizontalOverflow(page: Page) {
  const offenders = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw) out.push(`document ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of document.querySelectorAll<HTMLElement>('main *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      // sheen strips are intentionally oversized inside overflow-hidden cards
      if (el.closest('[aria-hidden="true"]')) continue;
      if (r.left < -1 || r.right > vw + 1) out.push(`${el.tagName}.${el.className.toString().slice(0, 40)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return out.slice(0, 5);
  });
  expect(offenders).toEqual([]);
}

for (const lang of ['fa', 'en'] as const) {
  for (const theme of ['obsidian', 'alabaster'] as const) {
    test(`gallery ${lang} / ${theme}: direction, fonts, no overflow, no errors`, async ({ page }) => {
      const { problems, external } = await open(page, lang, theme);
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const font = lang === 'fa' ? 'Vazirmatn' : 'Plus Jakarta Sans';
      expect(await page.evaluate(async (f) => { await document.fonts.ready; return document.fonts.check(`16px "${f}"`); }, font)).toBe(true);
      await noHorizontalOverflow(page);
      await page.evaluate(() => window.scrollBy(0, 4000)); // mobile WebKit has no wheel
      await noHorizontalOverflow(page);
      expect(problems).toEqual([]);
      expect(external).toEqual([]);
    });
  }
}

test('keypad: 000 key, operators, live Persian words, exact Rial result', async ({ page }) => {
  await open(page, 'fa', 'obsidian');
  const pad = page.getByRole('group', { name: 'مبلغ به حروف' });
  for (const k of ['۱', '۲', '۵', '۰۰۰']) await pad.getByRole('button', { name: k, exact: true }).click();
  await expect(page.getByTestId('keypad-words')).toHaveText('یکصد و بیست و پنج هزار تومان');
  await pad.getByRole('button', { name: '×', exact: true }).click();
  await pad.getByRole('button', { name: '۲', exact: true }).click();
  await expect(page.getByTestId('keypad-value')).toHaveText('۲۵۰٬۰۰۰ تومان');
  await expect(page.getByTestId('keypad-words')).toHaveText('دویست و پنجاه هزار تومان');
  await pad.getByRole('button', { name: 'تأیید' }).click();
  await expect(page.getByTestId('keypad-done')).toHaveText('۲٬۵۰۰٬۰۰۰ ریال');
});

test('privacy blur hides amounts from sight and from screen readers', async ({ page }) => {
  await open(page, 'fa', 'obsidian');
  await page.getByTestId('privacy-toggle').click();
  const blurred = page.locator('[data-private="hidden"]');
  expect(await blurred.count()).toBeGreaterThan(5);
  await expect(blurred.first()).toHaveAttribute('aria-hidden', 'true');
  expect(await blurred.first().evaluate((el) => getComputedStyle(el).filter)).toContain('blur');
});

test('odometer re-renders the new value and Toman ↔ Rial toggle', async ({ page }) => {
  await open(page, 'en', 'obsidian');
  const first = page.locator('main section').first();
  await expect(first.locator('.sr-only').first()).toHaveText('1,245,000,000 Toman');
  await page.getByTestId('bump').click();
  await expect(first.locator('.sr-only').first()).toHaveText('1,248,785,000 Toman');
  await page.getByTestId('unit-toggle').click();
  await expect(first.locator('.sr-only').first()).toHaveText('12,487,850,000 IRR');
});

test('date picker switches calendars and picks a day', async ({ page }) => {
  await open(page, 'fa', 'obsidian');
  const picker = page.getByLabel('انتخاب تاریخ');
  await picker.getByRole('radio', { name: 'میلادی' }).click();
  await expect(picker.getByRole('columnheader').first()).toHaveText('Mo');
  await picker.getByRole('radio', { name: 'شمسی' }).click();
  await expect(picker.getByRole('columnheader').first()).toHaveText('ش');
  await picker.getByRole('gridcell', { name: '۱۵', exact: true }).click();
  await expect(page.getByTestId('picked-date')).toContainText('۱۵ ');
});

test('language toggle flips direction at runtime', async ({ page }) => {
  await open(page, 'fa', 'obsidian');
  await page.getByTestId('lang-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Design Gallery');
  await noHorizontalOverflow(page);
});
