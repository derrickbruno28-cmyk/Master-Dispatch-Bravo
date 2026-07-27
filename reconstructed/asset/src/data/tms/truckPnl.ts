/* Truck P&L — which trucks earn, which don't, and who is in them.

   THE HARD PART IS ATTRIBUTION, NOT ARITHMETIC.
   A single-truck load is easy: all of its revenue belongs to that truck. A
   multi-leg load is not. Putting the whole rate on leg 1's truck — which is what
   every "revenue by truck" report does when nobody thinks about it — makes the
   shuttle tractor that ran 40 miles look like it earned the linehaul, and makes
   the OTR team that ran 600 look idle. On a fleet that runs relays, that is not
   a rounding error; it is the wrong answer.

   So revenue is split BY LEG MILES:

     leg miles = the settlement miles of the stops that leg covers
     leg share = leg miles ÷ the miles of all non-cancelled legs

   Three honest fallbacks, each of which the report SAYS OUT LOUD rather than
   hiding behind a number:

   1. A CANCELLED leg gets nothing and is excluded from the split. It didn't run.
   2. If no leg has miles, the revenue splits EVENLY and the row is flagged
      `evenSplit` — the report shows a ⚖ so you know that number is a division,
      not a measurement.
   3. If a load has one leg, none of this happens at all.

   REVENUE PER DAY WORKED is the column that changes decisions. Raw revenue
   rewards whoever got the long lanes; $80k over 22 days and $80k over 30 days
   are not the same truck. "Days worked" means distinct dates the truck carried a
   load — NOT days available, because we don't keep a history of what was in the
   shop. The column is named for what it measures. */

import { loadAll, type Load } from '../loadsStore';
import { loadFleet } from '../fleetStore';
import { legsFor } from './assignmentsStore';
import { stopsFor } from './stopsStore';
import { storedExceptions } from './exceptionsStore';
import { computeFinancials } from './financials';
import { rowFor as perfRowFor } from './performance';
import { billingStatusOf } from './financials';
import type { BillingStatus, LoadAssignment, TmsLoad } from './types';

/* Money is cents-precise. Splitting a rate three ways leaves float dust
   (10900.000000000002), which then renders as "$10,900.00" — cents on a whole
   number, which reads as a rounding error the reader has to think about. */
const cents = (n: number) => Math.round(n * 100) / 100;


/* ------------------------------------------------------------ attribution ---- */

export interface LegShare {
  leg: LoadAssignment;
  truck: string;
  drivers: string[];
  miles: number;             // settlement miles this leg covers
  share: number;             // 0–1 of the load's revenue
  evenSplit: boolean;        // true when the split was a division, not a measurement
}

/* Settlement miles for the stops a leg covers. legMiles on a stop is the
   distance travelled to REACH that stop, so a leg from stop 1 to stop 3 owns the
   miles of stops 2 and 3 — not stop 1, which it started at. */
function legMilesOf(l: Load, leg: LoadAssignment): number {
  let n = 0;
  for (const s of stopsFor(l)) {
    if (s.legMiles == null || s.excludeMilesFromSettlement) continue;
    if (s.seq > leg.fromStopSeq && s.seq <= leg.toStopSeq) n += s.legMiles;
  }
  return n;
}

export function legShares(l: Load): LegShare[] {
  const all = legsFor(l);
  const live = all.filter((g) => !g.cancelled && g.truckNumber.trim());
  if (live.length === 0) return [];

  const miles = live.map((g) => legMilesOf(l, g));
  const total = miles.reduce((a, b) => a + b, 0);
  const even = total <= 0;

  return live.map((g, i) => ({
    leg: g,
    truck: g.truckNumber.trim(),
    drivers: g.drivers.map((d) => d.name).filter(Boolean),
    miles: miles[i],
    share: even ? 1 / live.length : miles[i] / total,
    evenSplit: even && live.length > 1,
  }));
}

/* --------------------------------------------------------------- the rows ---- */

export interface TruckLoadRow {
  loadId: string; date: string; loadNumber: string; routeName: string; trip: string;
  customer: string; authority: string;
  legLabel: string;              // "leg 2 of 3" when it matters
  drivers: string[];
  revenue: number;               // THIS truck's share
  fullRevenue: number;           // the whole load, for context
  share: number;
  evenSplit: boolean;
  loadedMiles: number; emptyMiles: number;
  cpm: number | null;
  otp: 'On Time' | 'Late' | 'Pending';
  otd: 'On Time' | 'Late' | 'Pending';
  billingStatus: BillingStatus;
  exceptions: number;
}

export interface TruckPnl {
  truck: string;
  terminal: string;
  crew: string[];                // the CURRENT crew off the fleet roster
  type: string;
  loads: number;
  revenue: number;
  loadedMiles: number;
  emptyMiles: number;
  deadheadPct: number | null;
  revPerLoadedMile: number | null;
  daysWorked: number;
  revPerDayWorked: number | null;
  otpOnTime: number; otpLate: number; otpPct: number | null;
  otdOnTime: number; otdLate: number; otdPct: number | null;
  exceptions: number;
  anyEvenSplit: boolean;         // at least one row was a division, not a measurement
  rows: TruckLoadRow[];
}

