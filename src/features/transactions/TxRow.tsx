// One ledger row: category dot, payee, account, signed amount. Shared by the dashboard and the ledger.
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { formatMoney } from '../../core/i18n/format';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import type { Account, Category, Transaction } from '../../core/storage/schema';

export interface TxRowProps {
  tx: Transaction;
  account: Account | undefined;
  counterparty: Account | undefined;
  category: Category | undefined;
  selected?: boolean;
  onClick?: () => void;
}

/**
 * "+۱۲۰٬۰۰۰ تومان": the sign and digits are isolated left-to-right so the sign always sits before the
 * digits, while the unit follows the page direction (left of the number in Persian, right in English).
 */
export function SignedMoney({ sign, text, className = '' }: { sign: 1 | -1; text: string; className?: string }) {
  const cut = text.lastIndexOf(' ');
  return (
    <span className={className}>
      <bdi dir="ltr">
        {sign > 0 ? '+' : '−'}
        {text.slice(0, cut)}
      </bdi>{' '}
      {text.slice(cut + 1)}
    </span>
  );
}

export function signOf(t: Transaction): 1 | -1 {
  if (t.type === 'income' || t.type === 'transfer_in') return 1;
  if (t.type === 'expense' || t.type === 'transfer_out') return -1;
  return t.amount_minor < 0n ? -1 : 1;
}

export function TxRow({ tx, account, counterparty, category, selected, onClick }: TxRowProps) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const irrUnit = useSettings((s) => s.irrUnit);
  const sign = signOf(tx);
  const abs = tx.amount_minor < 0n ? -tx.amount_minor : tx.amount_minor;
  const isTransfer = tx.type === 'transfer_in' || tx.type === 'transfer_out';
  const title = isTransfer
    ? t(tx.type === 'transfer_out' ? 'ledger.transferTo' : 'ledger.transferFrom', { a: counterparty?.name ?? '—' })
    : tx.merchant_name || (category ? (lang === 'fa' ? category.name_fa : category.name_en) : '—');
  const color = isTransfer ? 'text-azure-text' : sign > 0 ? 'text-emerald-text' : 'text-ink';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-2 text-start transition-colors hover:bg-surface-2 ${selected ? 'bg-surface-3' : ''}`}
      data-testid="tx-row"
    >
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl" style={{ background: `${category?.color_hex ?? '#4DA6FF'}22` }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: category?.color_hex ?? '#4DA6FF' }} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold text-ink">{title}</span>
        <span className="truncate text-[12px] text-ink-2">
          {account?.name ?? '—'}
          {tx.status === 'pending_review' && <span className="ms-2 text-amber-text">· {t('ledger.pending')}</span>}
        </span>
      </span>
      <PrivacyBlur>
        <SignedMoney className={`shrink-0 text-[15px] font-bold tabular ${color}`} sign={sign} text={formatMoney(abs, tx.currency_code, lang, irrUnit)} />
      </PrivacyBlur>
    </button>
  );
}
