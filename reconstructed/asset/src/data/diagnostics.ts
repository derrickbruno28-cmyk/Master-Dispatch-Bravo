/* Sync diagnostics — makes the invisible visible. Reads each shared Firestore
   collection directly (one-shot getDocs) and reports the live document count +
   any read error, alongside what this device has locally. If the shared count
   is high but the screen is empty, the live subscription is the problem (use
   Reload). If a read errors with permission-denied, it's the database rules. */

import { db, firebaseEnabled, auth } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';

export interface ColCount { name: string; label: string; count: number; error?: string }
export interface Diag { email: string; connected: boolean; cols: ColCount[] }

const SHARED: { name: string; label: string }[] = [
  { name: 'assetDrivers', label: 'Driver Availability' },
  { name: 'assetFleet', label: 'Fleet / Trucks' },
  { name: 'assetSchedule', label: 'Matrix board cells' },
  { name: 'loads', label: 'Load records' },
  { name: 'assetUsers', label: 'Roles / roster' },
];

export async function runDiagnostics(): Promise<Diag> {
  const email = auth?.currentUser?.email || '';
  const cols: ColCount[] = [];
  for (const c of SHARED) {
    if (!firebaseEnabled || !db) { cols.push({ ...c, count: 0, error: 'not connected' }); continue; }
    try {
      const snap = await getDocs(collection(db, c.name));
      cols.push({ ...c, count: snap.size });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      cols.push({ ...c, count: 0, error: err.code || err.message || 'read failed' });
    }
  }
  return { email, connected: firebaseEnabled, cols };
}
