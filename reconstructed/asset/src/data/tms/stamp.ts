/* Write stamping + the append-only audit log — PHASE 0.

   HARD RULE: every TMS write carries createdBy / createdAt / updatedBy /
   updatedAt with the signed-in user's email. Nothing hand-writes those fields —
   everything goes through stampCreate / stampUpdate here, and firestore.rules
   rejects any write whose updatedBy isn't the caller. That means a forgotten
   stamp fails loudly at the server instead of quietly producing an unattributable
   record.

   Timestamps are ISO-8601 strings (see the note in types.ts) so demo mode and
   live mode behave identically. */

import { db, firebaseEnabled } from '../../firebase';
import { collection, doc, setDoc } from 'firebase/firestore';
import { currentEmail } from '../permStore';
import type { AuditEvent, Stamps } from './types';

/* The identity every write is attributed to. In live mode this is the signed-in
   Google account. In demo mode there is no sign-in, so writes are attributed to
   the previewed role — clearly marked so demo rows can never be mistaken for
   real ones in an audit trail. */
export function actorEmail(): string {
  const e = (currentEmail() || '').trim();
  if (!e) return 'unknown';
  return firebaseEnabled ? e.toLowerCase() : `demo:${e}`;
}

export const nowIso = (): string => new Date().toISOString();

/* Stamps for a NEW doc — creator and updater are the same person. */
export function stampCreate(): Stamps {
  const by = actorEmail(); const at = nowIso();
  return { createdBy: by, createdAt: at, updatedBy: by, updatedAt: at };
}

/* Stamps for an EDIT. createdBy/createdAt are carried from the existing doc and
   never rewritten — rules enforce that they're immutable, so passing the wrong
   prior values is rejected rather than silently overwriting authorship. */
export function stampUpdate(prev: Partial<Stamps> | undefined): Stamps {
  const by = actorEmail(); const at = nowIso();
  return {
    createdBy: prev?.createdBy || by,
    createdAt: prev?.createdAt || at,
    updatedBy: by,
    updatedAt: at,
  };
}

/* Apply create-or-update stamps in one call: if the record already has a
   createdAt it's an edit, otherwise it's a create. */
export function stamped<T extends Partial<Stamps>>(rec: T): T & Stamps {
  return { ...rec, ...(rec.createdAt ? stampUpdate(rec) : stampCreate()) };
}

/* ------------------------------------------------------------- audit log ---- */

export function auditId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* Append one event to loads/{loadId}/audit. Append-only: rules allow create and
   forbid update/delete, so an event can never be rewritten after the fact.

   Deliberately fire-and-forget — an audit failure must never block the mutation
   the user asked for, but it does get logged so a systematically broken trail is
   visible in the console rather than silent. In demo mode (no Firestore) this is
   a no-op; the audit trail is a shared-data feature. */
export function writeAudit(loadId: string, ev: Omit<AuditEvent, 'id' | 'at' | 'by'>): AuditEvent {
  const full: AuditEvent = { id: auditId(), at: nowIso(), by: actorEmail(), ...ev };
  if (firebaseEnabled && db) {
    setDoc(doc(collection(db, 'loads', loadId, 'audit'), full.id), full as unknown as Record<string, unknown>)
      .catch((e) => console.error('audit write failed', loadId, full.action, e));
  }
  return full;
}

/* Field-level diff for audit summaries: returns only what actually changed, so
   an audit row reads "billingStatus NOT_READY → READY_FOR_ACCOUNTING" instead of
   dumping the whole document. Stamp fields are excluded — they change on every
   write and would drown the signal. */
const STAMP_KEYS = new Set(['createdBy', 'createdAt', 'updatedBy', 'updatedAt']);

export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown>; after: Record<string, unknown>; keys: string[] } {
  const b = before ?? {}; const a = after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => !STAMP_KEYS.has(k))
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  const outB: Record<string, unknown> = {}; const outA: Record<string, unknown> = {};
  for (const k of keys) { outB[k] = b[k] ?? null; outA[k] = a[k] ?? null; }
  return { before: outB, after: outA, keys };
}

/* One-line human summary for an audit row. */
export function summarizeDiff(keys: string[]): string {
  if (!keys.length) return 'no field changes';
  if (keys.length <= 4) return `changed ${keys.join(', ')}`;
  return `changed ${keys.slice(0, 4).join(', ')} +${keys.length - 4} more`;
}
