// Backup & Restore (#/backup), PROMPT.md §7 #8: create an encrypted .arizo file (passphrase + optional
// 24-word Recovery Key), Dry-Run Restore Inspector, Safe Replace / Smart Merge, rolling local snapshots
// and the backup reminder. Every create/restore needs a fresh PIN. Everything acts on the open vault
// only: inside a decoy session it is the decoy's data, and nothing here reads or reveals the real vault.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { mutate, useVault } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { BackupError, type Secret } from '../../core/backup/container';
import { workerEngine } from '../../core/backup/engine';
import { totalRows, type Snapshot } from '../../core/backup/payload';
import { generateRecoveryKey, parseRecoveryKey } from '../../core/backup/recovery';
import { backupState, createBackup, inspectBackup, listSnapshots, loadSnapshot, recoveryRecord, removeRecovery, restoreBackup, saveRecovery, setRemindDays, type RestoreMode } from '../../core/backup/service';
import { acceptablePassphrase, passphraseStrength } from '../../core/backup/strength';
import { te, zeroize } from '../../core/crypto/bytes';
import { formatDate, localDigits } from '../../core/i18n/format';
import { deliverFile, printDocument } from '../../core/print/deliver';
import { vaultService } from '../../core/security/vaultService';
import { Button, Card, Field, Screen, Segmented, Sheet } from '../../core/ui/ui';
import { BackButton } from '../obligations/shared';
import { useReauth } from '../security/ReauthSheet';
import { PrintPortal } from '../invoices/paper';

const MAX_FILE = 600 * 1024 * 1024;
const COUNTED = ['accounts', 'transactions', 'cheques', 'loans', 'debts_receivables', 'invoices', 'attachments'] as const;
const deps = () => ({ engine: workerEngine, platform: vaultService.platform(), params: vaultService.backupArgonParams() });

const errorKey = (e: unknown) => `backup.err.${e instanceof BackupError ? e.code : 'BACKUP_FORMAT'}`;

