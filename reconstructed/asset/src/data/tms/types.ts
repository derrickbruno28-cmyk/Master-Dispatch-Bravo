/* Asset TMS data model — PHASE 0.

   This is the execution-layer schema that turns the Asset Matrix from a planning
   board into a real TMS. It is modeled on LoadStop's load workflow: a load header
   plus seven subcollections (assignments, stops, milestones, documents,
   exceptions, notes, audit).

   MIGRATION POSTURE — read this before changing anything:
   The new fields are ADDED ALONGSIDE the legacy `Load` fields in data/loadsStore,
   they do not replace them. Every existing view (Asset Matrix board, Load Detail
   modal, Loads list, Financials) keeps reading the legacy shape and keeps working
   untouched. Each phase then flips one view over to the new shape; the legacy
   field retires only once nothing reads it. That is why `TmsLoad` extends the
   legacy record instead of superseding it — never drop a legacy field as a
   "cleanup", it is load-bearing until its phase lands.

   Timestamps are ISO-8601 STRINGS, not Firestore Timestamps, matching the
   existing stores. That keeps demo mode (localStorage, no Firestore) and live
   mode byte-identical, and keeps sorting/diffing trivial. */

import type { Load as LegacyLoad } from '../loadsStore';

/* Bumped whenever the load schema changes shape. A doc carrying this version has
   already been migrated, so the migration skips it (idempotent re-runs). */
export const SCHEMA_VERSION = 2;

/* ---------------------------------------------------------------- enums ---- */

/* The board's 11 statuses. These EXACT lowercase keys drive the Asset Matrix
   legend colors (data/schedule LOAD_STATUS_COLOR / LOAD_STATUS_LABEL) — do not
   rename, reorder, or re-case them. */
export const LOAD_STATUSES = [
  'unassigned', 'open', 'covered', 'dispatched', 'at yard', 'at shipper',
  'en route', 'at receiver', 'delivered', 'completed', 'off',
] as const;
export type LoadStatus = (typeof LOAD_STATUSES)[number];

/* The five carrier entities. A LEG may run under a different authority than the
   load header (Phase 1) — that is intentional, not a bug. */
export const BOOKING_AUTHORITIES = [
  'AJG Transport', 'Gomez Haulers', 'GH Logistics LLC',
  'AG4 Haulers LLC', 'A Plus Three Trucking LLC',
] as const;
export type BookingAuthority = (typeof BOOKING_AUTHORITIES)[number];

export const BOOKING_TERMINALS = ['SATX', 'DALLAS', 'MEMPHIS'] as const;
export type BookingTerminal = (typeof BOOKING_TERMINALS)[number];

export const BILLING_STATUSES = [
  'NOT_READY', 'MISSING_DOCS', 'READY_FOR_ACCOUNTING',
  'INVOICED', 'PAID', 'ON_HOLD', 'CANCELLED_TONU',
] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export const BILLING_STATUS_LABEL: Record<BillingStatus, string> = {
  NOT_READY: 'Not ready',
  MISSING_DOCS: 'Missing docs',
  READY_FOR_ACCOUNTING: 'Ready for accounting',
  INVOICED: 'Invoiced',
  PAID: 'Paid',
  ON_HOLD: 'On hold',
  CANCELLED_TONU: 'Cancelled / TONU',
};

/* Billing rank — the Phase 4 gate and the `completed` status derivation both ask
   "is this load at least READY_FOR_ACCOUNTING?". Cancelled/on-hold sit outside
   the ladder and deliberately rank below ready. */
export const BILLING_RANK: Record<BillingStatus, number> = {
  NOT_READY: 0, MISSING_DOCS: 0, ON_HOLD: 0, CANCELLED_TONU: 0,
  READY_FOR_ACCOUNTING: 1, INVOICED: 2, PAID: 3,
};

/* ---- assignments (Phase 1) ---- */
export const LEG_TYPES = ['Linehaul', 'Local Shuttle', 'Relay', 'Yard Move', 'Recovery'] as const;
export type LegType = (typeof LEG_TYPES)[number];

export const DISPATCH_TARGETS = ['Both drivers', 'Driver 1', 'Driver 2'] as const;
export type DispatchTarget = (typeof DISPATCH_TARGETS)[number];

export const TIMING_RESULTS = ['On Time', 'At Risk', 'Late', 'Pending'] as const;
export type TimingResult = (typeof TIMING_RESULTS)[number];

