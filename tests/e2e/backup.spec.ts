import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

// Phase 8 gate: .arizo backup on the real build (strict CSP, encrypted IndexedDB, backup worker) at 390x844.
// Demo vault → Recovery Key (generate + verify) → encrypted backup file download → wrong passphrase and a
// tampered file fail → Dry-Run preview with counts → Smart Merge adds nothing twice → Safe Replace from a
// file made by a second, separate vault → the pre-restore safety snapshot brings the demo data back.
// Zero console/CSP errors and zero external requests throughout.
const PIN = '482916';
const PASS = 'کوه دماوند ۱۴۰۵ Arizo!';

async function typePin(page: Page, pin: string) {
  await expect(page.getByTestId('pin-pad').last()).toHaveAttribute('data-busy', 'false', { timeout: 20_000 });
  for (const d of pin) await page.keyboard.press(d);
  await page.getByTestId('pin-submit').click();
}
const reauth = async (page: Page) => {
  if (await page.getByTestId('pin-pad').isVisible().catch(() => false)) await typePin(page, PIN);
};

async function onboard(page: Page, lang: 'fa' | 'en', demo: boolean) {
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
  if (demo) {
    await page.getByTestId('onboarding-demo').click();
    await expect(page.getByTestId('card-stack')).toBeVisible({ timeout: 30_000 });
  } else {
    await page.getByTestId('acc-name').fill(fa ? 'کیف پول' : 'Wallet');
    await page.getByTestId('acc-save').click();
    await expect(page.getByTestId('card-stack')).toBeVisible({ timeout: 30_000 });
  }
}

function guard(page: Page) {
  const problems: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://localhost:4173') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  return { problems, external };
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

async function makeBackup(page: Page, pass: string): Promise<string> {
  await page.getByTestId('backup-pass').fill(pass);
  await page.getByTestId('backup-pass2').fill(pass);
  const download = page.waitForEvent('download');
  await page.getByTestId('backup-create').click();
  await reauth(page);
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^arizo-backup-\d{8}\.arizo$/);
  const path = await d.path();
  expect(readFileSync(path).subarray(0, 4).toString()).toBe('ARZO');
  return path;
}

async function preview(page: Page, path: string, pass: string) {
  await page.getByTestId('restore-file').setInputFiles(path);
  await page.getByTestId('restore-pass').fill(pass);
  await page.getByTestId('restore-inspect').click();
}

