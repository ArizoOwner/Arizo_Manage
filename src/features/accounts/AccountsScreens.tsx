// Accounts list, detail (hero morph, reconcile, masked card/Sheba with re-auth), editor and manual rates.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useSettings } from '../../app/stores/settings';
import { mutate, useVault } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { ArizoSecurity, isNative } from '../../core/bridge/native';
import { bankByCode } from '../../core/data/banks';
import { CURRENCIES, parseMajor, type CurrencyCode } from '../../core/currency/money';
import { formatDate, formatMoney } from '../../core/i18n/format';
import { reconcileBalance, setArchived } from '../../core/ledger/accounts';
import { computeNetWorth, latestRate } from '../../core/ledger/networth';
import { ParallaxCard } from '../../core/motion/ParallaxCard';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import { uuidv7 } from '../../core/utils/uuidv7';
import { maskCard } from '../../core/validators';
import { Button, Card, Field, Icon, IconButton, ICONS, Screen, Sheet } from '../../core/ui/ui';
import { useReauth } from '../security/ReauthSheet';
import { TxRow } from '../transactions/TxRow';
import { AccountForm } from './AccountForm';

function BackButton() {
  const { t } = useTranslation();
  const nav = useNavigate();
  return (
    <IconButton label={t('onboarding.back')} onClick={() => nav(-1)}>
      <Icon d={ICONS.back} className="h-[22px] w-[22px] rtl:rotate-180" />
    </IconButton>
  );
}

export function AccountsList() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  const { data } = useVaultQuery(async (db) => ({ accounts: await db.find('accounts'), rates: await db.find('exchange_rates') }));
  const accounts = (data?.accounts ?? []).filter((a) => a.deleted_at === null).sort((a, b) => Number(a.is_archived) - Number(b.is_archived) || a.sort_order - b.sort_order);
  const nw = data ? computeNetWorth(data.accounts, data.rates) : null;

  return (
    <Screen
      title={t('accounts.title')}
      actions={
        <IconButton label={t('accounts.new')} onClick={() => nav('/accounts/new')}>
          <Icon d={ICONS.plus} />
        </IconButton>
      }
    >
      {nw && (
        <Card className="flex items-center justify-between">
          <span className="text-[13px] text-ink-2">{t('dash.netWorth')}</span>
          <PrivacyBlur>
            <span className="text-[17px] font-extrabold text-gold-text tabular">{formatMoney(nw.totalMinor, 'IRR', lang, irrUnit)}</span>
          </PrivacyBlur>
        </Card>
      )}
      <div className="flex flex-col gap-2">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => nav(`/accounts/${a.id}`)}
            className={`flex min-h-16 items-center gap-3 rounded-2xl border border-hairline bg-surface-1 px-4 text-start ${a.is_archived ? 'opacity-60' : ''}`}
            data-testid="account-row"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-semibold">{a.name}</span>
              <span className="text-[12px] text-ink-2">
                {t(`accounts.types.${a.type}`)}
                {a.is_archived && ` · ${t('accounts.archived')}`}
              </span>
            </span>
            <PrivacyBlur>
              <span className="text-[15px] font-bold tabular">{formatMoney(a.current_balance_minor, a.currency_code, lang, irrUnit)}</span>
            </PrivacyBlur>
          </button>
        ))}
      </div>
      <Button variant="secondary" onClick={() => nav('/rates')}>
        {t('accounts.rates')}
      </Button>
    </Screen>
  );
}

export function AccountNew() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const open = useVault((s) => s.open);
  if (!open) return null;
  return (
    <Screen title={t('accounts.new')} actions={<BackButton />}>
      <AccountForm db={open.db} onSaved={(a) => nav(`/accounts/${a.id}`, { replace: true })} />
    </Screen>
  );
}

