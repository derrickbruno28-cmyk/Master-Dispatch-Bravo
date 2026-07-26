/* Rate confirmation parsing — PHASE 8.

   NOTHING HERE WRITES ANYTHING. Every function returns a PROPOSAL: what was
   found, where it would go, how sure the parser is, and — when the Load
   Repository disagrees — by how much. RateConReview shows that proposal
   field by field with an accept/reject toggle, and only the confirm button
   writes. Hard rule 5 is the reason this file has no store imports.

   TWO EXTRACTORS
   USPS rate cons carry the route and trip inside one identifier; everything else
   is labeled fields. Detecting which is which is worth doing because the USPS
   path can then cross-reference the Load Repository and tell you the rate con
   disagrees with the contract — which is the whole reason to read the document
   with a computer instead of an eye. */

import type { LoadStop } from '../loadsStore';
import { findTrips, type TripPlan } from './repository';

/* ------------------------------------------------------ USPS trip identifiers ---- */

/* {ROUTE}{sep}{TRIP}[{sep}{TRIP}…] — the separator is '-' OR '_', both of which
   appear in live data, and the prefix is NOT always FA2D3 (7523D, 002D3, FA26E
   are all real). Anything that doesn't match is surfaced as "unrecognized",
   never guessed at. */
export const USPS_TRIP_RE = /\b([A-Z0-9]{4,6})[-_]([A-Z0-9]+(?:[-_][A-Z0-9]+)*)\b/gi;

export interface TripId { raw: string; routeNumber: string; tripNumbers: string[] }

export function parseTripId(raw: string): TripId | null {
  const re = new RegExp(USPS_TRIP_RE.source, 'i');
  const m = raw.trim().match(re);
  if (!m || m[0].length !== raw.trim().length) return null;
  return {
    raw: raw.trim(),
    routeNumber: m[1].toUpperCase(),
    tripNumbers: m[2].split(/[-_]/).filter(Boolean).map((s) => s.toUpperCase()),
  };
}

/* Every trip identifier in a document, de-duplicated, in the order found.
   A rate con can legitimately name more than one (the trip and its return). */
export function findTripIds(text: string): TripId[] {
  const out: TripId[] = [];
  const seen = new Set<string>();
  const re = new RegExp(USPS_TRIP_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (seen.has(raw.toUpperCase())) continue;
    seen.add(raw.toUpperCase());
    /* A pure date (07-14-26) or a phone-ish run of digits is not a trip id. The
       route prefix must contain at least one letter OR the whole thing must look
       like the numeric route codes we actually use (002D3, 7523D both have
       letters; a bare 12-34-56 does not). */
    if (!/[A-Z]/i.test(m[1])) continue;
    out.push({
      raw,
      routeNumber: m[1].toUpperCase(),
      tripNumbers: m[2].split(/[-_]/).filter(Boolean).map((s) => s.toUpperCase()),
    });
  }
  return out;
}

/* --------------------------------------------------------------- doc typing ---- */

export type RateConKind = 'usps' | 'broker' | 'unknown';

export function detectKind(text: string): RateConKind {
  if (findTripIds(text).length > 0) return 'usps';
  if (/\b(USPS|United States Postal|Postal Service|HCR)\b/i.test(text)) return 'usps';
  if (/\b(rate confirmation|load confirmation|carrier confirmation|broker)\b/i.test(text)) return 'broker';
  return 'unknown';
}

/* ----------------------------------------------------------- labeled fields ---- */

