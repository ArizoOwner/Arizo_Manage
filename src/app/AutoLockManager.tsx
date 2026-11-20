// Auto-lock and the privacy curtain (PROMPT.md §5.2).
// - Curtain: the moment the app is hidden (visibilitychange on web/iOS, onPause on Android) every
//   screen is covered, so the app switcher thumbnail shows nothing.
// - Auto-lock: when hidden for longer than the chosen delay ("Immediate" = on hide), or idle in the
//   foreground for that long, the vault locks and keys are dropped.
import { useEffect } from 'react';
import { HOLD_MAX_MS, useVault } from './stores/vault';

const IDLE_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function AutoLockManager() {
  const open = useVault((s) => s.open);
  const autoLockMs = useVault((s) => s.autoLockMs);

  useEffect(() => {
    if (!open) return;
    const { lock, setCurtain } = useVault.getState();
    let hiddenAt = 0;
    let idle = 0;
    const armIdle = () => {
      window.clearTimeout(idle);
      // Foreground idle uses at least 1 minute so "Immediate" does not lock mid-typing.
      idle = window.setTimeout(() => void lock(), Math.max(autoLockMs, 60_000));
    };
    // A hold (camera scanner open) stretches the background allowance to HOLD_MAX_MS.
    const allowance = () => (useVault.getState().autoLockHolds > 0 ? Math.max(autoLockMs, HOLD_MAX_MS) : autoLockMs);
    const onHide = () => {
      hiddenAt = Date.now();
      setCurtain(true);
      if (allowance() === 0) void lock();
    };
    const onShow = () => {
      if (hiddenAt && Date.now() - hiddenAt >= allowance()) void lock();
      hiddenAt = 0;
      setCurtain(false);
      armIdle();
    };
    const onVis = () => (document.visibilityState === 'hidden' ? onHide() : onShow());
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('arizoNativePause', onHide);
    window.addEventListener('pagehide', onHide);
    for (const e of IDLE_EVENTS) window.addEventListener(e, armIdle, { passive: true });
    armIdle();
    return () => {
      window.clearTimeout(idle);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('arizoNativePause', onHide);
      window.removeEventListener('pagehide', onHide);
      for (const e of IDLE_EVENTS) window.removeEventListener(e, armIdle);
    };
  }, [open, autoLockMs]);

  // The curtain lifts on return whether or not the vault is still open. Phase 9 audit fix: this lived in
  // the effect above, which is torn down the moment the vault locks, so after an auto-lock on hide the
  // curtain stayed over the lock screen and swallowed every tap on the PIN pad.
  useEffect(() => {
    const show = () => {
      if (document.visibilityState !== 'hidden') useVault.getState().setCurtain(false);
    };
    document.addEventListener('visibilitychange', show);
    window.addEventListener('arizoNativeResume', show);
    window.addEventListener('pageshow', show);
    return () => {
      document.removeEventListener('visibilitychange', show);
      window.removeEventListener('arizoNativeResume', show);
      window.removeEventListener('pageshow', show);
    };
  }, []);

  return null;
}

export function PrivacyCurtain() {
  const curtain = useVault((s) => s.curtain);
  if (!curtain) return null;
  return <div aria-hidden="true" className="fixed inset-0 z-[100] bg-canvas/95 backdrop-blur-2xl" />;
}
