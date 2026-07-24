/* Master Drivers List — the roster + a driver-availability hub. Each driver has
   a ready-to-go date, a return date, and a weekly availability pattern. Names
   here autofill the Fleet team card; a driver whose team has a route on the
   Asset Matrix shows ASSIGNED here so they can't be double-booked.

   SHARED DATA: when Firebase is configured this roster lives in the Firestore
   `assetDrivers` collection and live-syncs across everyone (onSnapshot) — a
   teammate editing a driver's ready/return date shows up for the whole team in
   real time. In demo (no Firebase) it falls back to localStorage. Same pattern
   as the user roster (usersStore). */

import { db, firebaseEnabled } from '../firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { loadFleet } from './fleetStore';
import { loadAssignments, parseCellKey } from './schedule';
import { emitChange } from './bus';
import { DRIVER_SEED } from './driversSeed';

export interface Driver {
  id: string;
  name: string;
  position: string;
  homeCity: string;    // city the driver lives in / is picked up from (e.g. "Dallas TX")
  address: string;
  phone: string;
  constraints: string;
  readyDate: string;   // YYYY-MM-DD — available to dispatch on/after
  returnDate: string;  // YYYY-MM-DD — needs to be home by
  pattern: string;     // one of AVAIL_PATTERNS
  flag: string;        // review flag (1-on-1 call, off/unresponsive, no terminal…); '' = ok
}

export const DEFAULT_POSITIONS = [
  'OTR Team', 'Solo', 'Solo Regional', 'OMNI', 'Source One',
  'Memphis Local', 'San Antonio Local', 'Dallas Local',
  'SATX Hero', 'Dallas Hero', 'Memphis Hero',
];

export const AVAIL_PATTERNS = ['Mon–Sat', 'Tue–Sun', 'Sun–Fri', 'Wed–Mon', '5 Days', 'Running Wild'];

const KEY = 'asset-drivers-v2';   // v2 = seeded from the real MASTER DISPATCH roster
const COL = 'assetDrivers';       // shared Firestore collection

function norm(d: Partial<Driver>): Driver {
  return { id: d.id ?? `drv-${Math.random().toString(36).slice(2)}`, name: d.name ?? '', position: d.position ?? 'OTR Team', homeCity: d.homeCity ?? cityFromAddress(d.address ?? ''), address: d.address ?? '', phone: d.phone ?? '', constraints: d.constraints ?? '', readyDate: d.readyDate ?? '', returnDate: d.returnDate ?? '', pattern: d.pattern ?? '', flag: d.flag ?? '' };
}

/* best-effort "City ST" from a free-text address, used only to pre-fill homeCity
   when it wasn't set explicitly (e.g. "123 Main St, Dallas TX 75201" → "Dallas TX") */
export function cityFromAddress(addr: string): string {
  const a = (addr || '').trim(); if (!a) return '';
  const parts = a.split(',').map((s) => s.trim()).filter(Boolean);
  const tail = parts.length > 1 ? parts[parts.length - 1] : a;
  const m = tail.match(/([A-Za-z][A-Za-z.\s]+?)\s+([A-Z]{2})\b/);   // "Dallas TX"
  if (m) return `${m[1].trim()} ${m[2]}`;
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

/* the city a driver is picked up from (explicit homeCity wins, else parsed) */
export function driverHomeCity(name: string): string {
  const d = driverByName(name); if (!d) return '';
  return (d.homeCity || '').trim() || cityFromAddress(d.address);
}
/* normalized compare key so "Dallas TX" and "dallas,  tx" match */
export function cityKey(city: string): string { return (city || '').toLowerCase().replace(/[^a-z]/g, ''); }

/* seed the full roster parsed from the MASTER DISPATCH sheet (K & L columns) */
function seedFromSheet(): Driver[] {
  return DRIVER_SEED.map((d, i) => norm({ id: `drv-${i}`, ...d })).sort((a, b) => a.name.localeCompare(b.name));
}
const byName = (a: Driver, b: Driver) => a.name.localeCompare(b.name);

/* ---- shared cache (Firestore-backed when live, localStorage in demo) ---- */
function readLocal(): Driver[] | null {
  try { const r = localStorage.getItem(KEY); if (r) return (JSON.parse(r) as Driver[]).map(norm); } catch { /* ignore */ }
  return null;
}
function writeLocal() { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ } }

