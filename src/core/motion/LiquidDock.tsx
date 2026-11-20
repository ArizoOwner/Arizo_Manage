// Liquid frosted floating dock: 4 tabs + central morphing "+" orb (PROMPT.md §3.4 #3).
// Tap the orb → onAdd (Instant Entry Sheet). Long-press (450 ms) → radial quick actions.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { haptic, INSTANT, SPRING } from './motion';
import { GlyphTile } from '../ui/glyphs';

export type QuickAction = 'expense' | 'income' | 'transfer' | 'cheque' | 'invoice' | 'pasteSms';
const QUICK: QuickAction[] = ['expense', 'income', 'transfer', 'cheque', 'invoice', 'pasteSms'];
const QUICK_LOOK: Record<QuickAction, [string, string]> = {
  expense: ['arrowUp', 'var(--arizo-accent-outflow)'],
  income: ['arrowDown', 'var(--arizo-accent-primary)'],
  transfer: ['swap', 'var(--arizo-accent-info)'],
  cheque: ['cheque', 'var(--arizo-accent-luxury)'],
  invoice: ['invoice', '#B48CFF'],
  pasteSms: ['message', 'var(--arizo-accent-warning)'],
};

const icon = {
  home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  ledger: 'M5 4h11l3 3v13H5zM8 10h8M8 14h8M8 18h5',
  analytics: 'M4 20V10m6 10V4m6 16v-7m4 7H3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const TABS = [
  { to: '/', key: 'home', end: true },
  { to: '/ledger', key: 'ledger', end: false },
  { to: '/analytics', key: 'analytics', end: false },
  { to: '/more', key: 'more', end: false },
] as const;

export function LiquidDock({ onAdd, onQuick }: { onAdd: () => void; onQuick: (a: QuickAction) => void }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const startPress = () => {
    longPressed.current = false;
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      haptic.medium();
      setOpen(true);
    }, 450);
  };
  const endPress = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const tap = () => {
    if (longPressed.current) return;
    if (open) return setOpen(false);
    haptic.light();
    onAdd();
  };

  const tab = (i: number) => {
    const tb = TABS[i]!;
    return (
      <NavLink
        key={tb.key}
        to={tb.to}
        end={tb.end}
        onClick={() => haptic.tick()}
        className={({ isActive }) =>
          `relative flex min-h-12 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-semibold transition-colors ${isActive ? 'text-ink' : 'text-ink-2'}`
        }
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <motion.span
                layoutId="dock-active"
                aria-hidden="true"
                className="absolute inset-x-1 inset-y-0.5 rounded-2xl bg-[radial-gradient(90%_80%_at_50%_0%,color-mix(in_srgb,var(--arizo-accent-primary)_22%,transparent),transparent)] ring-1 ring-[color-mix(in_srgb,var(--arizo-accent-primary)_28%,transparent)]"
                transition={reduce ? INSTANT : { type: 'spring', stiffness: 460, damping: 36 }}
              />
            )}
            <motion.span className={`relative ${isActive ? 'text-emerald-text' : ''}`} animate={reduce ? {} : { y: isActive ? -1.5 : 0, scale: isActive ? 1.08 : 1 }} transition={SPRING.press}>
              <Icon d={icon[tb.key]} />
            </motion.span>
            <span className="relative">{t(`nav.${tb.key}`)}</span>
          </>
        )}
      </NavLink>
    );
  };

  return (
    <nav aria-label={t('app.name')} className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <AnimatePresence>
        {open && (
          <motion.div
            key="quick"
            role="menu"
            className="pointer-events-auto absolute bottom-[calc(5.75rem+env(safe-area-inset-bottom))] grid w-[min(22rem,calc(100%-2rem))] grid-cols-3 gap-2 rounded-3xl border border-specular bg-glass p-3 shadow-[var(--arizo-shadow)] backdrop-blur-[20px]"
            initial={reduce ? false : { opacity: 0, y: 16, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.94 }}
            transition={reduce ? INSTANT : SPRING.sheet}
          >
            {QUICK.map((a, i) => (
              <button
                key={a}
                role="menuitem"
                type="button"
                className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl bg-surface-3/70 px-2 py-2 text-[12px] font-semibold text-ink active:scale-95"
                onClick={() => {
                  setOpen(false);
                  onQuick(a);
                }}
              >
                <GlyphTile name={QUICK_LOOK[a][0]} color={QUICK_LOOK[a][1]} size={40} radius={14} pop delay={0.035 * i} />
                {t(`quick.${a}`)}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-1 rounded-[28px] border border-specular bg-glass px-2 py-1.5 shadow-[var(--arizo-shadow)] backdrop-blur-[20px]">
        {tab(0)}
        {tab(1)}
        <motion.button
          type="button"
          aria-label={t('nav.add')}
          aria-haspopup="menu"
          aria-expanded={open}
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerLeave={endPress}
          onClick={tap}
          onContextMenu={(e) => e.preventDefault()}
          whileTap={reduce ? {} : { scale: 0.9 }}
          animate={{ rotate: open ? 45 : 0 }}
          transition={reduce ? INSTANT : SPRING.press}
          className="relative mx-1 grid h-14 w-14 shrink-0 place-items-center rounded-full bg-cta text-on-accent shadow-[0_0_28px_var(--arizo-accent-primary-glow)]"
        >
          {!reduce && <span aria-hidden="true" className="arizo-orb-halo absolute inset-0 rounded-full" />}
          <svg viewBox="0 0 24 24" className="relative h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </motion.button>
        {tab(2)}
        {tab(3)}
      </div>
    </nav>
  );
}
