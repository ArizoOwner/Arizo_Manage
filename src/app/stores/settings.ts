// Display preferences. Not sensitive, so they live in localStorage and apply before unlock
// (the lock screen must already be in the right language, direction and theme).
import { create } from 'zustand';
import type { CalendarKind } from '../../core/calendar/calendar';
import type { IrrUnit, Lang } from '../../core/i18n/format';
import i18n from '../../core/i18n/i18n';

export type Theme = 'obsidian' | 'alabaster';

export interface SettingsState {
  lang: Lang;
  calendar: CalendarKind;
  irrUnit: IrrUnit;
  theme: Theme;
  set: (patch: Partial<Pick<SettingsState, 'lang' | 'calendar' | 'irrUnit' | 'theme'>>) => void;
}

const KEY = 'arizo.settings.v1';
const DEFAULTS = { lang: 'fa' as Lang, calendar: 'jalali' as CalendarKind, irrUnit: 'toman' as IrrUnit, theme: 'obsidian' as Theme };

function load(): typeof DEFAULTS {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<typeof DEFAULTS>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/** Apply language, direction and theme to <html>. Kept outside React so it also runs at boot. */
export function applyDocumentSettings(s: Pick<SettingsState, 'lang' | 'theme'>): void {
  const html = document.documentElement;
  html.lang = s.lang === 'fa' ? 'fa-IR' : 'en-US';
  html.dir = s.lang === 'fa' ? 'rtl' : 'ltr';
  html.dataset.theme = s.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.theme === 'obsidian' ? '#06080D' : '#F4F6FA');
  if (i18n.language !== s.lang) void i18n.changeLanguage(s.lang);
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { lang, calendar, irrUnit, theme } = get();
    localStorage.setItem(KEY, JSON.stringify({ lang, calendar, irrUnit, theme }));
    applyDocumentSettings({ lang, theme });
  },
}));
