/* Assignment legs — PHASE 1.

   A load is no longer "one truck". It carries an ordered list of LEGS, each with
   its own truck, trailer, 1-2 directly-assigned drivers, carrier authority, and
   the stop range it covers. That is what lets a San Antonio local shuttle hand
   off to an OTR team on the SAME load instead of being faked as two loads.

   READ-THROUGH FOR UN-MIGRATED LOADS: a load that has no leg documents yet still
   answers legsFor() — with a single synthesized Linehaul leg built from the
   legacy truck/trailer/driver fields. So the Assignments UI, the validator, and
   the board all work on day one, before anything is migrated, and a load stops
   being synthetic the moment someone edits a leg (that write creates the real
   document). Nothing has to be migrated for Phase 1 to be usable.

   Storage mirrors the other stores: Firestore subcollection when live,
   localStorage in demo, same shape either way. */

import { db, firebaseEnabled } from '../../firebase';
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { emitChange } from '../bus';
import { setAssignment } from '../schedule';
import { loadFleet } from '../fleetStore';
import { driverByName, loadDrivers, daysUntil, todayISO } from '../driversStore';
import type { Load as LegacyLoad } from '../loadsStore';
import { stampCreate, stampUpdate, writeAudit, actorEmail } from './stamp';
import { isLoadStatus, type LoadAssignment, type AssignmentDriver, type LegType } from './types';

const LS_KEY = 'asset-tms-legs-v1';
const SUB = 'assignments';

/* legs by load id. Live: filled by fetchAssignments when a load is opened.
   Demo: the localStorage copy. */
function readLocal(): Record<string, LoadAssignment[]> {
  try { const r = localStorage.getItem(LS_KEY); if (r) return JSON.parse(r) as Record<string, LoadAssignment[]>; } catch { /* ignore */ }
  return {};
}
function writeLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch { /* ignore */ } }

let cache: Record<string, LoadAssignment[]> = readLocal();
const fetched = new Set<string>();

const byIndex = (a: LoadAssignment, b: LoadAssignment) => a.legIndex - b.legIndex;

/* ------------------------------------------------------------------ reads ---- */

/** stored legs only — no synthesis. Empty until fetchAssignments has run (live). */
export function storedAssignments(loadId: string): LoadAssignment[] {
  return (cache[loadId] ?? []).slice().sort(byIndex);
}

/** has this load been given real leg documents yet? */
export function hasStoredAssignments(loadId: string): boolean {
  return (cache[loadId] ?? []).length > 0;
}

/** pull a load's legs from the shared database into the cache (live only) */
export async function fetchAssignments(loadId: string): Promise<LoadAssignment[]> {
  if (!firebaseEnabled || !db) return storedAssignments(loadId);
  if (fetched.has(loadId)) return storedAssignments(loadId);
  try {
    const snap = await getDocs(collection(db, 'loads', loadId, SUB));
    cache = { ...cache, [loadId]: snap.docs.map((d) => ({ ...(d.data() as LoadAssignment), id: d.id })) };
    fetched.add(loadId);
    emitChange();
  } catch (e) {
    console.error('assignments read failed', loadId, e);
  }
  return storedAssignments(loadId);
}

/* The legs implied by a legacy load's own fields — what makes the whole feature
   work before anything is migrated.

   TWO legacy shapes fold in here:
   - a plain single-truck load: the record already says "truck 1042, trailer
     TR-88, these two drivers, all the stops" — that IS leg 1.
   - a load using the OLD split/segments feature: each segment is already a leg
     in everything but name, so each becomes one. Without this, opening an old
     split load would collapse it to a single leg and quietly lose the split. */
export function syntheticLegs(l: LegacyLoad): LoadAssignment[] {
  const stamps = stampCreate();
  const stopCount = Math.max(1, l.stops.length);
  const authority = (l.bookingAuthority || '').trim();
  const status = isLoadStatus((l.status || '').trim()) ? l.status : 'unassigned';

  const mkDrivers = (names: string[]): AssignmentDriver[] =>
    names.map((n) => (n || '').trim()).filter(Boolean)
      .map((name, i) => ({ driverId: driverByName(name)?.id ?? '', name, seat: i === 0 ? 'primary' as const : 'co' as const }));

  const base = {
    carrierAuthority: authority,
    dispatchedAt: l.dispatchedAt || '',
    dispatchSentTo: '' as const,
    loadSheetSentAt: '',
    otpResult: 'Pending' as const,
    otdResult: 'Pending' as const,
    cancelled: false,
    cancelReason: '',
    ...stamps,
  };

  if (l.segments.length > 0) {
    /* legacy fromStop/toStop are INDEXES into the sorted stop list; stop seq is
       1-based, hence the +1 */
    return l.segments.map((sg, i): LoadAssignment => ({
      ...base,
      id: `leg-${i + 1}`,
      legIndex: i + 1,
      legType: i === 0 ? 'Linehaul' : 'Relay',
      truckNumber: (sg.assignedTruck || '').trim(),
      trailerNumber: i === 0 ? (l.assignedTrailer || '').trim() : '',
      drivers: mkDrivers(sg.driverIds.length ? sg.driverIds : [l.driver1, l.driver2]),
      fromStopSeq: (sg.fromStop ?? 0) + 1,
      toStopSeq: (sg.toStop ?? stopCount - 1) + 1,
      legStatus: isLoadStatus((sg.status || '').trim()) ? sg.status : status,
    }));
  }

  return [{
    ...base,
    id: 'leg-1',
    legIndex: 1,
    legType: 'Linehaul',
    truckNumber: (l.assignedTruck || '').trim(),
    trailerNumber: (l.assignedTrailer || '').trim(),
    drivers: mkDrivers([l.driver1, l.driver2]),
    fromStopSeq: 1,
    toStopSeq: stopCount,
    legStatus: status,
  }];
}

