import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyDocumentSettings, useSettings } from './app/stores/settings';
import './core/i18n/i18n';
import './index.css';

// Language, direction and theme apply before first paint so the lock screen is never mis-mirrored.
applyDocumentSettings(useSettings.getState());

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
