/// <reference lib="webworker" />
// SMS parsing off the UI thread (historical scans and bulk pastes can be thousands of messages).
// Message text arrives, results go back; nothing is logged or kept here.
import { parseSms, type ParseOptions } from './parser';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<{ id: number; texts: string[]; o: ParseOptions }>) => {
  const { id, texts, o } = e.data;
  try {
    self.postMessage({ id, ok: true, result: texts.map((t) => parseSms(t, o)) });
  } catch {
    self.postMessage({ id, ok: false });
  }
};
