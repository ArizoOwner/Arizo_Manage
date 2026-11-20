// Typed wrappers for the Android Kotlin plugins, plus the SqlExecutor over ArizoSqlCipher.
// On iOS/web these plugins do not exist; callers branch on isNative() and use the web keyring instead.
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { SqlExecutor, SqlStatement } from '../storage/SqlVaultAdapter';

export interface SecurityStatus {
  biometricAvailable: boolean;
  biometricEnrolled: boolean;
  strongBox: boolean;
  vaultInitialized: boolean;
  unlocked: boolean;
}

export interface ArizoSecurityPlugin {
  status(): Promise<SecurityStatus>;
  createVault(o: { kekB64: string; vaultId: string }): Promise<{ vaultId: string }>;
  unlockWithKek(o: { kekB64: string }): Promise<{ vaultId: string }>;
  verifyKek(o: { kekB64: string; forBiometric?: boolean }): Promise<void>;
  enableBiometric(): Promise<void>;
  unlockWithBiometric(): Promise<{ vaultId: string }>;
  rewrapPin(o: { oldKekB64: string; newKekB64: string }): Promise<void>;
  lock(): Promise<void>;
  destroyVault(): Promise<void>;
  openQueueItem(o: { b64: string }): Promise<{ text: string }>;
  copySensitive(o: { text: string }): Promise<void>;
  setScreenshotAllowed(o: { allowForMs: number }): Promise<void>;
}

export interface ArizoSqlCipherPlugin {
  open(o: { vaultId: string }): Promise<{ cipherVersion?: string }>;
  query(o: { sql: string; params: (string | number | null)[] }): Promise<{ rows: Record<string, unknown>[] }>;
  batch(o: { statements: SqlStatement[] }): Promise<void>;
  close(): Promise<void>;
  destroy(o: { vaultId: string }): Promise<void>;
}

export interface SmsStatus {
  smsPermission: boolean;
  notificationAccess: boolean;
  smsEnabled: boolean;
  notificationsEnabled: boolean;
  packages: string[];
  queued: number;
  /** Android 13+: sideloaded apps need "Allow restricted settings" in App Info first. */
  restrictedSettings: boolean;
}

export interface SealedItem {
  id: string;
  b64: string;
  source: 'sms_auto' | 'notification_auto';
  /** SMS originating address or notification package. Not secret, kept for sender confirmation. */
  sender: string;
  received_at: number;
}

export interface InstalledApp {
  packageName: string;
  label: string;
}

export interface ArizoSmsPlugin {
  status(): Promise<SmsStatus>;
  /** Turn SMS capture on/off. Requests RECEIVE_SMS/READ_SMS only when turning on. */
  setSmsEnabled(o: { enabled: boolean }): Promise<SmsStatus>;
  setNotificationsEnabled(o: { enabled: boolean; packages: string[] }): Promise<SmsStatus>;
  openNotificationAccess(): Promise<void>;
  openAppInfo(): Promise<void>;
  listApps(): Promise<{ apps: InstalledApp[] }>;
  /** Sealed queue items (RSA-OAEP + AES-GCM); open each with ArizoSecurity.openQueueItem. */
  pending(): Promise<{ items: SealedItem[] }>;
  ack(o: { ids: string[] }): Promise<void>;
  /** Opt-in historical inbox scan: seals matching SMS from the last `days` into the queue. */
  scanInbox(o: { days: number }): Promise<{ queued: number; scanned: number }>;
}

export const ArizoSecurity = registerPlugin<ArizoSecurityPlugin>('ArizoSecurity');
export const ArizoSms = registerPlugin<ArizoSmsPlugin>('ArizoSms');
export const ArizoSqlCipher = registerPlugin<ArizoSqlCipherPlugin>('ArizoSqlCipher');

export const isNative = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

/** SqlExecutor backed by the native SQLCipher plugin. Native errors carry code "UNIQUE" on clashes. */
export function sqlCipherExecutor(): SqlExecutor {
  return {
    async query(sql, params = []) {
      return (await ArizoSqlCipher.query({ sql, params })).rows;
    },
    async batch(statements) {
      try {
        await ArizoSqlCipher.batch({ statements });
      } catch (e) {
        if ((e as { code?: string }).code === 'UNIQUE') throw new Error('UNIQUE constraint failed');
        throw e;
      }
    },
    close: () => ArizoSqlCipher.close(),
  };
}
