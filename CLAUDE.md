# Arizo Manage (آریزو منیجر) — Living Project Memory

The spec is `PROMPT.md`. It is the source of truth; this file records what is **built**, the **decisions** taken, and the **invariants** that must never regress. Update it at the end of every phase.

**Project location:** `D:\Projects\Arizo Manage` (moved from `Downloads` on 2026-11-20).
**Working mode:** the user asked for phases to run back to back without stopping for approval. Still pass each gate and commit each phase.
**Language:** reply to the user in Persian (فارسی). Code, paths and commands stay in Latin.

## Phase status
| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Bootstrap, strict CSP, PWA, Capacitor Android, CLAUDE.md | ✅ done, gate green |
| 1 | Crypto worker, vault, dual DB, Android security/SQLCipher | ✅ done, gate green (153 tests, debug + R8 release APK build) |
| 2 | Design system, i18n, dual calendar, motion primitives | ✅ done, gate green (199 unit + 10 E2E) |
| 3 | Vault lock, onboarding, dashboard, accounts, ledger | ✅ done, gate green (232 unit + 16 E2E, R8 release APK) |
| 4 | Cheques, loans & installments, debts, local reminders | ✅ done, gate green (261 unit + 19 E2E, R8 release APK) |
| 5 | Bank SMS & notification intelligence engine | ✅ done, gate green (371 unit incl. 89 SMS vectors + 22 E2E, R8 release APK) |
| 6 | Analytics, budgets, goals, insights | ⏳ next |
| 7–9 | See PROMPT.md §8 | pending |

## Commands
| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (dev strips the CSP meta: React Refresh needs an inline script) |
| `npm run typecheck` | `tsc -b --noEmit` across app + node configs |
| `npm run build` | typecheck + production build + service worker into `dist/` |
| `npm test` | Vitest (`tests/**/*.test.ts`, node env; fake-indexeddb + sql.js for storage) |
| `npm run e2e` | Playwright: builds `--mode e2e` into `dist-e2e/` (gallery route on, CSP on) and serves it on :4173 |
| `node scripts/check-prod.mjs` | After `npm run build`: fails if the dev-only gallery or the cheap-Argon2 test hook leaked into `dist/` |
| `SHOOT=1 npx playwright test tests/e2e/screens-shoot.spec.ts` | Manual visual review: screenshots of the main screens into `test-results/shots/` (skipped in the gate) |
| `npx cap sync android` | Copy `dist/` into the Android project |
| `cd android && ./gradlew assembleDebug` | Debug APK (needs `android/local.properties` with `sdk.dir`, git-ignored) |
| `cd android && ./gradlew assembleRelease` | R8-minified release APK (unsigned until Phase 9 signing docs) |
| `node scripts/gen-icons.mjs` | Re-rasterise PWA/iOS icons from `public/icons/icon.svg` |

## Stack (installed versions)
React 19.3 · TypeScript 5.9 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) · Vite 6.4 · Tailwind 4.3 · Framer Motion 12 · React Router 7 (`createHashRouter`) · Zustand 5 · vite-plugin-pwa 1.3 · hash-wasm 4.13 · Dexie 4.4 · Vitest 3 · Playwright 1.65 · Capacitor 7.6.
Dev-only: fake-indexeddb 6, sql.js 1.17 (runs the Android SQL in tests).
Android: Kotlin 2.1.21 · SQLCipher `net.zetetic:sqlcipher-android` 4.10.0 (+ androidx.sqlite 2.2.0) · androidx.biometric 1.1.0 · androidx.webkit.
Toolchain: Node 24, JDK 21, Android SDK at `%LOCALAPPDATA%\Android\Sdk`.
Phase 2 added: jalaali-js 1.2, i18next 25 + react-i18next 15, @capacitor/haptics 7. Phase 3 added: @tanstack/react-virtual 3. Phase 4 added: @capacitor/local-notifications 7. Phase 5 added no dependency.
Not yet installed (added when first used): exceljs, html-to-image, chart lib, @capacitor/{app,share,filesystem}.

