// WCAG AA for every text/surface pair the UI actually uses (PROMPT.md §3.2: "All pairs must satisfy WCAG AA").
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/core/theme/tokens.css', 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--arizo-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const SURFACES = ['bg-canvas', 'surface-1', 'surface-2', 'surface-3'];
const TEXT = ['text-primary', 'text-secondary', 'primary-text', 'luxury-text', 'outflow-text', 'info-text', 'warning-text'];

describe.each([
  ['Obsidian Atelier', "[data-theme='obsidian']"],
  ['Alabaster Vault', "[data-theme='alabaster']"],
])('%s', (_name, selector) => {
  const t = block(selector);

  it.each(TEXT)('%s passes AA (4.5:1) on every surface', (fg) => {
    for (const bg of SURFACES) expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('text on accent fills (CTA buttons) passes AA', () => {
    for (const fill of ['cta-primary', 'cta-outflow']) {
      expect(contrast(t['on-accent']!, t[fill]!), `on-accent on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('marks (icons, rings, chart lines) pass the 3:1 non-text minimum on every surface', () => {
    // Emerald marks use the CTA shade (identical to the spec emerald in Obsidian).
    for (const a of ['cta-primary', 'luxury-mark', 'accent-outflow', 'accent-info']) {
      for (const bg of SURFACES) expect(contrast(t[a]!, t[bg]!), `${a} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
});
