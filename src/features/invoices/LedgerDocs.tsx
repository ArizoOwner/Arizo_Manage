// Instant Transaction Receipt and multi-page Bank Statement, built from the existing ledger.
// The statement's table header repeats on each printed page (thead = table-header-group) and rows
// never split across pages; the chart snapshot is a vector line of daily closing balances.
import { useTranslation } from 'react-i18next';
import { dayStarts } from '../../core/analytics/periods';
import { balanceEffect } from '../../core/ledger/ledger';
import { dateCell, timeCell } from '../../core/exports/ledgerExport';
import { dailyClosings, type Statement } from '../../core/exports/statement';
import { formatDate, localDigits, type Lang } from '../../core/i18n/format';
import type { CalendarKind } from '../../core/calendar/calendar';
import type { Account, Category, Transaction } from '../../core/storage/schema';
import { isThermal, PaperMoney, QrCode, type Paper } from './paper';

interface Base {
  paper: Paper;
  lang: Lang;
  unit: 'toman' | 'rial';
  cal: CalendarKind;
}

export function ReceiptDoc({ tx, account, counterparty, category, ...p }: Base & { tx: Transaction; account: Account | undefined; counterparty: Account | undefined; category: Category | undefined }) {
  const { t } = useTranslation();
  const tt = (k: string, o?: Record<string, unknown>) => t(k, { lng: p.lang, ...o });
  const signed = balanceEffect({ ...tx, status: 'posted', deleted_at: null });
  const abs = signed < 0n ? -signed : signed;
  const m = (v: bigint) => <PaperMoney minor={v} currency={tx.currency_code} lang={p.lang} unit={p.unit} />;
  const d = (s: string) => localDigits(s, p.lang);
  const rows: [string, React.ReactNode][] = [
    [tt('receipt.type'), tt(`receipt.types.${tx.type}`)],
    [tt('receipt.account'), account?.name ?? '—'],
    ...(counterparty ? ([[tt('receipt.counterparty'), counterparty.name]] as [string, React.ReactNode][]) : []),
    ...(category ? ([[tt('receipt.category'), p.lang === 'fa' ? category.name_fa : category.name_en]] as [string, React.ReactNode][]) : []),
    ...(tx.merchant_name ? ([[tt('receipt.payee'), tx.merchant_name]] as [string, React.ReactNode][]) : []),
    [tt('receipt.date'), `${formatDate(tx.occurred_at, p.cal, p.lang)} · ${d(timeCell(tx.occurred_at))}`],
    ...(tx.external_ref_code ? ([[tt('receipt.ref'), <span className="num">{d(tx.external_ref_code)}</span>]] as [string, React.ReactNode][]) : []),
    ...(tx.note ? ([[tt('receipt.note'), tx.note]] as [string, React.ReactNode][]) : []),
  ];
  const qr = [`TX:${tx.id}`, `DATE:${dateCell(tx.occurred_at, 'jalali')} ${timeCell(tx.occurred_at)}`, `AMOUNT:${signed} ${tx.currency_code}`, tx.external_ref_code ? `REF:${tx.external_ref_code}` : ''].filter(Boolean).join('\n');
  return (
    <article className={`doc doc-${p.paper} ${isThermal(p.paper) ? 't-thermal' : 't-minimal stack'}`} dir={p.lang === 'fa' ? 'rtl' : 'ltr'} lang={p.lang === 'fa' ? 'fa-IR' : 'en'} data-testid="receipt-doc">
      <h2 className="doc-title">{tt('receipt.title')}</h2>
      <p className={`grand ${signed < 0n ? 'neg' : 'pos'}`} style={{ margin: '3mm 0' }}>
        <span className="num">{signed < 0n ? '−' : '+'}</span>
        {m(abs)}
      </p>
      {isThermal(p.paper) && <div className="rule" />}
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="muted">{k}</td>
              <td className="n" style={{ whiteSpace: 'normal' }}>
                {v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {isThermal(p.paper) && <div className="rule" />}
      <QrCode text={qr} label={tt('invoice.qr')} />
      <p className="muted">{tt('receipt.footer')}</p>
    </article>
  );
}

function SnapshotChart({ values, label }: { values: bigint[]; label: string }) {
  if (values.length < 2) return null;
  // Display geometry only: floats derived from bigint, never fed back into money.
  const nums = values.map(Number);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const pts = nums.map((v, i) => `${((i / (nums.length - 1)) * 100).toFixed(2)},${(38 - ((v - min) / span) * 34).toFixed(2)}`).join(' ');
  return (
    <div className="stmt-chart box">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={label}>
        <polyline points={pts} fill="none" stroke="#00704f" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function StatementDoc({ s, categories, ...p }: Base & { s: Statement; categories: Category[] }) {
  const { t } = useTranslation();
  const tt = (k: string, o?: Record<string, unknown>) => t(k, { lng: p.lang, ...o });
  const cat = new Map(categories.map((c) => [c.id, c]));
  const cur = s.account.currency_code;
  const m = (v: bigint) => <PaperMoney minor={v} currency={cur} lang={p.lang} unit={p.unit} />;
  const d = (x: string | number) => localDigits(x, p.lang);
  const closings = dailyClosings(s, dayStarts(s.from, s.to));
  const title = (x: Transaction) => x.merchant_name || (x.category_id && cat.get(x.category_id) ? (p.lang === 'fa' ? cat.get(x.category_id)!.name_fa : cat.get(x.category_id)!.name_en) : tt(`receipt.types.${x.type}`));
  return (
    <article className={`doc doc-${p.paper} t-minimal stack`} dir={p.lang === 'fa' ? 'rtl' : 'ltr'} lang={p.lang === 'fa' ? 'fa-IR' : 'en'} data-testid="statement-doc">
      <header className="row">
        <div className="grow">
          <h2 className="doc-title">{tt('statement.title')}</h2>
          <div style={{ fontWeight: 700 }}>{s.account.name}</div>
          {s.account.iban_sheba && <div className="num muted">{`${s.account.iban_sheba.slice(0, 4)} •••• ${s.account.iban_sheba.slice(-4)}`}</div>}
        </div>
        <div className="muted" style={{ textAlign: 'end' }}>
          <div>
            {formatDate(s.from, p.cal, p.lang)} – {formatDate(s.to - 1, p.cal, p.lang)}
          </div>
          <div>{tt('statement.rows', { n: d(s.rows.length) })}</div>
        </div>
      </header>
      <div className="row">
        {[
          [tt('statement.opening'), s.opening],
          [tt('statement.inflow'), s.inflow],
          [tt('statement.outflow'), s.outflow],
          [tt('statement.closing'), s.closing],
        ].map(([k, v]) => (
          <div key={String(k)} className="box grow">
            <div className="muted">{k as string}</div>
            <div style={{ fontWeight: 700 }}>{m(v as bigint)}</div>
          </div>
        ))}
      </div>
      <SnapshotChart values={closings} label={tt('statement.chart')} />
      <table className="stmt">
        <thead>
          <tr>
            <th>{tt('statement.date')}</th>
            <th>{tt('statement.description')}</th>
            <th className="n">{tt('statement.amount')}</th>
            <th className="n">{tt('statement.balance')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{d(dateCell(s.from, p.cal))}</td>
            <td className="muted">{tt('statement.opening')}</td>
            <td className="n" />
            <td className="n">{m(s.opening)}</td>
          </tr>
          {s.rows.map((r) => (
            <tr key={r.tx.id}>
              <td>
                <span className="num">{d(dateCell(r.tx.occurred_at, p.cal))}</span>
              </td>
              <td>{title(r.tx)}</td>
              <td className={`n ${r.delta < 0n ? 'neg' : 'pos'}`}>
                <span className="num">{r.delta < 0n ? '−' : '+'}</span>
                {m(r.delta < 0n ? -r.delta : r.delta)}
              </td>
              <td className="n">{m(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{tt('statement.footer')}</p>
    </article>
  );
}
