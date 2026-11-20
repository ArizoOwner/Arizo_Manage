// Shared paper building blocks: QR (vector, from uqr), the scaled on-screen preview, the print portal
// (the only thing visible when printing, with @page for the chosen paper), PNG export at 3x DPR,
// and ESC/POS rasterising of the thermal template.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { encode } from 'uqr';
import { useSettings } from '../../app/stores/settings';
import type { CurrencyCode } from '../../core/currency/money';
import { formatMoney, type Lang } from '../../core/i18n/format';
import { PAPER_DOTS, receiptJob, toMonochrome, type PaperMm } from '../../core/print/escpos';
import './print.css';

export type Paper = 'A4' | 'A5' | '80' | '58';
const PAGE: Record<Paper, string> = { A4: 'A4 portrait', A5: 'A5 portrait', '80': '80mm auto', '58': '58mm auto' };
const MARGIN: Record<Paper, string> = { A4: '12mm', A5: '9mm', '80': '3mm', '58': '2mm' };
const WIDTH_MM: Record<Paper, number> = { A4: 210, A5: 148, '80': 80, '58': 58 };
export const isThermal = (p: Paper) => p === '80' || p === '58';

/** QR as vector SVG paths: crisp at any print resolution, no canvas, no inline script. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const qr = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  qr.data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
  return (
    <span className="qr">
      <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={label} shapeRendering="crispEdges">
        <rect width={qr.size} height={qr.size} fill="#fff" />
        <path d={d} fill="#111318" />
      </svg>
    </span>
  );
}

/** Money on paper: exact formatted amount, isolated LTR so the sign sits right in RTL text. */
export function PaperMoney({ minor, currency, lang, unit }: { minor: bigint; currency: CurrencyCode; lang: Lang; unit: 'toman' | 'rial' }) {
  const s = formatMoney(minor, currency, lang, unit);
  const cut = s.lastIndexOf(' ');
  return (
    <span>
      <span className="num">{s.slice(0, cut)}</span> {s.slice(cut + 1)}
    </span>
  );
}

/** "10" / "9.5" percent from basis points, integer math only. */
export const bpsPercent = (bps: number) => `${Math.floor(bps / 100)}${bps % 100 ? `.${String(bps % 100).padStart(2, '0').replace(/0$/, '')}` : ''}`;

/** Scales a fixed-size paper document down to the screen width, keeping its real layout. */
export function PaperPreview({ paper, children, testId }: { paper: Paper; children: ReactNode; testId?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, h: 0 });
  useLayoutEffect(() => {
    const fit = () => {
      if (!outer.current || !inner.current) return;
      const px = (WIDTH_MM[paper] * 96) / 25.4;
      const scale = Math.min(1, outer.current.clientWidth / px);
      setBox({ scale, h: inner.current.offsetHeight * scale });
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [paper]);
  return (
    <div ref={outer} className="w-full overflow-hidden rounded-2xl border border-hairline bg-surface-3" style={{ height: box.h || undefined }} data-testid={testId}>
      <div ref={inner} style={{ transform: `scale(${box.scale})`, width: `${WIDTH_MM[paper]}mm` }} className="ltr:origin-top-left rtl:origin-top-right">
        {children}
      </div>
    </div>
  );
}

/** Rendered into <body> only while a print is requested; @page matches the paper. */
export function PrintPortal({ paper, children }: { paper: Paper; children: ReactNode }) {
  return createPortal(
    <div className="print-portal" style={{ width: `calc(${WIDTH_MM[paper]}mm - 2 * ${MARGIN[paper]})` }} data-paper={paper}>
      <style>{`@page { size: ${PAGE[paper]}; margin: ${MARGIN[paper]}; }`}</style>
      {children}
    </div>,
    document.body,
  );
}

/** 3x DPR PNG of a rendered paper node. Fonts are our own same-origin files; nothing is fetched elsewhere. */
export async function nodeToPng(node: HTMLElement): Promise<Uint8Array> {
  const { toBlob } = await import('html-to-image');
  const blob = await toBlob(node, { pixelRatio: 3, backgroundColor: '#ffffff', cacheBust: false });
  if (!blob) throw new Error('PNG_FAILED');
  return new Uint8Array(await blob.arrayBuffer());
}

/** The thermal template, rendered at the printer's dot width, as an ESC/POS raster job. */
export async function nodeToEscPos(node: HTMLElement, mm: PaperMm): Promise<Uint8Array> {
  const { toCanvas } = await import('html-to-image');
  const width = PAPER_DOTS[mm];
  const scale = width / node.offsetWidth;
  const canvas = await toCanvas(node, { pixelRatio: scale, backgroundColor: '#ffffff', cacheBust: false });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('RASTER_FAILED');
  const w = Math.min(width, canvas.width);
  const img = ctx.getImageData(0, 0, w, canvas.height);
  return receiptJob(toMonochrome(img.data, w, canvas.height), w, canvas.height);
}

export function useDocLang(): { lang: Lang; unit: 'toman' | 'rial' } {
  const lang = useSettings((s) => s.lang);
  const unit = useSettings((s) => s.irrUnit);
  return { lang, unit };
}
