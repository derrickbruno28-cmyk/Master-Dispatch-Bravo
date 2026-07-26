/* Applying a Load Repository trip to a load — PHASE 3.

   HARD RULE: never silently write parsed or inferred data. Everything here is
   split in two — `proposeTrip` computes what WOULD change and `applyTrip` writes
   only what the reviewer ticked. The Stops tab renders the middle step.

   The safety property that matters: a field the load already holds a DIFFERENT
   value for is a CONFLICT, and conflicts default to NOT applying. Blank fields
   default to applying, because filling a blank isn't destructive. So the common
   case (fresh load, pick a trip, everything fills) is one click, and the
   dangerous case (a load somebody already typed into) requires you to look at
   each overwrite and say yes. */

import type { AssetRoute } from '../fleet';
import type { Load } from '../loadsStore';
import { saveLoad } from '../loadsStore';
import { saveStops, storedStops, syntheticStops, blankStop } from './stopsStore';
import { writeAudit, actorEmail } from './stamp';
import { planFromRoute, fieldDiff, stopActionHint, type TripPlan, type PlanField } from './repository';
import type { LoadStopDoc } from './types';

export interface TripProposal {
  plan: TripPlan;
  /* load-header fields the trip would set */
  fields: PlanField[];
  /* the stop list the trip implies, already merged over what's there */
  stops: LoadStopDoc[];
  stopNotes: string[];
  warnings: string[];
}

