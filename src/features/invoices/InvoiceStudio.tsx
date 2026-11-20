// Invoice Studio (PROMPT.md §7 #7): invoice list, builder (فاکتور / پیش‌فاکتور), detail with print/PNG,
// 1-tap "Post Payment to Account", business profile (validated IDs, encrypted logo, touch signature),
// customers and products catalogs. Routes: #/invoices, #/invoices/new, #/invoices/:id, #/invoices/:id/edit,
// #/invoices/profile.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useSettings } from '../../app/stores/settings';
import { mutate, useVault } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { deleteAttachment, imageDataUrl, loadAttachment, saveImageAttachment } from '../../core/attachments/attachments';
import { CURRENCIES, type CurrencyCode } from '../../core/currency/money';
import { formatDate, formatMoney, localDigits } from '../../core/i18n/format';
import {
  computeTotals,
  DEFAULT_VAT_BPS,
  deleteCatalogRow,
  deleteInvoice,
  emptyProfile,
  formatQuantity,
  InvoiceError,
  lineGross,
  parseQuantity,
  postInvoicePayment,
  PROFILE_ID,
  saveCustomer,
  saveInvoice,
  saveProduct,
  saveProfile,
  undoLastPayment,
  validateParty,
  validateProfile,
  type InvoiceInput,
  type ItemInput,
  type ProfileInput,
} from '../../core/invoices/invoices';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import type { IVaultDatabase } from '../../core/storage/IVaultDatabase';
import type { Customer, Invoice, Product } from '../../core/storage/schema';
import { Button, Card, Field, Icon, IconButton, ICONS, Screen, Segmented, Sheet } from '../../core/ui/ui';
import { AccountSelect, AmountField, BackButton, DateField, liveAccounts } from '../obligations/shared';
import { DocActions } from './DocActions';
import { InvoiceDoc } from './InvoiceDoc';
import { bpsPercent, useDocLang, type Paper } from './paper';
import { ThermalSettings } from './ThermalSettings';

const STATUS_COLOR: Record<Invoice['status'], string> = { draft: 'text-ink-2', unpaid: 'text-amber-text', partial: 'text-azure-text', paid: 'text-emerald-text' };
const TEMPLATES: Invoice['template'][] = ['minimal', 'official', 'bold', 'thermal'];

function useErr() {
  const { t } = useTranslation();
  return (e: unknown) => {
    const code = e instanceof InvoiceError || e instanceof Error ? e.message : String(e);
    const k = `invoiceErrors.${code}`;
    const msg = t(k);
    return msg === k ? t('invoiceErrors.generic') : msg;
  };
}

async function loadProfileImages(db: IVaultDatabase) {
  const profile = (await db.get('business_profile', PROFILE_ID)) ?? null;
  const logo = profile?.logo_attachment_id ? await loadAttachment(db, profile.logo_attachment_id) : null;
  const sig = profile?.signature_attachment_id ? await loadAttachment(db, profile.signature_attachment_id) : null;
  return { profile, logoUrl: logo ? imageDataUrl(logo) : null, signatureUrl: sig ? imageDataUrl(sig) : null };
}

// ---------------- list ----------------

