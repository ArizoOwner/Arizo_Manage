// Optional ESC/POS thermal printer (Android only). Off by default; turning it on is the only moment
// Android asks for Bluetooth permission. The target (a bonded printer's address, or a LAN IP:port) is
// a device preference, not financial data, so it lives in localStorage.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNative } from '../../core/bridge/native';
import { ArizoThermalPrint, isPrivateLanIp, type ThermalStatus } from '../../core/print/deliver';
import { Card, Field, Segmented, Toggle } from '../../core/ui/ui';

const KEY = 'arizo.thermal.v1';
type Target = { kind: 'bt'; address: string } | { kind: 'tcp'; host: string; port: number };
interface Saved {
  enabled: boolean;
  target: Target | null;
}
const read = (): Saved => {
  try {
    return { enabled: false, target: null, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>) };
  } catch {
    return { enabled: false, target: null };
  }
};
const write = (s: Saved) => localStorage.setItem(KEY, JSON.stringify(s));

export function useThermalTarget(): Target | null {
  const s = read();
  return isNative() && s.enabled ? s.target : null;
}

export function ThermalSettings() {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(read);
  const [status, setStatus] = useState<ThermalStatus | null>(null);
  const [host, setHost] = useState(saved.target?.kind === 'tcp' ? saved.target.host : '');
  const [port, setPort] = useState(saved.target?.kind === 'tcp' ? String(saved.target.port) : '9100');
  const [mode, setMode] = useState<'bt' | 'tcp'>(saved.target?.kind ?? 'bt');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (isNative()) void ArizoThermalPrint.status().then(setStatus, () => {});
  }, []);

  if (!isNative()) return <p className="text-[13px] text-ink-2">{t('thermal.androidOnly')}</p>;
  const update = (s: Saved) => {
    write(s);
    setSaved(s);
  };
  const saveTcp = () => {
    const p = Number(port);
    if (!isPrivateLanIp(host) || !Number.isInteger(p) || p < 1 || p > 65535) return setErr(t('thermal.badIp'));
    setErr(null);
    update({ ...saved, target: { kind: 'tcp', host: host.trim(), port: p } });
  };

  return (
    <Card className="flex flex-col gap-3">
      <Toggle
        label={t('thermal.enable')}
        description={t('thermal.enableHint')}
        checked={saved.enabled}
        onChange={async (on) => {
          const st = await ArizoThermalPrint.setEnabled({ enabled: on }).catch(() => null);
          if (st) setStatus(st);
          update({ ...saved, enabled: on });
        }}
      />
      {saved.enabled && (
        <>
          <Segmented<'bt' | 'tcp'> label={t('thermal.connection')} value={mode} onChange={setMode} options={[{ value: 'bt', label: t('thermal.bluetooth') }, { value: 'tcp', label: t('thermal.wifi') }]} />
          {mode === 'bt' ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-ink-2">{t('thermal.printer')}</span>
              <select
                value={saved.target?.kind === 'bt' ? saved.target.address : ''}
                onChange={(e) => update({ ...saved, target: e.target.value ? { kind: 'bt', address: e.target.value } : null })}
                className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink"
              >
                <option value="">{status?.bluetoothPermission === false ? t('thermal.noPermission') : t('thermal.pick')}</option>
                {(status?.bonded ?? []).map((d) => (
                  <option key={d.address} value={d.address}>
                    {d.name || d.address}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Field className="col-span-2" label={t('thermal.ip')} value={host} onChange={(e) => setHost(e.target.value)} onBlur={saveTcp} inputMode="decimal" dir="ltr" placeholder="192.168.1.50" error={err ?? undefined} />
              <Field label={t('thermal.port')} value={port} onChange={(e) => setPort(e.target.value)} onBlur={saveTcp} inputMode="numeric" dir="ltr" />
            </div>
          )}
          <p className="text-[12px] text-ink-2">{t('thermal.note')}</p>
        </>
      )}
    </Card>
  );
}
