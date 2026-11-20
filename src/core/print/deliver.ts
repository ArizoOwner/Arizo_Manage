// Getting a generated file or print job out of the app, per platform:
// - Android: write to the app cache (Filesystem), open the system share sheet (Share), then delete it.
//   Printing goes through ArizoPrint (native PrintManager + WebView print adapter, HarfBuzz shaping).
//   ESC/POS bytes go through ArizoThermalPrint (Bluetooth SPP or a LAN IP:port, native only).
// - iOS PWA / web: Web Share with files when available (iOS share sheet: Save to Files, AirDrop...),
//   else a same-origin blob download. Printing = window.print() on the print template (AirPrint).
// No path here touches the network: every target is the OS, a paired printer or a LAN socket.
import { registerPlugin } from '@capacitor/core';
import { toB64 } from '../crypto/bytes';
import { isNative } from '../bridge/native';

export interface ArizoPrintPlugin {
  /** Prints the current WebView document (the print template is already on screen). */
  print(o: { jobName: string }): Promise<{ state: 'started' | 'cancelled' | 'unavailable' }>;
}
export interface ThermalStatus {
  enabled: boolean;
  bluetoothPermission: boolean;
  bonded: { name: string; address: string }[];
}
export interface ArizoThermalPrintPlugin {
  status(): Promise<ThermalStatus>;
  /** Turning it on is the only time BLUETOOTH_CONNECT is requested. */
  setEnabled(o: { enabled: boolean }): Promise<ThermalStatus>;
  printBluetooth(o: { address: string; b64: string }): Promise<void>;
  /** Private LAN addresses only (validated natively); port 9100 by default. */
  printTcp(o: { host: string; port: number; b64: string }): Promise<void>;
}

export const ArizoPrint = registerPlugin<ArizoPrintPlugin>('ArizoPrint');
export const ArizoThermalPrint = registerPlugin<ArizoThermalPrintPlugin>('ArizoThermalPrint');

const SAFE_NAME = /[^\p{L}\p{N}._-]+/gu;
export const safeFileName = (name: string) => name.replace(SAFE_NAME, '_').slice(0, 80) || 'arizo';

/** Share or save bytes. Resolves 'shared' | 'saved' | 'cancelled'. */
export async function deliverFile(bytes: Uint8Array, fileName: string, mime: string, title: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const name = safeFileName(fileName);
  if (isNative()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const path = `exports/${name}`;
    const { uri } = await Filesystem.writeFile({ path, data: toB64(bytes), directory: Directory.Cache, recursive: true });
    try {
      await Share.share({ title, files: [uri], dialogTitle: title });
      return 'shared';
    } catch {
      return 'cancelled';
    } finally {
      // The cache copy is plaintext; it must not outlive the share sheet.
      await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
    }
  }
  const file = new File([bytes as BlobPart], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'saved';
}

/** Print what is on screen (the print stylesheet hides the app and shows only `.print-root`). */
export async function printDocument(jobName: string): Promise<void> {
  if (isNative()) {
    await ArizoPrint.print({ jobName: safeFileName(jobName) });
    return;
  }
  window.print();
}

export const sendThermal = (target: { kind: 'bt'; address: string } | { kind: 'tcp'; host: string; port: number }, bytes: Uint8Array) =>
  target.kind === 'bt' ? ArizoThermalPrint.printBluetooth({ address: target.address, b64: toB64(bytes) }) : ArizoThermalPrint.printTcp({ host: target.host, port: target.port, b64: toB64(bytes) });

/** RFC 1918 / link-local IPv4 only: the one socket the app may open is to a printer on the user's LAN. */
export function isPrivateLanIp(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host.trim());
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  if ([a, b, c, d].some((x) => x > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
