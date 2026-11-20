// Ledger-side outputs: the Instant Receipt sheet (from a ledger row), the Account Statement screen
// (#/accounts/:id/statement: period, preview, print/PNG, .xlsx/.csv export) and the CSV Import Wizard
// (#/import: file → column mapping → preview with errors and duplicates → post through the ledger).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { usePrivacy } from '../../app/stores/privacy';
import { useSettings } from '../../app/stores/settings';
import { mutate } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { periodAt, shiftPeriod, statementRange, type StatementSpan } from '../../core/analytics/periods';
import { formatMinor } from '../../core/currency/money';
import { csvBytes, parseCsv, type Cell } from '../../core/exports/csv';
import { commitImport, guessMapping, previewImport, type ColumnMap, type ImportField, type PreviewRow } from '../../core/exports/csvImport';
import { dateCell, EXPORT_HEADERS, exportableTxs, ledgerRows, timeCell } from '../../core/exports/ledgerExport';
import { buildStatement } from '../../core/exports/statement';
import { xlsxInWorker } from '../../core/exports/xlsxClient';
import { formatDate, formatMoney, localDigits } from '../../core/i18n/format';
import { monthName, toCalendarDate } from '../../core/calendar/calendar';
import { bankByCode } from '../../core/data/banks';
import { deliverFile } from '../../core/print/deliver';
import type { Account, Category, Transaction } from '../../core/storage/schema';
import { Button, Card, Screen, Segmented, Sheet, Toggle } from '../../core/ui/ui';
import { AccountSelect, BackButton, liveAccounts } from '../obligations/shared';
import { useReauth } from '../security/ReauthSheet';
import { DocActions } from './DocActions';
import { ReceiptDoc, StatementDoc } from './LedgerDocs';
import { useDocLang, type Paper } from './paper';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function ReceiptSheet({ tx, accounts, categories, onClose }: { tx: Transaction; accounts: Account[]; categories: Category[]; onClose: () => void }) {
  const { t } = useTranslation();
  const doc = useDocLang();
  const cal = useSettings((s) => s.calendar);
  const [paper, setPaper] = useState<Paper>('80');
  const acc = new Map(accounts.map((a) => [a.id, a]));
  return (
    <Sheet open onClose={onClose} title={t('receipt.title')}>
      <DocActions
        name={`receipt-${dateCell(tx.occurred_at, 'gregorian').replace(/\//g, '')}-${timeCell(tx.occurred_at).replace(':', '')}`}
        papers={['80', '58', 'A5']}
        paper={paper}
        onPaper={setPaper}
        render={(p) => <ReceiptDoc tx={tx} account={acc.get(tx.account_id)} counterparty={tx.counterparty_account_id ? acc.get(tx.counterparty_account_id) : undefined} category={categories.find((c) => c.id === tx.category_id)} paper={p} lang={doc.lang} unit={doc.unit} cal={cal} />}
      />
    </Sheet>
  );
}

/** Exports a table as .xlsx (worker) or UTF-8 BOM .csv; re-auth first, refused under stealth blur. */
export function useExport() {
  const { t } = useTranslation();
  const hidden = usePrivacy((s) => s.hidden);
  const { request, sheet } = useReauth();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (kind: 'xlsx' | 'csv', name: string, sheetName: string, rows: Cell[][], amountCols: number[], rtl: boolean) => {
    if (hidden) return setMsg(t('docs.privacyOn'));
    request(async () => {
      try {
        const bytes = kind === 'csv' ? csvBytes(rows) : await xlsxInWorker([{ name: sheetName, rows, amountCols, rtl }]);
        const r = await deliverFile(bytes, `${name}.${kind}`, kind === 'csv' ? 'text/csv;charset=utf-8' : XLSX_MIME, name);
        if (r !== 'cancelled') setMsg(t(r === 'shared' ? 'docs.shared' : 'docs.saved'));
      } catch (e) {
        setMsg(t('docs.failed', { e: e instanceof Error ? e.message : String(e) }));
      }
    });
  };
  return { run, msg, sheet };
}

