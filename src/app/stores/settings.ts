// Display preferences. Not sensitive, so they live in localStorage and apply before unlock
// (the lock screen must already be in the right language, direction and theme).
import { create } from 'zustand';
import type { CalendarKind } from '../../core/calendar/calendar';
import type { IrrUnit, Lang } from '../../core/i18n/format';
import i18n from '../../core/i18n/i18n';

export type Theme = 'obsidian' | 'alabaster';

type Prefs = {
  lang: Lang;
  calendar: CalendarKind;
  irrUnit: IrrUnit;
  theme: Theme;
  /** Local reminders for cheques, installments and debts (Android). */
  reminders: boolean;
  /** Opt-in: show names and amounts in notifications (PROMPT.md §1.2: generic by default). */
  detailedNotifications: boolean;
};

export interface SettingsState extends Prefs {
  set: (patch: Partial<Prefs>) => void;
}

const KEY = 'arizo.settings.v1';
const DEFAULTS: Prefs = { lang: 'fa', calendar: 'jalali', irrUnit: 'toman', theme: 'obsidian', reminders: true, detailedNotifications: false };

function load(): Prefs {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
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
    const { lang, calendar, irrUnit, theme, reminders, detailedNotifications } = get();
    localStorage.setItem(KEY, JSON.stringify({ lang, calendar, irrUnit, theme, reminders, detailedNotifications }));
    applyDocumentSettings({ lang, theme });
  },
}));
