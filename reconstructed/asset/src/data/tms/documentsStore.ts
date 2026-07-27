/* Load documents + the billing gate — PHASE 4.

   The FILE BYTES keep living in integrations/documents (IndexedDB now, Firebase
   Storage when VITE_DOCUMENT_STORE=firebase). What's new here is the TMS
   METADATA: what kind of document it is, whether it ships with the invoice, and
   which stop or leg it belongs to. Two stores, one file — the adapter owns
   bytes, this owns meaning.

   THE BILLING GATE IS THE POINT OF THIS PHASE.
   A load cannot reach READY_FOR_ACCOUNTING without at least one BOL and at least
   one POD. That is enforced here AND in firestore.rules, because a gate that
   only exists in the UI is a suggestion — anyone with a console can post the
   write directly, and the whole reason for the gate is that money moves on it. */

import { db, firebaseEnabled } from '../../firebase';
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { emitChange } from '../bus';
import { documentStore } from '../../integrations/documents';
import { saveLoad, type Load } from '../loadsStore';
import { stampCreate, stampUpdate, writeAudit, actorEmail } from './stamp';
import {
  defaultInvoiceRequirement, BILLING_RANK,
  type LoadDocument, type DocType, type InvoiceRequirement, type BillingStatus, type TmsLoad,
} from './types';

const SUB = 'documents';

let cache: Record<string, LoadDocument[]> = {};
const fetched = new Set<string>();

const byNewest = (a: LoadDocument, b: LoadDocument) => (a.uploadedAt < b.uploadedAt ? 1 : -1);

/* ------------------------------------------------------------------ reads ---- */

export function storedDocs(loadId: string): LoadDocument[] {
  return (cache[loadId] ?? []).slice().sort(byNewest);
}

export async function fetchDocs(loadId: string): Promise<LoadDocument[]> {
  if (!firebaseEnabled || !db) return storedDocs(loadId);
  if (fetched.has(loadId)) return storedDocs(loadId);
  try {
    const snap = await getDocs(collection(db, 'loads', loadId, SUB));
    cache = { ...cache, [loadId]: snap.docs.map((d) => ({ ...(d.data() as LoadDocument), id: d.id })) };
    fetched.add(loadId);
    emitChange();
  } catch (e) {
    console.error('documents read failed', loadId, e);
  }
  return storedDocs(loadId);
}

/* ------------------------------------------------------------ the gate ---- */

export const hasDocType = (loadId: string, t: DocType): boolean =>
  storedDocs(loadId).some((d) => d.docType === t);

export const missingBol = (loadId: string): boolean => !hasDocType(loadId, 'BOL');
export const missingPod = (loadId: string): boolean => !hasDocType(loadId, 'POD');

export interface GateResult { ok: boolean; missing: DocType[]; reason: string }

/* The single source of truth for "can this load be billed?". The Billing view,
   the load modal, and the derived flags all ask this one function so they can't
   drift apart and start disagreeing in front of the person chasing paperwork. */
export function billingGate(loadId: string): GateResult {
  const missing: DocType[] = [];
  if (missingBol(loadId)) missing.push('BOL');
  if (missingPod(loadId)) missing.push('POD');
  return {
    ok: missing.length === 0,
    missing,
    reason: missing.length ? `waiting on ${missing.join(' + ')}` : 'BOL and POD attached',
  };
}

/* Can this load move to that billing status? Only READY_FOR_ACCOUNTING and
   beyond are gated — ON_HOLD and CANCELLED_TONU are escape hatches that must
   stay reachable from anywhere, including from a load with no paperwork at all. */
export function canSetBilling(loadId: string, next: BillingStatus): GateResult {
  if (BILLING_RANK[next] < 1) return { ok: true, missing: [], reason: 'no documents required for this state' };
  return billingGate(loadId);
}

/* ----------------------------------------------------------------- writes ---- */

/* {loadNumber}-{DOCTYPE}-{MM-DD-YYYY}[-n].{ext} — the naming the spec asks for.
   The -n suffix only appears from the second document of a kind onward, so the
   common case reads clean. */
export function buildFileName(load: Load, docType: DocType, original: string, existingCount: number): string {
  const t = load as unknown as Partial<TmsLoad>;
  const num = (t.loadNumber || load.id || 'load').toString().replace(/[^\w-]+/g, '');
  const d = new Date();
  const stamp = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
  const ext = (original.match(/\.([A-Za-z0-9]+)$/)?.[1] || 'pdf').toLowerCase();
  const n = existingCount > 0 ? `-${existingCount + 1}` : '';
  return `${num}-${docType}-${stamp}${n}.${ext}`;
}

export interface UploadInput {
  load: Load; file: File; docType: DocType;
  stopId?: string; assignmentId?: string; expirationDate?: string;
  invoiceRequirement?: InvoiceRequirement;
}

