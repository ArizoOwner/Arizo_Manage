# SMS engine

Turns bank SMS and bank-app notifications into **pending** transactions the user reviews. Nothing posts
on its own, even at full confidence. Designed in `PROMPT.md` §6, built in Phase 5.

## Pipeline

```
capture ─▶ firewall ─▶ normalize ─▶ parse ─▶ dedupe ─▶ match account ─▶ pending_review | inbox
```

### 1. Capture
- **Android SMS**: `BankSmsReceiver` (manifest component, disabled until the user turns it on) joins
  multipart PDUs per sender, runs the native `SmsFilter` (OTP, spam, bank keywords), then seals the text
  with the Keystore RSA-OAEP public key into `noBackupFilesDir/sms_queue` (max 2,000). It never needs the
  DEK and never opens the database, so it works while the app is locked or killed.
- **Android notifications**: `BankNotificationListener` reads only the packages the user selected.
- **History scan**: `ArizoSms.scanInbox` (30/90/365 days, at most 5,000 messages, background thread).
- **iOS**: an Apple Shortcuts automation opens `#/sms-ingest?d=<base64>`. `bootFragment.ts`, the first
  import of `main.tsx`, takes the fragment, replaces the URL with `#/sms` before the router reads it, and
  holds the text in memory until a main-vault unlock. Decoy sessions never ingest.
- **Paste**: `#/sms/paste`, split by blank lines (`splitBulk`).
- After unlock, `intake.ts` drains the sealed queue through `ArizoSecurity.openQueueItem` (refused while
  locked) and acknowledges each item.

### 2. Firewall (always first)
`firewall()` in `normalize.ts` rejects OTP/2FA codes and promotional messages before anything else. A
rejected message is never written anywhere: no transaction, no inbox entry, no audit row. On Android the
native filter has already dropped them once; the JS check runs again for every source.

### 3. Normalize
`normalizeSms`: Persian and Arabic digits to ASCII, `ي ى ك` to `ی ک`, strips ZWNJ/ZWJ/RLM/LRM/bidi marks
and tatweel, and moves a trailing minus (`2,000,000-` → `-2,000,000`) without touching dates or times.

### 4. Parse (`parser.ts`, in `sms.worker`)
1. Enabled custom rules (`sms_parser_rules`), highest priority first; each has a regex, a capture group
   per field (`field_map_json`), a unit hint and a type hint. A rule bound to a sender matches only it.
2. Bank templates from `src/core/data/sms-templates.json` (39 banks, detected by **name keywords**, never
   by sender number): amount/balance/ref/card/merchant labels, direction and channel words.
3. A heuristic fallback (largest grouped number).

Dates (Jalali `1403/08/15`, `03/08/22`, Gregorian `m/d/y` and `d/m/y`, `20-Nov-2026`, `Nov 20, 2026`) and
times are blanked before amounts are searched. Masked or 16-digit cards and ungrouped runs of 10+ digits
(accounts, references) are never amounts. An explicit `ریال`, `تومان`, `$`, `€`, `£` or `AED` beats the
bank default (Iranian banks default to Rial; Toman × 10 = Rial). Each result carries a confidence 0–1;
below `LOW_CONFIDENCE` (0.6) the Review Queue suggests teaching the parser.

### 5. Ingest (`ingest.ts`, one atomic transaction per message)
- `smsFingerprint` = SHA-256 of the normalized body, UNIQUE on `transactions`: an exact repeat is a
  `duplicate`.
- SMS + push pair: same account and amount within 2 minutes, equal (or one missing) balance → duplicate.
- Account match: card suffix, else the only account of that bank, else the only bank account in that
  currency. No match or no amount → the inbox (`settings.sms_inbox`, max 100) with a reason.
- Otherwise a `pending_review` transaction, category from `merchant_category_memory`, then the bundled
  merchant map. `approvePending` posts it and learns merchant → category.
- `balanceDrift` compares the latest reported balance with the running ledger balance at that moment; the
  UI offers a one-tap `reconcileBalance` adjustment.

### 6. Teach the parser
In the inbox the user taps numbers (amount, then balance, optionally card and reference).
`numberTokens` + `buildTaughtRegex` anchor on the two words before each tapped number and generalize the
digits; the Regex Studio edits rules directly, with a live match count against inbox samples. Saving or
deleting a rule writes an `sms_rule_changed` audit row without content and re-runs the inbox. Confirming
a sender stores sender → bank in `settings.sms_senders`, used from then on.

## Privacy rules
- SMS text never reaches a log, a notification or the URL. The capture notification is generic and
  private, with a public version.
- Bank sender numbers and Android packages in `banks.json` stay empty and `verified: false`; only the
  user confirms them.
- The SMS worker is terminated on lock.

## Tests
`tests/sms-parser.test.ts` runs 89 synthetic vectors from `tests/sms-fixtures/vectors.ts` (Iranian banks,
neo-banks, international banks, heuristics, OTP and spam), plus dedupe, pairing, drift, teaching and the
"never persisted anywhere" check for rejected messages. `tests/e2e/sms.spec.ts` covers paste, review and
the iOS fragment wipe. Phase 9 timed the worker at 30–58 ms for 1,000 messages (`tests/e2e/stress.spec.ts`).
None of the Android capture code has run on a real phone yet.
