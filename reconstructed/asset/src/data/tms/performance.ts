/* OTP / OTD — PHASE 6.

   THE POINT OF THIS FILE IS THAT NOBODY TYPES INTO IT.
   The old tracker was a second, hand-keyed copy of the truth: someone ran the
   load, someone else typed a row saying whether it was on time. Two records of
   the same event drift, and the one people quote in a customer meeting is
   whichever one is worse.

   On-time is now READ from the milestone ladder. A pickup is on time when its
   "Pickup Completed" milestone was logged inside the appointment window; a
   delivery is on time when "Delivery Completed" was. No milestone means Pending,
   not a pass — an unlogged stop is an unknown, and rounding unknowns up to
   on-time is how a 91% becomes a 97% on a slide.

   The late REASON comes from the same place: Phase 2 already refuses to save a
   late completion without one, so every ✗ here can name why. */

import { loadAll, type Load } from '../loadsStore';
import { loadFleet } from '../fleetStore';
import { storedMilestones } from './milestonesStore';
import { stopsFor } from './stopsStore';
import { legsFor } from './assignmentsStore';
import { openExceptions } from './exceptionsStore';
import type { LoadStopDoc, LoadMilestone, TmsLoad } from './types';

export const OTP_TARGET = 97;
export const OTD_TARGET = 95;

export type OtpFlag = 'On Time' | 'Late' | 'Pending';

export interface PerfRow {
  loadId: string;
  ls: string;                 // load number
  trip: string;               // route number + trip numbers
  truck: string;
  driver: string;             // pickup leg's driver
  delDriver: string;          // delivery leg's driver (often the same)
  loadType: string;           // the pickup's stop action — live load, drop, hook
  customer: string;
  terminal: string;
  authority: string;
  date: string;               // board date
  week: string;               // ISO week, as a plain number string
  month: string;
  puAppt: string; puActual: string; otp: OtpFlag;
  delAppt: string; delActual: string; otd: OtpFlag;
  /* A late pickup and a late delivery are TWO events with TWO reasons. Folding
     them into one field filed a dock-congestion delivery under the shipper's
     hold — exactly the kind of quiet miscount this phase exists to remove. */
  otpLateReason: string; otpLateReasonDetail: string;
  otdLateReason: string; otdLateReasonDetail: string;
  lateSide: 'pickup' | 'delivery' | 'both' | '';
  hasException: boolean;
}

/* ---------------------------------------------------------------- helpers ---- */

/* ISO-8601 week. Freight weeks get quoted as "week 31" in every operations
   meeting, so the number has to be the same one everyone else is using. */
export function isoWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return String(Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7));
}

function monthOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const completionOf = (ms: LoadMilestone[], stop: LoadStopDoc): LoadMilestone | undefined =>
  ms.find((m) => m.stopId === stop.id
    && (m.eventType === 'Pickup Completed' || m.eventType === 'Delivery Completed'));

/* A milestone's `timing` is already computed against the appointment and its
   window close (Phase 2). "At Risk" means it hadn't happened yet at the time of
   the check — as an OUTCOME it is not a pass, so it reads Pending here. */
function flagOf(m: LoadMilestone | undefined): OtpFlag {
  if (!m) return 'Pending';
  if (m.timing === 'On Time') return 'On Time';
  if (m.timing === 'Late') return 'Late';
  return 'Pending';
}