test('backup: recovery key, encrypted file, tamper + wrong passphrase, dry run, merge, replace, safety snapshot (fa RTL)', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  const g = guard(page);
  await onboard(page, 'fa', true);

  // The dashboard reminds; the Security Center shows "never" and leads to the Backup screen.
  await expect(page.getByTestId('backup-due')).toBeVisible();
  await page.goto('/#/settings');
  await expect(page.getByTestId('settings-backup')).toContainText('هرگز');
  await page.getByTestId('settings-backup').click();
  await expect(page.getByRole('heading', { level: 1, name: 'پشتیبان‌گیری و بازیابی' })).toBeVisible();
  await expect(page.getByTestId('no-backdoor')).toContainText('هیچ در پشتی وجود ندارد');
  await noOverflow(page);

  // Strength meter: a weak passphrase keeps the button disabled.
  await page.getByTestId('backup-pass').fill('123456');
  await expect(page.getByTestId('strength')).toHaveAttribute('data-score', '0');
  await expect(page.getByTestId('backup-create')).toBeDisabled();

  // Recovery Key: 24 words, then three of them typed back.
  await page.getByTestId('recovery-setup').click();
  await reauth(page);
  const words = (await page.getByTestId('recovery-words').locator('li').allInnerTexts()).map((s) => s.replace(/^\d+\.\s*/, '').trim());
  expect(words).toHaveLength(24);
  await page.getByTestId('recovery-next').click();
  for (let i = 0; i < 3; i++) {
    const f = page.getByTestId(`verify-${i}`);
    await f.fill(words[Number(await f.getAttribute('data-pos'))]!);
  }
  await page.getByTestId('recovery-save').click();
  await expect(page.getByTestId('recovery-status')).toContainText('فعال');

  const demoFile = await makeBackup(page, PASS);
  await expect(page.getByTestId('backup-message')).toBeVisible();
  await expect(page.getByTestId('last-backup')).not.toContainText('هرگز');

  // Wrong passphrase, then a 1-bit flip in the ciphertext: clean errors, nothing written.
  await preview(page, demoFile, 'not the passphrase at all');
  await expect(page.getByTestId('backup-message')).toContainText('نادرست');
  const bytes = readFileSync(demoFile);
  bytes[bytes.length - 50]! ^= 1;
  const tampered = info.outputPath('tampered.arizo');
  writeFileSync(tampered, bytes);
  await preview(page, tampered, PASS);
  await expect(page.getByTestId('backup-message')).toContainText('دستکاری');

  // Dry run with the 24 words: counts shown, nothing changed; Smart Merge into the same data adds nothing.
  await page.getByTestId('restore-file').setInputFiles(demoFile);
  await page.getByRole('radio', { name: 'کلید بازیابی ۲۴ کلمه‌ای' }).click();
  await page.getByTestId('restore-words').fill(words.join(' '));
  await page.getByTestId('restore-inspect').click();
  await expect(page.getByTestId('restore-preview')).toContainText('فقط پیش‌نمایش');
  expect(await page.getByTestId('count-transactions').innerText()).not.toBe('۰');
  await page.getByRole('radio', { name: 'ادغام هوشمند' }).click();
  await page.getByTestId('restore-apply').click();
  await reauth(page);
  await expect(page.getByTestId('backup-message')).toContainText('ادغام شد: ۰ افزوده');
  await expect(page.getByTestId('snapshot-row').first()).toContainText('پیش از بازیابی');
  await noOverflow(page);

  // A second, separate vault in a fresh context makes a tiny backup; Replace swaps it in.
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p2 = await other.newPage();
  await onboard(p2, 'fa', false);
  await p2.goto('/#/backup');
  const otherPass = 'یک عبارت عبور دیگر برای تست';
  const smallFile = await makeBackup(p2, otherPass);
  const smallCopy = info.outputPath('small.arizo');
  writeFileSync(smallCopy, readFileSync(smallFile));
  await other.close();

  await preview(page, smallCopy, otherPass);
  await expect(page.getByTestId('count-accounts')).toHaveText('۱');
  await page.getByRole('radio', { name: 'جایگزینی' }).click();
  await page.getByTestId('restore-apply').click();
  await reauth(page);
  await expect(page.getByTestId('backup-message')).toContainText('بازیابی شد');
  await page.goto('/#/accounts');
  await expect(page.getByTestId('account-row')).toHaveCount(1);

  // The pre-restore safety snapshot brings the demo vault back.
  await page.goto('/#/backup');
  await page.getByTestId('snapshot-row').first().getByRole('button').click();
  await reauth(page);
  await expect(page.getByTestId('backup-message')).toContainText('بازیابی شد');
  await page.goto('/#/accounts');
  await expect.poll(() => page.getByTestId('account-row').count()).toBeGreaterThan(1);

  expect(g.problems).toEqual([]);
  expect(g.external).toEqual([]);
});

test('backup screen in en LTR: layout and the More tile', async ({ page }) => {
  const g = guard(page);
  await onboard(page, 'en', false);
  await page.getByRole('link', { name: 'Tools' }).click();
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Backup & restore' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByTestId('no-backdoor')).toContainText('No backdoor');
  await page.getByTestId('backup-pass').fill('correct horse battery staple');
  await expect(page.getByTestId('strength')).toContainText(/strong/i);
  await noOverflow(page);
  expect(g.problems).toEqual([]);
  expect(g.external).toEqual([]);
});
