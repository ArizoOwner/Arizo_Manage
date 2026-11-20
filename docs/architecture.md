# Architecture

Arizo Manage is one React app shipped two ways, with no backend at all. Details per phase and every
decision are in `CLAUDE.md`; the threat model is in `docs/security.md`; the SMS engine in
`docs/sms_engine.md`.

## Targets

| | Android APK | iOS / web PWA |
| --- | --- | --- |
| Shell | Capacitor 7 WebView, served from `https://localhost` out of the APK | Safari "Add to Home Screen", Workbox precache, hash routes |
| Storage | SQLCipher 4.10 (`ArizoSqlCipherPlugin`), DEK in native memory only | IndexedDB via Dexie, every row AES-256-GCM (`WebEncryptedDexieAdapter`) |
| Keys | Argon2id KEK (JS worker) unwraps the DEK natively; biometric slot in Android Keystore | Argon2id + HKDF to non-extractable `CryptoKey`s; WebAuthn PRF as a second KEK |
| Network | WebView firewall answers every non-local request with 403 | CSP `connect-src 'self'`; no remote origin anywhere |
| Native extras | SMS + bank-notification capture, PrintManager, thermal printer, share sheet, local notifications | Shortcuts SMS hand-off, AirPrint, Web Share |

## Layers

```
src/features/*            screens (React 19, Tailwind 4, Framer Motion), one folder per area
src/app/                  shell, hash router, stores (zustand: vault, settings, privacy), auto-lock
src/core/<domain>/        pure TypeScript domain logic, unit-tested on both storage adapters
src/core/storage/         IVaultDatabase contract + two adapters sharing StagedVault
src/core/bridge/          typed Capacitor plugin interfaces
android/app/.../plugins/  Kotlin plugins (security, SQLCipher, SMS, print, thermal print)
```

Domain folders: `crypto`, `storage`, `ledger`, `obligations`, `sms`, `analytics`, `invoices`,
`attachments`, `exports`, `print`, `backup`, `security`, `calendar`, `currency`, `i18n`, `validators`,
`data`, `motion`, `theme`, `ui`.

## Data layer

- **One contract** (`IVaultDatabase`): `get`, `find` (equality on indexed fields only), `put`, `delete`,
  `transaction`, blobs, `clearAll`, `close`. 26 stores for the 18 entity groups (`schema.ts`), with
  `INDEXED` and `UNIQUE` maps. `tests/storage-contract.test.ts` runs every assertion against both adapters
  (fake-indexeddb, and sql.js running the exact SQL the Android plugin executes).
- **StagedVault**: writes inside `transaction()` are staged in memory and applied as one atomic batch.
  IndexedDB auto-commits when a WebCrypto await yields, and the Capacitor bridge is async, so neither can
  keep a native transaction open across awaits. Reads inside a transaction see staged writes; nested
  calls join the outer batch, and the outer waits for every joined call before committing (Phase 9).
- **Web rows** are `id + HMAC index tags + AES-GCM(blob)` with AAD `arizo/rec/v1|<store>|<id>`.
- **SQL rows** are one table per store with `ix_*` columns, UNIQUE indexes and a JSON `data` column;
  `SQL_MIGRATIONS` are append-only.
- **Money** is `bigint` minor units everywhere, through a lossless JSON codec. No float touches a balance.
- **Attachments** are blobs outside the row stores (Dexie `blobs`, SQL `vault_blobs`), written before
  their row.

## Ledger

`src/core/ledger/ledger.ts` keeps `current_balance = initial + Σ effect(tx)` inside every mutation:
income, expense, signed adjustment, transfer pairs (`transfer_pair_id`, optional fee), splits whose sum
equals the parent, void, soft delete, restore, 30-day trash purge. `postLinkedTransaction` allows one live
transaction per linked obligation id (installment, cheque, recurring occurrence, invoice payment), which
makes catch-up and double taps idempotent. `verifyLedger` finds drift, orphans, broken pairs and split
mismatches, and can fix drift.

## Off the UI thread

| Worker | Work | Lifetime |
| --- | --- | --- |
| `crypto.worker` | Argon2id, key unwrap | Terminated on lock |
| `analytics.worker` | `computeAnalytics` over decrypted rows | Terminated on lock and wipe |
| `sms.worker` | `parseSms` batches (paste, history scan) | Terminated on lock |
| `backup.worker` | gzip + seal / open `.arizo`, snapshots | One-shot per job |
| `xlsx.worker` | exceljs (~0.9 MB, only loaded here) | One-shot per export |

Rows are decrypted on the thread that owns the database handle and sent to workers by structured clone
(bigint survives). Phase 9 measured 20,000 transactions: analytics 69–121 ms, 1,000 SMS 30–58 ms, ledger
scroll p95 16.8 ms (see `docs/security.md` §7).

## UI

Hash routes under `AppShell` (onboarding → lock screen → app). The ledger is virtualized with
`@tanstack/react-virtual`. Charts are hand-written SVG. All text goes through i18next (`fa.json`,
`en.json`, bundled), RTL/LTR by logical utilities, Jalali/Gregorian through `calendar.ts` in
`Asia/Tehran`. Locking clears the open vault from the store, which unmounts every screen, sheet and print
portal.

## Builds

- `npm run build`: production web build into `dist/` with the service worker; `console.*` dropped;
  `scripts/check-prod.mjs` guards it (no dev hooks, no source maps, CSP present, reviewed hosts only).
- `vite build --mode e2e`: same build plus cheap Argon2, the design gallery and the stress-test hooks,
  served for Playwright.
- `npx cap sync android` + `./gradlew assembleRelease`: R8-minified APK, signed when
  `android/keystore.properties` exists (`docs/distribution_fa.md`).
