// Command Center (PROMPT.md §7 #2): header, net worth hero, card stack, 14-day obligations, recent stream.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { usePrivacy } from '../../app/stores/privacy';
import { useSettings } from '../../app/stores/settings';
import { mutate, mutateObligation, useVault } from '../../app/stores/vault';
import { payInstallment } from '../../core/obligations/loans';
import { upcomingObligations } from '../../core/obligations/upcoming';
import { useVaultQuery } from '../../app/useVaultQuery';
import { monthRange } from '../../core/calendar/calendar';
import { bankByCode } from '../../core/data/banks';
import { formatDate, formatMoney } from '../../core/i18n/format';
import { cashflowInBase, computeNetWorth } from '../../core/ledger/networth';
import { payRecurringNow } from '../../core/ledger/recurring';
import { OdometerAmount } from '../../core/motion/OdometerAmount';
import { ParallaxCard } from '../../core/motion/ParallaxCard';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import { Card, Icon, IconButton, ICONS, Screen } from '../../core/ui/ui';
import { TxRow } from '../transactions/TxRow';
import { BudgetList, InsightList, useAnalytics, useNames } from '../analytics/Analytics';
import { periodAt } from '../../core/analytics/periods';
import { backupDue, backupState } from '../../core/backup/service';


export function Dashboard() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const setSettings = useSettings((s) => s.set);
  const { hidden, toggle } = usePrivacy();
  const { data } = useVaultQuery(async (db) => {
    const [accounts, txs, rates, cats, rules, cheques, loans, installments, debts, settlements, people] = await Promise.all([
      db.find('accounts'),
      db.find('transactions'),
      db.find('exchange_rates'),
      db.find('categories'),
      db.find('recurring_rules'),
      db.find('cheques'),
      db.find('loans'),
      db.find('loan_installments'),
      db.find('debts_receivables'),
      db.find('debt_settlements'),
      db.find('people'),
    ]);
    return { accounts, txs, rates, cats, rules, cheques, loans, installments, debts, settlements, people };
  });

  const view = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const live = data.accounts.filter((a) => a.deleted_at === null && !a.is_archived).sort((a, b) => a.sort_order - b.sort_order);
    const m = monthRange(now, cal);
    const visible = data.txs.filter((x) => x.deleted_at === null && x.status !== 'voided').sort((a, b) => b.occurred_at - a.occurred_at);
    return {
      live,
      nw: computeNetWorth(data.accounts, data.rates, 'IRR', now),
      cf: cashflowInBase(data.txs, data.rates, m.start, m.end),
      recent: visible.slice(0, 6),
      pending: visible.filter((x) => x.status === 'pending_review').length,
      upcoming: upcomingObligations(data, now, 14),
      byId: new Map(data.accounts.map((a) => [a.id, a])),
      catById: new Map(data.cats.map((c) => [c.id, c])),
    };
  }, [data, cal]);

  const isMain = useVault((st) => st.open?.kind === 'main');
  const due = useVaultQuery(async (db) => backupDue(await backupState(db), (await db.count('transactions')) > 0)).data ?? false;
  const p = periodAt(Date.now(), cal);
  const { report } = useAnalytics(cal, p.y, p.m);
  const names = useNames(data?.cats, data?.accounts);

  const ratio = view && view.cf.income > 0n ? Number((view.cf.expense * 100n) / view.cf.income) : null;

  return (
    <Screen
      title={t('app.name')}
      actions={
        <>
          <IconButton label={hidden ? t('privacy.show') : t('privacy.hide')} pressed={hidden} onClick={toggle}>
            <Icon d={hidden ? ICONS.eyeOff : ICONS.eye} />
          </IconButton>
          <IconButton label={t('dash.lockNow')} onClick={() => void useVault.getState().lock()}>
            <Icon d={ICONS.lock} />
          </IconButton>
          <IconButton label={t('settings.title')} onClick={() => nav('/settings')}>
            <Icon d={ICONS.settings} />
          </IconButton>
        </>
      }
    >
      {view && view.pending > 0 && (
        <button type="button" onClick={() => nav('/sms')} data-testid="pending-badge" className="min-h-11 self-start rounded-full bg-surface-2 px-4 text-[13px] font-semibold text-amber-text">
          {t('dash.pendingReview', { n: view.pending })}
        </button>
      )}

      {due && isMain && (
        <button type="button" onClick={() => nav('/backup')} data-testid="backup-due" className="min-h-11 self-start rounded-full bg-surface-2 px-4 text-[13px] font-semibold text-amber-text">
          {t('backup.due')}
        </button>
      )}

      <Card className="relative overflow-hidden p-5">
        <div aria-hidden="true" className="pointer-events-none absolute -top-16 -end-10 h-48 w-48 rounded-full bg-[radial-gradient(circle,var(--arizo-accent-luxury)_0%,transparent_70%)] opacity-15" />
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-ink-2">{t('dash.netWorth')}</h2>
          <button
            type="button"
            onClick={() => setSettings({ irrUnit: irrUnit === 'toman' ? 'rial' : 'toman' })}
            className="min-h-9 rounded-full bg-surface-3 px-3 text-[12px] font-semibold text-ink-2"
            data-testid="unit-switch"
          >
            {irrUnit === 'toman' ? `${t('unit.toman')} ⇄ ${t('unit.rial')}` : `${t('unit.rial')} ⇄ ${t('unit.toman')}`}
          </button>
        </div>
        <div className="mt-2 text-gold-text" data-testid="net-worth">
          <OdometerAmount minor={view?.nw.totalMinor ?? 0n} currency="IRR" className="text-[clamp(1.9rem,9.5vw,2.9rem)] font-extrabold" />
        </div>
        {view && view.nw.missingRates.length > 0 && <p className="mt-1 text-[12px] text-amber-text">{t('dash.missingRates', { c: view.nw.missingRates.join('، ') })}</p>}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface-2 p-3">
            <div className="text-[12px] text-ink-2">{t('dash.income')}</div>
            <PrivacyBlur>
              <div className="text-[15px] font-bold text-emerald-text tabular" data-testid="month-income">
                {formatMoney(view?.cf.income ?? 0n, 'IRR', lang, irrUnit)}
              </div>
            </PrivacyBlur>
          </div>
          <div className="rounded-2xl bg-surface-2 p-3">
            <div className="text-[12px] text-ink-2">{t('dash.expense')}</div>
            <PrivacyBlur>
              <div className="text-[15px] font-bold text-coral-text tabular" data-testid="month-expense">
                {formatMoney(view?.cf.expense ?? 0n, 'IRR', lang, irrUnit)}
              </div>
            </PrivacyBlur>
          </div>
        </div>
        {ratio !== null && (
          <div className="mt-3" aria-label={`${t('dash.ratio')}: ${ratio}%`}>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div className={`h-full rounded-full ${ratio > 100 ? 'bg-coral' : 'bg-cta'}`} style={{ width: `${Math.min(100, ratio)}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-ink-2">{t('dash.ratio')}</div>
          </div>
        )}
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold">{t('dash.accounts')}</h2>
          <button type="button" onClick={() => nav('/accounts')} className="min-h-11 px-2 text-[13px] font-semibold text-emerald-text">
            {t('dash.seeAll')}
          </button>
        </div>
        {view && view.live.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 text-center">
            <p className="text-[14px] text-ink-2">{t('dash.noAccounts')}</p>
            <button type="button" onClick={() => nav('/accounts/new')} className="min-h-11 rounded-2xl bg-cta px-4 font-bold text-on-accent">
              {t('dash.addAccount')}
            </button>
          </Card>
        ) : (
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]" data-testid="card-stack">
            {view?.live.map((a) => {
              const bank = bankByCode(a.bank_code);
              return (
                <div key={a.id} className="w-[82%] shrink-0 snap-center">
                  <ParallaxCard
                    finish={a.card_finish}
                    bankName={bank ? (lang === 'fa' ? bank.name_fa : bank.name_en) : t(`accounts.types.${a.type}`)}
                    accountName={a.name}
                    last4={a.card_last4}
                    balanceMinor={a.current_balance_minor}
                    currency={a.currency_code}
                    layoutId={`card-${a.id}`}
                    onSelect={() => nav(`/accounts/${a.id}`)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-bold">{t('dash.upcoming')}</h2>
        {view && view.upcoming.length === 0 ? (
          <p className="text-[13px] text-ink-2">{t('dash.noUpcoming')}</p>
        ) : (
          view?.upcoming.map((o) => (
            <Card key={`${o.kind}:${o.id}`} className={`flex items-center gap-3 p-3 ${o.overdue ? 'border-coral/50' : ''}`} data-testid="obligation-row">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold">{o.title}</span>
                <span className="text-[12px] text-ink-2">
                  {t(`obligations.${o.kind}`)} · <span className={o.overdue ? 'font-semibold text-coral-text' : ''}>{o.overdue ? t('obligations.overdue') : formatDate(o.due_at, cal, lang)}</span>
                </span>
              </span>
              <PrivacyBlur>
                <span className={`text-[14px] font-bold tabular ${o.flow > 0 ? 'text-emerald-text' : ''}`}>{formatMoney(o.amount_minor, o.currency_code, lang, irrUnit)}</span>
              </PrivacyBlur>
              <button
                type="button"
                onClick={() => {
                  if (o.kind === 'recurring') void mutate((db) => payRecurringNow(db, o.id));
                  else if (o.kind === 'installment') void mutateObligation((db) => payInstallment(db, o.id)).catch(() => nav('/loans'));
                  else nav(o.kind === 'cheque' ? '/cheques' : '/debts');
                }}
                className="min-h-11 rounded-xl bg-surface-3 px-3 text-[13px] font-bold text-emerald-text"
              >
                {o.kind === 'recurring' || o.kind === 'installment' ? t('dash.pay') : t('dash.seeAll')}
              </button>
            </Card>
          ))
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="dash-budgets">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold">{t('dash.budgets')}</h2>
          <button type="button" onClick={() => nav('/budgets')} className="min-h-11 px-2 text-[13px] font-semibold text-emerald-text">
            {report && report.budgets.length ? t('dash.seeAll') : t('dash.addBudget')}
          </button>
        </div>
        {report && report.budgets.length > 0 ? (
          <Card className="p-3">
            <BudgetList report={{ ...report, budgets: report.budgets.slice(0, 3) }} names={names} compact />
          </Card>
        ) : (
          <p className="text-[13px] text-ink-2">{t('dash.noBudgets')}</p>
        )}
      </section>

      {report && report.insights.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="dash-insights">
          <h2 className="text-[15px] font-bold">{t('dash.insights')}</h2>
          <InsightList insights={report.insights.slice(0, 3)} names={names} />
        </section>
      )}

      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold">{t('dash.recent')}</h2>
          <button type="button" onClick={() => nav('/ledger')} className="min-h-11 px-2 text-[13px] font-semibold text-emerald-text">
            {t('dash.seeAll')}
          </button>
        </div>
        {view?.recent.map((x) => (
          <TxRow
            key={x.id}
            tx={x}
            account={view.byId.get(x.account_id)}
            counterparty={x.counterparty_account_id ? view.byId.get(x.counterparty_account_id) : undefined}
            category={x.category_id ? view.catById.get(x.category_id) : undefined}
            onClick={() => nav('/ledger')}
          />
        ))}
      </section>
    </Screen>
  );
}
