// Command Center (PROMPT.md §7 #2): greeting, net worth hero with a 30-day sparkline and this month's
// in/out, quick actions, card carousel, 14-day obligations, budgets, insights and the recent stream.
import { motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useEntry } from '../../app/stores/entry';
import { usePrivacy } from '../../app/stores/privacy';
import { useSettings } from '../../app/stores/settings';
import { mutate, mutateObligation, useVault } from '../../app/stores/vault';
import { payInstallment } from '../../core/obligations/loans';
import { upcomingObligations } from '../../core/obligations/upcoming';
import { useVaultQuery } from '../../app/useVaultQuery';
import { monthRange, zonedParts } from '../../core/calendar/calendar';
import { bankByCode } from '../../core/data/banks';
import { compactMoney, formatDate, formatMoney, localDigits } from '../../core/i18n/format';
import { balanceEffect } from '../../core/ledger/ledger';
import { cashflowInBase, computeNetWorth, convertMinor } from '../../core/ledger/networth';
import { payRecurringNow } from '../../core/ledger/recurring';
import { OdometerAmount } from '../../core/motion/OdometerAmount';
import { ParallaxCard } from '../../core/motion/ParallaxCard';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import { haptic } from '../../core/motion/motion';
import { GlyphTile } from '../../core/ui/glyphs';
import { Card, Icon, IconButton, ICONS } from '../../core/ui/ui';
import type { Transaction } from '../../core/storage/schema';
import { TxRow } from '../transactions/TxRow';
import { BudgetList, InsightList, useAnalytics, useNames } from '../analytics/Analytics';
import { monotonePath } from '../analytics/charts';
import { periodAt } from '../../core/analytics/periods';
import { backupDue, backupState } from '../../core/backup/service';

const DAY = 86_400_000;

/** Net worth at the end of each of the last `n` days, walked back from current balances (display only). */
function sparkSeries(txs: readonly Transaction[], current: bigint, n: number, toBase: (t: Transaction) => bigint | null, now: number): bigint[] {
  const effects = txs.map((t) => ({ at: t.occurred_at, v: toBase(t) ?? 0n })).sort((a, b) => b.at - a.at);
  const out: bigint[] = [];
  let v = current;
  let i = 0;
  for (let k = 0; k < n; k++) {
    const edge = now - k * DAY;
    for (; i < effects.length && effects[i]!.at >= edge; i++) v -= effects[i]!.v;
    out.push(v);
  }
  return out.reverse();
}

/**
 * 30-day net worth line for the hero. A smooth monotone curve (the analytics chart's own spline) over a
 * padded scale, so one rent payment reads as a step, not a cliff to the floor; a dashed line marks where
 * the month started, a pulsing dot marks today, and the edges carry the start and end labels.
 */
