// Drives the debug APK on a connected device or emulator through the WebView's DevTools socket
// (debug builds only: MainActivity enables WebView debugging when BuildConfig.DEBUG). Playwright's
// connectOverCDP is refused by Android WebView, so this speaks plain CDP (Runtime.evaluate) over the
// built-in WebSocket of Node 22+.
// Run: node scripts/android-smoke.mjs [apk]   (adb from %LOCALAPPDATA%\Android\Sdk\platform-tools or PATH)
// Covers what unit tests cannot: Argon2 in the WebView worker, the native PIN slot, SQLCipher open,
// lock, wrong and right PIN, data surviving an app restart. Uninstalls the app first (wipes its data).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const sdkAdb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const ADB = existsSync(sdkAdb) ? sdkAdb : 'adb';
const adb = (...a) => {
  try {
    return execFileSync(ADB, a, { encoding: 'utf8' }).trim();
  } catch (e) {
    return String(e.stdout ?? '').trim();
  }
};
const PKG = 'com.arizo.manage';
const PIN = '482916';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (s) => console.log(`[smoke] ${s}`);
// Emulator only: a fingerprint enrolled in system Settings with finger id 1 (see docs/security.md).
const touchFinger = async () => {
  await sleep(1500); // let BiometricPrompt appear
  adb('-e', 'emu', 'finger', 'touch', '1');
  await sleep(500);
  adb('-e', 'emu', 'finger', 'remove', '1');
};
// Taps the BiometricPrompt negative button ("استفاده از رمز") so the PIN path can be tested too.
const usePinInstead = async () => {
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
    const xml = adb('shell', 'cat', '/sdcard/ui.xml');
    const m = xml.match(/text="استفاده از رمز"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (m) {
      const [x1, y1, x2, y2] = m.slice(1).map(Number);
      adb('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1));
      await sleep(800);
      return true;
    }
  }
  return false;
};
const isEmulator = () => adb('shell', 'getprop', 'ro.kernel.qemu') === '1' || adb('shell', 'getprop', 'ro.boot.qemu') === '1';

/** One CDP session on the app page. `js` evaluates an expression (awaiting promises) in the page. */
async function attach() {
  for (let i = 0; i < 90; i++) {
    const pid = adb('shell', 'pidof', PKG);
    if (pid) {
      adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
      try {
        const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        const target = pages.find((p) => p.type === 'page' && p.url.startsWith('https://localhost'));
        if (target) {
          const ws = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise((ok, fail) => ((ws.onopen = ok), (ws.onerror = fail)));
          let seq = 0;
          const waiting = new Map();
          const errors = [];
          ws.onmessage = (m) => {
            const msg = JSON.parse(m.data);
            if (msg.id && waiting.has(msg.id)) {
              waiting.get(msg.id)(msg);
              waiting.delete(msg.id);
            } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception');
            else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
              const t = JSON.stringify(msg.params.args).slice(0, 600);
              // Debug builds: Capacitor's bridge logs every rejected plugin call; BAD_PIN is the wrong-PIN step itself.
              if (!/"(BAD_PIN|BIO_CANCELLED)"/.test(t)) errors.push(t); // expected rejections, logged by Capacitor in debug
            }
          };
          const send = (method, params = {}) =>
            new Promise((ok) => {
              const id = ++seq;
              waiting.set(id, ok);
              ws.send(JSON.stringify({ id, method, params }));
            });
          await send('Runtime.enable');
          const js = async (expression) => {
            const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
            return r.result?.result?.value;
          };
          return { js, errors, close: () => ws.close() };
        }
      } catch {}
    }
    await sleep(1000);
  }
  throw new Error('WebView not reachable');
}

// Page-side helpers, injected as source so every evaluate can use them.
const HELPERS = `
  window.__s ??= {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async until(fn, ms = 90000, what = 'condition') {
      const end = Date.now() + ms;
      for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout: ' + what); await __s.sleep(200); }
    },
    byText(tag, text) { return [...document.querySelectorAll(tag)].find((e) => e.textContent.trim() === text || e.getAttribute('aria-label') === text); },
    async click(tag, text, ms) { const el = await __s.until(() => { const e = __s.byText(tag, text); return e && !e.disabled ? e : null; }, ms, tag + ' ' + text); el.click(); await __s.sleep(300); },
    tid(id) { return [...document.querySelectorAll('[data-testid="' + id + '"]')].pop(); },
    async pin(p) {
      await __s.until(() => __s.tid('pin-pad')?.getAttribute('data-busy') === 'false', 90000, 'pin pad ready');
      for (const d of p) document.dispatchEvent(new KeyboardEvent('keydown', { key: d, bubbles: true }));
      await __s.sleep(200);
      __s.tid('pin-submit').click();
    },
    text() { return document.body.innerText; },
  };
  true`;

