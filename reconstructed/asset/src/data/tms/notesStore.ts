/* Notes thread + record locking — PHASE 7.

   NOTES ARE NEVER DELETED, ONLY HIDDEN.
   A dispatch note is evidence of what somebody was told and when. `deletedAt`
   takes it off the thread; the document stays, and so does the audit entry that
   says who hid it. That is why removeNote() does not call deleteDoc.

   LOCKING EXISTS BECAUSE FIVE PEOPLE SHARE THIS BOARD.
   A lock is not a boolean — it is "somebody claimed this AND their tab is still
   breathing". heartbeatAt is refreshed every 60 seconds while the modal is open;
   five minutes of silence and the lock is gone. A closed laptop or a dead wifi
   connection therefore heals itself instead of stranding the load, and nobody
   has to hunt for an admin to unstick a record. */

import { db, firebaseEnabled } from '../../firebase';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { emitChange } from '../bus';
import { saveLoad, loadById, type Load } from '../loadsStore';
import { canDelete } from '../permStore';
import { stampCreate, stampUpdate, writeAudit, actorEmail, nowIso } from './stamp';
import {
  lockIsActive, blankLock, LOCK_HEARTBEAT_MS,
  type LoadNote, type NoteCategory, type LoadLock, type TmsLoad,
} from './types';

const SUB = 'notes';

let cache: Record<string, LoadNote[]> = {};
const fetched = new Set<string>();

const LOCAL_KEY = 'asset-tms-notes-v1';

function readLocal(): Record<string, LoadNote[]> {
  try { const raw = localStorage.getItem(LOCAL_KEY); if (raw) return JSON.parse(raw) as Record<string, LoadNote[]>; }
  catch { /* ignore */ }
  return {};
}
function writeLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(cache)); } catch { /* ignore */ }
}
if (!firebaseEnabled) cache = readLocal();

const byNewest = (a: LoadNote, b: LoadNote) => {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return a.createdAt < b.createdAt ? 1 : -1;
};

/* ------------------------------------------------------------------ reads ---- */

/** live notes only — soft-deleted ones are hidden unless you ask for them */
export function storedNotes(loadId: string, includeDeleted = false): LoadNote[] {
  return (cache[loadId] ?? [])
    .filter((n) => includeDeleted || !n.deletedAt)
    .slice()
    .sort(byNewest);
}

export async function fetchNotes(loadId: string): Promise<LoadNote[]> {
  if (!firebaseEnabled || !db) return storedNotes(loadId);
  if (fetched.has(loadId)) return storedNotes(loadId);
  try {
    const snap = await getDocs(collection(db, 'loads', loadId, SUB));
    cache = { ...cache, [loadId]: snap.docs.map((d) => ({ ...(d.data() as LoadNote), id: d.id })) };
    fetched.add(loadId);
    emitChange();
  } catch (e) {
    console.error('notes read failed', loadId, e);
  }
  return storedNotes(loadId);
}

export const noteCount = (loadId: string): number => storedNotes(loadId).length;
export const latestNote = (loadId: string): LoadNote | undefined => storedNotes(loadId)[0];

/* ----------------------------------------------------------------- writes ---- */

export function blankNote(init?: Partial<LoadNote>): LoadNote {
  return {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    body: '', authorId: '', authorName: actorEmail(), authorEmail: actorEmail(),
    category: 'General', pinned: false, editedAt: '', editedBy: '', deletedAt: '',
    createdBy: '', createdAt: '', updatedBy: '', updatedAt: '',
    ...init,
  };
}

async function persist(loadId: string, list: LoadNote[], one: LoadNote) {
  cache = { ...cache, [loadId]: list };
  if (firebaseEnabled && db) {
    try { await setDoc(doc(db, 'loads', loadId, SUB, one.id), one as unknown as Record<string, unknown>); fetched.add(loadId); }
    catch (e) { console.error('note write failed', e); }
  } else { writeLocal(); }
  await refreshNoteMirror(loadId);
  emitChange();
}

