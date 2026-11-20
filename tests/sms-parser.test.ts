// Phase 5 gate: ≥ 80 SMS vectors (tests/sms-fixtures) + ingestion invariants on both adapters.
import { describe, expect, it } from 'vitest';
import { jalaliToGregorian, zonedToUtc } from '../src/core/calendar/calendar';
import { seedCategories } from '../src/core/data/seedCategories';
import { createAccount, reconcileBalance, type AccountInput } from '../src/core/ledger/accounts';
import { createTransaction } from '../src/core/ledger/ledger';
import {
  approvePending,
  balanceDrift,
  buildTaughtRegex,
  confirmSender,
  ingestMany,
  ingestSms,
  numberTokens,
  readInbox,
  reprocessInbox,
  saveRule,
} from '../src/core/sms/ingest';
import { firewall, normalizeSms } from '../src/core/sms/normalize';
import { LOW_CONFIDENCE, parseSms, splitBulk } from '../src/core/sms/parser';
import type { IVaultDatabase } from '../src/core/storage/IVaultDatabase';
import { ALL, type Vector } from './sms-fixtures/vectors';
import { ADAPTERS } from './helpers/vaults';

const NOW = Date.UTC(2026, 10, 20, 12);

function expectedAt(at: string, iranian: boolean): number {
  const [d, t] = at.split(' ');
  const [y, m, day] = d!.split('-').map(Number) as [number, number, number];
  const [hh, mm] = t!.split(':').map(Number) as [number, number];
  return iranian ? zonedToUtc(jalaliToGregorian({ y, m, d: day }), 'Asia/Tehran', hh, mm) : Date.UTC(y, m - 1, day, hh, mm);
}

describe(`SMS vectors (${ALL.length})`, () => {
  it('has at least 80 vectors', () => expect(ALL.length).toBeGreaterThanOrEqual(80));

  it.each(ALL.map((v) => [v.name, v] as [string, Vector]))('%s', (_n, v) => {
    const r = parseSms(v.text, { now: NOW, localTz: 'UTC' });
    const e = v.expect;
    if (e.kind !== 'parsed') {
      expect(r.kind).toBe(e.kind);
      if (e.kind === 'rejected' && r.kind === 'rejected') expect(r.reason).toBe(e.reason);
      return;
    }
    expect(r.kind).toBe('parsed');
    if (r.kind !== 'parsed') return;
    const s = r.sms;
    expect(typeof s.amount_minor).toBe('bigint');
    expect(s.amount_minor).toBe(BigInt(e.amount));
    expect(s.currency_code).toBe(e.currency ?? 'IRR');
    if (e.bank !== undefined) expect(s.bank_code).toBe(e.bank);
    if (e.dir !== undefined) expect(s.direction).toBe(e.dir);
    if (e.balance !== undefined) expect(s.balance_after_minor).toBe(e.balance === null ? null : BigInt(e.balance));
    if (e.card !== undefined) expect(s.card_suffix).toBe(e.card);
    if (e.ref !== undefined) expect(s.reference_no).toBe(e.ref);
    if (e.merchant !== undefined) expect(s.merchant).toBe(e.merchant);
    if (e.at !== undefined) expect(s.occurred_at).toBe(e.at === null ? null : expectedAt(e.at, s.currency_code === 'IRR'));
    expect(s.confidence).toBeGreaterThanOrEqual(e.minConfidence ?? 0);
    expect(s.confidence).toBeLessThanOrEqual(e.maxConfidence ?? 1);
  });
});

describe('normalizer', () => {
  it('digits, letters, invisible marks and trailing minus', () => {
    expect(normalizeSms('برداشت‌: ۲٬۰۰۰٬۰۰۰-')).toBe('برداشت: -2,000,000');
    expect(normalizeSms('ي ك ـــ ‏')).toBe('ی ک');
    expect(normalizeSms('1403/08/15-09:15')).toBe('1403/08/15-09:15');
    expect(normalizeSms('500,000+ ریال')).toBe('+500,000 ریال');
  });
  it('firewall runs on raw text with ZWNJ and Arabic letters', () => {
    expect(firewall('رمز‌ پويا')).toBe('otp');
    expect(firewall('واریز 1,000 ریال')).toBeNull();
  });
  it('splitBulk separates by blank lines and ---', () => {
    expect(splitBulk('a\nb\n\nc\n---\nd')).toEqual(['a\nb', 'c', 'd']);
  });
  it('a low-confidence threshold exists for Teach the Parser', () => expect(LOW_CONFIDENCE).toBeGreaterThan(0.5));
});

const melliCard: AccountInput = {
  name: 'ملی',
  type: 'bank_card',
  bank_code: 'melli',
  card_number: '6037990000049995',
  iban_sheba: '',
  account_number: '',
  currency_code: 'IRR',
  initial_balance_minor: 10_000_000n,
  card_finish: 'obsidian_carbon',
  is_included_in_net_worth: true,
  notes: '',
};

async function txCount(db: IVaultDatabase) {
  return (await db.find('transactions')).length;
}

