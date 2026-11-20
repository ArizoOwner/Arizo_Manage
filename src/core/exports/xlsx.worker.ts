// Builds .xlsx files off the UI thread (exceljs zips in JS). Receives plain rows, returns bytes.
import { buildXlsx, type Sheet } from './xlsx';

self.onmessage = async (e: MessageEvent<{ id: number; sheets: Sheet[] }>) => {
  try {
    const bytes = await buildXlsx(e.data.sheets);
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: true, bytes }, [bytes.buffer]);
  } catch {
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: false });
  }
};
