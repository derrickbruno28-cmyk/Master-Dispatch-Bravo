/* The billing work queue — PHASE 9B.

   This is the handoff artifact until real invoicing exists: one row per load,
   grouped by billing status, saying exactly what is stopping each one. "Missing
   docs" is not a useful thing to tell the person chasing paperwork; "waiting on
   POD" is. */

import { loadAll, type Load } from '../loadsStore';
import { loadFleet } from '../fleetStore';
import { billingGate } from './documentsStore';
import { computeFinancials, billingStatusOf, type FinRow } from './financials';
import { legsFor } from './assignmentsStore';
import { stopsFor } from './stopsStore';
import { BILLING_STATUSES, BILLING_STATUS_LABEL, type BillingStatus, type TmsLoad } from './types';

function terminalOfTruck(truck: string): string {
  const t = (truck || '').trim();
  if (!t) return '';
  return loadFleet().find((f) => f.tractor === t)?.homeCity || '';
}

export function finRowOf(l: Load): FinRow {
  const t = l as unknown as Partial<TmsLoad>;
  const c = computeFinancials(l);
  const legs = legsFor(l);
  const gate = billingGate(l.id);
  return {
    loadId: l.id,
    date: l.date,
    loadNumber: t.loadNumber || l.referenceNo || l.id,
    routeName: l.routeName,
    trip: [t.routeNumber, ...(t.tripNumbers ?? [])].filter(Boolean).join('-'),
    customer: l.customerName || t.customer || '(no customer)',
    authority: t.bookingAuthority || l.bookingAuthority || '(none)',
    terminal: t.bookingTerminal || terminalOfTruck(l.assignedTruck) || '(none)',
    truck: l.assignedTruck,
    team: legs.map((g) => g.truckNumber).filter(Boolean).join(' → '),
    drivers: [...new Set(legs.flatMap((g) => g.drivers.map((d) => d.name)).filter(Boolean))],
    revenue: c.revenue ?? 0,
    loadedMiles: c.loadedMiles ?? 0,
    emptyMiles: c.emptyMiles ?? 0,
    totalMiles: c.totalMiles ?? 0,
    cpm: c.cpm,
    fscAmount: c.fscAmount ?? 0,
    billingStatus: billingStatusOf(l),
    /* the load's own derived flags are the fast path; the documents cache is the
       truth for a load whose card is open right now */
    missingBol: t.missingBol ?? gate.missing.includes('BOL'),
    missingPod: t.missingPod ?? gate.missing.includes('POD'),
  };
}

export const allFinRows = (): FinRow[] =>
  loadAll().filter((l) => l.date).map(finRowOf).sort((a, b) => (a.date < b.date ? 1 : -1));

/* What is actually stopping this load, in the words the person chasing it would
   use on the phone. */
export function blockedReason(r: FinRow): string {
  if (r.billingStatus === 'CANCELLED_TONU') return 'cancelled — will not bill normally';
  if (r.billingStatus === 'ON_HOLD') return 'on hold by hand';
  if (r.billingStatus === 'PAID') return '';
  if (r.billingStatus === 'INVOICED') return 'waiting on payment';
  if (r.missingBol && r.missingPod) return 'waiting on BOL + POD';
  if (r.missingBol) return 'waiting on BOL';
  if (r.missingPod) return 'waiting on POD';
  if (r.billingStatus === 'READY_FOR_ACCOUNTING') return 'ready — waiting to be invoiced';
  if (r.billingStatus === 'NOT_READY') return 'not delivered yet';
  return '';
}

export interface QueueGroup { status: BillingStatus; label: string; rows: FinRow[]; revenue: number }

export function queueGroups(rows: FinRow[]): QueueGroup[] {
  return BILLING_STATUSES.map((s) => {
    const list = rows.filter((r) => r.billingStatus === s);
    return {
      status: s, label: BILLING_STATUS_LABEL[s], rows: list,
      revenue: list.reduce((n, r) => n + r.revenue, 0),
    };
  });
}

/* The CSV the spec asks for — the artifact that goes to whoever invoices, until
   invoicing lives in here too. */
export function billingCsv(rows: FinRow[]): string {
  const head = ['Load #', 'Route', 'Trip', 'Customer', 'Authority', 'Terminal', 'Truck',
    'PU date', 'DEL date', 'Revenue', 'FSC', 'Loaded miles', 'Empty miles', 'CPM',
    'Billing status', 'Missing BOL', 'Missing POD', 'Blocked on'];
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map((r) => {
    const load = loadAll().find((x) => x.id === r.loadId);
    const stops = load ? stopsFor(load) : [];
    const pu = stops.find((s) => s.type === 'Pickup');
    const del = [...stops].reverse().find((s) => s.type === 'Delivery');
    return [
      r.loadNumber, r.routeName, r.trip, r.customer, r.authority, r.terminal, r.truck,
      pu?.apptDate ?? '', del?.apptDate ?? '',
      r.revenue.toFixed(2), r.fscAmount.toFixed(2), r.loadedMiles, r.emptyMiles,
      r.cpm == null ? '' : r.cpm.toFixed(2),
      BILLING_STATUS_LABEL[r.billingStatus], r.missingBol ? 'yes' : 'no', r.missingPod ? 'yes' : 'no',
      blockedReason(r),
    ].map(esc).join(',');
  });
  return [head.join(','), ...lines].join('\n');
}
