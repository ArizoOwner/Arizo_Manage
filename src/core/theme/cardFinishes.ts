import type { CardFinish } from '../storage/schema';

/** The 6 procedural card finishes (PROMPT.md §3.2). `ink` is the text colour printed on the card. */
export interface FinishSpec {
  from: string;
  to: string;
  sheen: string;
  ink: string;
  inkSoft: string;
}

export const CARD_FINISHES: Record<CardFinish, FinishSpec> = {
  obsidian_carbon: { from: '#0F141F', to: '#1B2436', sheen: '#00D69F', ink: '#F4F7FB', inkSoft: '#B7C1D1' },
  emerald_silk: { from: '#062E26', to: '#0D5C4B', sheen: '#E6C47A', ink: '#F7EBCB', inkSoft: '#CFE6DD' },
  champagne_titanium: { from: '#2B2418', to: '#5E4B2B', sheen: '#F1D9A0', ink: '#FBF3E1', inkSoft: '#E3D3B3' },
  midnight_sapphire: { from: '#0A1931', to: '#1B3B6F', sheen: '#4DA6FF', ink: '#EEF5FF', inkSoft: '#BFD3EE' },
  velvet_burgundy: { from: '#2C0E1B', to: '#591B33', sheen: '#E8A9A0', ink: '#FBEFF1', inkSoft: '#E6C3CA' },
  alabaster_pearl: { from: '#E8EDF5', to: '#CFD8E6', sheen: '#FFFFFF', ink: '#0B1221', inkSoft: '#3A4659' },
};

export const CARD_FINISH_IDS = Object.keys(CARD_FINISHES) as CardFinish[];
