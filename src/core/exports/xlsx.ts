// .xlsx generation with exceljs. Runs inside xlsx.worker.ts in the app; tests call it directly.
// Amount cells: a numeric cell only when the decimal has ≤ 15 significant digits (an IEEE double then
// shows it back digit for digit, so the spreadsheet can sum it); longer values stay exact text.
import ExcelJS from 'exceljs';
import type { Cell } from './csv';

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Column indexes that hold decimal amount strings. */
  amountCols?: number[];
  rtl?: boolean;
}

export const exactNumber = (s: string): number | null => (/^-?\d+(\.\d+)?$/.test(s) && s.replace(/\D/g, '').replace(/^0+/, '').length <= 15 ? Number(s) : null);

export async function buildXlsx(sheets: Sheet[], creator = 'Arizo Manage'): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.created = new Date(0); // no timestamps in the file beyond the data itself
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31), { views: [{ rightToLeft: !!s.rtl, state: 'frozen', ySplit: 1 }] });
    s.rows.forEach((r, i) => {
      const row = ws.addRow(
        r.map((v, c) => {
          if (v === null) return null;
          if (typeof v === 'bigint') return exactNumber(String(v)) ?? String(v);
          if (i > 0 && typeof v === 'string' && s.amountCols?.includes(c)) return exactNumber(v) ?? v;
          return v;
        }),
      );
      if (i === 0) row.font = { bold: true };
    });
    ws.columns.forEach((col, c) => {
      let w = 8;
      for (const r of s.rows) w = Math.max(w, Math.min(48, String(r[c] ?? '').length + 2));
      col.width = w;
    });
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