export async function uploadDoc(input: UploadInput): Promise<LoadDocument> {
  const { load, file, docType } = input;
  /* bytes first — if storage fails there's no metadata pointing at nothing */
  const stored = await documentStore().put(load.id, file);

  const sameType = storedDocs(load.id).filter((d) => d.docType === docType).length;
  const meta: LoadDocument = {
    id: stored.id,
    docType,
    invoiceRequirement: input.invoiceRequirement ?? defaultInvoiceRequirement(docType),
    fileName: buildFileName(load, docType, file.name, sameType),
    storagePath: stored.id,
    mimeType: file.type || stored.type || '',
    sizeBytes: file.size || stored.size || 0,
    stopId: input.stopId || '',
    assignmentId: input.assignmentId || '',
    expirationDate: input.expirationDate || '',
    daysRemaining: daysRemaining(input.expirationDate || ''),
    uploadedBy: actorEmail(),
    uploadedAt: stored.uploadedAt,
    ...stampCreate(),
  };

  cache = { ...cache, [load.id]: [...storedDocs(load.id), meta] };
  if (firebaseEnabled && db) {
    try { await setDoc(doc(db, 'loads', load.id, SUB, meta.id), meta as unknown as Record<string, unknown>); fetched.add(load.id); }
    catch (e) { console.error('document meta write failed', e); }
  }

  writeAudit(load.id, {
    action: 'document.upload',
    target: `loads/${load.id}/documents/${meta.id}`,
    summary: `${docType} uploaded by ${actorEmail()} as ${meta.fileName} (${meta.invoiceRequirement.toLowerCase()})`,
    before: null, after: { docType, fileName: meta.fileName },
  });

  await refreshDocFlags(load);
  emitChange();
  return meta;
}

export function daysRemaining(expiration: string): number | null {
  if (!expiration) return null;
  const t = Date.parse(`${expiration}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / 86400000);
}

export async function patchDoc(loadId: string, docId: string, p: Partial<LoadDocument>): Promise<void> {
  const prev = storedDocs(loadId).find((d) => d.id === docId);
  if (!prev) return;
  const next: LoadDocument = { ...prev, ...p, ...stampUpdate(prev) };
  if (p.expirationDate !== undefined) next.daysRemaining = daysRemaining(p.expirationDate);
  cache = { ...cache, [loadId]: storedDocs(loadId).map((d) => (d.id === docId ? next : d)) };
  if (firebaseEnabled && db) {
    try { await setDoc(doc(db, 'loads', loadId, SUB, docId), next as unknown as Record<string, unknown>); }
    catch (e) { console.error('document meta patch failed', e); }
  }
  emitChange();
}

/** delete is restricted — the caller gates on canDelete (never FMT) */
export async function removeDoc(load: Load, docId: string): Promise<void> {
  const gone = storedDocs(load.id).find((d) => d.id === docId);
  cache = { ...cache, [load.id]: storedDocs(load.id).filter((d) => d.id !== docId) };
  if (firebaseEnabled && db) {
    try { await deleteDoc(doc(db, 'loads', load.id, SUB, docId)); } catch (e) { console.error('document delete failed', e); }
  }
  await documentStore().softDelete(docId).catch(() => { /* bytes are soft-deleted; metadata is gone */ });
  if (gone) {
    writeAudit(load.id, {
      action: 'document.remove',
      target: `loads/${load.id}/documents/${docId}`,
      summary: `${gone.docType} ${gone.fileName} removed by ${actorEmail()}`,
      before: { docType: gone.docType, fileName: gone.fileName }, after: null,
    });
  }
  await refreshDocFlags(load);
  emitChange();
}

/* ------------------------------------------------------- derived flags ---- */

/* missingBol / missingPod live ON the load so the board can filter without
   opening every subcollection. They're derived, so they're recomputed on every
   document change rather than being a second source of truth someone can edit.

   Uploading the last missing document also lifts MISSING_DOCS to
   READY_FOR_ACCOUNTING automatically — that's the state machine moving on its
   own evidence, not a human remembering to flip a dropdown. */
export async function refreshDocFlags(load: Load): Promise<void> {
  const gate = billingGate(load.id);
  const t = load as unknown as Partial<TmsLoad>;
  const patch: Record<string, unknown> = {
    missingBol: missingBol(load.id),
    missingPod: missingPod(load.id),
  };

  if (t.billingStatus === 'MISSING_DOCS' && gate.ok) {
    patch.billingStatus = 'READY_FOR_ACCOUNTING';
    writeAudit(load.id, {
      action: 'billing.auto',
      target: `loads/${load.id}`,
      summary: 'MISSING_DOCS → READY_FOR_ACCOUNTING — BOL and POD are both attached',
      before: { billingStatus: 'MISSING_DOCS' }, after: { billingStatus: 'READY_FOR_ACCOUNTING' },
    });
  }

  try { await saveLoad({ ...load, ...(patch as Partial<Load>) }); }
  catch (e) { console.error('doc flag write failed', e); }
}

/* Move the billing status by hand. Refuses the gated transition rather than
   letting the UI decide — see the note at the top of this file. */
export async function setBillingStatus(load: Load, next: BillingStatus): Promise<GateResult> {
  const gate = canSetBilling(load.id, next);
  if (!gate.ok) return gate;

  const t = load as unknown as Partial<TmsLoad>;
  await saveLoad({ ...load, ...({ billingStatus: next } as Partial<Load>) });
  writeAudit(load.id, {
    action: 'billing.set',
    target: `loads/${load.id}`,
    summary: `billing ${t.billingStatus ?? 'NOT_READY'} → ${next} by ${actorEmail()}`,
    before: { billingStatus: t.billingStatus ?? 'NOT_READY' }, after: { billingStatus: next },
  });
  emitChange();
  return gate;
}


/* Drop every trace of a deleted load from this store — see data/tms/deleteLoad.
   Cache AND the demo copy on disk, because a localStorage entry keyed by a load
   id that no longer exists is invisible garbage that grows forever. */
export function purgeDocuments(loadId: string): void {
  const next = { ...cache };
  delete next[loadId];
  cache = next;
  fetched.delete(loadId);
}
