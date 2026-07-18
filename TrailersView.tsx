import { useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { useStore } from '../data/store';
import { buildCityStateMap, publicCity } from '../board';
import { todayCentral, addDays, fmtStamp, bookingWindow, centralDateOf, cleanTimes, hubLabel } from '../dates';
import { isExposed, laneCompactName, type CapacityEntry, type Load } from '../types';
import { can } from '../permissions';

/* §6.3/§6.4 — Capacity: trucks going empty (inferred from Matrix load
   completions, assets AND external carriers) and pairing recommendations for
   open loads. Scheduled times only — this is load coordination, not tracking;
   a Samsara ETA layer is parked in the backlog. The production list is a
   snapshot built at 08:00 Central by a Cloud Function (+ Rebuild-now). */

export default function CapacityView() {
  const { capacity, lanes, loads, currentUser, demoMode } = useStore();
  const [rebuildState, setRebuildState] = useState('');
  const cityState = useMemo(() => buildCityStateMap(lanes), [lanes]);
  const laneMap = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const windowDays = bookingWindow();

  /* 12-hour freshness rule (Caleb 07/10): a truck that went empty more than
     12h ago has moved on — drop it from the list AND the pairing pool. Times
     are Central-clock strings, so the cutoff is built the same way. */
  const nowCentral = `${todayCentral()}T${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date())}`;
  const cutoff12 = (() => {
    const [d, t] = nowCentral.split('T');
    const [h, m] = t.split(':').map(Number);
    return h >= 12 ? `${d}T${String(h - 12).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      : `${addDays(d, -1)}T${String(h + 12).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  })();
  const entries = (capacity?.entries ?? []).filter((e) => e.emptyAt >= cutoff12);
  const norm = (raw: string) => publicCity(raw, cityState).toLowerCase();

  /* §6.3 pairing: same city/state (normalized) AND scheduled-empty before the
     PU appointment. Two streams: GH assets and external network. */
  const openLoads = useMemo(
    () =>
      loads
        .filter((l) => windowDays.includes(l.date) && isExposed(l))
        .sort((a, b) => a.date.localeCompare(b.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loads],
  );

  function pairings(load: Load): { assets: CapacityEntry[]; external: CapacityEntry[] } {
    const lane = laneMap.get(load.laneId);
    if (!lane) return { assets: [], external: [] };
    const origin = norm(lane.origin);
    const puTok = /\d{2}:\d{2}/.exec(cleanTimes((lane.arrivalTime || lane.departureTime).split('\n')[0]))?.[0] ?? '23:59';
    const puAt = `${load.date}T${puTok}`;
    const matches = entries.filter((e) => norm(e.cityRaw) === origin && e.emptyAt <= puAt);
    return {
      assets: matches.filter((e) => e.isAsset),
      external: matches.filter((e) => !e.isAsset),
    };
  }

  const paired = openLoads
    .map((l) => ({ load: l, ...pairings(l) }))
    .filter((p) => p.assets.length > 0 || p.external.length > 0);

  async function rebuild() {
    setRebuildState('Rebuilding…');
    if (demoMode || !app) {
      setRebuildState('Demo mode — list derives live from seed data.');
      return;
    }
    try {
      const fn = httpsCallable(getFunctions(app), 'rebuildCapacity');
      const res = await fn({});
      setRebuildState(`Rebuilt — ${(res.data as { count: number }).count} units on the list.`);
    } catch (e) {
      setRebuildState(`Failed: ${(e as Error).message}`);
    }
  }

  const fmtEmpty = (e: CapacityEntry) => {
    const [d, t] = e.emptyAt.split('T');
    return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${t}`;
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>Capacity</h2>
        <span className="muted">
          Trucks going empty, inferred from Matrix load completions · scheduled times, not ETAs
          {capacity && <> · list as of {fmtStamp(capacity.builtAt)}</>}
          {' '}· rebuilds daily 08:00 Central
        </span>
        {can(currentUser, 'capacity.rebuild') && (
          <button className="btn-ghost" onClick={rebuild}>⟳ Rebuild now</button>
        )}
        {rebuildState && <span className="muted">{rebuildState}</span>}
      </div>

      <section>
        <h3>Empty trucks <span className="muted">({entries.length})</span></h3>
        {entries.length === 0 ? (
          <p className="muted">No list yet — it builds at 08:00, or hit Rebuild now.</p>
        ) : (
          <table className="list-table table-dense">
            <thead>
              <tr><th>Unit</th><th>Carrier</th><th>LS#</th><th>Empties (scheduled)</th><th>Where</th><th>Coming off</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`${e.fromLoadId}-${e.unit}`}>
                  <td className="strong">{e.isAsset ? `⛟ ${e.unit}` : (e.unit && e.unit !== e.carrier ? e.unit : '—')}</td>
                  <td>{e.isAsset ? 'GH Logistics (asset)' : e.carrier}</td>
                  <td>{e.loadNumber || '—'}</td>
                  <td>{fmtEmpty(e)}</td>
                  <td>{publicCity(e.cityRaw, cityState)}</td>
                  <td className="muted wrap">{e.laneLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3>Pairing recommendations <span className="muted">({paired.length} open loads with matches)</span></h3>
        <p className="muted">
          Open loads whose pickup city has a truck scheduled to empty there first — GH assets and
          external capacity recommended separately.
        </p>
        {paired.length === 0 ? (
          <p className="muted">No same-city, time-feasible pairings right now.</p>
        ) : (
          <table className="list-table table-dense">
            <thead>
              <tr><th>PU</th><th>Open load</th><th>Asset recommendation</th><th>External recommendation</th></tr>
            </thead>
            <tbody>
              {paired.map(({ load, assets, external }) => {
                const lane = laneMap.get(load.laneId)!;
                return (
                  <tr key={load.id}>
                    <td>{hubLabel(load.date)}</td>
                    <td className="strong wrap">{laneCompactName(lane)}{load.loadNumber && <span className="muted"> · #{load.loadNumber}</span>}</td>
                    <td className="wrap">
                      {assets.length
                        ? assets.map((e) => <div key={e.fromLoadId + e.unit}>⛟ {e.unit} — empty {fmtEmpty(e)}</div>)
                        : <span className="muted">—</span>}
                    </td>
                    <td className="wrap">
                      {external.length
                        ? external.map((e) => <div key={e.fromLoadId + e.unit}>{e.unit} — empty {fmtEmpty(e)}</div>)
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {centralDateOf(new Date().toISOString()) !== (capacity ? centralDateOf(capacity.builtAt) : '') && capacity && (
          <p className="muted">List is from a previous day — rebuild for current pairings.</p>
        )}
      </section>
    </div>
  );
}
