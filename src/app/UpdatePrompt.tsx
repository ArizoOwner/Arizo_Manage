import { Capacitor } from '@capacitor/core';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

// The Android APK ships its assets in the binary; only the web/iOS PWA uses the service worker.
const isWeb = !Capacitor.isNativePlatform();

function WebUpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex items-center gap-3 rounded-2xl border border-specular bg-surface-2 p-4 text-sm"
    >
      <span className="flex-1">{t('update.ready')}</span>
      <button type="button" className="min-h-11 rounded-xl px-3 text-ink-2" onClick={() => setNeedRefresh(false)}>
        {t('update.later')}
      </button>
      <button type="button" className="min-h-11 rounded-xl bg-cta px-3 font-semibold text-on-accent" onClick={() => void updateServiceWorker(true)}>
        {t('update.reload')}
      </button>
    </div>
  );
}

export function UpdatePrompt() {
  return isWeb ? <WebUpdatePrompt /> : null;
}