async function run() {
  const apk = process.argv[2] ?? 'android/app/build/outputs/apk/debug/app-debug.apk';
  step(`device: ${adb('devices').split('\n')[1] ?? 'none'}`);
  adb('uninstall', PKG);
  step(`install: ${adb('install', '-r', apk)}`);
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);

  let s = await attach();
  await s.js(HELPERS);
  step('onboarding');
  await s.js(`__s.click('button', 'شروع')`);
  await s.js(`__s.click('button', 'ادامه')`);
  let t0 = Date.now();
  await s.js(`__s.pin('${PIN}')`);
  await s.js(`__s.pin('${PIN}')`);
  const created = await s.js(`__s.until(() => __s.byText('button', 'متوجه شدم') || (__s.tid('pin-pad') && /ممکن نشد|failed/.test(__s.text()) && 'FAILED'), 120000, 'vault created').then((x) => x === 'FAILED' ? 'FAILED' : 'ok')`);
  if (created !== 'ok') throw new Error('vault creation failed on the device');
  step(`vault created (Argon2 64 MiB + native slot + SQLCipher) in ${Date.now() - t0} ms`);
  await s.js(`__s.click('button', 'متوجه شدم')`);
  await s.js(`__s.until(() => /ورود سریع/.test(__s.text()), 10000, 'biometric step')`);
  const bio = await s.js(`window.Capacitor.Plugins.ArizoSecurity.status()`);
  step(`biometric step shown; device biometricAvailable=${bio.biometricAvailable}`);
  let bioEnrolled = false;
  if (bio.biometricAvailable && isEmulator()) {
    const enrol = s.js(`__s.click('button', 'فعال‌سازی').then(() => __s.until(() => /پیامک/.test(__s.text()) || /پشتیبانی نمی/.test(__s.text()), 60000, 'after enrol').then(() => /پیامک/.test(__s.text())))`);
    await touchFinger();
    bioEnrolled = await enrol;
    if (!bioEnrolled) throw new Error('biometric enrolment failed');
    step('fingerprint enrolled in the app (BiometricPrompt + Keystore key)');
  } else {
    step('no enrolled fingerprint on this device: biometric enrolment skipped');
    await s.js(`__s.click('button', 'بعداً')`);
  }
  await s.js(`__s.click('button', 'ادامه')`);
  await s.js(`__s.until(() => __s.tid('onboarding-demo'), 10000, 'demo button').then((b) => b.click())`);
  const worth = `__s.until(() => { const t = __s.tid('card-stack') && __s.tid('net-worth')?.querySelector('.sr-only')?.textContent; return t && !/^[۰0] /.test(t) ? t : null; }, 120000, 'net worth loaded')`;
  const txCount = `window.Capacitor.Plugins.ArizoSqlCipher.query({ sql: 'SELECT COUNT(*) AS n FROM transactions', params: [] }).then((r) => r.rows[0].n)`;
  const before = await s.js(worth);
  const rowsBefore = await s.js(txCount);
  step(`dashboard with demo data, net worth ${before}, ${rowsBefore} transactions in SQLCipher`);

  step('lock, wrong PIN, right PIN');
  await s.js(`__s.click('button', 'قفل')`);
  await s.js(`__s.until(() => /گاوصندوق قفل است/.test(__s.text()), 10000, 'lock screen')`);
  if (bioEnrolled) {
    if (!(await usePinInstead())) throw new Error('fingerprint prompt not shown on the lock screen');
    step('lock screen offered the fingerprint; chose the PIN instead');
  }
  await s.js(`__s.pin('111222')`);
  await s.js(`__s.until(() => /رمز نادرست است/.test(__s.text()), 90000, 'wrong PIN message')`);
  step('wrong PIN refused');
  t0 = Date.now();
  await s.js(`__s.pin('${PIN}')`);
  await s.js(`__s.until(() => __s.tid('card-stack') || (/ممکن نشد/.test(__s.text()) && 'FAILED'), 90000, 'unlock').then((x) => { if (x === 'FAILED') throw new Error('unlock failed'); })`);
  step(`unlocked in ${Date.now() - t0} ms`);
  const errors = [...s.errors];
  s.close();

  step('restart the app: data must survive');
  adb('shell', 'am', 'force-stop', PKG);
  adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  await sleep(2000);
  s = await attach();
  await s.js(HELPERS);
  if (bioEnrolled) {
    // The lock screen offers the fingerprint by itself on open.
    await touchFinger();
    step('unlocked with the fingerprint after restart');
  } else await s.js(`__s.pin('${PIN}')`);
  const after = await s.js(worth);
  const rowsAfter = await s.js(txCount);
  if (after !== before || rowsAfter !== rowsBefore) throw new Error(`data changed across restart: ${before}/${rowsBefore} -> ${after}/${rowsAfter}`);
  step(`after restart net worth ${after}, ${rowsAfter} transactions`);
  step(`native status ${JSON.stringify(await s.js(`window.Capacitor.Plugins.ArizoSecurity.status()`))}`);
  errors.push(...s.errors);
  s.close();
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);
  step('PASS');
}

run().catch((e) => {
  console.error(`[smoke] FAIL: ${e.message}`);
  process.exit(1);
});
