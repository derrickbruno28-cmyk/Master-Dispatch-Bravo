/* Action Center (Caleb 07/09): role-aware data-health checks DERIVED live
   from store data — no collection, no manual curation, items vanish when the
   underlying data is fixed. Everyone sees ONLY what they can act on.
   Scoping decisions (Caleb): carrier MC/DOT hygiene = BROKER scope (not
   FedCom); GH truck-# gaps + "Need to Send Flyer" = ASSET scope (rep +
   asset admin); T&T overdue and QA BOL live with bookers/QA until the
   dedicated Track-and-Trace / QA roles exist. Lane checks: ACTIVE lanes only. */
import { addDays, todayCentral } from './dates';
import { trmIsStale, integrityIdForTripCode, type IntegrityRecord, type TrmMeta } from './pricing';
import {
  canAdmin, canBook, canEditLaneData, canEditLanes, canQaApprove, isAssetRep, laneMiles,
  GH_CARRIER_RE,
  type AppUser, type Carrier, type CarrierUser, type Lane, type Load,
} from './types';

export interface ActionItem {
  key: string;
  severity: 'red' | 'amber';
  count: number;
  text: string;
  to: string; // hash-router path the Fix→ link navigates to
}

export interface ActionCtx {
  user: AppUser;
  lanes: Lane[];
  loads: Load[];
  carriers: Carrier[];
  carrierUsers: CarrierUser[];
  users: AppUser[];
  integrity: IntegrityRecord[];
  trmMeta: TrmMeta | null;
}

export function buildActions(ctx: ActionCtx): ActionItem[] {
  const { user } = ctx;
  const items: ActionItem[] = [];
  const today = todayCentral();
  const tomorrow = addDays(today, 1);
  const recent = addDays(today, -2); // working window for load-level checks
  const activeLanes = ctx.lanes.filter((l) => l.active && !l.isGroupHeader);
  const recByTrip = new Map(ctx.integrity.map((r) => [r.id, r]));
  const recFor = (lane: Lane) => {
    const id = integrityIdForTripCode(lane.tripCode);
    return id ? recByTrip.get(id) : undefined;
  };
  const workingLoads = ctx.loads.filter(
    (l) => l.date >= recent && l.date <= tomorrow && !['not_running', 'omitted'].includes(l.status),
  );
  const push = (key: string, severity: 'red' | 'amber', count: number, text: string, to: string) => {
    if (count > 0) items.push({ key, severity, count, text, to });
  };

  /* ---- pricing tier: bands + lane data quality ---- */
  if (canEditLanes(user.role)) {
    const noBands = activeLanes.filter((l) => {
      const r = recFor(l);
      return !r || r.bands?.weekday?.target == null || r.bands?.weekend?.target == null;
    });
    push('bands', 'red', noBands.length, 'active lanes missing a Target/Ceiling band (weekday or weekend)', '/integrity');
    push('miles', 'amber', activeLanes.filter((l) => laneMiles(l) == null).length,
      'lanes missing loaded miles — margin math and auto SOLO/TEAM are blind there', '/integrity');
    push('times', 'amber',
      activeLanes.filter((l) => !(l.arrivalTime || l.departureTime) || !l.delTime).length,
      'lanes missing arrival/departure or final-del times — conflict checks and T&T ordering degrade', '/integrity');
    if (trmIsStale(ctx.trmMeta)) push('trm-stale', 'amber', 1, 'TRM upload is stale (over 7 days old)', '/integrity');
  }

  /* ---- lane-data editors (pricing + FedCom admins): TRM + loading defaults ---- */
  if (canEditLaneData(user)) {
    push('trm-missing', 'red',
      activeLanes.filter((l) => (recFor(l)?.trm?.currentRate ?? null) == null).length,
      'active lanes with no TRM revenue rate — excluded from every margin report', '/integrity');
    push('loading', 'amber', activeLanes.filter((l) => !l.defaultEquipment).length,
      'lanes with no default loading option (Live / 3-day / 5-day)', '/integrity');
  }

  /* ---- brokers: money data + fallout recovery + carrier DB hygiene ---- */
  if (canBook(user.role)) {
    push('rate-missing', 'red',
      workingLoads.filter((l) => !!l.carrier && !GH_CARRIER_RE.test(l.carrier) && !(l.rate ?? '').trim()).length,
      'booked outside-carrier loads missing the agreed rate — margin can’t compute', '/matrix');
    push('fallout', 'red', ctx.loads.filter((l) => l.status === 'chargeback' && l.date >= recent).length,
      'chargeback fallouts still needing recovery coverage', '/saleshub');
    push('carrier-db', 'amber',
      ctx.carriers.filter((c) => !(c.mcNumber ?? '').trim() || !(c.dot ?? '').trim()).length,
      'carriers missing an MC or DOT number in the database', '/integrity?tab=carriers');
    /* T&T overdue: parked with bookers until the Track-and-Trace role exists.
       Same rule as the nav badge — yesterday's confirmed trips still not
       departed are unambiguously overdue (today's page adds finer ⏰ flags). */
    const confirmed = new Set(['covered', 'booked_rc_pending', 'rc_signed', 'gtg', 'need_flyer', 'flyer_sent', 'drivers_confirmed', 'dispatched', 'asset']);
    push('track', 'red',
      ctx.loads.filter((l) => !!l.carrier && confirmed.has(l.status) && l.date === addDays(today, -1)).length,
      'confirmed trips from yesterday not marked Loaded/Departed', '/track');
  }

  /* ---- asset team (rep + asset admin): trucks + flyers ---- */
  if (isAssetRep(user.role) || user.role === 'asset_admin' || user.role === 'owner') {
    push('truck', 'red',
      workingLoads.filter((l) => GH_CARRIER_RE.test(l.carrier) && !(l.truckNumber ?? '').trim()).length,
      'GH loads missing a truck # — the double-book guard can’t protect them', '/matrix');
    push('flyer', 'red', workingLoads.filter((l) => l.status === 'need_flyer').length,
      'asset loads marked "Need to Send Flyer"', '/matrix');
  }

  /* ---- admins: the pending queue (same items as the Admin bubble) ---- */
  if (canAdmin(user.role)) {
    push('regs', 'red', ctx.carrierUsers.filter((c) => c.status === 'pending').length,
      'carrier registrations awaiting verification', '/admin');
    push('base', 'amber', ctx.users.filter((u) => u.role === 'base').length,
      'new sign-ins awaiting clearance (Base)', '/admin');
    push('cb-decide', 'red',
      ctx.loads.filter((l) => l.chargebackClass === 'once_recovered' && (l.chargebackStatus ?? 'pending') === 'pending').length,
      'chargebacks awaiting the absorb decision', '/admin');
  }

  /* ---- QA (until the dedicated QA role rework) ---- */
  if (canQaApprove(user.role)) {
    const qaCutoff = addDays(today, -7);
    push('qa', 'red',
      ctx.loads.filter((l) => !!l.carrier && !l.bolVerified && l.date >= qaCutoff
        && !['not_running', 'omitted', 'chargeback'].includes(l.status)).length,
      'departed loads awaiting BOL verification', '/qa');
  }

  return items.sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === 'red' ? -1 : 1));
}
