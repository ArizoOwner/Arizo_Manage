# Arizo Manage (آریزو منیجر) — Living Project Memory

The spec is `PROMPT.md`. It is the source of truth; this file records what is **built**, the **decisions** taken, and the **invariants** that must never regress. Update it at the end of every phase.

## Phase status
| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Bootstrap, strict CSP, PWA, Capacitor Android, CLAUDE.md | ✅ done, gate green |
| 1 | Crypto worker, vault, dual DB, Android security/SQLCipher | ⏳ next |
| 2–9 | See PROMPT.md §8 | pending |

## Commands
| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (dev strips the CSP meta: React Refresh needs an inline script) |
| `npm run typecheck` | `tsc -b --noEmit` across app + node configs |
| `npm run build` | typecheck + production build + service worker into `dist/` |
| `npm test` | Vitest (`tests/**/*.test.ts`, jsdom) |
| `npm run e2e` | Playwright against the **production build** at 390×844 (CSP is exercised) |
| `npx cap sync android` | Copy `dist/` into the Android project |
| `cd android && ./gradlew assembleDebug` | Debug APK (needs `android/local.properties` with `sdk.dir`, git-ignored) |
| `node scripts/gen-icons.mjs` | Re-rasterise PWA/iOS icons from `public/icons/icon.svg` |

## Stack (installed versions)
React 19.3 · TypeScript 5.9 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) · Vite 6.4 · Tailwind 4.3 (`@tailwindcss/vite`) · Framer Motion 12 · React Router 7 (`createHashRouter`) · Zustand 5 · vite-plugin-pwa 1.3 (generateSW, `registerType: 'prompt'`) · Vitest 3 · Playwright 1.65 · Capacitor 7.6 (`com.arizo.manage`).
Toolchain on this machine: Node 24, JDK 21, Android SDK at `%LOCALAPPDATA%\Android\Sdk` (platform 37, build-tools 36/37).

Phase 1+ dependencies not yet installed (added when first used): hash-wasm, dexie, jalaali-js, i18next, @tanstack/react-virtual, exceljs, html-to-image, chart lib, @capacitor/{haptics,app,share,filesystem,local-notifications}.

## Security invariants (never regress)
1. **CSP** in `index.html` is exactly the PROMPT.md §1.2 policy plus tightening only (`worker-src 'self' blob:`, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`). Pinned by `tests/csp.test.ts`. No remote origin, ever.
2. **No inline scripts** in built HTML. Capacitor injects its bridge through `addDocumentStartJavaScript` (not an inline `<script>`) on WebView builds that support `DOCUMENT_START_SCRIPT`; older WebViews fall back to inline injection, which the CSP blocks. Verify on device in Phase 1.
3. **Zero network**: no CDN, no telemetry SDK, no external fetch. Fonts are self-hosted in `public/fonts` (OFL licences alongside). E2E asserts zero non-localhost requests.
4. **Android manifest**: `allowBackup=false`, `fullBackupContent=false`, `dataExtractionRules` exclude all domains, `usesCleartextTraffic=false`, `network_security_config.xml` forbids cleartext. `INTERNET` permission stays because the Capacitor WebView serves `https://localhost` through it; the external-host firewall lands in `MainActivity` in Phase 1.
5. **Money** is integer minor units (`bigint`), never `number` floats (from Phase 1).
6. **Never log** card numbers, Sheba, amounts, PINs, keys, SMS bodies (SecureLogger, Phase 1).

## Design tokens
`src/core/theme/tokens.css`: `--arizo-*` vars for `[data-theme='obsidian']` (default) and `[data-theme='alabaster']`, values from PROMPT.md §3.2. They are mapped to Tailwind colours in `src/index.css` `@theme inline`: `canvas, surface-1..3, hairline, specular, emerald, emerald-glow, gold, coral, azure, amber, ink, ink-2, ink-3`, fonts `font-fa`/`font-en`. Use `ms-/me-/ps-/pe-/start-/end-` logical utilities only.

## Decisions log
- **Vite 6 kept** (spec lock). `@vitejs/plugin-react` 5.2 and vite-plugin-pwa 1.3 both support it.
- **Capacitor 7** (spec allows 6/7; 8 exists but is outside the spec).
- **`base: './'`**: one build serves Capacitor (`https://localhost/`) and a static PWA on any sub-path (GitHub Pages).
- **Service worker web-only**: `UpdatePrompt` registers only when `!Capacitor.isNativePlatform()`; the APK ships assets in the binary.
- **Dev CSP strip**: a `serve`-only Vite plugin removes the CSP meta, because React Refresh's preamble is inline. Production and E2E always carry it.
- **Fonts**: variable woff2 from `@fontsource-variable` (Vazirmatn arabic+latin, Plus Jakarta latin+latin-ext). One file covers weights 400–800.
- **Icons**: generated from `public/icons/icon.svg` with the Playwright Chromium. Android launcher icons are still Capacitor defaults; replaced in Phase 9 (or earlier if requested).
- **MainActivity** is Capacitor's generated Java file for now; it becomes `MainActivity.kt` in Phase 1 (Kotlin Gradle plugin added then).

## Layout
`src/app` (App, router, BootScreen placeholder, UpdatePrompt) · `src/core/theme` (fonts.css, tokens.css) · `tests/` (Vitest) · `tests/e2e/` (Playwright) · `android/` (Capacitor project) · `docs/` (architecture, security, sms_engine, distribution_fa skeletons) · `scripts/` (icon generator).