export function InvoicesScreen() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [filter, setFilter] = useState<'all' | 'open' | 'paid' | 'draft'>('all');
  const { data } = useVaultQuery(async (db) => {
    const [invoices, items, customers, profile] = await Promise.all([db.find('invoices'), db.find('invoice_items'), db.find('customers'), db.get('business_profile', PROFILE_ID)]);
    return { invoices, items, customers, profile };
  });
  const rows = useMemo(() => {
    if (!data) return [];
    const byInv = new Map<string, typeof data.items>();
    for (const it of data.items) byInv.set(it.invoice_id, [...(byInv.get(it.invoice_id) ?? []), it]);
    const cust = new Map(data.customers.map((c) => [c.id, c]));
    return data.invoices
      .filter((i) => i.deleted_at === null)
      .filter((i) => filter === 'all' || (filter === 'open' ? i.status === 'unpaid' || i.status === 'partial' : i.status === filter))
      .sort((a, b) => b.issued_at - a.issued_at || b.number.localeCompare(a.number))
      .map((i) => ({ inv: i, customer: i.customer_id ? cust.get(i.customer_id) : undefined, total: computeTotals(byInv.get(i.id) ?? [], i.discount_minor, i.vat_bps).total }));
  }, [data, filter]);

  return (
    <Screen
      title={t('invoice.title')}
      actions={
        <>
          <IconButton label={t('invoice.new')} onClick={() => nav('/invoices/new')}>
            <Icon d={ICONS.plus} />
          </IconButton>
          <BackButton />
        </>
      }
    >
      {data && !data.profile && (
        <Card className="flex flex-col gap-2">
          <p className="text-[14px]">{t('invoice.setupProfile')}</p>
          <Button variant="secondary" onClick={() => nav('/invoices/profile')} data-testid="invoice-setup">
            {t('invoice.profile')}
          </Button>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" className="text-[13px]" onClick={() => nav('/invoices/profile')}>
          {t('invoice.profile')}
        </Button>
        <Button variant="secondary" className="text-[13px]" onClick={() => nav('/invoices/catalog')}>
          {t('invoice.catalog')}
        </Button>
      </div>
      <Segmented
        label={t('invoice.title')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('ledger.all') },
          { value: 'open', label: t('invoice.open') },
          { value: 'paid', label: t('invoice.status.paid') },
          { value: 'draft', label: t('invoice.status.draft') },
        ]}
      />
      {rows.length === 0 && <p className="py-8 text-center text-[14px] text-ink-2">{t('invoice.empty')}</p>}
      <ol className="flex flex-col gap-2">
        {rows.map(({ inv, customer, total }) => (
          <li key={inv.id}>
            <button type="button" onClick={() => nav(`/invoices/${inv.id}`)} className="flex w-full items-center gap-3 rounded-2xl border border-hairline bg-surface-1 p-3 text-start" data-testid="invoice-row">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold">{customer?.name || t('invoice.noCustomer')}</span>
                <span className="truncate text-[12px] text-ink-2">
                  <bdi dir="ltr">{inv.number}</bdi> · {formatDate(inv.issued_at, cal, lang)} · {inv.kind === 'proforma' ? t('invoice.proforma') : <span className={STATUS_COLOR[inv.status]}>{t(`invoice.status.${inv.status}`)}</span>}
                </span>
              </span>
              <PrivacyBlur>
                <span className="text-[15px] font-bold tabular">{formatMoney(total, inv.currency_code, lang, irrUnit)}</span>
              </PrivacyBlur>
            </button>
          </li>
        ))}
      </ol>
    </Screen>
  );
}

// ---------------- builder ----------------

interface Draft extends Omit<InvoiceInput, 'items' | 'issue'> {
  items: (ItemInput & { key: string; qtyText: string })[];
}

const blankItem = (n: number): Draft['items'][number] => ({ key: `n${n}-${Date.now()}`, product_id: null, description: '', quantity_milli: 1000n, qtyText: '1', unit_price_minor: 0n, discount_minor: 0n });

