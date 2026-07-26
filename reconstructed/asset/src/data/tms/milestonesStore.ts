/* Milestone engine — PHASE 2. The core of the execution layer.

   Every stop has an ordered event ladder. Logging those rungs is what makes
   OTP/OTD, detention, and the Samsara path real instead of decorative: the board
   status stops being something a human types and becomes something the timeline
   derives.

   THREE RULES THAT ARE NOT NEGOTIABLE HERE:

   1. SOURCE TAGGING IS MANDATORY. Every milestone says whether a DRIVER, a
      DISPATCHER, or SAMSARA produced it. Today drivers and dispatch key times in
      by hand; when geofences go live the same ladder gets written automatically
      with source SAMSARA. Without the tag you cannot tell a witnessed time from
      a typed-in one, and every downstream number inherits that ambiguity.

   2. A MANUAL AND A SAMSARA EVENT FOR THE SAME RUNG BOTH SURVIVE. We never
      overwrite what a person entered with what a geofence saw. The Samsara event
      is authoritative for LOCATION, and when the two disagree by more than 30
      minutes or 25 miles that disagreement is surfaced as a variance instead of
      silently resolved.

   3. LADDER ORDER IS ENFORCED. ladderIndex is the rung's position, so a stop
      can't report Loading Completed before it reports At Pickup. */

import { db, firebaseEnabled } from '../../firebase';
import { collection, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { emitChange } from '../bus';
import { samsaraClient } from '../../integrations/telematics';
import type { Load as LegacyLoad } from '../loadsStore';
import { stampCreate, stampUpdate, writeAudit, actorEmail, nowIso } from './stamp';
import { stopsFor, plannedAtOf, windowCloseOf, isYardStop } from './stopsStore';
import { legsFor, legTrucks, syncLegCells } from './assignmentsStore';
import { saveLoad } from '../loadsStore';
import { setAssignment } from '../schedule';
import {
  ladderFor, ladderIndexOf, isRequiredEvent, DEFAULT_FREE_TIME_MINUTES,
  BILLING_RANK, lateReasonNeedsDetail,
  type LoadMilestone, type MilestoneEvent, type MilestoneSource, type LoadStopDoc,
  type TmsLoad, type LateReason,
} from './types';

const SUB = 'milestones';

let cache: Record<string, LoadMilestone[]> = {};
const fetched = new Set<string>();

const MIN = 60 * 1000;
const ms = (iso: string): number => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };

/* ------------------------------------------------------------------ reads ---- */

export function storedMilestones(loadId: string): LoadMilestone[] {
  return (cache[loadId] ?? []).slice().sort((a, b) => (a.stopSeq - b.stopSeq) || (a.ladderIndex - b.ladderIndex));
}

export async function fetchMilestones(loadId: string): Promise<LoadMilestone[]> {
  if (!firebaseEnabled || !db) return storedMilestones(loadId);
  if (fetched.has(loadId)) return storedMilestones(loadId);
  try {
    const snap = await getDocs(collection(db, 'loads', loadId, SUB));
    cache = { ...cache, [loadId]: snap.docs.map((d) => ({ ...(d.data() as LoadMilestone), id: d.id })) };
    fetched.add(loadId);
    emitChange();
  } catch (e) {
    console.error('milestones read failed', loadId, e);
  }
  return storedMilestones(loadId);
}

export function milestonesForStop(loadId: string, stopId: string): LoadMilestone[] {
  return storedMilestones(loadId).filter((m) => m.stopId === stopId);
}

/* ------------------------------------------------------------------ timing ---- */

/* On Time / At Risk / Late, judged against the stop's appointment.
   AT RISK is a projection, not a verdict: an arrival landing within 60 minutes
   of the window CLOSING is flagged so a dispatcher can act while it's still
   fixable. Past the close is Late. */
