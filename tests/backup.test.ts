// Phase 8 gate: .arizo backup → wipe → restore is 100% faithful for every store and every blob, on both
// adapters and across them; wrong secrets, bit flips and truncation fail without writing anything.
import { describe, expect, it } from 'vitest';
import { ADAPTERS, FAST_ARGON, makeSqlVault, makeWebVault } from './helpers/vaults';
import { seedDemoData } from '../src/core/utils/demoData';
import { createAccount, type AccountInput } from '../src/core/ledger/accounts';
import { createTransaction, createTransfer, setSplits, verifyLedger } from '../src/core/ledger/ledger';
import { createCheque } from '../src/core/obligations/cheques';
import { createLoan, payInstallment } from '../src/core/obligations/loans';
import { createDebt, createPerson, settleDebt } from '../src/core/obligations/debts';
import { saveBudget, saveGoal } from '../src/core/analytics/plans';
import { confirmSender, saveRule } from '../src/core/sms/ingest';
import { emptyProfile, postInvoicePayment, saveCustomer, saveInvoice, saveProduct, saveProfile } from '../src/core/invoices/invoices';
import { saveImageAttachment } from '../src/core/attachments/attachments';
import { startOfCalendarDay } from '../src/core/calendar/calendar';
import { te } from '../src/core/crypto/bytes';
import type { IVaultDatabase } from '../src/core/storage/IVaultDatabase';
import { STORE_NAMES, type StoreName } from '../src/core/storage/schema';
import { BackupError, readHeader } from '../src/core/backup/container';
import { directEngine } from '../src/core/backup/engine';
import { takeSnapshot } from '../src/core/backup/payload';
import { generateRecoveryKey, parseRecoveryKey, recoveryWords } from '../src/core/backup/recovery';
import { acceptablePassphrase, passphraseStrength } from '../src/core/backup/strength';
import { backupDue, backupState, createBackup, inspectBackup, KEEP_SNAPSHOTS, listSnapshots, loadSnapshot, maybeAutoSnapshot, restoreBackup, saveRecovery, saveSnapshot } from '../src/core/backup/service';
import { uuidv7 } from '../src/core/utils/uuidv7';

const PASS = 'کوه-دماوند-۱۴۰۵-Arizo!';
const deps = { engine: directEngine, platform: 'web' as const, params: FAST_ARGON };
const pass = (p = PASS) => ({ kind: 'passphrase' as const, bytes: te.encode(p.normalize('NFKC')) });
const jNoon = (y: number, m: number, d: number) => startOfCalendarDay({ y, m, d }, 'jalali') + 12 * 3_600_000;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 300 }, (_, i) => (i * 37) & 0xff)]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 120 }, (_, i) => (i * 11) & 0xff)]);

const acct = (db: IVaultDatabase, name: string, currency: AccountInput['currency_code'] = 'IRR', balance = 0n) =>
  createAccount(db, { name, type: 'bank_account', bank_code: 'mellat', card_number: '', iban_sheba: '', account_number: '', currency_code: currency, initial_balance_minor: balance, card_finish: 'obsidian_carbon', is_included_in_net_worth: true, notes: '' });

