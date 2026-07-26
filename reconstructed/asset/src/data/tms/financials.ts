/* Financials — PHASE 9.

   DELIBERATELY NARROW: rate and fuel surcharge, nothing else. No carrier pay, no
   driver settlement, no accessorials. The point of this phase is an honest
   revenue and an honest CPM, and adding a settlement engine on top of numbers
   nobody has checked yet would just produce confident wrong answers faster.

   EVERYTHING EXCEPT rate / fscType / fscRate / emptyMiles IS COMPUTED.
   fscAmount, revenue, totalMiles and cpm are derived on every read, so they
   cannot go stale against the inputs — a stored total that disagrees with its
   own parts is how a load ends up invoiced twice for different amounts.

   MILES COME FROM THE STOPS. Each stop carries legMiles and a
   excludeMilesFromSettlement flag; deadhead and yard repositioning that we don't
   bill for is excluded here rather than being quietly averaged in. */

import type { Load } from '../loadsStore';
import { stopsFor } from './stopsStore';
import { BILLING_RANK, blankFinancials, type LoadFinancials, type TmsLoad, type BillingStatus } from './types';

export function financialsOf(l: Load): LoadFinancials {
  const t = l as unknown as Partial<TmsLoad>;
  const f = { ...blankFinancials(), ...(t.financials ?? {}) };
  /* legacy loads carry the rate on the load itself; the schema keeps both in
     step rather than making people type it twice */
  if (f.rate == null && l.rate != null) f.rate = l.rate;
  return f;
}

/* Loaded miles = the sum of stop legMiles that count for settlement. Falls back
   to the load's own laneMiles when no stop carries a leg distance, so an old
   load still reports something real instead of zero. */
export function milesOf(l: Load): { loaded: number | null; excluded: number; source: 'stops' | 'lane' | 'none' } {
  const stops = stopsFor(l);
  let loaded = 0; let excluded = 0; let sawAny = false;
  for (const s of stops) {
    if (s.legMiles == null) continue;
    sawAny = true;
    if (s.excludeMilesFromSettlement) excluded += s.legMiles; else loaded += s.legMiles;
  }
  if (sawAny) return { loaded, excluded, source: 'stops' };
  if (l.laneMiles != null) return { loaded: l.laneMiles, excluded: 0, source: 'lane' };
  return { loaded: null, excluded: 0, source: 'none' };
}

export interface ComputedFinancials extends LoadFinancials {
  milesSource: 'stops' | 'lane' | 'none';
  excludedMiles: number;
  ratePerMile: number | null;      // linehaul only, before FSC
}

export function computeFinancials(l: Load): ComputedFinancials {
  const f = financialsOf(l);
  const m = milesOf(l);
  const loaded = f.loadedMiles ?? m.loaded;
  const empty = f.emptyMiles ?? 0;
  const rate = f.rate ?? 0;

  /* FSC is one of three shapes and they are not interchangeable — a $0.42
     per-mile surcharge and a 42% surcharge differ by an order of magnitude, so
     the type is stored with the number, never inferred from its size. */
  let fscAmount: number | null = null;
  if (f.fscRate != null) {
    if (f.fscType === 'Flat Amount') fscAmount = f.fscRate;
    else if (f.fscType === 'Per Mile') fscAmount = loaded != null ? f.fscRate * loaded : null;
    else if (f.fscType === 'Invoice %') fscAmount = (rate * f.fscRate) / 100;
  }

  const revenue = rate + (fscAmount ?? 0);
  const totalMiles = loaded != null ? loaded + empty : null;

  return {
    ...f,
    loadedMiles: loaded,
    emptyMiles: empty,
    fscAmount,
    revenue: rate === 0 && fscAmount == null ? null : revenue,
    totalMiles,
    cpm: loaded && loaded > 0 ? revenue / loaded : null,
    ratePerMile: loaded && loaded > 0 ? rate / loaded : null,
    milesSource: m.source,
    excludedMiles: m.excluded,
  };
}

/* The strip across the top of the load card, in LoadStop's order. Returned as
   data so the modal and the Billing view show the same numbers in the same
   words. */
