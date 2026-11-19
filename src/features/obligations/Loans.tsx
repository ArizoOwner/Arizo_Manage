// Loans & installments (PROMPT.md §7 #5): schedule generator with live installment preview,
// progress ring, overdue highlighting, 1-tap pay (auto-posts the expense) and undo.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { mutateObligation } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { formatDate, formatMoney, localDigits } from '../../core/i18n/format';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import { annuityInstallment, createLoan, loanProgress, payInstallment, unpayInstallment } from '../../core/obligations/loans';
import type { Loan, LoanInstallment } from '../../core/storage/schema';
import { Button, Card, Field, Icon, IconButton, ICONS, Screen, Sheet, Toggle } from '../../core/ui/ui';
import { AccountSelect, AmountField, BackButton, DateField, liveAccounts } from './shared';

function Ring({ pct }: { pct: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 52 52" className="h-14 w-14 -rotate-90" aria-hidden="true">
      <circle cx="26" cy="26" r={r} fill="none" stroke="var(--arizo-surface-3)" strokeWidth="6" />
      <circle cx="26" cy="26" r={r} fill="none" stroke="var(--arizo-luxury-mark)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(c * pct) / 100} ${c}`} />
    </svg>
  );
}

export function LoansScreen() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [creating, setCreating] = useState(false);
  const [openLoan, setOpenLoan] = useState<string | null>(null);
  const { data } = useVaultQuery(async (db) => ({ loans: await db.find('loans'), installments: await db.find('loan_installments'), accounts: await db.find('accounts') }));
  const loans = (data?.loans ?? []).filter((l) => l.deleted_at === null).sort((a, b) => Number(a.status === 'paid_off') - Number(b.status === 'paid_off') || a.start_date_at - b.start_date_at);
  const byLoan = useMemo(() => {
    const m = new Map<string, LoanInstallment[]>();
    for (const i of data?.installments ?? []) m.set(i.loan_id, [...(m.get(i.loan_id) ?? []), i]);
    return m;
  }, [data]);

  return (
    <Screen
      title={t('loans.title')}
      actions={
        <>
          <IconButton label={t('loans.new')} onClick={() => setCreating(true)}>
            <Icon d={ICONS.plus} />
          </IconButton>
          <BackButton />
        </>
      }
    >
      {loans.length === 0 && <p className="py-8 text-center text-[14px] text-ink-2">{t('loans.empty')}</p>}
      {loans.map((l) => {
        const p = loanProgress(byLoan.get(l.id) ?? []);
        const pct = p.count ? Math.round((p.paidCount * 100) / p.count) : 0;
        return (
          <button key={l.id} type="button" onClick={() => setOpenLoan(l.id)} className="flex items-center gap-4 rounded-3xl border border-hairline bg-surface-1 p-4 text-start" data-testid="loan-row">
            <Ring pct={pct} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[15px] font-bold">{l.title}</span>
              <span className="text-[12px] text-ink-2">{l.status === 'paid_off' ? t('loans.paidOff') : t('loans.progress', { p: localDigits(p.paidCount, lang), n: localDigits(p.count, lang) })}</span>
              {p.overdue > 0 && <span className="text-[12px] font-semibold text-coral-text">{`${t('loans.overdue')}: ${localDigits(p.overdue, lang)}`}</span>}
            </span>
            <span className="flex flex-col items-end">
              <span className="text-[11px] text-ink-2">{t('loans.remaining')}</span>
              <PrivacyBlur>
                <span className="text-[14px] font-bold tabular" data-testid="loan-remaining">
                  {formatMoney(p.remaining, l.currency_code, lang, irrUnit)}
                </span>
              </PrivacyBlur>
            </span>
          </button>
        );
      })}
      {creating && data && <LoanForm open onClose={() => setCreating(false)} accounts={liveAccounts(data.accounts)} />}
      {openLoan && data && (
        <LoanDetail loan={data.loans.find((l) => l.id === openLoan)!} installments={(byLoan.get(openLoan) ?? []).sort((a, b) => a.sequence_no - b.sequence_no)} onClose={() => setOpenLoan(null)} />
      )}
    </Screen>
  );
}

