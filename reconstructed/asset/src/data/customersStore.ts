/* Customers + load-field option lists.

   ⚠ PLACEHOLDER LISTS: Derrick is supplying the real equipment/van-type list
   (from LoadStop) and the initial customer list — replace EQUIPMENT_TYPES and
   SEED_CUSTOMERS below when they arrive. Both are editable in-app meanwhile. */

import { emitChange } from './bus';

export interface Customer { id: string; name: string; contact?: string; phone?: string; email?: string; notes?: string }

export const LOAD_TYPES = ['TL', 'LTL'] as const;

/* LoadStop van-type list — PLACEHOLDER until Derrick provides the exact list */
export const EQUIPMENT_TYPES = [
  'Dry Van 53\'', 'Dry Van 48\'', 'Reefer 53\'', 'Box Truck 26\'',
  'Power Only', 'Flatbed 48\'', 'Straight Truck', 'Sprinter Van',
];

const SEED_CUSTOMERS: Customer[] = [
  { id: 'cust-usps', name: 'USPS' },
  { id: 'cust-gh', name: 'GH Logistics (internal)' },
];

const KEY = 'asset-customers-v1';

function read(): Customer[] {
  try { const r = localStorage.getItem(KEY); if (r) { const a = JSON.parse(r) as Customer[]; if (Array.isArray(a) && a.length) return a; } } catch { /* ignore */ }
  return [...SEED_CUSTOMERS];
}
function write(list: Customer[]) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ } emitChange(); }

export function loadCustomers(): Customer[] { return read(); }
export function customerByName(name: string): Customer | undefined {
  const n = name.trim().toLowerCase();
  return read().find((c) => c.name.trim().toLowerCase() === n);
}
/** find-or-create by name — typing a new customer on a load registers it */
export function ensureCustomer(name: string): Customer {
  const ex = customerByName(name);
  if (ex) return ex;
  const c: Customer = { id: `cust-${Date.now()}`, name: name.trim() };
  const list = read(); list.push(c); write(list);
  return c;
}
