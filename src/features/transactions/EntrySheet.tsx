// Lightning Entry Sheet (PROMPT.md §7 #4): calculator keypad with live Persian words, type tabs,
// smart category chips, splits (Σ = amount), dual date picker, tags and a recurring toggle.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { mutate } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { sumMinor, type CurrencyCode } from '../../core/currency/money';
import { formatDate, formatMoney } from '../../core/i18n/format';
import { createTransaction, createTransfer, setSplits } from '../../core/ledger/ledger';
import { dayOfPeriodFor, nextOccurrence } from '../../core/ledger/recurring';
import { CalculatorKeypad } from '../../core/motion/CalculatorKeypad';
import { DualDatePicker } from '../../core/motion/DualDatePicker';
import type { IVaultDatabase } from '../../core/storage/IVaultDatabase';
import type { Cadence, Category } from '../../core/storage/schema';
import { uuidv7 } from '../../core/utils/uuidv7';
import { Button, Field, Segmented, Sheet, Toggle } from '../../core/ui/ui';

export type EntryKind = 'expense' | 'income' | 'transfer';
const CADENCES: Cadence[] = ['daily', 'weekly', 'monthly_jalali', 'monthly_gregorian', 'yearly'];

interface Split {
  category_id: string;
  amount: bigint | null;
}

