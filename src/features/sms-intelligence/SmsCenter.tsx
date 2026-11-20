// SMS Center (PROMPT.md §6): Review Queue, Paste & Parse, Inbox + Teach the Parser, Regex Studio,
// balance-drift badges, and the platform setup wizards (Android Restricted Settings, iOS Shortcuts).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { mutate } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { BANKS } from '../../core/data/banks';
import { formatDate, formatMoney, localDigits } from '../../core/i18n/format';
import { reconcileBalance } from '../../core/ledger/accounts';
import { softDeleteTransaction, updateTransaction } from '../../core/ledger/ledger';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import {
  approvePending,
  balanceDrift,
  confirmSender,
  learnMerchant,
  readInbox,
  removeInboxItem,
  reprocessInbox,
  type IngestOutcome,
  type InboxItem,
} from '../../core/sms/ingest';
import { splitBulk } from '../../core/sms/parser';
import { workerParser } from '../../core/sms/smsClient';
import type { Account, Category, Transaction } from '../../core/storage/schema';
import { Button, Card, Screen, Segmented, Sheet } from '../../core/ui/ui';
import { vaultService } from '../../core/security/vaultService';
import { BackButton } from '../obligations/shared';
import { ingest } from './intake';
import { AndroidCapture, ShortcutsWizard } from './Wizards';
import { RegexStudio, TeachSheet } from './Teach';

type Tab = 'review' | 'paste' | 'inbox' | 'rules' | 'setup';

export function SmsCenter({ initialTab }: { initialTab?: Tab }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'review');
  const { data } = useVaultQuery(async (db) => ({
    txs: await db.find('transactions', { status: 'pending_review' }),
    all: await db.find('transactions'),
    accounts: await db.find('accounts'),
    cats: await db.find('categories'),
    inbox: await readInbox(db),
    rules: await db.find('sms_parser_rules'),
  }));
  const pending = (data?.txs ?? []).filter((x) => x.deleted_at === null).sort((a, b) => b.occurred_at - a.occurred_at);
  const drifts = useMemo(
    () => (data ? data.accounts.filter((a) => a.deleted_at === null).flatMap((a) => balanceDrift(a, data.all) ?? []) : []),
    [data],
  );

  return (
    <Screen title={t('sms.title')} actions={<BackButton />}>
      <div className="overflow-x-auto">
        <Segmented
          label={t('sms.title')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'review', label: pending.length ? `${t('sms.review')} (${localDigits(pending.length, lang)})` : t('sms.review') },
            { value: 'paste', label: t('sms.paste') },
            { value: 'inbox', label: data?.inbox.length ? `${t('sms.inbox')} (${localDigits(data.inbox.length, lang)})` : t('sms.inbox') },
            { value: 'rules', label: t('sms.rules') },
            { value: 'setup', label: t('sms.setup') },
          ]}
        />
      </div>

      {drifts.map((d) => (
        <DriftBadge key={d.account_id} account={data!.accounts.find((a) => a.id === d.account_id)!} reported={d.reported} computed={d.computed} />
      ))}

      {tab === 'review' && data && <ReviewQueue txs={pending} accounts={data.accounts} cats={data.cats} />}
      {tab === 'paste' && <PasteParse onDone={(hasInbox) => setTab(hasInbox ? 'inbox' : 'review')} />}
      {tab === 'inbox' && data && <Inbox items={data.inbox} />}
      {tab === 'rules' && data && <RegexStudio rules={data.rules.filter((r) => r.deleted_at === null)} samples={data.inbox.map((i) => i.text)} />}
      {tab === 'setup' && (vaultService.platform() === 'android' ? <AndroidCapture /> : <ShortcutsWizard />)}
    </Screen>
  );
}

