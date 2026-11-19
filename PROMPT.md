# Arizo Manage — Final Master Engineering Prompt for Claude Code (v3.0 Unified)

> **How to use with Claude Code:**
> Save this file as `PROMPT.md` in an empty folder, open Claude Code in that folder, and run:
> *"Read PROMPT.md completely. Output your concise implementation plan and any risks, then execute Phase 0 only, verify the gate, and stop to report."*
> Then continue phase by phase: *"Continue with Phase N."*

> **Architecture Verdict:** Engineered specifically for **private distribution to friends & family (no App Store / no Google Play, no Mac required, no $99 Apple fee)** from a single codebase buildable on Windows, macOS, or Linux:
> - **Android (Native Signed `.apk`)**: Capacitor + audited custom Kotlin native plugins delivering background Bank SMS & Neo-Bank Notification capture (encrypted in a locked-state pending queue), hardware-backed SQLCipher AES-256 database, Android Keystore Biometrics (Class 3), `FLAG_SECURE`, native Android `PrintManager`, and optional 58mm/80mm ESC/POS Bluetooth thermal printing.
> - **iOS (100% Local-First Offline Standalone PWA)**: Installed permanently in 10 seconds via Safari → *Add to Home Screen* (**zero 7-day expiration**, zero Mac, zero backend database—static assets only), AES-256-GCM + Argon2id encrypted on-device vault, WebAuthn Face ID / Touch ID unlock, AirPrint vector RTL invoices, and zero-leakage `#` URL-fragment Apple Shortcuts SMS automation.

---

## 0. ROLE & MISSION

You are a **Principal Mobile & FinTech Architect, Staff TypeScript/React + Kotlin Android Engineer, Cryptography & Privacy Auditor, and Bespoke Product Designer**.

Your mission is to architect, design, build, test, and harden **Arizo Manage (آریزو منیجر)** — a luxury-grade, offline-first, zero-knowledge personal finance, wealth observatory, bank SMS intelligence, cheque & loan management, invoicing, and encrypted backup application for **Android (Private Signed APK)** and **iOS (Offline-First Standalone PWA)**.

**Primary language & locale:** Persian (`fa-IR`, `dir="rtl"`, **Jalali/Shamsi calendar**, Persian digits `۰-۹`, smart **Toman ↔ Rial** display toggle with Rial integer storage). **English** (`en-US`, `dir="ltr"`, Gregorian calendar, multi-currency) is a first-class secondary locale with instant runtime switching.

---

## 1. NON-NEGOTIABLE STANDARDS (Read Before Writing Any Code)

1. **Zero Placeholders & Zero Stubs:** Never ship `TODO` comments, fake buttons, hardcoded dummy charts, unimplemented print dialogs, or mock cryptography. Every feature in each delivered phase must work end-to-end with real persistence, real encryption, and real tests. If a platform restriction prevents something, explain it clearly and implement the strongest honest alternative.
2. **Zero Data Leakage & Strict Offline-First Privacy:**
   - **Zero Backend / Zero Telemetry:** NO backend server, NO analytics or crash SDKs (no Firebase, Sentry, GA, Mixpanel, PostHog), NO external font CDNs, NO external image fetches.
   - **Strict CSP:** Enforce `default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';` in `index.html`.
   - **Android Network Firewall:** In `MainActivity.kt`, intercept WebView requests in `shouldInterceptRequest` and strictly block/drop any external non-localhost URL; set `android:usesCleartextTraffic="false"` and a `network_security_config.xml` forbidding external connections. (All currency/gold exchange rates are **manual-entry offline assets** with rate history; no background API calls.)
   - **Privacy-by-Default Notifications:** Local notifications (cheques, installments, captured SMS, budgets) MUST display generic text by default (e.g., «تراکنش جدید ثبت شد» or «یادآور مالی») with **no amounts on the lock screen** unless the user explicitly opts in.
3. **Money Is NEVER a Floating-Point Number:** Store all monetary values as exact integer minor units (`BigInt` / safe integer minor units: Rial for IRR, cents for USD/EUR, milligrams for Gold). Never use IEEE-754 floating-point arithmetic for balances, taxes, splits, or totals.
4. **Do Not Hallucinate Bank Data:** Bank BINs and SMS templates must live in **data-driven JSON files** (`src/core/data/banks.json` & `sms-templates.json`). For bank SMS sender numbers you are not 100% certain of, leave them editable with `"verified": false` so the user can confirm/save senders dynamically when an SMS arrives.
5. **Never Log Sensitive Data:** `SecureLogger` is stripped in production and redacts 16-digit card numbers, Sheba/IBANs, amounts, PINs, keys, and SMS bodies even in dev mode.
6. **60/120fps Mobile Performance:** Offload Argon2id, AES-256-GCM encryption, historical SMS batch parsing, `.arizo` backup compression, and large analytics aggregations to dedicated **Web Workers** so the UI thread never drops frames, even with 20,000+ transactions.
7. **Strict Phased Delivery & Living Memory:** Execute **strictly one phase at a time** (Phase 0 → Phase 9). Maintain a living **`CLAUDE.md`** (architecture, tokens, security invariants, commands, decisions, phase status) updated at every phase. After each phase, pass all Verification Gates, commit with a conventional-commit message, report changes & manual device-test steps, and **stop for user approval**.

---

## 2. TECHNICAL STACK & DUAL-TARGET ARCHITECTURE

### 2.1 Locked Core Stack
- **UI & App Framework:** **React 19 + TypeScript (strict mode) + Vite 6**.
- **Styling:** **Tailwind CSS v4** with semantic CSS variables (`--arizo-*`) and logical CSS properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`) for zero-bug RTL/LTR mirroring.
- **Motion & Physics:** **Framer Motion** (damped springs, shared-element `layoutId` transitions, swipe gestures, `AnimatePresence`, honoring `prefers-reduced-motion`).
- **State:** **Zustand** (fine-grained selectors) + reactive encrypted data layer.
- **Routing:** **React Router v7 (`createHashRouter`)** — mandatory for static zero-server PWA hosting AND zero-leakage `#` URL-fragment iOS Shortcuts ingestion.
- **Native Android Container:** **Capacitor 6/7** (`@capacitor/core`, `@capacitor/android`, `@capacitor/haptics`, `@capacitor/app`, `@capacitor/share`, `@capacitor/filesystem`, `@capacitor/local-notifications`) + **Audited Custom Kotlin Plugins** in `android/app/src/main/java/com/arizo/manage/plugins/`.
- **Offline PWA Engine (iOS & Web):** `vite-plugin-pwa` (Workbox `generateSW`, precaching 100% of app shell, fonts, WASM, and icons for airplane-mode offline reliability; `registerType: 'prompt'` with in-app update banner).
- **Cryptography Engine:**
  - **`hash-wasm`** (WebAssembly Argon2id + SHA-256 in Web Worker).
  - **Web Crypto API (`crypto.subtle`)** (AES-256-GCM, HKDF-SHA256, CSPRNG) for iOS PWA vault, attachments, and `.arizo` backups.
  - **Android Native SQLCipher (`net.zetetic:sqlcipher-android`)** + **Android Keystore (StrongBox / TEE)** in Kotlin.
