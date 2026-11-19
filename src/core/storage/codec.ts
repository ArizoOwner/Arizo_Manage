// Lossless JSON for rows containing bigint. Used by the web adapter, the native bridge and .arizo backups.
const BIG = '$n';

export function encodeRow(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? { [BIG]: v.toString() } : v));
}

export function decodeRow<T>(text: string): T {
  return JSON.parse(text, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o);
      if (keys.length === 1 && keys[0] === BIG && typeof o[BIG] === 'string') return BigInt(o[BIG]);
    }
    return v;
  }) as T;
}
