// Unlocked app frame: routes + floating dock + entry sheet. Locked or first-run states never mount it.
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { LiquidDock, type QuickAction } from '../core/motion/LiquidDock';
import { EntrySheet, type EntryKind } from '../features/transactions/EntrySheet';
import { useVault } from './stores/vault';
import { LockScreen } from '../features/vault-lock/LockScreen';
import { Onboarding } from '../features/vault-lock/Onboarding';

export function AppShell() {
  const open = useVault((s) => s.open);
  const initialized = useVault((s) => s.initialized);
  const [entry, setEntry] = useState<EntryKind | null>(null);
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
      <Outlet />
      <LiquidDock onAdd={() => setEntry('expense')} onQuick={quick} />
      {entry && <EntrySheet key={entry} open onClose={() => setEntry(null)} initialKind={entry} />}
    </>
  );
}
