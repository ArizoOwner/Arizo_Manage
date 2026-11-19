import data from './banks.json';
import { onlyDigits } from '../utils/digits';

export interface BankInfo {
  code: string;
  name_fa: string;
  name_en: string;
  bins: string[];
  issuer?: string;
  /** Android package names for the notification listener (Phase 5). Empty until the user picks the app. */
  android_packages?: string[];
  sms_senders: string[];
  verified: boolean;
  kind: 'bank' | 'neobank' | 'intl';
  color: string;
}

export const BANKS: readonly BankInfo[] = data.banks as BankInfo[];
const byCode = new Map(BANKS.map((b) => [b.code, b]));

export const bankByCode = (code: string | null | undefined): BankInfo | undefined => (code ? byCode.get(code) : undefined);

/** Detect the issuing bank from a card number's prefix (longest matching BIN wins). */
export function detectBankByCard(card: string): BankInfo | undefined {
  const d = onlyDigits(card);
  if (d.length < 6) return undefined;
  let best: BankInfo | undefined;
  let bestLen = 0;
  for (const b of BANKS) {
    for (const bin of b.bins) {
      if (d.startsWith(bin) && bin.length > bestLen) {
        best = b;
        bestLen = bin.length;
      }
    }
  }
  return best;
}
