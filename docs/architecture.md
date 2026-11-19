# Architecture

Filled in progressively. Current state: see `CLAUDE.md`. Target design: `PROMPT.md` §2 and §4.

## Targets
- **Android**: Capacitor 7 WebView + custom Kotlin plugins (Phase 1, 5, 7).
- **iOS / Web**: offline standalone PWA, Workbox precache, hash routing.

## Data layer
`IVaultDatabase` with two adapters (SQLCipher native, encrypted Dexie web) sharing one contract test suite. Lands in Phase 1.
