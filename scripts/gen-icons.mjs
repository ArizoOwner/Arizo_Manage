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
// Android legacy launcher icons (pre-Android 8; 8+ uses the adaptive vector in
// android/app/src/main/res/drawable/ic_launcher_foreground.xml). Square for ic_launcher, circle for _round.
const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, size] of Object.entries(densities)) {
  for (const round of [false, true]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;overflow:hidden;border-radius:${round ? '50%' : `${size * 0.18}px`}">` +
        `${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`,
    );
    await page.screenshot({ path: `android/app/src/main/res/mipmap-${d}/ic_launcher${round ? '_round' : ''}.png`, omitBackground: true });
  }
}
await browser.close();
console.log('icons written:', targets.map((t) => t[0]).join(', '));
