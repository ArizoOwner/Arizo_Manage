// Must stay the first import: the iOS Shortcuts fragment is wiped before the router is created.
import './app/bootFragment';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyDocumentSettings, useSettings } from './app/stores/settings';
import './core/i18n/i18n';
import './index.css';

// Language, direction and theme apply before first paint so the lock screen is never mis-mirrored.
applyDocumentSettings(useSettings.getState());

// E2E builds only: cheap Argon2 so the journey test runs in seconds. Production never takes this branch
// (VITE_E2E is unset there, and scripts/check-prod.mjs fails the build if this marker ships).
if (import.meta.env.VITE_E2E === '1') {
  void import('./core/security/vaultService').then(({ vaultService }) => vaultService.useArgonParamsForTesting({ m: 1024, t: 1, p: 1 }));
  void import('./app/e2eHooks').then((m) => m.installE2eHooks());
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
