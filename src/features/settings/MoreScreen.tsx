// Tools hub: every module of the app, grouped, each with a tinted glyph tile and a one-line hint.
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { haptic } from '../../core/motion/motion';
import { GlyphTile } from '../../core/ui/glyphs';
import { Screen } from '../../core/ui/ui';

const C = {
  emerald: 'var(--arizo-accent-primary)',
  gold: 'var(--arizo-accent-luxury)',
  coral: 'var(--arizo-accent-outflow)',
  azure: 'var(--arizo-accent-info)',
  amber: 'var(--arizo-accent-warning)',
  violet: '#B48CFF',
};

const GROUPS = [
  {
    key: 'money',
    items: [
      { to: '/accounts', key: 'accounts', glyph: 'wallet', color: C.gold },
      { to: '/budgets', key: 'budgets', glyph: 'gauge', color: C.amber },
      { to: '/goals', key: 'goals', glyph: 'target', color: C.emerald },
      { to: '/categories', key: 'categories', glyph: 'tag', color: C.violet },
    ],
  },
  {
    key: 'obligations',
    items: [
      { to: '/cheques', key: 'cheques', glyph: 'cheque', color: C.azure },
      { to: '/loans', key: 'loans', glyph: 'landmark', color: C.gold },
      { to: '/debts', key: 'debts', glyph: 'handshake', color: C.coral },
      { to: '/sms', key: 'sms', glyph: 'message', color: C.amber },
    ],
  },
  {
    key: 'docs',
    items: [
      { to: '/invoices', key: 'invoices', glyph: 'invoice', color: C.violet },
      { to: '/statements', key: 'statements', glyph: 'printer', color: C.azure },
      { to: '/export', key: 'export', glyph: 'download', color: C.emerald },
      { to: '/import', key: 'import', glyph: 'upload', color: C.gold },
    ],
  },
  {
    key: 'safety',
    items: [
      { to: '/backup', key: 'backup', glyph: 'shieldCheck', color: C.emerald },
      { to: '/settings', key: 'settings', glyph: 'gear', color: C.azure },
      { to: '/trash', key: 'trash', glyph: 'trash', color: C.coral },
    ],
  },
] as const;

export function MoreScreen() {
  const { t } = useTranslation();
  const nav = useNavigate();
  let i = 0;
  return (
    <Screen title={t('more.title')}>
      {GROUPS.map((g) => (
        <section key={g.key} className="flex flex-col gap-2.5" aria-labelledby={`more-${g.key}`}>
          <h2 id={`more-${g.key}`} className="px-1 text-[13px] font-bold text-ink-2">
            {t(`more.group.${g.key}`)}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {g.items.map((x) => {
              const n = i++;
              return (
                <button
                  key={x.to}
                  type="button"
                  aria-label={t(`more.${x.key}`)}
                  onClick={() => {
                    haptic.light();
                    nav(x.to);
                  }}
                  className="arizo-card arizo-rise group relative flex min-h-[7.5rem] flex-col justify-between gap-3 overflow-hidden rounded-[24px] border border-hairline p-3.5 text-start transition-transform active:scale-[0.97]"
                  style={{ ['--i' as string]: Math.min(n, 8) }}
                >
                  <span aria-hidden="true" className="pointer-events-none absolute -end-8 -top-8 h-24 w-24 rounded-full opacity-60 blur-2xl transition-opacity group-hover:opacity-90" style={{ background: `color-mix(in srgb, ${x.color} 28%, transparent)` }} />
                  <GlyphTile name={x.glyph} color={x.color} size={46} radius={16} pop delay={0.03 * Math.min(n, 8)} className="relative" />
                  <span className="relative flex flex-col gap-0.5" aria-hidden="true">
                    <span className="text-[15px] leading-snug font-bold text-ink">{t(`more.${x.key}`)}</span>
                    <span className="line-clamp-2 text-[11.5px] leading-snug text-ink-2">{t(`more.hint.${x.key}`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </Screen>
  );
}
