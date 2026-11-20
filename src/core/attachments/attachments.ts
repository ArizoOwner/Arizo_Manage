// Encrypted attachments (logo, signature, receipts). Bytes go to the adapter's blob store, which seals
// them at rest (web: AES-256-GCM with the vault blob key, AAD bound to the id; Android: SQLCipher file).
// The `attachments` row keeps mime, size and the SHA-256 of the plaintext, checked on every read.
import { toB64, toHex } from '../crypto/bytes';
import { sha256 } from '../crypto/primitives';
import type { IVaultDatabase } from '../storage/IVaultDatabase';
import type { Attachment } from '../storage/schema';
import { uuidv7 } from '../utils/uuidv7';

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** Trust boundary: identify the image by its magic bytes, never by the file name or the browser's type. */
export function sniffImage(b: Uint8Array): ImageMime | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export async function saveImageAttachment(db: IVaultDatabase, owner: Pick<Attachment, 'owner_type' | 'owner_id'>, bytes: Uint8Array, now = Date.now()): Promise<Attachment> {
  const mime = sniffImage(bytes);
  if (!mime) throw new Error('ATTACHMENT_TYPE');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('ATTACHMENT_TOO_LARGE');
  const id = uuidv7(now);
  const { nonce_b64 } = await db.putBlob(id, bytes);
  const row: Attachment = {
    id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    owner_type: owner.owner_type,
    owner_id: owner.owner_id,
    encrypted_blob_key: id,
    nonce_b64,
    mime_type: mime,
    original_size_bytes: bytes.length,
    sha256_hash: toHex(await sha256(bytes)),
  };
  try {
    await db.put('attachments', row);
  } catch (e) {
    await db.deleteBlob(id);
    throw e;
  }
  return row;
}

/** Decrypted bytes, or null when missing or when the content no longer matches its hash. */
export async function loadAttachment(db: IVaultDatabase, id: string): Promise<{ row: Attachment; bytes: Uint8Array } | null> {
  const row = await db.get('attachments', id);
  if (!row || row.deleted_at !== null) return null;
  const bytes = await db.getBlob(row.encrypted_blob_key).catch(() => undefined);
  if (!bytes || toHex(await sha256(bytes)) !== row.sha256_hash) return null;
  return { row, bytes };
}

export async function deleteAttachment(db: IVaultDatabase, id: string): Promise<void> {
  const row = await db.get('attachments', id);
  if (!row) return;
  await db.delete('attachments', id);
  await db.deleteBlob(row.encrypted_blob_key);
}

/** For <img src>: a data URL (CSP img-src allows data:), built from the decrypted bytes in memory only. */
export const imageDataUrl = (a: { row: Attachment; bytes: Uint8Array }) => `data:${a.row.mime_type};base64,${toB64(a.bytes)}`;
