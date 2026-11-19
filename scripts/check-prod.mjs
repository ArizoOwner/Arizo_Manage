// Production-build guard: the dev-only Design Gallery must not ship.
// Run after `npm run build` (default mode). Exits non-zero if gallery code is in dist/.
import { readdirSync, readFileSync } from 'node:fs';

const files = readdirSync('dist/assets').filter((f) => f.endsWith('.js'));
const hits = files.filter((f) => readFileSync(`dist/assets/${f}`, 'utf8').includes('gallery.devOnly'));
if (hits.length) {
  console.error('FAIL: Design Gallery found in production bundle:', hits.join(', '));
  process.exit(1);
}
console.log(`ok: gallery absent from ${files.length} production chunks`);
