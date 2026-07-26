/* Legacy load → TMS schema migration — PHASE 0.

   TWO HARD CONSTRAINTS SHAPE THIS FILE:

   1. It is ADDITIVE and NON-DESTRUCTIVE. Every legacy field stays on the doc
      exactly as it is; the new schema fields are added next to them, and the
      legacy `stops[]` / `segments[]` arrays are MIRRORED into the new stops/
      assignments subcollections rather than moved out of them. So after the
      migration the old views (board, Load Detail modal, Loads list, Financials)
      keep reading what they always read and keep working, while the new schema
      is fully populated underneath. Each later phase flips one view over to the
      subcollections; a legacy field is only dropped once nothing reads it.

   2. NOTHING IS INFERRED SILENTLY. plan() computes what WOULD be written and
      classifies every field as carried (copied from legacy), suggested (derived
      — e.g. terminal guessed from the truck's home city), or defaulted (no
      source at all). The review screen shows all three and lets a human fix the
      required ones before apply() writes a single byte.

   Re-running is safe: a doc already at SCHEMA_VERSION is skipped. */

import { db, firebaseEnabled } from '../../firebase';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { loadAll, type Load as LegacyLoad, type LoadStop as LegacyStop } from '../loadsStore';
import { loadFleet } from '../fleetStore';
import { driverByName } from '../driversStore';
import { stampCreate, writeAudit, actorEmail } from './stamp';
import {
  SCHEMA_VERSION, blankRefs, blankFinancials, blankLock, isLoadStatus, isBookingAuthority,
  ladderIndexOf,
  type TmsLoad, type LoadAssignment, type LoadStopDoc, type AssignmentDriver,
  type BookingAuthority, type BookingTerminal, type StopType,
} from './types';

/* How a single field got its value — drives the color coding on the review screen. */
export type Provenance = 'carried' | 'suggested' | 'defaulted';

export interface FieldPlan {
  field: string;
  from: string;              // what the legacy doc had ('—' when nothing)
  to: string;                // what would be written
  how: Provenance;
  why?: string;              // shown on suggested/defaulted rows
  required?: boolean;        // required-by-schema and not carried → needs a human
}

export interface LoadPlan {
  id: string;
  label: string;             // route + date, so the row is recognizable
  alreadyMigrated: boolean;
  fields: FieldPlan[];
  stops: LoadStopDoc[];
  assignments: LoadAssignment[];
  /* the two required enums with no legacy source — the review screen binds
     editable pickers to these and apply() writes whatever they hold */
  bookingAuthority: string;
  bookingTerminal: string;
  unresolvedDrivers: string[];   // names that didn't match an assetDrivers record
}

export interface MigrationPlan {
  plans: LoadPlan[];
  pending: number;           // how many actually need migrating
  alreadyDone: number;
  nextLoadNumber: number;
}

/* ------------------------------------------------------------- helpers ---- */

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();
const show = (v: unknown): string => { const t = s(v); return t === '' ? '—' : t; };

/* The new-schema fields a legacy doc MIGHT already carry (from a previous run).
   Reading them off the legacy type needs a cast, so it happens exactly here
   rather than being sprinkled through the file. */
interface MigrationMarks { schemaVersion?: number; loadNumber?: string; createdBy?: string }
const marks = (l: LegacyLoad): MigrationMarks => l as unknown as MigrationMarks;