describe.each(ADAPTERS)('SMS ingestion on %s', (_n, make) => {
  it('OTP and spam are never persisted anywhere', async () => {
    const db = await make();
    await createAccount(db, melliCard);
    const before = JSON.stringify(await Promise.all([db.find('transactions'), db.find('settings'), db.find('app_audit_log')]));
    const out = await ingestMany(db, [
      { text: 'بانک ملی\nرمز پویا: 845123\nمبلغ: 2,000,000 ریال', source: 'sms_auto' },
      { text: 'شما برنده جایزه شدید', source: 'paste_parse' },
      { text: 'Your OTP is 774411', source: 'notification_auto' },
    ]);
    expect(out.map((o) => o.kind)).toEqual(['rejected', 'rejected', 'rejected']);
    const after = JSON.stringify(await Promise.all([db.find('transactions'), db.find('settings'), db.find('app_audit_log')]));
    expect(after).toBe(before);
  });

  it('queues a parsed SMS as pending_review on the card-matched account, no balance change until approved', async () => {
    const db = await make();
    await seedCategories(db);
    const acc = await createAccount(db, melliCard);
    const o = await ingestSms(db, { text: 'بانک ملی\nخرید از اسنپ فود\nمبلغ 640,000 ریال\nکارت ****9995\nموجودی 9,360,000 ریال', source: 'paste_parse' }, undefined, NOW);
    expect(o.kind).toBe('queued');
    if (o.kind !== 'queued') return;
    expect(o.tx.status).toBe('pending_review');
    expect(o.tx.account_id).toBe(acc.id);
    expect(o.tx.category_id).toBe('cat_food');
    expect(o.tx.sms_fingerprint_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await db.get('accounts', acc.id))!.current_balance_minor).toBe(10_000_000n);
    await approvePending(db, o.tx.id, NOW);
    expect((await db.get('accounts', acc.id))!.current_balance_minor).toBe(9_360_000n);
    expect((await db.get('merchant_category_memory', 'اسنپ فود'))?.category_id).toBe('cat_food');
  });

  it('two cards: the card suffix, then the bank, then the reported balance pick the account; a tie waits in the inbox', async () => {
    const db = await make();
    // Two Melli cards and one Saman card (a Blu card is printed on Saman), different balances.
    const m1 = await createAccount(db, { ...melliCard, name: 'ملی ۱' });
    const m2 = await createAccount(db, { ...melliCard, name: 'ملی ۲', card_number: '6037991234567893', initial_balance_minor: 30_000_000n });
    const blu = await createAccount(db, { ...melliCard, name: 'بلو', bank_code: 'saman', card_number: '6219861234567898', initial_balance_minor: 5_818_710n });
    let k = 0;
    const on = async (text: string) => {
      const o = await ingestSms(db, { text, source: 'paste_parse' }, undefined, NOW + ++k * 3_600_000);
      return o.kind === 'queued' ? o.tx.account_id : o.kind;
    };
    // 1. The suffix in the text decides, even with two cards of the same bank.
    expect(await on('بانک ملی\nبرداشت 100,000 ریال\nکارت ****7893')).toBe(m2.id);
    // 2. No suffix, two Melli cards: the reported balance fits only one of them.
    expect(await on('بانک ملی\nبرداشت 200,000 ریال\nموجودی 9,800,000 ریال')).toBe(m1.id);
    // 3. A Blu SMS lands on the card saved under Saman (its issuer).
    expect(await on('بلو\nبرداشت پول\n199,000ریال از حساب شما پرید.\nموجودی: 5,619,710 ریال')).toBe(blu.id);
    // 4. Nothing tells the two Melli cards apart: never guessed, the message waits in the inbox.
    expect(await on('بانک ملی\nبرداشت 50,000 ریال')).toBe('inbox');
  });

  it('dedupes the same SMS by SHA-256 fingerprint (pasted twice, different spacing/digits)', async () => {
    const db = await make();
    await createAccount(db, melliCard);
    const a = await ingestSms(db, { text: 'بانک ملی\nبرداشت 100,000\nمانده 9,900,000', source: 'paste_parse' }, undefined, NOW);
    const b = await ingestSms(db, { text: 'بانک ملی\r\nبرداشت  ۱۰۰٬۰۰۰\nمانده ۹٬۹۰۰٬۰۰۰', source: 'ios_shortcut' }, undefined, NOW);
    expect(a.kind).toBe('queued');
    expect(b.kind).toBe('duplicate');
    expect(await txCount(db)).toBe(1);
  });

  it('suppresses an SMS + push pair: same bank account, amount and balance within ±2 min', async () => {
    const db = await make();
    await createAccount(db, { ...melliCard, bank_code: 'blu', card_number: '' });
    const sms = await ingestSms(db, { text: 'بلو بانک\nخرید 120,000 تومان\nمانده 2,380,000 تومان\n1403/08/30 10:00', source: 'sms_auto' }, undefined, NOW);
    const push = await ingestSms(db, { text: 'بلوبانک: خرید 120,000 تومان از دیجی کالا. موجودی: 2,380,000 تومان', source: 'notification_auto', received_at: zonedToUtc(jalaliToGregorian({ y: 1403, m: 8, d: 30 }), 'Asia/Tehran', 10, 1) }, undefined, NOW);
    expect(sms.kind).toBe('queued');
    expect(push.kind).toBe('duplicate');
    // A different balance is a different transaction.
    const other = await ingestSms(db, { text: 'بلو بانک\nخرید 120,000 تومان\nمانده 2,260,000 تومان\n1403/08/30 10:01', source: 'sms_auto' }, undefined, NOW);
    expect(other.kind).toBe('queued');
    expect(await txCount(db)).toBe(2);
  });

  it('unparsed and unmatched messages go to the inbox; a taught rule and a new account drain it', async () => {
    const db = await make();
    const weird = 'Mellat\nTRX 45000 R\nREM 955000 R';
    const o = await ingestSms(db, { text: weird, source: 'paste_parse' }, undefined, NOW);
    expect(o.kind).toBe('inbox');
    expect((await readInbox(db)).length).toBe(1);
    // Teach: tap amount and balance.
    const norm = normalizeSms(weird);
    const toks = numberTokens(norm);
    const rx = buildTaughtRegex(norm, { amount: toks[0]!, balance: toks[1]! });
    await saveRule(db, { name: 'mellat raw', bank_code: null, sender_patterns_json: [], body_regex: rx.body_regex, type_hint: 'debit', field_map_json: rx.field_map_json, unit_hint: 'irr', priority: 10, is_enabled: true }, null, NOW);
    expect((await db.find('app_audit_log')).map((a) => a.event)).toContain('sms_rule_changed');
    // Still no account → stays in inbox as no_account.
    await reprocessInbox(db, undefined, NOW);
    expect((await readInbox(db))[0]?.reason).toBe('no_account');
    await createAccount(db, { ...melliCard, bank_code: 'mellat', card_number: '' });
    const out = await reprocessInbox(db, undefined, NOW);
    const first = out[0]!;
    expect(first.kind).toBe('queued');
    if (first.kind === 'queued') {
      expect(first.tx.amount_minor).toBe(45_000n);
      expect(first.tx.reported_balance_after_minor).toBe(955_000n);
      expect(first.tx.type).toBe('expense');
    }
    expect(await readInbox(db)).toEqual([]);
    // The taught rule generalizes to the next message with other numbers.
    const next = await ingestSms(db, { text: 'Mellat\nTRX 12000 R\nREM 943000 R', source: 'paste_parse' }, undefined, NOW);
    expect(next.kind).toBe('queued');
    if (next.kind === 'queued') expect(next.tx.amount_minor).toBe(12_000n);
  });

  it('confirmed senders identify the bank when the text does not name it', async () => {
    const db = await make();
    await createAccount(db, { ...melliCard, bank_code: 'saman', card_number: '' });
    await createAccount(db, { ...melliCard, name: 'ملی ۲', card_number: '' });
    const text = 'برداشت 70,000\nمانده 930,000';
    expect((await ingestSms(db, { text, source: 'sms_auto', sender: '+98-test-1' }, undefined, NOW)).kind).toBe('inbox');
    await confirmSender(db, '+98-test-1', 'saman', NOW);
    const out = await reprocessInbox(db, undefined, NOW);
    expect(out[0]!.kind).toBe('queued');
  });

  it('balance drift: reported balance vs. ledger, cleared by reconcileBalance', async () => {
    const db = await make();
    const acc = await createAccount(db, melliCard);
    await createTransaction(db, { account_id: acc.id, type: 'expense', amount_minor: 50_000n, occurred_at: NOW - 3_600_000 });
    const o = await ingestSms(db, { text: 'بانک ملی\nبرداشت 100,000\nمانده 9,800,000', source: 'paste_parse' }, undefined, NOW);
    if (o.kind !== 'queued') throw new Error('expected queued');
    await approvePending(db, o.tx.id, NOW);
    // Ledger: 10,000,000 − 50,000 − 100,000 = 9,850,000; bank says 9,800,000.
    const drift = balanceDrift((await db.get('accounts', acc.id))!, await db.find('transactions'));
    expect(drift?.delta).toBe(-50_000n);
    await reconcileBalance(db, acc.id, drift!.reported, NOW + 1);
    expect((await db.get('accounts', acc.id))!.current_balance_minor).toBe(9_800_000n);
    expect(balanceDrift((await db.get('accounts', acc.id))!, await db.find('transactions'))).toBeNull();
  });

  it('no drift when the reported balance matches', async () => {
    const db = await make();
    const acc = await createAccount(db, melliCard);
    const o = await ingestSms(db, { text: 'بانک ملی\nواریز 500,000\nمانده 10,500,000', source: 'paste_parse' }, undefined, NOW);
    if (o.kind !== 'queued') throw new Error('expected queued');
    await approvePending(db, o.tx.id, NOW);
    expect(balanceDrift((await db.get('accounts', acc.id))!, await db.find('transactions'))).toBeNull();
  });
});
