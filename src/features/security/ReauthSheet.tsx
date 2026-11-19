// Re-authentication gate (PROMPT.md §5.2): revealing a full card/Sheba, exporting and changing
// security settings need a fresh PIN within the last 60 seconds.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVault } from '../../app/stores/vault';
import { vaultService } from '../../core/security/vaultService';
import { Sheet } from '../../core/ui/ui';
import { PinPad } from '../vault-lock/PinPad';

export function useReauth() {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const request = (action: () => void) => {
    if (useVault.getState().reauthOk()) action();
    else setPending(() => action);
  };
  const sheet = <ReauthSheet open={pending !== null} onClose={() => setPending(null)} onOk={() => pending?.()} />;
  return { request, sheet };
}

function ReauthSheet({ open, onClose, onOk }: { open: boolean; onClose: () => void; onOk: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={t('settings.reauth')}>
      <PinPad
        disabled={busy}
        error={error}
        submitLabel={t('settings.confirm')}
        onSubmit={async (pin) => {
          setBusy(true);
          try {
            if (await vaultService.verifyPin(pin)) {
              setError(null);
              useVault.getState().grantReauth();
              onClose();
              onOk();
            } else setError(t('lock.wrong'));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}