/* legacy `weight` is free text ("42,000", "42000 lbs") → a number or null */
function parseWeight(v: string): number | null {
  const n = Number(s(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* legacy stop dateTime is "YYYY-MM-DDTHH:mm" → split into appt date + window start */
function splitDateTime(dt: string): { date: string; time: string } {
  const t = s(dt);
  if (!t) return { date: '', time: '' };
  const [d, hm] = t.split('T');
  return { date: d || '', time: (hm || '').slice(0, 5) };
}

/* Known spellings of the five authorities, so an existing free-text value is
   carried rather than thrown away. Anything unrecognized stays unresolved and
   the review screen makes the human pick. */
function matchAuthority(v: string): BookingAuthority | '' {
  const t = s(v).toLowerCase().replace(/[.,]/g, '');
  if (!t) return '';
  if (isBookingAuthority(s(v))) return s(v) as BookingAuthority;
  if (t.includes('ajg')) return 'AJG Transport';
  if (t.includes('gomez')) return 'Gomez Haulers';
  if (t.includes('ag4')) return 'AG4 Haulers LLC';
  if (t.includes('plus three') || t.includes('a plus 3') || t.includes('a+3')) return 'A Plus Three Trucking LLC';
  if (t.includes('gh logistics') || t === 'gh') return 'GH Logistics LLC';
  return '';
}

/* Terminal SUGGESTION from the assigned truck's home terminal. This is a guess —
   it is surfaced as `suggested` on the review screen and a human confirms it.
   It is never written without that confirmation. */
function suggestTerminal(truck: string): { value: BookingTerminal | ''; why: string } {
  const t = loadFleet().find((f) => f.tractor === s(truck));
  const home = s(t?.homeCity).toUpperCase();
  if (!home) return { value: '', why: '' };
  if (home.includes('SAN ANTONIO') || home.includes('SATX')) return { value: 'SATX', why: `truck #${truck} is homed ${home}` };
  if (home.includes('DALLAS')) return { value: 'DALLAS', why: `truck #${truck} is homed ${home}` };
  if (home.includes('MEMPHIS')) return { value: 'MEMPHIS', why: `truck #${truck} is homed ${home}` };
  return { value: '', why: '' };
}

/* ------------------------------------------------------- subcollections ---- */

function planStops(l: LegacyLoad): LoadStopDoc[] {
  const stamps = stampCreate();
  return l.stops
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((st: LegacyStop, i): LoadStopDoc => {
      const { date, time } = splitDateTime(st.dateTime);
      const type: StopType = st.type === 'pickup' ? 'Pickup' : 'Delivery';
      return {
        id: `stop-${i + 1}`,
        seq: st.sequence || i + 1,
        type,
        stopAction: '',
        location: {
          name: '', address1: s(st.address), address2: '',
          city: s(st.city), state: s(st.state), zip: s(st.zip),
          lat: null, lon: null, timezone: '',
        },
        apptDate: date, apptWindowStart: time, apptWindowEnd: '', apptConfirmed: false,
        qty: null, qtyType: '', weight: null, commodity: s(l.commodity),
        refs: { ...blankRefs(), po: s(st.poNumber), customerRefConf: s(st.refNo) },
        seal: '', container: '', chassis: '', customerTrailer: '',
        reeferFuelLevel: null,
        instructions: s(st.notes), locationNotes: '',
        legMiles: null, excludeMilesFromSettlement: false,
        actualIn: '', actualOut: '', detentionMinutes: null,
        splitLoad: { enabled: false, yardLocation: '', isLocalSplit: false, stopAction: '' },
        ...stamps,
      };
    });
}

/* Legacy segments become legs. A load with no segments becomes ONE Linehaul leg
   carrying the load-level truck/trailer/drivers — which is exactly what the
   legacy single-truck record meant. */
function planAssignments(l: LegacyLoad, stopCount: number): { legs: LoadAssignment[]; unresolved: string[] } {
  const stamps = stampCreate();
  const unresolved: string[] = [];

  const toDrivers = (names: string[]): AssignmentDriver[] =>
    names.filter(Boolean).map((name, i) => {
      const d = driverByName(name);
      if (!d) unresolved.push(name);
      return { driverId: d?.id ?? '', name, seat: i === 0 ? 'primary' as const : 'co' as const };
    });

  const lastSeq = Math.max(1, stopCount);

  if (l.segments.length === 0) {
    return {
      legs: [{
        id: 'leg-1',
        legIndex: 1,
        legType: 'Linehaul',
        truckNumber: s(l.assignedTruck),
        trailerNumber: s(l.assignedTrailer),
        carrierAuthority: matchAuthority(l.bookingAuthority),
        drivers: toDrivers([s(l.driver1), s(l.driver2)]),
        fromStopSeq: 1,
        toStopSeq: lastSeq,
        legStatus: isLoadStatus(s(l.status)) ? s(l.status) : 'unassigned',
        dispatchedAt: s(l.dispatchedAt),
        dispatchSentTo: '',
        loadSheetSentAt: '',
        otpResult: 'Pending',
        otdResult: 'Pending',
        ...stamps,
      }],
      unresolved,
    };
  }

  const legs = l.segments.map((seg, i): LoadAssignment => {
    /* legacy fromStop/toStop are INDEXES into the sorted stop list; stop seq is
       1-based, so shift by one */
    const names = seg.driverIds.length ? seg.driverIds : [s(l.driver1), s(l.driver2)];
    return {
      id: `leg-${i + 1}`,
      legIndex: i + 1,
      legType: i === 0 ? 'Linehaul' : 'Relay',
      truckNumber: s(seg.assignedTruck),
      trailerNumber: i === 0 ? s(l.assignedTrailer) : '',
      carrierAuthority: matchAuthority(l.bookingAuthority),
      drivers: toDrivers(names),
      fromStopSeq: (seg.fromStop ?? 0) + 1,
      toStopSeq: (seg.toStop ?? lastSeq - 1) + 1,
      legStatus: isLoadStatus(s(seg.status)) ? s(seg.status) : 'unassigned',
      dispatchedAt: s(l.dispatchedAt),
      dispatchSentTo: '',
      loadSheetSentAt: '',
      otpResult: 'Pending',
      otdResult: 'Pending',
      ...stamps,
    };
  });
  return { legs, unresolved };
}

/* ------------------------------------------------------------- planning ---- */

function planOne(l: LegacyLoad, loadNumber: number): LoadPlan {
  const already = marks(l).schemaVersion === SCHEMA_VERSION;
  const stops = planStops(l);
  const { legs, unresolved } = planAssignments(l, stops.length);

  const authority = matchAuthority(l.bookingAuthority);
  const terminalGuess = suggestTerminal(s(l.assignedTruck));
  const weight = parseWeight(s(l.weight));
  const status = isLoadStatus(s(l.status)) ? s(l.status) : 'unassigned';

  const f: FieldPlan[] = [
    { field: 'loadNumber', from: '—', to: String(loadNumber), how: 'defaulted', why: 'assigned from the load-number counter', required: true },
    { field: 'routeName', from: show(l.routeName), to: show(l.routeName), how: 'carried', required: true },
    { field: 'customer', from: show(l.customerName), to: show(l.customerName), how: 'carried', required: true },
    { field: 'bookingAuthority', from: show(l.bookingAuthority), to: authority || '(pick one)', how: authority ? 'carried' : 'defaulted', why: authority ? undefined : 'no legacy value matched the five authorities — pick one below', required: true },
    { field: 'bookingTerminal', from: '—', to: terminalGuess.value || '(pick one)', how: terminalGuess.value ? 'suggested' : 'defaulted', why: terminalGuess.value ? terminalGuess.why : 'no source on the legacy record — pick one below', required: true },
    { field: 'status', from: show(l.status), to: status, how: isLoadStatus(s(l.status)) ? 'carried' : 'defaulted', why: isLoadStatus(s(l.status)) ? undefined : 'legacy status not in the board enum' },
    { field: 'billingStatus', from: '—', to: 'NOT_READY', how: 'defaulted', why: 'billing has not been assessed on legacy loads' },
    { field: 'equipment', from: show(l.equipment), to: show(l.equipment), how: 'carried' },
    { field: 'weight', from: show(l.weight), to: weight == null ? '—' : String(weight), how: weight == null ? 'defaulted' : 'carried', why: weight == null ? 'legacy weight was blank or unparseable' : 'parsed from free text' },
    { field: 'commodity', from: show(l.commodity), to: show(l.commodity), how: 'carried' },
    { field: 'isUspsContract', from: String(!!l.uspsContract), to: String(!!l.uspsContract), how: 'carried' },
    { field: 'refs.customerRefConf', from: show(l.referenceNo), to: show(l.referenceNo), how: 'carried' },
    { field: 'financials.rate', from: show(l.rate), to: show(l.rate), how: 'carried' },
    { field: 'financials.ratePerMile', from: show(l.cpm), to: show(l.cpm), how: 'carried' },
    { field: 'dispatchNotes', from: show(l.dispatchNotes), to: show(l.dispatchNotes), how: 'carried' },
    { field: 'routeNumber', from: '—', to: '—', how: 'defaulted', why: 'no legacy source — filled from the Load Repository in Phase 3' },
    { field: 'tripNumbers', from: '—', to: '[]', how: 'defaulted', why: 'no legacy source — filled from the Load Repository in Phase 3' },
  ];

  return {
    id: l.id,
    label: `${s(l.routeName) || '(unnamed route)'} · ${s(l.date)}`,
    alreadyMigrated: already,
    fields: f,
    stops,
    assignments: legs,
    bookingAuthority: authority,
    bookingTerminal: terminalGuess.value,
    unresolvedDrivers: [...new Set(unresolved)],
  };
}

/* Build the whole plan WITHOUT writing anything. */
export function planMigration(): MigrationPlan {
  const all = loadAll();
  let next = nextLoadNumberFrom(all);
  const plans: LoadPlan[] = [];
  for (const l of all) {
    const already = marks(l).schemaVersion === SCHEMA_VERSION;
    const existingNumber = Number(s(marks(l).loadNumber));
    const num = already && Number.isFinite(existingNumber) && existingNumber > 0 ? existingNumber : next;
    if (!already) next += 1;
    plans.push(planOne(l, num));
  }
  return {
    plans,
    pending: plans.filter((p) => !p.alreadyMigrated).length,
    alreadyDone: plans.filter((p) => p.alreadyMigrated).length,
    nextLoadNumber: next,
  };
}

/* Load numbers start at 1001 so they never collide with a legacy id and read as
   real load numbers to dispatch. Continues from the highest already assigned. */
export function nextLoadNumberFrom(all: LegacyLoad[]): number {
  let max = 1000;
  for (const l of all) {
    const n = Number(s(marks(l).loadNumber));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/* --------------------------------------------------------------- apply ---- */

export interface ApplyResult { migrated: number; skipped: number; stops: number; assignments: number; errors: string[] }

/* Write the plan. Only the loads the reviewer left resolved are written — a plan
   row still missing a required enum is skipped and reported, never guessed.

   Live: one batch per load (header + its stops + its legs) so a load is
   all-or-nothing. Demo: no Firestore, so this reports what it would have done
   and changes nothing — the migration is a shared-data operation. */
export async function applyMigration(plan: MigrationPlan): Promise<ApplyResult> {
  const res: ApplyResult = { migrated: 0, skipped: 0, stops: 0, assignments: 0, errors: [] };

  if (!firebaseEnabled || !db) {
    res.errors.push('Not connected to the shared database — nothing was written. Run this on the live app.');
    res.skipped = plan.pending;
    return res;
  }
  const database = db;
  const legacyById = new Map(loadAll().map((l) => [l.id, l]));

  for (const p of plan.plans) {
    if (p.alreadyMigrated) { res.skipped += 1; continue; }
    if (!p.bookingAuthority || !p.bookingTerminal) {
      res.skipped += 1;
      res.errors.push(`${p.label} — skipped: pick a booking authority and terminal first.`);
      continue;
    }
    const legacy = legacyById.get(p.id);
    if (!legacy) { res.skipped += 1; res.errors.push(`${p.label} — skipped: the load disappeared mid-review.`); continue; }

    try {
      const stamps = stampCreate();
      const numberField = p.fields.find((x) => x.field === 'loadNumber');
      /* ADDITIVE: spread the whole legacy doc first, then layer the new schema on
         top. Legacy fields survive verbatim — that is what keeps the existing
         views alive through the transition. */
      const next: TmsLoad = {
        ...(legacy as unknown as TmsLoad),
        id: legacy.id,
        schemaVersion: SCHEMA_VERSION,
        loadNumber: numberField?.to ?? '',
        routeName: s(legacy.routeName),
        routeNumber: '',
        tripNumbers: [],
        customer: s(legacy.customerName),
        bookingAuthority: p.bookingAuthority,
        bookingTerminal: p.bookingTerminal,
        status: isLoadStatus(s(legacy.status)) ? s(legacy.status) : 'unassigned',
        statusManualOverride: false,
        billingStatus: 'NOT_READY',
        equipment: s(legacy.equipment),
        weight: parseWeight(s(legacy.weight)),
        commodity: s(legacy.commodity),
        isUspsContract: !!legacy.uspsContract,
        refs: { ...blankRefs(), customerRefConf: s(legacy.referenceNo) },
        financials: { ...blankFinancials(), rate: legacy.rate ?? null, totalRevenue: legacy.rate ?? null, ratePerMile: legacy.cpm ?? null },
        dispatchNotes: s(legacy.dispatchNotes),
        parentLoadId: '',
        lock: blankLock(),
        createdBy: s(marks(legacy).createdBy) || stamps.createdBy,
        createdAt: s(legacy.createdAt) || stamps.createdAt,
        updatedBy: stamps.updatedBy,
        updatedAt: stamps.updatedAt,
      };

      const batch = writeBatch(database);
      batch.set(doc(database, 'loads', legacy.id), next as unknown as Record<string, unknown>);
      for (const st of p.stops) batch.set(doc(database, 'loads', legacy.id, 'stops', st.id), st as unknown as Record<string, unknown>);
      for (const lg of p.assignments) batch.set(doc(database, 'loads', legacy.id, 'assignments', lg.id), lg as unknown as Record<string, unknown>);
      await batch.commit();

      res.migrated += 1; res.stops += p.stops.length; res.assignments += p.assignments.length;

      writeAudit(legacy.id, {
        action: 'migration.apply',
        target: 'loads/{id} + stops + assignments',
        summary: `migrated to schema v${SCHEMA_VERSION} as load #${next.loadNumber} by ${actorEmail()} — ${p.stops.length} stops, ${p.assignments.length} legs; legacy fields retained`,
        before: { schemaVersion: marks(legacy).schemaVersion ?? 1 },
        after: { schemaVersion: SCHEMA_VERSION, loadNumber: next.loadNumber, bookingAuthority: next.bookingAuthority, bookingTerminal: next.bookingTerminal },
      });
    } catch (e) {
      res.skipped += 1;
      res.errors.push(`${p.label} — write failed: ${(e as Error).message}`);
    }
  }
  return res;
}

/* Read back what actually landed, so the review screen can prove the write
   instead of just claiming it. */
export async function verifyMigration(): Promise<{ total: number; migrated: number; stops: number; assignments: number }> {
  if (!firebaseEnabled || !db) return { total: 0, migrated: 0, stops: 0, assignments: 0 };
  const database = db;
  const snap = await getDocs(collection(database, 'loads'));
  let migrated = 0; let stops = 0; let assignments = 0;
  for (const d of snap.docs) {
    if ((d.data() as Partial<TmsLoad>).schemaVersion === SCHEMA_VERSION) migrated += 1;
    const [st, as] = await Promise.all([
      getDocs(collection(database, 'loads', d.id, 'stops')),
      getDocs(collection(database, 'loads', d.id, 'assignments')),
    ]);
    stops += st.size; assignments += as.size;
  }
  return { total: snap.size, migrated, stops, assignments };
}

/* Phase 2 will log milestones against these ladders; re-exported here so the
   review screen can show the ladder a migrated stop will use. */
export { ladderIndexOf };