/* ---- stops (Phase 3) ---- */
export const STOP_TYPES = ['Pickup', 'Delivery'] as const;
export type StopType = (typeof STOP_TYPES)[number];

export const STOP_ACTIONS = ['Live Load', 'Hook Trailer', 'Drop Trailer', 'Live Unload'] as const;
export type StopAction = (typeof STOP_ACTIONS)[number];

export const QTY_TYPES = ['Pallets', 'Pieces', 'Cases', 'Bulk'] as const;
export type QtyType = (typeof QTY_TYPES)[number];

/* ---- milestones (Phase 2) ---- */
export const MILESTONE_SOURCES = ['DRIVER', 'DISPATCH', 'SAMSARA'] as const;
export type MilestoneSource = (typeof MILESTONE_SOURCES)[number];

/* The event ladder. `ladderIndex` is the position in these arrays and is what
   enforces ordering — a milestone can never be logged out of sequence.
   REQUIRED rungs: En Route, the arrival rung, and the completion rung. The
   loading/unloading and detention rungs are optional (detention only gets logged
   when the driver actually sits). */
export const PICKUP_LADDER = [
  'En Route', 'At Pickup', 'Loading Started', 'Loading Completed',
  'Detention Begin', 'Detention Ended', 'Pickup Completed',
] as const;
export const DELIVERY_LADDER = [
  'En Route', 'At Delivery', 'Unloading Started', 'Unloading Completed',
  'Detention Begin', 'Detention Ended', 'Delivery Completed',
] as const;
export type MilestoneEvent = (typeof PICKUP_LADDER)[number] | (typeof DELIVERY_LADDER)[number];

const REQUIRED_EVENTS = new Set<string>([
  'En Route', 'At Pickup', 'At Delivery', 'Pickup Completed', 'Delivery Completed',
]);

export function ladderFor(stopType: StopType): readonly MilestoneEvent[] {
  return stopType === 'Pickup' ? PICKUP_LADDER : DELIVERY_LADDER;
}
export function ladderIndexOf(stopType: StopType, event: MilestoneEvent): number {
  return ladderFor(stopType).indexOf(event as never);
}
export function isRequiredEvent(event: MilestoneEvent): boolean {
  return REQUIRED_EVENTS.has(event);
}

/* Free-time allowance before detention starts accruing. Phase 2 falls back to
   (actualOut − actualIn − freeTime) when the detention rungs weren't logged.
   Per-customer overrides come later — the spec parks that for a future phase. */
export const DEFAULT_FREE_TIME_MINUTES = 120;

