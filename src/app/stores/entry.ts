import { create } from 'zustand';
import type { EntryKind } from '../../features/transactions/EntrySheet';

/** Which quick-entry sheet is open (owned by AppShell); lets any screen open it, e.g. the dashboard actions. */
export const useEntry = create<{ kind: EntryKind | null; open: (k: EntryKind) => void; close: () => void }>((set) => ({
  kind: null,
  open: (kind) => set({ kind }),
  close: () => set({ kind: null }),
}));
