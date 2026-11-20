// E2E builds only (imported behind VITE_E2E in main.tsx; scripts/check-prod.mjs fails if it ships).
// Phase 9 stress test: seed 20,000 rows into the open vault and time the workers from the page.
import { loadAnalyticsInput, runAnalytics } from '../core/analytics/analyticsClient';
import { periodAt } from '../core/analytics/periods';
import { verifyLedger } from '../core/ledger/ledger';
import { workerParser } from '../core/sms/smsClient';
import { seedStressData } from '../core/utils/demoData';
import { useSettings } from './stores/settings';
import { mutate, useVault } from './stores/vault';

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

export function installE2eHooks() {
  Object.assign(window, {
    __arizoE2E: {
      async stress(total: number) {
        const count = await mutate((db) => seedStressData(db, total));
        const report = await verifyLedger(useVault.getState().db());
        return { count, checked: report.checked, clean: report.drift.length + report.orphans.length + report.brokenPairs.length + report.splitMismatches.length === 0 };
      },
      /** Worker time only (post → result): rows are decrypted on the UI thread before, as in useAnalytics. */
      async analyticsMs(runs = 5) {
        const input = await loadAnalyticsInput(useVault.getState().db());
        const cal = useSettings.getState().calendar;
        const now = Date.now();
        const { y, m } = periodAt(now, cal);
        await runAnalytics(input, { now, cal, y, m }); // warm-up: worker start + JIT
        const times: number[] = [];
        for (let i = 0; i < runs; i++) {
          const t0 = performance.now();
          await runAnalytics(input, { now, cal, y, m });
          times.push(performance.now() - t0);
        }
        return { rows: input.transactions.length, median: median(times), max: Math.max(...times) };
      },
      async smsMs(texts: string[], runs = 5) {
        await workerParser(texts.slice(0, 5), {});
        const times: number[] = [];
        for (let i = 0; i < runs; i++) {
          const t0 = performance.now();
          await workerParser(texts, { now: Date.now() });
          times.push(performance.now() - t0);
        }
        return { messages: texts.length, median: median(times), max: Math.max(...times) };
      },
      /** Card scanner: draw a synthetic card face, run the real on-device OCR on it, parse the text. */
      // `vertical`: a portrait card (Blu Bank style) whose lines run sideways in the camera frame, read
      // the way the scanner reads a portrait guide (upright, then each quarter turn).
      async ocrCard(lines: string[], vertical = false) {
        const c = document.createElement('canvas');
        c.width = vertical ? 638 : 1012;
        c.height = vertical ? 1012 : 638;
        const g = c.getContext('2d')!;
        g.fillStyle = '#1b2a4a';
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#f4f1ea';
        g.font = 'bold 58px monospace';
        if (vertical) {
          // Text printed along the card's long edge: rotate the drawing a quarter turn.
          g.translate(c.width / 2, c.height / 2);
          g.rotate(-Math.PI / 2);
          lines.forEach((l, i) => g.fillText(l, -440, -120 + i * 95));
          g.setTransform(1, 0, 0, 1, 0, 0);
        } else lines.forEach((l, i) => g.fillText(l, 70, 250 + i * 95));
        const { framePng } = await import('../core/cardscan/frames');
        const { recognize, endOcr } = await import('../core/cardscan/ocrClient');
        const { parseCardText } = await import('../core/cardscan/parseCard');
        const t0 = performance.now();
        let text = '';
        for (const turn of vertical ? ([0, 90, -90] as const) : ([0] as const)) {
          const r = await recognize(await framePng(c, undefined, turn));
          text += '\n' + r.text;
          if (parseCardText(r.text).number) break;
        }
        const ms = performance.now() - t0;
        endOcr();
        const p = parseCardText(text);
        return { text, ms, number: p.number, expiry: p.expiry, cvv2: p.cvv2 };
      },
    },
  });
}
