/* Loads — the rich load record behind every Matrix cell.

   ARCHITECTURE: the existing schedule Assignment ({route,status,usps} keyed by
   `tractor_date`) STAYS the board's render index, so every existing view keeps
   working untouched. A Load adds the dispatch shell on top (customer, stops,
   rate, docs, segments) and is linked to one or more cells:
     - single-truck load → linked at cellKey(assignedTruck, date)
     - split load        → each segment linked at cellKey(segment.truck, date)
   Persistence mirrors schedule.ts: localStorage now, write-through to the
   Firestore `loads` collection when Firebase is configured. */

import { db, firebaseEnabled } from '../firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { emitChange } from './bus';
import { cellKey, setAssignment } from './schedule';
import { routingProvider, type RoutePoint } from '../integrations/routing';

export interface LoadStop {
  type: 'pickup' | 'delivery';
  sequence: number;
  address: string; city: string; state: string; zip: string;
  dateTime: string;      // ISO local "YYYY-MM-DDTHH:mm"
  poNumber: string; refNo: string; notes: string;
}

export interface LoadSegment {
  id: string; label: string;
  fromStop: number; toStop: number;      // stop sequence bounds (toStop = shuttle/handoff)
  assignedTruck: string; assignedTeamId: string; driverIds: string[];
  status: string;
  segmentRevenue: number | null;
  segmentMiles: number | null;
  segmentCpm: number | null;
}

export interface Load {
  id: string;
  date: string;               // board day (YYYY-MM-DD) of the primary cell
  routeName: string;          // required-to-dispatch *
  customerId: string;         // *
  customerName: string;       // *
  loadType: string;           // TL | LTL (legacy — no longer shown/required)
  equipment: string;          // *
  assignedTruck: string;      // *
  assignedTeamId: string;     // *
  assignedTrailer: string;    // trailer #
  driver1: string;            // assigned drivers (load-level, LoadStop-style)
  driver2: string;
  driver1Flyer: boolean;      // flyer sent → pending confirm (yellow)
  driver2Flyer: boolean;
  driver1Confirmed: boolean;  // driver confirmed (green)
  driver2Confirmed: boolean;
  rate: number | null;        // revenue
  weight: string;
  referenceNo: string;
  bookingAuthority: string;
  commodity: string;
  dispatchNotes: string;
  uspsContract: boolean;
  status: string;             // existing board enum
  stops: LoadStop[];          // ≥1 pickup + ≥1 delivery required to dispatch
  laneMiles: number | null;   // auto-calculated (RoutingProvider)
  cpm: number | null;         // rate / laneMiles
  segments: LoadSegment[];    // empty = normal single-truck load
  dispatchedAt: string;       // ISO; '' = not yet dispatched
  createdAt: string;
}

const KEY = 'asset-loads-v1';
const COL = 'loads';   // shared Firestore collection (this app's own project)

function readLocal(): Record<string, Load> {
  try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r) as Record<string, Load>; } catch { /* ignore */ }
  return {};
}
/* the load records, shared across the team. Live: filled by the onSnapshot
   below. Demo: the localStorage copy. */
let cache: Record<string, Load> = readLocal();
function read(): Record<string, Load> { return cache; }
function writeLocal() { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ } }
function persistDoc(l: Load) { if (firebaseEnabled && db) setDoc(doc(db, COL, l.id), l as unknown as Record<string, unknown>).catch((e) => console.error('load write failed', e)); }
function deleteDocById(id: string) { if (firebaseEnabled && db) deleteDoc(doc(db, COL, id)).catch((e) => console.error('load delete failed', e)); }

let synced = false;
/* live-subscribe to the shared load records (once) */
export function startLoadsSync() {
  if (synced || !firebaseEnabled || !db) return;
  synced = true;
  const database = db;
  onSnapshot(collection(database, COL), (snap) => {
    const next: Record<string, Load> = {};
    snap.forEach((d) => { next[d.id] = d.data() as Load; });
    cache = next; emitChange();
  }, (e) => console.error('loads sync failed', e));
}
if (firebaseEnabled) startLoadsSync();

export function blankStop(type: LoadStop['type'], sequence: number): LoadStop {
  return { type, sequence, address: '', city: '', state: '', zip: '', dateTime: '', poNumber: '', refNo: '', notes: '' };
}