## Security invariants (never regress)
1. **CSP** in `index.html` is the PROMPT.md §1.2 policy plus tightening, plus one documented addition: `script-src 'self' 'wasm-unsafe-eval'` (required to instantiate the Argon2id WASM; it allows WebAssembly compilation only, not JS `eval`). Pinned by `tests/csp.test.ts`. No remote origin, ever.
2. **No inline scripts** in built HTML. Capacitor injects its bridge via `addDocumentStartJavaScript` on modern WebViews; on very old WebViews it falls back to inline injection, which the CSP blocks. **Still to verify on a real device.**
3. **Zero network**: no CDN, no telemetry, no Firebase (google-services removed from Gradle). `MainActivity.FirewallWebViewClient` answers every non-`https://localhost` request with 403 and refuses navigation away. E2E asserts zero external requests on web.
4. **Android manifest**: `allowBackup=false`, `fullBackupContent=false`, `dataExtractionRules` exclude all, `usesCleartextTraffic=false`, `network_security_config.xml` forbids cleartext. `FLAG_SECURE` set in `onCreate`; only `ArizoSecurity.setScreenshotAllowed({allowForMs ≤ 120000})` lifts it temporarily.
5. **Money** is `bigint` minor units end to end (schema, ledger, codec). `src/core/currency/money.ts` has no float math.
6. **Never log** secrets: `SecureLogger` is a no-op in production and redacts in dev. R8 strips `android.util.Log` in release.
7. **DEK handling**: Android DEK exists only in native memory (`ArizoSecurityPlugin` → `ArizoSqlCipherPlugin.takeDek()`, zeroized after keying). Web CryptoKeys are non-extractable; raw bytes are zeroized after import; the crypto worker is terminated on lock.
8. **Record AAD**: every web ciphertext is bound to `arizo/rec/v1|<store>|<id>`, so rows cannot be swapped or moved. Tested.
9. **SMS firewall first**: OTP/2FA and promo messages are rejected before anything else and are never written anywhere (no transaction, no inbox entry, no audit row). Native `SmsFilter` drops them before sealing; `firewall()` drops them again in JS. Pinned by `tests/sms-parser.test.ts` ("never persisted anywhere").
10. **SMS text** never reaches a log, a notification or the URL: the capture notification is generic (`capture_text`, `VISIBILITY_PRIVATE` plus a public version), `#/sms-ingest?d=` is replaced with `#/sms` by the first import of `main.tsx` (before the router reads the URL), and queue items open only through `ArizoSecurity.openQueueItem` (refuses while locked). Nothing is ingested into a decoy session.

## Architecture (Phase 1)
- `src/core/crypto/`: `bytes` (zeroize, b64, hex, constant-time compare, chunked CSPRNG), `primitives` (Argon2id m=64MiB t=3 p=1, AES-256-GCM seal/open with 96-bit nonce, HKDF-SHA256), `keyring` (DEK wrapped per PIN slot; main + decoy slots; all slots always derived so timing hides the decoy; HKDF sub-keys `record`/`blob`/`index`), `crypto.worker` + `cryptoClient` (transferable PIN buffers, terminate on lock).
- `src/core/storage/`: `schema.ts` (18 entity groups, 26 stores, `INDEXED`/`UNIQUE` maps), `IVaultDatabase` contract, `StagedVault` (shared tx core: writes staged in memory, applied as one atomic batch; reads see staged writes; nested tx joins), `WebEncryptedDexieAdapter` (rows = id + HMAC tags + AES-GCM blob), `SqlVaultAdapter` (one table per store, `ix_*` columns, UNIQUE indexes, JSON `data`; `SQL_MIGRATIONS` append-only), `codec` (lossless bigint JSON).
- `src/core/ledger/ledger.ts`: create/update/void/soft-delete/restore/post-pending, transfers (pair + optional fee sharing `transfer_pair_id`), splits (Σ = parent), `postLinkedTransaction` (one live tx per obligation), `purgeTrash` (30 d), `verifyLedger` (drift/orphans/broken pairs/split mismatches, optional fix), `incomeExpenseTotals` (transfers excluded).
- `src/core/security/`: `vaultService` (create/unlock/lock/changePin/wipe on both platforms), `lockout` (5→30 s, 8→5 m, 10→15 m, opt-in wipe at 15).
- `src/core/bridge/native.ts`: typed `ArizoSecurity` / `ArizoSqlCipher` plugins + `sqlCipherExecutor`.
- Android `plugins/ArizoSecurityPlugin.kt`: PIN slot (AES-GCM with the JS Argon2 KEK, same AAD as web), bio slot (Keystore AES, StrongBox→TEE fallback, BIOMETRIC_STRONG per use, invalidated on enrolment → `BIO_INVALIDATED`), RSA-OAEP queue keypair + `sealForQueue` (for Phase 5 receivers) + `openQueueItem` (unlocked only), sensitive clipboard (45 s), FLAG_SECURE toggle.
- Android `plugins/ArizoSqlCipherPlugin.kt`: raw 32-byte key, asserts `PRAGMA cipher_version`, WAL, `secure_delete`, `foreign_keys`; single background thread; errors never echo SQL or values.
- `src/core/data/`: `banks.json` (39 entries: 29 Iranian banks/institutions + 3 neo-banks + 7 international; all `verified: false`, senders and Android packages empty for the user to confirm), `seedCategories` (stable ids `cat_*`, idempotent).
- Validators: Luhn, Sheba mod-97, national ID (personal + legal), economic code, Sayad (shape only: no public checksum), mobile. `numToPersianWords` up to quadrillions.

