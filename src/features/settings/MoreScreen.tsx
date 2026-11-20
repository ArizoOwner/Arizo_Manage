// Tools hub: every module of the app.
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Screen } from '../../core/ui/ui';

const LIVE = [
  { to: '/accounts', key: 'more.accounts' },
  { to: '/cheques', key: 'more.cheques' },
  { to: '/loans', key: 'more.loans' },
  { to: '/debts', key: 'more.debts' },
  { to: '/sms', key: 'more.sms' },
  { to: '/budgets', key: 'more.budgets' },
  { to: '/goals', key: 'more.goals' },
  { to: '/categories', key: 'more.categories' },
  { to: '/invoices', key: 'more.invoices' },
  { to: '/export', key: 'more.export' },
  { to: '/import', key: 'more.import' },
  { to: '/backup', key: 'more.backup' },
  { to: '/trash', key: 'more.trash' },
  { to: '/settings', key: 'more.settings' },
] as const;

export function MoreScreen() {
  const { t } = useTranslation();
  const nav = useNavigate();
  return (
    <Screen title={t('more.title')}>
      <div className="grid grid-cols-2 gap-3">
        {LIVE.map((x) => (
          <button key={x.to} type="button" onClick={() => nav(x.to)} className="min-h-24 rounded-3xl border border-hairline bg-surface-1 p-4 text-start text-[15px] font-bold">
            {t(x.key)}
          </button>
        ))}
      </div>
    </Screen>
  );
}