const cityState = (s: string): { city: string; state: string } => {
  /* "Coppell, TX" → city Coppell, state TX. Rows without a comma keep the whole
     token as the city rather than guessing where the state starts. */
  const m = (s || '').match(/^(.*?),\s*([A-Za-z]{2})\b/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : { city: (s || '').trim(), state: '' };
};

/* Add a day offset to a YYYY-MM-DD without tripping over month ends or DST —
   the whole app does date math on UTC-anchored strings for exactly this reason. */
function addDays(date: string, days: number): string {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* Build the proposal. `baseDate` is the load's board date — the pickup day —
   and delivery days come off it via each delivery's Same Day / Next Day marker. */
export function proposeTrip(load: Load, row: AssetRoute): TripProposal {
  const plan = planFromRoute(row);
  const warnings = [...plan.warnings];
  const stopNotes: string[] = [];

  const t = load as unknown as { routeNumber?: string; tripNumbers?: string[] };

  const fields = [
    fieldDiff('Route name', 'routeName', load.routeName, plan.routeName),
    fieldDiff('Route number', 'routeNumber', t.routeNumber, plan.routeNumber),
    fieldDiff('Trip number(s)', 'tripNumbers', (t.tripNumbers ?? []).join(', '), plan.tripNumbers.join(', ')),
    fieldDiff('Planned miles', 'laneMiles', load.laneMiles, plan.miles),
    /* the midpoint of the published range — a starting number, not a quote */
    fieldDiff('Rate (range midpoint)', 'rate', load.rate, plan.rateMid),
    fieldDiff('USPS contract', 'uspsContract', String(!!load.uspsContract), plan.routeNumber ? 'true' : ''),
  ].filter((f): f is PlanField => f != null);

  if (plan.rateMid != null) {
    stopNotes.push(`Rate pre-filled at the midpoint of ${plan.rateLow != null ? `$${plan.rateLow.toLocaleString()}` : '?'}–${plan.rateHigh != null ? `$${plan.rateHigh.toLocaleString()}` : '?'} — negotiate from it, it isn't a quote.`);
  }
  if (plan.bufferHours != null) {
    stopNotes.push(`The repository lists a ${plan.bufferHours}hr buffer on this lane; it's shown here but not written to any appointment.`);
  }

  /* ---- the stop list ---- */
  const existing = storedStops(load.id).length ? storedStops(load.id) : syntheticStops(load);
  const baseDate = load.date || '';
  const out: LoadStopDoc[] = [];

  const put = (i: number, patch: Partial<LoadStopDoc>): LoadStopDoc => {
    const prior = existing[i];
    const base = prior ?? blankStop(i + 1, patch.type ?? 'Delivery');
    return {
      ...base,
      ...patch,
      id: base.id,                       // ids stay put so milestones don't orphan
      seq: i + 1,
      location: { ...base.location, ...(patch.location ?? {}) },
      refs: { ...base.refs, ...(patch.refs ?? {}) },
      splitLoad: { ...base.splitLoad, ...(patch.splitLoad ?? {}) },
    };
  };

  if (plan.origin) {
    const cs = cityState(plan.origin);
    out.push(put(0, {
      type: 'Pickup',
      stopAction: stopActionHint(plan.planning, 'Pickup'),
      location: { ...cs } as LoadStopDoc['location'],
      apptDate: baseDate,
      apptWindowStart: plan.pickup?.time || '',
      /* the DEPARTURE time closes the pickup window: the truck is expected on
         site from the PU time until it rolls, which is exactly the span At Risk
         should be measured against */
      apptWindowEnd: plan.departure?.time || '',
    }));
  }

  plan.deliveries.forEach((city, i) => {
    const cs = cityState(city);
    const dt = plan.deliveryTimes[i];
    out.push(put(out.length, {
      type: 'Delivery',
      stopAction: stopActionHint(plan.planning, 'Delivery'),
      location: { ...cs } as LoadStopDoc['location'],
      apptDate: dt ? addDays(baseDate, dt.dayOffset) : baseDate,
      apptWindowStart: dt?.time || '',
      apptWindowEnd: '',
    }));
  });

  /* stops the trip doesn't describe are KEPT, not dropped — a load may carry a
     yard stop or an extra drop that the repository row knows nothing about */
  if (existing.length > out.length) {
    for (let i = out.length; i < existing.length; i++) out.push({ ...existing[i], seq: i + 1 });
    stopNotes.push(`${existing.length - plan.deliveries.length - 1} extra stop(s) already on this load were kept — the trip doesn't describe them.`);
  }

  if (!baseDate) warnings.push('This load has no board date yet, so appointment dates are blank. Set the route date on Load Info and re-apply.');

  return { plan, fields, stops: out, stopNotes, warnings };
}

/* "Create load from this trip" — build an UNSAVED load in memory.

   Deliberately writes nothing: the Load Repository row opens the normal new-load
   card pre-filled, and the load exists only once the user saves it. That keeps
   one creation path instead of a second one that writes behind the modal, and it
   means backing out of the card leaves no orphan.

   Stops go into the LEGACY stops[] array here rather than the subcollection,
   because a load with no id yet has nowhere to hang a subcollection — the
   subcollection version is written by the Stops tab afterwards. */
export function seedLoadFromTrip(base: Load, row: AssetRoute): Load {
  const p = proposeTrip(base, row);
  const plan = p.plan;

  const legacyStops = p.stops.map((s, i) => ({
    type: (s.type === 'Pickup' ? 'pickup' : 'delivery') as 'pickup' | 'delivery',
    sequence: i + 1,
    address: s.location.address1 || '',
    city: s.location.city || '',
    state: s.location.state || '',
    zip: s.location.zip || '',
    dateTime: s.apptDate && s.apptWindowStart ? `${s.apptDate}T${s.apptWindowStart}` : '',
    poNumber: '', refNo: '', notes: '',
  }));

  return {
    ...base,
    routeName: plan.routeName || base.routeName,
    laneMiles: plan.miles ?? base.laneMiles,
    rate: plan.rateMid ?? base.rate,
    uspsContract: !!plan.routeNumber || base.uspsContract,
    stops: legacyStops.length ? legacyStops : base.stops,
    ...( { routeNumber: plan.routeNumber, tripNumbers: plan.tripNumbers } as Partial<Load> ),
  };
}

/* Write the ticked fields and (optionally) the stops. Returns what changed so
   the caller can say so out loud rather than silently succeeding. */
export async function applyTrip(
  load: Load,
  proposal: TripProposal,
  opts: { applyStops: boolean },
): Promise<{ load: Load; appliedFields: string[]; stops: number }> {
  const applied = proposal.fields.filter((f) => f.apply);

  const patch: Record<string, unknown> = {};
  for (const f of applied) {
    switch (f.field) {
      case 'routeName': patch.routeName = proposal.plan.routeName; break;
      case 'routeNumber': patch.routeNumber = proposal.plan.routeNumber; break;
      case 'tripNumbers': patch.tripNumbers = proposal.plan.tripNumbers; break;
      case 'laneMiles': patch.laneMiles = proposal.plan.miles; break;
      case 'rate': patch.rate = proposal.plan.rateMid; break;
      case 'uspsContract': patch.uspsContract = true; break;
      default: break;
    }
  }

  const nextLoad = Object.keys(patch).length
    ? await saveLoad({ ...load, ...(patch as Partial<Load>) })
    : load;

  let stopCount = 0;
  if (opts.applyStops && proposal.stops.length) {
    const saved = await saveStops(load.id, proposal.stops);
    stopCount = saved.length;
  }

  writeAudit(load.id, {
    action: 'repository.applyTrip',
    target: `loads/${load.id}`,
    summary: `trip ${proposal.plan.tripCode || '(no code)'} applied by ${actorEmail()} — ${applied.length} field(s)${opts.applyStops ? ` + ${stopCount} stops` : ', stops not applied'}`,
    before: null,
    after: { tripCode: proposal.plan.tripCode, fields: applied.map((f) => f.field) },
  });

  return { load: nextLoad, appliedFields: applied.map((f) => f.label), stops: stopCount };
}