/* Actuals are stored UTC. Nobody reads a Z-timestamp — render the wall clock. */
export function fmtActual(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const fmtAppt = (s: LoadStopDoc | undefined): string =>
  !s ? '' : s.apptDate ? `${s.apptDate}${s.apptWindowStart ? ` ${s.apptWindowStart}` : ''}` : '';

/* ------------------------------------------------------------------- rows ---- */

export function rowFor(l: Load): PerfRow {
  const t = l as unknown as Partial<TmsLoad>;
  const stops = stopsFor(l);
  const ms = storedMilestones(l.id);
  const legs = legsFor(l);

  const firstPu = stops.find((s) => s.type === 'Pickup');
  const lastDel = [...stops].reverse().find((s) => s.type === 'Delivery');

  const puM = firstPu ? completionOf(ms, firstPu) : undefined;
  const delM = lastDel ? completionOf(ms, lastDel) : undefined;

  const legFor = (s: LoadStopDoc | undefined) => (s
    ? legs.find((g) => g.fromStopSeq <= s.seq && g.toStopSeq >= s.seq) ?? legs[0]
    : legs[0]);
  const nameOf = (seq: LoadStopDoc | undefined) => legFor(seq)?.drivers.find((d) => d.seat === 'primary')?.name || l.driver1 || '';

  const otp = flagOf(puM);
  const otd = flagOf(delM);
  const lateSide: PerfRow['lateSide'] =
    otp === 'Late' && otd === 'Late' ? 'both' : otp === 'Late' ? 'pickup' : otd === 'Late' ? 'delivery' : '';

  return {
    loadId: l.id,
    ls: t.loadNumber || l.referenceNo || l.id,
    trip: [t.routeNumber, ...(t.tripNumbers ?? [])].filter(Boolean).join('-') || l.routeName,
    truck: legFor(firstPu)?.truckNumber || l.assignedTruck,
    driver: nameOf(firstPu),
    delDriver: nameOf(lastDel),
    loadType: firstPu?.stopAction || l.loadType || '',
    customer: l.customerName || t.customer || '',
    terminal: t.bookingTerminal || terminalOfTruck(l.assignedTruck),
    authority: t.bookingAuthority || l.bookingAuthority || '',
    date: l.date,
    week: isoWeek(l.date),
    month: monthOf(l.date),
    puAppt: fmtAppt(firstPu), puActual: puM?.actualAtLocalTz || puM?.actualAt || '', otp,
    delAppt: fmtAppt(lastDel), delActual: delM?.actualAtLocalTz || delM?.actualAt || '', otd,
    otpLateReason: otp === 'Late' ? puM?.lateReason || '' : '',
    otpLateReasonDetail: otp === 'Late' ? puM?.lateReasonDetail || '' : '',
    otdLateReason: otd === 'Late' ? delM?.lateReason || '' : '',
    otdLateReasonDetail: otd === 'Late' ? delM?.lateReasonDetail || '' : '',
    lateSide,
    hasException: (t.hasOpenException ?? false) || openExceptions(l.id).length > 0,
  };
}

function terminalOfTruck(truck: string): string {
  const t = (truck || '').trim();
  if (!t) return '';
  return loadFleet().find((f) => f.tractor === t)?.homeCity || '';
}

export function allRows(): PerfRow[] {
  return loadAll()
    .filter((l) => l.date)
    .map(rowFor)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/* ------------------------------------------------------------------ stats ---- */

export interface PerfStats {
  total: number;
  otpScored: number; otpOnTime: number; otpLate: number; otpPending: number; otpPct: number;
  otdScored: number; otdOnTime: number; otdLate: number; otdPending: number; otdPct: number;
}

/* Pending is excluded from the DENOMINATOR, not counted as a pass. A load whose
   milestones were never logged is not evidence of anything. */
export function computeStats(rows: PerfRow[]): PerfStats {
  const otpOnTime = rows.filter((r) => r.otp === 'On Time').length;
  const otpLate = rows.filter((r) => r.otp === 'Late').length;
  const otpPending = rows.filter((r) => r.otp === 'Pending').length;
  const otdOnTime = rows.filter((r) => r.otd === 'On Time').length;
  const otdLate = rows.filter((r) => r.otd === 'Late').length;
  const otdPending = rows.filter((r) => r.otd === 'Pending').length;
  const otpScored = otpOnTime + otpLate;
  const otdScored = otdOnTime + otdLate;
  return {
    total: rows.length,
    otpScored, otpOnTime, otpLate, otpPending, otpPct: otpScored ? (otpOnTime / otpScored) * 100 : 0,
    otdScored, otdOnTime, otdLate, otdPending, otdPct: otdScored ? (otdOnTime / otdScored) * 100 : 0,
  };
}

export function targetColor(pct: number, target: number): string {
  return pct >= target ? 'var(--green)' : pct >= target - 3 ? 'var(--amber)' : 'var(--red)';
}

/* -------------------------------------------------------- late-reason report ---- */

export type GroupBy = 'reason' | 'driver' | 'terminal' | 'customer';

export interface ReasonGroup { key: string; count: number; pickup: number; delivery: number; share: number }

/* Counts LATE EVENTS, not late loads. A load that left the shipper late AND
   arrived at the receiver late is two failures with two causes; rolling it up as
   one hides half of what went wrong — and attributes it to the wrong reason. */
export function lateGroups(rows: PerfRow[], by: GroupBy): ReasonGroup[] {
  const m = new Map<string, ReasonGroup>();
  let events = 0;
  const add = (rawKey: string, side: 'pickup' | 'delivery') => {
    const key = rawKey || '(not recorded)';
    const g = m.get(key) ?? { key, count: 0, pickup: 0, delivery: 0, share: 0 };
    g.count += 1;
    if (side === 'pickup') g.pickup += 1; else g.delivery += 1;
    m.set(key, g);
    events += 1;
  };
  for (const r of rows) {
    if (r.otp === 'Late') {
      add(by === 'reason' ? r.otpLateReason : by === 'driver' ? r.driver
        : by === 'terminal' ? r.terminal : r.customer, 'pickup');
    }
    if (r.otd === 'Late') {
      add(by === 'reason' ? r.otdLateReason : by === 'driver' ? r.delDriver || r.driver
        : by === 'terminal' ? r.terminal : r.customer, 'delivery');
    }
  }
  const total = events || 1;
  return [...m.values()]
    .map((g) => ({ ...g, share: (g.count / total) * 100 }))
    .sort((a, b) => b.count - a.count);
}

export function topFailReasons(rows: PerfRow[], n = 6): ReasonGroup[] {
  return lateGroups(rows, 'reason').slice(0, n);
}

/* ---------------------------------------------------------------- export ---- */

export function rowsToCsv(rows: PerfRow[]): string {
  const head = ['LS#', 'Trip', 'Truck', 'Driver', 'Load Type', 'Customer', 'Terminal', 'Authority',
    'Date', 'Week', 'PU Appt', 'PU Actual', 'OTP', 'OTP Late Reason',
    'DEL Appt', 'DEL Actual', 'OTD', 'OTD Late Reason', 'Detail'];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map((r) => [
    r.ls, r.trip, r.truck, r.driver, r.loadType, r.customer, r.terminal, r.authority,
    r.date, r.week, r.puAppt, fmtActual(r.puActual), r.otp, r.otpLateReason,
    r.delAppt, fmtActual(r.delActual), r.otd, r.otdLateReason,
    [r.otpLateReasonDetail, r.otdLateReasonDetail].filter(Boolean).join(' / '),
  ].map((v) => esc(String(v ?? ''))).join(','));
  return [head.join(','), ...lines].join('\n');
}