/** Demo data plus at least one row in every one of the 26 stores, and two attachment blobs. */
async function fillVault(db: IVaultDatabase) {
  await seedDemoData(db);
  const a = await acct(db, 'ملت', 'IRR', 900_000_000n);
  const usd = await acct(db, 'USD', 'USD', 50_000n);
  const t1 = await createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 3_000_000n, occurred_at: jNoon(1405, 8, 1), merchant_name: 'افق کوروش', sms_fingerprint_sha256: 'f'.repeat(64), source: 'sms_auto' });
  await setSplits(db, t1.id, [
    { category_id: 'cat_grocery', amount_minor: 2_000_000n },
    { category_id: 'cat_food', amount_minor: 1_000_000n },
  ]);
  await createTransfer(db, { from_account_id: a.id, to_account_id: usd.id, amount_minor: 4_200_000n, to_amount_minor: 1_000n, occurred_at: jNoon(1405, 8, 2) });
  const now = Date.now();
  const tag = { id: uuidv7(), created_at: now, updated_at: now, deleted_at: null, name: 'سفر', color_hex: '#26C6DA' };
  await db.put('tags', tag);
  await db.put('transaction_tags', { id: uuidv7(), created_at: now, updated_at: now, deleted_at: null, transaction_id: t1.id, tag_id: tag.id });
  await db.put('merchant_category_memory', { id: 'افق کوروش', created_at: now, updated_at: now, deleted_at: null, category_id: 'cat_grocery', hit_count: 3 });
  await db.put('exchange_rates', { id: uuidv7(), created_at: now, updated_at: now, deleted_at: null, base_currency: 'USD', quote_currency: 'IRR', rate_ppm: 42_000_000_000_000n, effective_at: now });
  await saveImageAttachment(db, { owner_type: 'transaction', owner_id: t1.id }, JPG);
  await createCheque(db, { direction: 'issued', cheque_number: '123456', sayad_id: '1234567890123456', bank_code: 'mellat', amount_minor: 50_000_000n, currency_code: 'IRR', due_date_at: jNoon(1405, 9, 15), counterparty_name: 'آقای رضایی', account_id: a.id, reminder_days: [3, 1, 0], notes: '' });
  const loan = await createLoan(db, { title: 'وام مسکن', lender_name: 'مسکن', principal_minor: 120_000_000n, interest_rate_bps: 1800, installment_count: 12, first_due_at: jNoon(1405, 9, 1), account_id: a.id, currency_code: 'IRR', calendar: 'jalali', post_disbursement: true, notes: '' });
  const inst = (await db.find('loan_installments', { loan_id: loan.id }))[0]!;
  await payInstallment(db, inst.id);
  const person = await createPerson(db, { name: 'علی', phone: '09121234567', notes: '' });
  const debt = await createDebt(db, { person_id: person.id, direction: 'lent', amount_minor: 10_000_000n, currency_code: 'IRR', due_date_at: null, account_id: a.id, post_opening: true, note: '' });
  await settleDebt(db, debt.id, 4_000_000n, a.id);
  await saveBudget(db, { category_id: 'cat_grocery', period: 'monthly_jalali', limit_minor: 80_000_000n, currency_code: 'IRR', alert_thresholds_json: [80, 100], rollover_unused: false, is_active: true });
  await saveGoal(db, { name: 'سفر', target_minor: 10_000_000n, current_minor: 1_000n, currency_code: 'IRR', linked_account_id: null, deadline_at: null, icon_name: 'plane', color_hex: '#26C6DA' });
  await saveRule(db, { name: 'ملت', bank_code: 'mellat', sender_patterns_json: [], body_regex: 'مبلغ (\\d+)', type_hint: 'debit', field_map_json: { amount: 1 }, unit_hint: 'irr', priority: 1, is_enabled: true });
  await confirmSender(db, '9830001', 'mellat');
  const profile = await saveProfile(db, { ...emptyProfile(), name: 'استودیو آریزو', invoice_prefix: 'ARZ' });
  const logo = await saveImageAttachment(db, { owner_type: 'business_profile', owner_id: profile.id }, PNG);
  await saveProfile(db, { ...emptyProfile(), name: 'استودیو آریزو', invoice_prefix: 'ARZ', logo_attachment_id: logo.id });
  const cust = await saveCustomer(db, { name: 'شرکت نمونه', national_id: '', economic_code: '', address: '', phone: '' });
  await saveProduct(db, { name: 'طراحی', unit: 'ساعت', unit_price_minor: 5_000_000n, currency_code: 'IRR' });
  const { invoice } = await saveInvoice(db, { kind: 'invoice', customer_id: cust.id, issued_at: jNoon(1405, 8, 29), due_at: null, currency_code: 'IRR', discount_minor: 0n, vat_bps: 1000, template: 'official', notes: '', items: [{ product_id: null, description: 'لوگو', quantity_milli: 1500n, unit_price_minor: 25_000_000n, discount_minor: 0n }], issue: true });
  await postInvoicePayment(db, invoice.id, { account_id: a.id, amount_minor: 10_000_000n });
  await db.put('settings', { id: 'prefs', created_at: now, updated_at: now, deleted_at: null, value_json: { theme: 'obsidian', nested: { n: 1 } } });
  await db.put('app_audit_log', { id: uuidv7(), created_at: now, updated_at: now, deleted_at: null, event: 'unlock', detail: '' });
}

