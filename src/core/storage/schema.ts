// The 18 entities of PROMPT.md §4.1. Money fields are bigint minor units; times are UTC epoch ms.
// This file is the single schema both adapters (SQLCipher, encrypted Dexie) and the .arizo codec use.
import type { CurrencyCode } from '../currency/money';

export type Id = string; // UUIDv7
export type Millis = number;

export interface Base {
  id: Id;
  created_at: Millis;
  updated_at: Millis;
  deleted_at: Millis | null;
}

export type AccountType = 'bank_card' | 'bank_account' | 'cash' | 'savings_vault' | 'investment' | 'crypto' | 'gold' | 'wallet';
export type CardFinish =
  | 'obsidian_carbon'
  | 'emerald_silk'
  | 'champagne_titanium'
  | 'midnight_sapphire'
  | 'velvet_burgundy'
  | 'alabaster_pearl';

export interface Account extends Base {
  name: string;
  type: AccountType;
  bank_code: string | null;
  card_last4: string | null;
  /** Full PAN, sealed under a field key on top of record encryption; never shown without re-auth. */
  card_number_enc: string | null;
  account_number: string | null;
  iban_sheba: string | null;
  currency_code: CurrencyCode;
  initial_balance_minor: bigint;
  current_balance_minor: bigint;
  card_finish: CardFinish;
  is_included_in_net_worth: boolean;
  is_archived: boolean;
  sort_order: number;
  notes: string;
}

export type CategoryType = 'income' | 'expense' | 'transfer';
export interface Category extends Base {
  parent_id: Id | null;
  name_fa: string;
  name_en: string;
  type: CategoryType;
  icon_name: string;
  color_hex: string;
  is_system: boolean;
  sort_order: number;
}

export type TxType = 'income' | 'expense' | 'transfer_out' | 'transfer_in' | 'adjustment';
export type TxSource =
  | 'manual'
  | 'sms_auto'
  | 'notification_auto'
  | 'ios_shortcut'
  | 'paste_parse'
  | 'recurring'
  | 'invoice'
  | 'cheque'
  | 'loan'
  | 'debt'
  | 'csv_import';
export type TxStatus = 'posted' | 'pending_review' | 'voided';
export type LinkedEntityType = 'cheque' | 'loan_installment' | 'debt_settlement' | 'invoice' | 'recurring_rule';

export interface Transaction extends Base {
  account_id: Id;
  transfer_pair_id: Id | null;
  counterparty_account_id: Id | null;
  type: TxType;
  /** Positive for every type except `adjustment`, which is the signed delta applied to the balance. */
  amount_minor: bigint;
  currency_code: CurrencyCode;
  exchange_rate_to_base_ppm: bigint | null;
  category_id: Id | null;
  merchant_name: string;
  note: string;
  occurred_at: Millis;
  source: TxSource;
  external_ref_code: string | null;
  sms_fingerprint_sha256: string | null;
  reported_balance_after_minor: bigint | null;
  linked_entity_type: LinkedEntityType | null;
  linked_entity_id: Id | null;
  status: TxStatus;
}

export interface TransactionSplit extends Base {
  transaction_id: Id;
  category_id: Id;
  amount_minor: bigint;
  note: string;
}

export interface Tag extends Base {
  name: string;
  color_hex: string;
}
export interface TransactionTag extends Base {
  transaction_id: Id;
  tag_id: Id;
}

export interface Attachment extends Base {
  owner_type: 'transaction' | 'business_profile' | 'cheque' | 'invoice';
  owner_id: Id;
  encrypted_blob_key: string;
  nonce_b64: string;
  mime_type: string;
  original_size_bytes: number;
  sha256_hash: string;
}

export type ChequeStatus = 'pending' | 'cleared' | 'bounced' | 'cancelled' | 'transferred';
export interface Cheque extends Base {
  direction: 'issued' | 'received';
  cheque_number: string;
  sayad_id: string;
  bank_code: string | null;
  amount_minor: bigint;
  currency_code: CurrencyCode;
  due_date_at: Millis;
  counterparty_name: string;
  account_id: Id | null;
  status: ChequeStatus;
  linked_tx_id: Id | null;
  reminder_days_json: number[];
  notes: string;
}