## SMS engine (Phase 5)
- `src/core/sms/normalize.ts`: `normalizeSms` (Persian/Arabic digits to ASCII, ي/ى/ك, strips ZWNJ/ZWJ/RLM/LRM/bidi/tatweel, `2,000,000-` becomes `-2,000,000` without touching dates or times) and `firewall` (OTP + spam keywords, runs first).
- `src/core/data/sms-templates.json`: data-driven labels (amount/balance/ref/card/merchant), direction and channel words, 39 bank templates (detected by name keywords; Iranian banks default to Rial, international banks to their currency and date order), Persian/English merchant to `cat_*` map. No sender numbers.
- `src/core/sms/parser.ts`: `parseSms` = firewall, normalize, enabled custom rules (priority order; `field_map_json` = capture group per field; `unit_hint`, `type_hint`), then template + label-driven extraction, then a heuristic fallback (largest grouped number). Dates (Jalali `1403/08/15`, `03/08/22`, Gregorian `mdy`/`dmy`, `20-Nov-2026`, `Nov 20, 2026`) and times are blanked before amounts are looked for; masked or 16-digit cards and ungrouped runs of 10+ digits (accounts, reference ids) are never amounts. An explicit `ریال`/`تومان`/`$`/`€`/`£`/`AED` wins over the bank default (Toman x 10 = Rial). Confidence 0–1; `LOW_CONFIDENCE` 0.6. `smsFingerprint` = SHA-256 of the normalized body. `splitBulk` for paste.
- `src/core/sms/ingest.ts`: `ingestMany` (one atomic tx per message): fingerprint already stored = `duplicate`; unparsed or no matching account = inbox (`settings.sms_inbox`, max 100); account match = card suffix, else the only account of that bank, else the only bank-type account in that currency; SMS + push pair = same account and amount within 2 min with equal (or one missing) balances = `duplicate`; otherwise a `pending_review` tx with its category from `merchant_category_memory`, then the bundled map. `approvePending` posts and learns the merchant. `confirmSender` stores a user-confirmed sender-to-bank pair in `settings.sms_senders`. `balanceDrift` compares the latest reported balance with the running ledger balance at that point (a later adjustment clears it); the UI fixes drift through `reconcileBalance`. Teach: `numberTokens` + `buildTaughtRegex` (anchors on the two words before each tapped number, digits generalized). `saveRule`/`deleteRule` write `sms_parser_rules` plus an `sms_rule_changed` audit row (no content). `reprocessInbox` re-runs the inbox after any rule, sender or account change.
- `src/core/sms/sms.worker.ts` + `smsClient.ts` (`workerParser`): parsing runs off the UI thread; the worker is terminated on lock.
- `src/features/sms-intelligence/`: `intake.ts` (drains the Android sealed queue after unlock; `captureIngestFragment` runs from `src/app/bootFragment.ts`; `flushHeldFragment` after a main-vault unlock), `SmsCenter.tsx` (`#/sms`, `#/sms/paste`: Review Queue with account/category edit, flip and approve-all; Paste & Parse with a summary; Inbox with Teach and sender confirmation; drift badge with 1-tap Adjust), `Teach.tsx` (tap-to-regex with live preview; Regex Studio editor with a match count against inbox samples), `Wizards.tsx` (Android capture switches, 2-step Restricted Settings guide with Open App Info, bank-app picker, 30/90/365-day history scan; illustrated 4-step iOS Shortcuts guide with the copyable `#/sms-ingest?d=` URL).
- Dock "Paste SMS" opens `#/sms/paste`; the More "SMS Center" tile is live; the dashboard pending badge opens `#/sms`.
- Android `plugins/ArizoSmsPlugin.kt`: `BankSmsReceiver` (manifest component **disabled** until `setSmsEnabled(true)`; multipart PDUs joined per sender), `BankNotificationListener` (only `SmsPrefs.packages`), `SmsFilter` (native OTP/spam/bank-keyword gate), `SmsQueue` (sealed JSON files in `noBackupFilesDir/sms_queue`, max 2000, ids validated on delete, cleared by `destroyVault`), `CaptureNotifier` (generic, private). Methods: `status`, `setSmsEnabled` (requests RECEIVE_SMS/READ_SMS only then), `setNotificationsEnabled`, `openNotificationAccess`, `openAppInfo`, `listApps` (launcher `<queries>`, no QUERY_ALL_PACKAGES), `pending`, `ack`, `scanInbox` (background thread, at most 5000 messages). Switches live in SharedPreferences (not sensitive) because the receiver runs while the app is killed.