async function dump(db: IVaultDatabase) {
  const stores = {} as Record<StoreName, unknown[]>;
  for (const s of STORE_NAMES) {
    const rows = (await db.find(s)).filter((r) => !(s === 'settings' && ['backup_state', 'backup_snapshots'].includes(r.id)) && !(s === 'app_audit_log' && String((r as { event: string }).event).startsWith('backup_')));
    stores[s] = rows.sort((x, y) => (x.id < y.id ? -1 : 1));
  }
  const blobs: Record<string, Uint8Array | undefined> = {};
  for (const a of await db.find('attachments')) blobs[a.encrypted_blob_key] = await db.getBlob(a.encrypted_blob_key);
  return { stores, blobs };
}

describe.each(ADAPTERS)('.arizo backup on %s', (_name, make) => {
  it('fills all 26 stores + blobs, backs up, wipes, restores with 100% fidelity', async () => {
    const db = await make();
    await fillVault(db);
    const original = await dump(db);
    for (const s of STORE_NAMES) expect(original.stores[s].length, s).toBeGreaterThan(0);
    expect(Object.keys(original.blobs)).toHaveLength(2);

    const { bytes, manifest } = await createBackup(db, PASS, deps);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('ARZO');
    expect(new TextDecoder().decode(bytes)).not.toContain('افق'); // nothing readable in the file
    expect(manifest.blobs).toBe(2);
    expect((await db.find('app_audit_log', { event: 'backup_created' })).map((r) => r.detail)).toEqual(['file']);

    await db.clearAll();
    expect(await db.count('transactions')).toBe(0);

    const snap = await inspectBackup(bytes, pass(), directEngine);
    expect(snap.manifest.counts.transactions).toBe(original.stores.transactions.length);
    expect(await db.count('transactions')).toBe(0); // the dry run wrote nothing

    await restoreBackup(db, snap, 'replace', deps);
    expect(await dump(db)).toEqual(original);
    expect((await verifyLedger(db)).drift).toEqual([]);
    expect((await db.find('app_audit_log', { event: 'backup_restored' })).map((r) => r.detail)).toEqual(['replace']);
    await db.close();
  });

  it('Safe Replace stores a pre-restore safety snapshot that brings the old vault back', async () => {
    const db = await make();
    await fillVault(db);
    const before = await dump(db);
    const other = await makeWebVault();
    await acct(other, 'فقط این');
    const file = (await createBackup(other, PASS, deps)).bytes;
    const res = await restoreBackup(db, await inspectBackup(file, pass(), directEngine), 'replace', deps);
    expect((await db.find('accounts')).map((a) => a.name)).toEqual(['فقط این']);
    expect(await db.find('attachments')).toEqual([]);
    await restoreBackup(db, await loadSnapshot(db, res.safetySnapshotId, directEngine), 'replace', deps);
    expect(await dump(db)).toEqual(before);
  });

  it('a restore that fails part-way leaves the vault untouched (rows and blobs)', async () => {
    const db = await make();
    await fillVault(db);
    const before = await dump(db);
    const snap = await takeSnapshot(db, 'web');
    // Two incoming transactions with the same SMS fingerprint: the atomic batch must fail on UNIQUE.
    const t = snap.stores.transactions[0]!;
    snap.stores.transactions.push({ ...t, id: uuidv7(), sms_fingerprint_sha256: 'e'.repeat(64) }, { ...t, id: uuidv7(), sms_fingerprint_sha256: 'e'.repeat(64) });
    snap.manifest.counts.transactions += 2;
    snap.stores.accounts = snap.stores.accounts.slice(1);
    await expect(restoreBackup(db, snap, 'replace', deps)).rejects.toThrow();
    expect(await dump(db)).toEqual(before);
  });

  it('Smart Merge dedups by UUID, keeps UNIQUE fields unique and rebalances', async () => {
    const db = await make();
    const a = await acct(db, 'ملت', 'IRR', 1_000_000n);
    await createTransaction(db, { account_id: a.id, type: 'expense', amount_minor: 100n, occurred_at: 1, sms_fingerprint_sha256: 'a'.repeat(64) });
    await saveProfile(db, { ...emptyProfile(), name: 'A', invoice_prefix: 'ARZ' });
    await saveInvoice(db, { kind: 'invoice', customer_id: null, issued_at: jNoon(1405, 8, 29), due_at: null, currency_code: 'IRR', discount_minor: 0n, vat_bps: 0, template: 'minimal', notes: '', items: [{ product_id: null, description: 'x', quantity_milli: 1000n, unit_price_minor: 10n, discount_minor: 0n }], issue: true });
    const file = (await createBackup(db, PASS, deps)).bytes;

    // Meanwhile on this device: a newer transaction.
    await createTransaction(db, { account_id: a.id, type: 'income', amount_minor: 5_000n, occurred_at: 2 });
    const snap = await inspectBackup(file, pass(), directEngine);
    // Rows from another device with clashing UNIQUE values but different ids.
    const tx0 = snap.stores.transactions.find((t) => t.sms_fingerprint_sha256)!;
    const dupTx = { ...tx0, id: uuidv7() };
    snap.stores.transactions.push(dupTx);
    snap.stores.transaction_splits.push({ id: uuidv7(), created_at: 1, updated_at: 1, deleted_at: null, transaction_id: dupTx.id, category_id: 'cat_food', amount_minor: 100n, note: '' } as never);
    const inv0 = snap.stores.invoices[0]!;
    snap.stores.invoices.push({ ...inv0, id: uuidv7() });
    const r = await restoreBackup(db, snap, 'merge', deps);
    expect(r.merge).toMatchObject({ skipped: 2, renumbered: 1, added: 1 });
    expect((await db.find('invoices')).map((i) => i.number).sort()).toEqual([inv0.number, `${inv0.number}-2`]);
    expect(await db.find('transactions', { sms_fingerprint_sha256: 'a'.repeat(64) })).toHaveLength(1);
    expect(await db.find('transactions')).toHaveLength(2); // nothing duplicated by UUID
    expect(await db.find('transaction_splits')).toHaveLength(0); // the skipped tx's split was skipped too
    expect((await verifyLedger(db)).drift).toEqual([]);
    expect((await db.get('accounts', a.id))!.current_balance_minor).toBe(1_000_000n - 100n + 5_000n);
  });

  it('rolling auto-snapshots: one a day, only the last N kept, restorable', async () => {
    const db = await make();
    expect(await maybeAutoSnapshot(db, deps)).toBeNull(); // empty vault: nothing to protect yet
    await fillVault(db);
    const day = 86_400_000;
    const t0 = Date.now();
    const made = [];
    for (let i = 0; i < KEEP_SNAPSHOTS + 2; i++) made.push(await maybeAutoSnapshot(db, { ...deps, now: t0 + i * day }));
    expect(made.every(Boolean)).toBe(true);
    expect(await maybeAutoSnapshot(db, { ...deps, now: t0 + (KEEP_SNAPSHOTS + 1) * day + 1000 })).toBeNull();
    const list = await listSnapshots(db);
    expect(list).toHaveLength(KEEP_SNAPSHOTS);
    expect(await db.getBlob(made[0]!.id)).toBeUndefined(); // rolled off and deleted
    const snap = await loadSnapshot(db, list[0]!.id, directEngine);
    expect(snap.manifest.counts.transactions).toBe(await db.count('transactions'));
  });
});

