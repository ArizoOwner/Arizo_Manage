import { Capacitor } from '@capacitor/core';
import { useRegisterSW } from 'virtual:pwa-register/react';

// The Android APK ships its assets in the binary; only the web/iOS PWA uses the service worker.
const isWeb = !Capacitor.isNativePlatform();

function WebUpdatePrompt() {
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
      <span className="flex-1">نسخهٔ تازه آماده است.</span>
      <button type="button" className="rounded-xl px-3 py-2 text-ink-2" onClick={() => setNeedRefresh(false)}>
        بعداً
      </button>
      <button
        type="button"
        className="rounded-xl bg-emerald px-3 py-2 font-semibold text-canvas"
        onClick={() => void updateServiceWorker(true)}
      >
        به‌روزرسانی
      </button>
    </div>
  );
}

export function UpdatePrompt() {
  return isWeb ? <WebUpdatePrompt /> : null;
}
