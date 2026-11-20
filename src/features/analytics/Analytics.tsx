// Analytics (PROMPT.md §7 #6): Jalali/Gregorian period switcher, health score, cashflow with delta,
// net worth spline, cashflow bars + savings line, drill-down donut, daily heatmap, budgets,
// goals, subscriptions and insights. All aggregation runs in the analytics worker.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router';
import { useSettings } from '../../app/stores/settings';
import { useVault } from '../../app/stores/vault';
import { leadingBlanks, monthName, toCalendarDate, WEEKDAYS_EN_MON0, WEEKDAYS_FA_SAT0, type CalendarKind } from '../../core/calendar/calendar';
import type { AnalyticsReport, CategoryTotal, Insight } from '../../core/analytics/engine';
import { UNCATEGORIZED } from '../../core/analytics/engine';
import { loadAnalyticsInput, runAnalytics } from '../../core/analytics/analyticsClient';
import { periodAt, shiftPeriod } from '../../core/analytics/periods';
import { compactMoney, formatDate, formatMoney, localDigits, type IrrUnit, type Lang } from '../../core/i18n/format';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import type { Account, Category } from '../../core/storage/schema';
import { Card, Icon, IconButton, ICONS, Screen, Segmented } from '../../core/ui/ui';
import { CashflowBars, Donut, Heatmap, NetWorthChart, Ring, type HeatCell } from './charts';

// Categorical order for slices beyond the category's own colour; text never wears these.
const OTHER_COLOR = 'var(--arizo-text-muted)';

export interface Names {
  cat: (id: string) => string;
  color: (id: string) => string;
  account: (id: string) => string;
}

export function useNames(categories: Category[] | undefined, accounts: Account[] | undefined): Names {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  return useMemo(() => {
    const c = new Map((categories ?? []).map((x) => [x.id, x]));
    const a = new Map((accounts ?? []).map((x) => [x.id, x]));
    return {
      cat: (id) => (id === UNCATEGORIZED ? t('analytics.uncategorized') : id === 'other' ? t('analytics.other') : ((lang === 'fa' ? c.get(id)?.name_fa : c.get(id)?.name_en) ?? t('analytics.other'))),
      color: (id) => (id === 'other' || id === UNCATEGORIZED ? OTHER_COLOR : (c.get(id)?.color_hex ?? OTHER_COLOR)),
      account: (id) => (id === 'other' ? t('analytics.other') : (a.get(id)?.name ?? '—')),
    };
  }, [categories, accounts, lang, t]);
}

/** Run the worker whenever the vault changes or the period moves. */
export function useAnalytics(cal: CalendarKind, y: number, m: number) {
  const open = useVault((s) => s.open);
  const rev = useVault((s) => s.rev);
  const [state, setState] = useState<{ report: AnalyticsReport | null; categories: Category[]; accounts: Account[] }>({ report: null, categories: [], accounts: [] });
  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      const input = await loadAnalyticsInput(open.db);
      const report = await runAnalytics(input, { now: Date.now(), cal, y, m });
      if (live) setState({ report, categories: input.categories, accounts: input.accounts });
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [open, rev, cal, y, m]);
  return state;
}

export function insightText(i: Insight, t: TFunction, names: Names, lang: Lang, irrUnit: IrrUnit): string {
  const amount = i.amount !== undefined ? formatMoney(i.amount, 'IRR', lang, irrUnit) : '';
  return t(`insight.${i.key}`, {
    cat: i.cat !== undefined ? (i.cat === '' ? t('budgets.overall') : names.cat(i.cat)) : '',
    pct: localDigits(i.pct ?? 0, lang),
    n: localDigits(i.n ?? 0, lang),
    days: localDigits(i.days ?? 0, lang),
    amount,
    currencies: i.currencies ?? '',
  });
}

