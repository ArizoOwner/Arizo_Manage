// Virtualized ledger (PROMPT.md §7 #4): grouped by calendar day with daily totals, deep search,
// account and type filters, multi-select bulk delete, soft-delete with a 5-second Undo, pending review.
// @tanstack/react-virtual keeps scrolling smooth with 20,000+ rows: only visible rows are mounted.
import { useVirtualizer } from '@tanstack/react-virtual';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useSettings } from '../../app/stores/settings';
import { mutate } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { startOfCalendarDay, toCalendarDate } from '../../core/calendar/calendar';
import { formatDate, formatMoney, localDigits } from '../../core/i18n/format';
import { postPendingTransaction, restoreTransaction, softDeleteTransaction } from '../../core/ledger/ledger';
import { restoreAccount } from '../../core/ledger/accounts';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import { bankByCode } from '../../core/data/banks';
import { Glyph } from '../../core/ui/glyphs';
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
  const [open, setOpen] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const { data } = useVaultQuery(async (db) => {
    const [txs, accounts, cats, tags, links] = await Promise.all([db.find('transactions'), db.find('accounts'), db.find('categories'), db.find('tags'), db.find('transaction_tags')]);
    return { txs, accounts, cats, tags, links };
  });

  const { items, byId, catById, pendingCount, sums } = useMemo(() => {
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
    const pendingCount = (data?.txs ?? []).filter((x) => x.deleted_at === null && x.status === 'pending_review').length;
    // Filtered in/out in IRR only (other currencies are not summed: no rate guessing here).
    const sums = { in: 0n, out: 0n };
    for (const x of rows) {
      if (x.currency_code !== 'IRR' || x.status !== 'posted') continue;
      if (x.type === 'income') sums.in += x.amount_minor;
      else if (x.type === 'expense') sums.out += x.amount_minor;
    }
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
    return { items, byId, catById, pendingCount, sums };
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
    setOpen(null);
  };

  const live = data?.accounts.filter((a) => a.deleted_at === null) ?? [];
  const types: { f: TypeFilter; label: string; glyph: string }[] = [
    { f: 'all', label: t('ledger.all'), glyph: 'chart' },
    { f: 'expense', label: t('entry.expense'), glyph: 'arrowUp' },
    { f: 'income', label: t('entry.income'), glyph: 'arrowDown' },
    { f: 'transfer', label: t('entry.transfer'), glyph: 'swap' },
    { f: 'pending', label: t('ledger.pendingShort'), glyph: 'bell' },
  ];
  const tone: Record<TypeFilter, string> = { all: 'text-gold-text', expense: 'text-coral-text', income: 'text-emerald-text', transfer: 'text-azure-text', pending: 'text-amber-text' };
  const chip = (id: string, label: string, dot: string | null) => (
    <button
      key={id || 'all'}
      type="button"
      onClick={() => setAccountFilter(id)}
      aria-pressed={accountFilter === id}
      className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${accountFilter === id ? 'border-emerald/50 bg-emerald/10 text-ink' : 'border-hairline bg-surface-2/60 text-ink-2'}`}
    >
      {dot && <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />}
      <span className="max-w-[9rem] truncate">{label}</span>
    </button>
  );

  return (
    <Screen
      title={t('ledger.title')}
      actions={
        <>
          <IconButton label={t('batch.open')} onClick={() => nav('/statements')}>
            <Icon d={ICONS.printer} />
          </IconButton>
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
      {/* Type filter: one segmented control with a sliding thumb, so the choice reads at a glance. */}
      <div role="group" aria-label={t('ledger.typeFilter')} className="grid grid-cols-5 gap-1 rounded-[20px] border border-hairline bg-surface-2/60 p-1 backdrop-blur" data-testid="ledger-types">
        {types.map(({ f, label, glyph }) => {
          const on = typeFilter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setTypeFilter(f)}
              aria-pressed={on}
              className={`relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 text-[11px] font-semibold transition-colors ${on ? 'text-ink' : 'text-ink-2'}`}
            >
              {on && (
                <motion.span
                  layoutId="ledger-type-thumb"
                  aria-hidden="true"
                  className="absolute inset-0 rounded-2xl border border-specular bg-surface-1 shadow-[0_6px_18px_-10px_rgba(0,0,0,0.6)]"
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative">
                <Glyph name={glyph} className={`h-[18px] w-[18px] ${on ? tone[f] : ''}`} />
                {f === 'pending' && pendingCount > 0 && (
                  <span className="absolute -end-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber px-1 text-[10px] font-bold text-on-accent tabular">{localDigits(pendingCount, lang)}</span>
                )}
              </span>
              <span className="relative max-w-full truncate">{label}</span>
            </button>
          );
        })}
      </div>
      {live.length > 1 && (
        <div role="group" aria-label={t('entry.account')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" data-testid="ledger-accounts">
          {chip('', t('ledger.allAccounts'), null)}
          {live.map((a) => chip(a.id, a.name, bankByCode(a.bank_code)?.color ?? 'var(--arizo-accent-info)'))}
        </div>
      )}
      {items.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-1 text-[12px] text-ink-2" data-testid="ledger-sums">
          <span>{t('ledger.shown', { n: localDigits(items.filter((i) => i.kind === 'tx').length, lang) })}</span>
          <PrivacyBlur>
            <span className="flex gap-3 font-semibold tabular">
              {sums.in > 0n && <SignedMoney className="text-emerald-text" sign={1} text={formatMoney(sums.in, 'IRR', lang, irrUnit)} />}
              {sums.out > 0n && <SignedMoney className="text-coral-text" sign={-1} text={formatMoney(sums.out, 'IRR', lang, irrUnit)} />}
            </span>
          </PrivacyBlur>
        </div>
      )}

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
                    <div className={`rounded-2xl transition-colors ${open === it.tx.id ? 'bg-surface-2/70' : ''}`}>
                      <TxRow
                        tx={it.tx}
                        account={byId.get(it.tx.account_id)}
                        counterparty={it.tx.counterparty_account_id ? byId.get(it.tx.counterparty_account_id) : undefined}
                        category={it.tx.category_id ? catById.get(it.tx.category_id) : undefined}
                        {...(selecting ? { selected: selected.has(it.tx.id) } : { expanded: open === it.tx.id })}
                        onClick={() =>
                          selecting
                            ? setSelected((s) => {
                                const n = new Set(s);
                                if (n.has(it.tx.id)) n.delete(it.tx.id);
                                else n.add(it.tx.id);
                                return n;
                              })
                            : setOpen((o) => (o === it.tx.id ? null : it.tx.id))
                        }
                      />
                      <AnimatePresence initial={false}>
                        {!selecting && open === it.tx.id && (
                          <motion.div
                            initial={reduce ? false : { height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="flex flex-wrap gap-2 px-2.5 pt-1 pb-2.5" data-testid="tx-actions">
                              {it.tx.status === 'pending_review' && (
                                <button type="button" onClick={() => void mutate((db) => postPendingTransaction(db, it.tx.id))} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cta px-3.5 text-[13px] font-bold text-on-accent">
                                  <Glyph name="shieldCheck" className="h-4 w-4" />
                                  {t('ledger.post')}
                                </button>
                              )}
                              {it.tx.status === 'posted' && (
                                <button type="button" onClick={() => setReceipt(it.tx)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-hairline bg-surface-3 px-3.5 text-[13px] font-semibold text-ink">
                                  <Glyph name="receipt" className="h-4 w-4" />
                                  {t('receipt.open')}
                                </button>
                              )}
                              <button type="button" onClick={() => void remove([it.tx.id])} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-coral/30 bg-coral/10 px-3.5 text-[13px] font-semibold text-coral-text">
                                <Glyph name="trash" className="h-4 w-4" />
                                {t('ledger.delete')}
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
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
  const goneAccounts = (data?.accounts ?? []).filter((a) => a.deleted_at !== null).sort((a, b) => (b.deleted_at ?? 0) - (a.deleted_at ?? 0));
  const goneIds = new Set(goneAccounts.map((a) => a.id));
  // A deleted account's rows come back with the account, so they are listed under it, not one by one.
  const loose = shown.filter((x) => !goneIds.has(x.account_id) && !(x.counterparty_account_id && goneIds.has(x.counterparty_account_id)));
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
      {shown.length === 0 && goneAccounts.length === 0 && <p className="py-10 text-center text-[14px] text-ink-2">{t('ledger.trashEmpty')}</p>}
      {goneAccounts.map((a) => (
        <div key={a.id} className="arizo-card flex items-center gap-3 rounded-2xl border border-hairline p-3" data-testid="trash-account">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-coral/12 text-coral-text">
            <Icon d={ICONS.trash} className="h-5 w-5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-semibold">{a.name}</span>
            <span className="text-[12px] text-ink-2">{t('ledger.trashAccount', { n: localDigits(rows.filter((x) => x.account_id === a.id).length, lang) })}</span>
          </span>
          <Button variant="ghost" className="!min-h-11 !px-3 text-[13px] text-emerald-text" onClick={() => void mutate((db) => restoreAccount(db, a.id))} data-testid="trash-account-restore">
            {t('ledger.restore')}
          </Button>
        </div>
      ))}
      {loose.map((x) => (
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
