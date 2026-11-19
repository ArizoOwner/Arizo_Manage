// Every translation key exists in both languages, and placeholders match.
import { describe, expect, it } from 'vitest';
import fa from '../src/core/i18n/fa.json';
import en from '../src/core/i18n/en.json';

type Tree = { [k: string]: string | Tree };
const flat = (o: Tree, p = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[`${p}${k}`, v] as [string, string]] : flat(v, `${p}${k}.`)));
const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('i18n resources', () => {
  const faMap = new Map(flat(fa as Tree));
  const enMap = new Map(flat(en as Tree));

  it('fa and en have exactly the same keys', () => {
    expect([...faMap.keys()].filter((k) => !enMap.has(k))).toEqual([]);
    expect([...enMap.keys()].filter((k) => !faMap.has(k))).toEqual([]);
  });

  it('interpolation placeholders match between languages', () => {
    const mismatched = [...faMap].filter(([k, v]) => JSON.stringify(vars(v)) !== JSON.stringify(vars(enMap.get(k) ?? '')));
    expect(mismatched.map(([k]) => k)).toEqual([]);
  });

  it('no empty strings', () => {
    expect([...faMap, ...enMap].filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });
});
