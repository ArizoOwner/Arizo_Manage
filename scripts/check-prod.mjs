// Production-build guard. Run after `npm run build` (default mode). Exits non-zero if dev/E2E-only
// code reached dist/: the Design Gallery, or the cheap-Argon2 test hook.
import { readdirSync, readFileSync } from 'node:fs';

const FORBIDDEN = {
  'gallery.devOnly': 'Design Gallery',
  useArgonParamsForTesting: 'cheap Argon2 test hook (call site)',
};

const files = readdirSync('dist/assets').filter((f) => f.endsWith('.js'));
let failed = false;
for (const f of files) {
  const src = readFileSync(`dist/assets/${f}`, 'utf8');
  for (const [marker, what] of Object.entries(FORBIDDEN)) {
    // The method name survives as a property of vaultService; only a call with arguments means it is used.
    const hit = marker === 'useArgonParamsForTesting' ? /useArgonParamsForTesting\(\{/.test(src) : src.includes(marker);
    if (hit) {
      console.error(`FAIL: ${what} found in production chunk ${f}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log(`ok: no dev-only code in ${files.length} production chunks`);