## Obligations (Phase 4)
- `src/core/obligations/`: `loans` (exact bigint annuity `P·a·(b+a)^n / (b·((b+a)^n−b^n))`, b = 120 000; 0% splits exactly with the remainder on the last rows; optional bank-printed installment override; Jalali/Gregorian monthly due dates clamped; pay/unpay idempotent via `postLinkedTransaction`; `refreshOverdue`; auto `paid_off`), `cheques` (Sayad 16-digit check, duplicate Sayad refused per direction, guarded status machine, clear → one linked tx, bounce/cancel/transfer after clear voids it, exposure KPI), `debts` (people with normalized mobile, lent/borrowed, optional opening posting, partial settlements capped at what is left, undo, per-person net per currency), `upcoming` (unified 14-day feed, overdue first), `reminders` (pure planner: 09:00 local on each lead day, stable 31-bit FNV ids, generic text unless `detailedNotifications`), `scheduler` (Android LocalNotifications; cancels the previous set first), `sync` (refresh overdue + replan; runs after unlock and after every `mutateObligation`; never in a decoy session).
- Settings: `reminders` (on) and `detailedNotifications` (off, change needs re-auth).
- Screens: `features/obligations/` Cheques (issued/received tabs, exposure, status actions), Loans (live installment preview, progress ring, pay/undo per installment), Debts (people, net, settle with keypad); routes `/cheques`, `/loans`, `/debts`; dashboard Upcoming strip uses the unified feed with 1-tap pay for installments and recurring.
- iOS PWA: no scheduled notifications offline, so reminders are the in-app Upcoming strip (stated in Settings).
- Android merged manifest gains `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK` from the plugin. No `SCHEDULE_EXACT_ALARM`, so reminders may land a few minutes after 09:00.