export function blankLoad(tractor: string, date: string, init?: Partial<Load>): Load {
  return {
    id: `load-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date, routeName: '', customerId: '', customerName: '',
    loadType: 'TL', equipment: '', assignedTruck: tractor, assignedTeamId: tractor,
    assignedTrailer: '', driver1: '', driver2: '',
    driver1Flyer: false, driver2Flyer: false, driver1Confirmed: false, driver2Confirmed: false,
    rate: null, weight: '', referenceNo: '', bookingAuthority: '', commodity: '',
    dispatchNotes: '', uspsContract: false, status: 'unassigned',
    stops: [blankStop('pickup', 1), blankStop('delivery', 2)],
    laneMiles: null, cpm: null, segments: [], dispatchedAt: '',
    createdAt: new Date().toISOString(),
    ...init,
  };
}

export function loadAll(): Load[] { return Object.values(read()); }
export function loadById(id: string): Load | undefined { return read()[id]; }

/** the load linked to a board cell — direct assignment or one of its segments */
export function loadForCell(tractor: string, date: string): Load | undefined {
  for (const l of Object.values(read())) {
    if (l.date === date && l.assignedTruck === tractor && l.segments.length === 0) return l;
    if (l.date === date && l.segments.some((s) => s.assignedTruck === tractor)) return l;
  }
  return undefined;
}

export async function saveLoad(l: Load): Promise<Load> {
  const withMiles = await recalcMiles(l);
  cache = { ...cache, [withMiles.id]: withMiles };
  if (firebaseEnabled && db) persistDoc(withMiles); else writeLocal();
  emitChange();
  return withMiles;
}

export function removeLoad(id: string) {
  const next = { ...cache }; delete next[id]; cache = next;
  if (firebaseEnabled && db) deleteDocById(id); else writeLocal();
  emitChange();
}

/** keep loads linked when a chip is dragged to another cell */
export function moveLoadCell(fromKey: string, toKey: string) {
  const i = toKey.indexOf('_'); const toTruck = toKey.slice(0, i); const toDate = toKey.slice(i + 1);
  const j = fromKey.indexOf('_'); const fromTruck = fromKey.slice(0, j); const fromDate = fromKey.slice(j + 1);
  const map = { ...cache }; const changed: Load[] = [];
  for (const l of Object.values(map)) {
    if (l.date === fromDate && l.assignedTruck === fromTruck && l.segments.length === 0) {
      l.assignedTruck = toTruck; l.assignedTeamId = toTruck; l.date = toDate; changed.push(l);
    } else if (l.date === fromDate) {
      let hit = false;
      for (const s of l.segments) if (s.assignedTruck === fromTruck) { s.assignedTruck = toTruck; s.assignedTeamId = toTruck; hit = true; }
      if (hit) changed.push(l);
    }
  }
  if (changed.length) {
    cache = map;
    if (firebaseEnabled && db) changed.forEach(persistDoc); else writeLocal();
    emitChange();
  }
}

/** clearing a board cell removes the linked single-truck load (segments survive on other rows) */
export function clearLoadCell(tractor: string, date: string) {
  const map = { ...cache }; const removed: string[] = [];
  for (const [id, l] of Object.entries(map)) {
    if (l.date === date && l.assignedTruck === tractor && l.segments.length === 0) { delete map[id]; removed.push(id); }
  }
  if (removed.length) {
    cache = map;
    if (firebaseEnabled && db) removed.forEach(deleteDocById); else writeLocal();
    emitChange();
  }
}

/* ---- mileage & CPM (RoutingProvider — estimate now, exact later) ---- */
const toPts = (stops: LoadStop[]): RoutePoint[] =>
  stops.slice().sort((a, b) => a.sequence - b.sequence).map((s) => ({ city: s.city, state: s.state, address: s.address }));

export async function recalcMiles(l: Load): Promise<Load> {
  const sorted = l.stops.slice().sort((a, b) => a.sequence - b.sequence);
  const pts = toPts(l.stops);
  const miles = pts.length >= 2 ? await routingProvider().laneMiles(pts) : null;
  const cpm = miles && l.rate ? Math.round((l.rate / miles) * 100) / 100 : null;
  /* per-segment miles = the stop sub-range each segment covers (fromStop/toStop
     are indexes into the sequence-sorted stop list) */
  const segments: LoadSegment[] = [];
  for (const s of l.segments) {
    const slice = sorted.slice(s.fromStop, s.toStop + 1);
    const segMiles = slice.length >= 2 ? await routingProvider().laneMiles(toPts(slice)) : null;
    segments.push({
      ...s,
      segmentMiles: segMiles,
      segmentCpm: segMiles && s.segmentRevenue ? Math.round((s.segmentRevenue / segMiles) * 100) / 100 : null,
    });
  }
  return { ...l, laneMiles: miles, cpm, segments };
}

/* ---- split / relay ------------------------------------------------------- */
/** split at the sorted-stop indexes in `cuts` (each cut = handoff/shuttle stop).
    2 segments = one cut. Revenue defaults to a miles-proportional split of the
    load rate; each segment starts on the load's truck until reassigned. */
export function buildSegments(l: Load, cuts: number[]): LoadSegment[] {
  const sorted = l.stops.slice().sort((a, b) => a.sequence - b.sequence);
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < sorted.length - 1).sort((a, b) => a - b), sorted.length - 1];
  const segs: LoadSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    segs.push({
      id: `seg-${Date.now()}-${i}`,
      label: `Segment ${i + 1}`,
      fromStop: bounds[i], toStop: bounds[i + 1],
      assignedTruck: l.assignedTruck, assignedTeamId: l.assignedTeamId, driverIds: [],
      status: l.status,
      segmentRevenue: null, segmentMiles: null, segmentCpm: null,
    });
  }
  return segs;
}

/** default the per-segment revenue to a miles-proportional split of the rate */
export function proportionRevenue(l: Load): Load {
  const total = l.segments.reduce((n, s) => n + (s.segmentMiles ?? 0), 0);
  if (!l.rate || !total) return l;
  const segments = l.segments.map((s) => ({
    ...s,
    segmentRevenue: s.segmentRevenue ?? Math.round((l.rate! * ((s.segmentMiles ?? 0) / total)) * 100) / 100,
  }));
  return { ...l, segments };
}

export interface LoadTotals { revenue: number; miles: number; blendedCpm: number | null; segments: number; trucks: number }
export function loadTotals(l: Load): LoadTotals {
  if (l.segments.length === 0) {
    return { revenue: l.rate ?? 0, miles: l.laneMiles ?? 0, blendedCpm: l.cpm, segments: 0, trucks: 1 };
  }
  const revenue = l.segments.reduce((n, s) => n + (s.segmentRevenue ?? 0), 0);
  const miles = l.segments.reduce((n, s) => n + (s.segmentMiles ?? 0), 0);
  return {
    revenue, miles,
    blendedCpm: miles ? Math.round((revenue / miles) * 100) / 100 : null,
    segments: l.segments.length,
    trucks: new Set(l.segments.map((s) => s.assignedTruck).filter(Boolean)).size,
  };
}

/** shuttle/handoff city label between segment i and i+1 (the shared stop) */
export function handoffLabel(l: Load, i: number): string {
  const sorted = l.stops.slice().sort((a, b) => a.sequence - b.sequence);
  const s = sorted[l.segments[i]?.toStop ?? -1];
  return s ? [s.city, s.state].filter(Boolean).join(', ') || s.address || 'shuttle point' : 'shuttle point';
}

/** write a board cell for every segment truck (route label carries the segment
    tag) and clear cells for trucks that were dropped by a re-split */
export async function syncSegmentAssignments(l: Load, prevTrucks: string[]) {
  const now = l.segments.length
    ? l.segments.map((s, i) => ({ truck: s.assignedTruck, label: `${l.routeName} ⇄ ${s.label}/${l.segments.length} (${i < l.segments.length - 1 ? '→ ' + handoffLabel(l, i) : 'final'})`, status: s.status }))
    : [{ truck: l.assignedTruck, label: l.routeName, status: l.status }];
  const keep = new Set(now.map((x) => x.truck));
  for (const t of prevTrucks) if (t && !keep.has(t)) await setAssignment(t, l.date, null);
  for (const x of now) if (x.truck) await setAssignment(x.truck, l.date, { route: x.label, status: x.status, usps: l.uspsContract });
}

/** all trucks a load currently occupies on the board */
export function loadTrucks(l: Load): string[] {
  return l.segments.length ? l.segments.map((s) => s.assignedTruck).filter(Boolean) : [l.assignedTruck].filter(Boolean);
}

/* ---- financial attribution (per truck/team; per segment for splits) ------ */
export interface AttributionRow {
  loadId: string; date: string; routeName: string; laneKey: string;
  customer: string; truck: string; teamId: string;
  revenue: number; miles: number; segmentLabel: string;
}
export function attributionRows(loads: Load[]): AttributionRow[] {
  const out: AttributionRow[] = [];
  const laneOf = (r: string) => r.replace(/\s+⇄.*$/, '').trim() || '(unnamed)';
  for (const l of loads) {
    if (l.segments.length === 0) {
      out.push({
        loadId: l.id, date: l.date, routeName: l.routeName, laneKey: laneOf(l.routeName),
        customer: l.customerName || '(no customer)', truck: l.assignedTruck, teamId: l.assignedTeamId,
        revenue: l.rate ?? 0, miles: l.laneMiles ?? 0, segmentLabel: '',
      });
    } else {
      for (const s of l.segments) {
        out.push({
          loadId: l.id, date: l.date, routeName: l.routeName, laneKey: laneOf(l.routeName),
          customer: l.customerName || '(no customer)', truck: s.assignedTruck, teamId: s.assignedTeamId,
          revenue: s.segmentRevenue ?? 0, miles: s.segmentMiles ?? 0, segmentLabel: s.label,
        });
      }
    }
  }
  return out;
}

/* ---- dispatch readiness (the "shell" rule: only these block dispatch) ---- */
export function missingForDispatch(l: Load): string[] {
  const out: string[] = [];
  if (!l.routeName.trim()) out.push('Route name');
  if (!l.customerName.trim()) out.push('Customer');
  if (!l.equipment.trim()) out.push('Equipment');
  if (!l.assignedTruck.trim()) out.push('Assigned truck');
  if (!l.stops.some((s) => s.type === 'pickup')) out.push('At least one pickup stop');
  if (!l.stops.some((s) => s.type === 'delivery')) out.push('At least one delivery stop');
  return out;
}

export const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const fmtMiles = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString()} mi`);
export const fmtCpm = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}/mi`);

/** doc-count helper for board badges (async; view caches it) */
export { cellKey };
