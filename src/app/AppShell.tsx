// Unlocked app frame: routes + floating dock + entry sheet. Locked or first-run states never mount it.
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { LiquidDock, type QuickAction } from '../core/motion/LiquidDock';
import { EntrySheet, type EntryKind } from '../features/transactions/EntrySheet';
import { useEntry } from './stores/entry';
import { useVault } from './stores/vault';
import { LockScreen } from '../features/vault-lock/LockScreen';
import { Onboarding } from '../features/vault-lock/Onboarding';

export function AppShell() {
  const open = useVault((s) => s.open);
  const initialized = useVault((s) => s.initialized);
  const entry = useEntry((s) => s.kind);
  const setEntry = (k: EntryKind | null) => (k ? useEntry.getState().open(k) : useEntry.getState().close());
  const reduce = useReducedMotion();
  const { pathname } = useLocation();
  const nav = useNavigate();
  // Each screen opens at the top (hash routing keeps the window scroll otherwise).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  // Locking closes the entry sheet for good; without this it popped up again after the next unlock
  // (AppShell itself stays mounted while it renders the lock screen). Phase 9 audit fix.
  useEffect(() => {
    if (!open) setEntry(null);
  }, [open]);

  if (!initialized) return <Onboarding />;
  if (!open) return <LockScreen />;

  const quick = (a: QuickAction) => {
    if (a === 'expense' || a === 'income' || a === 'transfer') setEntry(a);
    else if (a === 'cheque') nav('/cheques');
    else if (a === 'pasteSms') nav('/sms/paste');
    else if (a === 'invoice') nav('/invoices/new');
  };

  return (
    <>
      {/* Each screen glides in; the unlock itself opens with a soft rise (first mount of the shell). Entrance
          only: an exit animation keeps the old screen mounted until it ends, so the new one arrives late.
          transitionEnd drops the transform: it makes this div the containing block of every position:fixed
          sheet inside the screen, which then opens off-screen. No blur filter: it repaints the whole screen. */}
      <motion.div
        key={pathname}
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0, transitionEnd: { transform: 'none' } }}
        transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <Outlet />
      </motion.div>
      <LiquidDock onAdd={() => setEntry('expense')} onQuick={quick} />
      {/* Unlock reveal: a gold ring opens out of the vault and fades, once per unlock (the shell remounts its
          children after every lock). Pointer-transparent, so nothing waits on it. */}
      {!reduce && (
        <motion.div
          key={`reveal-${open.kind}`}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-50 grid place-items-center"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut', delay: 0.15 }}
        >
          <motion.span
            className="h-40 w-40 rounded-full border-2 border-[var(--arizo-accent-luxury)] shadow-[0_0_60px_var(--arizo-accent-luxury),inset_0_0_40px_var(--arizo-accent-luxury)]"
            initial={{ scale: 0.3 }}
            animate={{ scale: 9 }}
            transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }}
          />
        </motion.div>
      )}
      {entry && <EntrySheet key={entry} open onClose={() => setEntry(null)} initialKind={entry} />}
    </>
  );
}
