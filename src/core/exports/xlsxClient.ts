// One-shot worker per export: the workbook lives in the worker only for as long as it is being built.
import type { Sheet } from './xlsx';

let live: Worker | null = null;

export function xlsxInWorker(sheets: Sheet[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./xlsx.worker.ts', import.meta.url), { type: 'module', name: 'arizo-xlsx' });
    live = w;
    w.onmessage = (e: MessageEvent<{ ok: boolean; bytes?: Uint8Array }>) => {
      w.terminate();
      live = null;
      if (e.data.ok && e.data.bytes) resolve(e.data.bytes);
      else reject(new Error('XLSX_FAILED'));
    };
    w.onerror = () => {
      w.terminate();
      live = null;
      reject(new Error('XLSX_FAILED'));
    };
    w.postMessage({ id: 1, sheets });
  });
}

/** Called on lock: an export in flight is abandoned with the session. */
export function terminateXlsxWorker(): void {
  live?.terminate();
  live = null;
}