describe('cross-adapter .arizo', () => {
  it.each([
    ['SQL → web', makeSqlVault, makeWebVault],
    ['web → SQL', makeWebVault, makeSqlVault],
  ] as const)('%s restores with 100%% fidelity', async (_n, from, to) => {
    const src = await from();
    await fillVault(src);
    const original = await dump(src);
    const file = (await createBackup(src, PASS, { ...deps, platform: 'android' })).bytes;
    const dst = await to();
    await restoreBackup(dst, await inspectBackup(file, pass(), directEngine), 'replace', deps);
    expect(await dump(dst)).toEqual(original);
  });
});

describe('tamper and secret checks (nothing is written)', async () => {
  const src = await makeWebVault();
  await fillVault(src);
  const file = (await createBackup(src, PASS, deps)).bytes;
  const h = readHeader(file);
  const flip = (at: number, bit = 1) => {
    const c = file.slice();
    c[at]! ^= bit;
    return c;
  };
  const open = (f: Uint8Array) => () => inspectBackup(f, pass(), directEngine);

  const cases: [string, () => Promise<unknown>, string][] = [
    ['wrong passphrase', () => inspectBackup(file, pass('wrong passphrase 123'), directEngine), 'BACKUP_AUTH'],
    ['1 bit in the ciphertext', open(flip(h.bodyOffset + 40)), 'BACKUP_AUTH'],
    ['1 bit in the tag', open(flip(file.length - 1, 0x80)), 'BACKUP_AUTH'],
    ['1 bit in the salt (header)', open(flip(20)), 'BACKUP_AUTH'],
    ['1 bit in Argon2 t (header)', open(flip(13, 2)), 'BACKUP_AUTH'],
    ['1 bit in the slot count (header)', open(flip(31, 2)), 'BACKUP_FORMAT'],
    ['1 bit in the wrapped key (header)', open(flip(40)), 'BACKUP_AUTH'],
    ['1 bit in the body nonce (header)', open(flip(h.bodyOffset - 1)), 'BACKUP_AUTH'],
    ['1 bit in the magic', open(flip(0)), 'BACKUP_FORMAT'],
    ['1 bit in the version', open(flip(4, 2)), 'BACKUP_VERSION'],
    ['truncated body', open(file.slice(0, file.length - 100)), 'BACKUP_AUTH'],
    ['truncated to the tag', open(file.slice(0, h.bodyOffset + 15)), 'BACKUP_FORMAT'],
    ['truncated header', open(file.slice(0, 40)), 'BACKUP_FORMAT'],
    ['empty file', open(new Uint8Array(0)), 'BACKUP_FORMAT'],
    ['recovery key on a file without one', async () => inspectBackup(file, { kind: 'recovery', entropy: (await generateRecoveryKey()).entropy }, directEngine), 'BACKUP_NO_RECOVERY'],
  ];
  it.each(cases)('%s fails cleanly', async (_n, run, code) => {
    const dst = await makeSqlVault();
    const err = await run().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BackupError);
    expect((err as BackupError).code).toBe(code);
    for (const s of STORE_NAMES) expect(await dst.count(s)).toBe(0);
  });

  it('the passphrase buffer is zeroized after use', async () => {
    const s = pass();
    await inspectBackup(file, s, directEngine);
    expect(s.bytes.every((b) => b === 0)).toBe(true);
  });
});

