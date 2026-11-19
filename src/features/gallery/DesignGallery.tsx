// Dev-only Design Gallery (PROMPT.md §8 Phase 2). The route is registered only in dev and E2E
// builds (see router.tsx), so production users never reach it.
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrivacy } from '../../app/stores/privacy';
import { useSettings } from '../../app/stores/settings';
import { CalculatorKeypad } from '../../core/motion/CalculatorKeypad';
import { DualDatePicker } from '../../core/motion/DualDatePicker';
import { LiquidDock } from '../../core/motion/LiquidDock';
import { OdometerAmount } from '../../core/motion/OdometerAmount';
import { ParallaxCard } from '../../core/motion/ParallaxCard';
import { formatDate, formatMoney } from '../../core/i18n/format';
import { CARD_FINISH_IDS } from '../../core/theme/cardFinishes';
import { BANKS } from '../../core/data/banks';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[13px] font-bold tracking-wide text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

// Tailwind `@theme inline` emits no CSS variables, so swatches read the source --arizo-* tokens.
const SWATCHES = ['bg-canvas', 'surface-1', 'surface-2', 'surface-3', 'cta-primary', 'luxury-mark', 'accent-outflow', 'accent-info', 'accent-warning'] as const;

export function DesignGallery() {
  const { t } = useTranslation();
  const s = useSettings();
  const { hidden, toggle } = usePrivacy();
  const [amount, setAmount] = useState(12_450_000_000n);
  const [date, setDate] = useState(() => Date.now());
  const [entered, setEntered] = useState<bigint | null>(null);
  const banks = BANKS.filter((b) => b.kind === 'bank');

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-36">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold">{t('gallery.title')}</h1>
          <button type="button" onClick={toggle} aria-pressed={hidden} className="min-h-11 rounded-xl bg-surface-3 px-3 text-[13px] font-semibold" data-testid="privacy-toggle">
            {hidden ? t('privacy.show') : t('privacy.hide')}
          </button>
        </div>
        <p className="text-[13px] text-ink-2">{t('gallery.devOnly')}</p>
        <div className="flex flex-wrap gap-2 text-[13px] font-semibold">
          <button type="button" className="min-h-11 rounded-xl bg-surface-3 px-3" data-testid="lang-toggle" onClick={() => s.set({ lang: s.lang === 'fa' ? 'en' : 'fa' })}>
            {t(`lang.${s.lang === 'fa' ? 'en' : 'fa'}`)}
          </button>
          <button type="button" className="min-h-11 rounded-xl bg-surface-3 px-3" data-testid="theme-toggle" onClick={() => s.set({ theme: s.theme === 'obsidian' ? 'alabaster' : 'obsidian' })}>
            {t(`theme.${s.theme === 'obsidian' ? 'alabaster' : 'obsidian'}`)}
          </button>
          <button type="button" className="min-h-11 rounded-xl bg-surface-3 px-3" data-testid="unit-toggle" onClick={() => s.set({ irrUnit: s.irrUnit === 'toman' ? 'rial' : 'toman' })}>
            {t(`unit.${s.irrUnit === 'toman' ? 'rial' : 'toman'}`)}
          </button>
          <button type="button" className="min-h-11 rounded-xl bg-surface-3 px-3" onClick={() => s.set({ calendar: s.calendar === 'jalali' ? 'gregorian' : 'jalali' })}>
            {t(`calendar.${s.calendar === 'jalali' ? 'gregorian' : 'jalali'}`)}
          </button>
        </div>
      </header>

      <Section title={t('gallery.odometer')}>
        <div className="rounded-3xl border border-hairline bg-surface-1 p-5">
          <OdometerAmount minor={amount} currency="IRR" className="text-[clamp(1.75rem,9vw,2.75rem)] font-extrabold text-gold-text" />
          <button type="button" className="mt-3 min-h-11 rounded-xl bg-surface-3 px-4 text-[13px] font-semibold" data-testid="bump" onClick={() => setAmount((a) => a + 37_850_000n)}>
            {t('gallery.bump')}
          </button>
        </div>
      </Section>

      <Section title={t('gallery.cards')}>
        <div className="flex flex-col gap-4">
          {CARD_FINISH_IDS.map((f, i) => (
            <ParallaxCard
              key={f}
              finish={f}
              bankName={s.lang === 'fa' ? banks[i]!.name_fa : banks[i]!.name_en}
              accountName={t(`card.finish.${f}`)}
              last4={String(1000 + i * 1111).slice(-4)}
              balanceMinor={amount / BigInt(i + 1)}
              currency="IRR"
            />
          ))}
        </div>
      </Section>

      <Section title={t('gallery.keypad')}>
        <CalculatorKeypad currency="IRR" onDone={setEntered} />
        {entered !== null && (
          <p className="text-[13px] text-ink-2 tabular" data-testid="keypad-done">
            {formatMoney(entered, 'IRR', s.lang, 'rial')}
          </p>
        )}
      </Section>

      <Section title={t('gallery.datePicker')}>
        <DualDatePicker value={date} onChange={setDate} />
        <p className="text-[13px] text-ink-2" data-testid="picked-date">
          {formatDate(date, 'jalali', s.lang)} · {formatDate(date, 'gregorian', s.lang)}
        </p>
      </Section>

      <Section title={t('gallery.tokens')}>
        <div className="grid grid-cols-3 gap-2">
          {SWATCHES.map((c) => (
            <div key={c} className="flex flex-col gap-1">
              <div className="h-12 rounded-xl border border-hairline" style={{ background: `var(--arizo-${c})` }} />
              <span className="text-[11px] text-ink-2" dir="ltr">
                {c}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <LiquidDock onAdd={() => setAmount((a) => a + 1_000_000n)} onQuick={() => {}} />
    </main>
  );
}
