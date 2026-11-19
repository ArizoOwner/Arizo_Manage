// Guided onboarding (PROMPT.md §7 #1): language, calendar, unit → PIN (+confirm) → no-recovery
// warning → biometrics → SMS note → first account (BIN auto-detect) or sample data.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { mutate, useVault } from '../../app/stores/vault';
import { vaultService, type OpenVault } from '../../core/security/vaultService';
import { Button, Card, Segmented } from '../../core/ui/ui';
import { seedDemoData } from '../../core/utils/demoData';
import { AccountForm } from '../accounts/AccountForm';
import { isWeakPin, PinPad } from './PinPad';

type Step = 'welcome' | 'prefs' | 'pin' | 'confirm' | 'warn' | 'biometric' | 'sms' | 'account';

export function Onboarding() {
  const { t } = useTranslation();
  const s = useSettings();
  const [step, setStep] = useState<Step>('welcome');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<OpenVault | null>(null);
  const [pin, setPin] = useState('');
  const [bioMsg, setBioMsg] = useState<string | null>(null);

  const finish = async (v: OpenVault) => {
    await useVault.getState().setOpen(v);
  };

  const body = (() => {
    switch (step) {
      case 'welcome':
        return (
          <Card className="flex flex-col gap-4 p-6 text-center">
            <h1 className="text-[26px] font-extrabold text-gold-text">{t('onboarding.welcome')}</h1>
            <p className="text-[15px] leading-7 text-ink-2">{t('onboarding.welcomeBody')}</p>
            <Button onClick={() => setStep('prefs')}>{t('onboarding.start')}</Button>
          </Card>
        );
      case 'prefs':
        return (
          <Card className="flex flex-col gap-5">
            <Segmented label={t('onboarding.language')} value={s.lang} onChange={(lang) => s.set({ lang, calendar: lang === 'fa' ? 'jalali' : s.calendar })} options={[{ value: 'fa', label: 'فارسی' }, { value: 'en', label: 'English' }]} />
            <Segmented label={t('onboarding.calendar')} value={s.calendar} onChange={(calendar) => s.set({ calendar })} options={[{ value: 'jalali', label: t('calendar.jalali') }, { value: 'gregorian', label: t('calendar.gregorian') }]} />
            <Segmented label={t('onboarding.unit')} value={s.irrUnit} onChange={(irrUnit) => s.set({ irrUnit })} options={[{ value: 'toman', label: t('unit.toman') }, { value: 'rial', label: t('unit.rial') }]} />
            <Button onClick={() => setStep('pin')}>{t('onboarding.next')}</Button>
          </Card>
        );
      case 'pin':
        return (
          <PinStep
            title={t('onboarding.createPin')}
            error={error}
            onSubmit={(p) => {
              if (isWeakPin(p)) return setError(t('onboarding.pinWeak'));
              setError(null);
              setFirst(p);
              setStep('confirm');
            }}
          />
        );
      case 'confirm':
        return (
          <PinStep
            title={t('onboarding.confirmPin')}
            error={error}
            disabled={busy}
            onSubmit={async (p) => {
              if (p !== first) {
                setError(t('onboarding.pinMismatch'));
                setFirst('');
                return setStep('pin');
              }
              setBusy(true);
              try {
                const v = await vaultService.create(p);
                setOpen(v);
                setPin(p);
                setStep('warn');
              } finally {
                setBusy(false);
              }
            }}
          />
        );
      case 'warn':
        return (
          <Card className="flex flex-col gap-4 border-amber/40">
            <h2 className="text-[18px] font-bold text-amber-text">{t('onboarding.warnTitle')}</h2>
            <p className="text-[14px] leading-7 text-ink-2">{t('onboarding.warnBody')}</p>
            <Button onClick={() => setStep('biometric')}>{t('onboarding.warnAck')}</Button>
          </Card>
        );
      case 'biometric':
        return (
          <Card className="flex flex-col gap-4">
            <h2 className="text-[18px] font-bold">{t('onboarding.biometricTitle')}</h2>
            <p className="text-[14px] leading-7 text-ink-2">{bioMsg ?? t('onboarding.biometricBody')}</p>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={busy || !!bioMsg}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await vaultService.enableBiometric(pin);
                    if (r === 'enabled') setStep('sms');
                    else setBioMsg(t('onboarding.biometricUnsupported'));
                  } catch {
                    setBioMsg(t('onboarding.biometricUnsupported'));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('onboarding.enableBiometric')}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setStep('sms')}>
                {bioMsg ? t('onboarding.next') : t('onboarding.skip')}
              </Button>
            </div>
          </Card>
        );
      case 'sms':
        return (
          <Card className="flex flex-col gap-4">
            <h2 className="text-[18px] font-bold">{t('onboarding.smsTitle')}</h2>
            <p className="text-[14px] leading-7 text-ink-2">{vaultService.platform() === 'android' ? t('onboarding.smsAndroid') : t('onboarding.smsIos')}</p>
            <Button
              onClick={() => {
                setPin(''); // the PIN is no longer needed once biometrics are set up
                setStep('account');
              }}
            >
              {t('onboarding.next')}
            </Button>
          </Card>
        );
      case 'account':
        return (
          <div className="flex flex-col gap-4">
            <h2 className="text-[18px] font-bold">{t('onboarding.firstAccount')}</h2>
            <AccountForm
              db={open!.db}
              submitLabel={t('onboarding.finish')}
              onSaved={() => void finish(open!)}
            />
            <Button
              variant="ghost"
              disabled={busy}
              data-testid="onboarding-demo"
              onClick={async () => {
                setBusy(true);
                await seedDemoData(open!.db);
                await finish(open!);
              }}
            >
              {t('onboarding.demo')}
            </Button>
          </div>
        );
    }
  })();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]">
      {body}
      {busy && step === 'confirm' && (
        <p role="status" className="text-center text-[13px] text-ink-2">
          {t('onboarding.creating')}
        </p>
      )}
    </main>
  );
}

function PinStep({ title, onSubmit, error, disabled }: { title: string; onSubmit: (p: string) => void | Promise<void>; error: string | null; disabled?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-6">
      <h2 className="text-center text-[18px] font-bold">{title}</h2>
      <PinPad onSubmit={onSubmit} error={error} disabled={disabled ?? false} />
    </div>
  );
}

/** Used by Settings → "Add sample data" too. */
export const addSampleData = () => mutate((db) => seedDemoData(db));
