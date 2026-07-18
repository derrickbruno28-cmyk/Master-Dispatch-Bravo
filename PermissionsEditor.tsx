/* §6.4 empty-truck inference — trucks going empty, where, and at what
   SCHEDULED time, derived from Matrix load completions (assets AND external
   carriers; no Samsara/ETA — this is load coordination, not tracking).
   The production list is materialized to capacity/current by a Cloud Function
   at 08:00 Central; this module is the same inference for demo mode and for
   client-side pairing math. Keep functions/src/index.ts's port in sync. */
import { addDays, centralDateOf, finalDelTime, todayCentral } from './dates';
import { GH_CARRIER_RE, type CapacityEntry, type Lane, type Load } from './types';

export function inferEmpties(loads: Load[], lanes: Lane[]): CapacityEntry[] {
  const laneMap = new Map(lanes.map((l) => [l.id, l]));
  const today = todayCentral();
  const yesterday = addDays(today, -1);
  const entries: CapacityEntry[] = [];
  for (const load of loads) {
    if (!load.carrier || load.status === 'not_running') continue;
    if (load.date !== today && load.date !== yesterday) continue;
    const lane = laneMap.get(load.laneId);
    if (!lane || lane.isGroupHeader) continue;
    const del = finalDelTime(lane.delTime ?? '');
    const time = /^\d{2}:\d{2}$/.test(del) ? del : '23:59';
    /* delivery blobs marked "next day" empty the truck the day after pickup */
    const emptyDate = /next\s*day/i.test(lane.delTime ?? '') ? addDays(load.date, 1) : load.date;
    const isAsset = GH_CARRIER_RE.test(load.carrier);
    entries.push({
      unit: isAsset ? (load.truckNumber ? `GH #${load.truckNumber}` : 'GH asset') : load.carrier,
      carrier: load.carrier,
      isAsset,
      emptyAt: `${emptyDate}T${time}`,
      cityRaw: lane.destination || '',
      laneLabel: `${lane.origin} → ${lane.destination}`,
      fromLoadId: load.id,
      loadNumber: load.loadNumber || '',
    });
  }
  return entries.sort((a, b) => a.emptyAt.localeCompare(b.emptyAt));
}

/** Entries still useful for planning as of now-ish: from 4h ago onward. */
export function stillRelevant(entries: CapacityEntry[], nowIso: string): CapacityEntry[] {
  const cutoff = `${centralDateOf(nowIso)}T00:00`;
  return entries.filter((e) => e.emptyAt >= cutoff);
}
