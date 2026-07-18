/* Loadout Trailer Module (Caleb 07/15) — DERIVED, like Capacity and the
   Action Center: the Matrix is the system of record and the only new datum
   is the trailer #. A "journey" is the chain of PO loads sharing
   trailer # + carrier, ordered by date; the OPEN obligation is the last
   link. The free window (3/5 calendar days by PO equipment, override for
   approved extensions) starts at UNLOAD — deliveredAt when T&T marked it,
   else the scheduled delivery day. LIVE loads never count (a PO that falls
   out and rebooks live drops off the tracker by definition). */
import { addDays, todayCentral } from './dates';
import {
  effectiveEquipment, normalizeCarrierName,
  type Lane, type Load,
} from './types';

/* Tiered late fine (Caleb 07/17, from the Loadout Trailer Dashboard V3
   formula): the first `tierDays` overdue days bill at tier1PerDay, every day
   beyond at tier2PerDay — fine(d) = min(3,d)×$50 + max(0,d−3)×$300. The old
   flat finePerDay ($100 placeholder) is retired; a legacy settings doc that
   still carries it merges harmlessly over these defaults. */
export interface TrailerExemption {
  carrier: string;
  dest: string;
}
export interface TrailerSettings {
  tierDays: number;
  tier1PerDay: number;
  tier2PerDay: number;
  /* Exemption list (Caleb 07/17, seeded from the Loadout Dashboard sheet):
     carrier + destination pairings that never accrue fines (still tracked).
     Load.trailerFineOverride charges a single trailer anyway. */
  exemptions: TrailerExemption[];
}
export const DEFAULT_TRAILER_SETTINGS: TrailerSettings = {
  tierDays: 3,
  tier1PerDay: 50,
  tier2PerDay: 300,
  exemptions: [
    { carrier: 'Ocean Freight', dest: 'Jacksonville' },
    { carrier: 'Ocean Star', dest: 'West Palm Beach' },
    { carrier: 'Ocean Star', dest: 'Opa Locka' },
    { carrier: 'Ocean Star', dest: 'Miami' },
    { carrier: 'ABA Carriers', dest: 'Gastonia' },
    { carrier: 'ABA Carriers', dest: 'Opa Locka' },
    { carrier: 'Dinkins', dest: 'Miami' },
    { carrier: 'Coach Freight', dest: 'Jacksonville' },
    { carrier: 'First Geer', dest: 'Columbia SC' },
    { carrier: 'First Geer', dest: 'Tampa' },
    { carrier: 'WRNR', dest: 'Opa Locka' },
    { carrier: 'MMH', dest: 'Opa Locka' },
  ],
};

/** Token-AND destination match ("Gastonia NC" hits "Gastonia, NC"); carrier
    matches on normalized substring ("Ocean Star" hits "OCEAN STAR TRANSPORTATION"). */
export function isExemptLink(load: Load, lane: Lane, settings: TrailerSettings): boolean {
  if (load.trailerFineOverride) return false;
  const carrierKey = normalizeCarrierName(load.carrier);
  const destText = (lane.destination ?? '').toLowerCase();
  return (settings.exemptions ?? []).some((e) => {
    const c = normalizeCarrierName(e.carrier);
    const toks = e.dest.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return !!c && toks.length > 0 && carrierKey.includes(c) && toks.every((t) => destText.includes(t));
  });
}

export function fineFor(lateDays: number, s: TrailerSettings): number {
  const t = Math.max(0, s.tierDays);
  return Math.min(t, Math.max(0, lateDays)) * s.tier1PerDay + Math.max(0, lateDays - t) * s.tier2PerDay;
}

export interface TrailerLink {
  load: Load;
  lane: Lane;
  trailer: string;
  carrier: string;
  originSite: string; // raw facility label (pickup origin)
  returnSite: string; // approved override ?? origin
  unloadDate: string; // YYYY-MM-DD — deliveredAt (Central) or scheduled del day
  unloadIsActual: boolean; // true when T&T marked delivered
  freeDays: number; // 3/5 from PO equipment, or the approved override
  returnEta: string; // unloadDate + freeDays
  daysLeft: number; // negative = late
  lateDays: number;
  exempt: boolean; // exemption-list pairing (unless overridden)
  fineAccrued: number; // tiered total for lateDays (0 when exempt)
  fineBilled: number; // portion already charged in weekly billing runs
  fine: number; // OUTSTANDING = accrued − billed — what the weekly run charges
  returned: boolean;
  rolled: boolean; // a LATER chain link exists — obligation closed by relink
}

const PO_RE = /POWER ONLY/i;

export function isPoLoad(load: Load, lane: Lane): boolean {
  return PO_RE.test(effectiveEquipment(load, lane))
    && !['not_running', 'omitted'].includes(load.status);
}