export function StatementScreen() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const doc = useDocLang();
  const cal = useSettings((s) => s.calendar);
  const [offset, setOffset] = useState(0);
  const [paper, setPaper] = useState<Paper>('A4');
  const { run, msg, sheet } = useExport();
  const { data } = useVaultQuery(async (db) => ({ account: await db.get('accounts', id), txs: await db.find('transactions', { account_id: id }), categories: await db.find('categories') }), [id]);
  const period = useMemo(() => shiftPeriod(periodAt(Date.now(), cal), offset), [cal, offset]);
  const s = useMemo(() => (data?.account ? buildStatement(data.account, data.txs, period.start, period.end) : null), [data, period]);
  if (!data) return null;
  if (!data.account || !s) return <Screen title={t('statement.title')} actions={<BackButton />}>{null}</Screen>;
  const a = data.account;
  const label = `${monthName(cal, period.m, doc.lang)} ${localDigits(period.y, doc.lang)}`;
  const fileName = `statement-${a.name}-${period.y}-${String(period.m).padStart(2, '0')}`;
  const rows = (): Cell[][] => {
    const h = EXPORT_HEADERS[doc.lang];
    const body = ledgerRows(exportableTxs(s.rows.map((r) => r.tx)), { accounts: [a], categories: data.categories, lang: doc.lang, cal });
    const bal = doc.lang === 'fa' ? 'مانده' : 'Balance';
    return [
      [...h, bal],
      ...body.map((r, i) => [...r, formatMinor(s.rows[i]!.balance, a.currency_code, '')]),
      [],
      [doc.lang === 'fa' ? 'مانده اول دوره' : 'Opening balance', formatMinor(s.opening, a.currency_code, '')],
      [doc.lang === 'fa' ? 'مانده پایان دوره' : 'Closing balance', formatMinor(s.closing, a.currency_code, '')],
    ];
  };
  return (
    <Screen title={t('statement.title')} actions={<BackButton />}>
      <Card className="flex items-center justify-between gap-2">
        <Button variant="ghost" className="!min-h-11 !px-3" onClick={() => setOffset((o) => o - 1)} aria-label={t('analytics.prev')}>
          <span className="rtl:rotate-180">‹</span>
        </Button>
        <span className="text-[15px] font-bold" data-testid="statement-period">
          {label}
        </span>
        <Button variant="ghost" className="!min-h-11 !px-3" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0} aria-label={t('analytics.next')}>
          <span className="rtl:rotate-180">›</span>
        </Button>
      </Card>
      <DocActions name={fileName} papers={['A4', 'A5']} paper={paper} onPaper={setPaper} render={(p) => <StatementDoc s={s} categories={data.categories} paper={p} lang={doc.lang} unit={doc.unit} cal={cal} />} />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" data-testid="statement-xlsx" onClick={() => run('xlsx', fileName, a.name, rows(), [6, 11], doc.lang === 'fa')}>
          {t('docs.xlsx')}
        </Button>
        <Button variant="secondary" data-testid="statement-csv" onClick={() => run('csv', fileName, a.name, rows(), [], doc.lang === 'fa')}>
          {t('docs.csv')}
        </Button>
      </div>
      {msg && (
        <p role="status" className="text-[13px] font-semibold text-ink-2">
          {msg}
        </p>
      )}
      {sheet}
    </Screen>
  );
}