describe('24-word Recovery Key', () => {
  it('matches BIP-39 encoding, rejects typos and a bad checksum, and opens the same file', async () => {
    // BIP-39 test vectors (256-bit entropy).
    expect((await recoveryWords(new Uint8Array(32))).join(' ')).toBe(`${'abandon '.repeat(23)}art`);
    expect((await recoveryWords(new Uint8Array(32).fill(0xff))).join(' ')).toBe(`${'zoo '.repeat(23)}vote`);

    const { entropy, words } = await generateRecoveryKey();
    expect(words).toHaveLength(24);
    expect(await recoveryWords(entropy)).toEqual(words);
    expect(await parseRecoveryKey(`  ${words.join('  ').toUpperCase()} `)).toEqual(entropy);
    expect(await parseRecoveryKey(words.slice(0, 23).join(' '))).toBeNull();
    expect(await parseRecoveryKey([...words.slice(0, 23), 'notaword'].join(' '))).toBeNull();
    expect(await parseRecoveryKey(`${'abandon '.repeat(24)}`)).toBeNull(); // checksum mismatch

    const db = await makeWebVault();
    await acct(db, 'x');
    await saveRecovery(db, entropy.slice());
    const file = (await createBackup(db, PASS, deps)).bytes;
    expect(readHeader(file).slots.map((s) => s.kind)).toEqual(['passphrase', 'recovery']);
    expect((await db.find('app_audit_log', { event: 'backup_created' }))[0]!.detail).toBe('file+recovery');
    const viaWords = await inspectBackup(file, { kind: 'recovery', entropy: (await parseRecoveryKey(words.join(' ')))! }, directEngine);
    const viaPass = await inspectBackup(file, pass(), directEngine);
    expect(viaWords.manifest).toEqual(viaPass.manifest);
    await expect(inspectBackup(file, { kind: 'recovery', entropy: (await generateRecoveryKey()).entropy }, directEngine)).rejects.toThrow('BACKUP_AUTH');
  });
});