- **Database Abstraction (`IVaultDatabase`):**
  - **Android Native:** SQLite + **SQLCipher** (AES-256-CBC + HMAC-SHA512, `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, `PRAGMA secure_delete = ON`) via `ArizoSqlCipherPlugin.kt` with batched parameterized queries and migration tests.
  - **iOS PWA:** **Dexie.js (IndexedDB)** with **transparent AES-256-GCM record & blob encryption** (only non-sensitive UUIDs and opaque index keys in cleartext; all financial values, notes, card numbers, cheques, loans, invoices, SMS text, and attachments stored strictly as authenticated ciphertext).
  - Both adapters pass the **exact same repository contract test suite** and read/write the **exact same `.arizo` backup format**.
- **Charts & Visualizations:** Custom responsive SVG/Canvas visuals (including **Sankey Cashflow Diagram**, **Budget Burn-Rate Rings**, **Daily Heatmap**) + **ECharts** or **Recharts** with interactive touch-scrubbing crosshairs and haptic ticks.
- **Invoices, Statements & Printing:**
  - Calibrated **HTML/CSS Vector Print Templates** (`@media print` + `@page` A4/A5/Thermal) rendered via native CoreText (**iOS AirPrint**) and HarfBuzz (**Android `PrintManager`** via `ArizoPrintPlugin.kt`) — guaranteeing **100% crisp Persian RTL glyph shaping & ligatures**.
  - 3x DPR **Receipt PNG** (`html-to-image`), **Excel (`.xlsx` via `exceljs`)**, **UTF-8 BOM `.csv`**, and **CSV Import Wizard**.
  - **Optional Android ESC/POS Thermal Printer (58mm/80mm)** via `ArizoThermalPrintPlugin.kt` (Bluetooth/Wi-Fi TCP, permissions requested ONLY if enabled by user).
- **Calendars & Localization:** `jalaali-js` (exact Jalali/Shamsi ↔ Gregorian) + custom dual-calendar picker + `i18next` (`fa.json` default RTL, `en.json` LTR) + custom tested `numToPersianWords` utility (up to trillions).
- **Virtualization:** `@tanstack/react-virtual` (smooth 60/120fps scrolling over 20,000+ transactions).
- **Testing:** **Vitest** (unit, crypto, validators, accounting invariants, ≥ 80 SMS test vectors) + **Playwright** (mobile viewport `390x844` RTL & LTR E2E visual/flow verification).

### 2.2 Directory Structure
```text
arizo-manage/
├── CLAUDE.md                           # Living architecture, tokens, security invariants & phase tracker
├── docs/                               # architecture.md, security.md, sms_engine.md, distribution_fa.md
├── index.html                          # Strict CSP, iOS PWA meta tags, obsidian splash/theme-color
├── public/
│   ├── fonts/                          # Self-hosted Vazirmatn (400-800) + Plus Jakarta Sans (400-800)
│   ├── icons/                          # Adaptive Android icons + Apple Touch Icons + Maskable PWA icons
│   └── manifest.webmanifest
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx                     # Root Router, PrivacyCurtainGuard, AutoLockManager, Dir/Theme sync
│   │   ├── router.tsx                  # HashRouter with Framer Motion route transitions
│   │   └── stores/                     # Zustand stores (vault, settings, privacy, pendingSms)
│   ├── core/
│   │   ├── data/                       # banks.json (30+ Iranian/Intl banks), sms-templates.json (editable)
│   │   ├── theme/                      # Obsidian Atelier & Alabaster Vault CSS vars + 6 Bank Card finishes
│   │   ├── motion/                     # Spring presets, OdometerAmount, ParallaxCard, LiquidDock, Haptics
│   │   ├── crypto/                     # Web Worker (Argon2id, AES-256-GCM, HKDF, zeroize, .arizo codec)
│   │   ├── security/                   # AuthManager (Biometric/WebAuthn/PIN/Duress), Lockout, PrivacyShield
│   │   ├── storage/                    # IVaultDatabase, AndroidSqlCipherAdapter, WebEncryptedDexieAdapter, Migrations
│   │   ├── currency/                   # Exact BigInt/Int64 minor-unit math, Rial<->Toman, numToPersianWords
│   │   ├── validators/                 # Luhn card, Sheba (IR+24 mod-97), Iranian National ID, 16-digit Sayad ID
│   │   ├── calendar/                   # Jalali & Gregorian unified utilities & dual date picker
│   │   ├── bridge/                     # Typed TS wrappers for Android Kotlin Plugins + iOS PWA fallbacks
│   │   ├── i18n/                       # fa.json & en.json complete translations
│   │   └── utils/                      # SecureLogger (stripped in prod + redaction), UUIDv7, demoDataGenerator
│   └── features/
│       ├── vault-lock/                 # Biometric / WebAuthn / Luxury PIN / Duress PIN & Guided Onboarding
│       ├── dashboard/                  # Command Center, Odometer Net Worth, 3D Card Stack, Upcoming Obligations
│       ├── accounts/                   # Bank Accounts, Cash, Savings Vaults, Multi-Currency/Gold Assets
│       ├── transactions/               # Virtualized Ledger, Filters, Calculator Keypad, Splits, Recurring, Trash
│       ├── cheques/                    # Issued/Received Cheques, 16-digit Sayad ID, Calendar, Reminders, Auto-Clear
│       ├── loans/                      # Loans & Installments Schedule, Progress Rings, Overdue Alerts, Auto-Pay
│       ├── debts/                      # People Ledger, Debts & Receivables, Partial Settlements, Reminders
│       ├── sms-intelligence/           # Bilingual SMS Parser (Worker), OTP Firewall, Review Queue, Teach-the-Parser, Regex Studio, Wizards
│       ├── analytics/                  # Net Worth Spline, Cashflow Bars, Drilldown Donut, Sankey Flow, Heatmap, Budgets, Goals, Insights
│       ├── invoices-printing/          # Official/Modern/Thermal Invoice Builder, Receipts, Statements, Print/PNG/Excel/CSV
│       ├── backup-restore/             # Zero-Knowledge .arizo Export/Import, 24-Word Key, Dry-Run, Merge/Replace
│       └── settings/                   # Security Center, Theme, Language, Calendar, Categories, Data Management
├── android/app/src/main/java/com/arizo/manage/
│   ├── MainActivity.kt                 # FLAG_SECURE, WebView network firewall, edge-to-edge obsidian bars
│   └── plugins/
│       ├── ArizoSecurityPlugin.kt      # Keystore DEK, BiometricPrompt Class 3, RSA/Hybrid Pending-Queue Key, FLAG_SECURE, Sensitive Clipboard
│       ├── ArizoSqlCipherPlugin.kt     # Hardware-keyed SQLCipher DB engine (WAL, secure_delete, foreign_keys)
│       ├── ArizoSmsPlugin.kt           # BankSmsReceiver (sealed queue), BankNotificationListener, Historical Scanner, AppInfo Intent
│       ├── ArizoPrintPlugin.kt         # Native Android PrintManager PDF adapter
│       └── ArizoThermalPrintPlugin.kt  # Optional Bluetooth/TCP ESC/POS 58mm/80mm printer
└── tests/
    ├── validators-and-words.test.ts    # Luhn, Sheba mod-97, National ID, Sayad ID, numToPersianWords
    ├── sms-parser.test.ts              # ≥ 80 Persian & English bank SMS + OTP + spam + dedupe test vectors
    ├── crypto-backup.test.ts           # Argon2id, AES-256-GCM tamper detection, .arizo round-trip
    ├── ledger-invariants.test.ts       # Double-entry transfers, splits, cheques/loans auto-posting, BigInt math
    └── e2e/mobile-rtl-ltr.spec.ts      # Playwright mobile viewport verification in Persian RTL & English LTR
```

---

## 3. BESPOKE DESIGN SYSTEM, COLOR ARCHITECTURE & MOTION

### 3.1 Visual Identity — "Private Wealth Observatory"
Arizo Manage must feel like a **bespoke Swiss private-banking instrument fused with fluid tactile craft**: deep obsidian surfaces, crisp 1px specular borders, generous whitespace, ultra-legible tabular figures, and bioluminescent emerald & champagne gold accents. **Forbid generic blue templates or clichéd purple SaaS gradients.**

### 3.2 Exact Color Tokens

#### Theme A (Signature Default): **Obsidian Atelier (Dark Mode)**
| Token | Value | Usage |
| :--- | :--- | :--- |
| `--bg-canvas` | `#06080D` | Deep Obsidian Void app canvas |
| `--surface-1` | `#0D111A` | Smoked Carbon primary cards & ledger containers |
| `--surface-2` | `#141B29` | Midnight Slate modals, bottom sheets, floating dock |
| `--surface-3` | `#1C2538` | Inputs, chips, active pills, calculator keypad keys |
| `--border-subtle` | `rgba(255,255,255,0.06)` | Hairline structural borders |
| `--border-highlight` | `rgba(255,255,255,0.14)` | Specular top-edge highlight on glass/cards |
| `--accent-primary` | `#00D69F` | Bioluminescent Emerald — inflow, growth, primary CTA |
| `--accent-primary-glow` | `rgba(0,214,159,0.14)` | Subtle emerald aura / positive pill fill |
| `--accent-luxury` | `#E6C47A` | Brushed Champagne Gold — Net Worth, Vaults, Goals |
| `--accent-outflow` | `#FF5C7A` | Velvet Coral — expenses, overdue cheques/loans, destructive |
| `--accent-info` | `#4DA6FF` | Glacier Azure — transfers, analytics, SMS badge |
| `--accent-warning` | `#FFB547` | Warm Amber — upcoming obligations, budget warnings, SMS review |
| `--text-primary` | `#F4F7FB` | Crisp Ice White — balances, headings |
| `--text-secondary` | `#8E9BB0` | Cool Pewter — metadata, timestamps |
| `--text-muted` | `#56637A` | Placeholders, disabled labels |

#### Theme B: **Alabaster Vault (Light Mode)**
`--bg-canvas: #F4F6FA`, `--surface-1: #FFFFFF`, `--surface-2: #EDF1F7`, `--surface-3: #E2E8F0`, `--border-subtle: rgba(15,23,42,0.07)`, `--accent-primary: #009970`, `--accent-luxury: #B8892D`, `--accent-outflow: #DF3B57`, `--accent-info: #1D7BE5`, `--accent-warning: #D9820B`, `--text-primary: #0B1221`, `--text-secondary: #526077`, `--text-muted: #8A97AC`. (All pairs must satisfy **WCAG AA**.)

#### 6 Procedural Virtual Bank Card Finishes (User-Selectable per Account)
CSS/SVG mesh gradient + subtle SVG noise grain + diagonal specular rim:
1. **Obsidian Carbon** (`#0F141F → #1B2436`, `#00D69F` sheen)
2. **Emerald Silk** (`#062E26 → #0D5C4B`, `#E6C47A` gold ink)
3. **Champagne Titanium** (`#2B2418 → #5E4B2B`, brushed gold shimmer)
4. **Midnight Sapphire** (`#0A1931 → #1B3B6F`, glacier azure rim)
5. **Velvet Burgundy** (`#2C0E1B → #591B33`, rose gold accent)
6. **Alabaster Pearl** (`#E8EDF5 → #CFD8E6`, obsidian ink)

### 3.3 Typography & Numerical Ergonomics
- Self-hosted **`Vazirmatn`** (400–800) for Persian and **`Plus Jakarta Sans`** (400–800) for English in `public/fonts/`.
- Apply `font-variant-numeric: tabular-nums` to EVERY monetary figure, KPI, chart axis, and invoice table.
- Gracefully auto-scale large Iranian numbers up to 15 digits (e.g. `۱۲,۴۵۰,۰۰۰,۰۰۰ ریال`) via `clamp()` — never clip or awkwardly truncate primary balances.
- **Live Amount in Persian Words:** Display real-time Persian words beneath the numeric input in the transaction keypad (e.g., «یک میلیون و دویست و پنجاه هزار تومان») and automatically print total-in-words («مبلغ به حروف») on official invoices.

### 3.4 Signature Motion & Micro-Interactions
Respect `prefers-reduced-motion` globally:
1. **Odometer Rolling Counter (`ArizoOdometerAmount`)**: Damped spring digit transitions (`stiffness: 320, damping: 28, mass: 0.9`) when balances update or Toman↔Rial toggles.
2. **3D Specular Virtual Bank Cards (`ArizoParallaxCard`)**: Horizontal swipe deck + subtle pointer/drag tilt (±7°) + moving specular sheen; tapping performs a **Framer Motion `layoutId` hero morph** into the Account Detail header.
3. **Liquid Frosted Floating Dock**: Glass pill (`backdrop-filter: blur(20px)`, `env(safe-area-inset-bottom)`) with 4 primary tabs (`Home`, `Ledger`, `Analytics`, `More/Tools`) + glowing central **Morphing `+` Orb** (tap opens Instant Entry Sheet in <150ms; long-press opens radial quick actions: *Expense · Income · Transfer · Cheque · Invoice · Paste SMS*).
4. **Interactive Chart Scrubbing + Haptics**: Dragging across charts displays a vertical crosshair + glass tooltip + `Haptics.selectionChanged()` ticks on Android.
5. **Global Privacy Stealth Blur**: Header Eye icon smoothly blurs (`filter: blur(10px)`) all monetary values across the entire app.
6. **Elastic Swipe-Action Rows**: Swipe transaction rows for Edit, Receipt, Duplicate, or Delete (soft-delete to 30-day Trash with 5-second Undo toast).

---

## 4. DATA SCHEMA & EXACT ACCOUNTING INVARIANTS

All IDs use **UUIDv7** (time-sortable); timestamps use UTC epoch milliseconds; all tables include `created_at`, `updated_at`, and `deleted_at` (soft delete where applicable); **all amounts use exact integer minor units (`BigInt` / safe Int64)**.

### 4.1 Core Entities (18 Tables / Stores)
1. **`accounts`**: `id`, `name`, `type` (`bank_card`, `bank_account`, `cash`, `savings_vault`, `investment`, `crypto`, `gold`, `wallet`), `bank_code`, `card_last4`, `card_number_enc`, `account_number`, `iban_sheba`, `currency_code` (`IRR`, `USD`, `EUR`, `AED`, `GBP`, `USDT`, `GOLD_GRAM`, `COIN`), `initial_balance_minor`, `current_balance_minor`, `card_finish`, `is_included_in_net_worth`, `is_archived`, `sort_order`, `notes`.
2. **`categories`**: `id`, `parent_id`, `name_fa`, `name_en`, `type` (`income`, `expense`, `transfer`), `icon_name`, `color_hex`, `is_system`, `sort_order`. (Seed rich Persian/English defaults: خوراک و رستوران، سوپرمارکت، حمل‌ونقل، سوخت، قبوض، اجاره و مسکن، اقساط و وام، درمان، آموزش، پوشاک، اینترنت و موبایل، تفریح، سفر، هدیه، خیریه، کارمزد بانکی، حقوق، درآمد کسب‌وکار، سود سپرده، سایر).
3. **`transactions`**: `id`, `account_id`, `transfer_pair_id`, `counterparty_account_id`, `type` (`income`, `expense`, `transfer_out`, `transfer_in`, `adjustment`), `amount_minor` (positive), `currency_code`, `exchange_rate_to_base_ppm`, `category_id`, `merchant_name`, `note`, `occurred_at`, `source` (`manual`, `sms_auto`, `notification_auto`, `ios_shortcut`, `paste_parse`, `recurring`, `invoice`, `cheque`, `loan`, `debt`, `csv_import`), `external_ref_code`, `sms_fingerprint_sha256` (UNIQUE nullable), `reported_balance_after_minor`, `linked_entity_type`, `linked_entity_id`, `status` (`posted`, `pending_review`, `voided`).
4. **`transaction_splits`**: `id`, `transaction_id`, `category_id`, `amount_minor`, `note` (invariant: sum === parent `amount_minor`).
5. **`tags` & `transaction_tags`**: Multi-tagging (`#شخصی`, `#کاری`, `#مالیات`, etc.).
6. **`attachments`**: `id`, `owner_type`, `owner_id`, `encrypted_blob_key`, `nonce_b64`, `mime_type`, `original_size_bytes`, `sha256_hash`.
7. **`cheques`** *(Critical Iranian Module)*: `id`, `direction` (`issued`, `received`), `cheque_number`, `sayad_id` (16-digit validated), `bank_code`, `amount_minor`, `currency_code`, `due_date_at`, `counterparty_name`, `account_id`, `status` (`pending`, `cleared`, `bounced`, `cancelled`, `transferred`), `linked_tx_id`, `reminder_days_json` (`[3, 1, 0]`), `notes`.
8. **`loans` & `loan_installments`** *(Critical Iranian Module)*:
   - `loans`: `id`, `title`, `lender_name`, `principal_minor`, `interest_rate_bps`, `installment_count`, `installment_amount_minor`, `start_date_at`, `account_id`, `currency_code`, `notes`, `status` (`active`, `paid_off`).
   - `loan_installments`: `id`, `loan_id`, `sequence_no`, `due_date_at`, `amount_minor`, `status` (`upcoming`, `paid`, `overdue`), `paid_at`, `paid_tx_id`.
9. **`people`, `debts_receivables` & `debt_settlements`**: Person profiles (local only, no contacts permission required), lend/borrow ledger, partial repayments linked to accounts, due date reminders, per-person net balance.
10. **`budgets`**: `id`, `category_id` (null = overall), `period` (`weekly`, `monthly_jalali`, `monthly_gregorian`, `custom`), `limit_minor`, `currency_code`, `alert_thresholds_json` (`[50, 80, 100]`), `rollover_unused`, `is_active`.
11. **`savings_goals`**: `id`, `name`, `target_minor`, `current_minor`, `currency_code`, `linked_account_id`, `deadline_at`, `icon_name`, `color_hex`.
12. **`recurring_rules`**: `id`, `title`, `type`, `account_id`, `category_id`, `amount_minor`, `currency_code`, `cadence` (`daily`, `weekly`, `monthly_jalali`, `monthly_gregorian`, `yearly`), `day_of_period`, `next_run_at`, `auto_post`, `is_active`.
13. **`sms_parser_rules`**: `id`, `name`, `bank_code`, `sender_patterns_json`, `body_regex`, `type_hint`, `field_map_json`, `unit_hint` (`irr`, `irt`, `auto`), `priority`, `is_custom`, `verified`, `is_enabled`.
14. **`merchant_category_memory`**: `normalized_merchant` (PK), `category_id`, `hit_count`, `updated_at`.
15. **`business_profile`, `customers`, `products`, `invoices` & `invoice_items`**: Seller profile (name, Iranian National ID/Economic Code validated, address, phone, encrypted logo & signature), customer/product catalogs, auto-numbered invoices (`ARZ-1405-0001`), line items, discount, VAT (default 10%, configurable), payment status (`draft`, `unpaid`, `partial`, `paid`), linked income transaction.
16. **`exchange_rates`**: Manual offline rates (`base_currency`, `quote_currency`, `rate_ppm`, `effective_at`) with rate history.
17. **`settings`**: Typed local preferences.
18. **`app_audit_log`**: Local security audit log (`unlock`, `failed_pin`, `duress_triggered`, `backup_created`, `backup_restored`, `sms_rule_changed`) — zero amounts or PII.

### 4.2 Mandatory Accounting Invariants
- **Atomic Balance Integrity:** Every transaction create/edit/void/restore atomically updates `accounts.current_balance_minor`. Include a 1-tap **"Verify & Recalculate Ledger Integrity"** tool in Settings.
- **Double-Entry Transfers:** Internal transfers write a linked pair (`transfer_out` + `transfer_in`, sharing `transfer_pair_id`, optional fee tx) and are strictly excluded from Income/Expense KPIs.
- **Obligation Settlement Automation:** Clearing a Cheque (`cleared`), marking a Loan Installment paid, settling a Debt, or marking an Invoice `paid` automatically generates the linked transaction (with 1-tap option to customize account/date) and prevents double-posting.

---

## 5. MILITARY-GRADE SECURITY & ZERO-LEAKAGE ARCHITECTURE

### 5.1 Encryption at Rest & Locked-State SMS Queue
- **Android Native APK:**
  - Generate a 256-bit random **DEK** via `SecureRandom`, wrapped with **Android Keystore (`AES/GCM/NoPadding`, StrongBox/TEE)** inside `ArizoSecurityPlugin.kt`.
  - Pass the unwrapped DEK in native memory to **SQLCipher** (`PRAGMA key = "x'...'"`, assert `PRAGMA cipher_version` non-empty on every open, `PRAGMA secure_delete = ON`).
  - **Asymmetric Sealed Pending-SMS Queue:** Generate a Keystore RSA-OAEP (or hybrid AES-256-GCM + Keystore public key) keypair so `BankSmsReceiver.kt` and `BankNotificationListener.kt` can **encrypt captured SMS in the background while the app is locked or killed without ever touching the DEK or opening the DB**. Pending encrypted queue items are decrypted and processed only after user authentication!
  - Encrypt all attachments (receipts, logos, signatures) with **AES-256-GCM** (unique 96-bit nonce per file) in `filesDir/vault_blobs/`.
- **iOS Offline PWA:**
  - Derive a 256-bit Master Key from the user's Master PIN/Passphrase using **Argon2id** (`hash-wasm`, `m=65536 KiB`, `t=3`, `p=1`, random 16-byte salt) inside a **Web Worker**.
  - Encrypt every record payload and attachment blob with **AES-256-GCM** (`crypto.subtle`) before storing in IndexedDB (`Dexie`). Keep the unlocked `CryptoKey` strictly non-extractable in RAM and wipe immediately on lock/background.
  - Call `navigator.storage.persist()` during onboarding and show a clear backup health badge in the Security Center.

### 5.2 Authentication, Biometrics & Duress Vault
- **Android APK:** Native **`BiometricPrompt` (BIOMETRIC_STRONG / Class 3)** bound to Keystore unlock + fallback to 6–8 digit Argon2id Master PIN. New biometric enrollment invalidation safely falls back to PIN and re-wraps.
- **iOS PWA:** **WebAuthn / Passkey Face ID & Touch ID** (`userVerification: 'required'`, platform authenticator) + fallback to 6–8 digit Argon2id Master PIN.
- **Optional Duress / Decoy Vault PIN:** Entering a configured secondary Decoy PIN opens a believable decoy vault with minimal everyday data, concealing real net worth and accounts.
- **Brute-Force Exponential Lockout:** 5 failures → 30s; 8 → 5m; 10 → 15m; optional user-enabled data wipe after 15 consecutive failures (OFF by default with explicit warning).
- **Auto-Lock & Re-Authentication:** Configurable auto-lock (`Immediate`, `15s`, `1m`, `5m`); instant Privacy Curtain blur on `visibilitychange` (iOS/Web) and `onPause` (Android). Require re-auth for revealing full card number/Sheba, creating/restoring backups, exporting data, and changing security settings.

### 5.3 Platform Hardening Checklist
- **Android:** `FLAG_SECURE` ON by default (with optional temporary 2-minute screenshot toggle), `android:allowBackup="false"`, `android:fullBackupContent="false"`, `dataExtractionRules` excluding all files, `usesCleartextTraffic="false"`, WebView external-request firewall, R8/ProGuard obfuscation, sensitive clipboard auto-clear (`EXTRA_IS_SENSITIVE = true` + 45s auto-clear).
- **iOS PWA:** Strict CSP, zero-leakage `#/sms-ingest?d=...` URL fragment wiped immediately via `history.replaceState`, privacy curtain overlay, clipboard auto-clear where supported.
- **Memory Hygiene:** Zeroize (`buf.fill(0)`) typed arrays containing passphrases or raw keys immediately after use; close SQLCipher DB on lock.

---

## 6. SMART BANK SMS & NOTIFICATION INTELLIGENCE ENGINE

### 6.1 Dual-Platform Ingestion Pipeline
1. **Android Native APK (Full Automatic Background Capture):**
   - **`BankSmsReceiver.kt` (`SMS_RECEIVED`)**: Runs even when app is killed; applies fast native OTP firewall → encrypts matched SMS into the sealed pending queue → posts a **privacy-safe generic local notification**.
   - **`BankNotificationListener.kt` (`NotificationListenerService`)**: Captures push alerts from Iranian neo-banks & international banks (**BluBank, Wepod, Bankino, Revolut, Wise**, etc.) strictly filtered to user-selected bank packages!
   - **Opt-In Historical Inbox Scanner**: Scans user-chosen date range (30 / 90 / 365 days) & banks in a background coroutine/worker with progress bar, deduplication, and batch confirmation.
   - **Android 13+ Restricted Settings Wizard**: Illustrated 2-step guide with a 1-tap **"Open App Info"** button (`Settings.ACTION_APPLICATION_DETAILS_SETTINGS`) so friends & family enable SMS/Notification permissions on sideloaded APKs in 15 seconds.
2. **iOS PWA (Zero App Store, Zero Server Leakage):**
   - **30-Second Apple Shortcuts Personal Automation Visual Wizard**: Step-by-step illustrated Persian/English guide inside Arizo's SMS Center:
     - Trigger: *When I get a message containing `برداشت` / `واریز` / `مانده` / `debited` / `credited`* (set to *Run Immediately* on iOS 17+).
     - Action: *Base64 Encode Message → Open URL `https://<arizo-host>/#/sms-ingest?d=<Encoded>`* (processed 100% locally in client-side hash fragment; never transmitted to any server per RFC 3986; hash immediately cleared!).
   - **Smart Paste & Multi-SMS Bulk Importer**: Available on both platforms; optional clipboard bank-SMS detector (asks permission before importing).

### 6.2 Bilingual Pure-TypeScript SMS Parser (`SmsParserEngine` — Web Worker)
1. **Stage 1 — Hard OTP & Spam Security Firewall (RUNS FIRST):** Immediately discard and NEVER persist any SMS matching OTP/2FA keywords (`رمز پویا`, `رمز دوم`, `رمز یکبار مصرف`, `کد تایید`, `کد احراز`, `ورود به`, `OTP`, `verification code`, `2FA`, `CVV2`) or promotional spam (`جایزه`, `قرعه کشی`, `تخفیف ویژه`, `برنده`, `promo`).
2. **Stage 2 — Normalizer:** Convert Persian (`۰-۹`) & Arabic (`٠-٩`) digits → ASCII `0-9`; unify `ي→ی` / `ك→ک`; strip ZWNJ/RLM/LRM/tatweel; normalize commas/signs (including trailing minus like `2,000,000-`).
3. **Stage 3 — Data-Driven Templates (`banks.json` & `sms-templates.json`):** Cover 30+ Iranian banks (ملی، ملت، صادرات، تجارت، سپه، پاسارگاد، سامان، پارسیان، کشاورزی، مسکن، رفاه، آینده، اقتصاد نوین، شهر، رسالت، پست بانک، سینا، کارآفرین، دی، خاورمیانه، سرمایه، گردشگری، توسعه تعاون، ایران زمین، مهر ایران، ملل، بلو، ویپاد، بانکینو) + international banks (Chase, BofA, Citi, HSBC, Revolut, Wise, Emirates NBD) + **Generic Heuristic Fallback Parser** (keyword proximity scoring + rejecting 16-digit card numbers, dates, times, and reference IDs as amounts).
4. **Stage 4 — Extraction, Confidence & Deduplication:** Extract `direction`, `amount_minor`, `currency_code` (explicit `ریال`/`تومان`/`$`/`€`/`AED` or bank default), `balance_after_minor`, `account_or_card_suffix`, `occurred_at` (Jalali date parsing), `merchant_name`, `reference_no`, `channel`, and `confidence (0–1)`. Suppress SMS + Push duplicates via SHA-256 fingerprint + `(bank, amount, timestamp ±2min, balance)` check.
5. **Stage 5 — Auto-Categorization & Balance Reconciliation:** Local learning via `merchant_category_memory` + rich Persian/English merchant map (`اسنپ`, `تپسی`, `دیجی‌کالا`, `اسنپ‌فود`, `قبض`, `همراه اول`, `ایرانسل`, `Uber`, `Amazon`). Compare `balance_after_minor` against calculated account balance and show a 1-tap **"Adjust Balance"** reconciliation badge on drift.
6. **Stage 6 — "Teach the Parser" + Custom Regex Studio:** On any failed or low-confidence SMS, allow the user to **tap the amount, balance, and card suffix directly in the message text** to auto-generate a regex template anchored on surrounding keywords, preview matches against past SMS, and save—plus a full Custom Regex Studio for power users.

### 6.3 Mandatory Automated SMS Test Suite (≥ 80 Vitest Vectors)
Include ≥ 80 synthetic test vectors in `tests/sms-fixtures/` covering Iranian traditional banks, neo-banks (BluBank/Wepod), trailing-minus formats, Rial vs Toman, missing balance, multi-line formats, English international banks, **strict OTP rejection (must NEVER persist)**, promotional spam rejection, duplicate SMS+Push suppression, and balance-drift reconciliation.

---

## 7. SCREEN-BY-SCREEN FEATURE BLUEPRINT

1. **Vault Lock & Guided Onboarding:** Obsidian vault gate, auto Biometric/Face ID prompt, luxury tactile PIN pad, exponential lockout; onboarding sets Language (`فارسی/EN`), Calendar (`شمسی/Gregorian`), Display Unit (`تومان/ریال/USD`), Master PIN + Biometrics, Backup Passphrase warning, Platform SMS Wizard (Android 13+ or iOS Shortcuts), and First Account (with BIN auto-detect).
2. **Command Center (Dashboard):**
   - Header: Security Shield, Global Privacy Blur (Eye), SMS Pending Review Badge, Settings.
   - **Net Worth Hero:** Champagne-gold accent, Odometer rolling digits, 1-tap `تومان ↔ ریال` toggle, monthly cashflow delta, Income vs Expense ratio bar.
   - **3D Virtual Bank Card Stack:** Swipeable deck with BIN-matched emblems, 1-tap Copy Card/Sheba (45s sensitive auto-clear), Hero morph to Account Detail.
   - **Upcoming Obligations Strip:** Next 14 days of **Cheques (چک‌ها)**, **Loan Installments (اقساط)**, **Debts**, and **Recurring Bills** with 1-tap settle/pay.
   - **Quick Actions**, **On-Device Pulse Insights**, **Budgets Snapshot**, and **Recent Transactions Stream**.
3. **Accounts, Assets & Net Worth:** Bank cards/accounts (with Luhn + Sheba mod-97 validators & 30+ Iranian BIN auto-detection), Cash, Savings Vaults, Multi-Currency/Gold/Coin manual-rate assets (with rate history), Account Detail with balance reconciliation & statement export.
4. **Transactions & Lightning Entry Sheet:**
   - Morphing bottom sheet (<150ms) with **Built-in Calculator Keypad** (`+`, `−`, `×`, `÷`, dedicated **`000`** key), **live Persian amount-in-words**, Toman/Rial toggle, smart category chips, Split Transactions, Dual Jalali/Gregorian picker, Encrypted Receipt attachment, Tags, Recurring toggle.
   - Virtualized Ledger grouped by Jalali/Gregorian day with daily totals, deep search & multi-filter, multi-select bulk actions, and 30-day Soft-Delete Trash.
5. **Cheques (چک), Loans (وام و اقساط) & Debts (طلب و بدهی):**
   - **Cheques:** Issued/Received tabs, 16-digit Sayad ID validator, Jalali calendar & timeline, total exposure KPI, customizable reminders (3d/1d/0d), status transitions (`cleared` auto-posts linked transaction).
   - **Loans:** Lender, principal, profit rate, auto-generated Jalali/Gregorian installment schedule, progress ring, overdue highlighting, 1-tap "Pay Installment" (auto-posts transaction).
   - **Debts & People:** Local people directory, lend/borrow balances, partial settlements, reminders.
6. **Graphical Analytics, Budgets & Goals:**
   - Exact **Jalali month** or Gregorian month period switcher.
   - **Net Worth Trajectory Spline** (touch-scrubbing + haptics), **Cashflow Grouped Bars + Savings Line**, **Interactive Drill-Down Category Donut**, **Sankey Cashflow Diagram** (Income Sources → Accounts → Expense Categories), **Daily Spending Heatmap Calendar**.
   - **Budget Burn-Rate Rings** ("safe to spend per day" + rollover + alerts), **Savings Goals**, **Financial Health Score (0–100)**, **Subscription Detector**, and **Offline Rule-Based Insights** (e.g., «هزینه رستوران این ماه ۳۵٪ بیشتر از میانگین سه ماه اخیر است»).
7. **Invoice Studio, Receipts & Statements:**
   - **Invoice Builder (فاکتور / پیش‌فاکتور):** Business profile (National ID/Economic Code checksum, encrypted logo & touch signature canvas), Customers & Products catalogs, auto-numbering (`ARZ-1405-0042`), line items, discount, configurable VAT (default 10%), **Total in Persian Words**, QR summary code, payment status + 1-tap "Post Payment to Account".
   - **Templates:** **Minimal Modern**, **Classic Official (رسمی)**, **Bold Brand** — A4, A5, and **58mm/80mm Thermal Receipt** layouts.
   - **Instant Transaction Receipt** (printable + 3x PNG share) & **Multi-Page Bank Statements** (opening/closing balance, running balance table, chart snapshot).
   - **Export & Import:** Native Android `PrintManager`, iOS AirPrint, optional Android ESC/POS Thermal Printer, `.xlsx`, UTF-8 BOM `.csv`, and **CSV Import Wizard** with column mapping.
8. **Zero-Knowledge Encrypted Backup & Restore (`.arizo`):**
   - Cross-platform binary envelope (`ARZO` magic + version + Argon2id params/salt + AES-256-GCM nonce/tag + gzipped DB snapshot + encrypted attachments + manifest) working identically across **Android APK ↔ iOS PWA**.
   - Passphrase strength meter + printable **24-Word Recovery Key** option + explicit "no backdoor / unrecoverable if lost" warning.
   - **Dry-Run Restore Preview** + **Full Replace (with automatic pre-restore safety snapshot)** OR **Smart Merge (UUID dedup)** + rolling local auto-snapshots + backup reminders.
9. **Settings & Security Center:** Security posture scorecard (encryption active, biometrics status, last backup, storage persistence), Air-Gapped status, Appearance, Language, Calendar, Display Currency, Categories, Banks & SMS Rules, Notifications, Ledger Integrity Check, Demo Data Seeder (dev/testing), Wipe All Data.

---

## 8. MANDATORY PHASED EXECUTION PLAN (Stop & Report After Each Phase)

Execute **strictly in order from Phase 0 to Phase 9**. Before starting each phase, list the files you will create/modify. At the end of each phase, run its **Verification Gate**, commit to git, list manual test steps, and **STOP for user review**.

- **Phase 0 — Bootstrap, Strict CSP, PWA Config, Capacitor Android & `CLAUDE.md`**
  - Scaffold Vite 6 + React 19 + TypeScript (strict) + Tailwind v4 + Framer Motion + Vitest + Playwright + Capacitor Android (`com.arizo.manage`).
  - Bundle self-hosted `Vazirmatn` & `Plus Jakarta Sans`; configure `vite-plugin-pwa`, iOS standalone meta tags, strict CSP, and `CLAUDE.md` + `docs/` skeleton.
  - **Gate:** `npm run typecheck && npm run build` passes with 0 errors; `npx cap sync android` clean.

- **Phase 1 — Crypto Worker, Security Vault, Dual DB Layer & Android Native Security/SQLCipher**
  - Implement Web Worker crypto engine (`Argon2id`, `AES-256-GCM`, `HKDF`, zeroization) and `WebEncryptedDexieAdapter`.
  - Implement Kotlin `MainActivity.kt` (`FLAG_SECURE`, WebView external-request firewall), `ArizoSecurityPlugin.kt` (Keystore DEK, `BiometricPrompt` Class 3, asymmetric pending-queue keypair, sensitive clipboard), `ArizoSqlCipherPlugin.kt` (`SQLCipher`, WAL, `secure_delete`, `PRAGMA cipher_version` assertion), and `AndroidSqlCipherAdapter`.
  - Implement all 18-entity schemas, migrations, repositories, atomic double-entry balance engine, Iranian validators (Luhn, Sheba mod-97, National ID, Sayad ID), `numToPersianWords`, seed categories, and `banks.json`.
  - **Gate:** Vitest suites for crypto, tamper rejection, validators, Persian words, and double-entry invariants pass 100%.

- **Phase 2 — Bespoke Design System, Localization, Dual Calendar & Motion Primitives**
  - Build **Obsidian Atelier** & **Alabaster Vault** themes, 6 procedural bank card finishes, `ArizoOdometerAmount`, `ArizoParallaxCard`, `LiquidGlassDock`, `PrivacyBlurWrapper`, `TactileCalculatorKeypad` (with live Persian words & `000` key), Jalali/Gregorian dual date picker, `fa.json`/`en.json`, and a dev-only Design Gallery route.
  - **Gate:** `npm run typecheck` clean + Playwright verifies mobile viewport (`390x844`) in `fa` (RTL) and `en` (LTR) with zero horizontal overflow.

- **Phase 3 — Vault Lock, Onboarding, Dashboard, Accounts & Virtualized Manual Ledger**
  - Build Vault Lock (Biometric/WebAuthn + PIN + Duress PIN + exponential lockout), Guided Onboarding, Command Center Dashboard (Hero-morphed 3D cards), Accounts/Assets/Multi-Currency CRUD, Lightning Manual Entry, Split Transactions, Virtualized Searchable Ledger, 30-day Trash, Recurring Engine, and realistic Persian Demo Data Seeder.
  - **Gate:** Typecheck + Vitest repository/split/recurring tests + Playwright core user journey green.

- **Phase 4 — Iranian Obligations Suite: Cheques (چک صیادی), Loans & Installments (وام و اقساط), Debts & Local Reminders**
  - Build complete Cheques module (16-digit Sayad validation, calendar/timeline, status workflow, auto-clear transaction), Loans & Installments module (schedule generator, overdue alerts, auto-pay transaction), People & Debts module (partial settlements), Upcoming Obligations dashboard integration, and privacy-safe local notification scheduling.
  - **Gate:** Vitest tests for Sayad validation, loan schedules, cheque/installment/debt atomic transaction creation, and reminder scheduling pass 100%.

- **Phase 5 — Smart Bank SMS & Notification Intelligence Engine**
  - Implement Worker `SmsParserEngine` (OTP & spam firewall, normalizer, 30+ data-driven templates, generic heuristic fallback, dedup, merchant learning, balance reconciler), Review Queue UI, Bulk Paste & Parse, **"Teach the Parser"** visual tap-to-regex flow, and Custom Regex Studio.
  - Implement Android Kotlin `ArizoSmsPlugin.kt` (`BankSmsReceiver` with sealed encrypted pending queue, `BankNotificationListener`, Historical Scanner, Android 13+ Restricted Settings AppInfo wizard).
  - Implement iOS PWA `#/sms-ingest` zero-leakage fragment handler (instant `history.replaceState` wipe) + illustrated 30-second Apple Shortcuts wizard.
  - **Gate:** **≥ 80 Vitest SMS parser vectors** (Iranian banks, neo-banks, English banks, strict OTP rejection, spam rejection, dedup, balance drift) pass 100%.

- **Phase 6 — Graphical Analytics, Budgets, Goals & Offline Insights**
  - Build Net Worth Spline (scrubbing + haptics), Cashflow Bars+Delta, Drilldown Category Donut, **Sankey Cashflow Diagram**, Daily Spending Heatmap, Budget Burn-Rate Rings + velocity predictor, Savings Goals, Financial Health Score (0–100), Subscription Detector, and Offline Persian/English Insights Engine (all computed in Worker).
  - **Gate:** Vitest tests for Jalali/Gregorian boundary math, Health Score, and budget velocity pass; Playwright renders analytics cleanly in RTL/LTR.

- **Phase 7 — Invoice Studio, Statements, Multi-Target Printing & CSV/Excel**
  - Build Invoice Builder (Official/Modern/Bold/Thermal templates, business profile, encrypted logo & touch signature canvas, customers/products, VAT/discount, Persian total-in-words, QR code, ledger payment link), Instant Transaction Receipt (3x PNG + print), Multi-Page Bank Statements, calibrated Persian RTL `@media print` CSS, Android `ArizoPrintPlugin.kt` + optional `ArizoThermalPrintPlugin.kt`, `.xlsx`/UTF-8 BOM `.csv` export, and CSV Import Wizard.
  - **Gate:** Vitest verifies exact minor-unit invoice math, `.xlsx`/`.csv` generation, CSV import, and ESC/POS output; Playwright confirms clean RTL print preview.

- **Phase 8 — Zero-Knowledge Cross-Platform Encrypted Backup & Restore (`.arizo`)**
  - Implement `.arizo` container codec (Argon2id + AES-256-GCM + gzipped snapshot + encrypted attachments + manifest), 24-Word Recovery Key, Dry-Run Restore Inspector, Safe Replace (with pre-restore rollback snapshot) & Smart Merge, and Rolling Auto-Snapshots.
  - **Gate:** Vitest end-to-end backup → wipe → restore confirms 100% fidelity across all 18 entities + attachments, and wrong passphrase or 1-bit tampered ciphertext strictly fails.

- **Phase 9 — Performance Stress Test, Security Hardening & Persian Distribution Guide**
  - Run a 20,000-transaction stress test verifying 60fps virtualized scrolling and Worker aggregation latency (< 150ms).
  - Full security audit: CSP, Android `network_security_config.xml`, WebView firewall, `allowBackup=false`, R8/ProGuard, zero production logs, OTP non-persistence, auto-lock from all modals, airplane-mode PWA load.
  - Write `docs/security.md` and a step-by-step **Persian** `docs/distribution_fa.md` explaining:
    1. Building & signing the release **Android `.apk`** on Windows/macOS/Linux and installing/updating it on friends & family phones (including Android 13+ Restricted Settings).
    2. Deploying the static **zero-server iOS PWA** (Cloudflare Pages / GitHub Pages / Vercel) so iPhone users install it permanently in 10 seconds with zero Apple Developer fee and zero 7-day expiry, plus setting up the Apple Shortcuts SMS bridge.
  - **Gate:** `npm run typecheck && npm run build && npm test` (100% green), Playwright RTL/LTR E2E green, `npx cap sync android` clean.

---

**Start now:** Output a concise implementation plan and any technical risks you anticipate, then execute **Phase 0 only**, run its Verification Gate, and stop to report.