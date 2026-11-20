/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// The React Refresh preamble is an inline script, which the strict CSP blocks.
// The CSP stays in index.html for every build; only the dev server drops it.
const stripCspInDev = (): Plugin => ({
  name: 'arizo:strip-csp-in-dev',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, ''),
});

export default defineConfig(({ mode }) => ({
  // Relative base: works from Capacitor's https://localhost and from any static sub-path (GitHub Pages).
  base: './',
  plugins: [
    stripCspInDev(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['fonts/*.woff2', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        id: './',
        name: 'Arizo Manage — آریزو منیجر',
        short_name: 'Arizo',
        description: 'Offline-first private finance vault',
        lang: 'fa-IR',
        dir: 'rtl',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#06080D',
        theme_color: '#06080D',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,wasm,bin,png,svg,ico,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: false },
  // Zero production logs (PROMPT.md §1.5): every console.* call, ours and the libraries', is removed from
  // the production bundle and its workers. E2E builds keep them so the tests can see page errors.
  esbuild: mode === 'production' ? { drop: ['console', 'debugger'] } : {},
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