/** the legs to WORK WITH: real documents when they exist, else the synthesized
    ones. Every consumer (UI, validator, board, dispatch sheets) uses this. */
export function legsFor(l: LegacyLoad): LoadAssignment[] {
  const stored = storedAssignments(l.id);
  return stored.length ? stored : syntheticLegs(l);
}

/** trucks a load occupies — one board row per leg (deduped; a relay can return
    to the same truck). */
export function legTrucks(l: LegacyLoad): string[] {
  return [...new Set(legsFor(l).map((g) => g.truckNumber.trim()).filter(Boolean))];
}

/* ----------------------------------------------------------------- writes ---- */

export function blankAssignment(legIndex: number, stopCount: number, init?: Partial<LoadAssignment>): LoadAssignment {
  return {
    id: `leg-${legIndex}`,
    legIndex,
    legType: legIndex === 1 ? 'Linehaul' : 'Relay',
    truckNumber: '', trailerNumber: '', carrierAuthority: '',
    drivers: [],
    fromStopSeq: 1,
    toStopSeq: Math.max(1, stopCount),
    legStatus: 'unassigned',
    dispatchedAt: '', dispatchSentTo: '', loadSheetSentAt: '',
    otpResult: 'Pending', otdResult: 'Pending',
    cancelled: false, cancelReason: '',
    ...stampCreate(),
    ...init,
  };
}

/* Persist the whole leg list for a load in one go. Legs are an ordered set that
   is edited as a unit (adding one renumbers the rest), so writing them together
   avoids a half-renumbered state being visible to anyone else mid-edit. */
export async function saveAssignments(loadId: string, legs: LoadAssignment[]): Promise<LoadAssignment[]> {
  const prev = storedAssignments(loadId);
  const prevById = new Map(prev.map((g) => [g.id, g]));

  const next = legs
    .slice()
    .sort(byIndex)
    .map((g, i) => ({
      ...g,
      legIndex: i + 1,
      id: g.id || `leg-${i + 1}`,
      ...stampUpdate(prevById.get(g.id)),
    }));

  cache = { ...cache, [loadId]: next };

  if (firebaseEnabled && db) {
    const database = db;
    try {
      await Promise.all(next.map((g) => setDoc(doc(database, 'loads', loadId, SUB, g.id), g as unknown as Record<string, unknown>)));
      /* legs removed by this edit */
      const keep = new Set(next.map((g) => g.id));
      await Promise.all(prev.filter((g) => !keep.has(g.id)).map((g) => deleteDoc(doc(database, 'loads', loadId, SUB, g.id))));
      fetched.add(loadId);
    } catch (e) {
      console.error('assignments write failed', loadId, e);
      throw e;
    }
  } else { writeLocal(); }

  writeAudit(loadId, {
    action: 'assignments.save',
    target: `loads/${loadId}/assignments`,
    summary: `${next.length} leg${next.length === 1 ? '' : 's'} saved by ${actorEmail()} — ${next.map((g) => `${g.legIndex}:#${g.truckNumber || '—'}`).join(', ')}`,
    before: { legs: prev.length },
    after: { legs: next.length },
  });

  emitChange();
  return next;
}

/** drop a leg. Deleting is a restricted action — the caller gates on canDelete. */
export async function removeAssignment(loadId: string, legId: string): Promise<LoadAssignment[]> {
  const remaining = storedAssignments(loadId).filter((g) => g.id !== legId);
  return saveAssignments(loadId, remaining);
}

/* ------------------------------------------------------------ validation ---- */

export interface DriverWarning { name: string; reason: string }

