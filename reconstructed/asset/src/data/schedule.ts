/* Asset Matrix schedule — the ONE data layer every view reads/writes through.

   Backend seam for going team-wide:
   - DEMO (no Firebase config): assignments live in the browser (localStorage),
     which is what runs today.
   - LIVE (Firebase configured — firebaseEnabled): every write also goes to the
     SHARED Firestore `assetSchedule` collection, so the board is multi-user.
     USPS assignments additionally mirror into Bravo's `loads` as status:'asset'
     (see mirrorToBravo) so a contract-truck assignment shows in BOTH apps —
     the "coincide" mechanism. Flipping this on is a config step (an app/.env.local
     with the Firebase web config); the code path below is ready for it. */

import { db, firebaseEnabled } from '../firebase';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { emitChange } from './bus';

export interface Assignment { route: string; status: string; usps: boolean }

export const cellKey = (tractor: string, date: string) => `${tractor}_${date}`;
export function parseCellKey(k: string): { tractor: string; date: string } {
  const i = k.indexOf('_');
  return { tractor: k.slice(0, i), date: k.slice(i + 1) };
}

/* ---- date helpers (shared so the grid + seed key loads to the same day) ---- */
export function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
export function mondayOf(d: Date) { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; }
export function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const LS_KEY = 'asset-matrix-v1';

function readLocal(): Record<string, Assignment> {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw) as Record<string, Assignment>; } catch { /* ignore */ }
  return {};
}
function writeLocal(map: Record<string, Assignment>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch { /* ignore */ }
  emitChange();
}

/* Demo seed so the board isn't empty on first run. */
function seed(): Record<string, Assignment> {
  const out: Record<string, Assignment> = {};
  const mon = mondayOf(new Date());
  const put = (tractor: string, dayIdx: number, a: Assignment) => { out[cellKey(tractor, isoDate(addDays(mon, dayIdx)))] = a; };
  put('447', 0, { route: 'FA2D3-1 Coppell→Memphis', status: 'dispatched', usps: true });
  put('456', 1, { route: 'FA2D3-544 Irving→SATX', status: 'covered', usps: true });
  put('758', 2, { route: '16193 Opa-Irv', status: 'departed', usps: false });
  put('958', 0, { route: 'FA2D3-354 Memphis→Nashville', status: 'covered', usps: true });
  put('444', 3, { route: '34hr reset — Houston', status: 'off', usps: false });
  return out;
}

/* Persist the seed once so all views (Matrix, Covered) see the same demo data. */
export function ensureSeed() {
  const cur = readLocal();
  if (Object.keys(cur).length === 0) writeLocal(seed());
}

export function loadAssignments(): Record<string, Assignment> { return readLocal(); }

/* ---- load-status vocabulary (the ONE source; the Matrix cell + the Fleet
   Status page both read these so a truck's operational status never disagrees
   with the calendar) ---- */
export const LOAD_STATUSES = ['open', 'covered', 'dispatched', 'at yard', 'at shipper', 'en route', 'at receiver', 'delivered', 'completed', 'off'] as const;
export const LOAD_STATUS_COLOR: Record<string, string> = {
  open: 'var(--muted)', covered: 'var(--green)', dispatched: '#00b8d4',
  'at yard': '#b0842a', 'at shipper': '#e8a33d', 'en route': 'var(--accent)',
  'at receiver': '#7c5cff', delivered: '#6b7f9e', completed: '#a78bfa', off: 'var(--panel-2)',
};
export const LOAD_STATUS_LABEL: Record<string, string> = {
  open: 'Open', covered: 'Covered', dispatched: 'Dispatched',
  'at shipper': 'At Shipper', 'at yard': 'At Yard', 'en route': 'En Route',
  'at receiver': 'At Receiver', delivered: 'Delivered', completed: 'Completed', off: 'Off / Home',
};

/* A truck's LIVE operational status, read straight from the calendar: today's
   load wins; otherwise the most recent still-in-progress load (not delivered /
   completed / off). Returns null when the truck has no active calendar load — the
   Fleet Status page then falls back to the team's availability status. */
export function currentLoadStatus(tractor: string, assign?: Record<string, Assignment>): { route: string; status: string; date: string } | null {
  const map = assign ?? readLocal();
  const today = isoDate(new Date());
  const todayA = map[cellKey(tractor, today)];
  if (todayA && todayA.route.trim()) return { route: todayA.route, status: todayA.status, date: today };
  const DONE = new Set(['delivered', 'completed', 'off']);
  let best: { route: string; status: string; date: string } | null = null;
  for (const [k, a] of Object.entries(map)) {
    const { tractor: tr, date } = parseCellKey(k);
    if (tr !== tractor || !a.route.trim() || DONE.has(a.status) || date > today) continue;
    if (!best || date > best.date) best = { route: a.route, status: a.status, date };
  }
  return best;
}

/* Single write path. Updates the browser copy (demo) and, when live, the shared
   Firestore collection + Bravo mirror. Pass a null/blank assignment to clear. */
export async function setAssignment(tractor: string, date: string, a: Assignment | null) {
  const map = readLocal();
  const k = cellKey(tractor, date);
  const clear = !a || !a.route.trim();
  if (clear) delete map[k]; else map[k] = a!;
  writeLocal(map);

  if (firebaseEnabled && db) {
    try {
      const ref = doc(db, 'assetSchedule', k);
      if (clear) await deleteDoc(ref);
      else await setDoc(ref, { tractor, date, ...a });
      await mirrorToBravo(tractor, date, clear ? null : a!);
    } catch (e) {
      console.error('assetSchedule write failed', e);
    }
  }
}

