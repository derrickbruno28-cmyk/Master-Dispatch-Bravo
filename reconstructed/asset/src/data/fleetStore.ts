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
    status: 'NTB', currentRoute: '', constraints: '',
  };
}

export const TRUCK_TYPES = ['OTR Team', 'OTR Solo', 'OMNI Weekly Team', 'Memphis Local', 'Regional'];

/* ---- team operational status (set on the Fleet card, shown on the Matrix) ----
   These are the DRIVER/TEAM statuses (distinct from a cell's load status). Set one
   on the Fleet Status card and it shows as a badge on that team's Asset Matrix row.
   NTB = Need To Book → the team needs a load. Deadhead → running empty back toward a
   hub (SATX / Dallas / Memphis) to grab their next load. Shutdown blocks dispatch. */
export const TEAM_STATUS_OPTIONS = [
  'NTB', 'Dispatched', 'En Route', 'Delivering', 'Deadhead', 'On 34hr Reset', 'Shutdown',
];

export interface TeamStatusMeta { label: string; color: string; tint?: string; blocks?: boolean; onMatrix?: boolean }
export function teamStatusMeta(status: string): TeamStatusMeta {
  switch ((status || '').trim().toLowerCase()) {
    case 'ntb': return { label: 'NTB — Needs load', color: '#e8590c', tint: 'rgba(232,89,12,0.10)', onMatrix: true };
    case 'deadhead': return { label: 'Deadhead → hub', color: '#00b8d4', tint: 'rgba(0,184,212,0.10)', onMatrix: true };
    case 'shutdown': return { label: '⛔ Shutdown', color: 'var(--red)', tint: 'rgba(245,80,90,0.10)', blocks: true, onMatrix: true };
    case 'dispatched': return { label: 'Dispatched', color: 'var(--green)', onMatrix: true };
    case 'en route': return { label: 'En route', color: 'var(--accent)', onMatrix: true };
    case 'delivering': return { label: 'Delivering', color: 'var(--amber)', onMatrix: true };
    case 'on 34hr reset': return { label: 'On 34hr reset', color: '#a78bfa', onMatrix: true };
    default: return { label: status || '—', color: 'var(--muted)', onMatrix: !!(status || '').trim() };
  }
}
export function isShutdown(status: string): boolean { return (status || '').trim().toLowerCase() === 'shutdown'; }
