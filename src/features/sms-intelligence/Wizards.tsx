// Platform setup: Android capture switches + the Android 13+ Restricted Settings wizard
// (1-tap "Open App Info"), and the illustrated 30-second Apple Shortcuts wizard for the iOS PWA.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArizoSms, type InstalledApp, type SmsStatus } from '../../core/bridge/native';
import { useSettings } from '../../app/stores/settings';
import { localDigits } from '../../core/i18n/format';
import { Button, Card, Toggle } from '../../core/ui/ui';
import { drainNativeQueue } from './intake';

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card className="flex gap-3">
      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cta text-[15px] font-bold text-on-accent">
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-[15px] font-bold">{title}</h3>
        {children}
      </div>
    </Card>
  );
}

/** Stylized phone frame illustrating a step (pure SVG, no remote images). */
function Phone({ lines, highlight }: { lines: string[]; highlight: number }) {
  return (
    <svg viewBox="0 0 160 120" className="h-28 w-full max-w-[220px]" role="img" aria-label={lines.join(' · ')}>
      <rect x="40" y="2" width="80" height="116" rx="12" fill="var(--arizo-surface-2)" stroke="var(--arizo-hairline)" />
      {lines.map((l, i) => (
        <g key={i}>
          <rect x="48" y={14 + i * 24} width="64" height="18" rx="5" fill={i === highlight ? 'var(--arizo-accent-luxury)' : 'var(--arizo-surface-3)'} opacity={i === highlight ? 0.9 : 1} />
          <text x="80" y={26 + i * 24} textAnchor="middle" fontSize="7" fill={i === highlight ? '#06080D' : 'var(--arizo-ink-2)'}>
            {l}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function ShortcutsWizard() {
  const { t } = useTranslation();
  const url = `${window.location.origin}${window.location.pathname}#/sms-ingest?d=`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3" data-testid="shortcuts-wizard">
      <p className="text-[13px] leading-6 text-ink-2">{t('sms.ios.intro')}</p>
      <Step n={1} title={t('sms.ios.s1')}>
        <p className="text-[13px] leading-6 text-ink-2">{t('sms.ios.s1d')}</p>
        <Phone lines={['Shortcuts', 'Automation', '+ Message']} highlight={2} />
      </Step>
      <Step n={2} title={t('sms.ios.s2')}>
        <p className="text-[13px] leading-6 text-ink-2">{t('sms.ios.s2d')}</p>
        <Phone lines={['برداشت · واریز', 'مانده', 'Run Immediately']} highlight={2} />
      </Step>
      <Step n={3} title={t('sms.ios.s3')}>
        <p className="text-[13px] leading-6 text-ink-2">{t('sms.ios.s3d')}</p>
        <Phone lines={['Message', 'Base64 Encode', 'Open URL']} highlight={1} />
      </Step>
      <Step n={4} title={t('sms.ios.s4')}>
        <p className="text-[13px] leading-6 text-ink-2">{t('sms.ios.s4d')}</p>
        <code dir="ltr" className="block break-all rounded-lg bg-surface-3 px-2 py-2 text-start text-[12px]" data-testid="shortcut-url">
          {url}
          <span className="text-gold-text">[Base64 Encoded]</span>
        </code>
        <Button
          variant="secondary"
          onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => {})}
        >
          {copied ? t('sms.copied') : t('sms.copyUrl')}
        </Button>
      </Step>
      <Card className="text-[13px] leading-6 text-ink-2">{t('sms.ios.privacy')}</Card>
    </div>
  );
}

export function AndroidCapture() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const [st, setSt] = useState<SmsStatus | null>(null);
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [days, setDays] = useState<30 | 90 | 365>(30);
  const [scan, setScan] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const refresh = () => ArizoSms.status().then(setSt, () => setErr(true));
  useEffect(() => {
    void refresh();
    // Returning from system settings: re-read permissions.
    const onVis = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (err) return <p className="py-8 text-center text-[14px] text-ink-2">{t('sms.android.unavailable')}</p>;
  if (!st) return null;
  const blocked = st.restrictedSettings && (!st.smsPermission || !st.notificationAccess);

  return (
    <div className="flex flex-col gap-3" data-testid="android-capture">
      {blocked && (
        <>
          <p className="text-[13px] leading-6 text-ink-2">{t('sms.android.restrictedIntro')}</p>
          <Step n={1} title={t('sms.android.r1')}>
            <p className="text-[13px] leading-6 text-ink-2">{t('sms.android.r1d')}</p>
            <Button onClick={() => void ArizoSms.openAppInfo()} data-testid="open-app-info">
              {t('sms.android.openAppInfo')}
            </Button>
          </Step>
          <Step n={2} title={t('sms.android.r2')}>
            <p className="text-[13px] leading-6 text-ink-2">{t('sms.android.r2d')}</p>
          </Step>
        </>
      )}
      <Card className="flex flex-col gap-2">
        <Toggle
          label={t('sms.android.sms')}
          description={st.smsEnabled && !st.smsPermission ? t('sms.android.needPermission') : t('sms.android.smsHint')}
          checked={st.smsEnabled && st.smsPermission}
          onChange={(v) => void ArizoSms.setSmsEnabled({ enabled: v }).then(setSt, () => {})}
        />
        <Toggle
          label={t('sms.android.push')}
          description={t('sms.android.pushHint')}
          checked={st.notificationsEnabled && st.notificationAccess}
          onChange={(v) => {
            if (v && !st.notificationAccess) void ArizoSms.openNotificationAccess();
            void ArizoSms.setNotificationsEnabled({ enabled: v, packages: st.packages }).then(setSt, () => {});
          }}
        />
      </Card>
      {st.notificationsEnabled && (
        <Card className="flex flex-col gap-2">
          <h3 className="text-[15px] font-bold">{t('sms.android.apps')}</h3>
          <p className="text-[12px] text-ink-2">{t('sms.android.appsHint')}</p>
          {!apps && (
            <Button variant="secondary" onClick={() => void ArizoSms.listApps().then((r) => setApps(r.apps), () => setApps([]))}>
              {t('sms.android.chooseApps')}
            </Button>
          )}
          {apps?.map((a) => {
            const on = st.packages.includes(a.packageName);
            return (
              <Toggle
                key={a.packageName}
                label={a.label}
                description={a.packageName}
                checked={on}
                onChange={(v) => {
                  const packages = v ? [...st.packages, a.packageName] : st.packages.filter((p) => p !== a.packageName);
                  void ArizoSms.setNotificationsEnabled({ enabled: true, packages }).then(setSt, () => {});
                }}
              />
            );
          })}
        </Card>
      )}
      {st.smsEnabled && st.smsPermission && (
        <Card className="flex flex-col gap-2">
          <h3 className="text-[15px] font-bold">{t('sms.android.history')}</h3>
          <p className="text-[12px] text-ink-2">{t('sms.android.historyHint')}</p>
          <div className="flex gap-2">
            {([30, 90, 365] as const).map((d) => (
              <Button key={d} variant={days === d ? 'primary' : 'secondary'} className="flex-1" onClick={() => setDays(d)}>
                {t('sms.android.days', { n: localDigits(d, lang) })}
              </Button>
            ))}
          </div>
          <Button
            disabled={scan === '…'}
            onClick={() => {
              setScan('…');
              void ArizoSms.scanInbox({ days })
                .then(async (r) => {
                  await drainNativeQueue();
                  setScan(t('sms.android.scanDone', { s: localDigits(r.scanned, lang), q: localDigits(r.queued, lang) }));
                })
                .catch(() => setScan(t('sms.android.scanFail')));
            }}
          >
            {scan === '…' ? t('sms.android.scanning') : t('sms.android.scan')}
          </Button>
          {scan && scan !== '…' && <p role="status" className="text-[13px] text-ink-2">{scan}</p>}
        </Card>
      )}
      <Card className="text-[13px] leading-6 text-ink-2">{t('sms.android.privacy')}</Card>
    </div>
  );
}
