/* User roster — everyone who has signed in to the Asset Matrix. This is the
   first piece of SHARED data: it lives in Firestore (collection `assetUsers`) so
   a sign-in on anyone's device shows up on the owner's Roles tab. When someone
   signs in, their record is upserted here (email + name + last-seen); the owner
   then just picks a role. No role = the safe default (FMT, edit-only) via
   permStore.roleOf. In demo (no Firebase) it falls back to localStorage so the
   Roles UI still works. */

import { db, firebaseEnabled } from '../firebase';
import { collection, doc, onSnapshot, setDoc, serverTimestamp, deleteField } from 'firebase/firestore';
import { emitChange } from './bus';
import type { Role } from './permStore';   // type-only — no runtime cycle

export interface RosterUser {
  email: string;
  displayName: string;
  role?: Role;              // owner-assigned; absent = default (FMT)
  firstSeenAt?: number;
  lastSeenAt?: number;
}

const LS_KEY = 'asset-roster-v1';
const norm = (e: string) => (e || '').trim().toLowerCase();

function readLocal(): Record<string, RosterUser> {
  try { const r = localStorage.getItem(LS_KEY); if (r) return JSON.parse(r) as Record<string, RosterUser>; } catch { /* ignore */ }
  return {};
}
function writeLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch { /* ignore */ } }

let cache: Record<string, RosterUser> = readLocal();
let synced = false;

/* live-subscribe to the shared roster (once) */
export function startRosterSync() {
  if (synced || !firebaseEnabled || !db) return;
  synced = true;
  onSnapshot(collection(db, 'assetUsers'), (snap) => {
    const next: Record<string, RosterUser> = {};
    snap.forEach((d) => {
      const v = d.data() as Record<string, unknown>;
      const email = String(v.email || d.id);
      if (!email) return;
      const ts = (x: unknown) => (x && typeof (x as { toMillis?: () => number }).toMillis === 'function' ? (x as { toMillis: () => number }).toMillis() : typeof x === 'number' ? x : undefined);
      next[norm(email)] = { email, displayName: String(v.displayName || ''), role: v.role as Role | undefined, firstSeenAt: ts(v.firstSeenAt), lastSeenAt: ts(v.lastSeenAt) };
    });
    cache = next; emitChange();
  }, (e) => console.error('roster sync failed', e));
}
if (firebaseEnabled) startRosterSync();

export function rosterUsers(): RosterUser[] {
  return Object.values(cache).sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
}
export function rosterRole(email: string): Role | undefined { return cache[norm(email)]?.role; }

/* record a sign-in — upsert the person into the shared roster */
export function recordSignIn(email: string, displayName: string) {
  const e = norm(email); if (!e) return;
  const existing = cache[e];
  const isNew = !existing;
  cache[e] = { ...existing, email, displayName: displayName || existing?.displayName || '', lastSeenAt: Date.now(), firstSeenAt: existing?.firstSeenAt ?? Date.now() };
  if (firebaseEnabled && db) {
    const patch: Record<string, unknown> = { email, lastSeenAt: serverTimestamp() };
    if (displayName) patch.displayName = displayName;
    if (isNew) patch.firstSeenAt = serverTimestamp();
    setDoc(doc(db, 'assetUsers', e), patch, { merge: true }).catch((err) => console.error('roster write failed', err));
  } else { writeLocal(); }
  emitChange();
}

/* assign / clear a role (null clears back to the default) */
export function setRosterRole(email: string, role: Role | null) {
  const e = norm(email); if (!e) return;
  const existing = cache[e] ?? { email, displayName: '' };
  cache[e] = role ? { ...existing, email, role } : { ...existing, email, role: undefined };
  if (firebaseEnabled && db) {
    setDoc(doc(db, 'assetUsers', e), role ? { email, role } : { email, role: deleteField() }, { merge: true }).catch((err) => console.error('roster role write failed', err));
  } else { writeLocal(); }
  emitChange();
}
