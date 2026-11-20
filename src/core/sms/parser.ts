// SmsParserEngine (PROMPT.md §6.2): firewall → normalize → custom rules → data-driven templates →
// label-driven extraction with a generic heuristic fallback. Pure and synchronous: it runs inside
// sms.worker.ts in the app and directly in tests. It never logs and never stores anything itself.
import { DEFAULT_TZ, jalaliToGregorian, zonedToUtc, zonedParts } from '../calendar/calendar';
import { MINOR_DIGITS, type CurrencyCode } from '../currency/money';
import data from '../data/sms-templates.json';
import type { SmsParserRule } from '../storage/schema';
import { firewall, normalizeSms } from './normalize';

export type Direction = 'debit' | 'credit';
export type Channel = 'pos' | 'online' | 'atm' | 'transfer' | 'mobile';

export interface ParsedSms {
  bank_code: string | null;
  direction: Direction | null;
  amount_minor: bigint;
  currency_code: CurrencyCode;
  balance_after_minor: bigint | null;
  card_suffix: string | null;
  occurred_at: number | null;
  merchant: string | null;
  reference_no: string | null;
  channel: Channel | null;
  confidence: number;
  via: 'custom' | 'template' | 'heuristic';
  rule_id: string | null;
}

export type ParseResult =
  | { kind: 'rejected'; reason: 'otp' | 'spam' }
  | { kind: 'unparsed'; bank_code: string | null }
  | { kind: 'parsed'; sms: ParsedSms };

export interface ParseOptions {
  /** User-confirmed sender → bank code (PROMPT.md §1.4). */
  senders?: Record<string, string>;
  sender?: string | null;
  /** Enabled sms_parser_rules; tried first, highest priority first. */
  rules?: readonly Pick<SmsParserRule, 'id' | 'bank_code' | 'sender_patterns_json' | 'body_regex' | 'type_hint' | 'field_map_json' | 'unit_hint' | 'priority' | 'is_enabled'>[];
  /** Reference time for dates without a year. */
  now?: number;
  /** Zone for international banks' wall-clock times (Iranian banks always use Asia/Tehran). */
  localTz?: string;
}

/** Below this the Review Queue suggests "Teach the Parser". */
export const LOW_CONFIDENCE = 0.6;

interface Template {
  bank_code: string;
  keywords: string[];
  unit?: string;
  currency?: string;
  date_order?: string;
}
const TEMPLATES = data.templates as Template[];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** Keyword regex: spaces optional, letter boundaries that work for Persian (\b does not). */
const kw = (k: string) => `(?<![\\p{L}\\p{N}])${esc(k).replace(/ /g, ' ?')}(?![\\p{L}])`;
const anyOf = (ks: readonly string[], flags = 'giu') => new RegExp(ks.map(kw).join('|'), flags);

type LabelKind = 'amount' | 'balance' | 'ref' | 'card' | 'merchant';
const LABEL_KINDS: LabelKind[] = ['amount', 'balance', 'ref', 'card', 'merchant'];
const LABEL_RES = LABEL_KINDS.map((k) => [k, anyOf((data.labels as Record<LabelKind, string[]>)[k])] as const);
const DEBIT_RE = anyOf([...data.direction.debit, 'used']);
const CREDIT_RE = anyOf(data.direction.credit);
const CHANNEL_RES = Object.entries(data.channels).map(([k, v]) => [k as Channel, anyOf(v, 'iu')] as const);
const TEMPLATE_RES = TEMPLATES.map((t) => [t, anyOf(t.keywords, 'iu')] as const);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

interface Label {
  kind: LabelKind;
  start: number;
  end: number;
  text: string;
}