export function AccountDetail() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const nav = useNavigate();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const open = useVault((s) => s.open);
  const { request, sheet } = useReauth();
  const [editing, setEditing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { data } = useVaultQuery(
    async (db) => ({
      account: await db.get('accounts', id),
      txs: await db.find('transactions', { account_id: id }),
      all: await db.find('accounts'),
      cats: await db.find('categories'),
    }),
    [id],
  );
  const a = data?.account;
  const txs = useMemo(() => (data?.txs ?? []).filter((x) => x.deleted_at === null).sort((x, y) => y.occurred_at - x.occurred_at), [data]);
  if (!open || !data) return null;
  if (!a) return <Screen title={t('accounts.title')} actions={<BackButton />}>{null}</Screen>;
  const bank = bankByCode(a.bank_code);
  const byId = new Map(data.all.map((x) => [x.id, x]));
  const catById = new Map(data.cats.map((c) => [c.id, c]));

  const copy = (text: string) =>
    request(async () => {
      if (isNative()) await ArizoSecurity.copySensitive({ text });
      else {
        await navigator.clipboard?.writeText(text);
        // Best effort on the web: clear our own value after 45 s if it is still there.
        window.setTimeout(() => {
          void navigator.clipboard
            ?.readText?.()
            .then((cur) => (cur === text ? navigator.clipboard.writeText('') : undefined))
            .catch(() => {});
        }, 45_000);
      }
      setNotice(t('accounts.copied'));
    });

  return (
    <Screen title={a.name} actions={<BackButton />}>
      <ParallaxCard
        finish={a.card_finish}
        bankName={bank ? (lang === 'fa' ? bank.name_fa : bank.name_en) : t(`accounts.types.${a.type}`)}
        accountName={a.name}
        last4={a.card_last4}
        balanceMinor={a.current_balance_minor}
        currency={a.currency_code}
        layoutId={`card-${a.id}`}
      />
      {(a.card_number_enc || a.iban_sheba) && (
        <Card className="flex flex-col gap-3">
          {a.card_number_enc && (
            <div className="flex items-center justify-between gap-2">
              <PrivacyBlur>
                <span className="text-[15px] font-semibold tabular" dir="ltr" data-testid="card-number">
                  {revealed ? a.card_number_enc.replace(/(\d{4})(?=\d)/g, '$1 ') : maskCard(a.card_number_enc)}
                </span>
              </PrivacyBlur>
              <div className="flex gap-1">
                {!revealed && (
                  <Button variant="ghost" className="!min-h-11 !px-3 text-[13px]" onClick={() => request(() => setRevealed(true))} data-testid="reveal-card">
                    {t('accounts.reveal')}
                  </Button>
                )}
                <IconButton label={t('accounts.copyCard')} onClick={() => copy(a.card_number_enc!)}>
                  <Icon d={ICONS.copy} />
                </IconButton>
              </div>
            </div>
          )}
          {a.iban_sheba && (
            <div className="flex items-center justify-between gap-2">
              <PrivacyBlur>
                <span className="text-[13px] tabular text-ink-2" dir="ltr">
                  {revealed ? a.iban_sheba : `${a.iban_sheba.slice(0, 4)} •••• ${a.iban_sheba.slice(-4)}`}
                </span>
              </PrivacyBlur>
              <IconButton label={t('accounts.copySheba')} onClick={() => copy(a.iban_sheba!)}>
                <Icon d={ICONS.copy} />
              </IconButton>
            </div>
          )}
          {notice && (
            <p role="status" className="text-[12px] text-emerald-text">
              {notice}
            </p>
          )}
        </Card>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Button variant="secondary" className="!px-2 text-[13px]" onClick={() => setEditing(true)}>
          {t('accounts.edit')}
        </Button>
        <Button variant="secondary" className="!px-2 text-[13px]" onClick={() => setReconciling(true)} data-testid="reconcile">
          {t('accounts.reconcile')}
        </Button>
        <Button
          variant="secondary"
          className="!px-2 text-[13px]"
          onClick={() => void mutate((db) => setArchived(db, a.id, !a.is_archived)).then(() => !a.is_archived && nav('/accounts'))}
        >
          {a.is_archived ? t('accounts.unarchive') : t('accounts.archive')}
        </Button>
      </div>
      <Button variant="secondary" className="text-[13px]" onClick={() => nav(`/accounts/${a.id}/statement`)} data-testid="account-statement">
        {t('statement.open')}
      </Button>
      <section className="flex flex-col gap-1">
        {txs.slice(0, 50).map((x) => (
          <div key={x.id} className="flex flex-col">
            <span className="px-3 pt-2 text-[11px] text-ink-2">{formatDate(x.occurred_at, cal, lang)}</span>
            <TxRow tx={x} account={a} counterparty={x.counterparty_account_id ? byId.get(x.counterparty_account_id) : undefined} category={x.category_id ? catById.get(x.category_id) : undefined} />
          </div>
        ))}
      </section>

      <Sheet open={editing} onClose={() => setEditing(false)} title={t('accounts.edit')}>
        <AccountForm db={open.db} account={a} onSaved={() => setEditing(false)} />
      </Sheet>
      <ReconcileSheet open={reconciling} onClose={() => setReconciling(false)} accountId={a.id} currency={a.currency_code} toman={a.currency_code === 'IRR' && irrUnit === 'toman'} />
      {sheet}
    </Screen>
  );
}

function ReconcileSheet({ open, onClose, accountId, currency, toman }: { open: boolean; onClose: () => void; accountId: string; currency: CurrencyCode; toman: boolean }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | undefined>();
  return (
    <Sheet open={open} onClose={onClose} title={t('accounts.reconcile')}>
      <Field label={`${t('accounts.reconcileHint')} (${toman ? t('unit.toman') : currency})`} value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" dir="ltr" error={err} data-testid="reconcile-input" />
      <Button
        data-testid="reconcile-save"
        onClick={async () => {
          try {
            const minor = toman ? parseMajor(text, 'IRR') * 10n : parseMajor(text, currency);
            await mutate((db) => reconcileBalance(db, accountId, minor));
            setText('');
            onClose();
          } catch {
            setErr(t('keypad.overflow'));
          }
        }}
      >
        {t('accounts.save')}
      </Button>
    </Sheet>
  );
}

/** Manual offline exchange rates with history (PROMPT.md §4.1 #16). Stored as base → IRR in ppm. */
export function RatesScreen() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const { data } = useVaultQuery((db) => db.find('exchange_rates'));
  const [base, setBase] = useState<CurrencyCode>('USD');
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const rates = (data ?? []).filter((r) => r.deleted_at === null && r.quote_currency === 'IRR').sort((a, b) => b.effective_at - a.effective_at);
  const now = Date.now();

  return (
    <Screen title={t('accounts.rates')} actions={<BackButton />}>
      <Card className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">{t('accounts.currency')}</span>
          <select value={base} onChange={(e) => setBase(e.target.value as CurrencyCode)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px]" data-testid="rate-base">
            {CURRENCIES.filter((c) => c !== 'IRR').map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <Field label={t('accounts.rateFor', { base })} value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" dir="ltr" error={err} data-testid="rate-value" />
        <Button
          data-testid="rate-save"
          onClick={async () => {
            try {
              // Rial per 1 major unit, kept to 6 decimals as ppm.
              const ppm = parseMajor(text, 'USDT');
              if (ppm <= 0n) throw new Error('invalid');
              await mutate((db) =>
                db.put('exchange_rates', { id: uuidv7(), created_at: Date.now(), updated_at: Date.now(), deleted_at: null, base_currency: base, quote_currency: 'IRR', rate_ppm: ppm, effective_at: Date.now() }),
              );
              setText('');
              setErr(undefined);
            } catch {
              setErr(t('keypad.overflow'));
            }
          }}
        >
          {t('accounts.addRate')}
        </Button>
      </Card>
      {CURRENCIES.filter((c) => c !== 'IRR').map((c) => {
        const latest = latestRate(rates, c, 'IRR', now);
        const history = rates.filter((r) => r.base_currency === c);
        if (!history.length) return null;
        return (
          <Card key={c} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-bold">{c}</span>
              {latest && <span className="text-[15px] font-bold tabular text-gold-text">{formatMoney(latest.rate_ppm / 1_000_000n, 'IRR', lang, 'rial')}</span>}
            </div>
            {history.slice(0, 6).map((r) => (
              <div key={r.id} className="flex justify-between text-[12px] text-ink-2">
                <span>{formatDate(r.effective_at, cal, lang)}</span>
                <span className="tabular">{formatMoney(r.rate_ppm / 1_000_000n, 'IRR', lang, 'rial')}</span>
              </div>
            ))}
          </Card>
        );
      })}
      {!rates.length && <p className="text-center text-[13px] text-ink-2">{t('accounts.noRates')}</p>}
    </Screen>
  );
}
