// SecureLogger: a no-op in production builds (Vite drops the branch). In dev it redacts
// card numbers, Sheba/IBAN, long digit runs (amounts, IDs, PINs, keys) and hex/base64 blobs.
const PATTERNS: [RegExp, string][] = [
  [/IR\d{24}/gi, '[SHEBA]'],
  [/\b(?:\d[ -]?){15}\d\b/g, '[CARD]'],
  [/[A-Za-z0-9+/]{24,}={0,2}/g, '[BLOB]'],
  [/[۰-۹٠-٩0-9][۰-۹٠-٩0-9,٬.]*/g, '[N]'],
];

export function redact(value: unknown): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? '[N]' : v));
  } catch {
    s = String(value);
  }
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
function emit(level: Level, scope: string, args: unknown[]) {
  if (!import.meta.env.DEV) return;
  // SMS bodies are never passed here by contract; redaction is the second line of defence.
  console[level](`[arizo:${scope}]`, ...args.map(redact));
}

export const SecureLogger = {
  debug: (scope: string, ...a: unknown[]) => emit('debug', scope, a),
  info: (scope: string, ...a: unknown[]) => emit('info', scope, a),
  warn: (scope: string, ...a: unknown[]) => emit('warn', scope, a),
  error: (scope: string, ...a: unknown[]) => emit('error', scope, a),
};
