// Rasterises public/icons/icon.svg into the PNG sizes the manifest, iOS and Android need.
// Run: node scripts/gen-icons.mjs  (uses the Playwright Chromium already installed for E2E)
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const svg = await readFile('public/icons/icon.svg', 'utf8');
const targets = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['apple-touch-icon-180.png', 180, 1],
  ['maskable-512.png', 512, 0.72], // glyph inside the 80% maskable safe zone
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, scale] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:#06080D;display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<div style="width:${size * scale}px;height:${size * scale}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`,
  );
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: false });
}
await browser.close();
console.log('icons written:', targets.map((t) => t[0]).join(', '));
