/* Load Repository → load plan — PHASE 3.

   The repository holds 187 USPS routes as FREE TEXT that grew out of a
   spreadsheet: miles read "203 (4hr transit) 1hr buffer", rates read
   "$600 - $850", and delivery times read anything from "Same Day 08:35" to
   "First Del: 9:20:00 PM Second Del: 10:20:00 PM".

   So this parser's job is not to be clever — it is to be HONEST. Everything it
   can't read confidently goes into `warnings`, the caller shows those next to
   the diff, and a human confirms before a single field is written. A parser that
   quietly guesses a delivery appointment would put a truck at a dock on the
   wrong day, and nobody would know why.

   The stop model falls out of the route string: origin is the pickup, and every
   city after it (the "via" cities plus the destination) is a delivery, in order.
   "Abilene, TX - Coppell, TX - Dallas, TX FA2D3-10" is one pickup and two
   deliveries — which is exactly what "First Del / Second Del" is describing. */

import type { AssetRoute } from '../fleet';
import type { StopAction } from './types';
import { ROUTES } from '../fleet';

export interface ParsedTime { time: string; dayOffset: number; raw: string }

export interface TripPlan {
  tripCode: string;          // FA2D3-544
  routeNumber: string;       // FA2D3
  tripNumbers: string[];     // ["544"]
  tripLabel: string;         // "Trip B" when present
  routeName: string;         // the repository's own route string
  origin: string;
  deliveries: string[];      // via cities then the destination, in order
  pickup: ParsedTime | null;
  departure: ParsedTime | null;
  deliveryTimes: ParsedTime[];
  miles: number | null;
  bufferHours: number | null;
  rateLow: number | null;
  rateHigh: number | null;
  rateMid: number | null;
  planning: string;          // LIVE/LIVE, PRELOAD… → the stop action hint
  freq: string;
  warnings: string[];
}

/* ------------------------------------------------------------- primitives ---- */

const num = (s: string): number | null => {
  const n = Number(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* Times arrive in at least five shapes across the sheet:
     "17:45" · "0300" · "02:00 CT" · "9:20:00 PM" · "00:40 AM ET" · "924"
   Anything that doesn't match one of them returns null and the caller warns
   rather than inventing a time. */
export function parseTime(raw: string): { time: string; ok: boolean } {
  const t = (raw || '').trim();
  if (!t) return { time: '', ok: false };

  /* H:MM(:SS)? AM/PM */
  const ampm = t.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])\.?[Mm]\.?/);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3].toLowerCase() === 'p') h += 12;
    return { time: `${String(h).padStart(2, '0')}:${ampm[2]}`, ok: true };
  }
  /* HH:MM, optionally followed by a timezone token */
  const colon = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon) {
    const h = Number(colon[1]);
    if (h <= 23) return { time: `${String(h).padStart(2, '0')}:${colon[2]}`, ok: true };
  }
  /* bare HHMM / HMM (0300, 1730, 924) */
  const bare = t.match(/\b(\d{3,4})\b/);
  if (bare) {
    const v = bare[1].padStart(4, '0');
    const h = Number(v.slice(0, 2)); const m = Number(v.slice(2));
    if (h <= 23 && m <= 59) return { time: `${v.slice(0, 2)}:${v.slice(2)}`, ok: true };
  }
  return { time: '', ok: false };
}

/* "Same Day 08:35" → 0 · "Next Day 1:05 PM" → +1 · "23:40 - Next day" → +1 */
function dayOffsetOf(chunk: string): number {
  return /next\s*day/i.test(chunk) ? 1 : 0;
}

/* Split a delivery blob into one chunk per delivery. The sheet marks them with
   "First Del / Second Del / 1st Del / 2nd Del"; when it doesn't, the whole
   string is one delivery. */
function deliveryChunks(raw: string): string[] {
  const t = (raw || '').trim();
  if (!t) return [];
  const marked = t.split(/(?=\b(?:First|Second|Third|1st|2nd|3rd)\s*Del\b)/i)
    .map((s) => s.trim()).filter(Boolean);
  if (marked.length > 1) return marked;
  /* some rows are "22:30 - 1st Del 08:40 Next Day - 2nd Del" (marker AFTER the
     time), so also split on a trailing marker */
  const trailing = t.split(/(?<=\b(?:1st|2nd|3rd|First|Second|Third)\s*Del\b)/i)
    .map((s) => s.trim()).filter(Boolean);
  return trailing.length > 1 ? trailing : [t];
}

/* "203 (4hr transit) 1hr buffer" → 203 miles, 1h buffer.
   The LEADING number is the mileage; the transit and buffer hours are named. */
function parseMiles(raw: string): { miles: number | null; buffer: number | null } {
  const t = (raw || '').trim();
  if (!t) return { miles: null, buffer: null };
  const lead = t.match(/^\s*([\d,]+(?:\.\d+)?)/);
  const buf = t.match(/([\d.]+)\s*hr\s*buffer/i);
  return {
    miles: lead ? num(lead[1]) : null,
    buffer: buf ? num(buf[1]) : null,
  };
}

/* "$600 - $850" / "$1700-$1950" → low, high, midpoint. The midpoint is what
   pre-fills the rate: it's a starting number to negotiate from, not a quote. */