const REF_PATTERNS: { field: string; label: string; res: RegExp[] }[] = [
  /* EVERY label is \b-anchored. Without it "Transportation" contains "po" and
     the PO pattern happily returns "rtation" — which the verification caught. */
  { field: 'refs.customerRefConf', label: 'Reference / confirmation #', res: [
    /\b(?:Reference|Ref)\s*(?:Number|No\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
    /\bConfirmation\s*(?:Number|No\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
    /\bOrder\s*(?:Number|No\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ] },
  { field: 'refs.pickupNumber', label: 'Pickup #', res: [
    /\b(?:Pickup|Pick\s*up|PU)\s*(?:Number|No\.?|Ref(?:erence)?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ] },
  { field: 'refs.deliveryNumber', label: 'Delivery #', res: [
    /\b(?:Delivery|Del)\s*(?:Number|No\.?|Ref(?:erence)?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ] },
  { field: 'refs.shipmentBol', label: 'BOL #', res: [
    /\b(?:BOL|B\/L|Bill\s*of\s*Lading)\s*(?:Number|No\.?|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ] },
  { field: 'refs.po', label: 'PO #', res: [
    /\b(?:PO|P\.O\.|Purchase\s*Order)\b\s*(?:Number|No\.?|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ] },
  { field: 'refs.pro', label: 'PRO #', res: [
    /\bPRO\b\s*(?:Number|No\.?|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ] },
  /* the spec's fallback: Load # / Shipment # only fills the confirmation ref
     when nothing better was found */
  { field: 'refs.customerRefConf', label: 'Load / shipment # (fallback)', res: [
    /\b(?:Load|Shipment)\s*(?:Number|No\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,})/i,
  ] },
];

function firstMatch(text: string, res: RegExp[]): string {
  for (const re of res) { const m = text.match(re); if (m && m[1]) return m[1].trim(); }
  return '';
}

const num = (s: string): number | null => {
  const m = s.replace(/[, ]/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/* ---------------------------------------------------------------- proposal ---- */

export type Confidence = 'high' | 'medium' | 'low';

export interface ProposedField {
  key: string;                 // stable id for the toggle
  label: string;               // human name
  target: string;              // where it lands, in words
  value: string | number | boolean | string[];
  display: string;             // what to show in the review row
  confidence: Confidence;
  accept: boolean;             // the toggle — conflicts default to false
  note: string;                // why it's uncertain, or what it disagrees with
}

export interface ProposedStop {
  type: 'pickup' | 'delivery';
  name: string;
  address: string; city: string; state: string; zip: string;
  apptDate: string; apptWindowStart: string; apptWindowEnd: string;
  stopAction: string;
}

export interface RateConProposal {
  kind: RateConKind;
  tripIds: TripId[];
  unrecognized: string[];      // trip-looking strings that did NOT parse
  fields: ProposedField[];
  stops: ProposedStop[];
  repoMatch: TripPlan | null;
  variances: ProposedField[];  // where the rate con disagrees with the repository
  text: string;
  textLooksEmpty: boolean;     // an image-only scan — say so, don't pretend
  warnings: string[];
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

/* "07/14/2026", "7-14-26", "July 14, 2026" → YYYY-MM-DD, or '' */
export function parseDate(raw: string): string {
  const s = raw.trim();
  let m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${yr}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  m = s.match(new RegExp(`(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i'));
  if (m) {
    const mi = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(m[1].toLowerCase().slice(0, 3)) + 1;
    return `${m[3]}-${String(mi).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return '';
}

/* "14:30", "2:30 PM", "1430" → HH:mm, or '' */
export function parseClock(raw: string): string {
  const s = raw.trim().toUpperCase();
  let m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
  if (m) {
    let h = Number(m[1]);
    if (m[3] === 'PM' && h < 12) h += 12;
    if (m[3] === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  }
  m = s.match(/\b(\d{4})\b/);
  if (m) {
    const h = Number(m[1].slice(0, 2)); const mi = Number(m[1].slice(2));
    if (h < 24 && mi < 60) return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  return '';
}

function cityStateZip(block: string) {
  const m = block.match(/([A-Za-z .'-]+?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?/);
  return m ? { city: m[1].trim().replace(/\s{2,}/g, ' '), state: m[2], zip: m[3] } : { city: '', state: '', zip: '' };
}

/* Everything after a label, up to the next label-looking token. Rate cons are
   laid out as tables that flatten into one line, so "until the next label" is
   the only boundary that survives extraction. */
function blockAfter(text: string, labels: string[]): string {
  for (const lab of labels) {
    const re = new RegExp(`${lab}\\s*[:\\-]?\\s*([^\\n]{5,200})`, 'i');
    const m = text.match(re);
    if (m) return m[1];
  }
  return '';
}

export function parseRateCon(text: string): RateConProposal {
  const t = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const fields: ProposedField[] = [];
  const warnings: string[] = [];
  const textLooksEmpty = t.replace(/\s/g, '').length < 40;
  if (textLooksEmpty) {
    warnings.push('This PDF has almost no extractable text — it is probably a scan. Nothing below was read from it; type the load in by hand, or attach it as a document and fill the fields yourself. The parser will not guess at an image.');
  }

  const add = (key: string, label: string, target: string, value: ProposedField['value'], display: string, confidence: Confidence, note = '', accept = true) => {
    fields.push({ key, label, target, value, display, confidence, accept, note });
  };

  const kind = detectKind(t);
  const tripIds = findTripIds(t);

  /* things that LOOK like a trip id but did not parse — surfaced, never guessed */
  /* A candidate is only "an unrecognized trip" if it has the SHAPE of one: a
     4–6 character prefix that isn't a reference label. BOL-55231 and PRO-1234
     are references, and calling them malformed trips would train people to
     ignore this warning — which is the one warning that has to be believed. */
  const REF_LABELS = /^(BOL|PO|REF|RC|PU|DEL|PRO|INV|MC|DOT|TRL|TRK|SCAC|EIN)$/i;
  const unrecognized: string[] = [];
  for (const cand of t.match(/\b[A-Z0-9]{4,6}[-_][A-Z0-9-_]{2,}\b/gi) ?? []) {
    if (tripIds.some((x) => x.raw.toUpperCase() === cand.toUpperCase())) continue;
    if (REF_LABELS.test(cand.split(/[-_]/)[0])) continue;
    if (!/[A-Z]/i.test(cand.split(/[-_]/)[0])) continue;      // a bare date
    unrecognized.push(cand);
  }

  if (tripIds.length) {
    const first = tripIds[0];
    add('isUspsContract', 'USPS contract', 'load.isUspsContract', true, 'yes', 'high',
      `a USPS trip identifier (${first.raw}) is on the document`);
    add('routeNumber', 'Route number', 'load.routeNumber', first.routeNumber, first.routeNumber, 'high');
    add('tripNumbers', 'Trip numbers', 'load.tripNumbers', first.tripNumbers, first.tripNumbers.join(' · '), 'high',
      first.tripNumbers.length > 1 ? 'this identifier carries more than one trip number' : '');
    if (tripIds.length > 1) {
      warnings.push(`More than one trip identifier is on this document (${tripIds.map((x) => x.raw).join(', ')}). The first one is proposed; check it is the right leg.`);
    }
  }

  for (const p of REF_PATTERNS) {
    if (fields.some((f) => f.key === p.field)) continue;      // first match wins, incl. the fallback
    const v = firstMatch(t, p.res);
    if (v) add(p.field, p.label, p.field, v, v, 'medium');
  }

  const rate = num(firstMatch(t, [
    /(?:Total\s*(?:Rate|Pay|Amount)|Line\s*Haul|Linehaul|Flat\s*Rate|Carrier\s*Pay)\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
    /\bRate\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
  ]));
  if (rate != null && rate > 0) add('rate', 'Rate / linehaul', 'financials.rate', rate, `$${rate.toLocaleString()}`, 'high');

  const fsc = num(firstMatch(t, [/(?:Fuel\s*Surcharge|FSC)\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i]));
  if (fsc != null && fsc > 0) add('fscRate', 'Fuel surcharge', 'financials.fscRate (flat amount)', fsc, `$${fsc.toLocaleString()}`, 'medium');

  const miles = num(firstMatch(t, [/(?:Total\s*)?Miles\s*[:\-]?\s*([\d,]+)/i, /([\d,]{2,})\s*(?:mi|miles)\b/i]));
  if (miles != null && miles > 0) add('loadedMiles', 'Miles', 'financials.loadedMiles', miles, `${miles.toLocaleString()} mi`, 'medium');

  const weight = firstMatch(t, [/Weight\s*[:\-]?\s*([\d,]+)\s*(?:lbs?|pounds?)?/i, /([\d,]{4,})\s*lbs?\b/i]);
  if (weight) add('weight', 'Weight', 'load.weight', `${weight.replace(/,/g, '')} lbs`, `${weight} lbs`, 'medium');

  const commodity = firstMatch(t, [/Commodity\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 /&.,'-]{2,40})/i, /Freight\s*(?:Description|Desc)?\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 /&.,'-]{2,40})/i]);
  if (commodity) add('commodity', 'Commodity', 'load.commodity', commodity, commodity, 'medium');

  const equipment = firstMatch(t, [/Equipment\s*(?:Type)?\s*[:\-]?\s*(53'?\s*(?:Dry\s*Van|Van|Reefer)|Dry\s*Van|Reefer|Flatbed|Van|Power\s*Only)/i, /\b(53'\s*Van|Dry\s*Van|Reefer|Flatbed|Power\s*Only)\b/i]);
  if (equipment) add('equipment', 'Equipment', 'load.equipment', equipment.replace(/\s+/g, ' '), equipment, 'medium');

  const pieces = num(firstMatch(t, [/(?:Pieces|Pallets|Piece\s*Count|Pallet\s*Count)\s*[:\-]?\s*(\d{1,4})/i]));
  if (pieces != null) add('pieces', 'Piece / pallet count', 'stop.qty', pieces, String(pieces), 'low');

  const temp = num(firstMatch(t, [/(?:Temp(?:erature)?|Set\s*Point)\s*[:\-]?\s*(-?\d{1,3})\s*°?\s*F?/i]));
  if (temp != null) add('temperature', 'Reefer set point', 'stop.instructions', temp, `${temp}°F`, 'low');

  if (/\bhazmat\b|\bhazardous\b/i.test(t)) add('hazmat', 'Hazmat', 'load.dispatchNotes', true, 'flagged on the document', 'medium');
  if (/\btarp(s|ed|ing)?\b/i.test(t)) add('tarp', 'Tarp required', 'load.dispatchNotes', true, 'flagged on the document', 'medium');

  const customer = firstMatch(t, [/(?:Broker|Customer|Bill\s*To|Company)\s*[:\-]?\s*([A-Z][A-Za-z0-9 &.,'-]{2,40})/]);
  if (customer) add('customerName', 'Customer / broker', 'load.customer', customer.trim(), customer.trim(), 'low',
    'match this against the customer list before accepting');

  /* ------------------------------------------------------------- the stops --- */
  const stops: ProposedStop[] = [];
  const mkStop = (type: ProposedStop['type'], labels: string[], apptLabels: string[]): void => {
    const block = blockAfter(t, labels);
    if (!block) return;
    const csz = cityStateZip(block);
    if (!csz.city) return;
    const appt = blockAfter(t, apptLabels);
    const date = parseDate(appt) || parseDate(block);
    /* Strip the DATE out before looking for times. "07/26/2026" ends in 2026,
       which reads as a perfectly good 20:26 military time — the verification
       caught exactly that, and an appointment window that starts at 20:26
       because of the year is worse than no window at all. */
    const timeText = appt
      .replace(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/g, ' ')
      .replace(/\b(?:19|20)\d{2}\b/g, ' ');
    const times = (timeText.match(/\d{1,2}:\d{2}\s*(?:AM|PM)?|\b\d{4}\b/gi) ?? []).map(parseClock).filter(Boolean);
    /* Live Load / Live Unload is the default the spec asks for; only an explicit
       Drop or Hook on the document overrides it. */
    const dropHook = /\bdrop\b/i.test(block) ? 'Drop Trailer' : /\bhook\b/i.test(block) ? 'Hook Trailer' : '';
    stops.push({
      type,
      name: (block.split(/\d/)[0] || '').trim().replace(/[,\s]+$/, ''),
      address: block.trim(), ...csz,
      apptDate: date, apptWindowStart: times[0] || '', apptWindowEnd: times[1] || '',
      stopAction: dropHook || (type === 'pickup' ? 'Live Load' : 'Live Unload'),
    });
  };
  mkStop('pickup', ['Shipper', 'Pick\\s*up', 'Pickup', 'Origin'], ['Pick\\s*up\\s*(?:Date|Appt|Appointment|Time)', 'Shipper\\s*(?:Date|Appt|Time)']);
  mkStop('delivery', ['Consignee', 'Receiver', 'Delivery', 'Destination'], ['Delivery\\s*(?:Date|Appt|Appointment|Time)', 'Consignee\\s*(?:Date|Appt|Time)']);

  if (stops.length === 1) warnings.push('Only one stop was recognized. Check the other end on the Stops tab before dispatching.');
  if (stops.length === 0 && !textLooksEmpty) warnings.push('No stop addresses were recognized in this document.');

  /* ------------------------------------------- the Load Repository crosscheck --- */
  let repoMatch: TripPlan | null = null;
  const variances: ProposedField[] = [];
  if (tripIds.length) {
    const code = `${tripIds[0].routeNumber}-${tripIds[0].tripNumbers[0]}`;
    repoMatch = findTrips(code, 1)[0]?.plan ?? null;
    if (repoMatch) {
      const flag = (key: string, label: string, docVal: string, repoVal: string, note: string) => {
        variances.push({
          key: `var.${key}`, label, target: 'the contract says something different',
          value: docVal, display: `rate con ${docVal} · repository ${repoVal}`,
          confidence: 'high', accept: false, note,
        });
      };
      if (miles != null && repoMatch.miles != null && Math.abs(miles - repoMatch.miles) > 25) {
        flag('miles', 'Miles disagree', `${miles} mi`, `${repoMatch.miles} mi`,
          'more than 25 miles apart — check which lane this actually is');
      }
      if (rate != null && repoMatch.rateLow != null && repoMatch.rateHigh != null
        && (rate < repoMatch.rateLow || rate > repoMatch.rateHigh)) {
        flag('rate', 'Rate is outside the contract band', `$${rate.toLocaleString()}`,
          `$${repoMatch.rateLow.toLocaleString()}–$${repoMatch.rateHigh.toLocaleString()}`,
          'this is the number to argue about before the truck rolls');
      }
      const puStop = stops.find((s) => s.type === 'pickup');
      if (puStop?.apptWindowStart && repoMatch.pickup?.time && puStop.apptWindowStart !== repoMatch.pickup.time) {
        flag('pickupTime', 'Pickup time disagrees', puStop.apptWindowStart, repoMatch.pickup.time,
          'the repository holds the scheduled contract time');
      }
    } else {
      warnings.push(`Trip ${code} is not in the Load Repository — nothing to cross-check it against.`);
    }
  }

  return { kind, tripIds, unrecognized, fields, stops, repoMatch, variances, text, textLooksEmpty, warnings };
}

/* ------------------------------------------------------------- application ---- */

/* Turns the ACCEPTED subset of a proposal into a patch. Still no writes — the
   caller decides what to do with it. */
export interface RateConPatch {
  load: Record<string, unknown>;
  stops: Partial<LoadStop>[];
  applied: string[];
}

export function buildPatch(p: RateConProposal, accepted: Set<string>): RateConPatch {
  const load: Record<string, unknown> = {};
  const applied: string[] = [];
  const refs: Record<string, unknown> = {};
  const financials: Record<string, unknown> = {};

  for (const f of p.fields) {
    if (!accepted.has(f.key)) continue;
    applied.push(f.label);
    if (f.key.startsWith('refs.')) { refs[f.key.slice(5)] = f.value; continue; }
    switch (f.key) {
      case 'rate': load.rate = f.value; financials.rate = f.value; break;
      case 'fscRate': financials.fscType = 'Flat Amount'; financials.fscRate = f.value; break;
      case 'loadedMiles': load.laneMiles = f.value; financials.loadedMiles = f.value; break;
      case 'isUspsContract': load.uspsContract = true; load.isUspsContract = true; break;
      case 'customerName': load.customerName = f.value; load.customer = f.value; break;
      case 'hazmat': case 'tarp': case 'temperature': case 'pieces': break;   // notes, handled below
      default: load[f.key] = f.value;
    }
  }

  const notes: string[] = [];
  for (const k of ['hazmat', 'tarp', 'temperature', 'pieces'] as const) {
    const f = p.fields.find((x) => x.key === k);
    if (f && accepted.has(k)) notes.push(`${f.label}: ${f.display}`);
  }
  if (notes.length) load.dispatchNotes = notes.join(' · ');

  if (Object.keys(refs).length) load.refs = refs;
  if (Object.keys(financials).length) load.financials = financials;

  /* the route name the spec asks for: {ROUTE}-{TRIP} {Origin}→{Dest} */
  const pu = p.stops.find((s) => s.type === 'pickup');
  const del = p.stops.find((s) => s.type === 'delivery');
  if (p.tripIds.length && accepted.has('routeNumber')) {
    const id = p.tripIds[0];
    const lane = pu?.city && del?.city ? ` ${pu.city}→${del.city}` : '';
    load.routeName = `${id.routeNumber}-${id.tripNumbers[0]}${lane}`;
    applied.push('Route name');
  } else if (pu?.city && del?.city) {
    load.routeName = `${pu.city}→${del.city}`;
    applied.push('Route name');
  }

  const stops: Partial<LoadStop>[] = p.stops
    .filter((s) => accepted.has(`stop.${s.type}`))
    .map((s) => ({
      type: s.type, address: s.address, city: s.city, state: s.state, zip: s.zip,
      dateTime: s.apptDate ? `${s.apptDate}T${s.apptWindowStart || '00:00'}` : '',
    }));

  return { load, stops, applied };
}
