// Tools hub. Modules from later phases are listed but disabled, so nothing pretends to work.
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Screen } from '../../core/ui/ui';

const LIVE = [
  { to: '/accounts', key: 'more.accounts' },
  { to: '/trash', key: 'more.trash' },
  { to: '/settings', key: 'more.settings' },
] as const;
const LATER = ['more.cheques', 'more.loans', 'more.sms', 'more.invoices', 'more.backup'] as const;

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

export function AnalyticsPlaceholder() {
  const { t } = useTranslation();
  return (
    <Screen title={t('analytics.title')}>
      <p className="py-10 text-center text-[14px] text-ink-2">{t('analytics.soon')}</p>
    </Screen>
  );
}
