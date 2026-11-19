import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
const directives = new Map(
  csp.split(';').map((d) => d.trim().split(/\s+/)).filter((p) => p[0]).map((p) => [p[0]!, p.slice(1)]),
);

describe('index.html CSP (PROMPT.md §1.2)', () => {
  it.each([
    ['default-src', ["'self'"]],
    ['connect-src', ["'self'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'"]],
  ])('%s is exactly %j', (name, sources) => {
    expect(directives.get(name)).toEqual(sources);
  });

  it('allows no remote origin anywhere', () => {
    expect(csp).not.toMatch(/https?:|\*/);
  });

  it('loads no external resources in the HTML', () => {
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
  });
});
