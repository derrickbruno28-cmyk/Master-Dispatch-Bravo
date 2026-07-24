/* Trailers — the trailer pool, editable like the fleet. Browser localStorage now,
   write-through to a shared Firestore `assetTrailers` collection when Firebase is
   configured (same pattern as fleetStore). Kept deliberately small: number, type,
   status, current location, notes. */

import { emitChange } from './bus';
import { db, firebaseEnabled } from '../firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';

export interface Trailer {
  number: string;      // trailer # (id)
  type: string;        // 53' Dry Van, Reefer, …
  status: string;      // Available / In Use / In Shop / Out of Service
  location: string;    // current city / yard
  notes: string;
}

export const TRAILER_TYPES = ["53' Dry Van", "53' Reefer", "48' Dry Van", "Flatbed", "Container Chassis"];
export const TRAILER_STATUSES = ['Available', 'In Use', 'In Shop', 'Out of Service'];

const KEY = 'asset-trailers-v1';
const COL = 'assetTrailers';

const SEED: Trailer[] = [
  { number: '53012', type: "53' Dry Van", status: 'Available', location: 'DALLAS', notes: '' },
  { number: '53044', type: "53' Dry Van", status: 'In Use', location: 'SATX', notes: '' },
  { number: '53101', type: "53' Reefer", status: 'Available', location: 'MEMPHIS', notes: '' },
  { number: '48220', type: "48' Dry Van", status: 'In Shop', location: 'DALLAS', notes: 'Brake service' },
];

function norm(t: Partial<Trailer>): Trailer {
  return { number: t.number ?? '', type: t.type ?? "53' Dry Van", status: t.status ?? 'Available', location: t.location ?? '', notes: t.notes ?? '' };
}
function readLocal(): Trailer[] | null {
  try { const r = localStorage.getItem(KEY); if (r) return (JSON.parse(r) as Trailer[]).map(norm); } catch { /* ignore */ }
  return null;
}
function writeLocal() { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ } }

let cache: Trailer[] = readLocal() ?? SEED.map(norm);
let synced = false;
let hydrated = false;

export function startTrailerSync() {
  if (synced || !firebaseEnabled || !db) return;
  synced = true;
  const database = db;
  onSnapshot(collection(database, COL), (snap) => {
    if (snap.empty && !hydrated) {
      hydrated = true;
      for (const t of SEED) setDoc(doc(database, COL, t.number), t as unknown as Record<string, unknown>).catch((e) => console.error('trailer seed failed', e));
      return;
    }
    hydrated = true;
    cache = snap.docs.map((d) => norm({ ...(d.data() as Partial<Trailer>), number: d.id }));
    emitChange();
  }, (e) => console.error('trailer sync failed', e));
}
if (firebaseEnabled) startTrailerSync();

export function loadTrailers(): Trailer[] { return cache; }

export function saveTrailer(t: Trailer) {
  const nt = norm(t);
  const i = cache.findIndex((x) => x.number === nt.number);
  cache = i >= 0 ? cache.map((x) => (x.number === nt.number ? nt : x)) : [...cache, nt];
  if (firebaseEnabled && db) setDoc(doc(db, COL, nt.number), nt as unknown as Record<string, unknown>).catch((e) => console.error('trailer write failed', e));
  else writeLocal();
  emitChange();
  return cache;
}

export function removeTrailer(number: string) {
  cache = cache.filter((t) => t.number !== number);
  if (firebaseEnabled && db) deleteDoc(doc(db, COL, number)).catch((e) => console.error('trailer delete failed', e));
  else writeLocal();
  emitChange();
  return cache;
}

export function blankTrailer(): Trailer { return norm({}); }