/* pre-hydration placeholder: last-known local copy, else the build's seed roster
   (in live mode the onSnapshot below replaces this within a second) */
let cache: Driver[] = readLocal() ?? seedFromSheet();
let synced = false;
let hydrated = false;   // true once Firestore's first snapshot has arrived

/* live-subscribe to the shared roster (once). On an EMPTY collection (first ever
   run) seed it from the build's master list — idempotent by doc id, so it's safe
   even if two clients race. */
export function startDriversSync() {
  if (synced || !firebaseEnabled || !db) return;
  synced = true;
  const database = db;
  onSnapshot(collection(database, COL), (snap) => {
    if (snap.empty && !hydrated) {
      hydrated = true;
      for (const d of seedFromSheet()) {
        setDoc(doc(database, COL, d.id), d as unknown as Record<string, unknown>).catch((e) => console.error('driver seed failed', e));
      }
      return; // the seed writes re-fire this snapshot with the data
    }
    hydrated = true;
    cache = snap.docs.map((d) => norm({ ...(d.data() as Partial<Driver>), id: d.id })).sort(byName);
    emitChange();
  }, (e) => console.error('drivers sync failed', e));
}
if (firebaseEnabled) startDriversSync();

function read(): Driver[] { return cache; }

/* one-shot re-pull from the shared roster (in case the live subscription stalled) */
export async function refreshDriversFromShared(): Promise<number> {
  if (!firebaseEnabled || !db) return cache.length;
  const snap = await getDocs(collection(db, COL));
  if (!snap.empty) { cache = snap.docs.map((d) => norm({ ...(d.data() as Partial<Driver>), id: d.id })).sort(byName); emitChange(); }
  return cache.length;
}

/* persist one driver — a single Firestore doc when live, whole list in demo */
function persistOne(d: Driver) {
  if (firebaseEnabled && db) setDoc(doc(db, COL, d.id), d as unknown as Record<string, unknown>).catch((e) => console.error('driver write failed', e));
  else writeLocal();
}

/* The team status of the truck this driver is on (NTB / Deadhead / …), so the
   drivers list can stay congruent with the Fleet card and the Matrix. */
export function teamStatusOf(name: string): string {
  const n = name.trim().toLowerCase(); if (!n) return '';
  const t = loadFleet().find((x) => x.driver1.toLowerCase() === n || x.driver2.toLowerCase() === n);
  return t?.status ?? '';
}

export function loadDrivers(): Driver[] { return read(); }
export function driverNames(): string[] { return read().map((d) => d.name); }
export function driverByName(name: string): Driver | undefined {
  const n = name.trim().toLowerCase();
  return read().find((d) => d.name.toLowerCase() === n);
}
export function saveDriver(d: Driver) {
  const nd = norm(d);
  const i = cache.findIndex((x) => x.id === nd.id);
  cache = (i >= 0 ? cache.map((x) => (x.id === nd.id ? nd : x)) : [...cache, nd]).sort(byName);
  persistOne(nd);
  emitChange();
  return cache;
}
export function removeDriver(id: string) {
  cache = cache.filter((d) => d.id !== id);
  if (firebaseEnabled && db) deleteDoc(doc(db, COL, id)).catch((e) => console.error('driver delete failed', e));
  else writeLocal();
  emitChange();
  return cache;
}
export function blankDriver(): Driver { return norm({ id: `drv-${Date.now()}` }); }

/* ---- availability ---- */
export function todayISO(): string { return new Date().toISOString().slice(0, 10); }
export function daysUntil(dateISO: string): number | null {
  if (!dateISO) return null;
  const ms = Date.parse(`${dateISO}T00:00:00`) - Date.parse(`${todayISO()}T00:00:00`);
  return Math.round(ms / 86400000);
}