export function computeTiming(actualAt: string, plannedAt: string, windowClose: string): 'On Time' | 'At Risk' | 'Late' | '' {
  const a = ms(actualAt); const close = ms(windowClose || plannedAt);
  if (!Number.isFinite(a) || !Number.isFinite(close)) return '';
  if (a > close) return 'Late';
  if (close - a <= 60 * MIN) return 'At Risk';
  return 'On Time';
}

/* ---------------------------------------------------------------- detention ---- */

export interface Detention { minutes: number; basis: 'logged' | 'inferred' | 'none'; note: string }

/* Detention prefers what was LOGGED: Detention Ended − Detention Begin is a
   witnessed span. When those rungs weren't logged we fall back to the stop's
   in/out clock minus the free-time allowance — a weaker number, so it is
   labelled `inferred` and the UI says so rather than presenting it as fact. */
export function detentionFor(
  loadId: string,
  stop: LoadStopDoc,
  freeTimeMinutes: number = DEFAULT_FREE_TIME_MINUTES,
): Detention {
  const mine = milestonesForStop(loadId, stop.id);
  const begin = mine.find((m) => m.eventType === 'Detention Begin')?.actualAt;
  const ended = mine.find((m) => m.eventType === 'Detention Ended')?.actualAt;

  if (begin && ended) {
    const span = ms(ended) - ms(begin);
    if (Number.isFinite(span) && span > 0) {
      return { minutes: Math.round(span / MIN), basis: 'logged', note: 'Detention Begin → Detention Ended' };
    }
  }

  const inAt = stop.actualIn || mine.find((m) => m.eventType === 'At Pickup' || m.eventType === 'At Delivery')?.actualAt || '';
  const outAt = stop.actualOut || mine.find((m) => m.eventType === 'Pickup Completed' || m.eventType === 'Delivery Completed')?.actualAt || '';
  const span = ms(outAt) - ms(inAt);
  if (Number.isFinite(span) && span > 0) {
    const over = Math.round(span / MIN) - freeTimeMinutes;
    return over > 0
      ? { minutes: over, basis: 'inferred', note: `on site ${Math.round(span / MIN)} min − ${freeTimeMinutes} min free time` }
      : { minutes: 0, basis: 'inferred', note: `within the ${freeTimeMinutes} min free-time allowance` };
  }
  return { minutes: 0, basis: 'none', note: 'not enough logged to compute detention' };
}

/* ----------------------------------------------------------------- variance ---- */

export interface Variance { minutes: number; miles: number; flagged: boolean; reason: string }

const R_MI = 3958.8;
export function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const VARIANCE_MINUTES = 30;
export const VARIANCE_MILES = 25;

/* Compare the manual and Samsara records of the SAME rung. Both are kept; this
   only decides whether to raise a flag. */
export function varianceFor(loadId: string, stopId: string, eventType: MilestoneEvent): Variance | null {
  const same = storedMilestones(loadId).filter((m) => m.stopId === stopId && m.eventType === eventType);
  const auto = same.find((m) => m.source === 'SAMSARA');
  const manual = same.find((m) => m.source !== 'SAMSARA');
  if (!auto || !manual) return null;

  const minutes = Math.abs(ms(auto.actualAt) - ms(manual.actualAt)) / MIN;
  let miles = 0;
  const ap = auto.reportedLocation;
  const mp = manual.reportedLocation;
  if (ap?.lat != null && ap?.lon != null && mp?.lat != null && mp?.lon != null) {
    miles = haversineMiles({ lat: ap.lat, lon: ap.lon }, { lat: mp.lat, lon: mp.lon });
  }
  const flagged = (Number.isFinite(minutes) && minutes > VARIANCE_MINUTES) || miles > VARIANCE_MILES;
  const bits: string[] = [];
  if (Number.isFinite(minutes) && minutes > VARIANCE_MINUTES) bits.push(`${Math.round(minutes)} min apart`);
  if (miles > VARIANCE_MILES) bits.push(`${Math.round(miles)} mi apart`);
  return {
    minutes: Number.isFinite(minutes) ? Math.round(minutes) : 0,
    miles: Math.round(miles),
    flagged,
    reason: bits.join(' · ') || 'manual and Samsara agree',
  };
}