function LoanForm({ open, onClose, accounts }: { open: boolean; onClose: () => void; accounts: ReturnType<typeof liveAccounts> }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [title, setTitle] = useState('');
  const [lender, setLender] = useState('');
  const [principal, setPrincipal] = useState<bigint | null>(null);
  const [rate, setRate] = useState('18');
  const [count, setCount] = useState('12');
  const [firstDue, setFirstDue] = useState<number | null>(Date.now() + 30 * 86_400_000);
  const [override, setOverride] = useState<bigint | null>(null);
  const [accountId, setAccountId] = useState<string | null>(accounts[0]?.id ?? null);
  const [disburse, setDisburse] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Rate typed as a percentage with up to 2 decimals → basis points, without floats.
  const bps = /^\d{1,3}(\.\d{1,2})?$/.test(rate.trim()) ? Number(rate.trim().replace('.', '')) * (rate.includes('.') ? 10 ** (2 - rate.split('.')[1]!.length) : 100) : NaN;
  const n = /^\d{1,3}$/.test(count.trim()) ? Number(count) : NaN;
  const valid = title.trim() && principal && principal > 0n && Number.isInteger(n) && n >= 1 && n <= 600 && Number.isInteger(bps) && bps >= 0 && bps <= 100_000 && firstDue !== null;
  const preview = valid ? (override ?? annuityInstallment(principal!, bps, n)) : null;

  return (
    <Sheet open={open} onClose={onClose} title={t('loans.new')}>
      <Field label={t('loans.name')} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="loan-title" />
      <Field label={t('loans.lender')} value={lender} onChange={(e) => setLender(e.target.value)} />
      <AmountField label={t('loans.principal')} currency="IRR" value={principal} onChange={setPrincipal} testId="loan-principal" />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('loans.rate')} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" dir="ltr" data-testid="loan-rate" />
        <Field label={t('loans.count')} value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" dir="ltr" data-testid="loan-count" />
      </div>
      <DateField label={t('loans.firstDue')} value={firstDue} onChange={setFirstDue} />
      <AmountField label={t('loans.override')} currency="IRR" value={override} onChange={(v) => setOverride(v || null)} />
      <AccountSelect label={t('loans.account')} accounts={accounts} value={accountId} onChange={setAccountId} allowNone={t('cheques.noAccount')} />
      {accountId && <Toggle label={t('loans.disburse')} checked={disburse} onChange={setDisburse} />}
      {preview !== null && (
        <Card className="flex items-center justify-between p-3">
          <span className="text-[13px] text-ink-2">{t('loans.preview')}</span>
          <span className="text-[16px] font-extrabold text-gold-text tabular" data-testid="loan-preview">
            {formatMoney(preview, 'IRR', lang, irrUnit)}
          </span>
        </Card>
      )}
      {err && (
        <p role="alert" className="text-[13px] font-semibold text-coral-text">
          {err}
        </p>
      )}
      <Button
        data-testid="loan-save"
        onClick={async () => {
          if (!valid) return setErr(t('loans.invalid'));
          await mutateObligation((db) =>
            createLoan(db, {
              title,
              lender_name: lender,
              principal_minor: principal!,
              interest_rate_bps: bps,
              installment_count: n,
              first_due_at: firstDue!,
              account_id: accountId,
              currency_code: 'IRR',
              calendar: cal,
              ...(override ? { installment_override_minor: override } : {}),
              post_disbursement: disburse,
              notes: '',
            }),
          );
          setTitle('');
          setPrincipal(null);
          setErr(null);
          onClose();
        }}
      >
        {t('loans.save')}
      </Button>
    </Sheet>
  );
}

function LoanDetail({ loan, installments, onClose }: { loan: Loan; installments: LoanInstallment[]; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Sheet open onClose={onClose} title={loan.title}>
      {err && (
        <p role="alert" className="text-[13px] font-semibold text-coral-text">
          {err}
        </p>
      )}
      <ol className="flex flex-col gap-1">
        {installments.map((i) => (
          <li key={i.id} className={`flex min-h-14 items-center gap-3 rounded-2xl px-3 ${i.status === 'overdue' ? 'bg-coral/10' : 'bg-surface-1'}`} data-testid="installment-row">
            <span className="w-8 text-center text-[13px] font-bold text-ink-2 tabular">{localDigits(i.sequence_no, lang)}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-semibold tabular">{formatMoney(i.amount_minor, loan.currency_code, lang, irrUnit)}</span>
              <span className={`text-[12px] ${i.status === 'overdue' ? 'text-coral-text' : i.status === 'paid' ? 'text-emerald-text' : 'text-ink-2'}`}>
                {formatDate(i.due_date_at, cal, lang)} · {t(`loans.${i.status}`)}
              </span>
            </span>
            {i.status === 'paid' ? (
              <Button variant="ghost" className="!min-h-11 !px-3 text-[12px]" onClick={() => void mutateObligation((db) => unpayInstallment(db, i.id))}>
                {t('loans.undo')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="!min-h-11 !px-3 text-[13px] text-emerald-text"
                data-testid="installment-pay"
                onClick={async () => {
                  try {
                    await mutateObligation((db) => payInstallment(db, i.id));
                    setErr(null);
                  } catch (e) {
                    setErr(e instanceof Error && e.message === 'LOAN_NEEDS_ACCOUNT' ? t('loans.needAccount') : String(e));
                  }
                }}
              >
                {t('loans.pay')}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
