// Frame preparation for OCR: crop to the card guide, scale to a width Tesseract reads well, grey +
// contrast stretch, and invert when the card is light-on-dark (most Iranian cards print light digits on a
// dark face; Tesseract reads dark text on light paper best). Pixels never leave the device.

/**
 * PNG bytes of `src` (a canvas or the video frame drawn into one), cropped to `crop` when given.
 * `turn` rotates the crop a quarter turn (90 = clockwise, -90 = counter-clockwise): a portrait card held
 * upright prints its lines sideways relative to a landscape read, and Tesseract reads horizontal text.
 */
export async function framePng(src: HTMLCanvasElement | HTMLVideoElement, crop?: { x: number; y: number; w: number; h: number }, turn: 0 | 90 | -90 = 0): Promise<ArrayBuffer> {
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
  const r = crop ?? { x: 0, y: 0, w: sw, h: sh };
  // The longer side of the output is 1280 px whichever way the card is held.
  const long = 1280;
  const cw = r.w >= r.h ? long : Math.round((r.w / r.h) * long);
  const ch = r.w >= r.h ? Math.round((r.h / r.w) * long) : long;
  const W = turn ? ch : cw;
  const H = turn ? cw : ch;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  if (turn) {
    g.translate(W / 2, H / 2);
    g.rotate((turn * Math.PI) / 180);
    g.drawImage(src, r.x, r.y, r.w, r.h, -cw / 2, -ch / 2, cw, ch);
    g.setTransform(1, 0, 0, 1, 0, 0);
  } else g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, W, H);
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
