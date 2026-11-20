// Frame preparation for OCR: crop to the card guide, scale to a width Tesseract reads well, grey +
// contrast stretch, and invert when the card is light-on-dark (most Iranian cards print light digits on a
// dark face; Tesseract reads dark text on light paper best). Pixels never leave the device.

/** PNG bytes of `src` (a canvas or the video frame drawn into one), cropped to `crop` when given. */
export async function framePng(src: HTMLCanvasElement | HTMLVideoElement, crop?: { x: number; y: number; w: number; h: number }): Promise<ArrayBuffer> {
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
  const r = crop ?? { x: 0, y: 0, w: sw, h: sh };
  const W = 1280;
  const H = Math.round((r.h / r.w) * W);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  // Luma histogram → 2nd and 98th percentile for a contrast stretch; mean decides the polarity.
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i]! * 77 + d[i + 1]! * 150 + d[i + 2]! * 29) >> 8;
    d[i] = y;
    hist[y]!++;
    sum += y;
  }
  const n = d.length / 4;
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]!) >= n * p) return v;
    return 255;
  };
  const lo = pct(0.02);
  const hi = Math.max(lo + 1, pct(0.98));
  const invert = sum / n < 128;
  for (let i = 0; i < d.length; i += 4) {
    let y = Math.min(255, Math.max(0, ((d[i]! - lo) * 255) / (hi - lo)));
    if (invert) y = 255 - y;
    d[i] = d[i + 1] = d[i + 2] = y;
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('frame'))), 'image/png'));
  // Clear the scratch canvas: the frame may show a full card.
  g.clearRect(0, 0, W, H);
  c.width = c.height = 0;
  return blob.arrayBuffer();
}