/* A driver's live assignment (from their team's routes on the Asset Matrix). */
export function driverAssignment(name: string): { tractor: string; route: string; date: string } | null {
  const n = name.trim().toLowerCase(); if (!n) return null;
  const trucks = loadFleet().filter((t) => t.driver1.toLowerCase() === n || t.driver2.toLowerCase() === n).map((t) => t.tractor);
  if (!trucks.length) return null;
  const assigns = loadAssignments();
  const hits: { tractor: string; route: string; date: string }[] = [];
  for (const [k, a] of Object.entries(assigns)) {
    const { tractor, date } = parseCellKey(k);
    if (trucks.includes(tractor) && a.route?.trim()) hits.push({ tractor, route: a.route, date });
  }
  hits.sort((a, b) => a.date.localeCompare(b.date));
  return hits[0] ?? null;
}

export interface Availability { assigned: { tractor: string; route: string; date: string } | null; available: boolean; daysLeft: number | null; }
export function availabilityOf(d: Driver): Availability {
  const assigned = driverAssignment(d.name);
  const daysLeft = daysUntil(d.returnDate);
  const today = todayISO();
  const ready = !!d.readyDate && d.readyDate <= today;
  const notReturned = !d.returnDate || d.returnDate >= today;
  return { assigned, available: !assigned && ready && notReturned, daysLeft };
}

/* CSV import — columns (any order, header auto-detected):
   name, position, address, phone, constraints, ready, return, pattern */
export function importDriversCsv(text: string): { added: number; updated: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { added: 0, updated: 0 };
  const parse = (line: string) => {
    const out: string[] = []; let cur = ''; let q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out.map((s) => s.trim().replace(/^"|"$/g, ''));
  };
  const first = parse(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = first.some((h) => ['name', 'driver', 'position', 'homecity', 'home city', 'city', 'address', 'phone', 'constraint', 'constraints', 'ready', 'return', 'pattern'].includes(h));
  const cols = hasHeader ? first : ['name', 'position', 'homecity', 'address', 'phone', 'constraints', 'ready', 'return', 'pattern'];
  const idx = (names: string[], def: number) => { const i = cols.findIndex((c) => names.includes(c)); return hasHeader ? i : def; };
  const iName = idx(['name', 'driver'], 0), iPos = idx(['position', 'role'], 1), iHome = idx(['homecity', 'home city', 'city'], 2),
    iAddr = idx(['address'], 3), iPhone = idx(['phone', 'cell'], 4), iCon = idx(['constraints', 'constraint'], 5),
    iReady = idx(['ready', 'readydate', 'ready to go'], 6), iRet = idx(['return', 'returndate'], 7), iPat = idx(['pattern', 'schedule'], 8);

  const list = read().map((d) => ({ ...d })); const nameMap = new Map(list.map((d) => [d.name.toLowerCase(), d]));
  const affected: Driver[] = [];
  let added = 0, updated = 0;
  const normDate = (s: string) => { const t = (s || '').trim(); if (!t) return ''; const d = new Date(t); return isNaN(+d) ? '' : d.toISOString().slice(0, 10); };
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const c = parse(line); const name = (c[iName] ?? '').trim(); if (!name) continue;
    const rec = {
      name, position: (iPos >= 0 ? c[iPos] : '') || 'OTR Team',
      homeCity: iHome >= 0 ? (c[iHome] ?? '') : '',
      address: iAddr >= 0 ? (c[iAddr] ?? '') : '', phone: iPhone >= 0 ? (c[iPhone] ?? '') : '',
      constraints: iCon >= 0 ? (c[iCon] ?? '') : '', readyDate: iReady >= 0 ? normDate(c[iReady]) : '',
      returnDate: iRet >= 0 ? normDate(c[iRet]) : '', pattern: iPat >= 0 ? (c[iPat] ?? '') : '',
    };
    const ex = nameMap.get(name.toLowerCase());
    if (ex) { Object.assign(ex, rec); affected.push(ex); updated++; }
    else { const d = norm({ id: `drv-${Date.now()}-${added}`, ...rec }); list.push(d); nameMap.set(name.toLowerCase(), d); affected.push(d); added++; }
  }
  cache = list.sort(byName);
  if (firebaseEnabled && db) { for (const d of affected) persistOne(d); }
  else writeLocal();
  emitChange();
  return { added, updated };
}
