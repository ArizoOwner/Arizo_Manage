import { createHashRouter, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { DesignGallery } from '../features/gallery/DesignGallery';
import { Dashboard } from '../features/dashboard/Dashboard';
import { AccountDetail, AccountNew, AccountsList, RatesScreen } from '../features/accounts/AccountsScreens';
import { Ledger, Trash } from '../features/transactions/Ledger';
import { MoreScreen } from '../features/settings/MoreScreen';
import { AnalyticsScreen } from '../features/analytics/Analytics';

// Screens away from the first paint are separate chunks, fetched when opened (and precached by the
// service worker for offline use). `screen(load, 'Name', props)` builds a route `lazy` loader.
const screen =
  <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string, props: Record<string, unknown> = {}) =>
  async () => {
    const C = (await load())[name] as unknown as (p: Record<string, unknown>) => React.ReactElement;
    return { element: <C {...props} /> };
  };
const settings = () => import('../features/settings/Settings');
const plans = () => import('../features/analytics/Plans');
const cheques = () => import('../features/obligations/Cheques');
const loans = () => import('../features/obligations/Loans');
const debts = () => import('../features/obligations/Debts');
const sms = () => import('../features/sms-intelligence/SmsCenter');
const studio = () => import('../features/invoices/InvoiceStudio');
const tools = () => import('../features/invoices/LedgerTools');
const backup = () => import('../features/backup/BackupScreen');

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
      { path: 'accounts/:id/statement', lazy: screen(tools, 'StatementScreen') },
      { path: 'statements', lazy: screen(tools, 'BatchStatementScreen') },
      { path: 'rates', element: <RatesScreen /> },
      { path: 'analytics', element: <AnalyticsScreen /> },
      { path: 'budgets', lazy: screen(plans, 'BudgetsScreen') },
      { path: 'goals', lazy: screen(plans, 'GoalsScreen') },
      { path: 'categories', lazy: screen(plans, 'CategoriesScreen') },
      { path: 'more', element: <MoreScreen /> },
      { path: 'settings', lazy: screen(settings, 'SettingsScreen') },
      { path: 'cheques', lazy: screen(cheques, 'ChequesScreen') },
      { path: 'loans', lazy: screen(loans, 'LoansScreen') },
      { path: 'debts', lazy: screen(debts, 'DebtsScreen') },
      { path: 'sms', lazy: screen(sms, 'SmsCenter') },
      { path: 'sms/paste', lazy: screen(sms, 'SmsCenter', { initialTab: 'paste' }) },
      { path: 'invoices', lazy: screen(studio, 'InvoicesScreen') },
      { path: 'invoices/new', lazy: screen(studio, 'InvoiceEditor') },
      { path: 'invoices/profile', lazy: screen(studio, 'BusinessProfileScreen') },
      { path: 'invoices/catalog', lazy: screen(studio, 'CatalogScreen') },
      { path: 'invoices/:id', lazy: screen(studio, 'InvoiceDetail') },
      { path: 'invoices/:id/edit', lazy: screen(studio, 'InvoiceEditor') },
      { path: 'import', lazy: screen(tools, 'ImportScreen') },
      { path: 'export', lazy: screen(tools, 'ExportScreen') },
      { path: 'backup', lazy: screen(backup, 'BackupScreen') },
      { path: '*', element: <Dashboard /> },
    ],
  },
]);