/* ------------------------------------------------------------------ ladder ---- */

/** the rungs already logged on a stop, by event type */
export function loggedEvents(loadId: string, stopId: string): Set<string> {
  return new Set(milestonesForStop(loadId, stopId).map((m) => m.eventType));
}

/* The next rung that still has to be logged on this stop. Optional rungs
   (loading/unloading, detention) are skipped — they're logged when they actually
   happen, and waiting on them would stall the ladder. */
export function nextRequiredEvent(loadId: string, stop: LoadStopDoc): MilestoneEvent | null {
  const done = loggedEvents(loadId, stop.id);
  for (const ev of ladderFor(stop.type)) {
    if (!isRequiredEvent(ev)) continue;
    if (!done.has(ev)) return ev;
  }
  return null;
}

/** the next required rung across the whole load — what the board's one-tap
    fast-log offers */
export function nextRequiredForLoad(l: LegacyLoad): { stop: LoadStopDoc; event: MilestoneEvent } | null {
  for (const s of stopsFor(l)) {
    const ev = nextRequiredEvent(l.id, s);
    if (ev) return { stop: s, event: ev };
  }
  return null;
}

/* An out-of-order log is refused: the ladder is what guarantees a timeline can
   be read backwards later. Returns the blocking rung, or null when it's fine. */
export function ladderBlocker(loadId: string, stop: LoadStopDoc, event: MilestoneEvent): MilestoneEvent | null {
  const idx = ladderIndexOf(stop.type, event);
  const done = loggedEvents(loadId, stop.id);
  for (const ev of ladderFor(stop.type)) {
    if (ladderIndexOf(stop.type, ev) >= idx) break;
    if (isRequiredEvent(ev) && !done.has(ev)) return ev;
  }
  return null;
}

/* ------------------------------------------------------------------ writes ---- */

export interface LogInput {
  stop: LoadStopDoc;
  event: MilestoneEvent;
  source: MilestoneSource;
  actualAt?: string;                 // defaults to now
  assignmentId?: string;
  comments?: string;
  sourceDetail?: string;
  enteredCity?: string;
  enteredState?: string;
  reportedLocation?: LoadMilestone['reportedLocation'];
  lateReason?: LateReason | '';
  lateReasonDetail?: string;
  /* set when a human overrides the computed On Time / At Risk / Late */
  timingOverride?: 'On Time' | 'At Risk' | 'Late' | '';
}

export interface LogResult { ok: boolean; milestone?: LoadMilestone; error?: string }

/* Log one rung. This is the single write path — the Milestones tab, the board's
   fast-log, and (later) the Samsara webhook all come through here, so the
   ordering, timing, and late-reason rules can't be bypassed by one caller. */
