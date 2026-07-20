/* Editable fleet — teams/trucks you can add, edit, and remove. Seeded from the
   ported roster (data/fleet), then owned by the user. Browser today; the same
   shape moves to shared Firestore later (like the schedule store). */

import { TRUCKS as SEED, TERMINALS, TERMINAL_LABELS } from './fleet';

export interface FleetTruck {
  tractor: string; rating: string; driver1: string; driver2: string;
  type: string; currentCity: string; homeCity: string; returnDate: string;
  hoursAvail: number; status: string; currentRoute: string;
  constraints: string;      // per-team dispatch constraints (free text)
}

export { TERMINALS, TERMINAL_LABELS };

const KEY = 'asset-fleet-v1';

function read(): FleetTruck[] {
  try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r) as FleetTruck[]; } catch { /* ignore */ }
  return SEED.map((t) => ({ ...t, constraints: '' }));
}
function write(list: FleetTruck[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function loadFleet(): FleetTruck[] { return read(); }

export function saveTruck(t: FleetTruck) {
  const list = read();
  const i = list.findIndex((x) => x.tractor === t.tractor);
  if (i >= 0) list[i] = t; else list.push(t);
  write(list);
  return list;
}

export function removeTruck(tractor: string) {
  const list = read().filter((t) => t.tractor !== tractor);
  write(list);
  return list;
}

export function blankTruck(): FleetTruck {
  return {
    tractor: '', rating: 'A', driver1: '', driver2: '', type: 'OTR Team',
    currentCity: 'DALLAS', homeCity: 'DALLAS', returnDate: '', hoursAvail: 70,
    status: 'available', currentRoute: '', constraints: '',
  };
}

export const TRUCK_TYPES = ['OTR Team', 'OTR Solo', 'OMNI Weekly Team', 'Memphis Local', 'Regional'];