/* Availability warnings, matching how Driver Availability words them: a driver
   with no ready date was never cleared to run, and one whose ready date has
   passed is out. These WARN, they never block — dispatch overrides happen and
   the board shouldn't argue with the person who knows the situation. */
export function driverWarning(name: string): DriverWarning | null {
  const n = (name || '').trim();
  if (!n) return null;
  const d = driverByName(n);
  if (!d) return { name: n, reason: 'not in Driver Availability' };
  if (!d.readyDate) return { name: n, reason: 'no ready date' };
  const left = daysUntil(d.readyDate);
  if (left !== null && left > 0) return { name: n, reason: `out until ${d.readyDate}` };
  if (d.flag) return { name: n, reason: d.flag.toLowerCase() };
  return null;
}

/** an out-of-service truck can't be dispatched — this one is a hard block */
export function truckIsOutOfService(truck: string): boolean {
  const t = (truck || '').trim();
  if (!t) return false;
  const rec = loadFleet().find((x) => x.tractor === t);
  return !!rec && (rec.status || '').trim().toLowerCase() === 'out of service';
}

/* What's stopping this leg from being dispatched. Phase 1 adds these to the
   existing pre-dispatch validator rather than replacing it — the shell rules
   (route, customer, equipment, stops) still apply at the load level. */
export function missingForLeg(g: LoadAssignment): string[] {
  const out: string[] = [];
  const n = g.legIndex;
  if (!g.truckNumber.trim()) out.push(`Leg ${n}: truck #`);
  else if (truckIsOutOfService(g.truckNumber)) out.push(`Leg ${n}: truck #${g.truckNumber} is out of service`);
  if (!g.drivers.some((d) => d.name.trim())) out.push(`Leg ${n}: at least one driver`);
  if (!(g.fromStopSeq >= 1) || !(g.toStopSeq >= g.fromStopSeq)) out.push(`Leg ${n}: a valid stop range`);
  return out;
}

export function missingForLegs(legs: LoadAssignment[]): string[] {
  return legs.filter((g) => !g.cancelled).flatMap(missingForLeg);
}

/* ------------------------------------------------------------ board sync ---- */

/* Write one board cell per leg truck, and clear the cells of trucks this load no
   longer touches. This is what makes a multi-leg load appear on EVERY truck row
   it uses: the grid keeps rendering from assetSchedule exactly as before, and the
   leg metadata rides along so each row can show "leg 1 of 2" and be recognizable
   as the same load. */
export async function syncLegCells(l: LegacyLoad, prevTrucks: string[]): Promise<void> {
  const legs = legsFor(l);
  const total = legs.length;
  const live = legs.filter((g) => g.truckNumber.trim());

  const keep = new Set(live.map((g) => g.truckNumber.trim()));
  for (const t of prevTrucks) {
    if (t && !keep.has(t)) await setAssignment(t, l.date, null);
  }
  for (const g of live) {
    await setAssignment(g.truckNumber.trim(), l.date, {
      route: l.routeName,
      status: g.legStatus || l.status,
      usps: l.uspsContract,
      ...(total > 1 ? { legIndex: g.legIndex, legCount: total, loadId: l.id } : {}),
    });
  }
}

/* ---------------------------------------------------------------- helpers ---- */

export function legLabel(g: LoadAssignment, total: number): string {
  return total > 1 ? `leg ${g.legIndex} of ${total}` : 'single leg';
}

export function driverNamesOf(g: LoadAssignment): string[] {
  return g.drivers.map((d) => d.name.trim()).filter(Boolean);
}

/** build the drivers array from two name inputs, resolving ids off the roster */
export function driversFromNames(primary: string, co: string): AssignmentDriver[] {
  const mk = (name: string, seat: 'primary' | 'co'): AssignmentDriver | null => {
    const n = (name || '').trim();
    if (!n) return null;
    return { driverId: driverByName(n)?.id ?? '', name: n, seat };
  };
  return [mk(primary, 'primary'), mk(co, 'co')].filter(Boolean) as AssignmentDriver[];
}

export const seatName = (g: LoadAssignment, seat: 'primary' | 'co'): string =>
  g.drivers.find((d) => d.seat === seat)?.name ?? '';

/** roster names for the driver typeaheads, available first */
export function driverOptions(): { name: string; hint: string }[] {
  const today = todayISO();
  return loadDrivers().map((d) => {
    const left = d.readyDate ? daysUntil(d.readyDate) : null;
    const out = !d.readyDate ? 'no ready date' : (left !== null && left > 0 ? `out until ${d.readyDate}` : '');
    return { name: d.name, hint: [d.position, out || (d.readyDate <= today ? 'available' : ''), d.flag].filter(Boolean).join(' · ') };
  });
}

export const LEG_TYPE_OPTIONS: LegType[] = ['Linehaul', 'Local Shuttle', 'Relay', 'Yard Move', 'Recovery'];
