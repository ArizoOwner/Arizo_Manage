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

  if (!initialized) return <Onboarding />;
  if (!open) return <LockScreen />;

  const quick = (a: QuickAction) => {
    if (a === 'expense' || a === 'income' || a === 'transfer') setEntry(a);
    else if (a === 'cheque') nav('/cheques');
    // invoice / pasteSms belong to Phases 7 and 5; the menu lists them for discovery only.
  };

  return (
    <>
      <Outlet />
      <LiquidDock onAdd={() => setEntry('expense')} onQuick={quick} />
      {entry && <EntrySheet key={entry} open onClose={() => setEntry(null)} initialKind={entry} />}
    </>
  );
}