/* ---- documents (Phase 4) ---- */
export const DOC_TYPES = [
  'BOL', 'POD', 'RATE_CON', 'LUMPER_RECEIPT',
  'SCALE_TICKET', 'LATE_SLIP', 'DETENTION_PROOF',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const INVOICE_REQUIREMENTS = ['WITHHOLD', 'DELIVERABLE'] as const;
export type InvoiceRequirement = (typeof INVOICE_REQUIREMENTS)[number];

/* BOL and POD are withheld from the invoice packet by default; everything else
   ships with it. */
export function defaultInvoiceRequirement(t: DocType): InvoiceRequirement {
  return t === 'BOL' || t === 'POD' ? 'WITHHOLD' : 'DELIVERABLE';
}

/* ---- exceptions (Phase 5) ---- */
export const EXCEPTION_TYPES = [
  'Driver HOS', 'Driver Availability', 'Breakdown / OOS', 'Trailer Issue',
  'Shipper Delay', 'Receiver Delay', 'Weather', 'Recovery / Contractor Failure',
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

/* ------------------------------------------------------- shared shapes ---- */

/* Hard rule: EVERY write carries who and when, with the signed-in user's email.
   Stamped by data/tms/stamp — never hand-write these. */
export interface Stamps {
  createdBy: string; createdAt: string;   // ISO-8601
  updatedBy: string; updatedAt: string;
}

export interface LoadRefs {
  customerRefConf: string; shipmentBol: string; po: string;
  pro: string; pickupNumber: string; deliveryNumber: string;
}
export function blankRefs(): LoadRefs {
  return { customerRefConf: '', shipmentBol: '', po: '', pro: '', pickupNumber: '', deliveryNumber: '' };
}

/* PHASE 9 PLACEHOLDER. The financials spec was not included in the brief, so
   this is the minimal forward-compatible shape carrying what the legacy record
   already knows (rate + derived CPM). Phase 9 extends it — settlement splits,
   accessorials, fuel surcharge, per-leg pay. Nothing computes off it yet. */
export interface LoadFinancials {
  rate: number | null;            // total revenue on the load (legacy `rate`)
  linehaul: number | null;
  fuelSurcharge: number | null;
  accessorials: number | null;
  totalRevenue: number | null;
  ratePerMile: number | null;     // legacy `cpm`
}
export function blankFinancials(): LoadFinancials {
  return { rate: null, linehaul: null, fuelSurcharge: null, accessorials: null, totalRevenue: null, ratePerMile: null };
}

/* PHASE 7 PLACEHOLDER. Same story — the lock spec wasn't included. This is the
   conservative shape (who holds it, since when, why) so Phase 0 docs already
   carry the field and Phase 7 doesn't need a second migration. */
export interface LoadLock {
  locked: boolean;
  lockedBy: string;
  lockedAt: string;
  reason: string;
}
export function blankLock(): LoadLock {
  return { locked: false, lockedBy: '', lockedAt: '', reason: '' };
}

/* ------------------------------------------------------- the load header ---- */

/* The Phase 0 load. It EXTENDS the legacy record (see the migration posture note
   at the top) so a migrated doc satisfies both the old views and the new schema
   at once. `Partial<…>` because brand-new TMS loads created after the UI flips
   over won't carry legacy-only fields.

   `weight` is omitted from the legacy half deliberately: the legacy field is free
   text ("42,000 lbs") and the schema field is a number. The migration parses one
   into the other, so the number wins and the legacy string is not carried under
   the same name — the ONLY legacy field that changes type. */
export interface TmsLoad extends Partial<Omit<LegacyLoad, 'weight'>> {
  id: string;
  schemaVersion: number;

  loadNumber: string;             // human-facing, auto-incremented
  routeName: string;              // required
  routeNumber: string;            // e.g. "FA2D3"
  tripNumbers: string[];          // e.g. ["544"] or ["1019","071426","1"]
  customer: string;               // required
  bookingAuthority: string;       // required — BookingAuthority
  bookingTerminal: string;        // required — BookingTerminal

  status: string;                 // LoadStatus — DERIVED in Phase 2…
  statusManualOverride: boolean;  // …unless a human forced it
  billingStatus: BillingStatus;

  equipment: string;
  weight: number | null;
  commodity: string;
  isUspsContract: boolean;

  refs: LoadRefs;
  financials: LoadFinancials;
  dispatchNotes: string;
  parentLoadId: string;           // set when spawned from an exception (Phase 5)
  lock: LoadLock;

  createdBy: string; createdAt: string;
  updatedBy: string; updatedAt: string;
}

/* ------------------------------------------------------ subcollections ---- */

/* loads/{id}/assignments/{assignmentId} — Phase 1.
   Replaces the single truck field. One load can carry several legs, which is how
   a San Antonio local shuttle hands off to an OTR team on the same load. */
export interface AssignmentDriver { driverId: string; name: string; seat: 'primary' | 'co' }

export interface LoadAssignment extends Stamps {
  id: string;
  legIndex: number;               // 1, 2, 3…
  legType: LegType;
  truckNumber: string;            // must exist in assetFleet AND be in service
  trailerNumber: string;
  carrierAuthority: string;       // may differ from the load header
  drivers: AssignmentDriver[];    // 1 or 2, straight off assetDrivers
  fromStopSeq: number;
  toStopSeq: number;
  legStatus: string;              // LoadStatus, per leg
  dispatchedAt: string;
  dispatchSentTo: DispatchTarget | '';
  loadSheetSentAt: string;
  otpResult: TimingResult;
  otdResult: TimingResult;
}

/* loads/{id}/stops/{stopId} — Phase 3 */
export interface StopLocation {
  name: string; address1: string; address2: string;
  city: string; state: string; zip: string;
  lat: number | null; lon: number | null;
  timezone: string;               // the STOP's tz — milestones render in it
}
export interface StopSplitLoad {
  enabled: boolean; yardLocation: string; isLocalSplit: boolean; stopAction: StopAction | '';
}
export interface LoadStopDoc extends Stamps {
  id: string;
  seq: number;
  type: StopType;
  stopAction: StopAction | '';
  location: StopLocation;
  apptDate: string;               // YYYY-MM-DD
  apptWindowStart: string;        // HH:mm
  apptWindowEnd: string;
  apptConfirmed: boolean;
  qty: number | null;
  qtyType: QtyType | '';
  weight: number | null;
  commodity: string;
  refs: LoadRefs;
  seal: string; container: string; chassis: string; customerTrailer: string;
  reeferFuelLevel: number | null;
  instructions: string;
  locationNotes: string;
  legMiles: number | null;
  excludeMilesFromSettlement: boolean;
  actualIn: string;
  actualOut: string;
  detentionMinutes: number | null;   // computed
  splitLoad: StopSplitLoad;
}

/* loads/{id}/milestones/{milestoneId} — Phase 2, the core of the build */
export interface GeoPoint { city: string; state: string }
export interface ReportedLocation { lat: number | null; lon: number | null; city: string; state: string; capturedAt: string }

export interface LoadMilestone extends Stamps {
  id: string;
  stopId: string;
  stopSeq: number;
  assignmentId: string;           // which leg logged it
  eventType: MilestoneEvent;
  ladderIndex: number;            // enforces order
  required: boolean;
  actualAt: string;               // stored UTC
  actualAtLocalTz: string;        // the STOP's timezone, not the user's
  plannedAt: string;              // from the stop appointment
  timing: Exclude<TimingResult, 'Pending'> | '';   // auto vs plannedAt, human-overridable
  timingManualOverride: boolean;
  comments: string;
  enteredLocation: GeoPoint;      // typed by driver/dispatch
  reportedLocation: ReportedLocation | null;   // from Samsara
  source: MilestoneSource;
  sourceDetail: string;           // driver name, dispatcher email, geofence name
  notificationSent: boolean;
  notificationSentAt: string;
}

/* loads/{id}/documents/{docId} — Phase 4 */
export interface LoadDocument extends Stamps {
  id: string;
  docType: DocType;
  invoiceRequirement: InvoiceRequirement;
  fileName: string;               // {loadNumber}-{DOCTYPE}-{MM-DD-YYYY}[-n].{ext}
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  stopId: string;                 // optional tie to a stop
  assignmentId: string;           // optional tie to a leg
  expirationDate: string;
  daysRemaining: number | null;   // computed, null when no expiration
  uploadedBy: string; uploadedAt: string;
}

/* loads/{id}/exceptions/{exceptionId} — Phase 5 */
export interface LoadException extends Stamps {
  id: string;
  exceptionType: ExceptionType;
  reason: string;                 // required
  driverId: string;
  assignmentId: string;
  fromStopSeq: number | null;
  toStopSeq: number | null;
  fromCity: string; fromState: string;
  toCity: string; toState: string;
  childLoadId: string;
  resolved: boolean;
}

/* loads/{id}/notes/{noteId} — Phase 7 */
export interface LoadNote extends Stamps {
  id: string;
  body: string;
  pinned: boolean;
}

/* loads/{id}/audit/{eventId} — append-only change log.
   Written on every mutation; never edited, never deleted (rules enforce it). */
export interface AuditEvent {
  id: string;
  at: string;                     // ISO
  by: string;                     // signed-in email
  action: string;                 // 'load.create' | 'milestone.log' | 'migration.apply' …
  target: string;                 // subcollection path or field group touched
  summary: string;                // one human-readable line
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/* ------------------------------------------------------------ factories ---- */

/* A brand-new load header. Stamps are applied by data/tms/stamp on write — this
   deliberately leaves them blank so nothing writes an unstamped doc by accident. */
export function blankTmsLoad(id: string, init?: Partial<TmsLoad>): TmsLoad {
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    loadNumber: '',
    routeName: '', routeNumber: '', tripNumbers: [],
    customer: '', bookingAuthority: '', bookingTerminal: '',
    status: 'unassigned', statusManualOverride: false, billingStatus: 'NOT_READY',
    equipment: '', weight: null, commodity: '', isUspsContract: false,
    refs: blankRefs(), financials: blankFinancials(),
    dispatchNotes: '', parentLoadId: '', lock: blankLock(),
    createdBy: '', createdAt: '', updatedBy: '', updatedAt: '',
    ...init,
  };
}

/* ---- narrowing helpers (used by the migration's review screen) ---- */
export const isLoadStatus = (v: string): v is LoadStatus => (LOAD_STATUSES as readonly string[]).includes(v);
export const isBookingAuthority = (v: string): v is BookingAuthority => (BOOKING_AUTHORITIES as readonly string[]).includes(v);
export const isBookingTerminal = (v: string): v is BookingTerminal => (BOOKING_TERMINALS as readonly string[]).includes(v);
export const isBillingStatus = (v: string): v is BillingStatus => (BILLING_STATUSES as readonly string[]).includes(v);
