// Settings & Security Center (PROMPT.md §7 #9): posture scorecard, auto-lock, PIN change, duress PIN,
// biometrics, opt-in wipe, appearance, ledger integrity, sample data, Wipe All Data.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useSettings } from '../../app/stores/settings';
import { mutate, useVault, type AutoLock } from '../../app/stores/vault';
import { verifyLedger } from '../../core/ledger/ledger';
import { vaultService } from '../../core/security/vaultService';
import { seedDemoData } from '../../core/utils/demoData';
import { Button, Card, Field, Icon, IconButton, ICONS, Screen, Segmented, Sheet, Toggle } from '../../core/ui/ui';
import { isWeakPin, PinPad } from '../vault-lock/PinPad';
import { useReauth } from '../security/ReauthSheet';

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <span className="text-[14px]">{label}</span>
      <span className={`text-[13px] font-semibold ${ok ? 'text-emerald-text' : 'text-amber-text'}`}>{value}</span>
    </div>
  );
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const s = useSettings();
  const v = useVault();
  const { request, sheet } = useReauth();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [bio, setBio] = useState({ available: false, enrolled: false });
  const [message, setMessage] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState<'pin' | 'decoy' | 'wipe' | 'bio' | null>(null);
  const isDecoy = v.open?.kind === 'decoy';
  const web = vaultService.platform() === 'web';

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
    void vaultService.biometricStatus().then(setBio, () => {});
  }, [sheetOpen]);

  const say = (m: string) => {
    setMessage(m);
    window.setTimeout(() => setMessage(null), 4000);
  };

  return (
    <Screen
      title={t('settings.title')}
      actions={
        <IconButton label={t('onboarding.back')} onClick={() => nav(-1)}>
          <Icon d={ICONS.back} className="h-[22px] w-[22px] rtl:rotate-180" />
        </IconButton>
      }
    >
      {message && (
        <p role="status" className="rounded-2xl bg-surface-2 p-3 text-[13px] font-semibold text-emerald-text" data-testid="settings-message">
          {message}
        </p>
      )}

      <Card className="flex flex-col gap-1">
        <h2 className="mb-1 text-[15px] font-bold">{t('settings.security')}</h2>
        <Row label={t('settings.encryption')} value={t('settings.encryptionOn')} ok />
        <Row label={t('settings.airgap')} value={t('settings.airgapOn')} ok />
        <Row label={t('settings.biometric')} value={bio.enrolled ? '✓' : '—'} ok={bio.enrolled} />
        {web && <Row label={t('settings.storage')} value={persisted ? t('settings.storageOk') : t('settings.storageAsk')} ok={!!persisted} />}
        <Row label={t('settings.lastBackup')} value={t('settings.never')} ok={false} />
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-[15px] font-bold">{t('settings.autolock')}</h2>
        <Segmented<AutoLock>
          label={t('settings.autolock')}
          value={v.autoLockMs}
          onChange={(ms) => request(() => v.setAutoLock(ms))}
          options={[
            { value: 0, label: t('settings.immediate') },
            { value: 15_000, label: t('settings.s15') },
            { value: 60_000, label: t('settings.m1') },
            { value: 300_000, label: t('settings.m5') },
          ]}
        />
        {/* The decoy vault shows no security controls: a coerced user must not reveal the real setup. */}
        {!isDecoy && (
          <>
            <Button variant="secondary" onClick={() => setSheetOpen('pin')}>
              {t('settings.changePin')}
            </Button>
            {bio.available && !bio.enrolled && (
              <Button variant="secondary" onClick={() => setSheetOpen('bio')}>
                {t('settings.biometric')}
              </Button>
            )}
            {bio.enrolled && web && (
              <Button variant="ghost" onClick={() => request(() => void vaultService.disableBiometric().then(() => setBio((b) => ({ ...b, enrolled: false }))))}>
                {t('settings.biometric')} ✕
              </Button>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-[14px] font-semibold">{t('settings.decoy')}</span>
              <span className="text-[12px] text-ink-2">{web ? t('settings.decoyHint') : t('settings.decoyAndroid')}</span>
            </div>
            {web && (
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => request(() => setSheetOpen('decoy'))} data-testid="decoy-set">
                  {t('settings.decoy')}
                </Button>
                {vaultService.hasDecoy() && (
                  <Button variant="ghost" onClick={() => request(() => void vaultService.removeDecoy().then(() => say(t('settings.decoyRemove'))))}>
                    {t('settings.decoyRemove')}
                  </Button>
                )}
              </div>
            )}
            <Toggle label={t('settings.wipe')} description={t('settings.wipeWarn')} checked={v.wipeOnFailures} onChange={(on) => request(() => v.setWipeOnFailures(on))} />
          </>
        )}
      </Card>

      {!isDecoy && (
        <Card className="flex flex-col gap-3">
          <Toggle
            label={t('reminders.enable')}
            description={t('reminders.enableHint')}
            checked={s.reminders}
            onChange={(on) => {
              s.set({ reminders: on });
              if (v.open) void import('../../core/obligations/sync').then((m) => m.syncObligations(v.open!.db));
            }}
          />
          <Toggle
            label={t('reminders.detailed')}
            description={t('reminders.detailedHint')}
            checked={s.detailedNotifications}
            onChange={(on) =>
              request(() => {
                s.set({ detailedNotifications: on });
                if (v.open) void import('../../core/obligations/sync').then((m) => m.syncObligations(v.open!.db));
              })
            }
          />
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="text-[15px] font-bold">{t('settings.appearance')}</h2>
        <Segmented label={t('onboarding.language')} value={s.lang} onChange={(lang) => s.set({ lang })} options={[{ value: 'fa', label: 'فارسی' }, { value: 'en', label: 'English' }]} />
        <Segmented label={t('onboarding.calendar')} value={s.calendar} onChange={(calendar) => s.set({ calendar })} options={[{ value: 'jalali', label: t('calendar.jalali') }, { value: 'gregorian', label: t('calendar.gregorian') }]} />
        <Segmented label={t('onboarding.unit')} value={s.irrUnit} onChange={(irrUnit) => s.set({ irrUnit })} options={[{ value: 'toman', label: t('unit.toman') }, { value: 'rial', label: t('unit.rial') }]} />
        <Segmented label={t('settings.appearance')} value={s.theme} onChange={(theme) => s.set({ theme })} options={[{ value: 'obsidian', label: t('theme.obsidian') }, { value: 'alabaster', label: t('theme.alabaster') }]} />
        <Button variant="secondary" onClick={() => nav('/categories')} data-testid="settings-categories">
          {t('settings.categories')}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-[15px] font-bold">{t('settings.data')}</h2>
        <Button
          variant="secondary"
          data-testid="integrity"
          onClick={async () => {
            const r = await mutate((db) => verifyLedger(db, true));
            say(r.drift.length ? t('settings.integrityFixed', { n: r.drift.length }) : t('settings.integrityOk', { n: r.checked }));
          }}
        >
          {t('settings.integrity')}
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            await mutate((db) => seedDemoData(db, { modest: isDecoy }));
            say(t('settings.demoDone'));
          }}
        >
          {t('settings.demo')}
        </Button>
        <Button variant="danger" onClick={() => request(() => setSheetOpen('wipe'))}>
          {t('settings.wipeAll')}
        </Button>
      </Card>

      <ChangePinSheet open={sheetOpen === 'pin'} onClose={() => setSheetOpen(null)} onDone={() => say(t('settings.pinChanged'))} />
      <DecoySheet open={sheetOpen === 'decoy'} onClose={() => setSheetOpen(null)} onDone={() => say(t('settings.decoySet'))} />
      <BiometricSheet open={sheetOpen === 'bio'} onClose={() => setSheetOpen(null)} onDone={(m) => say(m)} />
      <WipeSheet open={sheetOpen === 'wipe'} onClose={() => setSheetOpen(null)} />
      {sheet}
    </Screen>
  );
}

function ChangePinSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [old, setOld] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOld(null);
    setError(null);
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title={old === null ? t('settings.oldPin') : t('settings.newPin')}>
      <PinPad
        key={old === null ? 'old' : 'new'}
        error={error}
        submitLabel={t('onboarding.next')}
        onSubmit={async (p) => {
          if (old === null) {
            if (await vaultService.verifyPin(p)) {
              setError(null);
              setOld(p);
            } else setError(t('lock.wrong'));
            return;
          }
          if (isWeakPin(p)) return setError(t('onboarding.pinWeak'));
          if (await vaultService.changePin(old, p)) {
            close();
            onDone();
          } else setError(t('lock.wrong'));
        }}
      />
    </Sheet>
  );
}

function DecoySheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={t('settings.decoy')}>
      <p className="text-[13px] text-ink-2">{t('settings.decoyHint')}</p>
      <PinPad
        disabled={busy}
        error={error}
        submitLabel={t('settings.confirm')}
        onSubmit={async (p) => {
          if (isWeakPin(p)) return setError(t('onboarding.pinWeak'));
          if (await vaultService.verifyPin(p)) return setError(t('settings.decoySame'));
          setBusy(true);
          try {
            const decoy = await vaultService.setDecoy(p);
            await seedDemoData(decoy.db, { modest: true, seed: 7 });
            await decoy.db.close();
            onClose();
            onDone();
          } finally {
            setBusy(false);
          }
        }}
      />
    </Sheet>
  );
}

function BiometricSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open={open} onClose={onClose} title={t('settings.biometric')}>
      <PinPad
        error={error}
        submitLabel={t('onboarding.enableBiometric')}
        onSubmit={async (p) => {
          const r = await vaultService.enableBiometric(p).catch(() => 'unsupported' as const);
          if (r === 'bad_pin') return setError(t('lock.wrong'));
          onClose();
          onDone(r === 'enabled' ? '✓' : t('onboarding.biometricUnsupported'));
        }}
      />
    </Sheet>
  );
}

function WipeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [word, setWord] = useState('');
  return (
    <Sheet open={open} onClose={onClose} title={t('settings.wipeAll')}>
      <p className="text-[13px] text-coral-text">{t('settings.wipeWarn')}</p>
      <Field label={t('settings.wipeConfirm')} value={word} onChange={(e) => setWord(e.target.value)} data-testid="wipe-word" />
      <Button
        variant="danger"
        disabled={word.trim() !== t('settings.wipeWord')}
        data-testid="wipe-confirm"
        onClick={async () => {
          const v = useVault.getState();
          const open = v.open;
          useVault.setState({ open: null });
          await vaultService.wipeAll(open);
          v.refreshInitialized();
          onClose();
        }}
      >
        {t('settings.wipeAll')}
      </Button>
    </Sheet>
  );
}
