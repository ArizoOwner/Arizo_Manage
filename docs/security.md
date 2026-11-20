# Security — threat model and Phase 9 audit

Arizo Manage is a personal finance vault for a small circle of friends and family. There is no server:
every byte of financial data lives on the user's own phone, encrypted, and leaves it only as an
encrypted `.arizo` backup or an export the user asks for. This document says what that protects
against, what it does not, how each control was checked in Phase 9, and what has **not** been verified
on real hardware.

Audit date: 2026-11-20 (Phase 9). Method: code review of every control below, the automated checks
named next to it, and the fixes listed under "Findings". Nothing here was run on a physical Android
phone, a printer or an iPhone (see §7).

## 1. Assets and adversaries

**Assets**: balances, transactions, card numbers and Sheba, cheques, loans, debts, invoices with
customer IDs, attachments (receipt photos, logo, signature), bank SMS text, the PIN, the data key.

| Adversary | Can | Goal | In scope |
| --- | --- | --- | --- |
| Thief or finder of a locked phone | Hold the device, copy storage, try PINs | Read the vault | Yes |
| Shoulder surfer, app switcher, screen recorder | See the screen, thumbnails, screenshots | Read amounts | Yes |
| Coercer ("open the app") | Force the user to unlock | See real net worth | Partly (decoy vault, web/iOS only) |
| Network observer, ISP, filtered network | Watch or tamper with traffic | Learn anything | Yes (there is no traffic) |
| Cloud backup provider (Google, iCloud) | Read OS backups | Read the vault | Yes |
| Other apps on the phone | Shared storage, intents, clipboard | Exfiltrate data | Yes |
| Crafted SMS, pasted text, CSV, backup file | Feed the parsers | Inject formulas, scripts, fake rows | Yes |
| Holder of a stolen `.arizo` file | Offline brute force | Decrypt the backup | Yes (passphrase strength) |
| Malware with root or a compromised OS | Read process memory, hook the WebView | Everything | **No**: no app can defend this |
| A user who loses PIN, passphrase and Recovery Key | — | Recover | **No**: by design there is no backdoor |

## 2. Controls and what each one stops

### Encryption at rest
- **Android**: SQLCipher 4.10 with a random 256-bit DEK. The DEK is wrapped per PIN slot (AES-GCM under
  an Argon2id KEK derived in the JS worker) and per biometric slot (Android Keystore AES-GCM,
  StrongBox → TEE, `BIOMETRIC_STRONG` per use, invalidated on new enrolment). The DEK exists only in
  native memory and is zeroized after keying (`ArizoSecurityPlugin.takeDek`). `PRAGMA cipher_version`
  is asserted on every open; `secure_delete` is on. Attachments live in the encrypted `vault_blobs`
  table. *Stops*: storage copy, ADB pull, forensic image of a locked phone.
- **iOS/web**: every IndexedDB row is AES-256-GCM under a non-extractable `CryptoKey` from Argon2id
  (m = 64 MiB, t = 3, p = 1) and HKDF; index values are HMAC tags, never plaintext. Each record is bound
  to `arizo/rec/v1|<store>|<id>` and each blob to `arizo/blob/v1|<id>`, so rows cannot be swapped,
  moved or replayed under another id. Pinned by `tests/storage-contract.test.ts` and
  `tests/invoices.test.ts`.
- **Residual**: a 6-digit PIN has 10^6 values. Argon2id makes each guess cost roughly half a second to a
  second on a phone, and the lockout ladder (5 → 30 s, 8 → 5 min, 10 → 15 min, optional wipe at 15)
  slows guesses through the UI. But an attacker who copies the encrypted database and the PIN slot can
  brute-force offline at Argon2 speed, so every 6-digit PIN falls in days on ordinary hardware. An
  8-digit PIN multiplies that by 100. On Android the Keystore protects only the biometric slot.

### Authentication and lockout
- PIN 6–8 digits with a weak-PIN rule. Biometrics: BiometricPrompt Class 3 (Android) or WebAuthn PRF
  (iOS/web; platforms without PRF get PIN-only, never a UI-only fake gate).
- Lockout state lives in `localStorage`; someone with devtools on an unlocked browser profile could
  reset it. The offline-attack note above already covers that case.
- Re-auth (fresh PIN within 60 s) gates card/Sheba reveal and copy, every export, backup create and
  restore, auto-lock and decoy changes, and Wipe All Data.

### Auto-lock, privacy curtain and modals
- `AutoLockManager` covers the screen the moment the app is hidden (`visibilitychange`, `pagehide`,
  Android `onPause` → `arizoNativePause`) and locks after the chosen delay hidden or ≥ 1 min idle.
  Locking drops `open` from the store, which unmounts the routed tree, every sheet, the print portal
  and all decrypted state; the crypto, analytics, SMS, backup and xlsx workers are terminated.
