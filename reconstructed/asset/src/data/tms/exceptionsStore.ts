/* Exceptions + auto-spawned replacement loads — PHASE 5.

   WHAT AN EXCEPTION IS
   A load that stops being runnable as planned: the driver runs out of hours, the
   truck breaks down, the shipper never loads, a contractor no-shows. Today that
   gets handled in a phone call and a new load typed from scratch, which is how
   the appointment times and the reference numbers drift apart from the original.

   WHAT SPAWNING DOES
   It builds the replacement load FROM the original: same customer, authority,
   terminal, equipment, commodity, references and financial terms, and only the
   stops from the break point forward — with their appointment windows intact and
   their ACTUALS dropped, because the replacement truck hasn't been anywhere yet.

   RULE 5 IS LOAD-BEARING HERE.
   planSpawn() writes NOTHING. It returns a plan — the child draft, the stops it
   would copy, the leg it would close, and any warnings — for a human to look at
   in ExceptionsTab. applySpawn() is the only thing that writes, and it only runs
   from a button that says what it is about to do. */

import { db, firebaseEnabled } from '../../firebase';
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { emitChange } from '../bus';
import { blankLoad, saveLoad, loadById, type Load } from '../loadsStore';
import { stopsFor, saveStops } from './stopsStore';
import { legsFor, saveAssignments } from './assignmentsStore';
import { stampCreate, stampUpdate, writeAudit, actorEmail } from './stamp';
import {
  type LoadException, type ExceptionType, type LoadStopDoc, type TmsLoad, type LoadAssignment,
} from './types';

const SUB = 'exceptions';

let cache: Record<string, LoadException[]> = {};
const fetched = new Set<string>();

const byNewest = (a: LoadException, b: LoadException) => (a.createdAt < b.createdAt ? 1 : -1);

/* ------------------------------------------------------------------ reads ---- */

export function storedExceptions(loadId: string): LoadException[] {
  return (cache[loadId] ?? []).slice().sort(byNewest);
}

export async function fetchExceptions(loadId: string): Promise<LoadException[]> {
  if (!firebaseEnabled || !db) return storedExceptions(loadId);
  if (fetched.has(loadId)) return storedExceptions(loadId);
  try {
    const snap = await getDocs(collection(db, 'loads', loadId, SUB));
    cache = { ...cache, [loadId]: snap.docs.map((d) => ({ ...(d.data() as LoadException), id: d.id })) };
    fetched.add(loadId);
    emitChange();
  } catch (e) {
    console.error('exceptions read failed', loadId, e);
  }
  return storedExceptions(loadId);
}

export const openExceptions = (loadId: string): LoadException[] =>
  storedExceptions(loadId).filter((x) => !x.resolved);

