/* Fleetio → Asset Matrix sync (READ ONLY — nothing is ever written to Fleetio).
   - importFromFleetio(): one-time pull that creates a truck profile for every
     Fleetio unit we don't have yet and stamps odometer + unit rating on all of
     them. (Run it once, drop the rating SOP, re-run to re-rate, then stop.)
   - startOdometerSync(): reads every unit's odometer from Fleetio once now and
     then every hour, updating each truck profile in place. */

import { loadFleet, saveTruck, blankTruck, type FleetTruck } from './fleetStore';
import { fleetioClient } from '../integrations/telematics';
import { rateByOdometer } from './truckRating';

export interface ImportResult { created: number; updated: number; total: number }

export async function importFromFleetio(): Promise<ImportResult> {
  const units = await fleetioClient().units();
  const byTractor = new Map(loadFleet().map((t) => [t.tractor, t]));
  const now = new Date().toISOString();
  let created = 0, updated = 0;
  for (const u of units) {
    if (!u.truck) continue;
    const existing = byTractor.get(u.truck);
    if (existing) {
      saveTruck({ ...existing, odometer: u.odometer, odoAt: now, unitRating: rateByOdometer(u.odometer) });
      updated++;
    } else {
      const t: FleetTruck = { ...blankTruck(), tractor: u.truck, odometer: u.odometer, odoAt: now, unitRating: rateByOdometer(u.odometer) };
      saveTruck(t);
      created++;
    }
  }
  return { created, updated, total: units.length };
}

/* hourly odometer refresh — updates existing profiles only (no creation), and
   only writes when the reading actually changed (no churn). */
export async function syncOdometersOnce(): Promise<number> {
  const units = await fleetioClient().units();
  const odo = new Map(units.map((u) => [u.truck, u.odometer]));
  const now = new Date().toISOString();
  let n = 0;
  for (const t of loadFleet()) {
    const miles = odo.get(t.tractor);
    if (miles == null || miles === t.odometer) continue;
    saveTruck({ ...t, odometer: miles, odoAt: now, unitRating: rateByOdometer(miles) });
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
