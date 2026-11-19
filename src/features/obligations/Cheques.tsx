// Cheques (PROMPT.md §7 #5): issued/received tabs, exposure KPI, Sayad validation, status workflow,
// timeline by due date, per-cheque reminders.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { mutateObligation } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { formatDate, formatMoney, localDigits } from '../../core/i18n/format';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import { canTransition, chequeExposure, createCheque, setChequeStatus, validateCheque, type ChequeInput } from '../../core/obligations/cheques';
import type { Cheque, ChequeStatus } from '../../core/storage/schema';
import { Button, Card, Field, Icon, IconButton, ICONS, Screen, Segmented, Sheet } from '../../core/ui/ui';
import { AccountSelect, AmountField, BackButton, DateField, liveAccounts } from './shared';

const STATUS_COLOR: Record<ChequeStatus, string> = {
  pending: 'text-amber-text',
  cleared: 'text-emerald-text',
  bounced: 'text-coral-text',
  cancelled: 'text-ink-2',
  transferred: 'text-azure-text',
};

export function ChequesScreen() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [tab, setTab] = useState<'issued' | 'received'>('issued');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Cheque | null>(null);
  const { data } = useVaultQuery(async (db) => ({ cheques: await db.find('cheques'), accounts: await db.find('accounts') }));
  const cheques = useMemo(
    () => (data?.cheques ?? []).filter((c) => c.deleted_at === null && c.direction === tab).sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || a.due_date_at - b.due_date_at),
    [data, tab],
  );
  const exposure = chequeExposure(data?.cheques ?? []);
  const now = Date.now();

  return (
    <Screen
      title={t('cheques.title')}
      actions={
        <>
          <IconButton label={t('cheques.new')} onClick={() => setCreating(true)}>
            <Icon d={ICONS.plus} />
          </IconButton>
          <BackButton />
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3">
          <div className="text-[12px] text-ink-2">{t('cheques.exposureIssued')}</div>
          <PrivacyBlur>
            <div className="text-[15px] font-bold text-coral-text tabular" data-testid="exposure-issued">
              {formatMoney(exposure.issued, 'IRR', lang, irrUnit)}
            </div>
          </PrivacyBlur>
        </Card>
        <Card className="p-3">
          <div className="text-[12px] text-ink-2">{t('cheques.exposureReceived')}</div>
          <PrivacyBlur>
            <div className="text-[15px] font-bold text-emerald-text tabular">{formatMoney(exposure.received, 'IRR', lang, irrUnit)}</div>
          </PrivacyBlur>
        </Card>
      </div>
      <Segmented label={t('cheques.title')} value={tab} onChange={setTab} options={[{ value: 'issued', label: t('cheques.issued') }, { value: 'received', label: t('cheques.received') }]} />
      {cheques.length === 0 && <p className="py-8 text-center text-[14px] text-ink-2">{t('cheques.empty')}</p>}
      <ol className="flex flex-col gap-2">
        {cheques.map((c) => {
          const overdue = c.status === 'pending' && c.due_date_at < now;
          return (
            <li key={c.id}>
              <button type="button" onClick={() => setSelected(c)} className="flex w-full items-center gap-3 rounded-2xl border border-hairline bg-surface-1 p-3 text-start" data-testid="cheque-row">
                <span className={`h-10 w-1.5 shrink-0 rounded-full ${overdue ? 'bg-coral' : c.status === 'pending' ? 'bg-amber' : 'bg-surface-3'}`} aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-semibold">{c.counterparty_name}</span>
                  <span className="text-[12px] text-ink-2">
                    {formatDate(c.due_date_at, cal, lang)} · <span className={overdue ? 'text-coral-text' : STATUS_COLOR[c.status]}>{t(`cheques.status.${c.status}`)}</span>
                  </span>
                </span>
                <PrivacyBlur>
                  <span className="text-[15px] font-bold tabular">{formatMoney(c.amount_minor, c.currency_code, lang, irrUnit)}</span>
                </PrivacyBlur>
              </button>
            </li>
          );
        })}
      </ol>
      {creating && data && <ChequeForm open onClose={() => setCreating(false)} direction={tab} accounts={liveAccounts(data.accounts)} />}
      {selected && <ChequeActions cheque={(data?.cheques ?? []).find((c) => c.id === selected.id) ?? selected} accounts={liveAccounts(data?.accounts)} onClose={() => setSelected(null)} />}
    </Screen>
  );
}

