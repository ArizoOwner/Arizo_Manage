// Spring presets and haptics (PROMPT.md §3.4). Every animated component reads useReducedMotion().
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { Transition } from 'framer-motion';

export const SPRING = {
  /** Odometer digits (spec: stiffness 320, damping 28, mass 0.9). */
  odometer: { type: 'spring', stiffness: 320, damping: 28, mass: 0.9 },
  /** Sheets, hero morphs. */
  sheet: { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 },
  /** Small presses. */
  press: { type: 'spring', stiffness: 600, damping: 32 },
} satisfies Record<string, Transition>;

export const INSTANT: Transition = { duration: 0 };

const native = Capacitor.isNativePlatform();

/** Fire-and-forget haptics; silently no-op on the web/iOS PWA. */
export const haptic = {
  tick: () => void (native && Haptics.selectionChanged().catch(() => {})),
  light: () => void (native && Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})),
  medium: () => void (native && Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})),
};