function StrengthMeter({ value }: { value: string }) {
  const { t } = useTranslation();
  const { score } = passphraseStrength(value);
  const color = ['bg-coral', 'bg-coral', 'bg-amber', 'bg-emerald', 'bg-emerald'][score];
  return (
    <div className="flex flex-col gap-1" data-testid="strength" data-score={score}>
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${value && i < Math.max(score, 1) ? color : 'bg-surface-3'}`} />
        ))}
      </div>
      <span className="text-[12px] text-ink-2" aria-live="polite">
        {value ? t(`backup.strength.${score}`) : t('backup.strengthHint')}
      </span>
    </div>
  );
}

export function BackupScreen() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const isDecoy = useVault((s) => s.open?.kind === 'decoy');
  const { request, sheet } = useReauth();
  const { data } = useVaultQuery(async (db) => ({ state: await backupState(db), recovery: await recoveryRecord(db), snapshots: await listSnapshots(db) }));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [file, setFile] = useState<Uint8Array | null>(null);
  const [secretKind, setSecretKind] = useState<'passphrase' | 'recovery'>('passphrase');
  const [secret, setSecret] = useState('');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [mode, setMode] = useState<RestoreMode>('replace');
  const date = (ms: number) => formatDate(ms, cal, lang, { withYear: true });

  const run = (fn: () => Promise<void>) =>
    request(async () => {
      setBusy(true);
      setMsg(null);
      try {
        await fn();
      } catch (e) {
        setMsg({ ok: false, text: t(errorKey(e)) });
      } finally {
        setBusy(false);
      }
    });

  const canCreate = acceptablePassphrase(pass) && pass === pass2 && !busy;
  const create = () =>
    run(async () => {
      const { bytes } = await mutate((db) => createBackup(db, pass, deps()));
      setPass('');
      setPass2('');
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const r = await deliverFile(bytes, `arizo-backup-${stamp}.arizo`, 'application/octet-stream', t('backup.title'));
      setMsg({ ok: true, text: r === 'cancelled' ? t('backup.createdNotShared') : t('backup.created') });
    });

  const inspect = async () => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    setSnap(null);
    try {
      let s: Secret;
      if (secretKind === 'recovery') {
        const entropy = await parseRecoveryKey(secret);
        if (!entropy) throw new BackupError('BACKUP_AUTH');
        s = { kind: 'recovery', entropy };
      } else s = { kind: 'passphrase', bytes: te.encode(secret.normalize('NFKC')) };
      setSnap(await inspectBackup(file, s, workerEngine));
      setSecret('');
    } catch (e) {
      setMsg({ ok: false, text: t(errorKey(e)) });
    } finally {
      setBusy(false);
    }
  };

  const restore = (load: () => Promise<Snapshot>, m: RestoreMode) =>
    run(async () => {
      const s = await load();
      const r = await mutate((db) => restoreBackup(db, s, m, deps()));
      if (!isDecoy) void import('../../core/obligations/sync').then((x) => x.syncObligations(useVault.getState().db())).catch(() => {});
      setSnap(null);
      setFile(null);
      setMsg({ ok: true, text: r.merge ? t('backup.merged', { added: localDigits(r.merge.added, lang), updated: localDigits(r.merge.updated, lang), skipped: localDigits(r.merge.skipped + r.merge.kept, lang) }) : t('backup.replaced') });
    });

  return (
    <Screen title={t('backup.title')} actions={<BackButton />}>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} data-testid="backup-message" className={`rounded-2xl bg-surface-2 p-3 text-[13px] font-semibold ${msg.ok ? 'text-emerald-text' : 'text-coral-text'}`}>
          {msg.text}
        </p>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-[14px]">{t('settings.lastBackup')}</span>
          <span className={`text-[13px] font-semibold ${data?.state.last_backup_at ? 'text-emerald-text' : 'text-amber-text'}`} data-testid="last-backup">
            {data?.state.last_backup_at ? date(data.state.last_backup_at) : t('settings.never')}
          </span>
        </div>
        <Segmented<number>
          label={t('backup.remind')}
          value={data?.state.remind_days ?? 7}
          onChange={(d) => void mutate((db) => setRemindDays(db, d))}
          options={[
            { value: 0, label: t('backup.remindOff') },
            { value: 7, label: t('backup.remind7') },
            { value: 30, label: t('backup.remind30') },
          ]}
        />
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-[15px] font-bold">{t('backup.create')}</h2>
        <p className="rounded-2xl border border-coral/40 p-3 text-[13px] leading-6 text-coral-text" data-testid="no-backdoor">
          {t('backup.warning')}
        </p>
        <Field label={t('backup.passphrase')} type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} data-testid="backup-pass" hint={t('backup.passHint')} />
        <StrengthMeter value={pass} />
        <Field label={t('backup.passphrase2')} type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} data-testid="backup-pass2" error={pass2 && pass !== pass2 ? t('backup.mismatch') : undefined} />
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-[14px]">{t('backup.recovery')}</span>
          <span className={`text-[13px] font-semibold ${data?.recovery ? 'text-emerald-text' : 'text-ink-2'}`} data-testid="recovery-status">
            {data?.recovery ? t('backup.recoveryOn') : t('backup.recoveryOff')}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => request(() => setRecoveryOpen(true))} data-testid="recovery-setup">
            {data?.recovery ? t('backup.recoveryNew') : t('backup.recoverySetup')}
          </Button>
          {data?.recovery && (
            <Button variant="ghost" onClick={() => request(() => void mutate((db) => removeRecovery(db)))}>
              {t('backup.recoveryRemove')}
            </Button>
          )}
        </div>
        <Button disabled={!canCreate} onClick={create} data-testid="backup-create">
          {busy ? t('backup.working') : t('backup.createBtn')}
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-[15px] font-bold">{t('backup.restore')}</h2>
        <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-2xl bg-surface-3 text-[15px] font-semibold">
          {file ? t('backup.fileReady', { kb: localDigits(Math.ceil(file.length / 1024), lang) }) : t('backup.pick')}
          <input
            type="file"
            accept=".arizo,application/octet-stream"
            className="sr-only"
            data-testid="restore-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              setSnap(null);
              if (!f) return;
              if (f.size > MAX_FILE) return setMsg({ ok: false, text: t('backup.err.BACKUP_TOO_LARGE') });
              setSecretKind('passphrase');
              setSecret('');
              setFile(new Uint8Array(await f.arrayBuffer()));
            }}
          />
        </label>
        {file && !snap && (
          <>
            <Segmented<'passphrase' | 'recovery'>
              label={t('backup.unlockWith')}
              value={secretKind}
              onChange={(k) => {
                setSecretKind(k);
                setSecret('');
              }}
              options={[
                { value: 'passphrase', label: t('backup.passphrase') },
                { value: 'recovery', label: t('backup.recovery') },
              ]}
            />
            {secretKind === 'passphrase' ? (
              <Field label={t('backup.passphrase')} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} data-testid="restore-pass" />
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink-2">{t('backup.recoveryWords')}</span>
                <textarea dir="ltr" rows={4} autoComplete="off" spellCheck={false} value={secret} onChange={(e) => setSecret(e.target.value)} className="rounded-2xl bg-surface-3 p-3 font-mono text-[14px] text-ink" data-testid="restore-words" />
              </label>
            )}
            <Button variant="secondary" disabled={!secret || busy} onClick={() => void inspect()} data-testid="restore-inspect">
              {busy ? t('backup.working') : t('backup.inspect')}
            </Button>
          </>
        )}
        {snap && (
          <div className="flex flex-col gap-3" data-testid="restore-preview">
            <p className="text-[13px] text-ink-2">{t('backup.dryRun')}</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-ink-2">{t('backup.madeAt')}</dt>
              <dd className="text-end font-semibold">{date(snap.manifest.created_at)}</dd>
              <dt className="text-ink-2">{t('backup.madeOn')}</dt>
              <dd className="text-end font-semibold">{t(`backup.platform.${snap.manifest.platform}`)}</dd>
              <dt className="text-ink-2">{t('backup.version')}</dt>
              <dd className="text-end font-semibold" dir="ltr">
                {snap.manifest.app_version}
              </dd>
              {COUNTED.map((s) => (
                <div key={s} className="contents">
                  <dt className="text-ink-2">{t(`backup.counts.${s}`)}</dt>
                  <dd className="text-end font-semibold" data-testid={`count-${s}`}>
                    {localDigits(snap.manifest.counts[s], lang)}
                  </dd>
                </div>
              ))}
              <dt className="text-ink-2">{t('backup.counts.total')}</dt>
              <dd className="text-end font-semibold">{localDigits(totalRows(snap.manifest), lang)}</dd>
            </dl>
            {snap.manifest.missing_blobs > 0 && <p className="text-[12px] text-amber-text">{t('backup.missingBlobs', { n: snap.manifest.missing_blobs })}</p>}
            <Segmented<RestoreMode>
              label={t('backup.mode')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'replace', label: t('backup.replace') },
                { value: 'merge', label: t('backup.merge') },
              ]}
            />
            <p className="text-[12px] leading-5 text-ink-2">{t(mode === 'replace' ? 'backup.replaceHint' : 'backup.mergeHint')}</p>
            <div className="flex gap-2">
              <Button variant={mode === 'replace' ? 'danger' : 'primary'} className="flex-1" disabled={busy} onClick={() => restore(async () => snap, mode)} data-testid="restore-apply">
                {busy ? t('backup.working') : t('backup.apply')}
              </Button>
              <Button variant="ghost" onClick={() => setSnap(null)}>
                {t('backup.cancel')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-[15px] font-bold">{t('backup.snapshots')}</h2>
        <p className="text-[12px] leading-5 text-ink-2">{t('backup.snapshotsHint')}</p>
        {!data?.snapshots.length && <p className="text-[13px] text-ink-2">{t('backup.noSnapshots')}</p>}
        {data?.snapshots.map((s) => (
          <div key={s.id} className="flex min-h-12 items-center justify-between gap-3" data-testid="snapshot-row">
            <span className="flex flex-col">
              <span className="text-[14px] font-semibold">{date(s.created_at)}</span>
              <span className="text-[12px] text-ink-2">
                {t(`backup.reason.${s.reason}`)} · {t('backup.rows', { n: localDigits(s.rows, lang) })}
              </span>
            </span>
            <Button variant="secondary" disabled={busy} onClick={() => restore(() => loadSnapshot(useVault.getState().db(), s.id, workerEngine), 'replace')}>
              {t('backup.restoreSnapshot')}
            </Button>
          </div>
        ))}
      </Card>

      <RecoverySheet open={recoveryOpen} onClose={() => setRecoveryOpen(false)} onSaved={() => setMsg({ ok: true, text: t('backup.recoverySaved') })} />
      {sheet}
    </Screen>
  );
}

/** Generate 24 words, show and optionally print them, then check 3 random positions before saving. */
function RecoverySheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const [key, setKey] = useState<{ entropy: Uint8Array; words: string[] } | null>(null);
  const [step, setStep] = useState<'show' | 'verify'>('show');
  const [answers, setAnswers] = useState(['', '', '']);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (open && !key) void generateRecoveryKey().then(setKey);
  }, [open, key]);

  const ask = useMemo(() => {
    const pick = new Set<number>();
    const r = new Uint32Array(16);
    crypto.getRandomValues(r);
    for (const x of r) if (pick.size < 3) pick.add(x % 24);
    return [...pick].sort((a, b) => a - b);
  }, [key]);

  const close = () => {
    if (key) zeroize(key.entropy);
    setKey(null);
    setStep('show');
    setAnswers(['', '', '']);
    setError(false);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={t('backup.recovery')}>
      {key && step === 'show' && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-6 text-ink-2">{t('backup.recoveryHint')}</p>
          <ol dir="ltr" className="grid grid-cols-3 gap-2 font-mono text-[13px]" data-testid="recovery-words">
            {key.words.map((w, i) => (
              <li key={i} className="rounded-xl bg-surface-3 px-2 py-1.5">
                <span className="text-ink-2">{i + 1}.</span> {w}
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => void printDocument('arizo-recovery-key')}>
              {t('backup.print')}
            </Button>
            <Button className="flex-1" onClick={() => setStep('verify')} data-testid="recovery-next">
              {t('backup.wroteThem')}
            </Button>
          </div>
          <PrintPortal paper="A5">
            <div className="doc doc-A5 t-minimal" dir="ltr">
              <h2 className="doc-title">Arizo Manage — Recovery Key</h2>
              <p>{t('backup.recoveryPrintNote')}</p>
              <ol style={{ columns: 3, fontFamily: 'monospace', fontSize: '11pt', lineHeight: 2 }}>
                {key.words.map((w, i) => (
                  <li key={i}>
                    {i + 1}. {w}
                  </li>
                ))}
              </ol>
            </div>
          </PrintPortal>
        </div>
      )}
      {key && step === 'verify' && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ask.every((pos, i) => answers[i]!.trim().toLowerCase() === key.words[pos])) return setError(true);
            await mutate((db) => saveRecovery(db, key.entropy.slice()));
            onSaved();
            close();
          }}
        >
          <p className="text-[13px] text-ink-2">{t('backup.verifyHint')}</p>
          {ask.map((pos, i) => (
            <Field
              key={pos}
              dir="ltr"
              autoComplete="off"
              label={t('backup.wordN', { n: localDigits(pos + 1, lang) })}
              value={answers[i]}
              onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
              data-testid={`verify-${i}`}
              data-pos={pos}
            />
          ))}
          {error && (
            <p role="alert" className="text-[13px] font-semibold text-coral-text">
              {t('backup.verifyWrong')}
            </p>
          )}
          <Button type="submit" data-testid="recovery-save">
            {t('backup.recoverySave')}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
