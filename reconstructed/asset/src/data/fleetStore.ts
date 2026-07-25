/* Editable fleet — teams/trucks you can add, edit, and remove. Seeded from the
   ported roster (data/fleet), then owned by the user. Browser today; the same
   shape moves to shared Firestore later (like the schedule store). */

import { TRUCKS as SEED, TERMINALS, TERMINAL_LABELS } from './fleet';
import { emitChange } from './bus';
import { db, firebaseEnabled } from '../firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, getDocs } from 'firebase/firestore';

export interface FleetTruck {
  tractor: string; rating: string; driver1: string; driver2: string;
  type: string; currentCity: string; homeCity: string; returnDate: string;
  hoursAvail: number; status: string; currentRoute: string;
  constraints: string;      // per-team dispatch constraints (free text)
  deadheadTo?: string;      // when status = Deadhead, the hub/city they're returning to
  flyer?: '' | 'driver' | 'team';  // dispatch flyer sent → drivers turn yellow
  confirm1?: boolean;       // driver 1 confirmed the load
  confirm2?: boolean;       // driver 2 confirmed the load
  odometer?: number;        // odometer miles — READ from Fleetio (hourly), never written back
  odoAt?: string;           // when the odometer was last synced from Fleetio (ISO)
  make?: string;            // engine/chassis make from Fleetio (drives the rating bands)
  unitRating?: string;      // A/B/C/D by odometer + make (rateByOdometer / SOP)
}

export { TERMINALS, TERMINAL_LABELS };

const KEY = 'asset-fleet-v3';   // v3 = roster reseeded from the Fleetio vehicle export (real GH/AJG units, unrated)
const COL = 'assetFleet';       // shared Firestore collection (one doc per tractor)

function normTruck(t: Partial<FleetTruck>): FleetTruck {
  /* 'delivering' was retired as a team-availability status — operational status
     now reads from the load on the calendar. Migrate any stragglers to En Route. */
  const status = ((t.status ?? '').trim().toLowerCase() === 'delivering') ? 'En Route' : (t.status ?? '');
  return {
    ...(t as FleetTruck),
    status,
    constraints: t.constraints ?? '',
    deadheadTo: t.deadheadTo ?? '',
    flyer: (t.flyer ?? '') as FleetTruck['flyer'],
    confirm1: t.confirm1 ?? false,
    confirm2: t.confirm2 ?? false,
    odometer: t.odometer,
    odoAt: t.odoAt ?? '',
    make: t.make ?? '',
    unitRating: t.unitRating ?? '',
  };
}
function seedTrucks(): FleetTruck[] { return SEED.map((t) => normTruck(t)); }

function readLocal(): FleetTruck[] | null {
  try { const r = localStorage.getItem(KEY); if (r) return (JSON.parse(r) as FleetTruck[]).map(normTruck); } catch { /* ignore */ }
  return null;
}
function writeLocal() { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ } }

/* shared fleet, across the team. Live: filled by the onSnapshot below (seeded
   from the roster on first run). Demo: localStorage, else the built-in seed. */
let cache: FleetTruck[] = readLocal() ?? seedTrucks();
let synced = false;
let hydrated = false;

export function startFleetSync() {
  if (synced || !firebaseEnabled || !db) return;
  synced = true;
  const database = db;
  onSnapshot(collection(database, COL), (snap) => {
    if (snap.empty && !hydrated) {
      hydrated = true;
      for (const t of seedTrucks()) setDoc(doc(database, COL, t.tractor), t as unknown as Record<string, unknown>).catch((e) => console.error('fleet seed failed', e));
      return;
    }
    hydrated = true;
    cache = snap.docs.map((d) => normTruck({ ...(d.data() as Partial<FleetTruck>), tractor: d.id }));
    emitChange();
  }, (e) => console.error('fleet sync failed', e));
}
if (firebaseEnabled) startFleetSync();