- **Checked by** `tests/e2e/hardening.spec.ts`: with "Immediate" auto-lock, hiding the app from inside
  the entry sheet, a receipt sheet and a re-auth sheet leaves the lock screen, no dialog, no curtain and
  no merchant text in the DOM, and nothing reopens after unlock.

### Network: zero traffic
- **CSP** (`index.html`, pinned by `tests/csp.test.ts`): `default-src 'self'; connect-src 'self';
  script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  font-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'`,
  plus `referrer: no-referrer`. `'wasm-unsafe-eval'` allows WebAssembly compilation for Argon2 only,
  not JS `eval`. Inline styles are needed by Framer Motion; there are no inline scripts.
- **Android WebView firewall** (`MainActivity.FirewallWebViewClient`): every request whose origin is not
  the app's own `https://localhost` gets a local 403 before it reaches the network; navigation away is
  refused; file and content access are off; WebView debugging only in debug builds.
- `network_security_config.xml` forbids cleartext; `usesCleartextTraffic=false`;
  `allowMixedContent=false`. No Firebase or google-services, no analytics or crash SDK.
- The `INTERNET` permission stays: the optional thermal printer needs a raw TCP socket to a private LAN
  IPv4 (`ArizoThermalPrintPlugin` rejects hostnames and public addresses). JS never opens a socket.
- **Checked by**: every E2E journey asserts zero requests outside `localhost:4173`;
  `scripts/check-prod.mjs` fails the build on any host outside a reviewed list in the production JS
  (today only XML namespaces and documentation links inside library strings), any remote reference in
  `index.html` or the manifest, and any inline script.

### Airplane-mode PWA
- Workbox precaches the whole build (JS, CSS, WASM, fonts, icons). **Checked by**
  `tests/e2e/hardening.spec.ts`: once the service worker is active and controls the page, the network is
  switched off, the page reloads, the lock screen loads, the PIN unlocks, transactions decrypt and
  Analytics renders, with zero failed requests.

### Backups and OS backup
- `allowBackup=false`, `fullBackupContent=false`, `dataExtractionRules` exclude every domain from cloud
  backup and device transfer. The SMS queue lives in `noBackupFilesDir`.
- `.arizo` files: AES-256-GCM under a random file key wrapped per slot (Argon2id passphrase slot,
  HKDF Recovery Key slot); the header is the AAD, so any bit flip, wrong secret or truncation fails
  before anything is written. A pre-restore safety snapshot is taken; Replace is read back and undone
  on a count mismatch. Pinned by `tests/backup.test.ts` (15 tamper cases).
- *Residual*: a stolen `.arizo` file is only as strong as its passphrase. The app requires ≥ 10
  characters and an offline strength score ≥ 2; that is a floor, not a guarantee.

### Screen and clipboard
- `FLAG_SECURE` from `onCreate`: blank screenshots, recordings and Recents thumbnail. Only the user's
  explicit allowance (at most 2 minutes) lifts it.
- Android sensitive clipboard (`EXTRA_IS_SENSITIVE`, cleared after 45 s). iOS/web cannot mark or
  reliably clear the clipboard; a copied card number stays until overwritten (residual).
- Stealth blur hides amounts on screen; exports and printing are refused while it is on.

### Logs
- `SecureLogger` is a no-op in production and redacts in dev.
- **Phase 9**: production builds drop every `console.*` call, ours and the libraries'
  (`esbuild.drop` in `vite.config.ts`), and i18next's sponsor `console.info` is disabled.
  `check-prod.mjs` counts what remains: one `win.console.error` inside Capacitor's bridge (native bridge
  failures, never vault data) and one `console.warn` in Workbox's service worker about precache
  entries. Any new console call fails the build.
- Android release: R8 `-assumenosideeffects` strips `android.util.Log.{v,d,i,w,e}`. Our Kotlin never logs
  SMS text, keys or SQL values; plugin errors are fixed codes.
- No source maps ship (`sourcemap: false`, checked by `check-prod.mjs`).

### SMS
- Firewall first: OTP/2FA and promo messages are rejected before parsing, natively (`SmsFilter`, before
  sealing) and in JS (`firewall()`); they are never written anywhere. Pinned by
  `tests/sms-parser.test.ts` ("never persisted anywhere").
- Captured bank SMS are sealed with a Keystore RSA-OAEP public key while the app is locked or killed and
  opened only after unlock. The capture notification is generic and private. The iOS hand-off fragment
  `#/sms-ingest?d=` is wiped by the first import of `main.tsx`, before the router reads it.
- Every captured SMS is `pending_review`; nothing auto-posts.
- *Residual*: anyone who can send an SMS can create a pending row that looks like a bank message. It
  needs the user's approval to post.

