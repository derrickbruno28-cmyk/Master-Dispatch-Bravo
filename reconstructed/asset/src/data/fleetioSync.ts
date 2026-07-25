/* Fleetio → Asset Matrix sync (READ ONLY — nothing is ever written to Fleetio).
   - importFromFleetio(): one-time pull that creates a truck profile for every
     Fleetio unit we don't have yet and stamps odometer + unit rating on all of
     them. (Run it once, drop the rating SOP, re-run to re-rate, then stop.)
   - startOdometerSync(): reads every unit's odometer from Fleetio once now and
     then every hour, updating each truck profile in place. */

import { loadFleet, saveTruck, blankTruck, type FleetTruck } from './fleetStore';
import { fleetioClient } from '../integrations/telematics';

export interface ImportResult { created: number; updated: number; total: number }

/* Create a profile for every Fleetio unit + refresh odometer / make. Units are
   imported UNRATED — the A/B/C/D unit rating is set MANUALLY for now, so we never
   stamp (or overwrite) unitRating here. */
export async function importFromFleetio(): Promise<ImportResult> {
  const units = await fleetioClient().units();
  const byTractor = new Map(loadFleet().map((t) => [t.tractor, t]));
  const now = new Date().toISOString();
  let created = 0, updated = 0;
  for (const u of units) {
    if (!u.truck) continue;
    const existing = byTractor.get(u.truck);
    if (existing) {
      saveTruck({ ...existing, odometer: u.odometer, odoAt: now, make: u.make || existing.make });
      updated++;
    } else {
      /* new unit → bare profile: just the tractor + make. Type, home terminal,
         current city, and status stay BLANK until a crew is assigned. */
      const t: FleetTruck = {
        ...blankTruck(), tractor: u.truck, odometer: u.odometer, odoAt: now, make: u.make,
        unitRating: '', type: '', currentCity: '', homeCity: '', status: '', constraints: '',
      };
      saveTruck(t);
      created++;
    }
  }
  return { created, updated, total: units.length };
}

/* hourly odometer refresh — updates existing profiles only (no creation), and
   only writes when the reading actually changed (no churn). Ratings are NOT
   recomputed here — they're set manually, so an hourly sync never touches them. */
export async function syncOdometersOnce(): Promise<number> {
  const units = await fleetioClient().units();
  const byTruck = new Map(units.map((u) => [u.truck, u]));
  const now = new Date().toISOString();
  let n = 0;
  for (const t of loadFleet()) {
    const u = byTruck.get(t.tractor);
    if (!u) continue;
    const make = u.make || t.make || '';
    if (u.odometer === t.odometer && make === (t.make || '')) continue; // no change
    saveTruck({ ...t, odometer: u.odometer, odoAt: now, make });
    n++;
  }
  return n;
}

let started = false;
export function startOdometerSync() {
  if (started) return;
  started = true;
  void syncOdometersOnce();
  setInterval(() => { void syncOdometersOnce(); }, 60 * 60 * 1000);   // every hour
}
