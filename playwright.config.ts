import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build so the strict CSP is exercised.
export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:4173', viewport: { width: 390, height: 844 } },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
  webServer: { command: 'npx tsc -b && npx vite build --mode e2e --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: false, timeout: 180_000 },
});