export function InsightList({ insights, names }: { insights: Insight[]; names: Names }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  if (!insights.length) return <p className="text-[13px] text-ink-2">{t('analytics.noInsights')}</p>;
  return (
    <ul className="flex flex-col gap-2" data-testid="insights">
      {insights.map((i, k) => (
        <li key={k} className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3 text-[13px] leading-6">
          <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${i.tone === 'warn' ? 'bg-amber' : i.tone === 'good' ? 'bg-emerald' : 'bg-azure'}`} />
          <PrivacyBlur className="min-w-0">
            <span>{insightText(i, t, names, lang, irrUnit)}</span>
          </PrivacyBlur>
        </li>
      ))}
    </ul>
  );
}

const pctLabel = (n: number, lang: Lang) => (lang === 'fa' ? `${localDigits(n, lang)}٪` : `${n}%`);

function pctText(bps: number, lang: Lang): string {
  const v = Math.round(bps / 100);
  return localDigits(`${v > 0 ? '+' : v < 0 ? (lang === 'fa' ? '−' : '-') : ''}${Math.abs(v)}%`, lang).replace('%', lang === 'fa' ? '٪' : '%');
}

export function AnalyticsScreen() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  const prefCal = useSettings((s) => s.calendar);
  const [cal, setCal] = useState<CalendarKind>(prefCal);
  const [ym, setYm] = useState(() => {
    const p = periodAt(Date.now(), prefCal);
    return { y: p.y, m: p.m };
  });
  const { report, categories, accounts } = useAnalytics(cal, ym.y, ym.m);
  const names = useNames(categories, accounts);
  const [drill, setDrill] = useState<string | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const rtl = lang === 'fa';
  const money = (v: bigint) => formatMoney(v, 'IRR', lang, irrUnit);
  const now = periodAt(Date.now(), cal);
  const atNow = ym.y === now.y && ym.m === now.m;

  const move = (n: number) => {
    const p = shiftPeriod({ cal, y: ym.y, m: ym.m, start: 0, end: 0 }, n);
    setYm({ y: p.y, m: p.m });
    setDrill(null);
    setDay(null);
  };
  const switchCal = (next: CalendarKind) => {
    const p = periodAt(Date.now(), next);
    setCal(next);
    setYm({ y: p.y, m: p.m });
    setDrill(null);
    setDay(null);
  };

  const heatCells = useMemo<HeatCell[]>(() => {
    if (!report) return [];
    const blanks = leadingBlanks(cal, report.period.y, report.period.m, cal === 'jalali' ? 'sat' : 'mon');
    return [
      ...Array.from({ length: blanks }, () => ({ day: null, value: 0n, label: '', start: 0 })),
      ...report.heatmap.map((d, i) => {
        const date = formatDate(d.start, cal, lang, { withYear: false });
        return { day: i + 1, value: d.expense, start: d.start, label: d.expense > 0n ? t('analytics.dayTotal', { date, amount: money(d.expense) }) : t('analytics.noDaySpend', { date }) };
      }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, cal, lang, irrUnit, t]);

  const title = localDigits(`${monthName(cal, ym.m, lang)} ${ym.y}`, lang);
  const r = report;
  const empty = r && r.cashflow.income === 0n && r.cashflow.expense === 0n && r.months.every((x) => x.income === 0n && x.expense === 0n);
  const drillCat: CategoryTotal | undefined = r?.categories.find((c) => c.id === drill);
  const pickedDay = day !== null ? r?.heatmap.find((d) => d.start === day) : undefined;
  const monthLabel = (y: number, m: number) => localDigits(monthName(cal, m, lang).slice(0, lang === 'fa' ? 6 : 3), lang) + (m === 1 ? ` ${localDigits(String(y).slice(-2), lang)}` : '');

  return (
    <Screen title={t('analytics.title')}>
      <div className="flex flex-col gap-3">
        <Segmented label={t('analytics.calendar')} value={cal} onChange={switchCal} options={[{ value: 'jalali', label: t('calendar.jalali') }, { value: 'gregorian', label: t('calendar.gregorian') }]} />
        <div className="flex items-center justify-between">
          <IconButton label={t('analytics.prev')} onClick={() => move(-1)}>
            <Icon d={ICONS.back} className="h-[22px] w-[22px] rtl:rotate-180" />
          </IconButton>
          <h2 className="text-[17px] font-bold" data-testid="period-title" aria-live="polite">
            {title}
          </h2>
          <span className={atNow ? 'invisible' : ''}>
            <IconButton label={t('analytics.next')} onClick={() => move(1)}>
              <Icon d={ICONS.back} className="h-[22px] w-[22px] rotate-180 rtl:rotate-0" />
            </IconButton>
          </span>
        </div>
      </div>

      {!r && <p className="py-8 text-center text-[14px] text-ink-2">{t('analytics.loading')}</p>}
      {r && empty && <p className="py-8 text-center text-[14px] text-ink-2" data-testid="analytics-empty">{t('analytics.empty')}</p>}

      {r && (
        <>
          <Card className="flex flex-col gap-4" data-testid="analytics-summary">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['income', r.cashflow.income, 'text-emerald-text'],
                  ['expense', r.cashflow.expense, 'text-coral-text'],
                  ['saved', r.cashflow.net, r.cashflow.net < 0n ? 'text-coral-text' : 'text-gold-text'],
                ] as const
              ).map(([k, v, c]) => (
                <div key={k} className="min-w-0 rounded-2xl bg-surface-2 p-2.5">
                  <div className="text-[12px] text-ink-2">{t(`analytics.${k}`)}</div>
                  <PrivacyBlur className="max-w-full">
                    <div className={`truncate text-[13px] font-bold tabular ${c}`} data-testid={`sum-${k}`}>
                      {compactMoney(v, 'IRR', lang, irrUnit)}
                    </div>
                  </PrivacyBlur>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-ink-2">
              {r.cashflow.deltaExpenseBps === null ? t('analytics.noPrev') : t('analytics.vsPrev', { pct: pctText(r.cashflow.deltaExpenseBps, lang) })}
              {r.cashflow.savingsBps !== null && ` · ${t('analytics.savingsRate')}: ${pctText(r.cashflow.savingsBps, lang).replace('+', '')}`}
            </p>
          </Card>

          <Card className="flex items-center gap-4" data-testid="health">
            <div className="relative grid h-20 w-20 shrink-0 place-items-center">
              <Ring higherIsBetter pct={r.health.score ?? 0} thresholds={[]} size={80} label={r.health.score === null ? t('analytics.healthNone') : t('analytics.healthOf', { n: localDigits(r.health.score, lang) })} />
              <span aria-hidden="true" className="absolute text-[20px] font-extrabold tabular">
                {r.health.score === null ? '—' : localDigits(r.health.score, lang)}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 className="text-[15px] font-bold">{t('analytics.health')}</h2>
              {r.health.score === null ? (
                <p className="text-[12px] text-ink-2">{t('analytics.healthNone')}</p>
              ) : (
                <dl className="grid grid-cols-[1fr_auto] gap-x-2 text-[12px] text-ink-2">
                  {(Object.entries(r.health.parts) as [keyof typeof r.health.parts, number][]).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="truncate">{t(`analytics.parts.${k}`)}</dt>
                      <dd className="font-semibold text-ink tabular">{localDigits(`${v}/${{ savings: 30, emergency: 25, debt: 20, budgets: 15, trend: 10 }[k]}`, lang)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </Card>

          {r.netWorth.length > 1 && (() => {
            const first = r.netWorth[0]!.value;
            const last = r.netWorth.at(-1)!.value;
            const vals = r.netWorth.map((p) => p.value);
            const hi = vals.reduce((a, b) => (b > a ? b : a));
            const lo = vals.reduce((a, b) => (b < a ? b : a));
            const delta = last - first;
            const pct = first !== 0n ? Number((delta * 10_000n) / (first < 0n ? -first : first)) / 100 : null;
            const sign = delta > 0n ? '+' : delta < 0n ? '−' : '';
            const abs = (v: bigint) => (v < 0n ? -v : v);
            return (
              <Card className="flex flex-col gap-3" data-testid="networth-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-[15px] font-bold">{t('analytics.netWorth')}</h2>
                    <PrivacyBlur className="block">
                      <div className="text-[24px] leading-tight font-extrabold text-gold-text tabular">{money(last)}</div>
                    </PrivacyBlur>
                  </div>
                  <PrivacyBlur>
                    <div
                      className={`flex flex-col items-end gap-0.5 rounded-2xl px-3 py-1.5 text-[12px] font-bold tabular ${delta >= 0n ? 'bg-emerald/15 text-emerald-text' : 'bg-coral/15 text-coral-text'}`}
                      data-testid="networth-change"
                    >
                      {pct !== null && (
                        <span className="whitespace-nowrap text-[14px]">
                          {delta >= 0n ? '▲' : '▼'} <bdi dir="ltr">{`${sign}${localDigits(Math.abs(pct).toFixed(1), lang).replace('.', lang === 'fa' ? '٫' : '.')}${lang === 'fa' ? '٪' : '%'}`}</bdi>
                        </span>
                      )}
                      <span className="whitespace-nowrap">{`${sign} ${compactMoney(abs(delta), 'IRR', lang, irrUnit)}`}</span>
                    </div>
                  </PrivacyBlur>
                </div>
                <NetWorthChart
                  testId="networth-chart"
                  rtl={rtl}
                  label={t('analytics.netWorthAlt', { from: money(first), to: money(last) })}
                  points={r.netWorth}
                  fmt={money}
                  compact={(v) => compactMoney(v, 'IRR', lang, irrUnit)}
                  dayLabel={(at) => formatDate(at, cal, lang)}
                  tickLabel={(prev, at) => {
                    const m = toCalendarDate(at, cal).m;
                    return prev === null || toCalendarDate(prev, cal).m !== m ? monthName(cal, m, lang) : null;
                  }}
                />
                <PrivacyBlur className="block">
                  <dl className="grid grid-cols-3 gap-2 text-center text-[12px]" data-testid="networth-stats">
                    {[
                      [t('analytics.nwStart'), money(first), 'text-ink'],
                      [t('analytics.nwHigh'), money(hi), 'text-emerald-text'],
                      [t('analytics.nwLow'), money(lo), 'text-coral-text'],
                    ].map(([k, v, c]) => (
                      <div key={k} className="flex flex-col gap-0.5 rounded-2xl bg-surface-2 px-2 py-2">
                        <dt className="text-ink-2">{k}</dt>
                        <dd className={`font-bold tabular ${c}`}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </PrivacyBlur>
              </Card>
            );
          })()}

          <Card className="flex flex-col gap-2">
            <h2 className="text-[15px] font-bold">{t('analytics.cashflow')}</h2>
            <CashflowBars
              rtl={rtl}
              legend={[t('analytics.income'), t('analytics.expense'), t('analytics.saved')]}
              label={t('analytics.cashflowAlt', {
                list: r.months.map((x) => `${monthName(cal, x.m, lang)}: ${t('analytics.income')} ${money(x.income)}, ${t('analytics.expense')} ${money(x.expense)}`).join('؛ '),
              })}
              groups={r.months.map((x) => ({
                label: monthLabel(x.y, x.m),
                income: x.income,
                expense: x.expense,
                net: x.net,
                lines: [`${t('analytics.income')}: ${money(x.income)}`, `${t('analytics.expense')}: ${money(x.expense)}`, `${t('analytics.saved')}: ${money(x.net)}`],
              }))}
            />
            <button type="button" onClick={() => setTable((v) => !v)} aria-expanded={table} className="min-h-11 self-start text-[13px] font-semibold text-azure-text">
              {t('analytics.table')}
            </button>
            {table && (
              <PrivacyBlur className="block">
                <table className="w-full text-[12px]" data-testid="cashflow-table">
                  <thead className="text-ink-2">
                    <tr>
                      <th className="py-1 text-start font-semibold">{t('analytics.month')}</th>
                      <th className="py-1 text-end font-semibold">{t('analytics.income')}</th>
                      <th className="py-1 text-end font-semibold">{t('analytics.expense')}</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {r.months.map((x) => (
                      <tr key={`${x.y}-${x.m}`} className="border-t border-hairline">
                        <td className="py-1.5">{localDigits(`${monthName(cal, x.m, lang)} ${x.y}`, lang)}</td>
                        <td className="py-1.5 text-end">{compactMoney(x.income, 'IRR', lang, irrUnit)}</td>
                        <td className="py-1.5 text-end">{compactMoney(x.expense, 'IRR', lang, irrUnit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PrivacyBlur>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-[15px] font-bold">{t('analytics.categories')}</h2>
            {r.categories.length === 0 ? (
              <p className="text-[13px] text-ink-2">{t('analytics.noSpend')}</p>
            ) : (
              <>
                <Donut
                  selected={drill}
                  onSelect={(id) => setDrill((d) => (d === id ? null : id))}
                  label={t('analytics.categoriesAlt', { list: r.categories.map((c) => `${names.cat(c.id)} ${money(c.total)}`).join('، ') })}
                  slices={r.categories.map((c) => ({ id: c.id, value: c.total, color: names.color(c.id) }))}
                  center={
                    <PrivacyBlur>
                      <span className="flex flex-col">
                        <span className="text-[11px] text-ink-2">{drillCat ? names.cat(drillCat.id) : t('analytics.allCategories')}</span>
                        <span className="text-[14px] font-bold tabular">{compactMoney(drillCat?.total ?? r.cashflow.expense, 'IRR', lang, irrUnit)}</span>
                      </span>
                    </PrivacyBlur>
                  }
                />
                <ul className="flex flex-col" data-testid="category-list">
                  {r.categories.map((c) => {
                    const pct = r.cashflow.expense > 0n ? Number((c.total * 100n) / r.cashflow.expense) : 0;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          aria-expanded={drill === c.id}
                          onClick={() => setDrill((d) => (d === c.id ? null : c.id))}
                          className="flex min-h-11 w-full items-center gap-3 text-start text-[14px]"
                        >
                          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: names.color(c.id) }} />
                          <span className="min-w-0 flex-1 truncate">{names.cat(c.id)}</span>
                          <span className="text-[12px] text-ink-2 tabular">{pctLabel(pct, lang)}</span>
                          <PrivacyBlur>
                            <span className="font-semibold tabular">{money(c.total)}</span>
                          </PrivacyBlur>
                        </button>
                        {drill === c.id && (
                          <div className="mb-2 flex flex-col gap-1 rounded-2xl bg-surface-2 p-3" data-testid="drilldown">
                            {c.children.map((ch) => (
                              <div key={ch.id} className="flex flex-col gap-1">
                                {(c.children.length > 1 || ch.id !== c.id) && (
                                  <div className="flex items-center justify-between text-[13px] font-semibold">
                                    <span className="truncate">{names.cat(ch.id)}</span>
                                    <PrivacyBlur>
                                      <span className="tabular">{money(ch.total)}</span>
                                    </PrivacyBlur>
                                  </div>
                                )}
                                {ch.txs.slice(0, 8).map((x) => (
                                  <div key={`${x.id}-${ch.id}`} className="flex items-center justify-between gap-2 text-[12px] text-ink-2">
                                    <span className="min-w-0 truncate">
                                      {formatDate(x.at, cal, lang, { withYear: false })} · {x.merchant || '—'}
                                    </span>
                                    <PrivacyBlur>
                                      <span className="tabular">{money(x.amount)}</span>
                                    </PrivacyBlur>
                                  </div>
                                ))}
                              </div>
                            ))}
                            <button type="button" onClick={() => nav('/ledger')} className="min-h-10 self-start text-[12px] font-semibold text-azure-text">
                              {t('analytics.txs')}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Card>


          <Card className="flex flex-col gap-3">
            <h2 className="text-[15px] font-bold">{t('analytics.heatmap')}</h2>
            <Heatmap cells={heatCells} weekdays={cal === 'jalali' ? WEEKDAYS_FA_SAT0 : WEEKDAYS_EN_MON0} label={t('analytics.heatmapAlt')} digits={(n) => localDigits(n, lang)} onPick={(c) => setDay((d) => (d === c.start ? null : c.start))} picked={day} />
            {pickedDay && (
              <p className="text-[13px]" role="status">
                <PrivacyBlur>
                  <span>{heatCells.find((c) => c.start === pickedDay.start)?.label}</span>
                </PrivacyBlur>
              </p>
            )}
          </Card>

          {r.budgets.length > 0 && (
            <Card className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[15px] font-bold">{t('analytics.budgets')}</h2>
                <button type="button" onClick={() => nav('/budgets')} className="min-h-11 px-2 text-[13px] font-semibold text-emerald-text">
                  {t('analytics.manage')}
                </button>
              </div>
              <BudgetList report={r} names={names} compact />
            </Card>
          )}

          {r.goals.length > 0 && (
            <Card className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[15px] font-bold">{t('analytics.goals')}</h2>
                <button type="button" onClick={() => nav('/goals')} className="min-h-11 px-2 text-[13px] font-semibold text-emerald-text">
                  {t('analytics.manage')}
                </button>
              </div>
              {r.goals.map((g) => (
                <div key={g.id} className="flex flex-col gap-1">
                  <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={t('goals.bar', { n: localDigits(g.pct, lang) })}>
                    <div className="h-full rounded-full bg-gold-mark" style={{ width: `${g.pct}%` }} />
                  </div>
                  <div className="flex justify-between text-[12px] text-ink-2">
                    <span className="truncate">{g.name}</span>
                    <span className="tabular">{pctLabel(g.pct, lang)}</span>
                  </div>
                </div>
              ))}
            </Card>
          )}

          <Card className="flex flex-col gap-3">
            <h2 className="text-[15px] font-bold">{t('analytics.subs')}</h2>
            {r.subscriptions.length === 0 ? (
              <p className="text-[13px] text-ink-2">{t('analytics.subsNone')}</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="subscriptions">
                {r.subscriptions.map((s) => (
                  <li key={s.merchant} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[14px] font-semibold">{s.merchant}</span>
                      <span className="text-[12px] text-ink-2">
                        {t(`analytics.cadence.${s.cadence}`)} · {t('analytics.subNext', { date: formatDate(s.next, cal, lang, { withYear: false }) })}
                      </span>
                    </span>
                    <PrivacyBlur>
                      <span className="text-[14px] font-bold tabular">{money(s.amount)}</span>
                    </PrivacyBlur>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-[15px] font-bold">{t('analytics.insights')}</h2>
            <InsightList insights={r.insights} names={names} />
          </Card>
        </>
      )}
    </Screen>
  );
}

export function BudgetList({ report, names, compact }: { report: AnalyticsReport; names: Names; compact?: boolean }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  return (
    <ul className="flex flex-col gap-3" data-testid="budget-list">
      {report.budgets.map((b) => {
        const money = (v: bigint) => formatMoney(v, b.currency_code, lang, irrUnit);
        const name = b.category_id === null ? t('budgets.overall') : names.cat(b.category_id);
        return (
          <li key={b.id} className="flex items-center gap-3" data-testid="budget-row">
            <div className="relative grid place-items-center">
              <Ring pct={b.usedPct} thresholds={[50, 80]} size={compact ? 52 : 64} label={`${name}: ${t('budgets.ring', { n: localDigits(b.usedPct, lang) })}`} />
              <span aria-hidden="true" className="absolute text-[11px] font-bold tabular">
                {pctLabel(Math.min(b.usedPct, 999), lang)}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12px] text-ink-2">
              <span className="truncate text-[14px] font-semibold text-ink">{name}</span>
              <PrivacyBlur>
                <span className="tabular">{t('budgets.spent', { spent: money(b.spent), limit: money(b.effectiveLimit) })}</span>
              </PrivacyBlur>
              <PrivacyBlur>
                <span className={b.remaining < 0n ? 'text-coral-text' : 'text-emerald-text'} data-testid="budget-safe">
                  {b.remaining < 0n ? t('budgets.over', { amount: money(-b.remaining) }) : t('budgets.safe', { amount: money(b.safePerDay) })}
                </span>
              </PrivacyBlur>
              {!compact && (
                <>
                  <PrivacyBlur>
                    <span className={b.projectedOver ? 'text-amber-text' : ''}>{t('budgets.projected', { amount: money(b.projected) })}</span>
                  </PrivacyBlur>
                  {b.carry > 0n && (
                    <PrivacyBlur>
                      <span>{t('budgets.carry', { amount: money(b.carry) })}</span>
                    </PrivacyBlur>
                  )}
                </>
              )}
              {b.alert !== null && <span className="font-semibold text-amber-text">{t('budgets.alert', { n: localDigits(b.alert, lang) })}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