/* ---- double-booking guard --------------------------------------------------
   A driver is double-booked if the SAME person (by name, across driver1/driver2)
   is on another truck that already has a route on that same day. Pure — takes the
   live assign map + fleet so it reflects unsaved grid edits, not just storage. */
export interface DriverConflict { driver: string; tractor: string; route: string }
export function driverConflicts(
  tractor: string, date: string,
  assign: Record<string, Assignment>,
  fleet: { tractor: string; driver1: string; driver2: string }[],
): DriverConflict[] {
  const me = fleet.find((t) => t.tractor === tractor);
  if (!me) return [];
  const mine = [me.driver1, me.driver2].map((d) => (d || '').trim().toLowerCase()).filter(Boolean);
  if (!mine.length) return [];
  const out: DriverConflict[] = [];
  for (const t of fleet) {
    if (t.tractor === tractor) continue;
    const a = assign[cellKey(t.tractor, date)];
    if (!a || !a.route.trim()) continue;
    for (const dn of [t.driver1, t.driver2]) {
      const key = (dn || '').trim().toLowerCase();
      if (key && mine.includes(key)) out.push({ driver: (dn || '').trim(), tractor: t.tractor, route: a.route });
    }
  }
  return out;
}

/* Move an assignment from one cell to another (drag-to-move). */
export async function moveAssignment(fromKey: string, toKey: string) {
  if (fromKey === toKey) return;
  const a = readLocal()[fromKey];
  if (!a) return;
  const to = parseCellKey(toKey);
  const from = parseCellKey(fromKey);
  await setAssignment(to.tractor, to.date, a);
  await setAssignment(from.tractor, from.date, null);
}

/* ---- reverse coincide: Bravo → Asset ------------------------------------ */
export interface BravoLoad { laneId: string; date: string; status: string; carrier?: string; truckNumber?: string; loadNumber?: string }
export interface BravoLane { id: string; tripCode?: string; origin?: string; destination?: string }

const BRAVO_STATUS: Record<string, string> = {
  asset: 'covered', covered: 'covered', dispatched: 'dispatched', departed: 'departed',
  delivered: 'delivered', booked_rc_pending: 'covered', rc_signed: 'covered', gtg: 'covered',
};

/* Map a Bravo load that's on ONE OF OUR TRUCKS (truckNumber is a GH-only field)
   into an Asset Matrix cell, auto-filling the route from the lane. This is the
   reverse of the mirror: a load assigned to a GH truck on the Bravo Matrix shows
   up here for that team, pre-filled — no re-keying. Pure + unit-testable. */
export function mapBravoAssetLoad(load: BravoLoad, laneById: Map<string, BravoLane>): { key: string; assignment: Assignment } | null {
  const truck = (load.truckNumber ?? '').trim();
  if (!truck) return null;
  const lane = laneById.get(load.laneId);
  const trip = (lane?.tripCode ?? '').trim();
  const o = (lane?.origin ?? '').split('\n')[0].trim();
  const d = (lane?.destination ?? '').split('\n')[0].trim();
  const route = [trip, o && d ? `${o}→${d}` : ''].filter(Boolean).join(' ').trim() || (load.loadNumber ?? 'Load');
  return { key: cellKey(truck, load.date), assignment: { route, status: BRAVO_STATUS[load.status] ?? 'covered', usps: true } };
}

/* LIVE-only: mirror a USPS asset assignment into Bravo's shared `loads` as
   status:'asset' so it appears on the Bravo Matrix too. Requires resolving the
   route's FA2D3 trip code to a Bravo laneId (lookup against the shared `lanes`
   collection) — wired at go-live once both apps point at the same project. */
async function mirrorToBravo(tractor: string, date: string, a: Assignment | null) {
  if (!firebaseEnabled || !db) return;
  if (!a || !a.usps) return; // only contract routes coincide with Bravo
  // TODO(go-live): const laneId = await lookupLaneByTripCode(tripCodeOf(a.route));
  //   then setDoc(doc(db,'loads',`${laneId}_${date}`), { status:'asset', carrier:'GH Logistics', truckNumber: tractor, ... })
  //   Left documented (not executed) so the demo never touches Bravo's data.
  void tractor; void date; void collection;
}

/* LIVE subscription for a team-wide board (onSnapshot). Components use
   loadAssignments() in demo; wire this when Firebase is configured. */
export function subscribeAssignments(cb: (map: Record<string, Assignment>) => void): () => void {
  if (!firebaseEnabled || !db) { cb(readLocal()); return () => {}; }
  /* Live board = Bravo's asset loads (reverse-mapped, auto-filled) MERGED with
     the asset team's own edits, which win on conflict. Three shared collections. */
  let laneById = new Map<string, BravoLane>();
  let bravoLoads: BravoLoad[] = [];
  let assetNative: Record<string, Assignment> = {};
  const emit = () => {
    const merged: Record<string, Assignment> = {};
    for (const l of bravoLoads) { const m = mapBravoAssetLoad(l, laneById); if (m) merged[m.key] = m.assignment; }
    Object.assign(merged, assetNative); // asset-native edits override the mirror
    cb(merged);
  };
  const u1 = onSnapshot(collection(db, 'lanes'), (s) => { laneById = new Map(s.docs.map((d) => [d.id, { ...(d.data() as BravoLane), id: d.id }])); emit(); });
  const u2 = onSnapshot(query(collection(db, 'loads'), where('truckNumber', '!=', '')), (s) => { bravoLoads = s.docs.map((d) => d.data() as BravoLoad); emit(); });
  const u3 = onSnapshot(collection(db, 'assetSchedule'), (s) => { assetNative = {}; s.forEach((d) => { const v = d.data() as Assignment; assetNative[d.id] = { route: v.route, status: v.status, usps: v.usps }; }); emit(); });
  return () => { u1(); u2(); u3(); };
}
