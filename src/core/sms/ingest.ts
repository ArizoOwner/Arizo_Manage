// SMS ingestion into the vault (PROMPT.md §6.2 stages 4–6): dedupe, account match, auto-category,
// pending_review posting, the unparsed inbox (for Teach the Parser), sender confirmation,
// merchant learning, balance drift, and taught/custom rules. OTP and spam never reach the DB.
import data from '../data/sms-templates.json';
import { balanceEffect, createTransaction, postPendingTransaction } from '../ledger/ledger';
import type { IVaultDatabase, VaultTx } from '../storage/IVaultDatabase';
import type { Account, Id, SmsParserRule, Transaction, TxSource } from '../storage/schema';
import { uuidv7 } from '../utils/uuidv7';
import { bankByCode } from '../data/banks';
import { normalizeSms } from './normalize';
import { parseSms, smsFingerprint, type ParseOptions, type ParseResult, type ParsedSms } from './parser';

export type SmsSource = Extract<TxSource, 'sms_auto' | 'notification_auto' | 'ios_shortcut' | 'paste_parse'>;
const SMS_SOURCES: readonly TxSource[] = ['sms_auto', 'notification_auto', 'ios_shortcut', 'paste_parse'];

export interface IncomingSms {
  text: string;
  source: SmsSource;
  sender?: string | null;
  received_at?: number;
}

/** A message we could not turn into a transaction yet (no amount, or no matching account). */
export interface InboxItem {
  id: string;
  text: string;
  source: SmsSource;
  sender: string | null;
  received_at: number;
  reason: 'unparsed' | 'no_account';
  bank_code: string | null;
}

export type IngestOutcome =
  | { kind: 'rejected'; reason: 'otp' | 'spam' }
  | { kind: 'duplicate'; tx_id: Id }
  | { kind: 'inbox'; item: InboxItem }
  | { kind: 'queued'; tx: Transaction; parsed: ParsedSms };

const INBOX_KEY = 'sms_inbox';
const SENDERS_KEY = 'sms_senders';
const INBOX_MAX = 100;
/** SMS + push of the same transaction arrive within this window. */
export const DEDUPE_WINDOW_MS = 2 * 60 * 1000;

async function getSetting<T>(tx: VaultTx, id: string, fallback: T): Promise<T> {
  const row = await tx.get('settings', id);
  return row && row.deleted_at === null ? (row.value_json as T) : fallback;
}
async function putSetting(tx: VaultTx, id: string, value: unknown, now: number) {
  const prev = await tx.get('settings', id);
  await tx.put('settings', { id, created_at: prev?.created_at ?? now, updated_at: now, deleted_at: null, value_json: value });
}

export const readInbox = (db: IVaultDatabase) => db.transaction((tx) => getSetting<InboxItem[]>(tx, INBOX_KEY, []));
export const readSenders = (db: IVaultDatabase) => db.transaction((tx) => getSetting<Record<string, string>>(tx, SENDERS_KEY, {}));

export function removeInboxItem(db: IVaultDatabase, id: string, now = Date.now()) {
  return db.transaction(async (tx) => putSetting(tx, INBOX_KEY, (await getSetting<InboxItem[]>(tx, INBOX_KEY, [])).filter((i) => i.id !== id), now));
}

/** The user confirms that `sender` belongs to `bankCode` (PROMPT.md §1.4: senders are never guessed). */
export function confirmSender(db: IVaultDatabase, sender: string, bankCode: string, now = Date.now()) {
  return db.transaction(async (tx) => {
    const map = await getSetting<Record<string, string>>(tx, SENDERS_KEY, {});
    await putSetting(tx, SENDERS_KEY, { ...map, [sender]: bankCode }, now);
  });
}

export const normalizeMerchant = (m: string): string => normalizeSms(m).toLowerCase().replace(/\s+/g, ' ').trim();

const MERCHANT_MAP = data.merchants.map((e) => ({ match: e.match.map(normalizeMerchant), category: e.category }));

/** Learned memory first, then the bundled Persian/English merchant map. */
export async function categoryFor(tx: VaultTx, merchant: string | null, text: string): Promise<Id | null> {
  if (merchant) {
    const mem = await tx.get('merchant_category_memory', normalizeMerchant(merchant));
    if (mem && mem.deleted_at === null && (await tx.get('categories', mem.category_id))) return mem.category_id;
  }
  const hay = normalizeMerchant(merchant ? `${merchant} ${text}` : text);
  for (const e of MERCHANT_MAP) if (e.match.some((m) => hay.includes(m))) return (await tx.get('categories', e.category)) ? e.category : null;
  return null;
}

