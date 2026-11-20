// Shared bits for the obligation screens: amount + date pickers in sheets, account select, back button.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useSettings } from '../../app/stores/settings';
import type { CurrencyCode } from '../../core/currency/money';
import { formatDate, formatMoney } from '../../core/i18n/format';
import { CalculatorKeypad } from '../../core/motion/CalculatorKeypad';
import { DualDatePicker } from '../../core/motion/DualDatePicker';
import type { Account } from '../../core/storage/schema';
import { Icon, IconButton, ICONS, Sheet } from '../../core/ui/ui';

export function BackButton() {
  const { t } = useTranslation();
  const nav = useNavigate();
  return (
    <IconButton label={t('onboarding.back')} onClick={() => nav(-1)}>
      <Icon d={ICONS.back} className="h-[22px] w-[22px] rtl:rotate-180" />
    </IconButton>
  );
}

export function AmountField({ label, currency, value, onChange, testId }: { label: string; currency: CurrencyCode; value: bigint | null; onChange: (v: bigint) => void; testId?: string }) {
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-12 min-w-0 items-center justify-between gap-2 rounded-2xl bg-surface-3 px-4 text-[15px]" data-testid={testId}>
        <span className="truncate text-ink-2">{label}</span>
        <span className="truncate font-bold tabular">{value !== null ? formatMoney(value, currency, lang, irrUnit) : '—'}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <CalculatorKeypad
          currency={currency}
          initialMinor={value ?? 0n}
          onDone={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

export function DateField({ label, value, onChange, optional }: { label: string; value: number | null; onChange: (v: number | null) => void; optional?: boolean }) {
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(true)} className="flex min-h-12 flex-1 items-center justify-between rounded-2xl bg-surface-3 px-4 text-[15px]">
          <span className="text-ink-2">{label}</span>
          <span className="font-semibold">{value !== null ? formatDate(value, cal, lang) : '—'}</span>
        </button>
        {optional && value !== null && (
          <button type="button" onClick={() => onChange(null)} aria-label="✕" className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-3 text-ink-2">
            ✕
          </button>
        )}
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <DualDatePicker
          value={value ?? Date.now()}
          onChange={(ms) => {
            onChange(ms);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

export function AccountSelect({ label, accounts, value, onChange, allowNone, testId }: { label: string; accounts: Account[]; value: string | null; onChange: (id: string | null) => void; allowNone?: string; testId?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink" data-testid={testId}>
        {allowNone && <option value="">{allowNone}</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export const liveAccounts = (accounts: Account[] | undefined): Account[] =>
  (accounts ?? []).filter((a) => a.deleted_at === null && !a.is_archived).sort((a, b) => a.sort_order - b.sort_order);