## App (Phase 3)
- `src/app/`: `AppShell` (Onboarding when no vault → LockScreen when locked → routes + LiquidDock + EntrySheet), `router` (hash routes: `/`, `ledger`, `trash`, `accounts`, `accounts/new`, `accounts/:id`, `rates`, `analytics`, `more`, `settings`), `AutoLockManager` (curtain on hide/`arizoNativePause`, lock after the chosen delay hidden or ≥ 1 min idle), `useVaultQuery` (re-queries on `rev`), stores `vault` (open vault, lockout, auto-lock, re-auth window, `mutate()`), `settings`, `privacy`.
- `src/core/ledger/`: `accounts` (Luhn/Sheba validation, initial-balance edits shift the balance, currency locks once used, reconcile = signed adjustment), `recurring` (Jalali/Gregorian cadences, clamped days, idempotent catch-up, pay-now), `networth` (manual rates in ppm, inverse lookup, missing rates listed not guessed, cashflow excludes transfers).
- `src/core/security/webauthn.ts`, `vaultService` (create, PIN/biometric unlock, verifyPin, decoy, PIN change, wipe), `src/core/utils/demoData.ts` (deterministic Persian sample data; `modest` for decoys).
- `src/core/ui/ui.tsx`: Button, Field, Toggle, Segmented, Card, Sheet (focus trap, Escape), Screen, IconButton, icons.
- Features: `vault-lock/` (PinPad with weak-PIN rule, LockScreen, Onboarding), `dashboard/`, `accounts/` (AccountForm with BIN detect, list, detail with hero `layoutId`, reconcile, rates), `transactions/` (EntrySheet: keypad, chips by usage, splits Σ = amount, tags, recurring; virtualized Ledger with day totals, search, filters, bulk delete, 5 s Undo, pending confirm; Trash), `security/ReauthSheet`, `settings/` (Security Center, Tools hub; later-phase modules listed as disabled).

## Design system (Phase 2)
- `src/core/calendar/calendar.ts`: Jalali↔Gregorian (jalaali-js), wall-clock math in a fixed zone (default `Asia/Tehran`) via `Intl`, `monthRange` half-open, `addMonths` clamps, Saturday-first weeks.
- `src/core/i18n/`: `fa.json`/`en.json` bundled (no HTTP backend), `format.ts` (`moneyParts`/`formatMoney`: Toman view keeps a Rial remainder digit; Persian digits and separators `٬` `٫`).
- `src/app/stores/`: `settings` (lang, calendar, irrUnit, theme in localStorage; `applyDocumentSettings` sets `lang`/`dir`/`data-theme` before first paint), `privacy` (session-only stealth blur).
- `src/core/currency/calculator.ts`: keypad engine on exact bigint fractions, × ÷ precedence, rounds once at the end, 15-digit cap.
- `src/core/motion/`: `motion.ts` (springs incl. odometer 320/28/0.9, haptics no-op on web), `OdometerAmount`, `ParallaxCard` (±7° tilt, sheen, SVG grain, `layoutId`), `LiquidDock` (4 tabs + orb, 450 ms long-press radial menu), `PrivacyBlur` (blur + `aria-hidden`), `CalculatorKeypad` (000 key, live Persian words), `DualDatePicker` (keyboard nav, RTL-aware arrows).
- `src/core/theme/cardFinishes.ts`: the 6 finishes.
- `src/features/gallery/DesignGallery.tsx` at `#/gallery`: dev and `--mode e2e` builds only.

## Design tokens
`src/core/theme/tokens.css`: `--arizo-*` vars for `[data-theme='obsidian']` (default) and `[data-theme='alabaster']`, values from PROMPT.md §3.2, mapped to Tailwind colours in `src/index.css` `@theme inline` (which emits no CSS vars: read `--arizo-*` in inline styles).
**WCAG AA (pinned by `tests/design-tokens.test.ts`):** spec accents pass in Obsidian but not in Alabaster (2.4–4.3:1). So: coloured text uses `text-{emerald,gold,coral,azure,amber}-text`; buttons use `bg-cta` / `bg-cta-danger` with `text-on-accent`; gold rings/marks use `gold-mark`. In Obsidian these equal the spec accents; in Alabaster they are deeper shades of the same hue. `ink-3` (muted) is for placeholders/disabled only. Use `ms-/me-/ps-/pe-/start-/end-` logical utilities only.

