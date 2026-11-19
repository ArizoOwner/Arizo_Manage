// Re-plan and re-apply reminders from the vault. Called after unlock and after obligation edits.
import i18n from '../i18n/i18n';
import { formatMoney } from '../i18n/format';
import { startOfDay } from '../calendar/calendar';
import type { CurrencyCode } from '../currency/money';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import { useSettings } from '../../app/stores/settings';
import { refreshOverdue } from './loans';
import { planReminders } from './reminders';
import { applyReminders } from './scheduler';

export async function syncObligations(db: IVaultDatabase, now = Date.now()): Promise<void> {
  await refreshOverdue(db, now);
  const { reminders, detailedNotifications, lang, irrUnit } = useSettings.getState();
  const [cheques, loans, installments, debts, people] = await Promise.all([db.find('cheques'), db.find('loans'), db.find('loan_installments'), db.find('debts_receivables'), db.find('people')]);
  const t = i18n.getFixedT(lang);
  const plan = planReminders(
    { cheques, loans, installments, debts, people },
    {
      now,
      startOfDay: (ms) => startOfDay(ms),
      detailed: detailedNotifications,
      formatAmount: (m, c) => formatMoney(m, c as CurrencyCode, lang, irrUnit),
      text: {
        genericTitle: t('reminders.genericTitle'),
        genericBody: t('reminders.genericBody'),
        cheque: (d, who, amt) => t('reminders.cheque', { count: d, who, amt }),
        installment: (d, title, amt) => t('reminders.installment', { count: d, title, amt }),
        debt: (d, who, amt) => t('reminders.debt', { count: d, who, amt }),
      },
    },
  );
  await applyReminders(plan, reminders).catch(() => 0);
}