export interface PnlFilter { from: string; to: string; terminal: string; authority: string }

export function buildTruckPnl(f: PnlFilter): TruckPnl[] {
  const fleet = loadFleet();
  const truckMeta = new Map(fleet.map((t) => [t.tractor, t]));
  const acc = new Map<string, TruckPnl>();
  const days = new Map<string, Set<string>>();

  for (const l of loadAll()) {
    if (!l.date) continue;
    if (f.from && l.date < f.from) continue;
    if (f.to && l.date > f.to) continue;

    const t = l as unknown as Partial<TmsLoad>;
    const authority = t.bookingAuthority || l.bookingAuthority || '(none)';
    if (f.authority !== 'ALL' && authority !== f.authority) continue;

    const fin = computeFinancials(l);
    const perf = perfRowFor(l);
    const shares = legShares(l);
    if (shares.length === 0) continue;

    const excs = storedExceptions(l.id);

    for (const s of shares) {
      const meta = truckMeta.get(s.truck);
      /* THE TRUCK'S home terminal, not the load's booking terminal. This is a
         report about trucks: a San Antonio tractor that ran a load booked out of
         Dallas is still a San Antonio tractor, and filing it under Dallas would
         make the terminal filter answer a different question than the one the
         column implies. The load's terminal is on the drill-down rows. */
      const terminal = meta?.homeCity || t.bookingTerminal || '(none)';
      if (f.terminal !== 'ALL' && terminal !== f.terminal) continue;

      const g = acc.get(s.truck) ?? {
        truck: s.truck,
        terminal,
        crew: [meta?.driver1, meta?.driver2].filter(Boolean) as string[],
        type: meta?.type ?? '',
        loads: 0, revenue: 0, loadedMiles: 0, emptyMiles: 0,
        deadheadPct: null, revPerLoadedMile: null,
        daysWorked: 0, revPerDayWorked: null,
        otpOnTime: 0, otpLate: 0, otpPct: null,
        otdOnTime: 0, otdLate: 0, otdPct: null,
        exceptions: 0, anyEvenSplit: false, rows: [],
      };

      /* OTP belongs to the truck that covered the PICKUP; OTD to the truck that
         covered the DELIVERY. On a relay those are different trucks, and
         crediting both to leg 1 would let a late delivery hide behind an on-time
         pickup made by somebody else. */
      const ownsPickup = s.leg.fromStopSeq <= 1;
      const lastSeq = Math.max(...stopsFor(l).map((x) => x.seq), 1);
      const ownsDelivery = s.leg.toStopSeq >= lastSeq;

      const otp = ownsPickup ? perf.otp : 'Pending';
      const otd = ownsDelivery ? perf.otd : 'Pending';
      if (otp === 'On Time') g.otpOnTime += 1;
      if (otp === 'Late') g.otpLate += 1;
      if (otd === 'On Time') g.otdOnTime += 1;
      if (otd === 'Late') g.otdLate += 1;

      /* an exception counts against the truck on the leg it was logged against */
      const myExcs = excs.filter((x) => x.assignmentId === s.leg.id
        || (!x.assignmentId && shares.length === 1)).length;

      const revenue = (fin.revenue ?? 0) * s.share;
      const emptyShare = (fin.emptyMiles ?? 0) * s.share;

      g.loads += 1;
      g.revenue += revenue;
      g.loadedMiles += s.miles || (fin.loadedMiles ?? 0) * s.share;
      g.emptyMiles += emptyShare;
      g.exceptions += myExcs;
      if (s.evenSplit) g.anyEvenSplit = true;

      const d = days.get(s.truck) ?? new Set<string>();
      d.add(l.date);
      days.set(s.truck, d);

      g.rows.push({
        loadId: l.id, date: l.date,
        loadNumber: t.loadNumber || l.referenceNo || l.id,
        routeName: l.routeName, trip: perf.trip,
        customer: l.customerName || t.customer || '(no customer)',
        authority,
        legLabel: shares.length > 1 ? `leg ${s.leg.legIndex} of ${legsFor(l).length}` : '',
        drivers: s.drivers.length ? s.drivers : [l.driver1, l.driver2].filter(Boolean),
        revenue: cents(revenue), fullRevenue: cents(fin.revenue ?? 0), share: s.share, evenSplit: s.evenSplit,
        loadedMiles: s.miles || (fin.loadedMiles ?? 0) * s.share,
        emptyMiles: emptyShare,
        cpm: s.miles > 0 ? revenue / s.miles : fin.cpm,
        otp, otd,
        billingStatus: billingStatusOf(l),
        exceptions: myExcs,
      });

      acc.set(s.truck, g);
    }
  }

  const out = [...acc.values()].map((g) => {
    const worked = days.get(g.truck)?.size ?? 0;
    const otpScored = g.otpOnTime + g.otpLate;
    const otdScored = g.otdOnTime + g.otdLate;
    const revenue = cents(g.revenue);
    return {
      ...g,
      revenue,
      loadedMiles: Math.round(g.loadedMiles),
      emptyMiles: Math.round(g.emptyMiles),
      daysWorked: worked,
      revPerDayWorked: worked > 0 ? revenue / worked : null,
      revPerLoadedMile: g.loadedMiles > 0 ? revenue / g.loadedMiles : null,
      deadheadPct: g.loadedMiles + g.emptyMiles > 0
        ? (g.emptyMiles / (g.loadedMiles + g.emptyMiles)) * 100 : null,
      /* Pending stays out of the denominator, exactly as it does on the OTP
         screen — the two numbers have to agree or one of them is a lie. */
      otpPct: otpScored > 0 ? (g.otpOnTime / otpScored) * 100 : null,
      otdPct: otdScored > 0 ? (g.otdOnTime / otdScored) * 100 : null,
      rows: g.rows.sort((a, b) => (a.date < b.date ? 1 : -1)),
    };
  });

  return out.sort((a, b) => b.revenue - a.revenue);
}