export interface Loan extends Base {
  title: string;
  lender_name: string;
  principal_minor: bigint;
  interest_rate_bps: number;
  installment_count: number;
  installment_amount_minor: bigint;
  start_date_at: Millis;
  account_id: Id | null;
  currency_code: CurrencyCode;
  notes: string;
  status: 'active' | 'paid_off';
}
export interface LoanInstallment extends Base {
  loan_id: Id;
  sequence_no: number;
  due_date_at: Millis;
  amount_minor: bigint;
  status: 'upcoming' | 'paid' | 'overdue';
  paid_at: Millis | null;
  paid_tx_id: Id | null;
}

export interface Person extends Base {
  name: string;
  phone: string | null;
  notes: string;
}
export interface DebtReceivable extends Base {
  person_id: Id;
  /** lent = they owe me; borrowed = I owe them. */
  direction: 'lent' | 'borrowed';
  amount_minor: bigint;
  currency_code: CurrencyCode;
  due_date_at: Millis | null;
  account_id: Id | null;
  status: 'open' | 'settled';
  note: string;
}
export interface DebtSettlement extends Base {
  debt_id: Id;
  amount_minor: bigint;
  account_id: Id;
  settled_at: Millis;
  tx_id: Id | null;
}

export interface Budget extends Base {
  category_id: Id | null;
  period: 'weekly' | 'monthly_jalali' | 'monthly_gregorian' | 'custom';
  limit_minor: bigint;
  currency_code: CurrencyCode;
  alert_thresholds_json: number[];
  rollover_unused: boolean;
  is_active: boolean;
}

export interface SavingsGoal extends Base {
  name: string;
  target_minor: bigint;
  current_minor: bigint;
  currency_code: CurrencyCode;
  linked_account_id: Id | null;
  deadline_at: Millis | null;
  icon_name: string;
  color_hex: string;
}

export type Cadence = 'daily' | 'weekly' | 'monthly_jalali' | 'monthly_gregorian' | 'yearly';
export interface RecurringRule extends Base {
  title: string;
  type: 'income' | 'expense';
  account_id: Id;
  category_id: Id | null;
  amount_minor: bigint;
  currency_code: CurrencyCode;
  cadence: Cadence;
  day_of_period: number;
  next_run_at: Millis;
  auto_post: boolean;
  is_active: boolean;
}

export interface SmsParserRule extends Base {
  name: string;
  bank_code: string | null;
  sender_patterns_json: string[];
  body_regex: string;
  type_hint: 'debit' | 'credit' | 'auto';
  field_map_json: Record<string, number>;
  unit_hint: 'irr' | 'irt' | 'auto';
  priority: number;
  is_custom: boolean;
  verified: boolean;
  is_enabled: boolean;
}

/** The normalized merchant is the primary key, so `id` holds it. */
export interface MerchantCategoryMemory extends Base {
  category_id: Id;
  hit_count: number;
}

export interface BusinessProfile extends Base {
  name: string;
  national_id: string;
  economic_code: string;
  address: string;
  phone: string;
  logo_attachment_id: Id | null;
  signature_attachment_id: Id | null;
  default_vat_bps: number;
  invoice_prefix: string;
}
export interface Customer extends Base {
  name: string;
  national_id: string;
  economic_code: string;
  address: string;
  phone: string;
}
export interface Product extends Base {
  name: string;
  unit: string;
  unit_price_minor: bigint;
  currency_code: CurrencyCode;
}
export interface Invoice extends Base {
  number: string;
  kind: 'invoice' | 'proforma';
  customer_id: Id | null;
  issued_at: Millis;
  due_at: Millis | null;
  currency_code: CurrencyCode;
  discount_minor: bigint;
  vat_bps: number;
  status: 'draft' | 'unpaid' | 'partial' | 'paid';
  paid_minor: bigint;
  linked_tx_id: Id | null;
  template: 'minimal' | 'official' | 'bold' | 'thermal';
  notes: string;
}
export interface InvoiceItem extends Base {
  invoice_id: Id;
  product_id: Id | null;
  description: string;
  /** Quantity in thousandths (1 unit = 1000) so fractional quantities stay exact. */
  quantity_milli: bigint;
  unit_price_minor: bigint;
  discount_minor: bigint;
  sort_order: number;
}

