// Byte helpers shared by the crypto engine. No secrets are ever converted to JS strings except at the UI edge.
export const te = new TextEncoder();
export const td = new TextDecoder();

export function zeroize(...bufs: (Uint8Array | ArrayBuffer | null | undefined)[]): void {
  for (const b of bufs) if (b) (b instanceof Uint8Array ? b : new Uint8Array(b)).fill(0);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** CSPRNG bytes. getRandomValues is capped at 65,536 bytes per call, so larger requests are chunked. */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65_536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65_536)));
  return out;
}

export function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function fromHex(h: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(h)) throw new RangeError('invalid hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time comparison for MACs/verifiers. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

/** WebCrypto wants a BufferSource backed by a plain ArrayBuffer. */
export const buf = (b: Uint8Array): Uint8Array<ArrayBuffer> => (b.buffer instanceof ArrayBuffer && b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? (b as Uint8Array<ArrayBuffer>) : new Uint8Array(b));
