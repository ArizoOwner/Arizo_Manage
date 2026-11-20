/// <reference lib="webworker" />
// Analytics aggregation off the UI thread (PROMPT.md §1.6). Rows arrive decrypted via structured
// clone (bigint survives), the report goes back; nothing is kept or logged here.
import { computeAnalytics, type AnalyticsInput, type AnalyticsOptions } from './engine';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<{ id: number; input: AnalyticsInput; o: AnalyticsOptions }>) => {
  const { id, input, o } = e.data;
  try {
    self.postMessage({ id, ok: true, result: computeAnalytics(input, o) });
  } catch {
    self.postMessage({ id, ok: false });
  }
};