export interface ExchangeRate extends Base {
  base_currency: CurrencyCode;
  quote_currency: CurrencyCode;
  rate_ppm: bigint;
  effective_at: Millis;
}

/** Settings keyed by `id` (the setting name). */
export interface Setting extends Base {
  value_json: unknown;
}

export type AuditEvent =
  | 'unlock'
  | 'failed_pin'
  | 'duress_triggered'
  | 'backup_created'
  | 'backup_restored'
  | 'sms_rule_changed'
  | 'lockout'
  | 'pin_changed'
  | 'integrity_check';
/** Never holds amounts or PII. */
export interface AuditLog extends Base {
  event: AuditEvent;
  detail: string;
}

/** Store name → row type. The single registry for adapters, migrations, backup and tests. */
export interface StoreMap {
  accounts: Account;
  categories: Category;
  transactions: Transaction;
  transaction_splits: TransactionSplit;
  tags: Tag;
  transaction_tags: TransactionTag;
  attachments: Attachment;
  cheques: Cheque;
  loans: Loan;
  loan_installments: LoanInstallment;
  people: Person;
  debts_receivables: DebtReceivable;
  debt_settlements: DebtSettlement;
  budgets: Budget;
  savings_goals: SavingsGoal;
  recurring_rules: RecurringRule;
  sms_parser_rules: SmsParserRule;
  merchant_category_memory: MerchantCategoryMemory;
  business_profile: BusinessProfile;
  customers: Customer;
  products: Product;
  invoices: Invoice;
  invoice_items: InvoiceItem;
  exchange_rates: ExchangeRate;
  settings: Setting;
  app_audit_log: AuditLog;
}
export type StoreName = keyof StoreMap;

/**
 * Equality-indexed fields per store. The web adapter stores these only as opaque HMAC tags;
 * the SQLCipher adapter indexes the real column (the whole DB file is encrypted).
 */
export const INDEXED: { [K in StoreName]: readonly (keyof StoreMap[K] & string)[] } = {
  accounts: [],
  categories: ['parent_id', 'type'],
  transactions: ['account_id', 'transfer_pair_id', 'category_id', 'status', 'sms_fingerprint_sha256', 'linked_entity_id'],
  transaction_splits: ['transaction_id'],
  tags: [],
  transaction_tags: ['transaction_id', 'tag_id'],
  attachments: ['owner_id'],
  cheques: ['status', 'account_id'],
  loans: ['status'],
  loan_installments: ['loan_id', 'status'],
  people: [],
  debts_receivables: ['person_id', 'status'],
  debt_settlements: ['debt_id'],
  budgets: ['category_id'],
  savings_goals: [],
  recurring_rules: ['account_id'],
  sms_parser_rules: ['bank_code'],
  merchant_category_memory: [],
  business_profile: [],
  customers: [],
  products: [],
  invoices: ['status', 'customer_id', 'number'],
  invoice_items: ['invoice_id'],
  exchange_rates: ['base_currency', 'quote_currency'],
  settings: [],
  app_audit_log: ['event'],
};

/** Fields that must be unique when non-null. Each must also be in INDEXED. */
export const UNIQUE: Partial<{ [K in StoreName]: readonly (keyof StoreMap[K] & string)[] }> = {
  transactions: ['sms_fingerprint_sha256'],
  invoices: ['number'],
};

export const STORE_NAMES = Object.keys(INDEXED) as StoreName[];
