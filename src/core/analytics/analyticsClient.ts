// Promise RPC to the analytics worker. Terminated on lock with the crypto and SMS workers.
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import type { AnalyticsInput, AnalyticsOptions, AnalyticsReport } from './engine';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: AnalyticsReport) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./analytics.worker.ts', import.meta.url), { type: 'module', name: 'arizo-analytics' });
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: AnalyticsReport }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok && e.data.result) p.resolve(e.data.result);
    else p.reject(new Error('analytics failed'));
  };
  return worker;
}

export async function loadAnalyticsInput(db: IVaultDatabase): Promise<AnalyticsInput> {
  const [accounts, transactions, splits, categories, rates, budgets, goals, debts, settlements, installments] = await Promise.all([
    db.find('accounts'),
    db.find('transactions'),
    db.find('transaction_splits'),
    db.find('categories'),
    db.find('exchange_rates'),
    db.find('budgets'),
    db.find('savings_goals'),
    db.find('debts_receivables'),
    db.find('debt_settlements'),
    db.find('loan_installments'),
  ]);
  return { accounts, transactions, splits, categories, rates, budgets, goals, debts, settlements, installments };
}

export const runAnalytics = (input: AnalyticsInput, o: AnalyticsOptions): Promise<AnalyticsReport> =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, input, o });
  });

export function terminateAnalyticsWorker(): void {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error('locked'));
  pending.clear();
}
