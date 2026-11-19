// Account create/edit form with Luhn + Sheba validation and live BIN bank detection.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { useVault } from '../../app/stores/vault';
import { BANKS, detectBankByCard } from '../../core/data/banks';
import { CURRENCIES, MINOR_DIGITS, parseMajor, formatMinor, type CurrencyCode } from '../../core/currency/money';
import { accountToInput, createAccount, updateAccount, validateAccount, type AccountInput } from '../../core/ledger/accounts';
import { LedgerError } from '../../core/ledger/ledger';
import type { IVaultDatabase } from '../../core/storage/IVaultDatabase';
import type { Account, AccountType } from '../../core/storage/schema';
import { CARD_FINISH_IDS, CARD_FINISHES } from '../../core/theme/cardFinishes';
import { Button, Field, Toggle } from '../../core/ui/ui';

const TYPES: AccountType[] = ['bank_card', 'bank_account', 'cash', 'savings_vault', 'investment', 'crypto', 'gold', 'wallet'];

const blank: AccountInput = {
  name: '',
  type: 'bank_card',
  bank_code: null,
  card_number: '',
  iban_sheba: '',
  account_number: '',
  currency_code: 'IRR',
  initial_balance_minor: 0n,
  card_finish: 'obsidian_carbon',
  is_included_in_net_worth: true,
  notes: '',
};

/** The opening balance is typed in the display unit: Toman for IRR (when chosen), else major units. */
function useBalanceUnit(currency: CurrencyCode) {
  const irrUnit = useSettings((s) => s.irrUnit);
  const toman = currency === 'IRR' && irrUnit === 'toman';
  return {
    toman,
    parse: (s: string) => (toman ? parseMajor(s || '0', 'IRR') * 10n : parseMajor(s || '0', currency)),
    format: (minor: bigint) => (toman ? formatMinor(minor / 10n, 'IRR', '') : formatMinor(minor, currency, '')),
  };
}

export function AccountForm({ db, account, onSaved, submitLabel }: { db: IVaultDatabase; account?: Account; onSaved: (a: Account) => void; submitLabel?: string }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const [v, setV] = useState<AccountInput>(() => (account ? accountToInput(account) : blank));
  const unit = useBalanceUnit(v.currency_code);
  const [balanceText, setBalanceText] = useState(() => (account ? unit.format(account.initial_balance_minor) : ''));
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const detected = useMemo(() => detectBankByCard(v.card_number), [v.card_number]);
  const errors = validateAccount(v);
  let balanceError: string | undefined;
  try {
    unit.parse(balanceText);
  } catch {
    balanceError = t('keypad.overflow');
  }
  const msg = { name: 'accounts.invalidName', card: 'accounts.invalidCard', sheba: 'accounts.invalidSheba' } as const;
  const show = (k: keyof typeof msg) => (touched && errors.includes(k) ? t(msg[k]) : undefined);
  const set = <K extends keyof AccountInput>(k: K, val: AccountInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const isCard = v.type === 'bank_card' || v.type === 'bank_account';

  const save = async () => {
    setTouched(true);
    if (errors.length || balanceError) return;
    setBusy(true);
    setFormError(null);
    try {
      const input: AccountInput = { ...v, bank_code: v.bank_code ?? detected?.code ?? null, initial_balance_minor: unit.parse(balanceText) };
      const saved = account ? await updateAccount(db, account.id, input) : await createAccount(db, input);
      useVault.getState().bump();
      onSaved(saved);
    } catch (e) {
      setFormError(e instanceof LedgerError && e.code === 'CURRENCY_LOCKED' ? t('accounts.currencyLocked') : String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <Field label={t('accounts.name')} value={v.name} onChange={(e) => set('name', e.target.value)} error={show('name')} autoComplete="off" data-testid="acc-name" />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('accounts.type')}</span>
        <select value={v.type} onChange={(e) => set('type', e.target.value as AccountType)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink">
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`accounts.types.${ty}`)}
            </option>
          ))}
        </select>
      </label>
      {isCard && (
        <>
          <Field
            label={t('accounts.card')}
            value={v.card_number}
            onChange={(e) => set('card_number', e.target.value)}
            error={show('card')}
            hint={detected ? t('accounts.detected', { b: lang === 'fa' ? detected.name_fa : detected.name_en }) : undefined}
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            data-testid="acc-card"
          />
          <Field label={t('accounts.sheba')} value={v.iban_sheba} onChange={(e) => set('iban_sheba', e.target.value)} error={show('sheba')} placeholder="IR…" autoComplete="off" dir="ltr" data-testid="acc-sheba" />
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink-2">{t('accounts.bank')}</span>
            <select value={v.bank_code ?? detected?.code ?? ''} onChange={(e) => set('bank_code', e.target.value || null)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink">
              <option value="">{t('accounts.noBank')}</option>
              {BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {lang === 'fa' ? b.name_fa : b.name_en}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('accounts.currency')}</span>
        <select value={v.currency_code} onChange={(e) => set('currency_code', e.target.value as CurrencyCode)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink">
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <Field
        label={`${t('accounts.initial')} (${unit.toman ? t('unit.toman') : v.currency_code})`}
        value={balanceText}
        onChange={(e) => setBalanceText(e.target.value)}
        inputMode={MINOR_DIGITS[v.currency_code] ? 'decimal' : 'numeric'}
        error={touched ? balanceError : undefined}
        dir="ltr"
        data-testid="acc-balance"
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('accounts.finish')}</legend>
        <div className="grid grid-cols-6 gap-2">
          {CARD_FINISH_IDS.map((f) => (
            <button
              key={f}
              type="button"
              aria-label={t(`card.finish.${f}`)}
              aria-pressed={v.card_finish === f}
              onClick={() => set('card_finish', f)}
              className={`aspect-square rounded-xl border-2 ${v.card_finish === f ? 'border-gold-mark' : 'border-transparent'}`}
              style={{ background: `linear-gradient(135deg, ${CARD_FINISHES[f].from}, ${CARD_FINISHES[f].to})` }}
            />
          ))}
        </div>
      </fieldset>
      <Toggle label={t('accounts.includeNw')} checked={v.is_included_in_net_worth} onChange={(on) => set('is_included_in_net_worth', on)} />
      {formError && (
        <p role="alert" className="text-[13px] font-semibold text-coral-text">
          {formError}
        </p>
      )}
      <Button type="submit" disabled={busy} data-testid="acc-save">
        {submitLabel ?? t('accounts.save')}
      </Button>
    </form>
  );
}
