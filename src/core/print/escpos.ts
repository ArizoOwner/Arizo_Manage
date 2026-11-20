// ESC/POS byte builder for 58 mm (384 dots) and 80 mm (576 dots) thermal printers.
// Persian is printed as a raster image (GS v 0) of the rendered thermal template: printer code pages
// cannot shape Arabic script, so text mode is used for ASCII only. The native plugin only moves bytes.
export const PAPER_DOTS = { 58: 384, 80: 576 } as const;
export type PaperMm = keyof typeof PAPER_DOTS;

const ESC = 0x1b;
const GS = 0x1d;

export class EscPos {
  private out: number[] = [];

  init(): this {
    this.out.push(ESC, 0x40);
    return this;
  }
  align(a: 'left' | 'center' | 'right'): this {
    this.out.push(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
    return this;
  }
  bold(on: boolean): this {
    this.out.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }
  /** ASCII text only; anything else becomes '?'. */
  text(s: string): this {
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      this.out.push(c === 0x0a || (c >= 0x20 && c < 0x7f) ? c : 0x3f);
    }
    return this;
  }
  line(s = ''): this {
    return this.text(s).text('\n');
  }
  feed(lines: number): this {
    this.out.push(ESC, 0x64, Math.max(0, Math.min(255, lines)));
    return this;
  }
  /** Partial cut (GS V 66 0: feed to the cutter, then cut). */
  cut(): this {
    this.out.push(GS, 0x56, 0x42, 0x00);
    return this;
  }
  /**
   * GS v 0 raster bit image. `bits` is row-major, 1 = black, `width` dots per row (padded to a byte).
   * Sent in bands of at most 255 rows, which small printer buffers accept.
   */
  raster(bits: Uint8Array, width: number, height: number): this {
    if (bits.length !== width * height) throw new RangeError('RASTER_SIZE');
    const bytesPerRow = Math.ceil(width / 8);
    for (let y0 = 0; y0 < height; y0 += 255) {
      const h = Math.min(255, height - y0);
      this.out.push(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, h & 0xff, h >> 8);
      for (let y = y0; y < y0 + h; y++) {
        for (let bx = 0; bx < bytesPerRow; bx++) {
          let byte = 0;
          for (let b = 0; b < 8; b++) {
            const x = bx * 8 + b;
            if (x < width && bits[y * width + x]) byte |= 0x80 >> b;
          }
          this.out.push(byte);
        }
      }
    }
    return this;
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

/** RGBA pixels → 1-bit (luma < threshold = black). Transparent pixels count as white paper. */
export function toMonochrome(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, threshold = 160): Uint8Array {
  const bits = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3]! / 255;
    const luma = (0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!) * a + 255 * (1 - a);
    bits[i] = luma < threshold ? 1 : 0;
  }
  return bits;
}

/** A full receipt job: init, the rendered receipt image, feed, cut. */
export function receiptJob(bits: Uint8Array, width: number, height: number): Uint8Array {
  return new EscPos().init().align('center').raster(bits, width, height).feed(4).cut().bytes();
}
