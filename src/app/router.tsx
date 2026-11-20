import { createHashRouter, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { DesignGallery } from '../features/gallery/DesignGallery';
import { Dashboard } from '../features/dashboard/Dashboard';
import { AccountDetail, AccountNew, AccountsList, RatesScreen } from '../features/accounts/AccountsScreens';
import { Ledger, Trash } from '../features/transactions/Ledger';
import { SettingsScreen } from '../features/settings/Settings';
import { MoreScreen } from '../features/settings/MoreScreen';
import { AnalyticsScreen } from '../features/analytics/Analytics';
import { BudgetsScreen, CategoriesScreen, GoalsScreen } from '../features/analytics/Plans';
import { ChequesScreen } from '../features/obligations/Cheques';
import { LoansScreen } from '../features/obligations/Loans';
import { DebtsScreen } from '../features/obligations/Debts';
import { SmsCenter } from '../features/sms-intelligence/SmsCenter';
import { BusinessProfileScreen, CatalogScreen, InvoiceDetail, InvoiceEditor, InvoicesScreen } from '../features/invoices/InvoiceStudio';
import { BatchStatementScreen, ExportScreen, ImportScreen, StatementScreen } from '../features/invoices/LedgerTools';
import { BackupScreen } from '../features/backup/BackupScreen';

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
      { path: 'accounts/:id/statement', element: <StatementScreen /> },
      { path: 'statements', element: <BatchStatementScreen /> },
      { path: 'rates', element: <RatesScreen /> },
      { path: 'analytics', element: <AnalyticsScreen /> },
      { path: 'budgets', element: <BudgetsScreen /> },
      { path: 'goals', element: <GoalsScreen /> },
      { path: 'categories', element: <CategoriesScreen /> },
      { path: 'more', element: <MoreScreen /> },
      { path: 'settings', element: <SettingsScreen /> },
      { path: 'cheques', element: <ChequesScreen /> },
      { path: 'loans', element: <LoansScreen /> },
      { path: 'debts', element: <DebtsScreen /> },
      { path: 'sms', element: <SmsCenter /> },
      { path: 'sms/paste', element: <SmsCenter initialTab="paste" /> },
      { path: 'invoices', element: <InvoicesScreen /> },
      { path: 'invoices/new', element: <InvoiceEditor /> },
      { path: 'invoices/profile', element: <BusinessProfileScreen /> },
      { path: 'invoices/catalog', element: <CatalogScreen /> },
      { path: 'invoices/:id', element: <InvoiceDetail /> },
      { path: 'invoices/:id/edit', element: <InvoiceEditor /> },
      { path: 'import', element: <ImportScreen /> },
      { path: 'export', element: <ExportScreen /> },
      { path: 'backup', element: <BackupScreen /> },
      { path: '*', element: <Dashboard /> },
    ],
  },
]);