export async function logMilestone(l: LegacyLoad, input: LogInput): Promise<LogResult> {
  const { stop, event, source } = input;

  const blocker = ladderBlocker(l.id, stop, event);
  if (blocker) {
    return { ok: false, error: `Log “${blocker}” on ${stop.type} #${stop.seq} first — the event ladder is in order.` };
  }

  const actualAt = input.actualAt || nowIso();
  const plannedAt = plannedAtOf(stop);
  const computed = computeTiming(actualAt, plannedAt, windowCloseOf(stop));
  const timing = input.timingOverride || computed;

  /* PHASE 6 GATE, enforced here rather than in the UI so no caller can skip it:
     a completion rung that lands Late must say WHY. */
  const isCompletion = event === 'Pickup Completed' || event === 'Delivery Completed';
  if (isCompletion && timing === 'Late') {
    if (!input.lateReason) {
      return { ok: false, error: 'This completion is Late — pick a structured late reason before saving.' };
    }
    if (lateReasonNeedsDetail(input.lateReason) && !(input.lateReasonDetail || '').trim()) {
      return { ok: false, error: 'Late reason “Other” needs a short detail.' };
    }
  }

  const legs = legsFor(l);
  const assignmentId = input.assignmentId
    || legs.find((g) => stop.seq >= g.fromStopSeq && stop.seq <= g.toStopSeq)?.id
    || legs[0]?.id || '';

  const id = `${stop.id}-${event.replace(/[^A-Za-z]+/g, '')}-${source}`;
  const existing = storedMilestones(l.id).find((m) => m.id === id);

  const m: LoadMilestone = {
    id,
    stopId: stop.id,
    stopSeq: stop.seq,
    assignmentId,
    eventType: event,
    ladderIndex: ladderIndexOf(stop.type, event),
    required: isRequiredEvent(event),
    actualAt,
    actualAtLocalTz: stop.location.timezone || '',
    plannedAt,
    timing,
    timingManualOverride: !!input.timingOverride && input.timingOverride !== computed,
    comments: input.comments || '',
    enteredLocation: {
      city: input.enteredCity || stop.location.city || '',
      state: input.enteredState || stop.location.state || '',
    },
    reportedLocation: input.reportedLocation ?? null,
    source,
    sourceDetail: input.sourceDetail || actorEmail(),
    notificationSent: false,
    notificationSentAt: '',
    lateReason: input.lateReason || '',
    lateReasonDetail: input.lateReasonDetail || '',
    ...(existing ? stampUpdate(existing) : stampCreate()),
  };

  cache = { ...cache, [l.id]: [...storedMilestones(l.id).filter((x) => x.id !== id), m] };

  if (firebaseEnabled && db) {
    try {
      await setDoc(doc(db, 'loads', l.id, SUB, id), m as unknown as Record<string, unknown>);
      fetched.add(l.id);
    } catch (e) {
      return { ok: false, error: `Couldn't save the milestone — ${(e as Error).message}` };
    }
  }

  writeAudit(l.id, {
    action: 'milestone.log',
    target: `loads/${l.id}/milestones/${id}`,
    summary: `${event} on ${stop.type} #${stop.seq} at ${actualAt} — ${timing || 'no appointment to judge'} · source ${source} (${m.sourceDetail})${m.lateReason ? ` · late: ${m.lateReason}` : ''}`,
    before: existing ? { actualAt: existing.actualAt, timing: existing.timing } : null,
    after: { actualAt, timing, source },
  });

  /* the board follows the timeline — see applyDerivedStatus */
  try { await applyDerivedStatus(l); }
  catch (e) { console.error('status derivation failed', e); }

  emitChange();
  return { ok: true, milestone: m };
}

/** remove a logged rung — restricted (the caller gates on delete permission) */
export async function removeMilestone(loadId: string, milestoneId: string): Promise<void> {
  const gone = storedMilestones(loadId).find((m) => m.id === milestoneId);
  cache = { ...cache, [loadId]: storedMilestones(loadId).filter((m) => m.id !== milestoneId) };
  if (firebaseEnabled && db) {
    try { await deleteDoc(doc(db, 'loads', loadId, SUB, milestoneId)); }
    catch (e) { console.error('milestone delete failed', e); }
  }
  if (gone) {
    writeAudit(loadId, {
      action: 'milestone.remove',
      target: `loads/${loadId}/milestones/${milestoneId}`,
      summary: `${gone.eventType} on stop #${gone.stopSeq} removed by ${actorEmail()}`,
      before: { actualAt: gone.actualAt, source: gone.source }, after: null,
    });
  }
  emitChange();
}

/* ------------------------------------------------------------------ Samsara ---- */

/* Pull the truck's current position through the existing adapter. Today that's
   the mock; when a real Samsara org is connected the same call returns live GPS
   and the same code path writes a SAMSARA-sourced milestone with a
   reportedLocation. Nothing here changes when the geofences go live. */
