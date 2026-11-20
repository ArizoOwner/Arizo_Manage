// Promise RPC to the SMS worker; a Parser for ingestMany. Terminated on lock with the crypto worker.
import type { Parser } from './ingest';
import type { ParseResult } from './parser';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: ParseResult[]) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./sms.worker.ts', import.meta.url), { type: 'module', name: 'arizo-sms' });
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: ParseResult[] }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok && e.data.result) p.resolve(e.data.result);
    else p.reject(new Error('sms parse failed'));
  };
  return worker;
}

export const workerParser: Parser = (texts, o) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, texts, o });
  });

export function terminateSmsWorker(): void {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error('locked'));
  pending.clear();
}