### Exports and injection
- CSV text cells starting with `= + - @` get a leading `'`. xlsx amounts are numbers only up to 15
  significant digits, else exact text. Android writes export files only to the app cache for the share
  sheet and deletes them in `finally`.
- React escapes all text; no user data goes through `dangerouslySetInnerHTML`. Imported CSV, pasted SMS
  and restored backups are validated (dates, amounts, schema version, store counts, blob hashes).

### R8 / ProGuard
- Release builds are minified and resource-shrunk. Keep rules: Capacitor (`com.getcapacitor.**`,
  `@CapacitorPlugin` classes, `@PluginMethod` members, found by reflection) and SQLCipher
  (`net.zetetic.database.**`, called from JNI). Our plugins are `@CapacitorPlugin` classes, so they and
  their methods keep their names. `BankSmsReceiver` and `BankNotificationListener` are manifest
  components, which AAPT keeps automatically.
- **Checked (Phase 9 release build)**: `./gradlew assembleRelease` succeeds; `mapping.txt` keeps
  `MainActivity`, all five `Arizo*Plugin` classes, `BankSmsReceiver`, `BankNotificationListener`,
  `com.getcapacitor.Plugin` and `net.zetetic.database.sqlcipher.SQLiteDatabase` under their own names,
  while internal helpers are renamed or removed; plugin method names (`openQueueItem`, `setSmsEnabled`,
  `printTcp`…) are present in the dex; our Kotlin contains no `Log`, `println` or `printStackTrace`
  call. Whether every plugin method still answers from JS after minification can only be shown on a
  device.

## 3. Phase 9 findings (fixed)

1. **Concurrent vault writes could break a transaction batch** (`StagedVault.transaction`). A write that
   started while another transaction was open (for example a background job during a long bulk import)
   joined the open batch; if it was still running when the batch committed, it wrote into a cleared
   batch and threw, and its writes were lost. Found by the 20,000-row stress test. Fix: the outer
   transaction waits for every joined call before committing, and a caller arriving while the batch is
   being written runs in its own transaction afterwards. Regression test in
   `tests/storage-contract.test.ts` ("a concurrent write that starts mid-transaction…"), both adapters.
2. **Privacy curtain stuck over the lock screen after an auto-lock.** The curtain was lifted by the same
   effect that the lock tore down, so after "lock on hide" it stayed and swallowed every tap on the PIN
   pad: the app looked frozen until restarted. Fix: a separate listener lifts the curtain on return
   (`visibilitychange`, `pageshow`, and a new Android `onResume` → `arizoNativeResume`).
3. **The entry sheet reopened by itself after unlock.** Locking while the quick-entry sheet was open hid
   it, but its state outlived the lock and it popped up again after the next unlock. Fix: `AppShell`
   clears it when the vault locks.
4. **Production console output.** i18next printed a sponsor message on every start, and library
   `console.*` calls (Dexie, React Router, exceljs) shipped. None carried vault data, but it broke the
   "zero production logs" rule. Fix: `showSupportNotice: false` and `esbuild.drop` for production,
   guarded by `check-prod.mjs`.
5. **Android launcher icon** was the Capacitor default on a white background. Replaced with the Arizo
   glyph (vector, inside the adaptive safe zone) on obsidian, with a monochrome layer for themed icons.

## 4. Invariants re-checked (CLAUDE.md)

| # | Invariant | Evidence |
| --- | --- | --- |
| 1 | CSP | `tests/csp.test.ts`; `check-prod.mjs` (meta present in `dist/index.html`) |
| 2 | No inline scripts | `check-prod.mjs`; Capacitor's inline fallback on very old WebViews still unverified |
| 3 | Zero network | E2E external-request guards, firewall review, `check-prod.mjs` host list, offline E2E |
| 4 | Android manifest | Reviewed: backup flags, extraction rules, cleartext, `FLAG_SECURE` |
| 5 | Money is bigint | `money.ts` review; ledger, invoice and analytics tests |
| 6 | Never log secrets | SecureLogger review, console drop, R8 `Log` strip |
| 7 | DEK handling | Review of `ArizoSecurityPlugin` / `ArizoSqlCipherPlugin`; zeroize tests |
| 8 | Record AAD | `tests/storage-contract.test.ts` (tampered or moved row rejected) |
| 9 | SMS firewall first | `tests/sms-parser.test.ts` |
| 10 | SMS text never in log/notification/URL | `tests/e2e/sms.spec.ts` (fragment wipe), notifier review |
| 11 | Analytics never counts a transfer | `tests/analytics.test.ts` |
| 12 | Attachments encrypted | `tests/invoices.test.ts` |
| 13 | Exports need re-auth | `tests/e2e/hardening.spec.ts` (re-auth sheet on export), `tests/exports.test.ts` |
| 14 | One socket, LAN only | `ArizoThermalPrintPlugin` review, `isPrivateLanIp` tests |
| 15 | Backups zero-knowledge | `tests/backup.test.ts` |

