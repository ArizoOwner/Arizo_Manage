// The output bar under every paper preview: paper size, Print (AirPrint / Android PrintManager),
// PNG at 3x DPR (share sheet), and ESC/POS to a thermal printer when the user has enabled one.
// Sharing anything that leaves the app needs a fresh PIN (re-auth) and is refused while stealth blur is on.
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrivacy } from '../../app/stores/privacy';
import { isNative } from '../../core/bridge/native';
import { deliverFile, printDocument, sendThermal } from '../../core/print/deliver';
import { Button, Segmented } from '../../core/ui/ui';
import { useReauth } from '../security/ReauthSheet';
import { useThermalTarget } from './ThermalSettings';
import { isThermal, nodeToEscPos, nodeToPng, PaperPreview, PrintPortal, type Paper } from './paper';

export function DocActions({ name, papers, paper, onPaper, render }: { name: string; papers: Paper[]; paper: Paper; onPaper: (p: Paper) => void; render: (paper: Paper) => ReactNode }) {
  const { t } = useTranslation();
  const hidden = usePrivacy((s) => s.hidden);
  const { request, sheet } = useReauth();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const thermal = useThermalTarget();

  const guarded = (fn: () => Promise<void>) => {
    if (hidden) return setMsg(t('docs.privacyOn'));
    request(async () => {
      setBusy(true);
      setMsg(null);
      try {
        await fn();
      } catch (e) {
        setMsg(t('docs.failed', { e: e instanceof Error ? e.message : String(e) }));
      } finally {
        setBusy(false);
      }
    });
  };

  const doc = () => preview.current?.querySelector<HTMLElement>('.doc') ?? null;

  return (
    <div className="flex flex-col gap-3">
      {papers.length > 1 && <Segmented<Paper> label={t('docs.paper')} value={paper} onChange={onPaper} options={papers.map((p) => ({ value: p, label: t(`docs.papers.${p}`) }))} />}
      <div ref={preview}>
        <PaperPreview paper={paper} testId="paper-preview">
          {render(paper)}
        </PaperPreview>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          data-testid="doc-print"
          disabled={busy}
          onClick={() => guarded(() => printDocument(name))}
        >
          {t('docs.print')}
        </Button>
        <Button
          variant="secondary"
          data-testid="doc-png"
          disabled={busy}
          onClick={() =>
            guarded(async () => {
              const node = doc();
              if (!node) return;
              const r = await deliverFile(await nodeToPng(node), `${name}.png`, 'image/png', name);
              if (r !== 'cancelled') setMsg(t(r === 'shared' ? 'docs.shared' : 'docs.saved'));
            })
          }
        >
          {t('docs.png')}
        </Button>
        {isNative() && isThermal(paper) && thermal && (
          <Button
            variant="secondary"
            className="col-span-2"
            data-testid="doc-thermal"
            disabled={busy}
            onClick={() =>
              guarded(async () => {
                const node = doc();
                if (!node) return;
                await sendThermal(thermal, await nodeToEscPos(node, paper === '58' ? 58 : 80));
                setMsg(t('docs.sent'));
              })
            }
          >
            {t('docs.thermal')}
          </Button>
        )}
      </div>
      {msg && (
        <p role="status" className="text-[13px] font-semibold text-ink-2" data-testid="doc-message">
          {msg}
        </p>
      )}
      {/* Hidden on screen (display: none); the only thing @media print shows. Stealth blur keeps it out. */}
      {!hidden && <PrintPortal paper={paper}>{render(paper)}</PrintPortal>}
      {sheet}
    </div>
  );
}
