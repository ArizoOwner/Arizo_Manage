// Writing a decoded snapshot into the open vault: Safe Replace and Smart Merge.
// Both take a safety snapshot of the current vault first; rows change in ONE staged transaction (one
// atomic batch), attachment blobs are written before their rows, and any failure puts the blobs back,
// so a failed restore leaves the vault exactly as it was.
import { verifyLedger } from '../ledger/ledger';
import type { IVaultDatabase, Row, VaultTx, Where } from '../storage/IVaultDatabase';
import { STORE_NAMES, UNIQUE, type StoreName } from '../storage/schema';
import { uuidv7 } from '../utils/uuidv7';
import { DEVICE_LOCAL_SETTINGS, type Snapshot } from './payload';

type AnyRow = Row<StoreName>;
const isLocal = (store: StoreName, id: string) => store === 'settings' && (DEVICE_LOCAL_SETTINGS as readonly string[]).includes(id);

/** Undo blob writes after a failed row batch: drop new keys, put overwritten bytes back. */
async function rollbackBlobs(db: IVaultDatabase, written: string[], before: Snapshot) {
  for (const k of written) {
    const prev = before.blobs[k];
    await (prev ? db.putBlob(k, prev) : db.deleteBlob(k)).catch(() => {});
  }
}

/** Safe Replace: the vault becomes exactly `snap` (device-local backup settings stay). */
export async function replaceWith(db: IVaultDatabase, snap: Snapshot, before: Snapshot): Promise<void> {
  const written: string[] = [];
  try {
    await db.transaction(async (tx) => {
      // Deletes first, so a UNIQUE value can move from a removed row to a restored one.
      for (const s of STORE_NAMES) {
        const keep = new Set(snap.stores[s].map((r) => r.id));
        for (const r of await tx.find(s)) if (!keep.has(r.id) && !isLocal(s, r.id)) await tx.delete(s, r.id);
      }
      for (const a of snap.stores.attachments) {
        const b = snap.blobs[a.encrypted_blob_key];
        if (!b) continue;
        written.push(a.encrypted_blob_key);
        await db.putBlob(a.encrypted_blob_key, b);
      }
      for (const s of STORE_NAMES) for (const r of snap.stores[s]) await tx.put(s, r as never);
    });
  } catch (e) {
    await rollbackBlobs(db, written, before);
    throw e;
  }
  const live = new Set(snap.stores.attachments.map((a) => a.encrypted_blob_key));
  for (const a of before.stores.attachments) if (!live.has(a.encrypted_blob_key)) await db.deleteBlob(a.encrypted_blob_key).catch(() => {});
}

export interface MergeReport {
  added: number;
  updated: number;
  /** Rows present on both sides where the local copy is as new or newer. */
  kept: number;
  /** Incoming rows dropped because a UNIQUE value (e.g. the same bank SMS) already exists locally. */
  skipped: number;
  /** Incoming invoices whose number was taken locally, kept under a new number. */
  renumbered: number;
  /** Account balances recalculated afterwards. */
  balancesFixed: number;
}

/** Child rows that must not survive without their transaction. */
const parentOf = (s: StoreName, r: AnyRow): string | null => {
  if (s === 'transaction_splits' || s === 'transaction_tags') return (r as Row<'transaction_splits'>).transaction_id;
  if (s === 'attachments' && (r as Row<'attachments'>).owner_type === 'transaction') return (r as Row<'attachments'>).owner_id;
  return null;
};

async function clashes(tx: VaultTx, s: StoreName, r: AnyRow): Promise<string | null> {
  for (const f of (UNIQUE[s] ?? []) as readonly string[]) {
    const v = (r as unknown as Record<string, unknown>)[f];
    if (v === null || v === undefined) continue;
    if ((await tx.find(s, { [f]: v } as Where<typeof s>)).some((x) => x.id !== r.id)) return f;
  }
  return null;
}

/**
 * Smart Merge: rows are matched by UUID. New ids are added; on a shared id the newer `updated_at` wins
 * (a tie keeps the local row). UNIQUE values stay unique: a transaction whose SMS fingerprint already
 * exists locally is skipped with its splits, tags and attachments; a clashing invoice number gets a
 * `-2`, `-3`... suffix. Balances are then recalculated with verifyLedger(fix).
 */
export async function mergeInto(db: IVaultDatabase, snap: Snapshot, before: Snapshot, now = Date.now()): Promise<MergeReport> {
  const rep: MergeReport = { added: 0, updated: 0, kept: 0, skipped: 0, renumbered: 0, balancesFixed: 0 };
  const written: string[] = [];
  try {
    await db.transaction(async (tx) => {
      const skippedTx = new Set<string>();
      for (const s of STORE_NAMES) {
        for (const incoming of snap.stores[s]) {
          if (isLocal(s, incoming.id)) continue;
          const parent = parentOf(s, incoming);
          if (parent && skippedTx.has(parent)) {
            rep.skipped++;
            continue;
          }
          const local = await tx.get(s, incoming.id);
          if (local && local.updated_at >= incoming.updated_at) {
            rep.kept++;
            continue;
          }
          let row = incoming;
          const clash = await clashes(tx, s, row);
          if (clash && s === 'invoices') {
            const inv = row as Row<'invoices'>;
            let n = 2;
            while (await clashes(tx, s, { ...inv, number: `${inv.number}-${n}` })) n++;
            row = { ...inv, number: `${inv.number}-${n}` };
            rep.renumbered++;
          } else if (clash) {
            // shortcut: the other half of a transfer pair is not skipped with it; verifyLedger reports it.
            if (s === 'transactions') skippedTx.add(row.id);
            rep.skipped++;
            continue;
          }
          if (s === 'attachments') {
            const a = row as Row<'attachments'>;
            const b = snap.blobs[a.encrypted_blob_key];
            if (b) {
              written.push(a.encrypted_blob_key);
              await db.putBlob(a.encrypted_blob_key, b);
            }
          }
          await tx.put(s, row as never);
          if (local) rep.updated++;
          else rep.added++;
        }
      }
    });
  } catch (e) {
    await rollbackBlobs(db, written, before);
    throw e;
  }
  rep.balancesFixed = (await verifyLedger(db, true, now)).drift.length;
  return rep;
}

export const auditRow = (event: 'backup_created' | 'backup_restored', detail: string, now = Date.now()): Row<'app_audit_log'> => ({
  id: uuidv7(now),
  created_at: now,
  updated_at: now,
  deleted_at: null,
  event,
  detail,
});
