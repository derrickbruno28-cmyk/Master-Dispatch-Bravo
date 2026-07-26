/* Stops — read-through for PHASE 2.

   Phase 3 owns the full Stops workspace (appointments, refs, split loads, the
   Load Repository typeahead). Phase 2 only needs to READ stops, because a
   milestone hangs off a stop and takes its plannedAt from that stop's
   appointment window.

   So this is the same read-through pattern as the legs store: real stop
   documents when they exist, otherwise synthesized from the legacy `stops[]`
   array that every load already carries. Nothing has to be migrated for the
   milestone engine to work, and Phase 3 replaces the synthesis with real
   editing without changing what milestones read. */

import { db, firebaseEnabled } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { emitChange } from '../bus';
import type { Load as LegacyLoad } from '../loadsStore';
import { stampCreate } from './stamp';
import { blankRefs, type LoadStopDoc, type StopType } from './types';

const SUB = 'stops';

let cache: Record<string, LoadStopDoc[]> = {};
const fetched = new Set<string>();

const bySeq = (a: LoadStopDoc, b: LoadStopDoc) => a.seq - b.seq;

export function storedStops(loadId: string): LoadStopDoc[] {
  return (cache[loadId] ?? []).slice().sort(bySeq);
}

export async function fetchStops(loadId: string): Promise<LoadStopDoc[]> {
  if (!firebaseEnabled || !db) return storedStops(loadId);
  if (fetched.has(loadId)) return storedStops(loadId);
  try {
    const snap = await getDocs(collection(db, 'loads', loadId, SUB));
    cache = { ...cache, [loadId]: snap.docs.map((d) => ({ ...(d.data() as LoadStopDoc), id: d.id })) };
    fetched.add(loadId);
    emitChange();
  } catch (e) {
    console.error('stops read failed', loadId, e);
  }
  return storedStops(loadId);
}

/* legacy stop dateTime is "YYYY-MM-DDTHH:mm" — the appointment is a single
   instant there, so it becomes the window START and the window has no end until
   Phase 3 lets someone set one. */
function splitDateTime(dt: string): { date: string; time: string } {
  const t = (dt || '').trim();
  if (!t) return { date: '', time: '' };
  const [d, hm] = t.split('T');
  return { date: d || '', time: (hm || '').slice(0, 5) };
}

export function syntheticStops(l: LegacyLoad): LoadStopDoc[] {
  const stamps = stampCreate();
  return l.stops
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((st, i): LoadStopDoc => {
      const { date, time } = splitDateTime(st.dateTime);
      const type: StopType = st.type === 'pickup' ? 'Pickup' : 'Delivery';
      return {
        id: `stop-${i + 1}`,
        seq: st.sequence || i + 1,
        type,
        stopAction: '',
        location: {
          name: '', address1: st.address || '', address2: '',
          city: st.city || '', state: st.state || '', zip: st.zip || '',
          lat: null, lon: null, timezone: '',
        },
        apptDate: date, apptWindowStart: time, apptWindowEnd: '', apptConfirmed: false,
        qty: null, qtyType: '', weight: null, commodity: l.commodity || '',
        refs: { ...blankRefs(), po: st.poNumber || '', customerRefConf: st.refNo || '' },
        seal: '', container: '', chassis: '', customerTrailer: '',
        reeferFuelLevel: null,
        instructions: st.notes || '', locationNotes: '',
        legMiles: null, excludeMilesFromSettlement: false,
        actualIn: '', actualOut: '', detentionMinutes: null,
        splitLoad: { enabled: false, yardLocation: '', isLocalSplit: false, stopAction: '' },
        ...stamps,
      };
    });
}

/** the stops to WORK WITH — real documents when they exist, else synthesized */
export function stopsFor(l: LegacyLoad): LoadStopDoc[] {
  const stored = storedStops(l.id);
  return stored.length ? stored : syntheticStops(l);
}

/** the appointment instant a milestone is judged against (ISO, or '' when the
    stop has no appointment set) */
export function plannedAtOf(s: LoadStopDoc): string {
  if (!s.apptDate) return '';
  const t = s.apptWindowStart || '00:00';
  const d = new Date(`${s.apptDate}T${t}`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** the CLOSE of the appointment window — what At Risk is measured against.
    Falls back to the start when no end has been set (pre-Phase-3 stops). */
export function windowCloseOf(s: LoadStopDoc): string {
  if (!s.apptDate) return '';
  const t = s.apptWindowEnd || s.apptWindowStart || '00:00';
  const d = new Date(`${s.apptDate}T${t}`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** a stop is a YARD / split stop — drives the At Yard board status */
export function isYardStop(s: LoadStopDoc): boolean {
  if (s.splitLoad?.enabled) return true;
  const hay = `${s.location.name} ${s.location.address1} ${s.locationNotes} ${s.instructions}`.toLowerCase();
  return /\byard\b|\bdrop lot\b|\bstaging\b/.test(hay);
}

export const stopLabel = (s: LoadStopDoc): string =>
  `${s.type} #${s.seq} · ${[s.location.city, s.location.state].filter(Boolean).join(', ') || s.location.address1 || '—'}`;
