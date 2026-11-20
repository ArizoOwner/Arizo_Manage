// Stage 6: "Teach the Parser" (tap the amount, balance and card in the message → anchored regex,
// previewed against stored messages) and the Custom Regex Studio for power users.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { mutate } from '../../app/stores/vault';
import { BANKS } from '../../core/data/banks';
import { formatMoney, localDigits } from '../../core/i18n/format';
import {
  buildTaughtRegex,
  deleteRule,
  numberTokens,
  reprocessInbox,
  saveRule,
  validateRegex,
  type InboxItem,
  type RuleInput,
  type TeachField,
  type TextToken,
} from '../../core/sms/ingest';
import { normalizeSms } from '../../core/sms/normalize';
import { parseSms } from '../../core/sms/parser';
import { workerParser } from '../../core/sms/smsClient';
import type { SmsParserRule } from '../../core/storage/schema';
import { Button, Card, Field, Segmented, Sheet, Toggle } from '../../core/ui/ui';

const FIELDS: TeachField[] = ['amount', 'balance', 'card', 'ref'];

/** Parse every sample with just this rule; returns how many it matched and the first result. */
function preview(rule: RuleInput, samples: string[]) {
  const r = { ...rule, id: 'preview', is_enabled: true };
  const hits = samples.map((s) => parseSms(s, { rules: [r] })).filter((x) => x.kind === 'parsed' && x.sms.via === 'custom');
  return { matched: hits.length, first: hits[0]?.kind === 'parsed' ? hits[0].sms : null };
}

export function TeachSheet({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  const norm = useMemo(() => normalizeSms(item.text), [item.text]);
  const tokens = useMemo(() => numberTokens(norm), [norm]);
  const [field, setField] = useState<TeachField>('amount');
  const [picks, setPicks] = useState<Partial<Record<TeachField, TextToken>>>({});
  const [dir, setDir] = useState<'debit' | 'credit'>('debit');
  const [unit, setUnit] = useState<'irr' | 'irt'>(/تومان/.test(norm) ? 'irt' : 'irr');
  const [bank, setBank] = useState(item.bank_code ?? '');

  const rule: RuleInput | null = picks.amount
    ? {
        name: `${t('sms.taught')} ${new Date().toISOString().slice(0, 10)}`,
        bank_code: bank || null,
        sender_patterns_json: item.sender ? [item.sender] : [],
        ...buildTaughtRegex(norm, picks),
        type_hint: dir,
        unit_hint: unit,
        priority: 100,
        is_enabled: true,
      }
    : null;
  const pv = rule ? preview({ ...rule, sender_patterns_json: [] }, [item.text]) : null;

  const tap = (tok: TextToken) => {
    setPicks((p) => {
      const next = { ...p };
      for (const f of FIELDS) if (next[f]?.start === tok.start) delete next[f];
      next[field] = tok;
      return next;
    });
    const nextField = FIELDS.find((f) => f !== field && !picks[f]);
    if (nextField && field === 'amount') setField('balance');
  };

  // Render the message with tappable numbers; picked ones show their field.
  const parts: React.ReactNode[] = [];
  let pos = 0;
  tokens.forEach((tok, i) => {
    parts.push(norm.slice(pos, tok.start));
    const f = FIELDS.find((k) => picks[k]?.start === tok.start);
    parts.push(
      <button
        key={i}
        type="button"
        onClick={() => tap(tok)}
        className={`mx-0.5 inline-flex min-h-9 items-center rounded-lg px-1.5 font-bold tabular ${f ? 'bg-cta text-on-accent' : 'bg-surface-3 text-ink'}`}
        aria-label={f ? `${tok.text} · ${t(`sms.field.${f}`)}` : tok.text}
        data-testid="teach-token"
      >
        <bdi dir="ltr">{tok.text}</bdi>
        {f && <span className="ms-1 text-[11px] font-semibold">{t(`sms.field.${f}`)}</span>}
      </button>,
    );
    pos = tok.end;
  });
  parts.push(norm.slice(pos));

  return (
    <Sheet open onClose={onClose} title={t('sms.teach')}>
      <p className="text-[13px] text-ink-2">{t('sms.teachHint')}</p>
      <Segmented label={t('sms.teachField')} value={field} onChange={setField} options={FIELDS.map((f) => ({ value: f, label: t(`sms.field.${f}`) }))} />
      <p dir="auto" className="whitespace-pre-line rounded-2xl bg-surface-1 p-3 text-[14px] leading-9" data-testid="teach-text">
        {parts}
      </p>
      <Segmented label={t('sms.direction')} value={dir} onChange={setDir} options={[{ value: 'debit', label: t('entry.expense') }, { value: 'credit', label: t('entry.income') }]} />
      <Segmented label={t('unit.label')} value={unit} onChange={setUnit} options={[{ value: 'irr', label: t('unit.rial') }, { value: 'irt', label: t('unit.toman') }]} />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('sms.bank')}</span>
        <select value={bank} onChange={(e) => setBank(e.target.value)} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px]">
          <option value="">{t('sms.anyBank')}</option>
          {BANKS.map((b) => (
            <option key={b.code} value={b.code}>
              {lang === 'fa' ? b.name_fa : b.name_en}
            </option>
          ))}
        </select>
      </label>
      {pv?.first && (
        <Card className="text-[13px]" data-testid="teach-preview">
          {t('sms.previewAmount')}: <b className="tabular">{formatMoney(pv.first.amount_minor, pv.first.currency_code, lang, irrUnit)}</b>
          {pv.first.balance_after_minor !== null && (
            <>
              {' · '}
              {t('sms.field.balance')}: <b className="tabular">{formatMoney(pv.first.balance_after_minor, pv.first.currency_code, lang, irrUnit)}</b>
            </>
          )}
        </Card>
      )}
      <Button
        disabled={!rule || !pv?.first}
        data-testid="teach-save"
        onClick={() => {
          if (!rule) return;
          onClose();
          void mutate(async (db) => {
            await saveRule(db, rule);
            await reprocessInbox(db, workerParser);
          });
        }}
      >
        {t('sms.saveRule')}
      </Button>
    </Sheet>
  );
}

