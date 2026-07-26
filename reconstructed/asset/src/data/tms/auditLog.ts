/* Reading the append-only audit trail — PHASE 2.

   Writes live in tms/stamp (writeAudit). This is the read side, kept separate so
   the "View update logs" drawer can't accidentally import a write path.

   The trail is append-only by security rule: create is allowed, update and
   delete are denied to everyone including the owner. So what this returns is
   what actually happened, not what somebody later decided should have happened. */

import { db, firebaseEnabled } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { emitChange } from '../bus';
import type { AuditEvent } from './types';

let cache: Record<string, AuditEvent[]> = {};

const newestFirst = (a: AuditEvent, b: AuditEvent) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);

/** cached events for a load, newest first */
export function loadAudit(loadId: string): AuditEvent[] {
  return (cache[loadId] ?? []).slice().sort(newestFirst);
}

/** pull the trail from the shared database (live only; demo writes no audit) */
export async function fetchAudit(loadId: string): Promise<AuditEvent[]> {
  if (!firebaseEnabled || !db) return loadAudit(loadId);
  try {
    const snap = await getDocs(collection(db, 'loads', loadId, 'audit'));
    cache = { ...cache, [loadId]: snap.docs.map((d) => ({ ...(d.data() as AuditEvent), id: d.id })) };
    emitChange();
  } catch (e) {
    console.error('audit read failed', loadId, e);
  }
  return loadAudit(loadId);
}
