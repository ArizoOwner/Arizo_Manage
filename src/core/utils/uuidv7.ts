// RFC 9562 UUIDv7: 48-bit ms timestamp + 74 random bits. Monotonic within one millisecond.
let lastMs = -1;
let seq = 0;

export function uuidv7(now: number = Date.now()): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  if (now === lastMs) {
    seq = (seq + 1) & 0xfff;
  } else {
    lastMs = now;
    seq = ((b[6]! & 0x0f) << 8) | b[7]!;
  }
  let ts = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  b[6] = 0x70 | ((seq >> 8) & 0x0f);
  b[7] = seq & 0xff;
  b[8] = 0x80 | (b[8]! & 0x3f);
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const uuidv7Time = (id: string): number => parseInt(id.replace(/-/g, '').slice(0, 12), 16);
