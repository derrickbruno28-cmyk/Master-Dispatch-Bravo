/* Deleting a load — the path that was missing.

   THE BUG THIS FIXES
   `removeLoad()` has existed in loadsStore since the beginning and NOTHING EVER
   CALLED IT. The only way to delete a load was `clearLoadCell(truck, date)`,
   reached by right-clicking a board cell — which means a load could only be
   deleted if it was sitting on a cell you could find. Three kinds of load could
   not be:

   1. A load with NO TRUCK. The Unassigned tray could only open it, never remove
      it. That is the "untitled load I can't delete" — it has no cell to click.
   2. A load whose truck or date no longer matches a board cell: the truck left
      the fleet, the cell was cleared while the record survived, or a multi-leg
      load's legs moved away from the legacy assignedTruck field.
   3. A legacy split load — clearLoadCell explicitly skipped anything with
      segments.

   WHAT A DELETE HAS TO DO
   Removing the load document alone would leave its stops, milestones, documents
   and exceptions orphaned in Firestore forever, the uploaded scans stranded in
   storage, and its chips sitting on the board. So this cascades: board cells
   first (so the grid is right even if a later step fails), then the file bytes,
   then the subcollections, then the load.

   THE AUDIT TRAIL AND THE NOTES ARE DELIBERATELY LEFT BEHIND.
   Both are append-only by design — the rules forbid deleting an audit event or
   a note, for anyone, including the owner. So both subcollections survive the
   load as a tombstone, and this writes one final audit entry describing what was
   deleted and by whom before the record goes. A deleted load you cannot account
   for is worse than a stuck one, and a note is evidence of what somebody was
   told; neither stops being true because the load was removed.

   (This is also why the cascade does not TRY to delete them: the rules would
   reject the write, and a delete that half-fails is worse than one that is
   honest about what it keeps.) */

import { db, firebaseEnabled } from '../../firebase';
import { collection, doc, getDocs, deleteDoc } from 'firebase/firestore';
import { emitChange } from '../bus';
import { canDelete } from '../permStore';
import { loadAll, removeLoad, type Load } from '../loadsStore';
import { setAssignment, loadAssignments, cellKey } from '../schedule';
import { legsFor, purgeAssignments } from './assignmentsStore';
import { purgeStops } from './stopsStore';
import { purgeMilestones } from './milestonesStore';
import { purgeDocuments, storedDocs } from './documentsStore';
import { documentStore } from '../../integrations/documents';
import { purgeExceptions } from './exceptionsStore';
import { writeAudit, actorEmail } from './stamp';
import type { TmsLoad } from './types';

/* Everything EXCEPT audit and notes — see the note at the top of the file.
   Both of those are `allow delete: if false` in firestore.rules. */
const SUBS = ['assignments', 'stops', 'milestones', 'documents', 'exceptions'];

export interface DeleteResult { ok: boolean; reason: string; cells: number }

/** Every board cell this load occupies, however it is attached. */
export function cellsOf(l: Load): { truck: string; date: string }[] {
  const out: { truck: string; date: string }[] = [];
  const add = (truck: string) => {
    const t = (truck || '').trim();
    if (t && !out.some((x) => x.truck === t)) out.push({ truck: t, date: l.date });
  };
  add(l.assignedTruck);
  for (const s of l.segments) add(s.assignedTruck);
  for (const g of legsFor(l)) add(g.truckNumber);
  return out.filter((c) => c.date);
}

export async function deleteLoad(l: Load): Promise<DeleteResult> {
  if (!canDelete()) {
    return { ok: false, reason: 'deleting is restricted to FMT Lead, US Ops and the Owner', cells: 0 };
  }

  const t = l as unknown as Partial<TmsLoad>;

  /* the tombstone goes FIRST — if anything below fails, there is still a record
     that somebody tried to delete this and what it was */
  writeAudit(l.id, {
    action: 'load.delete',
    target: `loads/${l.id}`,
    summary: `Load deleted by ${actorEmail()} — ${l.routeName || '(untitled)'}${l.customerName ? ` · ${l.customerName}` : ''}${l.date ? ` · ${l.date}` : ''}${l.assignedTruck ? ` · truck #${l.assignedTruck}` : ' · no truck'}`,
    before: {
      routeName: l.routeName, customer: l.customerName, date: l.date,
      truck: l.assignedTruck, rate: l.rate, loadNumber: t.loadNumber ?? '',
      billingStatus: t.billingStatus ?? 'NOT_READY',
    },
    after: null,
  });

  /* 1. the board, first — a chip left behind is the visible failure */
  const cells = cellsOf(l);
  for (const c of cells) {
    try { await setAssignment(c.truck, c.date, null); } catch (e) { console.error('cell clear failed', c, e); }
  }

  /* 2. the FILE BYTES. Orphaned children are invisible, so they are the thing
        most likely to be forgotten — and the bytes are the expensive half. A
        document row that is gone can never be used to find its own scan again,
        so the bytes have to go before the metadata does. */
  for (const d of storedDocs(l.id)) {
    try { await documentStore().softDelete(d.id); } catch { /* the row goes either way */ }
  }

  /* 3. the subcollections */
  purgeAssignments(l.id); purgeStops(l.id); purgeMilestones(l.id);
  purgeDocuments(l.id); purgeExceptions(l.id);

  if (firebaseEnabled && db) {
    const database = db;
    for (const sub of SUBS) {
      try {
        const snap = await getDocs(collection(database, 'loads', l.id, sub));
        await Promise.all(snap.docs.map((d) => deleteDoc(doc(database, 'loads', l.id, sub, d.id))));
      } catch (e) {
        console.error(`subcollection ${sub} cleanup failed`, l.id, e);
      }
    }
  }

  /* 4. the load itself */
  removeLoad(l.id);
  emitChange();
  return { ok: true, reason: '', cells: cells.length };
}

/* ------------------------------------------------------- finding the stuck ---- */

export type StuckReason = 'no truck' | 'not on the board' | 'no date';

export interface StuckLoad { load: Load; reason: StuckReason; label: string }

/* A load nobody can reach from the board. This is the list that answers "there
   are loads I can't delete" — every one of them, with WHY it is unreachable, so
   the answer isn't just a delete button but an explanation. */
export function stuckLoads(): StuckLoad[] {
  const cells = loadAssignments();
  const out: StuckLoad[] = [];

  for (const l of loadAll()) {
    const label = l.routeName.trim() || '(untitled load)';
    if (!l.date) { out.push({ load: l, reason: 'no date', label }); continue; }

    const mine = cellsOf(l);
    if (mine.length === 0) { out.push({ load: l, reason: 'no truck', label }); continue; }

    /* it claims a truck, but is there actually a chip there? */
    const onBoard = mine.some((c) => cells[cellKey(c.truck, c.date)]);
    if (!onBoard) out.push({ load: l, reason: 'not on the board', label });
  }

  return out.sort((a, b) => (a.load.date < b.load.date ? 1 : -1));
}

export const STUCK_HELP: Record<StuckReason, string> = {
  'no truck': 'No truck assigned, so it has no cell on the calendar. It sits in the Unassigned tray.',
  'not on the board': 'It names a truck and a date, but there is no chip on that cell — the cell was cleared, or the truck left the fleet.',
  'no date': 'No date at all, so it can never appear on a weekly board.',
};