/** Whole-ledger export (#/export): all accounts or one, a calendar month or everything, .xlsx or .csv. */
export function ExportScreen() {
  const { t } = useTranslation();
  const doc = useDocLang();
  const cal = useSettings((s) => s.calendar);
  const { run, msg, sheet } = useExport();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [range, setRange] = useState<'month' | 'all'>('month');
  const { data } = useVaultQuery(async (db) => ({ accounts: await db.find('accounts'), txs: await db.find('transactions'), categories: await db.find('categories') }));
  if (!data) return null;
  const p = periodAt(Date.now(), cal);
  const txs = exportableTxs(data.txs.filter((x) => !accountId || x.account_id === accountId), range === 'month' ? p.start : -Infinity, range === 'month' ? p.end : Infinity);
  const rows = (): Cell[][] => [EXPORT_HEADERS[doc.lang], ...ledgerRows(txs, { accounts: data.accounts, categories: data.categories, lang: doc.lang, cal })];
  const name = `arizo-ledger-${range === 'month' ? `${p.y}-${String(p.m).padStart(2, '0')}` : 'all'}`;
  return (
    <Screen title={t('export.title')} actions={<BackButton />}>
      <AccountSelect label={t('import.account')} accounts={liveAccounts(data.accounts)} value={accountId} onChange={setAccountId} allowNone={t('export.allAccounts')} />
      <Segmented label={t('export.range')} value={range} onChange={setRange} options={[{ value: 'month', label: `${monthName(cal, p.m, doc.lang)} ${localDigits(p.y, doc.lang)}` }, { value: 'all', label: t('export.everything') }]} />
      <p className="text-[13px] text-ink-2" data-testid="export-count">
        {t('export.count', { n: localDigits(txs.length, doc.lang) })}
      </p>
      <p className="text-[12px] text-ink-2">{t('export.note')}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button data-testid="export-xlsx" disabled={!txs.length} onClick={() => run('xlsx', name, t('export.sheet'), rows(), [6], doc.lang === 'fa')}>
          {t('docs.xlsx')}
        </Button>
        <Button variant="secondary" data-testid="export-csv" disabled={!txs.length} onClick={() => run('csv', name, t('export.sheet'), rows(), [], doc.lang === 'fa')}>
          {t('docs.csv')}
        </Button>
      </div>
      {msg && (
        <p role="status" className="text-[13px] font-semibold text-ink-2" data-testid="export-message">
          {msg}
        </p>
      )}
      {sheet}
    </Screen>
  );
}

// ---------------- CSV Import Wizard ----------------

const FIELDS: ImportField[] = ['date', 'time', 'amount', 'debit', 'credit', 'type', 'category', 'payee', 'note', 'reference'];

