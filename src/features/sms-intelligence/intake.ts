// App-side SMS intake: drains the Android sealed queue after unlock, decodes the iOS Shortcuts
// fragment, and routes everything through ingestMany (worker parser). Never logs message text.
import { mutate, useVault } from '../../app/stores/vault';
import { ArizoSecurity, ArizoSms, isNative } from '../../core/bridge/native';
import { ingestMany, type IncomingSms, type IngestOutcome } from '../../core/sms/ingest';
import { workerParser } from '../../core/sms/smsClient';
import { SecureLogger } from '../../core/utils/secureLogger';

export const ingest = (items: IncomingSms[]): Promise<IngestOutcome[]> => mutate((db) => ingestMany(db, items, workerParser));

/** Open every sealed queue item (refused natively while locked), ingest, then ack. Main vault only. */
export async function drainNativeQueue(): Promise<number> {
  if (!isNative() || useVault.getState().open?.kind !== 'main') return 0;
  const { items } = await ArizoSms.pending();
  if (!items.length) return 0;
  const opened: IncomingSms[] = [];
  const done: string[] = [];
  for (const it of items) {
    try {
      const { text } = await ArizoSecurity.openQueueItem({ b64: it.b64 });
      opened.push({ text, source: it.source, sender: it.sender || null, received_at: it.received_at });
      done.push(it.id);
    } catch (e) {
      // Unreadable items (key rotated after a wipe) are dropped; LOCKED keeps them for later.
      if ((e as { code?: string }).code !== 'LOCKED') done.push(it.id);
      SecureLogger.warn('sms', 'queue item skipped');
    }
  }
  if (opened.length) await ingest(opened);
  await ArizoSms.ack({ ids: done });
  return opened.length;
}

/** Base64 (standard or URL-safe, maybe URL-encoded) → UTF-8 text. Null when it is not valid. */
export function decodeShortcutPayload(d: string): string | null {
  try {
    const b64 = decodeURIComponent(d).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return text.trim() ? text.slice(0, 2000) : null;
  } catch {
    return null;
  }
}

let held: string | null = null;

/**
 * Called at boot, before routing: takes `#/sms-ingest?d=…` out of the URL immediately
 * (history.replaceState) so it never lingers in history, and holds the text in memory only.
 */
export function captureIngestFragment(): void {
  takeFragment();
  // The Shortcut may open the URL in an app that is already loaded: then only the hash changes.
  // Capture-phase listeners on window run before the router's, so it only ever sees #/sms.
  const onChange = () => {
    if (takeFragment()) void flushHeldFragment().catch(() => {});
  };
  window.addEventListener('popstate', onChange, { capture: true });
  window.addEventListener('hashchange', onChange, { capture: true });
}

function takeFragment(): boolean {
  const m = /^#\/sms-ingest\?(.*)$/.exec(window.location.hash);
  if (!m) return false;
  const d = new URLSearchParams(m[1]).get('d');
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/sms`);
  held = d ? decodeShortcutPayload(d) : held;
  return true;
}

/** After unlock: ingest the held Shortcuts message (if any). */
export async function flushHeldFragment(): Promise<IngestOutcome | null> {
  const text = held;
  // Held until the real vault is open: never ingested into a decoy session.
  if (text === null || useVault.getState().open?.kind !== 'main') return null;
  held = null;
  return (await ingest([{ text, source: 'ios_shortcut' }]))[0] ?? null;
}