/** Remember merchant → category (called when the user confirms or edits a categorised SMS). */
export function learnMerchant(db: IVaultDatabase, merchant: string, categoryId: Id, now = Date.now()) {
  const key = normalizeMerchant(merchant);
  if (!key) return Promise.resolve();
  return db.transaction(async (tx) => {
    const prev = await tx.get('merchant_category_memory', key);
    await tx.put('merchant_category_memory', {
      id: key,
      created_at: prev?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      category_id: categoryId,
      hit_count: prev && prev.category_id === categoryId ? prev.hit_count + 1 : 1,
    });
  });
}

/** Card suffix first; then the only account of that bank; then the only account in that currency. */
export function matchAccount(accounts: readonly Account[], p: Pick<ParsedSms, 'card_suffix' | 'bank_code' | 'currency_code'>): Account | null {
  const live = accounts.filter((a) => a.deleted_at === null && !a.is_archived && a.currency_code === p.currency_code);
  if (p.card_suffix) {
    const bySuffix = live.filter((a) => a.card_last4 === p.card_suffix || (a.account_number ?? '').endsWith(p.card_suffix!));
    if (bySuffix.length === 1) return bySuffix[0]!;
  }
  if (p.bank_code) {
    const byBank = live.filter((a) => a.bank_code === p.bank_code);
    if (byBank.length === 1) return byBank[0]!;
    // Neo-banks sit on an issuing bank (Blu on Saman): a card saved under the issuer, which is what the
    // BIN detects for a Blu card, is the same account when it is the only one there.
    const issuer = bankByCode(p.bank_code)?.issuer;
    if (!byBank.length && issuer) {
      const byIssuer = live.filter((a) => a.bank_code === issuer);
      if (byIssuer.length === 1) return byIssuer[0]!;
    }
  }
  const bankish = live.filter((a) => a.type === 'bank_card' || a.type === 'bank_account' || a.type === 'wallet');
  return bankish.length === 1 ? bankish[0]! : null;
}

function isNearDuplicate(t: Transaction, accountId: Id, p: ParsedSms, at: number): boolean {
  if (t.deleted_at !== null || t.status === 'voided' || !SMS_SOURCES.includes(t.source)) return false;
  if (t.account_id !== accountId || t.amount_minor !== p.amount_minor) return false;
  if (Math.abs(t.occurred_at - at) > DEDUPE_WINDOW_MS) return false;
  const a = t.reported_balance_after_minor;
  const b = p.balance_after_minor;
  return a === null || b === null || a === b;
}

export type Parser = (texts: string[], o: ParseOptions) => Promise<ParseResult[]>;
export const directParser: Parser = async (texts, o) => texts.map((t) => parseSms(t, o));

const ruleOptions = (rules: SmsParserRule[]) => rules.filter((r) => r.deleted_at === null && r.is_enabled);

/**
 * Ingest messages. Parsing may run in the SMS worker (`parser`); the DB work runs here, one atomic
 * transaction per message. Returns one outcome per input, in order.
 */
export async function ingestMany(db: IVaultDatabase, items: readonly IncomingSms[], parser: Parser = directParser, now = Date.now()): Promise<IngestOutcome[]> {
  const [rules, senders] = await Promise.all([db.find('sms_parser_rules'), readSenders(db)]);
  const out: IngestOutcome[] = [];
  // Parse per sender so the user-confirmed sender map applies.
  const results: ParseResult[] = [];
  for (const it of items) results.push(...(await parser([it.text], { rules: ruleOptions(rules), senders, sender: it.sender ?? null, now })));
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const r = results[i]!;
    if (r.kind === 'rejected') {
      out.push({ kind: 'rejected', reason: r.reason });
      continue;
    }
    const fp = await smsFingerprint(it.text);
    out.push(await ingestOne(db, it, r, fp, now));
  }
  return out;
}

export const ingestSms = async (db: IVaultDatabase, item: IncomingSms, parser: Parser = directParser, now = Date.now()) =>
  (await ingestMany(db, [item], parser, now))[0]!;

