/* §8.1 profitability / margin engine — the Daily Margin Report workbook
   rebuilt live from booked-load data.

   Revenue = Line Haul (TRM currentRate, integrity DB) + FSC/mi × miles.
   Cost    = brokered → carrier rate (first $ in rate/notes)
           = asset    → (Fuel CPM + Driver CPM) × miles, driver keyed off
             Solo/Team (§6.5 designation; manual override wins).
   Margin$ = Revenue − Cost − applicable chargebacks (amounts logged in §7.2;
             subtracted until a chargeback reaches 'recovered').
   Loads on lanes with NO TRM rate are EXCLUDED and flagged (Caleb-confirmed —
   no fake numbers; fix by updating TRM on the Integrity page). */
import { integrityIdForTripCode, type IntegrityRecord } from './pricing';
import {
  GH_CARRIER_RE,
  autoTeamSolo,
  firstMoney,
  laneMiles,
  loadRate,
  type Lane,
  type Load,
} from './types';

export interface MarginSettings {
  fuelCpm: number; // $/mi — "edit daily" in the old sheet
  fscPerMile: number; // company-average $/mi — updated weekly
  driverCpmTeam: number;
  driverCpmSolo: number;
  breakevenPct: number; // 0.0975 — below flags UNDER
  companyName: string; // PDF header
  repGoalDefault: number; // §8.2 daily booked-loads goal before FedCom sets one
}

export const DEFAULT_MARGIN_SETTINGS: MarginSettings = {
  fuelCpm: 0.75,
  fscPerMile: 0.75,
  driverCpmTeam: 0.8,
  driverCpmSolo: 0.65,
  breakevenPct: 0.0975,
  companyName: 'GH Logistics LLC',
  repGoalDefault: 5,
};

export type MarginState = 'open' | 'on_target' | 'under' | 'no_trm';

export interface LoadMargin {
  load: Load;
  lane: Lane;
  miles: number | null;
  lineHaul: number | null;
  revenue: number;
  isAsset: boolean;
  cost: number;
  chargeback: number;
  marginD: number;
  marginPct: number | null;
  state: MarginState;
  rep: string;
}

export function computeLoadMargin(
  load: Load,
  lane: Lane,
  rec: IntegrityRecord | undefined,
  s: MarginSettings,
): LoadMargin {
  const miles = laneMiles(lane);
  const lineHaul = rec?.trm?.currentRate ?? null;
  const isAsset = GH_CARRIER_RE.test(load.carrier);
  const booked = !!load.carrier && load.status !== 'not_running' && load.status !== 'chargeback';
  const rep = load.bookedBy || '';

  if (lineHaul == null) {
    return { load, lane, miles, lineHaul, revenue: 0, isAsset, cost: 0, chargeback: 0, marginD: 0, marginPct: null, state: 'no_trm', rep };
  }
  const revenue = lineHaul + (miles != null ? s.fscPerMile * miles : 0);
  let cost = 0;
  if (booked) {
    if (isAsset) {
      const driverCpm = (load.teamSolo || autoTeamSolo(lane)) === 'SOLO' ? s.driverCpmSolo : s.driverCpmTeam;
      cost = miles != null ? (s.fuelCpm + driverCpm) * miles : 0;
    } else {
      cost = loadRate(load) ?? 0;
    }
  }
  /* §7 chargebacks reduce margin until recovered */
  const chargeback =
    load.chargebackAmount && load.chargebackStatus !== 'recovered'
      ? firstMoney(load.chargebackAmount) ?? 0
      : 0;
  const marginD = revenue - cost - chargeback;
  const marginPct = revenue > 0 ? marginD / revenue : null;
  const state: MarginState = !booked
    ? 'open'
    : marginPct != null && marginPct < s.breakevenPct
      ? 'under'
      : 'on_target';
  return { load, lane, miles, lineHaul, revenue, isAsset, cost, chargeback, marginD, marginPct, state, rep };
}

export interface DayRollup {
  loads: number;
  booked: number;
  open: number;
  revenue: number;
  cost: number;
  marginD: number;
  marginPct: number | null;
  under: number;
  noTrm: number;
}

export function rollup(rows: LoadMargin[]): DayRollup {
  const inMath = rows.filter((r) => r.state !== 'no_trm');
  const revenue = inMath.reduce((n, r) => n + r.revenue, 0);
  const cost = inMath.reduce((n, r) => n + r.cost + r.chargeback, 0);
  return {
    loads: rows.length,
    booked: rows.filter((r) => r.state === 'on_target' || r.state === 'under').length,
    open: rows.filter((r) => r.state === 'open').length,
    revenue,
    cost,
    marginD: revenue - cost,
    marginPct: revenue > 0 ? (revenue - cost) / revenue : null,
    under: rows.filter((r) => r.state === 'under').length,
    noTrm: rows.filter((r) => r.state === 'no_trm').length,
  };
}

export function marginRowsFor(
  loads: Load[],
  lanes: Lane[],
  integrity: IntegrityRecord[],
  settings: MarginSettings,
  dates: string[],
): LoadMargin[] {
  const laneMap = new Map(lanes.map((l) => [l.id, l]));
  const recById = new Map(integrity.map((r) => [r.id, r]));
  const out: LoadMargin[] = [];
  for (const load of loads) {
    if (!dates.includes(load.date)) continue;
    const lane = laneMap.get(load.laneId);
    if (!lane || lane.isGroupHeader) continue;
    const rec = recById.get(integrityIdForTripCode(lane.tripCode) ?? '');
    out.push(computeLoadMargin(load, lane, rec, settings));
  }
  return out;
}

/** Monday-anchored week (the report's convention), YYYY-MM-DD ×7. */
export function marginWeekOf(dateIso: string): string[] {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const monOffset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - monOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}
