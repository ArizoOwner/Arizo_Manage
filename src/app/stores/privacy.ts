import { create } from 'zustand';

/** Global stealth blur over every monetary value (PROMPT.md §3.4 #5). Session-only on purpose. */
export const usePrivacy = create<{ hidden: boolean; toggle: () => void }>((set) => ({
  hidden: false,
  toggle: () => set((s) => ({ hidden: !s.hidden })),
}));