function ingestOne(db: IVaultDatabase, it: IncomingSms, r: Exclude<ParseResult, { kind: 'rejected' }>, fp: string, now: number): Promise<IngestOutcome> {
  return db.transaction(async (tx): Promise<IngestOutcome> => {
    const same = (await tx.find('transactions', { sms_fingerprint_sha256: fp }))[0];
    if (same) return { kind: 'duplicate', tx_id: same.id };
    const inbox = await getSetting<InboxItem[]>(tx, INBOX_KEY, []);
    const norm = normalizeSms(it.text);
    const toInbox = async (reason: InboxItem['reason'], bank: string | null): Promise<IngestOutcome> => {
      const existing = inbox.find((x) => normalizeSms(x.text) === norm);
      if (existing) {
        if (existing.reason === reason && existing.bank_code === bank) return { kind: 'inbox', item: existing };
        const item = { ...existing, reason, bank_code: bank };
        await putSetting(tx, INBOX_KEY, inbox.map((x) => (x.id === existing.id ? item : x)), now);
        return { kind: 'inbox', item };
      }
      const item: InboxItem = { id: uuidv7(now), text: it.text, source: it.source, sender: it.sender ?? null, received_at: it.received_at ?? now, reason, bank_code: bank };
      await putSetting(tx, INBOX_KEY, [item, ...inbox].slice(0, INBOX_MAX), now);
      return { kind: 'inbox', item };
    };
    if (r.kind === 'unparsed') return toInbox('unparsed', r.bank_code);
    const p = r.sms;
    const account = matchAccount(await tx.find('accounts'), p);
    if (!account) return toInbox('no_account', p.bank_code);
    const at = p.occurred_at ?? it.received_at ?? now;
    const dup = (await tx.find('transactions', { account_id: account.id })).find((t) => isNearDuplicate(t, account.id, p, at));
    if (dup) return { kind: 'duplicate', tx_id: dup.id };
    const row = await createTransaction(
      db,
      {
        account_id: account.id,
        type: p.direction === 'credit' ? 'income' : 'expense',
        amount_minor: p.amount_minor,
        occurred_at: at,
        category_id: await categoryFor(tx, p.merchant, norm),
        merchant_name: p.merchant ?? '',
        note: '',
        source: it.source,
        status: 'pending_review',
        external_ref_code: p.reference_no,
        sms_fingerprint_sha256: fp,
        reported_balance_after_minor: p.balance_after_minor,
      },
      now,
    );
    // A message that was waiting in the inbox (e.g. for an account) leaves it once queued.
    if (inbox.some((x) => normalizeSms(x.text) === norm)) await putSetting(tx, INBOX_KEY, inbox.filter((x) => normalizeSms(x.text) !== norm), now);
    return { kind: 'queued', tx: row, parsed: p };
  });
}

/** Confirm a reviewed SMS transaction: post it and learn its merchant → category. */
export async function approvePending(db: IVaultDatabase, id: Id, now = Date.now()) {
  const t = await db.get('transactions', id);
  const changed = await postPendingTransaction(db, id, now);
  if (t && t.merchant_name && t.category_id) await learnMerchant(db, t.merchant_name, t.category_id, now);
  return changed;
}

export interface Drift {
  account_id: Id;
  tx_id: Id;
  reported: bigint;
  computed: bigint;
  /** reported − computed at that transaction. */
  delta: bigint;
}

/**
 * Balance drift: the bank's reported balance after its latest posted SMS transaction vs. the
 * ledger's running balance at that same point. Non-zero → the "Adjust Balance" badge.
 */
export function balanceDrift(account: Account, txs: readonly Transaction[]): Drift | null {
  const mine = txs
    .filter((t) => t.account_id === account.id && t.deleted_at === null && t.status === 'posted')
    .sort((a, b) => a.occurred_at - b.occurred_at || (a.id < b.id ? -1 : 1));
  let running = account.initial_balance_minor;
  let last: Drift | null = null;
  for (const t of mine) {
    running += balanceEffect(t);
    // A later reconciliation adjustment resolves any earlier drift.
    if (t.type === 'adjustment') last = null;
    if (t.reported_balance_after_minor !== null) last = { account_id: account.id, tx_id: t.id, reported: t.reported_balance_after_minor, computed: running, delta: t.reported_balance_after_minor - running };
  }
  return last && last.delta !== 0n ? last : null;
}

