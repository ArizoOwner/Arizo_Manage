import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// The same E2E suite on Safari's engine with an iPhone profile (WebKit, touch, iOS user agent).
// WebKit's crypto and IndexedDB are slower than Chromium's here, so waits are longer.
// Run: npx playwright test -c playwright.ios.config.ts
export default defineConfig({
  ...base,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  projects: [{ name: 'iphone-webkit', use: { ...devices['iPhone 15'] } }],
});
