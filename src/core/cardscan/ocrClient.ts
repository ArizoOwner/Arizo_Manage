// Promise RPC to the OCR worker. One worker per scan session: `endOcr` (scan closed, vault locked or
// wiped) terminates it, so no frame or recognised text outlives the scanner sheet.
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: { text: string; conf: number }) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module', name: 'arizo-ocr' });
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; text?: string; conf?: number; why?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve({ text: e.data.text ?? '', conf: e.data.conf ?? 0 });
    else p.reject(new Error(e.data.why ? `ocr failed: ${e.data.why}` : 'ocr failed'));
  };
  worker.onerror = () => endOcr();
  return worker;
}

/** Recognise one PNG frame (the bytes are transferred, not copied). */
export function recognize(png: ArrayBuffer): Promise<{ text: string; conf: number }> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, png }, [png]);
  });
}

export function endOcr(): void {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error('closed'));
  pending.clear();
}