/* ------------------------------------------------------------- the totals ---- */

export interface PnlTotals {
  trucks: number; loads: number; revenue: number; loadedMiles: number; emptyMiles: number;
  revPerLoadedMile: number | null; deadheadPct: number | null;
  best: TruckPnl | null; worst: TruckPnl | null;
}

export function pnlTotals(rows: TruckPnl[]): PnlTotals {
  const revenue = cents(rows.reduce((n, r) => n + r.revenue, 0));
  const loadedMiles = rows.reduce((n, r) => n + r.loadedMiles, 0);
  const emptyMiles = rows.reduce((n, r) => n + r.emptyMiles, 0);
  /* "worst" means the lowest EARNER among trucks that actually worked. A truck
     with no loads in the window isn't the worst performer, it's absent, and
     putting it at the bottom of this list would point the conversation at the
     wrong truck. */
  const worked = rows.filter((r) => r.loads > 0);
  return {
    trucks: rows.length,
    loads: rows.reduce((n, r) => n + r.loads, 0),
    revenue, loadedMiles, emptyMiles,
    revPerLoadedMile: loadedMiles > 0 ? revenue / loadedMiles : null,
    deadheadPct: loadedMiles + emptyMiles > 0 ? (emptyMiles / (loadedMiles + emptyMiles)) * 100 : null,
    best: worked[0] ?? null,
    worst: worked.length > 1 ? worked[worked.length - 1] : null,
  };
}

/* ---------------------------------------------------------------- export ---- */

const esc = (v: string | number) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function pnlCsv(rows: TruckPnl[]): string {
  const head = ['Truck', 'Terminal', 'Crew', 'Type', 'Loads', 'Revenue', 'Loaded miles',
    'Empty miles', 'Deadhead %', 'Rev per loaded mile', 'Days worked', 'Rev per day worked',
    'OTP %', 'OTD %', 'Exceptions', 'Split estimated'];
  const lines = rows.map((r) => [
    r.truck, r.terminal, r.crew.join(' / '), r.type, r.loads,
    r.revenue.toFixed(2), Math.round(r.loadedMiles), Math.round(r.emptyMiles),
    r.deadheadPct == null ? '' : r.deadheadPct.toFixed(1),
    r.revPerLoadedMile == null ? '' : r.revPerLoadedMile.toFixed(2),
    r.daysWorked,
    r.revPerDayWorked == null ? '' : r.revPerDayWorked.toFixed(2),
    r.otpPct == null ? '' : r.otpPct.toFixed(1),
    r.otdPct == null ? '' : r.otdPct.toFixed(1),
    r.exceptions,
    r.anyEvenSplit ? 'yes' : 'no',
  ].map(esc).join(','));
  return [head.join(','), ...lines].join('\n');
}

/** the drill-down: every load a truck ran, as its own CSV */
export function truckLoadsCsv(t: TruckPnl): string {
  const head = ['Date', 'Load #', 'Trip', 'Route', 'Customer', 'Authority', 'Leg', 'Drivers',
    'Revenue (this truck)', 'Revenue (whole load)', 'Share %', 'Loaded miles', 'CPM',
    'OTP', 'OTD', 'Billing', 'Exceptions'];
  const lines = t.rows.map((r) => [
    r.date, r.loadNumber, r.trip, r.routeName, r.customer, r.authority,
    r.legLabel || 'whole load', r.drivers.join(' / '),
    r.revenue.toFixed(2), r.fullRevenue.toFixed(2), (r.share * 100).toFixed(0),
    Math.round(r.loadedMiles), r.cpm == null ? '' : r.cpm.toFixed(2),
    r.otp, r.otd, r.billingStatus, r.exceptions,
  ].map(esc).join(','));
  return [head.join(','), ...lines].join('\n');
}
