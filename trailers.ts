/* Phase 3 rate engine — §3.1 band classifier + §3.2 integrity DB types.
   See docs/phase3-pricing-console-consolidation.md for the decisions behind this. */
import { addDays, weekdayOf, todayCentral } from './dates';
import { isHoliday, type Lane, type Load } from './types';

export interface Band {
  target: number | null;
  ceiling: number | null;
}

/** Integrity DB record — the single source of truth for lane rate data.
    Cost side (bands) is tuned by the pricing tier; revenue side (trm) is
    synced from the weekly Master TRM upload and never touches the bands. */
export interface IntegrityRecord {
  id: string; // `${contract}_${tripNumber}`, e.g. "FA2D3_325"
  contract: string; // top-level dimension: FA2D3, 7523D, future HCRs
  tripNumber: string;
  tripCode: string; // "FA2D3-325" — joins to Lane.tripCode
  odLabel: string;
  bands: { weekday: Band; weekend: Band };
  loadType?: string; // Preload | Live (Console heritage)
  loadTypeOverride?: string;
  segment?: string; // Dedicated | Auction | Edge
  trm?: {
    currentRate?: number | null;
    currentEff?: string;
    currentExp?: string;
    pendingRate?: number | null;
    pendingEff?: string;
    pendingExp?: string;
    miles?: number | null;
    hours?: number | null;
    freqCode?: string;
    annualDays?: number | null;
    originNass?: string;
    destNass?: string;
  };
  updatedAt?: string;
  updatedBy?: string;
}

export interface BandHistoryEntry {
  dayType: 'weekday' | 'weekend';
  target: number | null;
  ceiling: number | null;
  reasonCode: string;
  setBy: string;
  at: string;
}

export interface TrmMeta {
  filename: string;
  importedAt: string;
  importedBy: string;
}

/* Reason codes adopted verbatim from the Pricing Console (371 history rows use them). */
export const REASON_CODES = [
  { code: 'CHOP-SOFT', label: 'Chop — soft lane (booking ≤ target)' },
  { code: 'CHOP-LIVE', label: 'Chop — live coverage easy' },
  { code: 'CHOP-MKT', label: 'Chop — market moved down' },
  { code: 'HOLD-OK', label: 'Hold — pricing healthy' },
  { code: 'HOLD-TIGHT', label: 'Hold — tight capacity, do not chop' },
  { code: 'RAISE-CAP', label: 'Raise — capacity constrained' },
  { code: 'WKND-TEST', label: 'Weekend premium test' },
] as const;

/* ---------- §3.1 band classifier (Caleb-resolved 2026-07-06) ----------
   weekday band = Mon–Thu.
   weekend band = Fri/Sat/Sun + ACTUAL-date federal holidays + the literal
   prior calendar day of each holiday.
   PLUS the Console's Live rule, scoped: a LIVE load on a lane that is NOT
   natively live prices off the weekend band on any day. Natively-live lanes
   already have their bands set on the live premise — normal calendar applies. */

export function isDayBeforeHoliday(dateIso: string): boolean {
  return isHoliday(addDays(dateIso, 1));
}

export function dateBand(dateIso: string): 'weekday' | 'weekend' {
  const dow = weekdayOf(dateIso); // 0=Sun .. 6=Sat
  if (dow === 0 || dow === 5 || dow === 6) return 'weekend'; // Fri/Sat/Sun
  if (isHoliday(dateIso) || isDayBeforeHoliday(dateIso)) return 'weekend';
  return 'weekday';
}

export function laneNativelyLive(lane: Lane): boolean {
  return /live/i.test(lane.planning ?? '') || /LIVE/i.test(lane.defaultEquipment ?? '');
}

export function loadRunsLive(load: Load, lane: Lane): boolean {
  return /live/i.test(load.equipment || lane.defaultEquipment || '');
}

/** Which band prices this load. */
export function bandFor(load: Load, lane: Lane): 'weekday' | 'weekend' {
  if (loadRunsLive(load, lane) && !laneNativelyLive(lane)) return 'weekend';
  return dateBand(load.date);
}

/** True when the Live rule (not the calendar) forced the weekend band. */
export function liveUpgraded(load: Load, lane: Lane): boolean {
  return loadRunsLive(load, lane) && !laneNativelyLive(lane) && dateBand(load.date) === 'weekday';
}

/* ---------- integrity helpers ---------- */

export function integrityIdForTripCode(tripCode: string): string | null {
  const m = /^([A-Z0-9]+)-([A-Za-z0-9]+)$/.exec(tripCode ?? '');
  return m ? `${m[1]}_${m[2]}` : null;
}

export function fmtBand(b?: Band): string {
  if (!b || (b.target == null && b.ceiling == null)) return '—';
  const f = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString()}`);
  return `${f(b.target)} – ${f(b.ceiling)}`;
}

/** TRM staleness: expected refresh every Monday; stale when > 7 days old. */
export function trmIsStale(meta: TrmMeta | null): boolean {
  if (!meta?.importedAt) return true;
  const ageDays =
    (Date.parse(`${todayCentral()}T00:00:00Z`) - Date.parse(meta.importedAt)) / 86_400_000;
  return ageDays > 7;
}

/* ---------- demo-mode derivation ----------
   Parse the legacy "(WE) $600 - $900" style lane strings into bands so the
   Integrity page and auto-set work on bundled seed data. */
export function parseBandString(s: string): Band {
  const nums = (s ?? '').match(/\d[\d,]*/g)?.map((n) => Number(n.replace(/,/g, ''))) ?? [];
  return { target: nums[0] ?? null, ceiling: nums[1] ?? nums[0] ?? null };
}

export function demoIntegrityFromLanes(lanes: Lane[]): IntegrityRecord[] {
  const out: IntegrityRecord[] = [];
  for (const lane of lanes) {
    if (lane.isGroupHeader) continue;
    const id = integrityIdForTripCode(lane.tripCode);
    if (!id) continue;
    const [contract, tripNumber] = id.split('_');
    out.push({
      id,
      contract,
      tripNumber,
      tripCode: lane.tripCode,
      odLabel: `${lane.origin} → ${lane.destination}`,
      bands: {
        weekday: parseBandString(lane.weekdayRate),
        weekend: parseBandString(lane.weekendRate),
      },
      loadType: laneNativelyLive(lane) ? 'Live' : 'Preload',
      /* demo-only TRM revenue so the §8.1 margin engine has line-haul data:
         ~15% above the weekday ceiling/target (prod uses the real Master). */
      trm: (() => {
        const base = parseBandString(lane.weekdayRate);
        const ref = base.ceiling ?? base.target;
        return ref != null ? { currentRate: Math.round(ref * 1.15) } : undefined;
      })(),
    });
  }
  return out;
}