function ChequeForm({ open, onClose, direction, accounts }: { open: boolean; onClose: () => void; direction: 'issued' | 'received'; accounts: ReturnType<typeof liveAccounts> }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const blank = (): ChequeInput => ({ direction, cheque_number: '', sayad_id: '', bank_code: null, amount_minor: 0n, currency_code: 'IRR', due_date_at: Date.now(), counterparty_name: '', account_id: accounts[0]?.id ?? null, reminder_days: [3, 1, 0], notes: '' });
  const [v, setV] = useState<ChequeInput>(blank);
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const errors = validateCheque({ ...v, direction });
  const set = <K extends keyof ChequeInput>(k: K, val: ChequeInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const toggleDay = (d: number) => set('reminder_days', v.reminder_days.includes(d) ? v.reminder_days.filter((x) => x !== d) : [...v.reminder_days, d]);

  return (
    <Sheet open={open} onClose={onClose} title={`${t('cheques.new')} · ${t(`cheques.${direction}`)}`}>
      <Field label={t('cheques.sayad')} value={v.sayad_id} onChange={(e) => set('sayad_id', e.target.value)} inputMode="numeric" dir="ltr" error={touched && errors.includes('sayad') ? t('cheques.invalidSayad') : undefined} data-testid="cheque-sayad" />
      <Field label={t('cheques.number')} value={v.cheque_number} onChange={(e) => set('cheque_number', e.target.value)} inputMode="numeric" dir="ltr" />
      <Field label={t('cheques.counterparty')} value={v.counterparty_name} onChange={(e) => set('counterparty_name', e.target.value)} error={touched && errors.includes('counterparty') ? t('cheques.invalidCounterparty') : undefined} data-testid="cheque-counterparty" />
      <AmountField label={t('cheques.amount')} currency="IRR" value={v.amount_minor || null} onChange={(a) => set('amount_minor', a)} testId="cheque-amount" />
      <DateField label={t('cheques.due')} value={v.due_date_at} onChange={(d) => d !== null && set('due_date_at', d)} />
      <AccountSelect label={t('cheques.account')} accounts={accounts} value={v.account_id} onChange={(id) => set('account_id', id)} allowNone={t('cheques.noAccount')} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-semibold text-ink-2">{t('cheques.reminders')}</legend>
        <div className="flex flex-wrap gap-2">
          {[7, 3, 1, 0].map((d) => (
            <button key={d} type="button" aria-pressed={v.reminder_days.includes(d)} onClick={() => toggleDay(d)} className={`min-h-10 rounded-full px-3 text-[13px] font-semibold ${v.reminder_days.includes(d) ? 'bg-emerald-glow text-ink ring-1 ring-cta' : 'bg-surface-3 text-ink-2'}`}>
              {d === 0 ? t('cheques.onDay') : t('cheques.daysBefore', { d: localDigits(d, lang) })}
            </button>
          ))}
        </div>
      </fieldset>
      {err && (
        <p role="alert" className="text-[13px] font-semibold text-coral-text">
          {err}
        </p>
      )}
      <Button
        data-testid="cheque-save"
        onClick={async () => {
          setTouched(true);
          if (errors.length) return;
          try {
            await mutateObligation((db) => createCheque(db, { ...v, direction }));
            setV(blank());
            setTouched(false);
            setErr(null);
            onClose();
          } catch (e) {
            setErr(e instanceof Error && e.message === 'CHEQUE_DUPLICATE_SAYAD' ? t('cheques.duplicate') : String(e));
          }
        }}
      >
        {t('cheques.save')}
      </Button>
    </Sheet>
  );
}

function ChequeActions({ cheque, accounts, onClose }: { cheque: Cheque; accounts: ReturnType<typeof liveAccounts>; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [accountId, setAccountId] = useState<string | null>(cheque.account_id ?? accounts[0]?.id ?? null);
  const [err, setErr] = useState<string | null>(null);
  const targets = (['cleared', 'bounced', 'transferred', 'cancelled', 'pending'] as const).filter((s) => canTransition(cheque.status, s));
  return (
    <Sheet open onClose={onClose} title={cheque.counterparty_name}>
      <Card className="flex flex-col gap-1 text-[14px]">
        <div className="flex justify-between">
          <span className="text-ink-2">{t('cheques.amount')}</span>
          <span className="font-bold tabular">{formatMoney(cheque.amount_minor, cheque.currency_code, lang, irrUnit)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-2">{t('cheques.due')}</span>
          <span>{formatDate(cheque.due_date_at, cal, lang)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-2">{t('cheques.sayad')}</span>
          <span className="tabular" dir="ltr">
            {cheque.sayad_id.replace(/(\d{4})(?=\d)/g, '$1 ')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-2">{t('cheques.title')}</span>
          <span className={STATUS_COLOR[cheque.status]}>{t(`cheques.status.${cheque.status}`)}</span>
        </div>
      </Card>
      {targets.includes('cleared') && <AccountSelect label={t('cheques.account')} accounts={accounts} value={accountId} onChange={setAccountId} />}
      {err && (
        <p role="alert" className="text-[13px] font-semibold text-coral-text">
          {err}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {targets.map((s) => (
          <Button
            key={s}
            variant={s === 'cleared' ? 'primary' : s === 'bounced' ? 'danger' : 'secondary'}
            data-testid={`cheque-${s}`}
            onClick={async () => {
              try {
                await mutateObligation((db) => setChequeStatus(db, cheque.id, s, accountId ? { account_id: accountId } : {}));
                onClose();
              } catch (e) {
                setErr(e instanceof Error && e.message === 'CHEQUE_NEEDS_ACCOUNT' ? t('cheques.needAccount') : String(e));
              }
            }}
          >
            {t(`cheques.action.${s}`)}
          </Button>
        ))}
      </div>
    </Sheet>
  );
}
