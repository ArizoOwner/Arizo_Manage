import { createHashRouter, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { DesignGallery } from '../features/gallery/DesignGallery';
import { Dashboard } from '../features/dashboard/Dashboard';
import { AccountDetail, AccountNew, AccountsList, RatesScreen } from '../features/accounts/AccountsScreens';
import { Ledger, Trash } from '../features/transactions/Ledger';
import { SettingsScreen } from '../features/settings/Settings';
import { AnalyticsPlaceholder, MoreScreen } from '../features/settings/MoreScreen';

// Hash routing: required for static zero-server hosting and #/sms-ingest fragment ingestion (Phase 5).
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
      { path: '*', element: <Dashboard /> },
    ],
  },
]);
