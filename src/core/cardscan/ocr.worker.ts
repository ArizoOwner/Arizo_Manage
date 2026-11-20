/// <reference lib="webworker" />
// On-device OCR for the card scanner: the Tesseract 5 LSTM engine compiled to WebAssembly
// (tesseract.js-core, Apache-2.0) with the English LSTM model, both bundled with the app. Nothing is
// fetched from the network (the wrapper library defaults to a CDN, so it is not used); frames arrive as
// PNG bytes, text goes back, and nothing is kept: the worker is terminated after every scan and on lock.
import TesseractCore from 'tesseract.js-core/tesseract-core-simd-lstm.js';
import wasmUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm?url';
// The model (@tesseract.js-data/eng 4.0.0_best_int, MIT) lives in public/ocr/ as gzip named .bin: static
// servers send *.gz with Content-Encoding: gzip, which made the browser's fetch fail on it.
// The worker sits in assets/, so the model is one level up.
const modelUrl = new URL('../ocr/eng-lstm.bin', import.meta.url).href;

declare const self: DedicatedWorkerGlobalScope;

interface TessApi {
  Init(dataPath: string | null, lang: string, oem: number): number;
  SetVariable(k: string, v: string): boolean;
  SetImageFile(exif: number, angle: number): number;
  Recognize(monitor: null): number;
  GetUTF8Text(): string;
  MeanTextConf(): number;
  End(): void;
}
interface TessModule {
  FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void };
  TessBaseAPI: new () => TessApi;
}

let api: TessApi | null = null;
let mod: TessModule | null = null;

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function ready(): Promise<TessApi> {
  if (api) return api;
  const wasmBinary = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
  // print/printErr swallow the engine's diagnostics: production keeps zero logs (PROMPT.md §1.5).
  mod = (await (TesseractCore as (o: object) => Promise<TessModule>)({ wasmBinary, print: () => {}, printErr: () => {} })) as TessModule;
  const model = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer());
  // gzip magic 1F 8B: decompress here (a server may already have done it).
  mod.FS.writeFile('/eng.traineddata', model[0] === 0x1f && model[1] === 0x8b ? await gunzip(model) : model);
  const a = new mod.TessBaseAPI();
  if (a.Init('/', 'eng', 1) !== 0) throw new Error('ocr init');
  // Card faces: sparse text, digits and the few labels the parser needs.
  a.SetVariable('tessedit_pageseg_mode', '11');
  a.SetVariable('tessedit_char_whitelist', '0123456789/-:IRCVcvEXPTHRUVALID ');
  a.SetVariable('debug_file', '/dev/null');
  api = a;
  return a;
}

self.onmessage = async (e: MessageEvent<{ id: number; png: ArrayBuffer }>) => {
  const { id, png } = e.data;
  try {
    const a = await ready();
    mod!.FS.writeFile('/input', new Uint8Array(png));
    if (a.SetImageFile(1, 0) === 1) throw new Error('image');
    a.Recognize(null);
    const text = a.GetUTF8Text();
    const conf = a.MeanTextConf();
    mod!.FS.unlink('/input');
    self.postMessage({ id, ok: true, text, conf });
  } catch (err) {
    // E2E builds report the failure stage for debugging; production says only `ok: false`.
    self.postMessage({ id, ok: false, ...(import.meta.env.VITE_E2E ? { why: String(err) } : {}) });
  }
};