export function financialStrip(l: Load): { label: string; value: string }[] {
  const c = computeFinancials(l);
  /* cents when there are cents, none when there aren't — "$268.8" reads like a
     typo, and "$2,500.00" is noise on a round number */
  const money = (n: number | null) => (n == null ? '—'
    : `$${n.toLocaleString(undefined, Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const mi = (n: number | null) => (n == null ? '—' : `${n.toLocaleString()} mi`);
  return [
    { label: 'Rate $/mi', value: c.ratePerMile == null ? '—' : `$${c.ratePerMile.toFixed(2)}` },
    { label: 'Flat Rate', value: money(c.rate) },
    { label: 'FSC', value: c.fscAmount == null ? '—' : `${money(c.fscAmount)}${c.fscType ? ` · ${c.fscType}` : ''}` },
    { label: 'Revenue', value: money(c.revenue) },
    { label: 'Loaded Miles', value: mi(c.loadedMiles) },
    { label: 'Empty Miles', value: mi(c.emptyMiles) },
    { label: 'Total Distance', value: mi(c.totalMiles) },
    { label: 'CPM (rev/mi)', value: c.cpm == null ? '—' : `$${c.cpm.toFixed(2)}/mi` },
  ];
}

/* ------------------------------------------------------- the state machine ---- */

/* NOT_READY → MISSING_DOCS happens on the final Delivery Completed milestone;
   MISSING_DOCS → READY_FOR_ACCOUNTING happens when the documents land (Phase 4
   owns that half). INVOICED and PAID are human acts. ON_HOLD and CANCELLED_TONU
   are reachable from anywhere, on purpose: they are the escape hatches for loads
   that will never bill normally. */
export const BILLING_NEXT: Record<BillingStatus, BillingStatus[]> = {
  NOT_READY: ['MISSING_DOCS', 'ON_HOLD', 'CANCELLED_TONU'],
  MISSING_DOCS: ['READY_FOR_ACCOUNTING', 'ON_HOLD', 'CANCELLED_TONU'],
  READY_FOR_ACCOUNTING: ['INVOICED', 'ON_HOLD', 'CANCELLED_TONU'],
  INVOICED: ['PAID', 'ON_HOLD', 'CANCELLED_TONU'],
  PAID: ['ON_HOLD'],
  ON_HOLD: ['NOT_READY', 'MISSING_DOCS', 'READY_FOR_ACCOUNTING', 'INVOICED', 'PAID', 'CANCELLED_TONU'],
  CANCELLED_TONU: ['NOT_READY', 'ON_HOLD'],
};

export const billingStatusOf = (l: Load): BillingStatus =>
  ((l as unknown as Partial<TmsLoad>).billingStatus ?? 'NOT_READY') as BillingStatus;

export const isBillable = (l: Load): boolean => BILLING_RANK[billingStatusOf(l)] >= 1;

/* --------------------------------------------------------- report rollups ---- */

export interface FinRow {
  loadId: string; date: string; loadNumber: string; routeName: string; trip: string;
  customer: string; authority: string; terminal: string;
  truck: string; team: string; drivers: string[];
  revenue: number; loadedMiles: number; emptyMiles: number; totalMiles: number; cpm: number | null;
  fscAmount: number;
  billingStatus: BillingStatus;
  missingBol: boolean; missingPod: boolean;
}

export interface Rollup {
  key: string; loads: number; revenue: number; miles: number; cpm: number | null;
  share: number; rows: FinRow[];
}

export function rollup(rows: FinRow[], keyOf: (r: FinRow) => string): Rollup[] {
  const m = new Map<string, Rollup>();
  let total = 0;
  for (const r of rows) {
    const key = keyOf(r) || '(none)';
    const g = m.get(key) ?? { key, loads: 0, revenue: 0, miles: 0, cpm: null, share: 0, rows: [] };
    g.loads += 1; g.revenue += r.revenue; g.miles += r.loadedMiles; g.rows.push(r);
    m.set(key, g);
    total += r.revenue;
  }
  return [...m.values()]
    .map((g) => ({ ...g, cpm: g.miles > 0 ? g.revenue / g.miles : null, share: total ? (g.revenue / total) * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}