function DriftBadge({ account, reported, computed }: { account: Account; reported: bigint; computed: bigint }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  const fmt = (v: bigint) => formatMoney(v, account.currency_code, lang, irrUnit);
  return (
    <Card className="flex flex-col gap-2 border-amber/40" data-testid="drift-badge">
      <p className="text-[14px] font-semibold text-amber-text">{t('sms.drift', { a: account.name })}</p>
      <PrivacyBlur>
        <p className="text-[13px] text-ink-2">
          {t('sms.driftDetail', { bank: fmt(reported), app: fmt(computed) })}
        </p>
      </PrivacyBlur>
      <Button
        variant="secondary"
        data-testid="drift-adjust"
        onClick={() => void mutate((db) => reconcileBalance(db, account.id, account.current_balance_minor + (reported - computed)))}
      >
        {t('sms.adjust')}
      </Button>
    </Card>
  );
}

function ReviewQueue({ txs, accounts, cats }: { txs: Transaction[]; accounts: Account[]; cats: Category[] }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const live = accounts.filter((a) => a.deleted_at === null && !a.is_archived);
  if (!txs.length) return <p className="py-8 text-center text-[14px] text-ink-2">{t('sms.reviewEmpty')}</p>;
  return (
    <div className="flex flex-col gap-3">
      {txs.length > 1 && (
        <Button data-testid="approve-all" onClick={() => void mutate(async (db) => { for (const x of txs) await approvePending(db, x.id); })}>
          {t('sms.approveAll', { n: localDigits(txs.length, lang) })}
        </Button>
      )}
      {txs.map((x) => {
        const acc = byId.get(x.account_id);
        const kind = x.type === 'income' ? 'income' : 'expense';
        return (
          <Card key={x.id} className="flex flex-col gap-3" data-testid="review-item">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-semibold">{x.merchant_name || t(`entry.${kind}`)}</span>
                <span className="text-[12px] text-ink-2">
                  {formatDate(x.occurred_at, cal, lang)} · {t(`sms.src.${x.source}`)}
                </span>
              </div>
              <PrivacyBlur>
                <span className={`shrink-0 text-[16px] font-bold tabular ${kind === 'income' ? 'text-emerald-text' : ''}`} data-testid="review-amount">
                  {formatMoney(x.amount_minor, x.currency_code, lang, irrUnit)}
                </span>
              </PrivacyBlur>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label={t('entry.account')}
                value={x.account_id}
                onChange={(e) => void mutate((db) => updateTransaction(db, x.id, { account_id: e.target.value }))}
                className="min-h-11 rounded-xl bg-surface-3 px-3 text-[13px]"
              >
                {live.filter((a) => a.currency_code === acc?.currency_code).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('entry.category')}
                value={x.category_id ?? ''}
                onChange={(e) =>
                  void mutate(async (db) => {
                    await updateTransaction(db, x.id, { category_id: e.target.value || null });
                    if (x.merchant_name && e.target.value) await learnMerchant(db, x.merchant_name, e.target.value);
                  })
                }
                className="min-h-11 rounded-xl bg-surface-3 px-3 text-[13px]"
                data-testid="review-category"
              >
                <option value="">{t('sms.noCategory')}</option>
                {cats.filter((c) => c.deleted_at === null && c.type === kind).map((c) => (
                  <option key={c.id} value={c.id}>
                    {lang === 'fa' ? c.name_fa : c.name_en}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" data-testid="review-approve" onClick={() => void mutate((db) => approvePending(db, x.id))}>
                {t('sms.approve')}
              </Button>
              <Button variant="secondary" onClick={() => void mutate((db) => updateTransaction(db, x.id, { type: kind === 'income' ? 'expense' : 'income' }))}>
                {t('sms.flip')}
              </Button>
              <Button variant="ghost" data-testid="review-reject" onClick={() => void mutate((db) => softDeleteTransaction(db, x.id))}>
                {t('sms.reject')}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function summarize(out: IngestOutcome[]) {
  const n = { queued: 0, duplicate: 0, rejected: 0, inbox: 0 };
  for (const o of out) n[o.kind]++;
  return n;
}

function PasteParse({ onDone }: { onDone: (hasInbox: boolean) => void }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof summarize> | null>(null);
  const count = splitBulk(text).length;
  const run = async () => {
    setBusy(true);
    try {
      const out = await ingest(splitBulk(text).map((m) => ({ text: m, source: 'paste_parse' as const })));
      setText('');
      setResult(summarize(out));
    } finally {
      setBusy(false);
    }
  };
  const fromClipboard = async () => {
    // Reading the clipboard always goes through the browser's own permission prompt.
    const clip = await navigator.clipboard?.readText?.().catch(() => '');
    if (clip) setText((s) => (s ? `${s}\n\n${clip}` : clip));
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-6 text-ink-2">{t('sms.pasteHint')}</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('sms.pasteLabel')}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          dir="auto"
          className="rounded-2xl border border-transparent bg-surface-3 p-4 text-[14px] leading-6 text-ink outline-none focus:border-azure"
          data-testid="paste-input"
        />
      </label>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={!count || busy} onClick={() => void run()} data-testid="paste-parse">
          {t('sms.parseN', { n: localDigits(count, lang) })}
        </Button>
        {'clipboard' in navigator && (
          <Button variant="secondary" onClick={() => void fromClipboard()}>
            {t('sms.fromClipboard')}
          </Button>
        )}
      </div>
      {result && (
        <Card className="flex flex-col gap-2" data-testid="paste-result" role="status">
          <p className="text-[14px]">{t('sms.resultQueued', { n: localDigits(result.queued, lang) })}</p>
          {result.duplicate > 0 && <p className="text-[13px] text-ink-2">{t('sms.resultDup', { n: localDigits(result.duplicate, lang) })}</p>}
          {result.rejected > 0 && <p className="text-[13px] text-ink-2">{t('sms.resultRejected', { n: localDigits(result.rejected, lang) })}</p>}
          {result.inbox > 0 && <p className="text-[13px] text-amber-text">{t('sms.resultInbox', { n: localDigits(result.inbox, lang) })}</p>}
          <Button variant="secondary" onClick={() => onDone(result.inbox > 0 && result.queued === 0)}>
            {t('sms.continue')}
          </Button>
        </Card>
      )}
    </div>
  );
}

function Inbox({ items }: { items: InboxItem[] }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const [teach, setTeach] = useState<InboxItem | null>(null);
  const [senderFor, setSenderFor] = useState<InboxItem | null>(null);
  if (!items.length) return <p className="py-8 text-center text-[14px] text-ink-2">{t('sms.inboxEmpty')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" onClick={() => void mutate((db) => reprocessInbox(db, workerParser))}>
        {t('sms.retryAll')}
      </Button>
      {items.map((it) => (
        <Card key={it.id} className="flex flex-col gap-3" data-testid="inbox-item">
          <span className="text-[12px] font-semibold text-amber-text">{t(`sms.reason.${it.reason}`)}</span>
          <PrivacyBlur>
            <p dir="auto" className="whitespace-pre-line text-[13px] leading-6 text-ink-2">
              {it.text}
            </p>
          </PrivacyBlur>
          <div className="flex flex-wrap gap-2">
            {it.reason === 'unparsed' && (
              <Button onClick={() => setTeach(it)} data-testid="teach-open">
                {t('sms.teach')}
              </Button>
            )}
            {it.sender && (
              <Button variant="secondary" onClick={() => setSenderFor(it)}>
                {t('sms.confirmSender')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => void mutate((db) => removeInboxItem(db, it.id))}>
              {t('sms.discard')}
            </Button>
          </div>
        </Card>
      ))}
      {teach && <TeachSheet item={teach} onClose={() => setTeach(null)} />}
      <Sheet open={senderFor !== null} onClose={() => setSenderFor(null)} title={t('sms.confirmSender')}>
        <p className="text-[13px] text-ink-2">{t('sms.senderHint', { s: senderFor?.sender ?? '' })}</p>
        <div className="flex max-h-[50dvh] flex-col gap-1 overflow-y-auto">
          {BANKS.map((b) => (
            <button
              key={b.code}
              type="button"
              className="min-h-11 rounded-xl px-3 text-start text-[14px] hover:bg-surface-3"
              onClick={() => {
                const s = senderFor!.sender!;
                setSenderFor(null);
                void mutate(async (db) => {
                  await confirmSender(db, s, b.code);
                  await reprocessInbox(db, workerParser);
                });
              }}
            >
              {lang === 'fa' ? b.name_fa : b.name_en}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
