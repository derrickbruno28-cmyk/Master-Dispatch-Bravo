/* Master Drivers List — the roster of everyone active with the company. Teams
   in Fleet Status draw their driver names from here (autofill), and each driver
   carries their position + constraints (which show next to their name). Import
   from CSV so the whole roster loads at once. Browser today; Firestore later. */

import { loadFleet } from './fleetStore';

export interface Driver {
  id: string;
  name: string;
  position: string;
  address: string;
  phone: string;
  constraints: string;
}

/* Starter positions (extensible via the options store). */
export const DEFAULT_POSITIONS = [
  'OTR Team', 'Solo', 'Solo Regional', 'OMNI', 'Source One',
  'Memphis Local', 'San Antonio Local', 'Dallas Local',
  'SATX Hero', 'Dallas Hero', 'Memphis Hero',
];

const KEY = 'asset-drivers-v1';

function read(): Driver[] {
  try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r) as Driver[]; } catch { /* ignore */ }
  return seedFromFleet();
}
function write(list: Driver[]) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ } }

/* Seed the roster from the names already on the trucks, so the list isn't empty
   before the real import. Position guessed from the truck type. */
function seedFromFleet(): Driver[] {
  const seen = new Set<string>();
  const out: Driver[] = [];
  for (const t of loadFleet()) {
    for (const nm of [t.driver1, t.driver2]) {
      const name = (nm || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ id: `drv-${out.length}`, name, position: t.type || 'OTR Team', address: '', phone: '', constraints: '' });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function loadDrivers(): Driver[] { return read(); }
export function driverNames(): string[] { return read().map((d) => d.name); }
export function driverByName(name: string): Driver | undefined {
  const n = name.trim().toLowerCase();
  return read().find((d) => d.name.toLowerCase() === n);
}

export function saveDriver(d: Driver) {
  const list = read();
  const i = list.findIndex((x) => x.id === d.id);
  if (i >= 0) list[i] = d; else list.push(d);
  write(list);
  return list;
}
export function removeDriver(id: string) {
  const list = read().filter((d) => d.id !== id);
  write(list);
  return list;
}
export function blankDriver(): Driver {
  return { id: `drv-${Date.now()}`, name: '', position: 'OTR Team', address: '', phone: '', constraints: '' };
}

/* CSV import. Accepts a header row (name/position/address/phone/constraints in
   any order) or a plain "name,position,address,phone,constraints" order. Adds
   new names, updates existing ones by name. Returns {added, updated}. */
export function importDriversCsv(text: string): { added: number; updated: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { added: 0, updated: 0 };
  const parse = (line: string) => {
    const out: string[] = []; let cur = ''; let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim().replace(/^"|"$/g, ''));
  };
  const first = parse(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = first.some((h) => ['name', 'driver', 'position', 'address', 'phone', 'constraint', 'constraints'].includes(h));
  const cols = hasHeader ? first : ['name', 'position', 'address', 'phone', 'constraints'];
  const idx = (names: string[]) => cols.findIndex((c) => names.includes(c));
  const iName = hasHeader ? idx(['name', 'driver']) : 0;
  const iPos = hasHeader ? idx(['position', 'role']) : 1;
  const iAddr = hasHeader ? idx(['address']) : 2;
  const iPhone = hasHeader ? idx(['phone', 'cell']) : 3;
  const iCon = hasHeader ? idx(['constraints', 'constraint', 'notes']) : 4;

  const list = read();
  const byName = new Map(list.map((d) => [d.name.toLowerCase(), d]));
  let added = 0, updated = 0;
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const c = parse(line);
    const name = (c[iName] ?? '').trim();
    if (!name) continue;
    const rec = {
      name,
      position: (iPos >= 0 ? c[iPos] : '') || 'OTR Team',
      address: iAddr >= 0 ? (c[iAddr] ?? '') : '',
      phone: iPhone >= 0 ? (c[iPhone] ?? '') : '',
      constraints: iCon >= 0 ? (c[iCon] ?? '') : '',
    };
    const ex = byName.get(name.toLowerCase());
    if (ex) { Object.assign(ex, rec); updated++; }
    else { const d = { id: `drv-${Date.now()}-${added}`, ...rec }; list.push(d); byName.set(name.toLowerCase(), d); added++; }
  }
  write(list.sort((a, b) => a.name.localeCompare(b.name)));
  return { added, updated };
}
