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
    },
  });
}