function findLabels(s: string): Label[] {
  const all: Label[] = [];
  for (const [kind, re] of LABEL_RES) {
    for (const m of s.matchAll(re)) all.push({ kind, start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  // A label inside a longer one ("حساب" in "مانده حساب") belongs to the longer one.
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Label[] = [];
  for (const l of all) {
    const last = out[out.length - 1];
    if (last && l.start < last.end) continue;
    out.push(l);
  }
  return out;
}

/** Replace a span with a filler so later scans skip it while offsets stay put. */
const blank = (s: string, start: number, end: number) => s.slice(0, start) + '§'.repeat(end - start) + s.slice(end);

function detectBank(s: string, o: ParseOptions): Template | null {
  const bySender = o.sender ? o.senders?.[o.sender] : undefined;
  if (bySender) return TEMPLATES.find((t) => t.bank_code === bySender) ?? { bank_code: bySender, keywords: [] };
  let best: Template | null = null;
  let bestAt = Infinity;
  for (const [t, re] of TEMPLATE_RES) {
    const m = re.exec(s);
    if (m && m.index < bestAt) {
      best = t;
      bestAt = m.index;
    }
  }
  return best;
}

interface DateHit {
  ms: number;
}

/** Find and blank dates and times. Returns the timestamp (Tehran for Iranian banks). */
function takeDateTime(s: string, iranian: boolean, order: string, o: ParseOptions): { s: string; ms: number | null } {
  let ymd: { y: number; m: number; d: number; jalali: boolean } | null = null;
  let hh = 0;
  let mm = 0;
  let timeFound = false;
  const now = o.now ?? Date.now();
  const nowParts = zonedParts(now, iranian ? DEFAULT_TZ : (o.localTz ?? 'UTC'));

  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean) => {
    const m = re.exec(s);
    if (m && fn(m)) s = blank(s, m.index, m.index + m[0].length);
  };

  // 1403/08/15, 1403-08-15, 2026/11/20, 03/08/15
  take(/(?<![\d.,])(\d{2,4})[/-](\d{1,2})[/-](\d{1,4})(?![\d,]|\.\d)/, (m) => {
    const a = +m[1]!;
    const b = +m[2]!;
    const c = +m[3]!;
    if (m[1]!.length === 4 || (iranian && m[3]!.length <= 2)) {
      let y = a;
      if (y < 100) y += y >= 50 ? 1300 : 1400;
      ymd = { y, m: b, d: c, jalali: y < 1700 };
    } else {
      let y = c < 100 ? 2000 + c : c;
      const [mo, d] = order === 'mdy' ? [a, b] : [b, a];
      if (y < 1700) {
        y = c;
        ymd = { y, m: b, d: a, jalali: true };
      } else ymd = { y, m: mo, d, jalali: false };
    }
    return true;
  });
  // 20 Nov 2026 / Nov 20, 2026 / Nov 20
  if (!ymd) {
    take(/(?<![\p{L}\d])(\d{1,2})[ -]([A-Za-z]{3})[a-z]*\.?,?[ -](\d{4})/u, (m) => {
      const mo = MONTHS.indexOf(m[2]!.toLowerCase());
      if (mo < 0) return false;
      ymd = { y: +m[3]!, m: mo + 1, d: +m[1]!, jalali: false };
      return true;
    });
  }
  if (!ymd) {
    take(/(?<![\p{L}])([A-Za-z]{3})[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?(?!\d)/u, (m) => {
      const mo = MONTHS.indexOf(m[1]!.toLowerCase());
      if (mo < 0) return false;
      ymd = { y: m[3] ? +m[3] : nowParts.y, m: mo + 1, d: +m[2]!, jalali: false };
      return true;
    });
  }
  // 14:32[:05] [AM|PM]
  take(/(?<![\d:])(\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([AaPp])\.?[Mm]\.?)?(?![\d:])/, (m) => {
    hh = +m[1]!;
    mm = +m[2]!;
    const ap = m[4]?.toLowerCase();
    if (ap === 'p' && hh < 12) hh += 12;
    if (ap === 'a' && hh === 12) hh = 0;
    if (hh > 23 || mm > 59) return false;
    timeFound = true;
    return true;
  });

  const d = ymd as { y: number; m: number; d: number; jalali: boolean } | null;
  if (!d) return { s, ms: null };
  const g = d.jalali ? jalaliToGregorian({ y: d.y, m: d.m, d: d.d }) : { y: d.y, m: d.m, d: d.d };
  if (g.m < 1 || g.m > 12 || g.d < 1 || g.d > 31) return { s, ms: null };
  const tz = iranian ? DEFAULT_TZ : (o.localTz ?? 'UTC');
  const hit: DateHit = { ms: zonedToUtc(g, tz, timeFound ? hh : 12, timeFound ? mm : 0) };
  return { s, ms: hit.ms };
}

/** Masked cards (6104***1234, ****1234, XX1234, ...1234, ending in 1234). Blanks them; returns the suffix. */
function takeCard(s: string): { s: string; suffix: string | null } {
  const res = [
    /[\d*xX•.\-]*[*xX•]{2,}[\d*xX•.\-]*?(\d{4})(?!\d)/,
    /\.{2,}(\d{4})(?!\d)/,
    /ending(?: in| with)? ?(\d{4})(?!\d)/i,
    /(?<!\d)\d{16}(?!\d)/,
  ];
  for (const re of res) {
    const m = re.exec(s);
    if (m) return { s: blank(s, m.index, m.index + m[0].length), suffix: (m[1] ?? m[0]).slice(-4) };
  }
  return { s, suffix: null };
}

const CUR_AFTER = /^ ?:? ?(ریال|تومان|IRR|IRT|Rials?|Rls?\.?|Tomans?|USD|EUR|GBP|AED|Dhs?\.?|\$|€|£)/iu;
const CUR_BEFORE = /(USD|EUR|GBP|AED|Dhs?\.?|IRR|IRT|\$|€|£) ?:? ?$/iu;

type Marker = { currency: CurrencyCode; toman: boolean } | null;
function markerOf(word: string | undefined): Marker {
  if (!word) return null;
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w === 'تومان' || w === 'irt' || w.startsWith('toman')) return { currency: 'IRR', toman: true };
  if (w === 'ریال' || w === 'irr' || w.startsWith('rial') || w === 'rl' || w === 'rls') return { currency: 'IRR', toman: false };
  if (w === '$' || w === 'usd') return { currency: 'USD', toman: false };
  if (w === '€' || w === 'eur') return { currency: 'EUR', toman: false };
  if (w === '£' || w === 'gbp') return { currency: 'GBP', toman: false };
  if (w === 'aed' || w === 'dh' || w === 'dhs') return { currency: 'AED', toman: false };
  return null;
}

interface NumToken {
  start: number;
  end: number;
  raw: string;
  sign: '' | '-' | '+';
  digits: string;
  grouped: boolean;
  marker: Marker;
  label: Label | null;
}

function numTokens(s: string, labels: Label[]): NumToken[] {
  const out: NumToken[] = [];
  for (const m of s.matchAll(/([-+]?)(\d[\d,]*(?:\.\d+)?)(?:-\d+)*/g)) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const lineStart = s.lastIndexOf('\n', start - 1) + 1;
    // Nearest preceding label on the same line, with no other number in between.
    let label: Label | null = null;
    for (const l of labels) {
      if (l.end > start) break;
      if (l.start >= lineStart && start - l.end <= 32) label = l;
    }
    if (label && out.some((t) => t.start > label!.end && t.end <= start)) label = null;
    const after = CUR_AFTER.exec(s.slice(end));
    const before = CUR_BEFORE.exec(s.slice(Math.max(0, start - 6), start));
    out.push({
      start,
      end,
      raw,
      sign: m[1] as NumToken['sign'],
      digits: m[2]!.replace(/,/g, ''),
      grouped: m[2]!.includes(','),
      marker: markerOf(after?.[1]) ?? markerOf(before?.[1]),
      label,
    });
  }
  return out;
}

/** Major-unit decimal string → minor units for the currency (bigint, no float). */
function toMinor(digits: string, currency: CurrencyCode, toman: boolean): bigint | null {
  const [int, frac = ''] = digits.split('.');
  if (!int || int.length > 15) return null;
  const places = MINOR_DIGITS[currency];
  const minor = BigInt(int + frac.padEnd(places, '0').slice(0, places));
  return currency === 'IRR' && toman ? minor * 10n : minor;
}

function takeMerchant(s: string, labels: Label[]): string | null {
  for (const l of labels) {
    if (l.kind !== 'merchant') continue;
    const rest = s.slice(l.end).replace(/^ ?[:：]? ?/, '');
    if (!/^\p{L}/u.test(rest)) continue;
    let stop = rest.search(/[\n\d§,،.:;!?()]| (on|at|for|via|with|مبلغ|به مبلغ|در تاریخ|ساعت|مانده|موجودی) /iu);
    if (stop < 0) stop = rest.length;
    const name = rest
      .slice(0, stop)
      .replace(/ (ریال|تومان)$/, '')
      .replace(/^(فروشگاه|پذیرنده) /, '')
      .trim()
      .slice(0, 40)
      .trim();
    if (name.length >= 2 && !LABEL_RES.some(([, re]) => new RegExp(`^(${re.source})$`, 'iu').test(name))) return name;
  }
  return null;
}

function directionOf(s: string, amountLabel: Label | null, sign: NumToken['sign']): Direction | null {
  if (sign === '-') return 'debit';
  if (sign === '+') return 'credit';
  if (amountLabel) {
    if (new RegExp(`^(?:${CREDIT_RE.source})$`, 'iu').test(amountLabel.text)) return 'credit';
    if (new RegExp(`^(?:${DEBIT_RE.source})$`, 'iu').test(amountLabel.text)) return 'debit';
  }
  CREDIT_RE.lastIndex = 0;
  DEBIT_RE.lastIndex = 0;
  const c = CREDIT_RE.exec(s);
  const d = DEBIT_RE.exec(s);
  if (c && d) return c.index < d.index ? 'credit' : 'debit';
  return c ? 'credit' : d ? 'debit' : null;
}

function channelOf(s: string): Channel | null {
  for (const [ch, re] of CHANNEL_RES) if (re.test(s)) return ch;
  return null;
}

type RuleLike = NonNullable<ParseOptions['rules']>[number];

/** Custom / taught rules: a regex over the normalized text with a field → capture-group map. */
function applyRule(rule: RuleLike, text: string, tpl: Template | null, o: ParseOptions): ParsedSms | null {
  if (rule.sender_patterns_json.length && !(o.sender && rule.sender_patterns_json.some((p) => p === o.sender))) return null;
  let re: RegExp;
  try {
    re = new RegExp(rule.body_regex, 'iu');
  } catch {
    return null;
  }
  const m = re.exec(text);
  if (!m) return null;
  const g = (f: string) => {
    const i = rule.field_map_json[f];
    return i !== undefined ? m[i] : undefined;
  };
  const amountRaw = g('amount');
  if (!amountRaw) return null;
  const amt = /([-+]?)(\d[\d,]*(?:\.\d+)?)/.exec(amountRaw);
  if (!amt) return null;
  const currency = (tpl?.currency as CurrencyCode | undefined) ?? 'IRR';
  const toman = rule.unit_hint === 'irt' || (rule.unit_hint === 'auto' && /تومان/.test(text));
  const amount = toMinor(amt[2]!.replace(/,/g, ''), currency, toman);
  if (amount === null || amount === 0n) return null;
  const balRaw = g('balance');
  const bal = balRaw ? /(\d[\d,]*(?:\.\d+)?)/.exec(balRaw) : null;
  const neg = balRaw ? /-/.test(balRaw.replace(/\d-\d/g, '')) : false;
  const balance = bal ? toMinor(bal[1]!.replace(/,/g, ''), currency, toman) : null;
  const card = g('card')?.replace(/\D/g, '').slice(-4) || null;
  const dt = takeDateTime(text, currency === 'IRR', tpl?.date_order ?? 'dmy', o);
  const direction: Direction | null = rule.type_hint === 'debit' ? 'debit' : rule.type_hint === 'credit' ? 'credit' : directionOf(text, null, amt[1] as NumToken['sign']);
  return {
    bank_code: rule.bank_code ?? tpl?.bank_code ?? null,
    direction,
    amount_minor: amount,
    currency_code: currency,
    balance_after_minor: balance !== null && neg ? -balance : balance,
    card_suffix: card,
    occurred_at: dt.ms,
    merchant: g('merchant')?.trim() || null,
    reference_no: g('ref')?.replace(/\D/g, '') || null,
    channel: channelOf(text),
    confidence: direction ? 0.95 : 0.8,
    via: 'custom',
    rule_id: rule.id,
  };
}

/** Parse one message. OTP and spam are rejected before anything else happens. */
export function parseSms(raw: string, o: ParseOptions = {}): ParseResult {
  const verdict = firewall(raw);
  if (verdict) return { kind: 'rejected', reason: verdict };
  const text = normalizeSms(raw);
  const tpl = detectBank(text, o);

  const rules = [...(o.rules ?? [])].filter((r) => r.is_enabled && (!r.bank_code || !tpl || r.bank_code === tpl.bank_code)).sort((a, b) => b.priority - a.priority);
  for (const r of rules) {
    const hit = applyRule(r, text, tpl, o);
    if (hit) return { kind: 'parsed', sms: hit };
  }

  const iranian = !tpl?.currency;
  const dt = takeDateTime(text, iranian, tpl?.date_order ?? (iranian ? 'ymd' : 'dmy'), o);
  const card = takeCard(dt.s);
  let s = card.s;
  const labels = findLabels(s);
  const tokens = numTokens(s, labels);

  let amount: NumToken | null = null;
  let balance: NumToken | null = null;
  let ref: string | null = null;
  let refLabelled: string | null = null;
  let suffix = card.suffix;
  let heuristic = false;

  for (const t of tokens) {
    const kind = t.label?.kind;
    const plain = t.digits.replace('.', '');
    if (kind === 'ref') {
      refLabelled ??= t.raw.replace(/\D/g, '');
      continue;
    }
    if (kind === 'card') {
      if (!t.marker && !t.grouped) {
        suffix ??= t.raw.replace(/\D/g, '').slice(-4);
        continue;
      }
    }
    if (t.raw.includes('-') && /\d-\d/.test(t.raw)) continue; // account-like 123-456-789 without a card label
    // Never an amount: long ungrouped digit runs (cards, account numbers, reference ids) without a currency.
    if (!t.marker && !t.grouped && plain.length >= 10) {
      if (plain.length >= 16) suffix ??= plain.slice(-4);
      else ref ??= plain;
      continue;
    }
    if (kind === 'balance') {
      balance ??= t;
      continue;
    }
    if (kind === 'amount' || (t.sign && t.grouped) || (kind !== 'merchant' && t.marker)) {
      if (!amount) amount = t;
      else balance ??= t.marker && !t.label ? t : balance;
      continue;
    }
  }
  // Heuristic fallback: the largest grouped number that is not the balance.
  if (!amount) {
    const cands = tokens.filter((t) => t !== balance && t.grouped && t.label?.kind !== 'ref');
    cands.sort((a, b) => (BigInt(b.digits.split('.')[0]!) > BigInt(a.digits.split('.')[0]!) ? 1 : -1));
    if (cands[0]) {
      amount = cands[0];
      heuristic = true;
    }
  }
  if (!amount) return { kind: 'unparsed', bank_code: tpl?.bank_code ?? null };

  const currency: CurrencyCode = amount.marker?.currency ?? (tpl?.currency as CurrencyCode | undefined) ?? 'IRR';
  const toman = amount.marker ? amount.marker.toman : tpl?.unit === 'irt';
  const amountMinor = toMinor(amount.digits, currency, toman);
  if (amountMinor === null || amountMinor === 0n) return { kind: 'unparsed', bank_code: tpl?.bank_code ?? null };

  let balanceMinor: bigint | null = null;
  if (balance) {
    const bCur = balance.marker?.currency ?? currency;
    const bToman = balance.marker ? balance.marker.toman : toman;
    if (bCur === currency) {
      const v = toMinor(balance.digits, currency, bToman);
      if (v !== null) balanceMinor = balance.sign === '-' ? -v : v;
    }
  }

  s = blank(s, amount.start, amount.end);
  const direction = directionOf(text, amount.label, amount.sign);
  const merchant = takeMerchant(s, labels);

  let confidence = 0;
  if (tpl) confidence += 0.2;
  confidence += heuristic ? 0.15 : 0.35;
  if (direction) confidence += 0.2;
  if (balanceMinor !== null) confidence += 0.1;
  if (dt.ms !== null) confidence += 0.1;
  if (suffix) confidence += 0.05;
  if (!tpl) confidence *= 0.85;

  return {
    kind: 'parsed',
    sms: {
      bank_code: tpl?.bank_code ?? null,
      direction,
      amount_minor: amountMinor,
      currency_code: currency,
      balance_after_minor: balanceMinor,
      card_suffix: suffix,
      occurred_at: dt.ms,
      merchant,
      reference_no: refLabelled ?? ref,
      channel: channelOf(text),
      confidence: Math.round(Math.min(1, confidence) * 100) / 100,
      via: tpl ? 'template' : 'heuristic',
      rule_id: null,
    },
  };
}

/** SHA-256 of the normalized body: the same message pasted, shortcut-ingested or received twice is one row. */
export async function smsFingerprint(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeSms(raw));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Split a bulk paste into messages: blank lines or "---" lines separate them. */
export function splitBulk(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*(?:-{3,}|={3,})?\s*\n/)
    .map((m) => m.trim())
    .filter(Boolean);
}