// ---- Teach the Parser (Stage 6) --------------------------------------------------------------

export type TeachField = 'amount' | 'balance' | 'card' | 'ref';
export interface TextToken {
  start: number;
  end: number;
  text: string;
}

/** Tappable number tokens of a normalized message. */
export function numberTokens(norm: string): TextToken[] {
  return [...norm.matchAll(/[-+]?\d[\d,*xX.]*\d|\d/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
}

const NUM = '([-+]?\\d[\\d,]*(?:\\.\\d+)?)';
const CARD = '[\\d*xX.]*?(\\d{4})';
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Build a regex anchored on the words just before each tapped value (digits in that context are
 * generalized), so the rule matches the next message with different amounts, dates and names.
 */
export function buildTaughtRegex(norm: string, picks: Partial<Record<TeachField, TextToken>>): { body_regex: string; field_map_json: Record<string, number> } {
  const fields = (Object.entries(picks) as [TeachField, TextToken][]).sort((a, b) => a[1].start - b[1].start);
  let prevEnd = 0;
  const parts: string[] = [];
  const map: Record<string, number> = {};
  fields.forEach(([field, tok], i) => {
    const before = norm.slice(prevEnd, tok.start);
    const words = before.replace(/[\d\n]+/g, ' ').trim().split(' ').filter(Boolean);
    const ctx = words.slice(-2).join(' ');
    const anchor = ctx ? reEsc(ctx).replace(/ /g, '\\s*') + '[^\\d\\n]{0,6}' : '';
    parts.push(`${i === 0 ? '' : '[\\s\\S]*?'}${anchor}${field === 'card' ? CARD : NUM}`);
    map[field] = i + 1;
    prevEnd = tok.end;
  });
  return { body_regex: parts.join(''), field_map_json: map };
}

export interface RuleInput {
  name: string;
  bank_code: string | null;
  sender_patterns_json: string[];
  body_regex: string;
  type_hint: SmsParserRule['type_hint'];
  field_map_json: Record<string, number>;
  unit_hint: SmsParserRule['unit_hint'];
  priority: number;
  is_enabled: boolean;
}

export function validateRegex(src: string): boolean {
  try {
    new RegExp(src, 'iu');
    return src.length > 0 && src.length <= 2000;
  } catch {
    return false;
  }
}

/** Create or update a custom rule; logs `sms_rule_changed` (no content) to the audit log. */
export function saveRule(db: IVaultDatabase, input: RuleInput, id: Id | null = null, now = Date.now()): Promise<SmsParserRule> {
  return db.transaction(async (tx) => {
    if (!validateRegex(input.body_regex) || !input.field_map_json.amount) throw new Error('RULE_INVALID');
    const prev = id ? await tx.get('sms_parser_rules', id) : undefined;
    const row: SmsParserRule = { ...input, id: prev?.id ?? uuidv7(now), created_at: prev?.created_at ?? now, updated_at: now, deleted_at: null, is_custom: true, verified: true };
    await tx.put('sms_parser_rules', row);
    await tx.put('app_audit_log', { id: uuidv7(now), created_at: now, updated_at: now, deleted_at: null, event: 'sms_rule_changed', detail: prev ? 'update' : 'create' });
    return row;
  });
}

export function deleteRule(db: IVaultDatabase, id: Id, now = Date.now()) {
  return db.transaction(async (tx) => {
    await tx.delete('sms_parser_rules', id);
    await tx.put('app_audit_log', { id: uuidv7(now), created_at: now, updated_at: now, deleted_at: null, event: 'sms_rule_changed', detail: 'delete' });
  });
}

/** Re-run every inbox message (after a new rule, sender confirmation or account). */
export async function reprocessInbox(db: IVaultDatabase, parser: Parser = directParser, now = Date.now()) {
  const inbox = await readInbox(db);
  const out = await ingestMany(db, inbox.map((i) => ({ text: i.text, source: i.source, sender: i.sender, received_at: i.received_at })), parser, now);
  // Items that are now queued or turned out to be duplicates leave the inbox.
  for (let i = 0; i < inbox.length; i++) if (out[i]!.kind !== 'inbox') await removeInboxItem(db, inbox[i]!.id, now);
  return out;
}
