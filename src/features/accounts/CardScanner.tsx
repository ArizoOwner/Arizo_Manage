// Card scanner sheet: the rear camera inside a card-shaped guide, frames read on-device (OCR worker),
// readings merged until the number is confirmed by two frames. Nothing is recorded or kept: frames live
// in a scratch canvas, the stream stops and the worker is terminated when the sheet closes or the vault
// locks. The user reviews every field in the form before saving.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { useVault } from '../../app/stores/vault';
import { framePng } from '../../core/cardscan/frames';
import { endOcr, recognize } from '../../core/cardscan/ocrClient';
import { mergeScans, parseCardText, type CardScan } from '../../core/cardscan/parseCard';
import { localDigits } from '../../core/i18n/format';
import { haptic } from '../../core/motion/motion';
import { Glyph } from '../../core/ui/glyphs';
import { Button } from '../../core/ui/ui';

export interface ScanResult {
  number: string;
  expiry: string | null;
  expiryJalali: boolean;
  cvv2: string | null;
  sheba: string | null;
  bankCode: string | null;
}

type Phase = 'starting' | 'scanning' | 'found' | 'denied' | 'unsupported';
const MAX_FRAMES = 14;

export function CardScanner({ onClose, onResult }: { onClose: () => void; onResult: (r: ScanResult) => void }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const reduce = useReducedMotion();
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [result, setResult] = useState<(CardScan & { confident: boolean }) | null>(null);
  const [frames, setFrames] = useState(0);
  // Close when the vault locks while the sheet is open. Onboarding runs before the vault is "open" in the
  // store, so only an open -> locked change counts, not the state at mount.
  useEffect(() => useVault.subscribe((s, prev) => void (prev.open && !s.open && onClose())), [onClose]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    const reads: CardScan[] = [];
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setPhase('unsupported');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      } catch {
        return setPhase('denied');
      }
      if (stop) return;
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      setPhase('scanning');
      for (let n = 0; n < MAX_FRAMES && !stop; ) {
        if (!v.videoWidth) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        n++;
        // The guide is 86 % of the frame at the ID-1 card ratio (85.6 × 54 mm), centred.
        const w = Math.round(Math.min(v.videoWidth, v.videoHeight * 1.586) * 0.86);
        const h = Math.round(w / 1.586);
        const crop = { x: Math.round((v.videoWidth - w) / 2), y: Math.round((v.videoHeight - h) / 2), w, h };
        try {
          const r = await recognize(await framePng(v, crop));
          if (stop) break;
          reads.push(parseCardText(r.text));
          setFrames(reads.length);
          const m = mergeScans(reads);
          if (m.number) {
            setResult(m);
            if (m.confident && (m.expiry || reads.length >= 6)) break;
          }
        } catch {
          break;
        }
      }
      if (!stop) {
        haptic.medium();
        setPhase('found');
      }
      stream?.getTracks().forEach((tr) => tr.stop());
      endOcr();
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((tr) => tr.stop());
      endOcr();
    };
  }, []);

  const groups = (n: string) => n.replace(/(\d{4})(?=\d)/g, '$1 ');
  const row = (label: string, value: string | null, glyph: string, testid: string) => (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-hairline bg-surface-2/70 p-3">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${value ? 'bg-emerald/15 text-emerald-text' : 'bg-surface-3 text-ink-3'}`}>
        <Glyph name={value ? 'shieldCheck' : glyph} className="h-[18px] w-[18px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11px] text-ink-2">{label}</span>
        <span className="truncate text-[15px] font-bold tabular text-ink" dir="ltr" data-testid={testid}>
          {value ? localDigits(value, lang) : t('scan.notRead')}
        </span>
      </span>
    </div>
  );
  const corners = ['start-0 top-0 border-s-[3px] border-t-[3px] rounded-ss-[22px]', 'end-0 top-0 border-e-[3px] border-t-[3px] rounded-se-[22px]', 'start-0 bottom-0 border-s-[3px] border-b-[3px] rounded-es-[22px]', 'end-0 bottom-0 border-e-[3px] border-b-[3px] rounded-ee-[22px]'];

  return (
    <div role="dialog" aria-modal="true" aria-label={t('scan.title')} className="fixed inset-0 z-[60] flex flex-col bg-black" data-testid="card-scanner">
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" aria-hidden="true" />
        {/* Guide: everything outside the card window is dimmed; gold corners and a sweeping scan line. */}
        <div aria-hidden="true" className="absolute inset-0 grid place-items-center">
          <div className="relative aspect-[1.586] w-[86%] max-w-[34rem] rounded-[22px] shadow-[0_0_0_200vmax_rgba(0,0,0,0.62)]">
            {corners.map((c) => (
              <span key={c} className={`absolute h-10 w-10 border-gold-mark ${c}`} />
            ))}
            {phase === 'scanning' && !reduce && (
              <motion.span
                className="absolute inset-x-4 h-[2px] rounded-full bg-[linear-gradient(90deg,transparent,var(--arizo-accent-primary),transparent)] shadow-[0_0_18px_var(--arizo-accent-primary)]"
                initial={{ top: '8%' }}
                animate={{ top: ['8%', '92%', '8%'] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
            <AnimatePresence>
              {phase === 'found' && result?.number && (
                <motion.span initial={reduce ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="absolute inset-0 grid place-items-center rounded-[22px] bg-emerald/15 ring-2 ring-emerald">
                  <Glyph name="shieldCheck" className="h-14 w-14 text-emerald-text" />
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
          <span className="rounded-full bg-black/50 px-3 py-1.5 text-[13px] font-semibold text-white backdrop-blur">{t('scan.title')}</span>
          <button type="button" onClick={onClose} aria-label={t('scan.close')} className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white backdrop-blur">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <p role="status" className="absolute inset-x-6 bottom-6 text-center text-[13px] font-semibold text-white/90">
          {phase === 'starting' && t('scan.starting')}
          {phase === 'scanning' && t('scan.hold', { n: localDigits(frames, lang) })}
          {phase === 'denied' && t('scan.denied')}
          {phase === 'unsupported' && t('scan.unsupported')}
          {phase === 'found' && !result?.number && t('scan.none')}
        </p>
      </div>
      <div className="flex flex-col gap-2.5 rounded-t-[28px] border-t border-specular bg-surface-1 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {row(t('scan.number'), result?.number ? groups(result.number) : null, 'wallet', 'scan-number')}
        <div className="grid grid-cols-2 gap-2.5">
          {row(result?.expiryJalali ? t('scan.expiryJalali') : t('scan.expiry'), result?.expiry ?? null, 'bell', 'scan-expiry')}
          {row(t('scan.cvv2'), result?.cvv2 ? '•'.repeat(result.cvv2.length) : null, 'shieldCheck', 'scan-cvv2')}
        </div>
        <p className="text-[11.5px] leading-5 text-ink-2">{t('scan.privacy')}</p>
        <Button
          disabled={!result?.number}
          data-testid="scan-use"
          onClick={() => {
            if (!result?.number) return;
            onResult({ number: result.number, expiry: result.expiry, expiryJalali: result.expiryJalali, cvv2: result.cvv2, sheba: result.sheba, bankCode: result.bank?.code ?? null });
            onClose();
          }}
        >
          {t('scan.use')}
        </Button>
      </div>
    </div>
  );
}