export function ImportScreen() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const { data } = useVaultQuery(async (db) => ({ accounts: await db.find('accounts'), categories: await db.find('categories') }));
  const accounts = liveAccounts(data?.accounts);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [header, setHeader] = useState(true);
  const [map, setMap] = useState<ColumnMap>({});
  const [accountId, setAccountId] = useState<string | null>(null);
  const [fileCal, setFileCal] = useState(cal);
  const [unit, setUnit] = useState<'rial' | 'toman'>('rial');
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [done, setDone] = useState<{ posted: number; skipped: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const account = accounts.find((a) => a.id === (accountId ?? accounts[0]?.id));
  const cols = rows?.[0]?.length ?? 0;
  const hasAmount = map.amount !== undefined || map.debit !== undefined || map.credit !== undefined;

  const runPreview = async () => {
    if (!rows || !account || !data) return;
    const existing = await mutate((db) => db.find('transactions', { account_id: account.id }));
    setPreview(previewImport(rows, map, { account, calendar: fileCal, unit, categories: data.categories, header }, existing));
  };

  return (
    <Screen title={t('import.title')} actions={<BackButton />}>
      <Card className="flex flex-col gap-3">
        <h2 className="text-[15px] font-bold">{t('import.step1')}</h2>
        <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-2xl bg-surface-3 text-[15px] font-semibold">
          {t('import.pick')}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            data-testid="import-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > 5 * 1024 * 1024) return setErr(t('import.tooLarge'));
              const parsed = parseCsv(await f.text());
              if (!parsed.length) return setErr(t('import.empty'));
              setErr(null);
              setRows(parsed.slice(0, 5001));
              setMap(guessMapping(parsed[0]!));
              setPreview(null);
              setDone(null);
            }}
          />
        </label>
        {rows && <p className="text-[13px] text-ink-2">{t('import.loaded', { n: localDigits(rows.length - (header ? 1 : 0), lang) })}</p>}
        {err && (
          <p role="alert" className="text-[13px] font-semibold text-coral-text">
            {err}
          </p>
        )}
      </Card>

      {rows && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-[15px] font-bold">{t('import.step2')}</h2>
          <AccountSelect label={t('import.account')} accounts={accounts} value={account?.id ?? null} onChange={setAccountId} testId="import-account" />
          <Toggle label={t('import.header')} checked={header} onChange={setHeader} />
          <Segmented label={t('import.calendar')} value={fileCal} onChange={setFileCal} options={[{ value: 'jalali', label: t('calendar.jalali') }, { value: 'gregorian', label: t('calendar.gregorian') }]} />
          {account?.currency_code === 'IRR' && <Segmented label={t('unit.label')} value={unit} onChange={setUnit} options={[{ value: 'rial', label: t('unit.rial') }, { value: 'toman', label: t('unit.toman') }]} />}
          <div className="grid grid-cols-2 gap-2">
            {FIELDS.map((f) => (
              <label key={f} className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-ink-2">{t(`import.fields.${f}`)}</span>
                <select
                  value={map[f] ?? ''}
                  onChange={(e) => setMap((m) => ({ ...m, [f]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  className="min-h-11 rounded-xl bg-surface-3 px-2 text-[13px] text-ink"
                  data-testid={`map-${f}`}
                >
                  <option value="">—</option>
                  {Array.from({ length: cols }, (_, i) => (
                    <option key={i} value={i}>
                      {header ? rows[0]![i] || `#${i + 1}` : `#${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <Button onClick={() => void runPreview()} disabled={map.date === undefined || !hasAmount || !account} data-testid="import-preview">
            {t('import.previewBtn')}
          </Button>
        </Card>
      )}

      {preview && account && (
        <Card className="flex flex-col gap-3" data-testid="import-preview-card">
          <h2 className="text-[15px] font-bold">{t('import.step3')}</h2>
          <p className="text-[13px] text-ink-2" data-testid="import-summary">
            {t('import.summary', {
              ok: localDigits(preview.filter((p) => p.ok && !p.duplicate).length, lang),
              dup: localDigits(preview.filter((p) => p.duplicate).length, lang),
              bad: localDigits(preview.filter((p) => !p.ok).length, lang),
            })}
          </p>
          <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto text-[13px]">
            {preview.slice(0, 200).map((p) => (
              <li key={p.line} className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 ${p.ok && !p.duplicate ? 'bg-surface-2' : 'bg-surface-3 text-ink-2'}`}>
                <span className="shrink-0 tabular">{localDigits(p.line, lang)}</span>
                <span className="min-w-0 flex-1 truncate">{p.ok ? `${p.occurred_at ? formatDate(p.occurred_at, cal, lang) : ''} · ${p.merchant_name || '—'}` : t(`import.errors.${p.error}`)}</span>
                {p.ok && p.amount_minor !== undefined && <span className={`shrink-0 tabular ${p.type === 'expense' ? '' : 'text-emerald-text'}`}>{formatMoney(p.amount_minor, account.currency_code, lang, irrUnit)}</span>}
                {p.duplicate && <span className="shrink-0 text-amber-text">{t('import.duplicate')}</span>}
              </li>
            ))}
          </ol>
          <Button
            data-testid="import-commit"
            disabled={!preview.some((p) => p.ok && !p.duplicate)}
            onClick={async () => {
              setDone(await mutate((db) => commitImport(db, account.id, preview)));
              setPreview(null);
              setRows(null);
            }}
          >
            {t('import.commit')}
          </Button>
        </Card>
      )}
      {done && (
        <p role="status" className="rounded-2xl bg-surface-2 p-3 text-[14px] font-semibold text-emerald-text" data-testid="import-done">
          {t('import.done', { n: localDigits(done.posted, lang), s: localDigits(done.skipped, lang) })}
        </p>
      )}
    </Screen>
  );
}

/**
 * Batch statements (#/statements): pick a week, month or year and any set of accounts and cards
 * (one tap selects every account of a bank), then print them in one job (one account per sheet),
 * save as PDF through the system print dialog, or export one PNG per account.
 */
export function BatchStatementScreen() {
  const { t } = useTranslation();
  const doc = useDocLang();
  const cal = useSettings((s) => s.calendar);
  const [span, setSpan] = useState<StatementSpan>('month');
  const [offset, setOffset] = useState(0);
  const [paper, setPaper] = useState<Paper>('A4');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const { data } = useVaultQuery(async (db) => ({ accounts: await db.find('accounts'), txs: await db.find('transactions'), categories: await db.find('categories') }), []);
  const range = useMemo(() => statementRange(span, Date.now(), offset, cal), [span, offset, cal]);
  const accounts = useMemo(() => liveAccounts(data?.accounts), [data]);
  const chosen = picked ?? new Set(accounts.map((a) => a.id));
  const groups = useMemo(() => {
    const m = new Map<string, Account[]>();
    for (const a of accounts) m.set(a.bank_code ?? '', [...(m.get(a.bank_code ?? '') ?? []), a]);
    return [...m];
  }, [accounts]);
  const statements = useMemo(() => (data ? accounts.filter((a) => chosen.has(a.id)).map((a) => buildStatement(a, data.txs, range.start, range.end)) : []), [data, accounts, chosen, range]);
  if (!data) return null;
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    setPicked(next);
  };
  const label = `${formatDate(range.start, cal, doc.lang)} – ${formatDate(range.end - 1, cal, doc.lang)}`;
  const fileName = `statements-${span}-${toCalendarDate(range.start, cal).y}`;
  return (
    <Screen title={t('batch.title')} actions={<BackButton />}>
      <Segmented<StatementSpan>
        label={t('batch.range')}
        value={span}
        onChange={(s) => (setSpan(s), setOffset(0))}
        options={[
          { value: 'week', label: t('batch.week') },
          { value: 'month', label: t('batch.month') },
          { value: 'year', label: t('batch.year') },
        ]}
      />
      <Card className="flex items-center justify-between gap-2">
        <Button variant="ghost" className="!min-h-11 !px-3" onClick={() => setOffset((o) => o - 1)} aria-label={t('batch.prev')}>
          <span className="rtl:rotate-180">‹</span>
        </Button>
        <span className="text-center text-[15px] font-bold" data-testid="batch-period">
          {label}
        </span>
        <Button variant="ghost" className="!min-h-11 !px-3" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0} aria-label={t('batch.next')}>
          <span className="rtl:rotate-180">›</span>
        </Button>
      </Card>
      <Card className="flex flex-col gap-3" data-testid="batch-accounts">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-bold">{t('batch.accounts')}</h2>
          <div className="flex gap-1">
            <Button variant="ghost" className="!min-h-10 !px-3 text-[13px]" onClick={() => setPicked(new Set(accounts.map((a) => a.id)))}>
              {t('batch.all')}
            </Button>
            <Button variant="ghost" className="!min-h-10 !px-3 text-[13px]" onClick={() => setPicked(new Set())}>
              {t('batch.none')}
            </Button>
          </div>
        </div>
        {groups.map(([code, list]) => {
          const bank = bankByCode(code);
          const ids = list.map((a) => a.id);
          const all = ids.every((id) => chosen.has(id));
          return (
            <fieldset key={code || 'none'} className="flex flex-col gap-1 rounded-2xl bg-surface-2 p-3">
              <legend className="sr-only">{bank ? (doc.lang === 'fa' ? bank.name_fa : bank.name_en) : t('batch.noBank')}</legend>
              <label className="flex min-h-11 items-center gap-3 font-semibold">
                <input type="checkbox" className="h-5 w-5 accent-[var(--arizo-gold)]" checked={all} onChange={(e) => toggle(ids, e.target.checked)} aria-label={t('batch.bank')} data-testid="batch-bank" />
                <span>{bank ? (doc.lang === 'fa' ? bank.name_fa : bank.name_en) : t('batch.noBank')}</span>
              </label>
              {list.map((a) => (
                <label key={a.id} className="flex min-h-11 items-center gap-3 ps-8 text-[14px]">
                  <input type="checkbox" className="h-5 w-5 accent-[var(--arizo-gold)]" checked={chosen.has(a.id)} onChange={(e) => toggle([a.id], e.target.checked)} data-testid="batch-account" />
                  <span className="grow">{a.name}</span>
                  {a.card_last4 && <span className="num text-ink-2" dir="ltr">•• {localDigits(a.card_last4, doc.lang)}</span>}
                </label>
              ))}
            </fieldset>
          );
        })}
        <p className="text-[13px] text-ink-2" role="status" data-testid="batch-count">
          {statements.length ? t('batch.selected', { n: localDigits(statements.length, doc.lang) }) : t('batch.pick')}
        </p>
      </Card>
      {statements.length > 0 && (
        <>
          <DocActions
            name={fileName}
            papers={['A4', 'A5']}
            paper={paper}
            onPaper={setPaper}
            render={(p) => (
              <div className="doc-batch">
                {statements.map((s) => (
                  <StatementDoc key={s.account.id} s={s} categories={data.categories} paper={p} lang={doc.lang} unit={doc.unit} cal={cal} />
                ))}
              </div>
            )}
          />
          <p className="text-[13px] text-ink-2">{t('batch.pdfHint')}</p>
        </>
      )}
    </Screen>
  );
}