export async function addNote(loadId: string, body: string, category: NoteCategory): Promise<LoadNote | null> {
  if (!body.trim()) return null;
  const n: LoadNote = { ...blankNote({ body: body.trim(), category }), ...stampCreate() };
  await persist(loadId, [...(cache[loadId] ?? []), n], n);
  writeAudit(loadId, {
    action: 'note.add',
    target: `loads/${loadId}/notes/${n.id}`,
    summary: `${category} note by ${actorEmail()}: ${body.trim().slice(0, 120)}`,
    before: null, after: { category, body: body.trim().slice(0, 200) },
  });
  return n;
}

export async function editNote(loadId: string, noteId: string, body: string): Promise<void> {
  const prev = (cache[loadId] ?? []).find((n) => n.id === noteId);
  if (!prev || !body.trim()) return;
  const next: LoadNote = {
    ...prev, body: body.trim(), editedAt: nowIso(), editedBy: actorEmail(), ...stampUpdate(prev),
  };
  await persist(loadId, (cache[loadId] ?? []).map((n) => (n.id === noteId ? next : n)), next);
  writeAudit(loadId, {
    action: 'note.edit',
    target: `loads/${loadId}/notes/${noteId}`,
    summary: `note edited by ${actorEmail()}`,
    before: { body: prev.body.slice(0, 200) }, after: { body: next.body.slice(0, 200) },
  });
}

export async function pinNote(loadId: string, noteId: string, pinned: boolean): Promise<void> {
  const prev = (cache[loadId] ?? []).find((n) => n.id === noteId);
  if (!prev) return;
  const next: LoadNote = { ...prev, pinned, ...stampUpdate(prev) };
  await persist(loadId, (cache[loadId] ?? []).map((n) => (n.id === noteId ? next : n)), next);
}

/* SOFT DELETE ONLY. There is no hard delete on this collection, by design —
   see the note at the top of the file. */
export async function removeNote(loadId: string, noteId: string): Promise<{ ok: boolean; reason: string }> {
  if (!canDelete()) return { ok: false, reason: 'deleting is restricted to FMT Lead, US Ops and the Owner' };
  const prev = (cache[loadId] ?? []).find((n) => n.id === noteId);
  if (!prev) return { ok: false, reason: 'that note is already gone' };
  const next: LoadNote = { ...prev, deletedAt: nowIso(), ...stampUpdate(prev) };
  await persist(loadId, (cache[loadId] ?? []).map((n) => (n.id === noteId ? next : n)), next);
  writeAudit(loadId, {
    action: 'note.hide',
    target: `loads/${loadId}/notes/${noteId}`,
    summary: `note hidden by ${actorEmail()} — the record is kept`,
    before: { deletedAt: '' }, after: { deletedAt: next.deletedAt },
  });
  return { ok: true, reason: '' };
}

/* The board shows the most recent note inline and a count. Both live on the load
   for the same reason missingBol does — a board cell cannot open a
   subcollection. */
export async function refreshNoteMirror(loadId: string): Promise<void> {
  const l = loadById(loadId);
  if (!l) return;
  const live = storedNotes(loadId);
  const top = live[0];
  const t = l as unknown as Partial<TmsLoad>;
  const nextCount = live.length;
  const nextText = top ? `${top.category}: ${top.body}`.slice(0, 140) : '';
  if ((t.noteCount ?? 0) === nextCount && (t.latestNote ?? '') === nextText) return;
  try {
    await saveLoad({ ...l, ...({
      noteCount: nextCount, latestNote: nextText,
      latestNoteCategory: top?.category ?? '', latestNoteAt: top?.createdAt ?? '',
    } as Partial<Load>) });
  } catch (e) { console.error('note mirror write failed', e); }
}

/* ------------------------------------------------------------------ locks ---- */

