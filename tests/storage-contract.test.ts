// One contract, two adapters: every assertion runs against both (PROMPT.md §2.1).
import { describe, expect, it } from 'vitest';
import { ADAPTERS, makeWebVault } from './helpers/vaults';
import { UniqueViolation, type IVaultDatabase } from '../src/core/storage/IVaultDatabase';
import { STORE_NAMES, type Transaction } from '../src/core/storage/schema';
import { newAccount } from '../src/core/ledger/ledger';
import { seedCategories, SEED_CATEGORIES } from '../src/core/data/seedCategories';
import { uuidv7 } from '../src/core/utils/uuidv7';
import { td } from '../src/core/crypto/bytes';

const acct = (name = 'Melli', balance = 0n) =>
  newAccount({
    name,
    type: 'bank_card',
    bank_code: 'melli',
    card_last4: '1234',
    card_number_enc: null,
    account_number: null,
    iban_sheba: 'IR062960000000100324200001',
    currency_code: 'IRR',
    initial_balance_minor: balance,
    card_finish: 'obsidian_carbon',
    is_included_in_net_worth: true,
    is_archived: false,
    sort_order: 0,
    notes: 'یادداشت',
  });

const tx = (account_id: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: uuidv7(),
  created_at: 1,
  updated_at: 1,
  deleted_at: null,
  account_id,
  transfer_pair_id: null,
  counterparty_account_id: null,
  type: 'expense',
  amount_minor: 12_450_000_000n,
  currency_code: 'IRR',
  exchange_rate_to_base_ppm: null,
  category_id: 'cat_food',
  merchant_name: 'اسنپ‌فود',
  note: '',
  occurred_at: 1,
  source: 'manual',
  external_ref_code: null,
  sms_fingerprint_sha256: null,
  reported_balance_after_minor: null,
  linked_entity_type: null,
  linked_entity_id: null,
  status: 'posted',
  ...extra,
});