describe('passphrase strength and reminders', () => {
  it('scores passphrases conservatively', () => {
    for (const p of ['', '123456', 'password123', 'aaaaaaaaaaaa', 'qwertyuiop12', '1234567890']) expect(acceptablePassphrase(p), p).toBe(false);
    for (const p of [PASS, 'correct horse battery staple', 'Tr0ub4dor&3-Zebra']) expect(acceptablePassphrase(p), p).toBe(true);
    expect(passphraseStrength('correct horse battery staple').score).toBeGreaterThanOrEqual(3);
  });

  it('reminds after the window, never on an empty vault; bookkeeping never travels in the file', async () => {
    const db = await makeWebVault();
    const s0 = await backupState(db);
    expect(s0.last_backup_at).toBeNull();
    expect(backupDue(s0, false)).toBe(false);
    expect(backupDue(s0, true)).toBe(true);
    await acct(db, 'x');
    const now = Date.now();
    await createBackup(db, PASS, { ...deps, now });
    const s1 = await backupState(db);
    expect(s1.last_backup_at).toBe(now);
    expect(backupDue(s1, true, now + 6 * 86_400_000)).toBe(false);
    expect(backupDue(s1, true, now + 7 * 86_400_000)).toBe(true);
    expect(backupDue({ ...s1, remind_days: 0 }, true, now + 99 * 86_400_000)).toBe(false);
    const snap = await inspectBackup((await createBackup(db, PASS, deps)).bytes, pass(), directEngine);
    expect(snap.stores.settings.some((r) => r.id === 'backup_state')).toBe(false);
  });

  it('saveSnapshot honours a custom keep count', async () => {
    const db = await makeSqlVault();
    await acct(db, 'x');
    const snap = await takeSnapshot(db, 'android');
    for (let i = 0; i < 3; i++) await saveSnapshot(db, snap, 'auto', directEngine, Date.now() + i, 2);
    expect(await listSnapshots(db)).toHaveLength(2);
  });
});