export interface LockState {
  lock: LoadLock;
  active: boolean;
  mine: boolean;
  readOnly: boolean;              // somebody ELSE holds it
  holder: string;
}

export function lockStateOf(l: Load): LockState {
  const t = l as unknown as Partial<TmsLoad>;
  const lock = t.lock ?? blankLock();
  const active = lockIsActive(lock);
  const mine = active && lock.lockedBy === actorEmail();
  return { lock, active, mine, readOnly: active && !mine, holder: lock.lockedByName || lock.lockedBy };
}

/** Claim the record. Refuses if somebody else holds a live lock. */
export async function acquireLock(l: Load): Promise<LockState> {
  const st = lockStateOf(l);
  if (st.readOnly) return st;
  const lock: LoadLock = {
    lockedBy: actorEmail(), lockedByName: actorEmail(), lockedAt: nowIso(),
    heartbeatAt: nowIso(), heartbeatAtMs: Date.now(),
  };
  await saveLoad({ ...l, ...({ lock } as Partial<Load>) });
  return { lock, active: true, mine: true, readOnly: false, holder: lock.lockedByName };
}

/** Keep it alive. Called on a timer while the modal is open. */
export async function heartbeat(loadId: string): Promise<void> {
  const l = loadById(loadId);
  if (!l) return;
  const st = lockStateOf(l);
  if (!st.mine) return;                       // never refresh somebody else's claim
  await saveLoad({ ...l, ...({ lock: { ...st.lock, heartbeatAt: nowIso(), heartbeatAtMs: Date.now() } } as Partial<Load>) });
}

/** Give it up — on close, on save, on the tab going away. */
export async function releaseLock(loadId: string): Promise<void> {
  const l = loadById(loadId);
  if (!l) return;
  const st = lockStateOf(l);
  if (st.active && !st.mine) return;          // not yours to release
  await saveLoad({ ...l, ...({ lock: blankLock() } as Partial<Load>) });
  emitChange();
}

/* Force-unlock is for the case the TTL doesn't cover: somebody genuinely IS in
   the record and will not come out. Owner and FMT Lead only, and it is audited
   with the name of the person whose claim was broken. */
export async function forceUnlock(l: Load): Promise<{ ok: boolean; reason: string }> {
  if (!canDelete()) return { ok: false, reason: 'forcing a lock is restricted to FMT Lead, US Ops and the Owner' };
  const st = lockStateOf(l);
  if (!st.active) return { ok: true, reason: 'that record was already free' };
  await saveLoad({ ...l, ...({ lock: blankLock() } as Partial<Load>) });
  writeAudit(l.id, {
    action: 'lock.force',
    target: `loads/${l.id}`,
    summary: `${actorEmail()} forced the lock held by ${st.holder}`,
    before: { lockedBy: st.lock.lockedBy }, after: { lockedBy: '' },
  });
  emitChange();
  return { ok: true, reason: '' };
}

/* "Request unlock" does not take the lock. It writes a note in the thread the
   holder is already looking at, which is the only honest way to ask somebody to
   get out of a record without taking it from them. */
export async function requestUnlock(l: Load): Promise<void> {
  const st = lockStateOf(l);
  await addNote(l.id, `${actorEmail()} is asking to edit this load — ${st.holder || 'the current editor'}, please save and close when you can.`, 'General');
  writeAudit(l.id, {
    action: 'lock.request',
    target: `loads/${l.id}`,
    summary: `${actorEmail()} requested the lock from ${st.holder}`,
    before: null, after: null,
  });
}

export { LOCK_HEARTBEAT_MS };


/* Drop every trace of a deleted load from this store — see data/tms/deleteLoad.
   Cache AND the demo copy on disk, because a localStorage entry keyed by a load
   id that no longer exists is invisible garbage that grows forever. */
export function purgeNotes(loadId: string): void {
  const next = { ...cache };
  delete next[loadId];
  cache = next;
  fetched.delete(loadId);
  if (!firebaseEnabled) writeLocal();
}