export async function latestLocationFor(truck: string): Promise<LoadMilestone['reportedLocation']> {
  try {
    const pos = (await samsaraClient().positions()).find((p) => p.truck === truck);
    if (!pos) return null;
    return { lat: pos.lat, lon: pos.lng, city: '', state: '', capturedAt: pos.updatedAt };
  } catch (e) {
    console.warn('latest location unavailable', e);
    return null;
  }
}

/* ------------------------------------------------------- status derivation ---- */

/* loads.status is DERIVED from the newest milestone — a human typing a status is
   the exception (statusManualOverride), not the mechanism. The order below is
   the spec's, read newest-state-first so the furthest-along signal wins. */
export function deriveStatus(l: LegacyLoad, billingStatus?: string): string {
  const legs = legsFor(l);
  const stops = stopsFor(l);
  const mine = storedMilestones(l.id);

  const has = (ev: MilestoneEvent) => mine.some((m) => m.eventType === ev);

  /* Completed only once the paperwork is billable — a load doesn't end at
     Delivered, it ends when accounting can invoice it (Phase 9). */
  const finalStop = stops[stops.length - 1];
  const finalDelivered = !!finalStop && mine.some((m) => m.stopId === finalStop.id && m.eventType === 'Delivery Completed');
  if (finalDelivered) {
    const rank = BILLING_RANK[(billingStatus as keyof typeof BILLING_RANK)] ?? 0;
    return rank >= 1 ? 'completed' : 'delivered';
  }

  if (has('At Delivery')) return 'at receiver';

  /* a yard / split stop that has been arrived at reads as At Yard rather than
     At Shipper — same rung, different kind of place */
  const atPickupStops = mine.filter((m) => m.eventType === 'At Pickup');
  if (atPickupStops.length) {
    const newest = atPickupStops[atPickupStops.length - 1];
    const s = stops.find((x) => x.id === newest.stopId);
    return s && isYardStop(s) ? 'at yard' : 'at shipper';
  }

  if (has('En Route')) return 'en route';
  if (legs.some((g) => g.dispatchedAt)) return 'dispatched';

  const crewed = legs.some((g) => g.truckNumber.trim() && g.drivers.some((d) => d.name.trim()));
  if (crewed) return 'covered';
  if (legs.some((g) => g.truckNumber.trim())) return 'open';
  return 'unassigned';
}

/** apply the derivation unless a human pinned the status */
export function effectiveStatus(l: LegacyLoad): string {
  const t = l as unknown as Partial<TmsLoad>;
  if (t.statusManualOverride) return l.status;
  return deriveStatus(l, t.billingStatus);
}

/* Push the derived status onto the load AND onto every board cell the load
   occupies. Without this, deriveStatus would be a number nobody sees: the grid
   renders from assetSchedule, so logging a milestone has to write through to the
   cell or the truck never visibly moves. Called at the end of every successful
   log, which is what makes "the board status follows automatically" true rather
   than aspirational.

   A human-pinned status (statusManualOverride) is left alone. */
export async function applyDerivedStatus(l: LegacyLoad): Promise<string> {
  const t = l as unknown as Partial<TmsLoad>;
  if (t.statusManualOverride) return l.status;

  const next = deriveStatus(l, t.billingStatus);
  if (!next || next === l.status) return l.status;

  const saved = await saveLoad({ ...l, status: next });

  /* mirror onto the cells. Multi-leg loads carry the leg chip; a single-leg load
     writes the one cell it sits on. */
  const legs = legsFor(saved);
  if (legs.length > 1) {
    await syncLegCells(saved, legTrucks(saved));
  } else {
    const truck = legs[0]?.truckNumber?.trim() || saved.assignedTruck?.trim();
    if (truck) await setAssignment(truck, saved.date, { route: saved.routeName, status: next, usps: saved.uspsContract });
  }

  writeAudit(l.id, {
    action: 'status.derive',
    target: `loads/${l.id}`,
    summary: `status ${l.status} → ${next}, derived from the milestone timeline`,
    before: { status: l.status }, after: { status: next },
  });
  return next;
}
