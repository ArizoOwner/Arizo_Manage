// Graphical icon kit: line glyphs (24-unit grid, round caps) for categories, quick actions and the
// Tools hub, plus `GlyphTile`, the soft tinted tile they sit in. Hand-drawn paths: no icon font, no
// remote assets (the CSP forbids both), and every glyph is aria-hidden next to a real text label.
import { motion, useReducedMotion, type MotionStyle } from 'framer-motion';

export const GLYPHS: Record<string, string> = {
  // categories (seed icon_name values)
  utensils: 'M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2M9 3v6M17 21V3c-2.2 1.2-3 3.8-3 6.5V13h3',
  'shopping-basket': 'M4 10h16l-1.6 9a2 2 0 0 1-2 1.7H7.6a2 2 0 0 1-2-1.7zM8 10l4-6 4 6M9.5 14v3M14.5 14v3',
  car: 'M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2.5M19 16v2.5M7.5 13.2h.01M16.5 13.2h.01M5 11h14',
  fuel: 'M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M7 8h6M15 10h2a2 2 0 0 1 2 2v4.5a1.5 1.5 0 0 0 3 0V8l-3-3',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  home: 'M3 11.5 12 4l9 7.5M5 10v10h14V10M10 20v-5h4v5',
  landmark: 'M3 21h18M5 21V10M10 21V10M14 21V10M19 21V10M2.5 10h19L12 3z',
  'heart-pulse': 'M20.5 8.5c0 5.5-8.5 11-8.5 11s-8.5-5.5-8.5-11A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8.5 2.5zM3.5 12h4l1.5-3 3 6 1.5-3h7',
  'graduation-cap': 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6',
  shirt: 'M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z',
  smartphone: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2',
  'party-popper': 'M4 20l4-11 7 7zM14 4c0 2-2 2-2 4M18 8c-2 0-2 2-4 2M19 3l.01.01M20 13l.01.01M11 3l.01.01',
  plane: 'M10.5 13.5 3 11l1.5-1.5 8 1L17 6a2 2 0 0 1 3 0 2 2 0 0 1 0 3l-4.5 4.5 1 8L15 23l-2.5-7.5L9 19v3l-1.5-1.5L6 17l-3.5-1.5L4 14h3z',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7c-1.5-3-5-3-5-1s5 1 5 1zM12 7c1.5-3 5-3 5-1s-5 1-5 1z',
  'hand-heart': 'M11 14h2a2 2 0 0 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16M7 20l1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91L14.5 13M15.5 3.5a2 2 0 0 0-3 2.6l3 3 3-3a2 2 0 0 0-3-2.6z',
  percent: 'M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  'circle-ellipsis': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12h.01M12 12h.01M16 12h.01',
  briefcase: 'M3 7h18v13H3zM8 7V4h8v3M3 12.5h18M10.5 12.5v2h3v-2',
  store: 'M3 9l1.5-5h15L21 9M3 9v2a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9zM5 13.5V21h14v-7.5M10 21v-5h4v5',
  'piggy-bank': 'M19 9.5c.8.3 1.5 1 1.5 2v1.5H19a7 7 0 0 1-2.5 3.5V19h-3v-1.5h-3V19h-3v-2.5A6.5 6.5 0 0 1 9.5 5H13a6 6 0 0 1 4.5 2L19 5v4.5zM15 10.5h.01M10 8h3',
  'arrow-left-right': 'M8 4 4 8l4 4M4 8h16M16 12l4 4-4 4M20 16H4',
  // quick actions and tools
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  swap: 'M7 4 3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7',
  cheque: 'M3 6h18v12H3zM7 10h6M7 14h3M14.5 14.5c1-1.5 2-1.5 2.5-.5s1.5 1 2.5-.5',
  invoice: 'M6 2h9l4 4v16H6zM14 2v5h5M9 12h6M9 16h6M9 8h2',
  message: 'M4 5h16v11H8l-4 4zM8 9.5h8M8 12.5h5',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01',
  coins: 'M9 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM18.1 10.4A6 6 0 1 1 10.4 18M7 6h1v4M16.7 13.9l.7.7-2.8 2.8',
  handshake: 'M2 11l4-4 4 2 3-2 5 1 4 3M6 7v7l5 5 1.5-1.5M10 15l2 2M13 13l2.5 2.5M16 10.5l3 3',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  gauge: 'M12 14l4-4M3.3 17A9 9 0 1 1 20.7 17M7 17h10',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01',
  download: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  upload: 'M12 21V9M7 14l5-5 5 5M4 5h16',
  shieldCheck: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  printer: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  chart: 'M4 20V10M10 20V4M16 20v-7M3 20h18',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
};

export function Glyph({ name, className = 'h-[22px] w-[22px]', strokeWidth = 1.8 }: { name: string; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPHS[name] ?? GLYPHS['circle-ellipsis']} />
    </svg>
  );
}

/**
 * Tinted tile behind a glyph: a soft radial of `color`, a hairline rim and the glyph in `color`.
 * `pop` springs it in on mount (staggered by `delay`) when motion is allowed.
 */
export function GlyphTile({ name, color, size = 44, radius = 14, pop, delay = 0, className = '', glyphClass }: { name: string; color: string; size?: number; radius?: number; pop?: boolean; delay?: number; className?: string; glyphClass?: string }) {
  const reduce = useReducedMotion();
  const style: MotionStyle & React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    color,
    background: `radial-gradient(120% 120% at 30% 20%, color-mix(in srgb, ${color} 30%, transparent), color-mix(in srgb, ${color} 10%, transparent) 70%)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 26%, transparent), 0 8px 22px -12px color-mix(in srgb, ${color} 70%, transparent)`,
  };
  const glyph = <Glyph name={name} className={glyphClass ?? (size >= 48 ? 'h-6 w-6' : 'h-[20px] w-[20px]')} />;
  if (!pop || reduce)
    return (
      <span aria-hidden="true" className={`grid shrink-0 place-items-center ${className}`} style={style}>
        {glyph}
      </span>
    );
  return (
    <motion.span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center ${className}`}
      style={style}
      initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22, delay }}
    >
      {glyph}
    </motion.span>
  );
}