export function InvoiceEditor() {
  const { t } = useTranslation();
  const { id } = useParams();
  const nav = useNavigate();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  const toErr = useErr();
  const { data } = useVaultQuery(
    async (db) => ({
      customers: (await db.find('customers')).filter((c) => c.deleted_at === null),
      products: (await db.find('products')).filter((p) => p.deleted_at === null),
      profile: await db.get('business_profile', PROFILE_ID),
      existing: id ? await db.get('invoices', id) : undefined,
      existingItems: id ? await db.find('invoice_items', { invoice_id: id }) : [],
    }),
    [id],
  );
  const [d, setD] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addingCustomer, setAddingCustomer] = useState(false);

  useEffect(() => {
    if (!data || d) return;
    const e = data.existing;
    if (e) {
      setD({
        id: e.id,
        kind: e.kind,
        customer_id: e.customer_id,
        issued_at: e.issued_at,
        due_at: e.due_at,
        currency_code: e.currency_code,
        discount_minor: e.discount_minor,
        vat_bps: e.vat_bps,
        template: e.template,
        notes: e.notes,
        items: [...data.existingItems].sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ key: i.id, product_id: i.product_id, description: i.description, quantity_milli: i.quantity_milli, qtyText: formatQuantity(i.quantity_milli), unit_price_minor: i.unit_price_minor, discount_minor: i.discount_minor })),
      });
    } else {
      setD({ kind: 'invoice', customer_id: null, issued_at: Date.now(), due_at: null, currency_code: 'IRR', discount_minor: 0n, vat_bps: data.profile?.default_vat_bps ?? DEFAULT_VAT_BPS, template: 'official', notes: '', items: [blankItem(0)] });
    }
  }, [data, d]);

  if (!d || !data) return null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => (p ? { ...p, [k]: v } : p));
  const setItem = (i: number, patch: Partial<Draft['items'][number]>) => setD((p) => (p ? { ...p, items: p.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : p));
  const qtyOk = d.items.every((x) => {
    try {
      return parseQuantity(x.qtyText) === x.quantity_milli;
    } catch {
      return false;
    }
  });
  let totals: ReturnType<typeof computeTotals> | null = null;
  let totalsErr: string | null = null;
  try {
    totals = computeTotals(d.items, d.discount_minor, d.vat_bps);
  } catch (e) {
    totalsErr = toErr(e);
  }
  const money = (v: bigint) => formatMoney(v, d.currency_code, lang, irrUnit);

  const save = async (issue: boolean) => {
    if (!qtyOk) return setErr(t('invoiceErrors.INVOICE_QTY'));
    try {
      const { invoice } = await mutate((db) => saveInvoice(db, { ...d, items: d.items.map(({ key: _k, qtyText: _q, ...rest }) => rest), issue }));
      nav(`/invoices/${invoice.id}`, { replace: true });
    } catch (e) {
      setErr(toErr(e));
    }
  };

  return (
    <Screen title={d.id ? t('invoice.edit') : t('invoice.new')} actions={<BackButton />}>
      <Segmented label={t('invoice.kind')} value={d.kind} onChange={(v) => set('kind', v)} options={[{ value: 'invoice', label: t('invoice.invoice') }, { value: 'proforma', label: t('invoice.proforma') }]} />
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">{t('invoice.buyer')}</span>
          <select value={d.customer_id ?? ''} onChange={(e) => set('customer_id', e.target.value || null)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink" data-testid="invoice-customer">
            <option value="">{t('invoice.noCustomer')}</option>
            {data.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <IconButton label={t('invoice.newCustomer')} onClick={() => setAddingCustomer(true)}>
          <Icon d={ICONS.plus} />
        </IconButton>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <DateField label={t('invoice.date')} value={d.issued_at} onChange={(v) => v !== null && set('issued_at', v)} />
        <DateField label={t('invoice.dueDate')} value={d.due_at} onChange={(v) => set('due_at', v)} optional />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('accounts.currency')}</span>
        <select value={d.currency_code} onChange={(e) => set('currency_code', e.target.value as CurrencyCode)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink">
          {CURRENCIES.filter((c) => c !== 'GOLD_GRAM' && c !== 'COIN').map((c) => (
            <option key={c} value={c}>
              {t(`currency.${c}`)}
            </option>
          ))}
        </select>
      </label>

      <section className="flex flex-col gap-3" aria-label={t('invoice.items')}>
        <h2 className="text-[15px] font-bold">{t('invoice.items')}</h2>
        {d.items.map((it, i) => {
          let gross: bigint | null = null;
          try {
            gross = lineGross(it);
          } catch {
            gross = null;
          }
          return (
            <Card key={it.key} className="flex flex-col gap-2" data-testid="invoice-item">
              {data.products.length > 0 && (
                <select
                  value={it.product_id ?? ''}
                  aria-label={t('invoice.product')}
                  onChange={(e) => {
                    const p = data.products.find((x) => x.id === e.target.value);
                    setItem(i, p ? { product_id: p.id, description: p.name, unit_price_minor: p.currency_code === d.currency_code ? p.unit_price_minor : it.unit_price_minor } : { product_id: null });
                  }}
                  className="min-h-11 rounded-2xl bg-surface-3 px-3 text-[14px] text-ink"
                >
                  <option value="">{t('invoice.freeItem')}</option>
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <Field label={t('invoice.description')} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} data-testid="item-description" />
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
                <Field
                  label={t('invoice.qty')}
                  value={it.qtyText}
                  inputMode="decimal"
                  dir="ltr"
                  data-testid="item-qty"
                  onChange={(e) => {
                    const qtyText = e.target.value;
                    let q = it.quantity_milli;
                    try {
                      q = parseQuantity(qtyText);
                    } catch {
                      /* kept as typed; flagged below */
                    }
                    setItem(i, { qtyText, quantity_milli: q });
                  }}
                />
                <AmountField label={t('invoice.unitPrice')} currency={d.currency_code} value={it.unit_price_minor || null} onChange={(v) => setItem(i, { unit_price_minor: v })} testId="item-price" />
              </div>
              <AmountField label={t('invoice.lineDiscount')} currency={d.currency_code} value={it.discount_minor || null} onChange={(v) => setItem(i, { discount_minor: v })} />
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-ink-2">{t('invoice.amount')}</span>
                <span className="font-bold tabular">{gross !== null && it.discount_minor <= gross ? money(gross - it.discount_minor) : '—'}</span>
              </div>
              {d.items.length > 1 && (
                <Button variant="ghost" className="!min-h-11 text-[13px] text-coral-text" onClick={() => set('items', d.items.filter((_, j) => j !== i))}>
                  {t('invoice.removeItem')}
                </Button>
              )}
            </Card>
          );
        })}
        <Button variant="secondary" onClick={() => set('items', [...d.items, blankItem(d.items.length)])} data-testid="item-add">
          {t('invoice.addItem')}
        </Button>
      </section>

      <AmountField label={t('invoice.discount')} currency={d.currency_code} value={d.discount_minor || null} onChange={(v) => set('discount_minor', v)} />
      <Field
        label={t('invoice.vatRate')}
        value={bpsPercent(d.vat_bps)}
        onChange={(e) => {
          const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(e.target.value.trim());
          if (m) set('vat_bps', Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')));
        }}
        inputMode="decimal"
        dir="ltr"
        hint={t('invoice.vatHint')}
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('invoice.template')}</span>
        <select value={d.template} onChange={(e) => set('template', e.target.value as Invoice['template'])} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink">
          {TEMPLATES.map((x) => (
            <option key={x} value={x}>
              {t(`invoice.templates.${x}`)}
            </option>
          ))}
        </select>
      </label>
      <Field label={t('entry.note')} value={d.notes} onChange={(e) => set('notes', e.target.value)} />

      <Card className="flex flex-col gap-1 text-[14px]" data-testid="invoice-totals">
        {totals ? (
          <>
            <div className="flex justify-between">
              <span className="text-ink-2">{t('invoice.subtotal')}</span>
              <span className="tabular">{money(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-2">{t('invoice.vat', { p: localDigits(bpsPercent(d.vat_bps), lang) })}</span>
              <span className="tabular">{money(totals.vat)}</span>
            </div>
            <div className="flex justify-between text-[16px] font-extrabold">
              <span>{t('invoice.total')}</span>
              <span className="tabular" data-testid="invoice-total">
                {money(totals.total)}
              </span>
            </div>
          </>
        ) : (
          <p className="text-coral-text">{totalsErr}</p>
        )}
      </Card>
      {err && (
        <p role="alert" className="text-[13px] font-semibold text-coral-text">
          {err}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => void save(false)} disabled={!totals} data-testid="invoice-save-draft">
          {t('invoice.saveDraft')}
        </Button>
        <Button onClick={() => void save(true)} disabled={!totals || d.kind === 'proforma'} data-testid="invoice-issue">
          {t('invoice.issue')}
        </Button>
      </div>
      {addingCustomer && (
        <CustomerSheet
          onClose={() => setAddingCustomer(false)}
          onSaved={(c) => {
            set('customer_id', c.id);
            setAddingCustomer(false);
          }}
        />
      )}
    </Screen>
  );
}

// ---------------- detail ----------------

export function InvoiceDetail() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const nav = useNavigate();
  const doc = useDocLang();
  const toErr = useErr();
  const [paper, setPaper] = useState<Paper>('A4');
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data } = useVaultQuery(
    async (db) => {
      const inv = await db.get('invoices', id);
      if (!inv || inv.deleted_at !== null) return null;
      const items = (await db.find('invoice_items', { invoice_id: id })).sort((a, b) => a.sort_order - b.sort_order);
      const customer = inv.customer_id ? ((await db.get('customers', inv.customer_id)) ?? null) : null;
      return { inv, items, customer, accounts: await db.find('accounts'), ...(await loadProfileImages(db)) };
    },
    [id],
  );
  useEffect(() => {
    if (data?.inv.template === 'thermal') setPaper('80');
  }, [data?.inv.template]);
  if (data === undefined) return null;
  if (data === null) return <Screen title={t('invoice.title')} actions={<BackButton />}>{null}</Screen>;
  const { inv } = data;
  const totals = computeTotals(data.items, inv.discount_minor, inv.vat_bps);
  const remaining = totals.total - inv.paid_minor;
  const accounts = liveAccounts(data.accounts).filter((a) => a.currency_code === inv.currency_code);

  return (
    <Screen title={inv.number} actions={<BackButton />}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className={`rounded-full bg-surface-3 px-3 py-1 font-semibold ${STATUS_COLOR[inv.status]}`} data-testid="invoice-status">
          {inv.kind === 'proforma' ? t('invoice.proforma') : t(`invoice.status.${inv.status}`)}
        </span>
        {inv.paid_minor === 0n && (
          <Button variant="ghost" className="!min-h-10 !px-3 text-[13px]" onClick={() => nav(`/invoices/${inv.id}/edit`)}>
            {t('invoice.edit')}
          </Button>
        )}
      </div>
      {inv.kind === 'invoice' && remaining > 0n && (
        <Button onClick={() => setPaying(true)} data-testid="invoice-pay">
          {t('invoice.postPayment')}
        </Button>
      )}
      {inv.paid_minor > 0n && (
        <Button
          variant="ghost"
          className="text-[13px]"
          onClick={async () => {
            try {
              await mutate((db) => undoLastPayment(db, inv.id));
            } catch (e) {
              setErr(toErr(e));
            }
          }}
          data-testid="invoice-undo-payment"
        >
          {t('invoice.undoPayment')}
        </Button>
      )}
      <DocActions
        name={inv.number}
        papers={['A4', 'A5', '80', '58']}
        paper={paper}
        onPaper={setPaper}
        render={(p) => <InvoiceDoc invoice={inv} items={data.items} customer={data.customer} profile={data.profile} totals={totals} logoUrl={data.logoUrl} signatureUrl={data.signatureUrl} paper={p} lang={doc.lang} unit={doc.unit} />}
      />
      {err && (
        <p role="alert" className="text-[13px] font-semibold text-coral-text">
          {err}
        </p>
      )}
      {inv.paid_minor === 0n && (
        <Button
          variant="ghost"
          className="text-[13px] text-coral-text"
          onClick={async () => {
            await mutate((db) => deleteInvoice(db, inv.id));
            nav('/invoices', { replace: true });
          }}
        >
          {t('invoice.delete')}
        </Button>
      )}
      {paying && <PaySheet invoiceId={inv.id} currency={inv.currency_code} remaining={remaining} accounts={accounts} onClose={() => setPaying(false)} />}
    </Screen>
  );
}

function PaySheet({ invoiceId, currency, remaining, accounts, onClose }: { invoiceId: string; currency: CurrencyCode; remaining: bigint; accounts: ReturnType<typeof liveAccounts>; onClose: () => void }) {
  const { t } = useTranslation();
  const toErr = useErr();
  const [accountId, setAccountId] = useState<string | null>(accounts[0]?.id ?? null);
  const [amount, setAmount] = useState<bigint>(remaining);
  const [when, setWhen] = useState<number>(Date.now());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title={t('invoice.postPayment')}>
      {accounts.length === 0 ? (
        <p className="text-[14px] text-ink-2">{t('invoice.noAccountInCurrency')}</p>
      ) : (
        <>
          <AccountSelect label={t('cheques.account')} accounts={accounts} value={accountId} onChange={setAccountId} testId="pay-account" />
          <AmountField label={t('invoice.payAmount')} currency={currency} value={amount} onChange={setAmount} />
          <DateField label={t('invoice.payDate')} value={when} onChange={(v) => v !== null && setWhen(v)} />
          {err && (
            <p role="alert" className="text-[13px] font-semibold text-coral-text">
              {err}
            </p>
          )}
          <Button
            disabled={busy || !accountId}
            data-testid="pay-confirm"
            onClick={async () => {
              if (!accountId) return;
              setBusy(true);
              try {
                await mutate((db) => postInvoicePayment(db, invoiceId, { account_id: accountId, amount_minor: amount, occurred_at: when }));
                onClose();
              } catch (e) {
                setErr(toErr(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('invoice.confirmPayment')}
          </Button>
        </>
      )}
    </Sheet>
  );
}

// ---------------- business profile ----------------

export function BusinessProfileScreen() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toErr = useErr();
  const open = useVault((s) => s.open);
  const { data } = useVaultQuery(loadProfileImages);
  const [p, setP] = useState<ProfileInput | null>(null);
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  useEffect(() => {
    if (data && !p) {
      const { id: _i, created_at: _c, updated_at: _u, deleted_at: _d, ...rest } = data.profile ?? { id: '', created_at: 0, updated_at: 0, deleted_at: null, ...emptyProfile() };
      setP(rest);
    }
  }, [data, p]);
  if (!p || !data || !open) return null;
  const errors = validateProfile(p);
  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setP((x) => (x ? { ...x, [k]: v } : x));

  const persist = async (next: ProfileInput) => {
    if (validateProfile(next).length) return;
    await mutate((db) => saveProfile(db, next));
  };
  const replaceImage = async (field: 'logo_attachment_id' | 'signature_attachment_id', bytes: Uint8Array) => {
    try {
      const row = await mutate((db) => saveImageAttachment(db, { owner_type: 'business_profile', owner_id: PROFILE_ID }, bytes));
      const old = p[field];
      const next = { ...p, [field]: row.id };
      setP(next);
      await persist(next);
      if (old) await mutate((db) => deleteAttachment(db, old));
    } catch (e) {
      setErr(toErr(e));
    }
  };

  return (
    <Screen title={t('invoice.profile')} actions={<BackButton />}>
      <Field label={t('invoice.businessName')} value={p.name} onChange={(e) => set('name', e.target.value)} error={touched && errors.includes('name') ? t('invoiceErrors.name') : undefined} data-testid="profile-name" />
      <Field label={t('invoice.nationalId')} value={p.national_id} onChange={(e) => set('national_id', e.target.value)} inputMode="numeric" dir="ltr" error={touched && errors.includes('national_id') ? t('invoiceErrors.national_id') : undefined} hint={t('invoice.nationalIdHint')} data-testid="profile-nid" />
      <Field label={t('invoice.economicCode')} value={p.economic_code} onChange={(e) => set('economic_code', e.target.value)} inputMode="numeric" dir="ltr" error={touched && errors.includes('economic_code') ? t('invoiceErrors.economic_code') : undefined} data-testid="profile-eco" />
      <Field label={t('invoice.address')} value={p.address} onChange={(e) => set('address', e.target.value)} />
      <Field label={t('invoice.phone')} value={p.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" dir="ltr" />
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('invoice.prefix')} value={p.invoice_prefix} onChange={(e) => set('invoice_prefix', e.target.value.toUpperCase())} dir="ltr" maxLength={5} error={touched && errors.includes('prefix') ? t('invoiceErrors.prefix') : undefined} />
        <Field
          label={t('invoice.vatRate')}
          value={bpsPercent(p.default_vat_bps)}
          onChange={(e) => {
            const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(e.target.value.trim());
            if (m) set('default_vat_bps', Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')));
          }}
          inputMode="decimal"
          dir="ltr"
          error={touched && errors.includes('vat') ? t('invoiceErrors.INVOICE_VAT') : undefined}
        />
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="text-[15px] font-bold">{t('invoice.logo')}</h2>
        {data.logoUrl && <img src={data.logoUrl} alt={t('invoice.logo')} className="h-16 w-auto self-start rounded-xl bg-white object-contain p-1" />}
        <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-2xl bg-surface-3 text-[15px] font-semibold">
          {t('invoice.pickLogo')}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            data-testid="profile-logo"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) await replaceImage('logo_attachment_id', new Uint8Array(await f.arrayBuffer()));
            }}
          />
        </label>
        <p className="text-[12px] text-ink-2">{t('invoice.encryptedNote')}</p>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-[15px] font-bold">{t('invoice.signature')}</h2>
        {data.signatureUrl && <img src={data.signatureUrl} alt={t('invoice.signature')} className="h-16 w-auto self-start rounded-xl bg-white object-contain p-1" />}
        <Button variant="secondary" onClick={() => setSigning(true)} data-testid="profile-sign">
          {t('invoice.drawSignature')}
        </Button>
      </Card>

      <ThermalSettings />

      {err && (
        <p role="alert" className="text-[13px] font-semibold text-coral-text">
          {err}
        </p>
      )}
      <Button
        data-testid="profile-save"
        onClick={async () => {
          setTouched(true);
          if (errors.length) return;
          try {
            await persist(p);
            nav(-1);
          } catch (e) {
            setErr(toErr(e));
          }
        }}
      >
        {t('accounts.save')}
      </Button>
      {signing && (
        <SignatureSheet
          onClose={() => setSigning(false)}
          onDone={async (bytes) => {
            setSigning(false);
            await replaceImage('signature_attachment_id', bytes);
          }}
        />
      )}
    </Screen>
  );
}

/** Touch signature canvas: pointer events, ink only (transparent background), exported as PNG bytes. */
function SignatureSheet({ onClose, onDone }: { onClose: () => void; onDone: (png: Uint8Array) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = 2;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b1a3a';
  }, []);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <Sheet open onClose={onClose} title={t('invoice.drawSignature')}>
      <canvas
        ref={ref}
        className="h-44 w-full touch-none rounded-2xl bg-white"
        aria-label={t('invoice.signatureArea')}
        data-testid="signature-canvas"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = pos(e);
        }}
        onPointerMove={(e) => {
          if (!last.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
          setDrawn(true);
        }}
        onPointerUp={() => (last.current = null)}
        onPointerCancel={() => (last.current = null)}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            const c = ref.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            setDrawn(false);
          }}
        >
          {t('invoice.clear')}
        </Button>
        <Button
          disabled={!drawn}
          data-testid="signature-save"
          onClick={() =>
            ref.current!.toBlob(async (b) => {
              if (b) onDone(new Uint8Array(await b.arrayBuffer()));
            }, 'image/png')
          }
        >
          {t('accounts.save')}
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------- catalogs ----------------

function CustomerSheet({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const { t } = useTranslation();
  const toErr = useErr();
  const [c, setC] = useState({ name: customer?.name ?? '', national_id: customer?.national_id ?? '', economic_code: customer?.economic_code ?? '', address: customer?.address ?? '', phone: customer?.phone ?? '' });
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const errors = validateParty(c);
  const set = (k: keyof typeof c, v: string) => setC((x) => ({ ...x, [k]: v }));
  return (
    <Sheet open onClose={onClose} title={customer ? t('invoice.editCustomer') : t('invoice.newCustomer')}>
      <Field label={t('invoice.customerName')} value={c.name} onChange={(e) => set('name', e.target.value)} error={touched && errors.includes('name') ? t('invoiceErrors.name') : undefined} data-testid="customer-name" />
      <Field label={t('invoice.nationalId')} value={c.national_id} onChange={(e) => set('national_id', e.target.value)} inputMode="numeric" dir="ltr" error={touched && errors.includes('national_id') ? t('invoiceErrors.national_id') : undefined} />
      <Field label={t('invoice.economicCode')} value={c.economic_code} onChange={(e) => set('economic_code', e.target.value)} inputMode="numeric" dir="ltr" error={touched && errors.includes('economic_code') ? t('invoiceErrors.economic_code') : undefined} />
      <Field label={t('invoice.address')} value={c.address} onChange={(e) => set('address', e.target.value)} />
      <Field label={t('invoice.phone')} value={c.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" dir="ltr" />
      {err && (
        <p role="alert" className="text-[13px] font-semibold text-coral-text">
          {err}
        </p>
      )}
      <Button
        data-testid="customer-save"
        onClick={async () => {
          setTouched(true);
          if (errors.length) return;
          try {
            onSaved(await mutate((db) => saveCustomer(db, { ...c, ...(customer ? { id: customer.id } : {}) })));
          } catch (e) {
            setErr(toErr(e));
          }
        }}
      >
        {t('accounts.save')}
      </Button>
    </Sheet>
  );
}

function ProductSheet({ product, onClose }: { product?: Product; onClose: () => void }) {
  const { t } = useTranslation();
  const toErr = useErr();
  const [name, setName] = useState(product?.name ?? '');
  const [unit, setUnit] = useState(product?.unit ?? '');
  const [currency, setCurrency] = useState<CurrencyCode>(product?.currency_code ?? 'IRR');
  const [price, setPrice] = useState<bigint>(product?.unit_price_minor ?? 0n);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet open onClose={onClose} title={product ? t('invoice.editProduct') : t('invoice.newProduct')}>
      <Field label={t('invoice.productName')} value={name} onChange={(e) => setName(e.target.value)} data-testid="product-name" />
      <Field label={t('invoice.unit')} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t('invoice.unitHint')} />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('accounts.currency')}</span>
        <select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink">
          {CURRENCIES.filter((c) => c !== 'GOLD_GRAM' && c !== 'COIN').map((c) => (
            <option key={c} value={c}>
              {t(`currency.${c}`)}
            </option>
          ))}
        </select>
      </label>
      <AmountField label={t('invoice.unitPrice')} currency={currency} value={price || null} onChange={setPrice} testId="product-price" />
      {err && (
        <p role="alert" className="text-[13px] font-semibold text-coral-text">
          {err}
        </p>
      )}
      <Button
        data-testid="product-save"
        onClick={async () => {
          try {
            await mutate((db) => saveProduct(db, { name, unit, currency_code: currency, unit_price_minor: price, ...(product ? { id: product.id } : {}) }));
            onClose();
          } catch (e) {
            setErr(toErr(e));
          }
        }}
      >
        {t('accounts.save')}
      </Button>
    </Sheet>
  );
}

