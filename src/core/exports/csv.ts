// RFC 4180 CSV with a UTF-8 BOM (Excel opens Persian text correctly only with the BOM), and a parser
// for the import wizard. Text cells that start with = + - @ are prefixed with ' so a spreadsheet never
// runs them as formulas (CSV injection); numbers we write ourselves are emitted raw.
export const BOM = '﻿';

export type Cell = string | number | bigint | null;

const FORMULA = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/; // a signed amount like -250000 is data, not a formula

function cell(v: Cell): string {
  if (v === null) return '';
  if (typeof v !== 'string') return String(v);
  const safe = FORMULA.test(v) && !PLAIN_NUMBER.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: readonly (readonly Cell[])[]): string {
  return BOM + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export const csvBytes = (rows: readonly (readonly Cell[])[]): Uint8Array => new TextEncoder().encode(toCsv(rows));

/** Parse CSV text (BOM, CRLF/LF, quoted fields, "" escapes). Detects , ; or tab from the first line. */
export function parseCsv(text: string): string[][] {
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  const end = s.search(/\r?\n/);
  const firstLine = end < 0 ? s : s.slice(0, end);
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