function Sparkline({ values, rtl, startLabel, endLabel }: { values: bigint[]; rtl: boolean; startLabel: string; endLabel: string }) {
  const reduce = useReducedMotion();
  const hidden = usePrivacy((s) => s.hidden);
  if (values.length < 2) return null;
  let lo = values[0]!;
  let hi = values[0]!;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const W = 320;
  const H = 84;
  // Headroom: the range never fills the box, and a flat month stays a calm line in the middle.
  const range = Number(hi - lo);
  const mid = Number(lo) + range / 2;
  const half = Math.max(range * 0.65, Math.abs(mid) * 0.02, 1);
  const y = (v: bigint) => H / 2 - ((Number(v) - mid) / half) * (H / 2 - 6);
  const xs = values.map((_, k) => (k / (values.length - 1)) * W);
  const ys = values.map(y);
  const d = monotonePath(xs, ys);
  const up = values.at(-1)! >= values[0]!;
  const tone = up ? 'var(--arizo-accent-primary)' : 'var(--arizo-accent-outflow)';
  const endX = rtl ? 0 : 100;
  const endY = (ys.at(-1)! / H) * 100;
  return (
    <div className="relative" data-testid="dash-spark">
      <div className={`relative h-[84px] ${hidden ? 'blur-[8px]' : ''}`} aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`absolute inset-0 block h-full w-full overflow-visible ${rtl ? '-scale-x-100' : ''}`}>
          <defs>
            <linearGradient id="dashSparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.3" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="dashSparkLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={tone} stopOpacity="0.35" />
              <stop offset="100%" stopColor={tone} />
            </linearGradient>
          </defs>
          <line x1="0" x2={W} y1={ys[0]} y2={ys[0]} stroke="var(--arizo-text-secondary)" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
          <path d={`${d} L${W},${H} L0,${H} Z`} fill="url(#dashSparkFill)" className={reduce ? '' : 'arizo-fade'} />
          <path d={d} fill="none" stroke="url(#dashSparkLine)" strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" pathLength={1} className={reduce ? '' : 'arizo-draw'} />
        </svg>
        <span className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-1" style={{ left: `${endX}%`, top: `${endY}%`, background: tone }} />
        {!reduce && <span className="arizo-pulse absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${endX}%`, top: `${endY}%`, background: tone, opacity: 0.5 }} />}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-ink-2" aria-hidden="true">
        <span>{startLabel}</span>
        <span className="font-semibold">{endLabel}</span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const setSettings = useSettings((s) => s.set);
  const { hidden, toggle } = usePrivacy();
  const openEntry = useEntry((s) => s.open);
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
    const nw = computeNetWorth(data.accounts, data.rates, 'IRR', now);
    const inWorth = new Map(data.accounts.filter((a) => a.deleted_at === null && !a.is_archived && a.is_included_in_net_worth).map((a) => [a.id, a]));
    const spark = sparkSeries(
      data.txs.filter((x) => inWorth.has(x.account_id) && balanceEffect(x) !== 0n),
      nw.totalMinor,
      30,
      (x) => convertMinor(balanceEffect(x), inWorth.get(x.account_id)!.currency_code, 'IRR', data.rates, x.occurred_at),
      now,
    );
    return {
      live,
      nw,
      spark,
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
  const hour = zonedParts(Date.now()).hh;
  const greet = hour < 5 ? t('dash.helloNight') : hour < 12 ? t('dash.helloMorning') : hour < 18 ? t('dash.hello') : hour < 22 ? t('dash.helloEvening') : t('dash.helloNight');
  const rtl = lang === 'fa';
  const delta = view && view.spark.length > 1 ? view.spark.at(-1)! - view.spark[0]! : 0n;

  const quick = [
    { key: 'qExpense', glyph: 'arrowUp', color: 'var(--arizo-accent-outflow)', go: () => openEntry('expense') },
    { key: 'qIncome', glyph: 'arrowDown', color: 'var(--arizo-accent-primary)', go: () => openEntry('income') },
    { key: 'qTransfer', glyph: 'swap', color: 'var(--arizo-accent-info)', go: () => openEntry('transfer') },
    { key: 'qSms', glyph: 'message', color: 'var(--arizo-accent-warning)', go: () => nav('/sms/paste') },
    { key: 'qInvoice', glyph: 'invoice', color: 'var(--arizo-accent-luxury)', go: () => nav('/invoices/new') },
    { key: 'qStatement', glyph: 'printer', color: '#B48CFF', go: () => nav('/statements') },
  ];

  const section = (title: string, more?: { label: string; go: () => void }) => (
    <div className="flex items-center justify-between">
      <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
      {more && (
        <button type="button" onClick={more.go} className="min-h-11 rounded-full px-3 text-[13px] font-semibold text-emerald-text transition-colors hover:bg-surface-2">
          {more.label}
        </button>
      )}
    </div>
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
      <header className="flex min-h-12 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[conic-gradient(from_200deg,var(--arizo-accent-luxury),var(--arizo-accent-primary),var(--arizo-accent-luxury))] p-[2px]" aria-hidden="true">
            <span className="grid h-full w-full place-items-center rounded-full bg-surface-1 text-[18px] font-extrabold text-gold-text">A</span>
            <span className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full border-2 border-canvas bg-emerald" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] text-ink-2">{greet}</span>
            <h1 className="truncate text-[20px] leading-tight font-extrabold tracking-tight">{t('app.name')}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton label={hidden ? t('privacy.show') : t('privacy.hide')} pressed={hidden} onClick={toggle}>
            <Icon d={hidden ? ICONS.eyeOff : ICONS.eye} className="h-5 w-5" />
          </IconButton>
          <IconButton label={t('dash.lockNow')} onClick={() => void useVault.getState().lock()}>
            <Icon d={ICONS.lock} className="h-5 w-5" />
          </IconButton>
          <IconButton label={t('settings.title')} onClick={() => nav('/settings')}>
            <Icon d={ICONS.settings} className="h-5 w-5" />
          </IconButton>
        </div>
      </header>

      {((view && view.pending > 0) || (due && isMain)) && (
        <div className="-mt-2 flex flex-wrap gap-2">
          {view && view.pending > 0 && (
            <button type="button" onClick={() => nav('/sms')} data-testid="pending-badge" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-amber/30 bg-amber/10 px-4 text-[13px] font-semibold text-amber-text">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber" aria-hidden="true" />
              {t('dash.pendingReview', { n: view.pending })}
            </button>
          )}
          {due && isMain && (
            <button type="button" onClick={() => nav('/backup')} data-testid="backup-due" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-amber/30 bg-amber/10 px-4 text-[13px] font-semibold text-amber-text">
              <span className="h-2 w-2 rounded-full bg-amber" aria-hidden="true" />
              {t('backup.due')}
            </button>
          )}
        </div>
      )}

      {/* Hero: net worth, its 30-day line and this month's in/out. */}
      <section className="relative overflow-hidden rounded-[30px] border border-specular p-5 shadow-[var(--arizo-shadow)]" style={{ background: 'radial-gradient(130% 90% at 100% 0%, color-mix(in srgb, var(--arizo-accent-primary) 16%, transparent), transparent 55%), radial-gradient(120% 90% at 0% 100%, color-mix(in srgb, var(--arizo-accent-luxury) 14%, transparent), transparent 60%), var(--arizo-card-fill)' }}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(var(--arizo-text-primary)_1px,transparent_1px)] [background-size:14px_14px]" />
        <div className="relative flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-ink-2">{t('dash.netWorth')}</h2>
          <button
            type="button"
            onClick={() => setSettings({ irrUnit: irrUnit === 'toman' ? 'rial' : 'toman' })}
            className="min-h-9 rounded-full border border-hairline bg-surface-2/70 px-3 text-[12px] font-semibold text-ink-2 backdrop-blur"
            data-testid="unit-switch"
          >
            {irrUnit === 'toman' ? `${t('unit.toman')} ⇄ ${t('unit.rial')}` : `${t('unit.rial')} ⇄ ${t('unit.toman')}`}
          </button>
        </div>
        <div className="relative mt-1 text-ink" data-testid="net-worth">
          <OdometerAmount minor={view?.nw.totalMinor ?? 0n} currency="IRR" className="text-[clamp(2rem,10vw,3rem)] leading-tight font-extrabold tracking-tight" unitClassName="!text-[0.42em] text-ink-2" />
        </div>
        {view && view.spark.length > 1 && delta !== 0n && (
          <PrivacyBlur>
            <span className={`relative mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${delta > 0n ? 'bg-emerald/15 text-emerald-text' : 'bg-coral/15 text-coral-text'}`} data-testid="dash-delta">
              {delta > 0n ? '▲' : '▼'} {compactMoney(delta < 0n ? -delta : delta, 'IRR', lang, irrUnit)}
              <span className="font-semibold opacity-80">· {localDigits(30, lang)} {lang === 'fa' ? 'روز' : 'days'}</span>
            </span>
          </PrivacyBlur>
        )}
        {view && view.nw.missingRates.length > 0 && <p className="relative mt-1 text-[12px] text-amber-text">{t('dash.missingRates', { c: view.nw.missingRates.join('، ') })}</p>}
        <div className="relative mt-3">{view && <Sparkline values={view.spark} rtl={rtl} startLabel={formatDate(Date.now() - 29 * DAY, cal, lang)} endLabel={t('dash.today')} />}</div>
        <div className="relative mt-3 grid grid-cols-2 gap-3">
          {(
            [
              ['inThisMonth', view?.cf.income ?? 0n, 'month-income', 'arrowDown', 'var(--arizo-accent-primary)', 'text-emerald-text'],
              ['outThisMonth', view?.cf.expense ?? 0n, 'month-expense', 'arrowUp', 'var(--arizo-accent-outflow)', 'text-coral-text'],
            ] as const
          ).map(([k, v, id, g, c, tc]) => (
            <div key={k} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-hairline bg-surface-2/70 p-3 backdrop-blur">
              <div className="flex items-center gap-2">
                <GlyphTile name={g} color={c} size={30} radius={10} glyphClass="h-4 w-4" />
                <span className="truncate text-[11px] text-ink-2">
                  {t(`dash.${k}`)} · {t('dash.thisMonth')}
                </span>
              </div>
              <div className="min-w-0">
                <PrivacyBlur className="max-w-full">
                  <span className={`block truncate text-[15px] font-bold tabular ${tc}`} data-testid={id}>
                    {formatMoney(v, 'IRR', lang, irrUnit)}
                  </span>
                </PrivacyBlur>
              </div>
            </div>
          ))}
        </div>
        {ratio !== null && (
          <div className="relative mt-3" aria-label={`${t('dash.ratio')}: ${ratio}%`}>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <motion.div
                className={`h-full rounded-full ${ratio > 100 ? 'bg-coral' : 'bg-[linear-gradient(90deg,var(--arizo-accent-primary),var(--arizo-accent-luxury))]'}`}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${Math.min(100, ratio)}%` }}
                transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1], delay: 0.2 }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-ink-2">
              <span>{t('dash.ratio')}</span>
              <span className="tabular">{localDigits(`${ratio}`, lang)}{lang === 'fa' ? '٪' : '%'}</span>
            </div>
          </div>
        )}
      </section>

      {/* Quick actions */}
      <section aria-label={t('dash.quick')} className="grid grid-cols-6 gap-1.5" data-testid="dash-quick">
        {quick.map((q, i) => (
          <button
            key={q.key}
            type="button"
            onClick={() => {
              haptic.light();
              q.go();
            }}
            className="group flex min-h-11 flex-col items-center gap-1.5 rounded-2xl py-1 text-[11px] font-semibold text-ink-2 transition-transform active:scale-95"
          >
            <GlyphTile name={q.glyph} color={q.color} size={48} radius={18} pop delay={0.05 * i} className="transition-transform group-hover:-translate-y-0.5" />
            <span className="truncate">{t(`dash.${q.key}`)}</span>
          </button>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        {section(t('dash.cards'), { label: t('dash.seeAll'), go: () => nav('/accounts') })}
        {view && view.live.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 text-center">
            <GlyphTile name="wallet" color="var(--arizo-accent-luxury)" size={56} radius={20} pop />
            <p className="text-[14px] text-ink-2">{t('dash.noAccounts')}</p>
            <button type="button" onClick={() => nav('/accounts/new')} className="min-h-11 rounded-2xl bg-cta px-4 font-bold text-on-accent">
              {t('dash.addAccount')}
            </button>
          </Card>
        ) : (
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pt-1 pb-3 [scrollbar-width:none]" data-testid="card-stack">
            {view?.live.map((a, i) => {
              const bank = bankByCode(a.bank_code);
              return (
                <div key={a.id} className="arizo-rise w-[84%] shrink-0 snap-center" style={{ ['--i' as string]: i }}>
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
        {section(t('dash.upcoming'))}
        {view && view.upcoming.length === 0 ? (
          <Card className="flex items-center gap-3 p-3">
            <GlyphTile name="shieldCheck" color="var(--arizo-accent-primary)" size={40} radius={14} />
            <p className="text-[13px] text-ink-2">{t('dash.noUpcoming')}</p>
          </Card>
        ) : (
          view?.upcoming.map((o, i) => (
            <Card key={`${o.kind}:${o.id}`} className={`arizo-rise flex items-center gap-3 p-3 ${o.overdue ? 'border-coral/50' : ''}`} style={{ ['--i' as string]: i }} data-testid="obligation-row">
              <GlyphTile name={o.kind === 'cheque' ? 'cheque' : o.kind === 'installment' ? 'landmark' : o.kind === 'recurring' ? 'swap' : 'handshake'} color={o.overdue ? 'var(--arizo-accent-outflow)' : 'var(--arizo-accent-info)'} size={40} radius={14} />
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
        {section(t('dash.budgets'), { label: report && report.budgets.length ? t('dash.seeAll') : t('dash.addBudget'), go: () => nav('/budgets') })}
        {report && report.budgets.length > 0 ? (
          <Card className="p-3">
            <BudgetList report={{ ...report, budgets: report.budgets.slice(0, 3) }} names={names} compact />
          </Card>
        ) : (
          <Card className="flex items-center gap-3 p-3">
            <GlyphTile name="gauge" color="var(--arizo-accent-warning)" size={40} radius={14} />
            <p className="text-[13px] text-ink-2">{t('dash.noBudgets')}</p>
          </Card>
        )}
      </section>

      {report && report.insights.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="dash-insights">
          {section(t('dash.insights'))}
          <InsightList insights={report.insights.slice(0, 3)} names={names} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        {section(t('dash.recent'), { label: t('dash.seeAll'), go: () => nav('/ledger') })}
        <Card className="flex flex-col gap-0.5 p-2">
          {view?.recent.map((x, i) => (
            <div key={x.id} className="arizo-rise" style={{ ['--i' as string]: i }}>
              <TxRow
                tx={x}
                account={view.byId.get(x.account_id)}
                counterparty={x.counterparty_account_id ? view.byId.get(x.counterparty_account_id) : undefined}
                category={x.category_id ? view.catById.get(x.category_id) : undefined}
                onClick={() => nav('/ledger')}
              />
            </div>
          ))}
        </Card>
      </section>
    </main>
  );
}
