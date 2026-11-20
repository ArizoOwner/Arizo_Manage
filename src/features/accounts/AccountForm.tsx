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
import { Glyph } from '../../core/ui/glyphs';
import { CardScanner } from './CardScanner';

const TYPES: AccountType[] = ['bank_card', 'bank_account', 'cash', 'savings_vault', 'investment', 'crypto', 'gold', 'wallet'];

const blank: AccountInput = {
  name: '',
  type: 'bank_card',
  bank_code: null,
  card_number: '',
  card_expiry: '',
  card_expiry_jalali: true,
  card_cvv2: '',
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
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);

  const detected = useMemo(() => detectBankByCard(v.card_number), [v.card_number]);
  const errors = validateAccount(v);
  let balanceError: string | undefined;
  try {
    unit.parse(balanceText);
  } catch {
    balanceError = t('keypad.overflow');
  }
  const msg = { name: 'accounts.invalidName', card: 'accounts.invalidCard', sheba: 'accounts.invalidSheba', expiry: 'scan.invalidExpiry', cvv2: 'scan.invalidCvv2' } as const;
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
          {/* Scan: fills number, expiry, CVV2, Sheba and bank from the camera, all on this device. */}
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="group relative flex min-h-16 items-center gap-3 overflow-hidden rounded-2xl border border-emerald/30 bg-[linear-gradient(120deg,color-mix(in_srgb,var(--arizo-accent-primary)_14%,transparent),transparent_60%)] p-3 text-start transition-transform active:scale-[0.98]"
            data-testid="scan-card"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald/15 text-emerald-text">
              <Glyph name="scan" className="h-6 w-6" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px] font-bold text-ink">{t('scan.cta')}</span>
              <span className="text-[12px] text-ink-2">{scanned ? t('scan.filled') : t('scan.ctaHint')}</span>
            </span>
          </button>
          {scanning && (
            <CardScanner
              onClose={() => setScanning(false)}
              onResult={(r) => {
                setScanned(true);
                setV((p) => ({
                  ...p,
                  card_number: r.number,
                  card_expiry: r.expiry ?? p.card_expiry ?? '',
                  card_expiry_jalali: r.expiry ? r.expiryJalali : (p.card_expiry_jalali ?? true),
                  card_cvv2: r.cvv2 ?? p.card_cvv2 ?? '',
                  iban_sheba: r.sheba ?? p.iban_sheba,
                  bank_code: r.bankCode ?? p.bank_code,
                }));
              }}
            />
          )}
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
          {v.type === 'bank_card' && (
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={v.card_expiry_jalali ? t('scan.expiryJalali') : t('scan.expiry')}
                value={v.card_expiry ?? ''}
                onChange={(e) => set('card_expiry', e.target.value.replace(/[^\d۰-۹/]/g, '').slice(0, 5))}
                error={show('expiry')}
                placeholder={v.card_expiry_jalali ? '۰۸/۰۷' : '08/29'}
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                data-testid="acc-expiry"
              />
              <Field
                label={t('scan.cvv2')}
                value={v.card_cvv2 ?? ''}
                onChange={(e) => set('card_cvv2', e.target.value.replace(/[^\d۰-۹]/g, '').slice(0, 4))}
                error={show('cvv2')}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                data-testid="acc-cvv2"
              />
              <label className="col-span-2 -mt-1 flex items-center gap-2 text-[12px] text-ink-2">
                <input type="checkbox" checked={v.card_expiry_jalali ?? true} onChange={(e) => set('card_expiry_jalali', e.target.checked)} className="h-4 w-4 accent-[var(--arizo-accent-primary)]" />
                {t('scan.jalaliYear')}
              </label>
            </div>
          )}
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
