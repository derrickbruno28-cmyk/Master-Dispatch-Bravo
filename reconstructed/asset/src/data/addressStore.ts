/* Address book — remembers stop addresses typed into loads so they auto-populate
   next time. localStorage now, write-through to a shared `assetAddresses`
   Firestore collection when configured (same pattern as the other stores). */

import { emitChange } from './bus';
import { db, firebaseEnabled } from '../firebase';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';

export interface SavedAddress { address: string; city: string; state: string; zip: string }

const KEY = 'asset-addresses-v1';
const COL = 'assetAddresses';

const keyOf = (a: SavedAddress) => `${a.address}|${a.city}|${a.state}|${a.zip}`.toLowerCase().replace(/[^a-z0-9|]+/g, '');

function readLocal(): Record<string, SavedAddress> {
  try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r) as Record<string, SavedAddress>; } catch { /* ignore */ }
  return {};
}
function writeLocal() { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ } }

let cache: Record<string, SavedAddress> = readLocal();
let synced = false;

export function startAddressSync() {
  if (synced || !firebaseEnabled || !db) return;
  synced = true;
  onSnapshot(collection(db, COL), (snap) => {
    const next: Record<string, SavedAddress> = {};
    snap.forEach((d) => { next[d.id] = d.data() as SavedAddress; });
    cache = next; emitChange();
  }, (e) => console.error('address sync failed', e));
}
if (firebaseEnabled) startAddressSync();

export function listAddresses(): SavedAddress[] {
  return Object.values(cache).filter((a) => a.address.trim() || a.city.trim());
}

/** remember one address (deduped); no-op when there's nothing to remember */
export function rememberAddress(a: SavedAddress) {
  if (!a.address.trim() && !a.city.trim()) return;
  const k = keyOf(a);
  if (!k || cache[k]) return;
  cache = { ...cache, [k]: { address: a.address.trim(), city: a.city.trim(), state: a.state.trim(), zip: a.zip.trim() } };
  if (firebaseEnabled && db) setDoc(doc(db, COL, k), cache[k] as unknown as Record<string, unknown>).catch((e) => console.error('address write failed', e));
  else writeLocal();
  emitChange();
}

/** capture every stop's address from a saved load (called on load save) */
export function rememberStops(stops: { address: string; city: string; state: string; zip: string }[]) {
  for (const s of stops) rememberAddress(s);
}
