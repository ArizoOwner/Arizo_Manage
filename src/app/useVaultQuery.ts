import { useEffect, useState } from 'react';
import type { IVaultDatabase } from '../core/storage/IVaultDatabase';
import { useVault } from './stores/vault';

/** Read from the open vault and re-run after every committed write (`rev`). */
export function useVaultQuery<T>(query: (db: IVaultDatabase) => Promise<T>, deps: unknown[] = []): { data: T | undefined; loading: boolean } {
  const open = useVault((s) => s.open);
  const rev = useVault((s) => s.rev);
  const [state, setState] = useState<{ data: T | undefined; loading: boolean }>({ data: undefined, loading: true });
  useEffect(() => {
    if (!open) return;
    let live = true;
    query(open.db).then(
      (data) => live && setState({ data, loading: false }),
      () => live && setState((s) => ({ ...s, loading: false })),
    );
    return () => {
      live = false;
    };
    // `query` is recreated each render; `deps` lists what it actually closes over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rev, ...deps]);
  return state;
}