export function CatalogScreen() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [tab, setTab] = useState<'customers' | 'products'>('customers');
  const [editing, setEditing] = useState<{ kind: 'customer'; row?: Customer } | { kind: 'product'; row?: Product } | null>(null);
  const { data } = useVaultQuery(async (db) => ({ customers: (await db.find('customers')).filter((c) => c.deleted_at === null), products: (await db.find('products')).filter((p) => p.deleted_at === null) }));
  const rows = tab === 'customers' ? (data?.customers ?? []) : (data?.products ?? []);
  return (
    <Screen
      title={t('invoice.catalog')}
      actions={
        <>
          <IconButton label={tab === 'customers' ? t('invoice.newCustomer') : t('invoice.newProduct')} onClick={() => setEditing(tab === 'customers' ? { kind: 'customer' } : { kind: 'product' })}>
            <Icon d={ICONS.plus} />
          </IconButton>
          <BackButton />
        </>
      }
    >
      <Segmented label={t('invoice.catalog')} value={tab} onChange={setTab} options={[{ value: 'customers', label: t('invoice.customers') }, { value: 'products', label: t('invoice.products') }]} />
      {rows.length === 0 && <p className="py-8 text-center text-[14px] text-ink-2">{t('invoice.catalogEmpty')}</p>}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-2xl border border-hairline bg-surface-1 p-3">
            <button type="button" className="flex min-w-0 flex-1 flex-col text-start" onClick={() => setEditing('unit' in r ? { kind: 'product', row: r } : { kind: 'customer', row: r as Customer })}>
              <span className="truncate text-[15px] font-semibold">{r.name}</span>
              <span className="truncate text-[12px] text-ink-2">{'unit' in r ? `${formatMoney(r.unit_price_minor, r.currency_code, lang, irrUnit)}${r.unit ? ` / ${r.unit}` : ''}` : (r as Customer).phone || (r as Customer).national_id || '—'}</span>
            </button>
            <IconButton label={t('ledger.delete')} onClick={() => void mutate((db) => deleteCatalogRow(db, tab, r.id))}>
              <Icon d={ICONS.trash} className="h-5 w-5" />
            </IconButton>
          </li>
        ))}
      </ul>
      {editing?.kind === 'customer' && <CustomerSheet {...(editing.row ? { customer: editing.row } : {})} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
      {editing?.kind === 'product' && <ProductSheet {...(editing.row ? { product: editing.row } : {})} onClose={() => setEditing(null)} />}
    </Screen>
  );
}