function scheduledUnload(load: Load, lane: Lane): string {
  /* same next-day rule as capacity inference: "next day" delivery blobs
     unload the day after pickup */
  return /next\s*day/i.test(lane.delTime ?? '') ? addDays(load.date, 1) : load.date;
}

export function baseFreeDays(load: Load, lane: Lane): number {
  return /5\s*DAYS/i.test(effectiveEquipment(load, lane)) ? 5 : 3;
}

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export function buildTrailerLinks(
  loads: Load[],
  lanes: Lane[],
  settings: TrailerSettings,
): TrailerLink[] {
  const laneMap = new Map(lanes.map((l) => [l.id, l]));
  const today = todayCentral();

  const tagged = loads
    .map((load) => ({ load, lane: laneMap.get(load.laneId) }))
    .filter((x): x is { load: Load; lane: Lane } =>
      !!x.lane && !x.lane.isGroupHeader && !!(x.load.trailerNumber ?? '').trim() && isPoLoad(x.load, x.lane));

  /* chain key: trailer # + carrier (normalized) */
  const chains = new Map<string, Array<{ load: Load; lane: Lane }>>();
  for (const t of tagged) {
    const key = `${t.load.trailerNumber!.trim().toUpperCase()}|${normalizeCarrierName(t.load.carrier)}`;
    const arr = chains.get(key) ?? [];
    arr.push(t);
    chains.set(key, arr);
  }

  const links: TrailerLink[] = [];
  for (const chain of chains.values()) {
    chain.sort((a, b) => a.load.date.localeCompare(b.load.date));
    chain.forEach(({ load, lane }, i) => {
      const rolled = i < chain.length - 1; // a later link restarted the clock
      const returned = !!load.trailerReturnedAt;
      const unloadIsActual = !!load.deliveredAt;
      const unloadDate = unloadIsActual
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(load.deliveredAt!))
        : scheduledUnload(load, lane);
      const freeDays = load.trailerFreeDays ?? baseFreeDays(load, lane);
      const returnEta = addDays(unloadDate, freeDays);
      /* the clock freezes at return/roll; otherwise it runs against today */
      const asOf = returned
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(load.trailerReturnedAt!))
        : today;
      const daysLeft = dayDiff(returnEta, asOf);
      const lateDays = rolled && !returned ? 0 : Math.max(0, -daysLeft);
      const exempt = isExemptLink(load, lane, settings);
      const fineAccrued = exempt ? 0 : fineFor(lateDays, settings);
      const fineBilled = Math.min(fineAccrued, exempt ? 0 : fineFor(Math.max(0, load.trailerBilledDays ?? 0), settings));
      links.push({
        load,
        lane,
        trailer: load.trailerNumber!.trim().toUpperCase(),
        carrier: load.carrier,
        originSite: (lane.origin ?? '').split('\n')[0].trim(),
        returnSite: (load.trailerReturnSite ?? '').trim() || (lane.origin ?? '').split('\n')[0].trim(),
        unloadDate,
        unloadIsActual,
        freeDays,
        returnEta,
        daysLeft,
        lateDays,
        exempt,
        fineAccrued,
        fineBilled,
        fine: Math.max(0, fineAccrued - fineBilled),
        returned,
        rolled,
      });
    });
  }
  return links.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Open obligations only — the working dashboard list. */
export function openTrailerLinks(links: TrailerLink[]): TrailerLink[] {
  return links.filter((l) => !l.returned && !l.rolled);
}

/** Net drift per site (Caleb: trend-watching, NOT absolute inventory):
    every closed-or-open link whose return site differs from its origin moves
    one trailer out of the origin and into the return site. Self-heals when a
    later approval flows the other way. */
export function siteDrift(links: TrailerLink[]): Array<{ site: string; net: number }> {
  const net = new Map<string, number>();
  for (const l of links) {
    if (l.returnSite.toLowerCase() === l.originSite.toLowerCase()) continue;
    net.set(l.originSite, (net.get(l.originSite) ?? 0) - 1);
    net.set(l.returnSite, (net.get(l.returnSite) ?? 0) + 1);
  }
  return [...net.entries()]
    .filter(([, n]) => n !== 0)
    .map(([site, n]) => ({ site, net: n }))
    .sort((a, b) => a.net - b.net);
}

/** A carrier's OPEN trailers — the LoadEditor dropdown when booking the next
    load ("which of Eliana's trailers is this?"). */
export function openTrailersForCarrier(links: TrailerLink[], carrier: string): TrailerLink[] {
  const key = normalizeCarrierName(carrier);
  return openTrailerLinks(links).filter((l) => normalizeCarrierName(l.carrier) === key);
}