/** Tags: "#کاری #مالیات" → one row per tag, created on first use. */
async function attachTags(db: IVaultDatabase, txId: string, text: string, now: number) {
  const names = [...new Set(text.split(/\s+/).map((s) => s.replace(/^#/, '').trim()).filter(Boolean))];
  if (!names.length) return;
  await db.transaction(async (tx) => {
    const existing = await tx.find('tags');
    for (const name of names) {
      let tag = existing.find((x) => x.name === name && x.deleted_at === null);
      if (!tag) {
        tag = { id: uuidv7(now), created_at: now, updated_at: now, deleted_at: null, name, color_hex: '#4DA6FF' };
        await tx.put('tags', tag);
      }
      await tx.put('transaction_tags', { id: uuidv7(now), created_at: now, updated_at: now, deleted_at: null, transaction_id: txId, tag_id: tag.id });
    }
  });
}

export function EntrySheet({ open, onClose, initialKind = 'expense' }: { open: boolean; onClose: () => void; initialKind?: EntryKind }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const { data } = useVaultQuery(async (db) => ({ accounts: await db.find('accounts'), cats: await db.find('categories'), memory: await db.find('transactions') }));
  const accounts = useMemo(() => (data?.accounts ?? []).filter((a) => a.deleted_at === null && !a.is_archived).sort((a, b) => a.sort_order - b.sort_order), [data]);

  const [kind, setKind] = useState<EntryKind>(initialKind);
  const [amount, setAmount] = useState<bigint | null>(null);
  const [accountId, setAccountId] = useState<string>('');
  const [toId, setToId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [date, setDate] = useState(() => Date.now());
  const [showDate, setShowDate] = useState(false);
  const [fee, setFee] = useState<bigint | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [splits, setSplitsState] = useState<Split[]>([]);
  const [splitEditor, setSplitEditor] = useState<number | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [cadence, setCadence] = useState<Cadence>('monthly_jalali');
  const [autoPost, setAutoPost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === (accountId || accounts[0]?.id));
  const currency: CurrencyCode = account?.currency_code ?? 'IRR';
  const cats = (data?.cats ?? []).filter((c) => c.deleted_at === null && c.type === (kind === 'income' ? 'income' : 'expense')).sort((a, b) => a.sort_order - b.sort_order);
  // Smart chips: the categories this user picks most for this type come first.
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of data?.memory ?? []) if (x.category_id) m.set(x.category_id, (m.get(x.category_id) ?? 0) + 1);
    return m;
  }, [data]);
  const chips = [...cats].sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0)).slice(0, 8);
  const catName = (c: Category) => (lang === 'fa' ? c.name_fa : c.name_en);
  const splitSum = sumMinor(splits.map((s) => s.amount ?? 0n));
  const splitOk = !splitting || (amount !== null && splits.length > 0 && splits.every((s) => s.category_id && s.amount) && splitSum === amount);

  const reset = () => {
    setAmount(null);
    setMerchant('');
    setNote('');
    setTags('');
    setFee(null);
    setSplitting(false);
    setSplitsState([]);
    setRecurring(false);
    setError(null);
    setDate(Date.now());
  };

  const save = async () => {
    if (!account || amount === null || amount <= 0n) return;
    if (!splitOk) return setError(t('entry.splitMismatch'));
    setBusy(true);
    setError(null);
    const now = Date.now();
    try {
      await mutate(async (db) => {
        if (kind === 'transfer') {
          const to = accounts.find((a) => a.id === toId);
          if (!to || to.id === account.id) throw new Error(t('entry.to'));
          await createTransfer(db, { from_account_id: account.id, to_account_id: to.id, amount_minor: amount, ...(fee ? { fee_minor: fee, fee_category_id: 'cat_bank_fee' } : {}), occurred_at: date, note }, now);
          return;
        }
        const row = await createTransaction(db, { account_id: account.id, type: kind, amount_minor: amount, occurred_at: date, category_id: splitting ? null : categoryId || chips[0]?.id || null, merchant_name: merchant, note }, now);
        if (splitting) await setSplits(db, row.id, splits.map((s) => ({ category_id: s.category_id, amount_minor: s.amount! })), now);
        await attachTags(db, row.id, tags, now);
        if (recurring) {
          const first = nextOccurrence(cadence, dayOfPeriodFor(cadence, date), date);
          await db.put('recurring_rules', {
            id: uuidv7(now),
            created_at: now,
            updated_at: now,
            deleted_at: null,
            title: merchant || (chips.find((c) => c.id === categoryId) ? catName(chips.find((c) => c.id === categoryId)!) : t(`entry.${kind}`)),
            type: kind,
            account_id: account.id,
            category_id: categoryId || null,
            amount_minor: amount,
            currency_code: currency,
            cadence,
            day_of_period: dayOfPeriodFor(cadence, date),
            next_run_at: first,
            auto_post: autoPost,
            is_active: true,
          });
        }
      });
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!accounts.length) {
    return (
      <Sheet open={open} onClose={onClose} title={t('entry.title')}>
        <p className="text-[14px] text-ink-2">{t('entry.needAccount')}</p>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('entry.title')}>
      <Segmented
        label={t('entry.title')}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setCategoryId('');
          setSplitting(false);
        }}
        options={(['expense', 'income', 'transfer'] as const).map((k) => ({ value: k, label: t(`entry.${k}`) }))}
      />

      {amount === null ? (
        <CalculatorKeypad currency={currency} onDone={setAmount} />
      ) : (
        <button type="button" onClick={() => setAmount(null)} className="rounded-2xl bg-surface-3 p-4 text-end" data-testid="entry-amount">
          <span className="block text-[12px] text-ink-2">{t('entry.amount')}</span>
          <span className="text-[26px] font-extrabold tabular">{formatMoney(amount, currency, lang, irrUnit)}</span>
        </button>
      )}

      {amount !== null && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink-2">{kind === 'transfer' ? t('entry.from') : t('entry.account')}</span>
            <select value={account?.id} onChange={(e) => setAccountId(e.target.value)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px]" data-testid="entry-account">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          {kind === 'transfer' ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink-2">{t('entry.to')}</span>
                <select value={toId} onChange={(e) => setToId(e.target.value)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px]" data-testid="entry-to">
                  <option value="">—</option>
                  {accounts
                    .filter((a) => a.id !== account?.id && a.currency_code === currency)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <FeeField currency={currency} value={fee} onChange={setFee} />
            </>
          ) : (
            <>
              {!splitting && (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('entry.category')}>
                  {chips.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={(categoryId || chips[0]?.id) === c.id}
                      onClick={() => setCategoryId(c.id)}
                      className={`min-h-10 rounded-full border px-3 text-[13px] font-semibold ${(categoryId || chips[0]?.id) === c.id ? 'border-cta bg-emerald-glow text-ink' : 'border-hairline bg-surface-3 text-ink-2'}`}
                    >
                      {catName(c)}
                    </button>
                  ))}
                </div>
              )}
              <Field label={t('entry.merchant')} value={merchant} onChange={(e) => setMerchant(e.target.value)} data-testid="entry-merchant" />
              <Toggle
                label={t('entry.split')}
                checked={splitting}
                onChange={(on) => {
                  setSplitting(on);
                  if (on && !splits.length) setSplitsState([{ category_id: categoryId || chips[0]?.id || '', amount: null }]);
                }}
              />
              {splitting && (
                <div className="flex flex-col gap-2 rounded-2xl bg-surface-1 p-3">
                  {splits.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={s.category_id}
                        onChange={(e) => setSplitsState((xs) => xs.map((x, j) => (j === i ? { ...x, category_id: e.target.value } : x)))}
                        className="min-h-11 min-w-0 flex-1 rounded-xl bg-surface-3 px-3 text-[14px]"
                      >
                        {cats.map((c) => (
                          <option key={c.id} value={c.id}>
                            {catName(c)}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => setSplitEditor(i)} className="min-h-11 min-w-28 rounded-xl bg-surface-3 px-3 text-[14px] font-bold tabular">
                        {s.amount ? formatMoney(s.amount, currency, lang, irrUnit) : '—'}
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-[12px]">
                    <button type="button" onClick={() => setSplitsState((xs) => [...xs, { category_id: cats[0]?.id ?? '', amount: amount - splitSum > 0n ? amount - splitSum : null }])} className="min-h-10 font-semibold text-emerald-text">
                      + {t('entry.addSplit')}
                    </button>
                    <span className={splitSum === amount ? 'text-emerald-text' : 'text-amber-text'}>{t('entry.splitRemaining', { a: formatMoney(amount - splitSum, currency, lang, irrUnit) })}</span>
                  </div>
                </div>
              )}
              <Field label={t('entry.tags')} hint={t('entry.tagsHint')} value={tags} onChange={(e) => setTags(e.target.value)} />
              <Toggle label={t('entry.recurring')} checked={recurring} onChange={setRecurring} />
              {recurring && (
                <div className="flex flex-col gap-2">
                  <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px]" aria-label={t('entry.cadence')}>
                    {CADENCES.map((c) => (
                      <option key={c} value={c}>
                        {t(`entry.cadences.${c}`)}
                      </option>
                    ))}
                  </select>
                  <Toggle label={t('entry.autoPost')} checked={autoPost} onChange={setAutoPost} />
                </div>
              )}
            </>
          )}

          <Field label={t('entry.note')} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" onClick={() => setShowDate((v) => !v)} className="flex min-h-12 items-center justify-between rounded-2xl bg-surface-3 px-4 text-[15px]">
            <span className="text-ink-2">{t('entry.date')}</span>
            <span className="font-semibold">{formatDate(date, cal, lang)}</span>
          </button>
          {showDate && (
            <DualDatePicker
              value={date}
              onChange={(ms) => {
                setDate(ms);
                setShowDate(false);
              }}
            />
          )}
          {error && (
            <p role="alert" className="text-[13px] font-semibold text-coral-text">
              {error}
            </p>
          )}
          <Button onClick={() => void save()} disabled={busy || !splitOk || (kind === 'transfer' && !toId)} data-testid="entry-save">
            {t('entry.save')}
          </Button>
        </>
      )}

      <Sheet open={splitEditor !== null} onClose={() => setSplitEditor(null)} title={t('entry.amount')}>
        <CalculatorKeypad
          currency={currency}
          initialMinor={splitEditor !== null ? (splits[splitEditor]?.amount ?? 0n) : 0n}
          onDone={(v) => {
            setSplitsState((xs) => xs.map((x, j) => (j === splitEditor ? { ...x, amount: v } : x)));
            setSplitEditor(null);
          }}
        />
      </Sheet>
    </Sheet>
  );
}

function FeeField({ currency, value, onChange }: { currency: CurrencyCode; value: bigint | null; onChange: (v: bigint | null) => void }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-12 items-center justify-between rounded-2xl bg-surface-3 px-4 text-[15px]">
        <span className="text-ink-2">{t('entry.fee')}</span>
        <span className="font-semibold tabular">{value ? formatMoney(value, currency, lang, irrUnit) : '—'}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('entry.fee')}>
        <CalculatorKeypad
          currency={currency}
          initialMinor={value ?? 0n}
          onDone={(v) => {
            onChange(v || null);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}
