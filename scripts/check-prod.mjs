// Production-build guard. Run after `npm run build` (default mode). Exits non-zero if:
// - dev/E2E-only code reached dist/ (Design Gallery, cheap-Argon2 hook, stress-test hooks);
// - a console call survived beyond the counted residue (zero production logs, PROMPT.md §1.5);
// - a source map shipped (it would publish the readable source next to the app);
// - dist/index.html lost its CSP, gained an inline script, or names a remote origin;
// - a JS chunk names a host outside the reviewed allowlist (new SDKs and CDNs show up here first).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = {
  'gallery.devOnly': 'Design Gallery',
  useArgonParamsForTesting: 'cheap Argon2 test hook (call site)',
  __arizoE2E: 'E2E stress-test hooks',
};
// Hosts that only appear inside library strings (XML namespaces written by exceljs, links in error
// messages). The CSP's connect-src 'self' and the Android WebView firewall block them anyway; this list
// exists so that a NEW host fails the build and gets reviewed.
const ALLOWED_HOSTS = new Set([
  'schemas.openxmlformats.org', 'www.w3.org', 'schemas.microsoft.com', 'purl.org', // xlsx XML namespaces
  'github.com', 'raw.github.com', 'stuk.github.io', 'www.npmjs.com', 'tinyurl.com', 'bit.ly', 'feross.org', 'stuartk.com',
  'reactrouter.com', 'react.dev', 'www.i18next.com', 'locize.com', 'capacitorjs.com', 'localhost', // docs links in messages
]);
// Residual console calls that esbuild's `drop` cannot see because they are not written `console.x(`:
// Capacitor's bridge calls `win.console.error` for native bridge failures (never with vault data), and
// Workbox's generated sw.js warns about precache entries. Counted, so a new one fails the build.
const ALLOWED_CONSOLE = { error: 1, warn: 1 };

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p.replaceAll('\\', '/'));
  }
};
walk('dist');

let failed = false;
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  failed = true;
};

const js = files.filter((f) => f.endsWith('.js'));
const consoleCount = {};
const hosts = new Set();
for (const f of js) {
  const src = readFileSync(f, 'utf8');
  for (const [marker, what] of Object.entries(FORBIDDEN)) {
    // The method name survives as a property of vaultService; only a call with arguments means it is used.
    const hit = marker === 'useArgonParamsForTesting' ? /useArgonParamsForTesting\(\{/.test(src) : src.includes(marker);
    if (hit) fail(`${what} found in production chunk ${f}`);
  }
  for (const m of src.matchAll(/console\.(log|info|debug|trace|warn|error)\(/g)) consoleCount[m[1]] = (consoleCount[m[1]] ?? 0) + 1;
  if (/sourceMappingURL=/.test(src)) fail(`source map reference in ${f}`);
  for (const m of src.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) hosts.add(m[1]);
}
for (const [k, n] of Object.entries(consoleCount)) if (n > (ALLOWED_CONSOLE[k] ?? 0)) fail(`${n}x console.${k}( in production JS (allowed ${ALLOWED_CONSOLE[k] ?? 0})`);
for (const h of hosts) if (h && !ALLOWED_HOSTS.has(h)) fail(`unreviewed remote host "${h}" in production JS`);
for (const f of files) if (f.endsWith('.map')) fail(`source map shipped: ${f}`);

const html = readFileSync('dist/index.html', 'utf8');
if (!/<meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'self'/.test(html)) fail('dist/index.html has no strict CSP meta');
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) fail('inline <script> in dist/index.html');
for (const m of html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)) fail(`remote reference in index.html: ${m[0]}`);
if (/https?:\/\//.test(readFileSync('dist/manifest.webmanifest', 'utf8'))) fail('remote URL in manifest.webmanifest');

if (failed) process.exit(1);
console.log(`ok: ${js.length} JS files; no dev-only code, no source maps, console residue ${JSON.stringify(consoleCount)}, ${hosts.size} reviewed hosts, CSP present`);