const EMPTY: RuleInput = { name: '', bank_code: null, sender_patterns_json: [], body_regex: '', type_hint: 'auto', field_map_json: { amount: 1 }, unit_hint: 'auto', priority: 50, is_enabled: true };

export function RegexStudio({ rules, samples }: { rules: SmsParserRule[]; samples: string[] }) {
  const { t } = useTranslation();
  const [edit, setEdit] = useState<{ id: string | null; r: RuleInput } | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-6 text-ink-2">{t('sms.studioHint')}</p>
      <Button onClick={() => setEdit({ id: null, r: EMPTY })} data-testid="rule-new">
        {t('sms.newRule')}
      </Button>
      {rules.length === 0 && <p className="py-6 text-center text-[14px] text-ink-2">{t('sms.noRules')}</p>}
      {rules
        .sort((a, b) => b.priority - a.priority)
        .map((r) => (
          <Card key={r.id} className="flex flex-col gap-2" data-testid="rule-row">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[15px] font-semibold">{r.name || '—'}</span>
              <span className="text-[12px] text-ink-2">{r.is_enabled ? t('sms.enabled') : t('sms.disabled')}</span>
            </div>
            <code dir="ltr" className="block truncate rounded-lg bg-surface-3 px-2 py-1 text-start text-[12px]">
              {r.body_regex}
            </code>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setEdit({ id: r.id, r: { ...r } })}>
                {t('sms.edit')}
              </Button>
              <Button variant="ghost" onClick={() => void mutate((db) => deleteRule(db, r.id))}>
                {t('sms.delete')}
              </Button>
            </div>
          </Card>
        ))}
      {edit && <RuleEditor key={edit.id ?? 'new'} id={edit.id} initial={edit.r} samples={samples} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RuleEditor({ id, initial, samples, onClose }: { id: string | null; initial: RuleInput; samples: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const [r, setR] = useState(initial);
  const [sample, setSample] = useState(samples[0] ?? '');
  const set = (p: Partial<RuleInput>) => setR((x) => ({ ...x, ...p }));
  const valid = validateRegex(r.body_regex);
  const map = (f: string, v: string) => {
    const n = Number(v);
    const next = { ...r.field_map_json };
    if (Number.isInteger(n) && n > 0) next[f] = n;
    else delete next[f];
    set({ field_map_json: next });
  };
  const pv = valid && r.field_map_json.amount ? preview(r, sample ? [sample, ...samples] : samples) : null;
  return (
    <Sheet open onClose={onClose} title={id ? t('sms.edit') : t('sms.newRule')}>
      <Field label={t('sms.ruleName')} value={r.name} onChange={(e) => set({ name: e.target.value })} />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('sms.regex')}</span>
        <textarea
          dir="ltr"
          rows={3}
          value={r.body_regex}
          onChange={(e) => set({ body_regex: e.target.value })}
          aria-invalid={!valid && r.body_regex !== ''}
          className={`rounded-2xl border bg-surface-3 p-3 font-mono text-[13px] ${!valid && r.body_regex ? 'border-coral' : 'border-transparent'}`}
          data-testid="rule-regex"
        />
      </label>
      <div className="grid grid-cols-4 gap-2">
        {['amount', 'balance', 'card', 'ref'].map((f) => (
          <Field key={f} label={t(`sms.field.${f}`)} inputMode="numeric" value={String(r.field_map_json[f] ?? '')} onChange={(e) => map(f, e.target.value)} />
        ))}
      </div>
      <Segmented label={t('sms.direction')} value={r.type_hint} onChange={(v) => set({ type_hint: v })} options={[{ value: 'auto', label: t('sms.auto') }, { value: 'debit', label: t('entry.expense') }, { value: 'credit', label: t('entry.income') }]} />
      <Segmented label={t('unit.label')} value={r.unit_hint} onChange={(v) => set({ unit_hint: v })} options={[{ value: 'auto', label: t('sms.auto') }, { value: 'irr', label: t('unit.rial') }, { value: 'irt', label: t('unit.toman') }]} />
      <Toggle label={t('sms.enabled')} checked={r.is_enabled} onChange={(v) => set({ is_enabled: v })} />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('sms.sample')}</span>
        <textarea dir="auto" rows={3} value={sample} onChange={(e) => setSample(e.target.value)} className="rounded-2xl bg-surface-3 p-3 text-[13px]" data-testid="rule-sample" />
      </label>
      <p className="text-[13px] text-ink-2" role="status" data-testid="rule-preview">
        {pv ? t('sms.matches', { n: localDigits(pv.matched, lang) }) : t('sms.regexInvalid')}
      </p>
      <Button
        disabled={!valid || !r.field_map_json.amount}
        data-testid="rule-save"
        onClick={() => {
          onClose();
          void mutate(async (db) => {
            await saveRule(db, r, id);
            await reprocessInbox(db, workerParser);
          });
        }}
      >
        {t('sms.saveRule')}
      </Button>
    </Sheet>
  );
}
