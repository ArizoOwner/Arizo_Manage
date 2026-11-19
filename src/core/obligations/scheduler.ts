// Applies planned reminders to the OS. Android only (Capacitor local notifications); the iOS PWA
// has no reliable offline scheduled notifications, so it relies on the in-app Upcoming strip.
// All previously scheduled Arizo reminders are cancelled first, so the OS always mirrors the plan.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { PlannedReminder } from './reminders';

const KEY = 'arizo.reminders.ids.v1';

export const remindersSupported = (): boolean => Capacitor.isNativePlatform();

export async function ensureReminderPermission(): Promise<boolean> {
  if (!remindersSupported()) return false;
  const cur = await LocalNotifications.checkPermissions();
  if (cur.display === 'granted') return true;
  return (await LocalNotifications.requestPermissions()).display === 'granted';
}

export async function applyReminders(plan: PlannedReminder[], enabled: boolean): Promise<number> {
  if (!remindersSupported()) return 0;
  const old = JSON.parse(localStorage.getItem(KEY) ?? '[]') as number[];
  if (old.length) await LocalNotifications.cancel({ notifications: old.map((id) => ({ id })) }).catch(() => {});
  if (!enabled || !plan.length || !(await ensureReminderPermission())) {
    localStorage.setItem(KEY, '[]');
    return 0;
  }
  await LocalNotifications.schedule({
    notifications: plan.map((r) => ({ id: r.id, title: r.title, body: r.body, schedule: { at: new Date(r.at), allowWhileIdle: true } })),
  });
  localStorage.setItem(KEY, JSON.stringify(plan.map((r) => r.id)));
  return plan.length;
}