export function blankException(init?: Partial<LoadException>): LoadException {
  return {
    id: `exc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    exceptionType: 'Driver HOS',
    reason: '',
    driverId: '', assignmentId: '',
    fromStopSeq: null, toStopSeq: null,
    fromCity: '', fromState: '', toCity: '', toState: '',
    childLoadId: '', resolved: false,
    createdBy: '', createdAt: '', updatedBy: '', updatedAt: '',
    ...init,
  };
}

/* ----------------------------------------------------------------- writes ---- */

export async function saveException(load: Load, ex: LoadException): Promise<LoadException> {
  const prev = storedExceptions(load.id).find((x) => x.id === ex.id);
  const next: LoadException = { ...ex, ...(prev ? stampUpdate(prev) : stampCreate()) };
  cache = {
    ...cache,
    [load.id]: prev
      ? storedExceptions(load.id).map((x) => (x.id === ex.id ? next : x))
      : [...storedExceptions(load.id), next],
  };
  if (firebaseEnabled && db) {
    try { await setDoc(doc(db, 'loads', load.id, SUB, next.id), next as unknown as Record<string, unknown>); fetched.add(load.id); }
    catch (e) { console.error('exception write failed', e); }
  }
  writeAudit(load.id, {
    action: prev ? 'exception.update' : 'exception.open',
    target: `loads/${load.id}/exceptions/${next.id}`,
    summary: `${next.exceptionType}${next.resolved ? ' (resolved)' : ''} — ${next.reason || 'no reason given'} by ${actorEmail()}`,
    before: prev ? { resolved: prev.resolved, reason: prev.reason } : null,
    after: { resolved: next.resolved, reason: next.reason },
  });
  await refreshExceptionFlag(load);
  emitChange();
  return next;
}

/** delete is restricted — the caller gates on canDelete (never FMT) */
export async function removeException(load: Load, exId: string): Promise<void> {
  const gone = storedExceptions(load.id).find((x) => x.id === exId);
  cache = { ...cache, [load.id]: storedExceptions(load.id).filter((x) => x.id !== exId) };
  if (firebaseEnabled && db) {
    try { await deleteDoc(doc(db, 'loads', load.id, SUB, exId)); } catch (e) { console.error('exception delete failed', e); }
  }
  if (gone) {
    writeAudit(load.id, {
      action: 'exception.remove',
      target: `loads/${load.id}/exceptions/${exId}`,
      summary: `${gone.exceptionType} exception removed by ${actorEmail()}`,
      before: { exceptionType: gone.exceptionType, reason: gone.reason }, after: null,
    });
  }
  await refreshExceptionFlag(load);
  emitChange();
}

/* hasOpenException lives ON the load for the same reason missingBol does — the
   board must be able to badge and filter a cell without opening a subcollection
   for every truck-day on screen. */
export async function refreshExceptionFlag(load: Load): Promise<void> {
  const open = openExceptions(load.id).length > 0;
  const t = load as unknown as Partial<TmsLoad>;
  if ((t.hasOpenException ?? false) === open) return;
  try { await saveLoad({ ...load, ...({ hasOpenException: open } as Partial<Load>) }); }
  catch (e) { console.error('exception flag write failed', e); }
}

/* ------------------------------------------------------- the spawn plan ---- */

export interface SpawnPlan {
  parent: Load;
  exception: LoadException;
  child: Load;                    // DRAFT — not saved
  childStops: LoadStopDoc[];      // DRAFT — appointments kept, actuals dropped
  carried: string[];              // human-readable list of what copies forward
  cancelLeg: LoadAssignment | null;
  warnings: string[];
  ok: boolean;
}

/* Everything the replacement load inherits. Kept as one list so the review
   screen and the writer can never disagree about what "copy forward" means. */
const CARRY_KEYS = [
  'customerId', 'customerName', 'equipment', 'commodity', 'weight', 'referenceNo',
  'bookingAuthority', 'uspsContract', 'rate', 'loadType',
] as const;

const TMS_CARRY_KEYS = [
  'customer', 'bookingAuthority', 'bookingTerminal', 'routeNumber', 'tripNumbers',
  'isUspsContract', 'refs', 'financials', 'equipment', 'commodity', 'weight',
] as const;

/* WRITES NOTHING. This is the review screen's whole input. */
export function planSpawn(parent: Load, ex: LoadException): SpawnPlan {
  const warnings: string[] = [];
  const stops = stopsFor(parent);
  const from = ex.fromStopSeq;

  if (from == null) warnings.push('Pick the stop the replacement truck starts from — without it there is nothing to copy.');

  /* only the stops from the break point forward. Renumbered from 1 so the child
     reads like a normal load rather than a load that starts at stop 3. */
  const kept = from == null ? [] : stops.filter((s) => s.seq >= from);
  if (from != null && kept.length === 0) warnings.push(`No stops at or after #${from} — nothing would carry to the replacement load.`);
  if (kept.length === 1) warnings.push('Only one stop carries forward. Check the start point — a replacement load usually needs a pickup and a delivery.');
  /* A recovery load normally has to GO GET the freight, and the stop it picks it
     up at is wherever the first truck stopped — which is not in the plan. We do
     not invent that stop (nothing inferred gets written), we say so out loud and
     let dispatch add it on the Stops tab. */
  if (kept.length > 0 && !kept.some((s) => s.type === 'Pickup')) {
    warnings.push('No pickup carries forward — the replacement load starts at a delivery. If the freight is sitting on a trailer somewhere, add the recovery pickup on the new load\u2019s Stops tab; this preview will not invent it.');
  }

  const childStops: LoadStopDoc[] = kept.map((s, i) => ({
    ...s,
    id: `stop-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
    seq: i + 1,
    /* APPOINTMENTS CARRY. ACTUALS DO NOT — the replacement truck has not been
       anywhere yet, and copying an arrival time it never made would forge the
       on-time record. */
    actualIn: '', actualOut: '', detentionMinutes: null,
    createdBy: '', createdAt: '', updatedBy: '', updatedAt: '',
  }));

  const firstAppt = childStops.find((s) => s.apptDate)?.apptDate || parent.date;

  const t = parent as unknown as Partial<TmsLoad>;
  const carriedTms: Record<string, unknown> = {};
  for (const k of TMS_CARRY_KEYS) if (t[k] !== undefined) carriedTms[k] = t[k];

  const legacyCarry: Partial<Load> = {};
  for (const k of CARRY_KEYS) (legacyCarry as Record<string, unknown>)[k] = parent[k];

  const child = blankLoad('', firstAppt, {
    ...legacyCarry,
    ...(carriedTms as Partial<Load>),
    date: firstAppt,
    routeName: parent.routeName ? `${parent.routeName} (replacement)` : 'Replacement load',
    /* UNASSIGNED on purpose. Spawning creates the work, it does not decide who
       runs it — that's a dispatch decision, made on the board. */
    assignedTruck: '', assignedTeamId: '', assignedTrailer: '',
    driver1: '', driver2: '',
    driver1Flyer: false, driver2Flyer: false, driver1Confirmed: false, driver2Confirmed: false,
    status: 'unassigned', dispatchedAt: '', segments: [],
    stops: childStops.map((s, i) => ({
      type: s.type === 'Delivery' ? 'delivery' as const : 'pickup' as const,
      sequence: i + 1,
      address: [s.location.address1, s.location.address2].filter(Boolean).join(' '),
      city: s.location.city, state: s.location.state, zip: s.location.zip,
      dateTime: s.apptDate ? `${s.apptDate}T${s.apptWindowStart || '00:00'}` : '',
      poNumber: s.refs.po, refNo: s.refs.customerRefConf, notes: s.instructions,
    })),
    ...({ parentLoadId: parent.id, billingStatus: 'NOT_READY', hasOpenException: false } as Partial<Load>),
  });

  const legs = legsFor(parent);
  const cancelLeg = legs.find((g) => g.id === ex.assignmentId) ?? (legs.length === 1 ? legs[0] : null);
  if (!cancelLeg) warnings.push('No leg selected — the original leg will stay open. Pick the leg that could not finish.');
  else if (cancelLeg.cancelled) warnings.push(`Leg ${cancelLeg.legIndex} is already cancelled — it will not be cancelled twice.`);

  const carried = [
    parent.customerName && `customer ${parent.customerName}`,
    t.bookingAuthority && `authority ${t.bookingAuthority}`,
    t.bookingTerminal && `terminal ${t.bookingTerminal}`,
    parent.equipment && `equipment ${parent.equipment}`,
    parent.commodity && `commodity ${parent.commodity}`,
    parent.weight && `weight ${parent.weight}`,
    (t.tripNumbers?.length ?? 0) > 0 && `trip ${t.tripNumbers?.join(' / ')}`,
    parent.rate != null && `rate ${parent.rate}`,
    `${childStops.length} stop${childStops.length === 1 ? '' : 's'} with appointments`,
  ].filter(Boolean) as string[];

  return {
    parent, exception: ex, child, childStops, carried, cancelLeg: cancelLeg ?? null,
    warnings,
    ok: from != null && kept.length > 0,
  };
}

export interface SpawnResult { ok: boolean; childId: string; reason: string }

/* The only writer. Order matters: the child has to exist before anything points
   at it, and the parent leg is closed last so a failure part-way through leaves
   a load that is still runnable rather than a cancelled leg with no replacement. */
export async function applySpawn(plan: SpawnPlan): Promise<SpawnResult> {
  if (!plan.ok) return { ok: false, childId: '', reason: 'the plan is incomplete' };

  const child = await saveLoad(plan.child);
  if (plan.childStops.length) await saveStops(child.id, plan.childStops);

  writeAudit(child.id, {
    action: 'load.spawned',
    target: `loads/${child.id}`,
    summary: `Spawned from load ${plan.parent.id} by ${actorEmail()} — ${plan.exception.exceptionType}: ${plan.exception.reason || 'no reason given'}`,
    before: null, after: { parentLoadId: plan.parent.id, stops: plan.childStops.length },
  });

  /* close the leg that could not finish. Phase 0 chose a `cancelled` flag over a
     12th load status on purpose: the LOAD is still whatever it is, one LEG of it
     did not happen. */
  if (plan.cancelLeg && !plan.cancelLeg.cancelled) {
    const legs = legsFor(plan.parent).map((g) => (g.id === plan.cancelLeg?.id
      ? { ...g, cancelled: true, cancelReason: `${plan.exception.exceptionType} — ${plan.exception.reason || 'no reason given'}` }
      : g));
    await saveAssignments(plan.parent.id, legs);
  }

  const ex: LoadException = { ...plan.exception, childLoadId: child.id };
  await saveException(plan.parent, ex);

  writeAudit(plan.parent.id, {
    action: 'load.spawn',
    target: `loads/${plan.parent.id}`,
    summary: `Replacement load ${child.id} created by ${actorEmail()} — ${plan.carried.join(', ')}`,
    before: null, after: { childLoadId: child.id },
  });

  emitChange();
  return { ok: true, childId: child.id, reason: '' };
}

/* ------------------------------------------------------------ the links ---- */

export interface SpawnLink { childId: string; parentId: string; exceptionType: string; reason: string }

/** the replacement loads spawned FROM this load */
export function childrenOf(loadId: string): SpawnLink[] {
  return storedExceptions(loadId)
    .filter((x) => x.childLoadId)
    .map((x) => ({ childId: x.childLoadId, parentId: loadId, exceptionType: x.exceptionType, reason: x.reason }));
}

/** the load this one was spawned FROM, if any */
export function parentOf(l: Load): Load | undefined {
  const t = l as unknown as Partial<TmsLoad>;
  return t.parentLoadId ? loadById(t.parentLoadId) : undefined;
}

export const EXCEPTION_TYPE_HINT: Record<ExceptionType, string> = {
  'Driver HOS': 'The driver is out of hours and cannot legally finish the run.',
  'Driver Availability': 'The driver is unavailable — sick, no-show, personal.',
  'Breakdown / OOS': 'The truck or trailer failed and is out of service.',
  'Trailer Issue': 'Trailer damage, wrong trailer, or a trailer that will not move.',
  'Shipper Delay': 'The shipper held the truck past the point the plan survives.',
  'Receiver Delay': 'The receiver held the truck past the point the plan survives.',
  Weather: 'Road or weather closure that stops the run.',
  'Recovery / Contractor Failure': 'A contractor or partner failed and we are recovering the freight.',
};


/* Drop every trace of a deleted load from this store — see data/tms/deleteLoad.
   Cache AND the demo copy on disk, because a localStorage entry keyed by a load
   id that no longer exists is invisible garbage that grows forever. */
export function purgeExceptions(loadId: string): void {
  const next = { ...cache };
  delete next[loadId];
  cache = next;
  fetched.delete(loadId);
}