function parseRate(raw: string): { low: number | null; high: number | null; mid: number | null } {
  const nums = (raw || '').match(/\$?\s*([\d,]+(?:\.\d+)?)/g)?.map((s) => num(s)).filter((n): n is number => n != null) ?? [];
  if (nums.length === 0) return { low: null, high: null, mid: null };
  const low = Math.min(...nums); const high = Math.max(...nums);
  return { low, high, mid: Math.round((low + high) / 2) };
}

/* ------------------------------------------------------------------ plan ---- */

/* Same trip-code/city split the Load Repository page already uses, kept in step
   with it deliberately — one reading of the route string, not two. */
export function splitRoute(route: string) {
  const m = route.match(/\b([A-Z0-9]{2,6}-\d+[A-Za-z]?)\b(?:\s+Trip\s+([A-Z]))?\s*$/);
  const tripCode = m ? m[1] : '';
  const tripLabel = m && m[2] ? `Trip ${m[2]}` : '';
  const head = (m ? route.slice(0, m.index) : route).trim();
  const parts = head.split(' - ').map((s) => s.trim()).filter(Boolean);
  return { tripCode, tripLabel, parts };
}

export function planFromRoute(r: AssetRoute): TripPlan {
  const warnings: string[] = [];
  const { tripCode, tripLabel, parts } = splitRoute(r.route);

  const origin = parts[0] || '';
  const deliveries = parts.slice(1);
  if (!origin) warnings.push('No origin city could be read from the route name.');
  if (deliveries.length === 0) warnings.push('No delivery city could be read from the route name.');

  const routeNumber = tripCode.includes('-') ? tripCode.split('-')[0] : '';
  const tripNumbers = tripCode.includes('-') ? tripCode.split('-').slice(1) : [];

  const pu = parseTime(r.puTime);
  if (r.puTime && !pu.ok) warnings.push(`Pickup time “${r.puTime}” wasn't in a format we recognize — set it by hand.`);
  const dep = parseTime(r.departure);
  if (r.departure && !dep.ok) warnings.push(`Departure “${r.departure}” wasn't in a format we recognize.`);

  const chunks = deliveryChunks(r.delivery);
  const deliveryTimes: ParsedTime[] = chunks.map((c) => {
    const p = parseTime(c);
    if (!p.ok) warnings.push(`Delivery time “${c}” wasn't in a format we recognize — set it by hand.`);
    return { time: p.time, dayOffset: dayOffsetOf(c), raw: c };
  });

  /* The count mismatch is the one that actually hurts: two delivery cities and
     one time means somebody has to decide which stop the time belongs to. */
  if (deliveryTimes.length && deliveries.length && deliveryTimes.length !== deliveries.length) {
    warnings.push(`${deliveries.length} delivery cit${deliveries.length === 1 ? 'y' : 'ies'} but ${deliveryTimes.length} delivery time${deliveryTimes.length === 1 ? '' : 's'} — check which stop each time belongs to.`);
  }

  const { miles, buffer } = parseMiles(r.miles);
  const rate = parseRate(r.rate);

  return {
    tripCode, routeNumber, tripNumbers, tripLabel,
    routeName: r.route,
    origin, deliveries,
    pickup: pu.ok ? { time: pu.time, dayOffset: 0, raw: r.puTime } : null,
    departure: dep.ok ? { time: dep.time, dayOffset: 0, raw: r.departure } : null,
    deliveryTimes,
    miles, bufferHours: buffer,
    rateLow: rate.low, rateHigh: rate.high, rateMid: rate.mid,
    planning: r.planning || '',
    freq: r.freq || '',
    warnings,
  };
}

/* every repository row, pre-parsed — the typeahead searches these */
export function tripIndex(): { row: AssetRoute; plan: TripPlan }[] {
  return ROUTES.map((row) => ({ row, plan: planFromRoute(row) }));
}

export function findTrips(query: string, limit = 12): { row: AssetRoute; plan: TripPlan }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return tripIndex()
    .filter(({ plan }) =>
      `${plan.tripCode} ${plan.routeName} ${plan.origin} ${plan.deliveries.join(' ')} ${plan.freq}`
        .toLowerCase().includes(q))
    .slice(0, limit);
}

/* The repository's planning column is the loading style; map the ones that
   clearly say what happens at the dock and leave the rest blank rather than
   guessing a stop action. */
export function stopActionHint(planning: string, type: 'Pickup' | 'Delivery'): StopAction | '' {
  const t = (planning || '').toLowerCase();
  if (/pre-?load/.test(t)) return type === 'Pickup' ? 'Hook Trailer' : 'Drop Trailer';
  if (/live/.test(t)) return type === 'Pickup' ? 'Live Load' : 'Live Unload';
  return '';
}

/* --------------------------------------------------------------- the diff ---- */

export interface PlanField {
  field: string;
  label: string;
  current: string;
  proposed: string;
  /* true when the load already holds a DIFFERENT non-empty value — those are
     the ones that need a human to say "yes, overwrite" */
  conflict: boolean;
  apply: boolean;
}

export function fieldDiff(label: string, field: string, current: unknown, proposed: unknown): PlanField | null {
  const c = current == null || current === '' ? '' : String(current);
  const p = proposed == null || proposed === '' ? '' : String(proposed);
  if (!p || p === c) return null;                 // nothing to offer
  const conflict = !!c && c !== p;
  return { field, label, current: c || '—', proposed: p, conflict, apply: !conflict };
}