## Decisions log
- **Vite 6, Capacitor 7** (spec locks). `base: './'` for Capacitor + any static sub-path.
- **Service worker web-only**; the APK ships assets in the binary.
- **Dev CSP strip** (serve only). Production and E2E always carry the CSP.
- **`'wasm-unsafe-eval'`** added to `script-src` for hash-wasm. The alternative (pure-JS Argon2) would be ~10× slower at 64 MiB.
- **Staged transactions** instead of native DB transactions held open across awaits: IndexedDB auto-commits when WebCrypto yields, and the Capacitor bridge is async. Atomicity comes from a single batch per tx.
- **Android PIN path** derives the KEK in the JS worker (one Argon2 implementation, tested against RFC 9106 via Node's OpenSSL), and native only unwraps.
- **SQLCipher 4.10.0** (not 4.20) because 4.20 needs Kotlin stdlib 2.2 / androidx.sqlite 2.7, newer than Capacitor 7's toolchain.
- **androidx.biometric 1.1.0** (latest stable; 1.4 is still RC).
- **Decoy vault**: web/iOS only (Settings hides it on Android with an honest "later version" note). Android needs a second native key slot + DB file. Inside a decoy session the security controls are hidden.
- **Web biometrics = WebAuthn PRF only.** The passkey's PRF secret is a real second KEK (`method: 'prf'` slot). Platforms without PRF get PIN-only; a UI-only biometric gate is never offered.
- **Re-auth** lasts 60 s after any unlock or PIN check; gates card/Sheba reveal and copy, auto-lock changes, decoy setup, wipe toggle and Wipe All Data. On Android `verifyKek` checks the PIN without reopening the DB; the biometric-enrolment DEK copy now exists only on explicit request.
- **E2E Argon2**: the `--mode e2e` build lowers Argon2 to m=1 MiB/t=1 via `vaultService.useArgonParamsForTesting`; `check-prod.mjs` fails if that call ships.
- **Recurring**: each occurrence posts through `postLinkedTransaction` with id `<rule>@<scheduled ms>`, so catch-up, re-runs and "Pay now" can never double-post. Catch-up is capped at 400 per rule.
- **Sayad ID**: shape-only validation; the Central Bank publishes no checksum.
- **Bank SMS senders / Android packages**: left empty, never guessed (PROMPT.md §1.4).
- **Icons**: PWA icons generated; Android launcher icons still Capacitor defaults (Phase 9).
- **SMS bank detection by name keywords, never by sender**: banks.json senders and packages stay empty. A sender the user confirms in the Inbox is stored in the vault (`settings.sms_senders`) and used from then on.
- **SMS inbox and sender map live in `settings` rows** (encrypted like every record) instead of new stores, so no schema or migration change was needed.
- **Every captured SMS is `pending_review`**: nothing auto-posts, even at confidence 1. Approving teaches merchant to category.
- **Taught rules are plain `sms_parser_rules`** (`is_custom`, `verified: true`), tried before templates; a rule bound to a sender only matches that sender.
- **Android SMS switches in SharedPreferences**: they are booleans and package names, not financial data, and the receiver needs them without the DEK.
- **Restricted Settings detection** = Android 13+ and the installer is not a store. Shown as a 2-step guide; it cannot be bypassed in code.

## Not yet verified on a real device
FLAG_SECURE, WebView firewall, BiometricPrompt + Keystore invalidation, SQLCipher open/`cipher_version`, sensitive clipboard, and all Phase 5 native code: SMS_RECEIVED receiver, notification listener, Restricted Settings flow, sealed queue round trip, history scan, capture notification. All compile in debug and R8 release builds; none has been run on a phone. The iOS Shortcuts hand-off is tested in Playwright (fragment wipe + ingest), not on a real iPhone.

## Layout
`src/app` (App, router, BootScreen placeholder, UpdatePrompt, bootFragment) · `src/core/{crypto,storage,ledger,obligations,sms,security,bridge,data,currency,validators,utils,theme}` · `src/features/sms-intelligence` · `tests/` (Vitest; `helpers/vaults.ts` builds both adapters; `sms-fixtures/vectors.ts` holds the 89 synthetic SMS vectors) · `tests/e2e/` · `android/` · `docs/` · `scripts/`.