## 5. Residual risks (accepted)

- Offline PIN brute force against a copied database (see §2). Mitigation: an 8-digit PIN.
- The decoy vault exists on web/iOS only; Android does not offer it.
- iOS PWA: no clipboard clearing, no screenshot blocking (iOS gives web apps neither), no scheduled
  notifications. Safari may evict site data after long disuse if persistent storage is refused; the
  backup reminder exists for that reason.
- `style-src 'unsafe-inline'` stays (Framer Motion). It matters only if an attacker could inject markup,
  which React's escaping prevents.
- A compromised OS, a malicious keyboard or an app with accessibility access can read the screen while
  the vault is open. No app-level control prevents that.
- No independent cryptographic review has been done. The primitives are standard (Argon2id via
  hash-wasm, WebCrypto AES-GCM/HKDF, SQLCipher, Android Keystore) and tested against vectors, but the
  composition is this project's own.

## 6. Verified on an Android 15 emulator (after Phase 9)

A device report after Phase 9 showed that the PIN never unlocked on a phone. Cause: `ArizoSqlCipherPlugin`
ran `PRAGMA secure_delete = ON` through `execSQL`, which SQLCipher rejects for statements that return a
row, so the database never opened. Fixed (all PRAGMAs via `rawQuery`, guard test
`tests/android-native.test.ts`), and the lock screen now shows an error instead of looking frozen.

`scripts/android-smoke.mjs` now drives the debug APK on an emulator: vault creation (Argon2id 64 MiB,
native PIN slot, SQLCipher `cipher_version`), demo data, lock, wrong PIN refused, right PIN, fingerprint
enrolment and fingerprint unlock (BiometricPrompt + Keystore key), and data intact after a force-stop. The
signed R8 release APK passed the same flow by hand, and a screenshot of it is black (`FLAG_SECURE`).

## 7. Not verified on real hardware

All of the following compile (debug and R8 release) and are code-reviewed, but **none has been run on a
physical phone, printer or iPhone** (an emulator covered only what §6 lists):

- The WebView firewall answering 403 on a device, the `onPause`/`onResume` curtain events.
- Keystore key invalidation on a new enrolment; StrongBox; vendor fingerprint and face sensors.
- The sensitive clipboard.
- Every SMS path: `SMS_RECEIVED` receiver, notification listener, Android 13+ Restricted Settings flow,
  sealed queue round trip, history scan, capture notification.
- Printing: `ArizoPrintPlugin` (PrintManager, Persian shaping on paper) and `ArizoThermalPrintPlugin`
  (Bluetooth SPP and TCP 9100 to a real ESC/POS printer, the `BLUETOOTH_CONNECT` prompt).
- The Android share-sheet hand-off and file-picker restore of `.arizo`; restoring an Android backup on an
  iPhone (only unit-tested across sql.js ↔ fake-indexeddb).
- iOS: AirPrint from the PWA, the Shortcuts hand-off on a real iPhone, WebAuthn PRF with Face ID.
- Capacitor's inline-script fallback on very old WebViews (the CSP would block it).
- That every Capacitor plugin method still answers after R8 minification.
- The new launcher icon on a launcher (only rendered as PNG and compiled into the APK).
- Smooth scrolling on a phone: the stress numbers below come from headless Chromium on a laptop.

## 8. Performance (Phase 9 stress test)

`tests/e2e/stress.spec.ts`, production-mode E2E build (minified, CSP on, encrypted IndexedDB; Argon2 is
lowered only for test speed), 390×844, headless Chromium on a Windows laptop. 20,000 transactions are
seeded through the real ledger (`seedStressData`: `createTransaction`/`createTransfer` inside 500-row
atomic batches); `verifyLedger` then reports no drift, orphans or broken pairs.

| Measure | Threshold | Measured |
| --- | --- | --- |
| Ledger scroll, p95 frame interval (40 px per frame for ~4 s, ~9,700 px) | ≤ 34 ms | 16.8 ms and 16.7 ms |
| Frames over 50 ms | ≤ 5 % | 0 % |
| Analytics worker, median of 5 runs over all 20,000 rows | < 150 ms | 121 ms and 69 ms in two runs (max 127 ms) |
| SMS worker, 1,000-message batch, median of 5 | < 150 ms | 58 ms and 30 ms in two runs |

p95 allows two 60 Hz frames because CI machines are noisy and headless Chromium paces rAF unevenly; it
still catches a real regression (a list that mounted 20,000 rows would take seconds per frame). Worker
times run from `postMessage` to the result with the worker already started, as in the app after first
use; decrypting the rows happens before that, on the thread that owns the database. A phone CPU is
slower than this laptop, so the analytics figure has little headroom there. It is the first thing to
optimise if a real device misses 150 ms.