describe.each(ADAPTERS)('IVaultDatabase contract — %s', (_name, make) => {
  const fresh = (): Promise<IVaultDatabase> => make();

  it('covers all stores of the schema', async () => {
    const db = await fresh();
    for (const s of STORE_NAMES) expect(await db.count(s)).toBe(0);
    expect(STORE_NAMES.length).toBe(26); // 18 entity groups, 26 physical stores
  });

  it('put/get round-trips bigint, null, unicode, arrays and objects exactly', async () => {
    const db = await fresh();
    const a = acct('حساب ملی', 999_999_999_999_999n);
    await db.put('accounts', a);
    expect(await db.get('accounts', a.id)).toEqual(a);
    const s = { id: 'theme', created_at: 1, updated_at: 1, deleted_at: null, value_json: { nested: [1, 'دو', null] } };
    await db.put('settings', s);
    expect(await db.get('settings', 'theme')).toEqual(s);
    expect(await db.get('accounts', 'missing')).toBeUndefined();
  });

  it('put replaces by id; delete removes', async () => {
    const db = await fresh();
    const a = acct();
    await db.put('accounts', a);
    await db.put('accounts', { ...a, name: 'renamed' });
    expect((await db.get('accounts', a.id))?.name).toBe('renamed');
    expect(await db.count('accounts')).toBe(1);
    await db.delete('accounts', a.id);
    expect(await db.get('accounts', a.id)).toBeUndefined();
  });

  it('find filters by indexed equality, including null and multiple fields', async () => {
    const db = await fresh();
    const a = acct('A');
    const b = acct('B');
    await db.put('accounts', a);
    await db.put('accounts', b);
    await db.put('transactions', tx(a.id));
    await db.put('transactions', tx(a.id, { category_id: null }));
    await db.put('transactions', tx(b.id, { status: 'voided' }));
    expect((await db.find('transactions', { account_id: a.id })).length).toBe(2);
    expect((await db.find('transactions', { account_id: a.id, category_id: null })).length).toBe(1);
    expect((await db.find('transactions', { status: 'voided' })).map((t) => t.account_id)).toEqual([b.id]);
    expect((await db.find('transactions')).length).toBe(3);
    await expect(db.find('transactions', { merchant_name: 'x' } as never)).rejects.toThrow(/not indexed/);
  });

  it('transaction commits all writes atomically', async () => {
    const db = await fresh();
    const a = acct();
    await db.transaction(async (t) => {
      await t.put('accounts', a);
      await t.put('transactions', tx(a.id));
      expect(await t.get('accounts', a.id)).toEqual(a); // read-your-writes
      expect((await t.find('transactions', { account_id: a.id })).length).toBe(1);
    });
    expect(await db.count('transactions')).toBe(1);
  });

  it('transaction rolls back everything when it throws', async () => {
    const db = await fresh();
    const a = acct();
    await db.put('accounts', a);
    await expect(
      db.transaction(async (t) => {
        await t.put('accounts', { ...a, current_balance_minor: 1n });
        await t.put('transactions', tx(a.id));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await db.get('accounts', a.id))?.current_balance_minor).toBe(0n);
    expect(await db.count('transactions')).toBe(0);
  });

  it('nested transactions join the outer one', async () => {
    const db = await fresh();
    const a = acct();
    await expect(
      db.transaction(async () => {
        await db.transaction(async (t) => t.put('accounts', a));
        throw new Error('outer fails');
      }),
    ).rejects.toThrow();
    expect(await db.count('accounts')).toBe(0);
  });

  it('a concurrent write that starts mid-transaction never lands in a cleared batch', async () => {
    // Phase 9 regression: a write fired while another transaction was open (e.g. a background job
    // during a bulk seed) joined it, kept running after the commit and hit `staging = null`.
    const db = await fresh();
    const a = acct('A');
    const b = acct('B');
    const slow = db.transaction(async (t) => {
      await t.put('accounts', a);
      await new Promise((r) => setTimeout(r, 5));
    });
    const side = (async () => {
      await new Promise((r) => setTimeout(r, 1));
      await db.transaction(async (t) => {
        await new Promise((r) => setTimeout(r, 20)); // outlives the outer fn
        await t.put('accounts', b);
      });
    })();
    await Promise.all([slow, side]);
    expect((await db.find('accounts')).map((x) => x.name).sort()).toEqual(['A', 'B']);
  });

  it('enforces UNIQUE sms_fingerprint_sha256 (null allowed many times)', async () => {
    const db = await fresh();
    const a = acct();
    await db.put('accounts', a);
    await db.put('transactions', tx(a.id, { sms_fingerprint_sha256: 'fp1' }));
    await db.put('transactions', tx(a.id));
    await db.put('transactions', tx(a.id));
    await expect(db.put('transactions', tx(a.id, { sms_fingerprint_sha256: 'fp1' }))).rejects.toBeInstanceOf(UniqueViolation);
    await expect(
      db.transaction(async (t) => {
        await t.put('transactions', tx(a.id, { sms_fingerprint_sha256: 'fp2' }));
        await t.put('transactions', tx(a.id, { sms_fingerprint_sha256: 'fp2' }));
      }),
    ).rejects.toBeInstanceOf(UniqueViolation);
    expect(await db.count('transactions')).toBe(3);
  });

  it('re-putting the same row with its own unique value is not a clash', async () => {
    const db = await fresh();
    const a = acct();
    await db.put('accounts', a);
    const t1 = tx(a.id, { sms_fingerprint_sha256: 'fp' });
    await db.put('transactions', t1);
    await db.put('transactions', { ...t1, note: 'edited' });
    expect((await db.get('transactions', t1.id))?.note).toBe('edited');
  });

  it('seeds categories idempotently without overwriting user edits', async () => {
    const db = await fresh();
    expect(await seedCategories(db)).toBe(SEED_CATEGORIES.length);
    const food = (await db.get('categories', 'cat_food'))!;
    await db.put('categories', { ...food, name_fa: 'غذا' });
    expect(await seedCategories(db)).toBe(0);
    expect((await db.get('categories', 'cat_food'))?.name_fa).toBe('غذا');
  });

  it('clearAll empties every store; close locks the instance', async () => {
    const db = await fresh();
    await db.put('accounts', acct());
    await seedCategories(db);
    await db.clearAll();
    for (const s of STORE_NAMES) expect(await db.count(s)).toBe(0);
    await db.close();
    await expect(db.get('accounts', 'x')).rejects.toThrow(/locked/);
  });
});

describe('WebEncryptedDexieAdapter on-disk confidentiality', () => {
  it('stores no plaintext: ids and opaque tags only', async () => {
    const db = await makeWebVault();
    const a = acct('حساب سری', 777_777n);
    await db.put('accounts', a);
    await db.put('transactions', tx(a.id, { merchant_name: 'SECRETMERCHANT', sms_fingerprint_sha256: 'fp-visible?' }));
    for (const store of ['accounts', 'transactions'] as const) {
      for (const raw of await db.rawTable(store).toArray()) {
        const visible = JSON.stringify({ id: raw.id, ix: raw.ix, ux: raw.ux }) + td.decode(raw.c);
        for (const secret of ['حساب سری', '777777', 'SECRETMERCHANT', 'IR0629600', 'fp-visible?', a.id === raw.id ? '' : a.id, 'cat_food', 'expense']) {
          if (secret) expect(visible).not.toContain(secret);
        }
      }
    }
  });

  it('rejects a tampered row and a row moved to another id', async () => {
    const db = await makeWebVault();
    const a = acct();
    const b = acct('other');
    await db.put('accounts', a);
    await db.put('accounts', b);
    const t = db.rawTable('accounts');
    const rowA = (await t.get(a.id))!;
    const flipped = rowA.c.slice();
    flipped[20]! ^= 1;
    await t.put({ ...rowA, c: flipped });
    await expect(db.get('accounts', a.id)).rejects.toThrow(/decryption failed/);
    const rowB = (await t.get(b.id))!;
    await t.put({ ...rowB, id: 'swapped' });
    await expect(db.get('accounts', 'swapped')).rejects.toThrow(/decryption failed/);
  });
});
