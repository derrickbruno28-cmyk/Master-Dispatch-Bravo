/* Recover data saved on THIS device to the shared team database.

   Before the app went multi-user, Driver Availability and Fleet Status lived
   only in each browser's localStorage. When we switched those to a shared
   Firestore roster, the shared copy started from the built-in master list — it
   couldn't see edits that had only ever been saved on someone's device. This
   tool lets whoever HAS those local edits push them up into the shared database
   in one click. It never deletes anything: it setDoc(merge) each local record
   over its shared counterpart (by driver id / tractor #), so a person's own
   edited versions win and any brand-new records they added are created. Run it
   on the device that has the data you're missing. */

import { db, firebaseEnabled } from '../firebase';
import { doc, setDoc } from 'firebase/firestore';

const DRIVERS_KEY = 'asset-drivers-v2';
const FLEET_KEY = 'asset-fleet-v2';
const DRIVERS_COL = 'assetDrivers';
const FLEET_COL = 'assetFleet';

function readArr(key: string): Record<string, unknown>[] {
  try { const r = localStorage.getItem(key); if (r) { const a = JSON.parse(r); if (Array.isArray(a)) return a as Record<string, unknown>[]; } } catch { /* ignore */ }
  return [];
}

export interface LocalCounts { drivers: number; fleet: number }
export function localCounts(): LocalCounts {
  return { drivers: readArr(DRIVERS_KEY).length, fleet: readArr(FLEET_KEY).length };
}
export function hasLocalData(): boolean {
  const c = localCounts(); return c.drivers > 0 || c.fleet > 0;
}

/* push this device's saved drivers + trucks into the shared roster (merge) */
export async function restoreLocalToShared(): Promise<{ drivers: number; fleet: number }> {
  if (!firebaseEnabled || !db) return { drivers: 0, fleet: 0 };
  let drivers = 0, fleet = 0;
  for (const d of readArr(DRIVERS_KEY)) {
    const id = d.id ? String(d.id) : '';
    if (!id) continue;
    try { await setDoc(doc(db, DRIVERS_COL, id), d, { merge: true }); drivers++; } catch (e) { console.error('restore driver failed', e); }
  }
  for (const t of readArr(FLEET_KEY)) {
    const id = t.tractor ? String(t.tractor) : '';
    if (!id) continue;
    try { await setDoc(doc(db, FLEET_COL, id), t, { merge: true }); fleet++; } catch (e) { console.error('restore truck failed', e); }
  }
  return { drivers, fleet };
}
