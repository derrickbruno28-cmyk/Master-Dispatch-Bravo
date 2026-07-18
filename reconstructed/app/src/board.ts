/* Carrier loadboard: a sanitized, view-only mirror of open Sales Hub trips.
   Board docs contain ONLY carrier-safe fields — no load numbers, trip numbers,
   targets, or notes ever leave the back office. */
import { cleanTimes, finalDelTime } from './dates';
import { effectiveEquipment, autoTeamSolo, isExposed, laneMiles, shuttleLegExposed, type Lane, type Load } from './types';

export interface BoardDoc {
  id: string; // mirrors load id so updates/removals stay in lockstep
  date: string; // YYYY-MM-DD pickup date
  puTime: string;
  origin: string; // "Memphis, TN" — site names stripped
  destination: string;
  rate: string; // posted rate from Sales Hub
  teamSolo: string;
  equipment: string;
  commodity: string;
  shuttle: string; // §6.1: "meet & swap @ X" / "yard stage @ X" — '' when not a shuttle
  /** neutral sort hint: soft-booked loads sink below the open ones so a
      board snippet can include or crop them (never labeled for carriers) */
  sortLast?: boolean;
  /* §7.5 click-to-expand (curated, integrity-validated lane data only —
     never load #, trip #, internal notes, targets, or other carriers' rates) */
  stops: string; // full chain with arr/dep/final-del times
  milesLoaded: string;
  updatedAt: string;
}

/* Facility / site names that appear in lane labels but mean a city. */
const SITE_CITY: Record<string, string> = {
  'north texas': 'Coppell, TX',
  'satx': 'San Antonio, TX',
  'memphis rpdc': 'Memphis, TN',
  'memphis ndc': 'Memphis, TN',
  'memphis mpa': 'Memphis, TN',
  'dallas ndc': 'Dallas, TX',
};

const SITE_TOKENS = /\b(RPDC|NDC|MPA|PSA|LPC|STC|P&DC|ANNEX(?:\s+[A-Z])?|LOG|D2|DC|BEDLOAD|BED)\b/gi;

/** Learn city -> state from lanes that already carry ", ST" somewhere. */
export function buildCityStateMap(lanes: Lane[]): Map<string, string> {
  const map = new Map<string, string>();
  const re = /([A-Za-z .']{3,}?),?\s+([A-Z]{2})\b/g;
  for (const lane of lanes) {
    for (const text of [lane.origin, lane.destination, ...(lane.via ?? [])]) {
      let m;
      while ((m = re.exec(text ?? '')) !== null) {
        const city = m[1].trim().toLowerCase().replace(SITE_TOKENS, '').trim();
        if (city.length >= 3 && !map.has(city)) map.set(city, m[2]);
      }
    }
  }
  return map;
}

/** "Memphis RPDC" -> "Memphis, TN"; "Coppell TX" -> "Coppell, TX". */
export function publicCity(raw: string, cityState: Map<string, string>): string {
  let t = (raw ?? '').split('\n')[0].replace(/\(.*?\)/g, ' ').trim();
  const direct = SITE_CITY[t.toLowerCase()];
  if (direct) return direct;
  t = t.replace(SITE_TOKENS, ' ').replace(/\s{2,}/g, ' ').trim().replace(/[,\s]+$/, '');
  const m = /^(.*?),?\s+([A-Z]{2})$/.exec(t);
  if (m) return `${m[1].replace(/,+$/, '').trim()}, ${m[2]}`;
  const known = cityState.get(t.toLowerCase());
  if (known) return `${t}, ${known}`;
  return t;
}

/** Which loads belong on the carrier board: open (exposed / chargeback) trips
    that haven't been explicitly hidden by the team — plus shuttles whose
    DELIVERY leg needs coverage (those post from the swap point). */
export function boardVisible(load: Load): boolean {
  if (load.hideFromBoard) return false;
  if (isExposed(load)) return true;
  /* soft-booked loads stay ADVERTISED (Caleb 07/14): booked high, still
     shopping — carriers see a perfectly normal load (no soft-book hint) */
  if (load.softBook && !!load.carrier && !['not_running', 'omitted', 'departed'].includes(load.status)) return true;
  return shuttleLegExposed(load) && load.status !== 'not_running' && load.status !== 'omitted';
}

export function buildBoardDoc(
  load: Load,
  lane: Lane,
  cityState: Map<string, string>,
): BoardDoc {
  const cleaned = cleanTimes(((lane.arrivalTime || lane.departureTime) ?? '').split('\n')[0]);
  const timeMatch = /\d{2}:\d{2}/.exec(cleaned);
  const puTime = cleaned.length <= 8 ? cleaned : (timeMatch ? timeMatch[0] : cleaned.slice(0, 8));
  const via = (lane.via ?? []).map((v) => publicCity(v, cityState));
  /* Leg-2-exposed shuttle: the carrier is being asked to run FROM the swap
     point — origin, PU time and rate all come from the swap fields. */
  const legTwo = shuttleLegExposed(load) && !isExposed(load) && !!load.shuttleCity;
  const origin = legTwo
    ? `${load.shuttleCity}${load.shuttleState ? `, ${load.shuttleState}` : ''}`
    : publicCity(lane.origin, cityState);
  const destination = [...via, publicCity(lane.destination, cityState)]
    .filter((c, i, a) => c && a.indexOf(c) === i && c !== origin)
    .join(' → ') || publicCity(lane.destination, cityState);
  const rate = (legTwo ? (load.shuttlePostedRate ?? '') : load.postedRate).trim();
  return {
    id: load.id,
    date: load.date,
    puTime: legTwo && load.shuttleSwapEta ? load.shuttleSwapEta : puTime, // 24h, local to the pickup location
    origin,
    destination,
    rate: rate && /^\d/.test(rate) ? `$${rate}` : rate,
    teamSolo: load.teamSolo || autoTeamSolo(lane),
    equipment: effectiveEquipment(load, lane),
    commodity: 'US MAIL',
    stops: legTwo
      ? [
          `${origin} — handoff at swap${load.shuttleSwapEta ? ` · ETA ${load.shuttleSwapEta}` : ''}`,
          `${publicCity(lane.destination, cityState)} — final del ${finalDelTime(lane.delTime ?? '') || '—'}`,
        ].join('  →  ')
      : [
          `${origin} — arr ${cleanTimes((lane.arrivalTime ?? '').split('\n')[0]) || '—'} · dep ${cleanTimes((lane.departureTime ?? '').split('\n')[0]) || '—'}`,
          ...via,
          `${publicCity(lane.destination, cityState)} — final del ${finalDelTime(lane.delTime ?? '') || '—'}`,
        ].join('  →  '),
    milesLoaded: String(laneMiles(lane) ?? ''),
    /* §6.1: carriers see the swap/stage context — never the rate math */
    shuttle: load.isShuttle
      ? `${load.shuttleType === 'yard_stage' ? 'yard stage' : load.shuttleType === 'repower' ? 'repower — take over mid-route' : 'meet & swap'}${load.shuttleLocation ? ` @ ${load.shuttleLocation}` : ''}`
      : '',
    sortLast: !!(load.softBook && load.carrier && !isExposed(load)),
    updatedAt: new Date().toISOString(),
  };
}
