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

/* CSV import — PHASE 10A. Columns: trailer #, type, status, location, notes.
   Matching is by trailer NUMBER, so re-importing an updated list updates the
   records you already have rather than duplicating them. Header row optional. */
export interface TrailerImportResult { added: number; updated: number; skipped: number; errors: string[] }

export function importTrailersCsv(text: string): TrailerImportResult {
  const out: TrailerImportResult = { added: 0, updated: 0, skipped: 0, errors: [] };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return out;

  const split = (line: string): string[] => {
    const cells: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  };

  const first = split(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = first.some((c) => /trailer|number|type|status|location|note/.test(c));
  const idx = {
    number: hasHeader ? first.findIndex((c) => /trailer|number|#/.test(c)) : 0,
    type: hasHeader ? first.findIndex((c) => /type/.test(c)) : 1,
    status: hasHeader ? first.findIndex((c) => /status/.test(c)) : 2,
    location: hasHeader ? first.findIndex((c) => /location|yard|city/.test(c)) : 3,
    notes: hasHeader ? first.findIndex((c) => /note/.test(c)) : 4,
  };

  const existing = new Set(loadTrailers().map((t) => t.number.trim().toLowerCase()));
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cells = split(line);
    const at = (i: number) => (i >= 0 && i < cells.length ? cells[i] : '');
    const number = at(idx.number);
    if (!number) { out.skipped += 1; continue; }
    const known = existing.has(number.toLowerCase());
    saveTrailer({
      number,
      type: at(idx.type),
      status: at(idx.status) || 'Available',
      location: at(idx.location),
      notes: at(idx.notes),
    });
    if (known) out.updated += 1; else { out.added += 1; existing.add(number.toLowerCase()); }
  }
  return out;
}