export function loadFleet(): FleetTruck[] { return cache; }

/* one-shot re-pull from the shared fleet (in case the live subscription stalled) */
export async function refreshFleetFromShared(): Promise<number> {
  if (!firebaseEnabled || !db) return cache.length;
  const snap = await getDocs(collection(db, COL));
  if (!snap.empty) { cache = snap.docs.map((d) => normTruck({ ...(d.data() as Partial<FleetTruck>), tractor: d.id })); emitChange(); }
  return cache.length;
}

export function saveTruck(t: FleetTruck) {
  const nt = normTruck(t);
  const i = cache.findIndex((x) => x.tractor === nt.tractor);
  cache = i >= 0 ? cache.map((x) => (x.tractor === nt.tractor ? nt : x)) : [...cache, nt];
  if (firebaseEnabled && db) setDoc(doc(db, COL, nt.tractor), nt as unknown as Record<string, unknown>).catch((e) => console.error('fleet write failed', e));
  else writeLocal();
  emitChange();
  return cache;
}

export function removeTruck(tractor: string) {
  cache = cache.filter((t) => t.tractor !== tractor);
  if (firebaseEnabled && db) deleteDoc(doc(db, COL, tractor)).catch((e) => console.error('fleet delete failed', e));
  else writeLocal();
  emitChange();
  return cache;
}

export function blankTruck(): FleetTruck {
  return {
    tractor: '', rating: 'A', driver1: '', driver2: '', type: 'OTR Team',
    currentCity: 'DALLAS', homeCity: 'DALLAS', returnDate: '', hoursAvail: 70,
    status: 'NTB', currentRoute: '', constraints: '', deadheadTo: '', flyer: '', confirm1: false, confirm2: false,
  };
}

export const TRUCK_TYPES = ['OTR Team', 'OTR Solo', 'OMNI Weekly Team', 'Memphis Local', 'Regional'];

/* ---- team operational status (set on the Fleet card, shown on the Matrix) ----
   These are the DRIVER/TEAM statuses (distinct from a cell's load status). Set one
   on the Fleet Status card and it shows as a badge on that team's Asset Matrix row.
   NTB = Need To Book → the team needs a load. Deadhead → running empty back toward a
   hub (SATX / Dallas / Memphis) to grab their next load. Shutdown blocks dispatch. */
export const TEAM_STATUS_OPTIONS = [
  'NTB', 'Dispatched', 'En Route', 'Deadhead', 'On 34hr Reset', 'Shutdown',
];

/* Hubs a team can deadhead back to (editable — add your own destinations too). */
export const DEADHEAD_HUBS = ['San Antonio TX', 'Dallas TX', 'Memphis TN'];

export interface TeamStatusMeta { label: string; color: string; tint?: string; blocks?: boolean; onMatrix?: boolean }
export function teamStatusMeta(status: string): TeamStatusMeta {
  switch ((status || '').trim().toLowerCase()) {
    case 'ntb': return { label: 'NTB — Needs load', color: '#e8590c', tint: 'rgba(232,89,12,0.10)', onMatrix: true };
    case 'deadhead': return { label: 'Deadhead → hub', color: '#00b8d4', tint: 'rgba(0,184,212,0.10)', onMatrix: true };
    case 'shutdown': return { label: '⛔ Shutdown', color: 'var(--red)', tint: 'rgba(245,80,90,0.10)', blocks: true, onMatrix: true };
    case 'dispatched': return { label: 'Dispatched', color: 'var(--green)', onMatrix: true };
    case 'en route': return { label: 'En route', color: 'var(--accent)', onMatrix: true };
    case 'on 34hr reset': return { label: 'On 34hr reset', color: '#a78bfa', onMatrix: true };
    default: return { label: status || '—', color: 'var(--muted)', onMatrix: !!(status || '').trim() };
  }
}
export function isShutdown(status: string): boolean { return (status || '').trim().toLowerCase() === 'shutdown'; }
