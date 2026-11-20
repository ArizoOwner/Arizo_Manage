import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fa from './fa.json';
import en from './en.json';

// Resources are bundled (no HTTP backend): the app is offline and the CSP forbids fetches anyway.
void i18n.use(initReactI18next).init({
  resources: { fa: { translation: fa }, en: { translation: en } },
  lng: 'fa',
  fallbackLng: 'fa',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
  // i18next prints a sponsor console.info on first init; production must log nothing (Phase 9 audit).
  showSupportNotice: false,
});

export default i18n;
