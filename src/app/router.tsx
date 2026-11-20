import { createHashRouter, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { DesignGallery } from '../features/gallery/DesignGallery';
import { Dashboard } from '../features/dashboard/Dashboard';
import { AccountDetail, AccountNew, AccountsList, RatesScreen } from '../features/accounts/AccountsScreens';
import { Ledger, Trash } from '../features/transactions/Ledger';
import { SettingsScreen } from '../features/settings/Settings';
import { AnalyticsPlaceholder, MoreScreen } from '../features/settings/MoreScreen';
import { ChequesScreen } from '../features/obligations/Cheques';
import { LoansScreen } from '../features/obligations/Loans';
import { DebtsScreen } from '../features/obligations/Debts';
import { SmsCenter } from '../features/sms-intelligence/SmsCenter';

// Hash routing: required for static zero-server hosting. `#/sms-ingest?d=` is consumed and wiped in
// main.tsx (captureIngestFragment) before the router ever sees it.
// The Design Gallery exists in dev and E2E builds only (VITE_E2E is set by the Playwright web server).
const devRoutes: RouteObject[] = import.meta.env.DEV || import.meta.env.VITE_E2E === '1' ? [{ path: '/gallery', element: <DesignGallery /> }] : [];

export const router = createHashRouter([
  ...devRoutes,
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'ledger', element: <Ledger /> },
      { path: 'trash', element: <Trash /> },
      { path: 'accounts', element: <AccountsList /> },
      { path: 'accounts/new', element: <AccountNew /> },
      { path: 'accounts/:id', element: <AccountDetail /> },
      { path: 'rates', element: <RatesScreen /> },
      { path: 'analytics', element: <AnalyticsPlaceholder /> },
      { path: 'more', element: <MoreScreen /> },
      { path: 'settings', element: <SettingsScreen /> },
      { path: 'cheques', element: <ChequesScreen /> },
      { path: 'loans', element: <LoansScreen /> },
      { path: 'debts', element: <DebtsScreen /> },
      { path: 'sms', element: <SmsCenter /> },
      { path: 'sms/paste', element: <SmsCenter initialTab="paste" /> },
      { path: '*', element: <Dashboard /> },
    ],
  },
]);
