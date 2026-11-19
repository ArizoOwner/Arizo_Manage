// ArizoParallaxCard: procedural bank card with pointer/drag tilt (±7°) and a moving specular sheen
// (PROMPT.md §3.4 #2). `layoutId` enables the Framer hero morph into Account Detail (Phase 3).
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { useId, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrencyCode } from '../currency/money';
import type { CardFinish } from '../storage/schema';
import { CARD_FINISHES } from '../theme/cardFinishes';
import { OdometerAmount } from './OdometerAmount';
import { PrivacyBlur } from './PrivacyBlur';
import { SPRING } from './motion';

export interface ParallaxCardProps {
  finish: CardFinish;
  bankName: string;
  accountName: string;
  last4?: string | null;
  balanceMinor: bigint;
  currency: CurrencyCode;
  layoutId?: string;
  onSelect?: () => void;
}

const MAX_TILT = 7;

export function ParallaxCard({ finish, bankName, accountName, last4, balanceMinor, currency, layoutId, onSelect }: ParallaxCardProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const f = CARD_FINISHES[finish];
  const noiseId = useId().replace(/:/g, '');
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const sx = useSpring(px, SPRING.press);
  const sy = useSpring(py, SPRING.press);
  const rotateY = useTransform(sx, [0, 1], [-MAX_TILT, MAX_TILT]);
  const rotateX = useTransform(sy, [0, 1], [MAX_TILT, -MAX_TILT]);
  const sheenX = useTransform(sx, [0, 1], ['-30%', '130%']);

  const track = (e: PointerEvent<HTMLElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const reset = () => {
    px.set(0.5);
    py.set(0.5);
  };

  const Tag = onSelect ? motion.button : motion.div;
  return (
    <Tag
      {...(layoutId ? { layoutId } : {})}
      type={onSelect ? 'button' : undefined}
      onClick={onSelect}
      onPointerMove={track}
      onPointerLeave={reset}
      onPointerUp={reset}
      style={{ rotateX: reduce ? 0 : rotateX, rotateY: reduce ? 0 : rotateY, transformPerspective: 900, color: f.ink }}
      className="relative block aspect-[1.586] w-full overflow-hidden rounded-[22px] text-start shadow-[0_24px_48px_-24px_rgba(0,0,0,0.75)] outline-none focus-visible:ring-2 focus-visible:ring-gold-mark"
      aria-label={`${bankName} · ${accountName}`}
    >
      {/* base mesh gradient */}
      <span className="absolute inset-0" style={{ background: `radial-gradient(120% 90% at 15% 10%, ${f.to} 0%, transparent 60%), linear-gradient(135deg, ${f.from}, ${f.to})` }} />
      {/* SVG noise grain */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.16] mix-blend-overlay" aria-hidden="true">
        <filter id={`n${noiseId}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#n${noiseId})`} />
      </svg>
      {/* diagonal specular rim + moving sheen */}
      <span className="absolute inset-0 rounded-[22px] border border-white/15" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)' }} />
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-y-1/2 w-1/3 -skew-x-12 opacity-25 blur-xl"
        style={{ left: sheenX, background: `linear-gradient(90deg, transparent, ${f.sheen}, transparent)` }}
      />
      {/* content */}
      <span className="relative flex h-full flex-col justify-between p-5">
        <span className="flex items-start justify-between gap-3">
          <span className="text-[15px] font-bold tracking-tight">{bankName}</span>
          <span aria-hidden="true" className="h-7 w-10 rounded-md" style={{ background: `linear-gradient(135deg, ${f.sheen}66, ${f.sheen}22)`, border: `1px solid ${f.sheen}55` }} />
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-[11px] font-medium" style={{ color: f.inkSoft }}>
            {t('card.balance')}
          </span>
          <OdometerAmount minor={balanceMinor} currency={currency} className="text-[clamp(1.25rem,6.2vw,1.75rem)] font-extrabold" unitClassName="!text-[0.5em]" />
        </span>
        <span className="flex items-end justify-between gap-3 text-[12px]" style={{ color: f.inkSoft }}>
          <span className="truncate">{accountName}</span>
          {last4 && (
            <PrivacyBlur>
              <span dir="ltr" className="tabular tracking-[0.2em]">
                •••• {last4}
              </span>
            </PrivacyBlur>
          )}
        </span>
      </span>
    </Tag>
  );
}
