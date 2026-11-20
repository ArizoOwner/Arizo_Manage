// Virtualized ledger (PROMPT.md §7 #4): grouped by calendar day with daily totals, deep search,
// account and type filters, multi-select bulk delete, soft-delete with a 5-second Undo, pending review.
// @tanstack/react-virtual keeps scrolling smooth with 20,000+ rows: only visible rows are mounted.
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useSettings } from '../../app/stores/settings';
import { mutate } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { startOfCalendarDay, toCalendarDate } from '../../core/calendar/calendar';
import { formatDate, formatMoney } from '../../core/i18n/format';
import { postPendingTransaction, restoreTransaction, softDeleteTransaction } from '../../core/ledger/ledger';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import type { Transaction } from '../../core/storage/schema';
import { Button, Icon, IconButton, ICONS, Screen } from '../../core/ui/ui';
import { SignedMoney, signOf, TxRow } from './TxRow';
import { ReceiptSheet } from '../invoices/LedgerTools';

type Item = { kind: 'day'; key: string; day: number; total: bigint; currency: string } | { kind: 'tx'; key: string; tx: Transaction };
type TypeFilter = 'all' | 'expense' | 'income' | 'transfer' | 'pending';

export function Ledger() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [q, setQ] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<{ ids: string[]; until: number } | null>(null);
  const [receipt, setReceipt] = useState<Transaction | null>(null);
  const { data } = useVaultQuery(async (db) => {
    const [txs, accounts, cats, tags, links] = await Promise.all([db.find('transactions'), db.find('accounts'), db.find('categories'), db.find('tags'), db.find('transaction_tags')]);
    return { txs, accounts, cats, tags, links };
  });

  const { items, byId, catById } = useMemo(() => {
    const byId = new Map((data?.accounts ?? []).map((a) => [a.id, a]));
    const catById = new Map((data?.cats ?? []).map((c) => [c.id, c]));
    const tagName = new Map((data?.tags ?? []).map((g) => [g.id, g.name]));
    const tagsOf = new Map<string, string[]>();
    for (const l of data?.links ?? []) tagsOf.set(l.transaction_id, [...(tagsOf.get(l.transaction_id) ?? []), tagName.get(l.tag_id) ?? '']);
    const needle = q.trim().toLowerCase().replace(/^#/, '');
    const rows = (data?.txs ?? [])
      .filter((x) => x.deleted_at === null && x.status !== 'voided')
      .filter((x) => !accountFilter || x.account_id === accountFilter)
      .filter((x) => {
        if (typeFilter === 'all') return true;
        if (typeFilter === 'pending') return x.status === 'pending_review';
        if (typeFilter === 'transfer') return x.type === 'transfer_in' || x.type === 'transfer_out';
        return x.type === typeFilter;
      })
      .filter((x) => {
        if (!needle) return true;
        const cat = x.category_id ? catById.get(x.category_id) : undefined;
        const hay = [x.merchant_name, x.note, cat?.name_fa, cat?.name_en, ...(tagsOf.get(x.id) ?? [])].join(' ').toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => b.occurred_at - a.occurred_at);
    const items: Item[] = [];
    let curDay = -1;
    let dayItem: Extract<Item, { kind: 'day' }> | null = null;
    for (const x of rows) {
      const day = startOfCalendarDay(toCalendarDate(x.occurred_at, cal), cal);
      if (day !== curDay) {
        curDay = day;
        dayItem = { kind: 'day', key: `d${day}`, day, total: 0n, currency: x.currency_code };
        items.push(dayItem);
      }
      // Daily total: net income − expense of posted rows in the day's first currency (transfers net to zero overall).
      if (dayItem && x.currency_code === dayItem.currency && x.status === 'posted' && (x.type === 'income' || x.type === 'expense')) {
        dayItem.total += BigInt(signOf(x)) * x.amount_minor;
      }
      items.push({ kind: 'tx', key: x.id, tx: x });
    }
    return { items, byId, catById };
  }, [data, q, accountFilter, typeFilter, cal]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (items[i]?.kind === 'day' ? 36 : 68),
    overscan: 12,
  });

  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), Math.max(0, undo.until - Date.now()));
    return () => window.clearTimeout(id);
  }, [undo]);

  const remove = async (ids: string[]) => {
    await mutate(async (db) => {
      for (const id of ids) await softDeleteTransaction(db, id);
    });
    setUndo({ ids, until: Date.now() + 5_000 });
    setSelected(new Set());
    setSelecting(false);
  };

  const live = data?.accounts.filter((a) => a.deleted_at === null) ?? [];
  const filterBtn = (f: TypeFilter, label: string) => (
    <button
      key={f}
      type="button"
      onClick={() => setTypeFilter(f)}
      aria-pressed={typeFilter === f}
      className={`min-h-10 shrink-0 rounded-full px-3 text-[13px] font-semibold ${typeFilter === f ? 'bg-surface-1 text-ink shadow-sm' : 'bg-surface-3 text-ink-2'}`}
    >
      {label}
    </button>
  );

  return (
    <Screen
      title={t('ledger.title')}
      actions={
        <>
          <IconButton label={t('ledger.trash')} onClick={() => nav('/trash')}>
            <Icon d={ICONS.trash} />
          </IconButton>
          <Button variant="ghost" className="!min-h-11 !px-3 text-[13px]" onClick={() => (setSelecting((v) => !v), setSelected(new Set()))}>
            {selecting ? t('ledger.cancel') : t('ledger.select')}
          </Button>
        </>
      }
    >
      <label className="relative flex items-center">
        <span className="sr-only">{t('ledger.search')}</span>
        <Icon d={ICONS.search} className="pointer-events-none absolute start-3 h-5 w-5 text-ink-2" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('ledger.search')}
          className="min-h-12 w-full rounded-2xl bg-surface-3 ps-10 pe-4 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-azure"
          data-testid="ledger-search"
        />
      </label>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {filterBtn('all', t('ledger.all'))}
        {filterBtn('expense', t('entry.expense'))}
        {filterBtn('income', t('entry.income'))}
        {filterBtn('transfer', t('entry.transfer'))}
        {filterBtn('pending', t('ledger.pending'))}
        <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="min-h-10 shrink-0 rounded-full bg-surface-3 px-3 text-[13px] font-semibold text-ink-2" aria-label={t('entry.account')}>
          <option value="">{t('entry.account')}</option>
          {live.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {items.length === 0 ? (
        <p className="py-12 text-center text-[14px] text-ink-2">{t('ledger.empty')}</p>
      ) : (
        <div ref={parentRef} className="-mx-1 h-[calc(100dvh-17rem)] overflow-y-auto px-1" data-testid="ledger-list">
          <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((vi) => {
              const it = items[vi.index]!;
              return (
                <div key={it.key} data-index={vi.index} ref={virtual.measureElement} className="absolute inset-x-0" style={{ transform: `translateY(${vi.start}px)` }}>
                  {it.kind === 'day' ? (
                    <div className="flex items-center justify-between px-3 pt-3 pb-1 text-[12px] font-semibold text-ink-2">
                      <span>{formatDate(it.day + 12 * 3_600_000, cal, lang)}</span>
                      <PrivacyBlur>
                        <SignedMoney
                          className={`tabular ${it.total < 0n ? 'text-coral-text' : 'text-emerald-text'}`}
                          sign={it.total < 0n ? -1 : 1}
                          text={formatMoney(it.total < 0n ? -it.total : it.total, it.currency as Transaction['currency_code'], lang, irrUnit)}
                        />
                      </PrivacyBlur>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <TxRow
                          tx={it.tx}
                          account={byId.get(it.tx.account_id)}
                          counterparty={it.tx.counterparty_account_id ? byId.get(it.tx.counterparty_account_id) : undefined}
                          category={it.tx.category_id ? catById.get(it.tx.category_id) : undefined}
                          selected={selected.has(it.tx.id)}
                          onClick={() =>
                            selecting &&
                            setSelected((s) => {
                              const n = new Set(s);
                              if (n.has(it.tx.id)) n.delete(it.tx.id);
                              else n.add(it.tx.id);
                              return n;
                            })
                          }
                        />
                      </div>
                      {!selecting && it.tx.status === 'pending_review' && (
                        <Button variant="ghost" className="!min-h-11 !px-2 text-[12px] text-emerald-text" onClick={() => void mutate((db) => postPendingTransaction(db, it.tx.id))}>
                          {t('ledger.post')}
                        </Button>
                      )}
                      {!selecting && it.tx.status === 'posted' && (
                        <IconButton label={t('receipt.open')} onClick={() => setReceipt(it.tx)}>
                          <Icon d={ICONS.receipt} className="h-5 w-5" />
                        </IconButton>
                      )}
                      {!selecting && (
                        <IconButton label={t('ledger.delete')} onClick={() => void remove([it.tx.id])}>
                          <Icon d={ICONS.trash} className="h-5 w-5" />
                        </IconButton>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selecting && selected.size > 0 && (
        <div className="fixed inset-x-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-specular bg-surface-2 p-3 shadow-[var(--arizo-shadow)]">
          <span className="text-[14px] font-semibold">{t('ledger.selected', { n: selected.size })}</span>
          <Button variant="danger" className="!min-h-11 text-[13px]" onClick={() => void remove([...selected])}>
            {t('ledger.deleteSelected')}
          </Button>
        </div>
      )}
      {undo && (
        <div role="status" className="fixed inset-x-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-specular bg-surface-2 p-3 shadow-[var(--arizo-shadow)]" data-testid="undo-toast">
          <span className="text-[14px]">{t('ledger.deleted')}</span>
          <Button
            variant="ghost"
            className="!min-h-11 text-emerald-text"
            onClick={async () => {
              const ids = undo.ids;
              setUndo(null);
              await mutate(async (db) => {
                for (const id of ids) await restoreTransaction(db, id);
              });
            }}
          >
            {t('ledger.undo')}
          </Button>
        </div>
      )}
      {receipt && data && <ReceiptSheet tx={receipt} accounts={data.accounts} categories={data.cats} onClose={() => setReceipt(null)} />}
    </Screen>
  );
}

export function Trash() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const { data } = useVaultQuery(async (db) => ({ txs: await db.find('transactions'), accounts: await db.find('accounts'), cats: await db.find('categories') }));
  const rows = (data?.txs ?? []).filter((x) => x.deleted_at !== null).sort((a, b) => (b.deleted_at ?? 0) - (a.deleted_at ?? 0));
  // Transfer pairs show once (the outgoing side).
  const shown = rows.filter((x) => x.type !== 'transfer_in' || !rows.some((y) => y.transfer_pair_id === x.transfer_pair_id && y.type === 'transfer_out'));
  const byId = new Map((data?.accounts ?? []).map((a) => [a.id, a]));
  const catById = new Map((data?.cats ?? []).map((c) => [c.id, c]));
  return (
    <Screen
      title={t('ledger.trash')}
      actions={
        <IconButton label={t('onboarding.back')} onClick={() => nav(-1)}>
          <Icon d={ICONS.back} className="h-[22px] w-[22px] rtl:rotate-180" />
        </IconButton>
      }
    >
      <p className="text-[13px] text-ink-2">{t('ledger.trashNote')}</p>
      {shown.length === 0 && <p className="py-10 text-center text-[14px] text-ink-2">{t('ledger.trashEmpty')}</p>}
      {shown.map((x) => (
        <div key={x.id} className="flex items-center gap-1" data-testid="trash-row">
          <div className="min-w-0 flex-1">
            <span className="block px-3 text-[11px] text-ink-2">{formatDate(x.occurred_at, cal, lang)}</span>
            <TxRow tx={x} account={byId.get(x.account_id)} counterparty={x.counterparty_account_id ? byId.get(x.counterparty_account_id) : undefined} category={x.category_id ? catById.get(x.category_id) : undefined} />
          </div>
          <Button variant="ghost" className="!min-h-11 !px-3 text-[13px] text-emerald-text" onClick={() => void mutate((db) => restoreTransaction(db, x.id))}>
            {t('ledger.restore')}
          </Button>
        </div>
      ))}
    </Screen>
  );
}
