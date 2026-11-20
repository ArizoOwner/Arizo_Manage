// Tools hub. Modules from later phases are listed but disabled, so nothing pretends to work.
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
  { to: '/trash', key: 'more.trash' },
  { to: '/settings', key: 'more.settings' },
] as const;
const LATER = ['more.backup'] as const;

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
        {LATER.map((k) => (
          <div key={k} aria-disabled="true" className="flex min-h-24 flex-col justify-between rounded-3xl border border-hairline bg-surface-1 p-4 opacity-55">
            <span className="text-[15px] font-bold">{t(k)}</span>
            <span className="text-[12px] text-ink-2">{t('more.soon')}</span>
          </div>
        ))}
      </div>
    </Screen>
  );
}
