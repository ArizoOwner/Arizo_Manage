// People, debts & receivables (PROMPT.md §7 #5): local people directory (no contacts permission),
// per-person net balance, lend/borrow records, partial settlements with undo.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { mutateObligation } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { formatDate, formatMoney } from '../../core/i18n/format';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import { createDebt, createPerson, personBalances, remainingOf, settleDebt, undoSettlement } from '../../core/obligations/debts';
import type { Person } from '../../core/storage/schema';
import { Button, Card, Field, Icon, IconButton, ICONS, Screen, Segmented, Sheet, Toggle } from '../../core/ui/ui';
import { AccountSelect, AmountField, BackButton, DateField, liveAccounts } from './shared';

export function DebtsScreen() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [adding, setAdding] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);
  const { data } = useVaultQuery(async (db) => ({
    people: await db.find('people'),
    debts: await db.find('debts_receivables'),
    settlements: await db.find('debt_settlements'),
    accounts: await db.find('accounts'),
  }));
  const balances = useMemo(() => personBalances(data?.debts ?? [], data?.settlements ?? []), [data]);
  const people = (data?.people ?? []).filter((p) => p.deleted_at === null).sort((a, b) => a.name.localeCompare(b.name, 'fa'));

  return (
    <Screen
      title={t('debts.title')}
      actions={
        <>
          <IconButton label={t('debts.newPerson')} onClick={() => setAdding(true)}>
            <Icon d={ICONS.plus} />
          </IconButton>
          <BackButton />
        </>
      }
    >
      {people.length === 0 && <p className="py-8 text-center text-[14px] text-ink-2">{t('debts.empty')}</p>}
      {people.map((p) => {
        const net = balances.get(p.id)?.get('IRR') ?? 0n;
        return (
          <button key={p.id} type="button" onClick={() => setPersonId(p.id)} className="flex min-h-16 items-center gap-3 rounded-2xl border border-hairline bg-surface-1 px-4 text-start" data-testid="person-row">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-3 text-[15px] font-bold">{p.name.slice(0, 1)}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-semibold">{p.name}</span>
              <span className={`text-[12px] ${net > 0n ? 'text-emerald-text' : net < 0n ? 'text-coral-text' : 'text-ink-2'}`}>{net > 0n ? t('debts.theyOwe') : net < 0n ? t('debts.youOwe') : t('debts.even')}</span>
            </span>
            <PrivacyBlur>
              <span className={`text-[15px] font-bold tabular ${net > 0n ? 'text-emerald-text' : net < 0n ? 'text-coral-text' : ''}`} data-testid="person-net">
                {formatMoney(net < 0n ? -net : net, 'IRR', lang, irrUnit)}
              </span>
            </PrivacyBlur>
          </button>
        );
      })}
      <PersonForm open={adding} onClose={() => setAdding(false)} />
      {personId && data && (
        <PersonDetail
          person={data.people.find((p) => p.id === personId)!}
          debts={data.debts.filter((d) => d.person_id === personId && d.deleted_at === null)}
          settlements={data.settlements}
          accounts={liveAccounts(data.accounts)}
          onClose={() => setPersonId(null)}
        />
      )}
    </Screen>
  );
}

function PersonForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  return (
    <Sheet open={open} onClose={onClose} title={t('debts.newPerson')}>
      <Field label={t('debts.name')} value={name} onChange={(e) => setName(e.target.value)} data-testid="person-name" />
      <Field label={t('debts.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" />
      <Button
        disabled={!name.trim()}
        data-testid="person-save"
        onClick={async () => {
          await mutateObligation((db) => createPerson(db, { name, phone, notes: '' }));
          setName('');
          setPhone('');
          onClose();
        }}
      >
        {t('debts.save')}
      </Button>
    </Sheet>
  );
}

function PersonDetail({ person, debts, settlements, accounts, onClose }: { person: Person; debts: Parameters<typeof personBalances>[0] extends readonly (infer D)[] ? D[] : never; settlements: Parameters<typeof personBalances>[1]; accounts: ReturnType<typeof liveAccounts>; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent');
  const [amount, setAmount] = useState<bigint | null>(null);
  const [due, setDue] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<string | null>(accounts[0]?.id ?? null);
  const [postOpening, setPostOpening] = useState(true);
  const [settling, setSettling] = useState<string | null>(null);
  const [settleAmount, setSettleAmount] = useState<bigint | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Sheet open onClose={onClose} title={person.name}>
      {debts
        .sort((a, b) => Number(a.status === 'settled') - Number(b.status === 'settled') || b.created_at - a.created_at)
        .map((d) => {
          const left = remainingOf(d, settlements);
          const own = settlements.filter((s) => s.debt_id === d.id && s.deleted_at === null);
          return (
            <Card key={d.id} className="flex flex-col gap-2 p-3" data-testid="debt-row">
              <div className="flex items-center justify-between">
                <span className={`text-[13px] font-semibold ${d.direction === 'lent' ? 'text-emerald-text' : 'text-coral-text'}`}>{t(`debts.${d.direction}`)}</span>
                <span className="text-[15px] font-bold tabular">{formatMoney(d.amount_minor, d.currency_code, lang, irrUnit)}</span>
              </div>
              <div className="flex items-center justify-between text-[12px] text-ink-2">
                <span>{d.status === 'settled' ? t('debts.settled') : t('debts.remaining', { a: formatMoney(left, d.currency_code, lang, irrUnit) })}</span>
                {d.due_date_at && <span>{formatDate(d.due_date_at, cal, lang)}</span>}
              </div>
              {own.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-[12px]">
                  <span className="text-ink-2">
                    {formatDate(s.settled_at, cal, lang)} · {formatMoney(s.amount_minor, d.currency_code, lang, irrUnit)}
                  </span>
                  <button type="button" onClick={() => void mutateObligation((db) => undoSettlement(db, s.id))} className="min-h-9 px-2 font-semibold text-ink-2">
                    {t('debts.undo')}
                  </button>
                </div>
              ))}
              {d.status === 'open' && (
                <Button variant="secondary" className="!min-h-11 text-[13px]" data-testid="debt-settle" onClick={() => (setSettling(d.id), setSettleAmount(left))}>
                  {t('debts.settle')}
                </Button>
              )}
            </Card>
          );
        })}

      <div className="flex flex-col gap-3 rounded-3xl bg-surface-1 p-3">
        <h3 className="text-[14px] font-bold">{t('debts.newDebt')}</h3>
        <Segmented label={t('debts.newDebt')} value={direction} onChange={setDirection} options={[{ value: 'lent', label: t('debts.lent') }, { value: 'borrowed', label: t('debts.borrowed') }]} />
        <AmountField label={t('debts.amount')} currency="IRR" value={amount} onChange={setAmount} testId="debt-amount" />
        <DateField label={t('debts.due')} value={due} onChange={setDue} optional />
        <AccountSelect label={t('debts.account')} accounts={accounts} value={accountId} onChange={setAccountId} allowNone={t('cheques.noAccount')} />
        {accountId && <Toggle label={t('debts.postOpening')} checked={postOpening} onChange={setPostOpening} />}
        <Button
          disabled={!amount}
          data-testid="debt-save"
          onClick={async () => {
            await mutateObligation((db) => createDebt(db, { person_id: person.id, direction, amount_minor: amount!, currency_code: 'IRR', due_date_at: due, account_id: accountId, post_opening: postOpening && !!accountId, note: '' }));
            setAmount(null);
            setDue(null);
          }}
        >
          {t('debts.save')}
        </Button>
      </div>

      <Sheet open={settling !== null} onClose={() => setSettling(null)} title={t('debts.settle')}>
        <AmountField label={t('debts.settleAmount')} currency="IRR" value={settleAmount} onChange={setSettleAmount} />
        <AccountSelect label={t('debts.account')} accounts={accounts} value={accountId} onChange={setAccountId} />
        {err && (
          <p role="alert" className="text-[13px] font-semibold text-coral-text">
            {err}
          </p>
        )}
        <Button
          disabled={!settleAmount || !accountId}
          data-testid="debt-settle-save"
          onClick={async () => {
            try {
              await mutateObligation((db) => settleDebt(db, settling!, settleAmount!, accountId!));
              setErr(null);
              setSettling(null);
            } catch (e) {
              setErr(e instanceof Error && e.message === 'SETTLE_AMOUNT' ? t('debts.overpay') : String(e));
            }
          }}
        >
          {t('debts.settle')}
        </Button>
      </Sheet>
    </Sheet>
  );
}
