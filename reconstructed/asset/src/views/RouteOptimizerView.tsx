import { useEffect, useMemo, useState } from 'react';
import { loadFleet, saveTruck, teamStatusMeta, type FleetTruck } from '../data/fleetStore';
import { getMatches, parseRoute, tripCode, type Match } from '../data/optimize';
import { setAssignment, isoDate, loadAssignments, parseCellKey, driverConflicts } from '../data/schedule';
import { onChange } from '../data/bus';

/* Route Optimizer — plan a team's NEXT load. The suggestions come from where the
   team will END UP (the destination of their current trip, or the hub they're
   deadheading to), NOT where they are now. The "Ends at" launch point is shown
   and editable (type Irving TX and the ranked routes come out of Irving TX), and
   HOS hours are a manual field until Samsara. NTB teams (need a load) list first. */

const RADII = [150, 250, 500, 1000];

function isNTB(t: FleetTruck) { return (t.status || '').trim().toLowerCase() === 'ntb'; }
function isDeadhead(t: FleetTruck) { return (t.status || '').trim().toLowerCase() === 'deadhead'; }

export default function RouteOptimizerView() {
  const [fleet, setFleet] = useState<FleetTruck[]>(() => loadFleet());
  const [assignments, setAssignments] = useState<Record<string, ReturnType<typeof loadAssignments>[string]>>(() => loadAssignments());
  const [tractor, setTractor] = useState<string>(() => loadFleet()[0]?.tractor ?? '');
  const [radius, setRadius] = useState(250);
  const [homeward, setHomeward] = useState(false);
  const [q, setQ] = useState('');
  const [assignDate, setAssignDate] = useState(isoDate(new Date()));
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<string>('');   // route awaiting an "assign anyway"
  const [conflictMsg, setConflictMsg] = useState('');
  const [endsAt, setEndsAt] = useState('');   // editable launch point (next-load origin)
  const [hos, setHos] = useState<number>(0);   // editable HOS hours (manual until Samsara)

  /* live sync with the Fleet card / Matrix */
  useEffect(() => onChange(() => { setFleet(loadFleet()); setAssignments(loadAssignments()); }), []);

  /* the team's CURRENT trip — soonest-dated matrix assignment, else the fleet
     card's currentRoute. Its destination is where they'll finish. */
  type CurRoute = { route: string; date?: string; source: 'matrix' | 'fleet' } | null;
  function currentRouteOf(t: FleetTruck): CurRoute {
    const rows = Object.entries(assignments)
      .map(([k, a]) => ({ p: parseCellKey(k), a }))
      .filter((x) => x.p.tractor === t.tractor && (x.a.route || '').trim())
      .sort((p, r) => p.p.date.localeCompare(r.p.date));
    if (rows[0]) return { route: rows[0].a.route, date: rows[0].p.date, source: 'matrix' };
    if ((t.currentRoute || '').trim()) return { route: t.currentRoute!, source: 'fleet' };
    return null;
  }
  /* where the team ENDS UP (launch point for next-load suggestions):
     1) deadheading → the hub they're returning to
     2) current trip's destination
     3) fall back to current city */
  function launchPointOf(t: FleetTruck): { name: string; why: 'deadhead' | 'route' | 'city' } {
    if (isDeadhead(t) && (t.deadheadTo || '').trim()) return { name: t.deadheadTo!.trim(), why: 'deadhead' };
    const cur = currentRouteOf(t);
    if (cur) { const d = parseRoute(cur.route).dN; if (d) return { name: d, why: 'route' }; }
    return { name: t.currentCity, why: 'city' };
  }

  const truck = useMemo(() => fleet.find((t) => t.tractor === tractor), [fleet, tractor]);

  /* trucks list — NTB first (they need a load), then the rest; filtered by search */
  const trucks = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = fleet.filter((t) => !n || `${t.tractor} ${t.driver1} ${t.driver2} ${t.currentCity}`.toLowerCase().includes(n));
    return [...list].sort((a, b) => (isNTB(b) ? 1 : 0) - (isNTB(a) ? 1 : 0));
  }, [fleet, q]);

  const curRoute = truck ? currentRouteOf(truck) : null;
  const autoLaunch = truck ? launchPointOf(truck) : { name: '', why: 'city' as const };

  /* when the selected team changes, reset the editable launch point + HOS to that
     team's computed defaults (dispatcher can then override either) */
  useEffect(() => {
    if (!truck) return;
    setEndsAt(launchPointOf(truck).name);
    setHos(truck.hoursAvail);
    setPending(''); setConflictMsg(''); setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tractor, truck?.hoursAvail]);

  const matches = useMemo<Match[]>(() => {
    if (!truck) return [];
    const eff = { ...truck, hoursAvail: hos } as FleetTruck;
    const m = getMatches(eff, radius, endsAt || autoLaunch.name);
    m.sort((a, b) => (homeward ? b.hw - a.hw || a.dh - b.dh : a.dh - b.dh || b.hw - a.hw));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truck, radius, homeward, endsAt, hos]);

  function saveHos(v: number) {
    setHos(v);
    if (truck) saveTruck({ ...truck, hoursAvail: v });
  }

  /* Assign a route onto the Asset Matrix (shared schedule). Guards against
     double-booking a driver already committed that day (one confirm). */
  function doAssign(m: Match) {
    if (!truck) return;
    void setAssignment(truck.tractor, assignDate, { route: m.route, status: 'covered', usps: true });
    setNote(`✓ Assigned ${m.route} to #${truck.tractor} on ${assignDate} — see it on the Asset Matrix.`);
    setPending(''); setConflictMsg('');
  }
  function assign(m: Match) {
    if (!truck) return;
    const conflicts = driverConflicts(truck.tractor, assignDate, loadAssignments(), fleet);
    if (conflicts.length && pending !== m.route) {
      setPending(m.route);
      setConflictMsg(`⚠ Double-book on ${assignDate}: ${conflicts.map((c) => `${c.driver} is already on #${c.tractor} (${c.route.split(' ')[0]})`).join('; ')}. Click “Assign anyway” to override.`);
      setNote('');
      return;
    }
    doAssign(m);
  }

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Route Optimizer</h2>
        <span className="am-muted">Pick a team — the best NEXT loads to pick up near where their trip ends. NTB teams (need a load) list first.</span>
      </div>

      <div className="opt-wrap">
        {/* LEFT: truck picker */}
        <div className="opt-trucks">
          <input className="am-input" placeholder="Search truck / driver / city…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="opt-trucklist">
            {trucks.map((t) => {
              const cur = currentRouteOf(t);
              const pr = cur ? parseRoute(cur.route) : null;
              const lp = launchPointOf(t);
              const meta = teamStatusMeta(t.status);
              return (
                <button key={t.tractor} className={`opt-truck ${t.tractor === tractor ? 'on' : ''} ${isNTB(t) ? 'ntb' : ''}`} onClick={() => setTractor(t.tractor)}>
                  <div className="opt-truck-top">
                    <b>#{t.tractor}</b>
                    <span className="opt-truck-badges">
                      <span className="opt-tstatus" style={{ color: meta.color }}>{isNTB(t) ? 'NTB' : meta.label}</span>
                      <span className="opt-hrs" style={{ color: t.hoursAvail === 0 ? 'var(--red)' : t.hoursAvail < 20 ? 'var(--amber)' : 'var(--green)' }}>{t.hoursAvail}h</span>
                    </span>
                  </div>
                  <div className="opt-truck-sub">{[t.driver1, t.driver2].filter(Boolean).join(' · ')}</div>
                  {lp.why === 'deadhead' ? (
                    <div className="opt-truck-next">↩ Deadheading to <b>{lp.name}</b> → next load from there · 🏠 {t.homeCity}</div>
                  ) : cur && pr?.dN ? (
                    <>
                      <div className="opt-truck-cur">▶ On {pr.oN || '—'} → <b>{pr.dN}</b> <span className="am-muted">({tripCode(cur.route) || 'route'}{cur.source === 'matrix' ? '' : ' · fleet'})</span></div>
                      <div className="opt-truck-next">ends at {pr.dN} → next load from there · 🏠 {t.homeCity}</div>
                    </>
                  ) : (
                    <div className="opt-truck-loc">📍 at {t.currentCity} → 🏠 {t.homeCity} <span className="am-muted">· {cur ? 'destination unknown' : 'no active trip'}</span></div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT: ranked routes */}
        <div className="opt-routes">
          {!truck ? (
            <p className="am-muted">Select a truck to see route matches.</p>
          ) : (
            <>
              <div className="opt-controls">
                <div className="opt-selected">
                  <b>#{truck.tractor}</b>
                  {autoLaunch.why === 'deadhead'
                    ? <span className="opt-sel-cur"> · deadheading to <b>{autoLaunch.name}</b> — best loads picking up near there ↓</span>
                    : curRoute && autoLaunch.why === 'route'
                      ? <span className="opt-sel-cur"> · on {tripCode(curRoute.route)} → ends at <b>{autoLaunch.name}</b> — best next loads picking up there ↓</span>
                      : <span className="am-muted"> · no active trip — set where they'll end up ↓</span>}
                </div>

                {/* editable launch point + HOS */}
                <div className="opt-inputs">
                  <label className="opt-field"><span className="am-muted">Ends at (next-load origin)</span>
                    <input className="am-input" value={endsAt} onChange={(e) => setEndsAt(e.target.value.toUpperCase())} placeholder="e.g. IRVING TX" />
                  </label>
                  <label className="opt-field"><span className="am-muted">HOS hrs (manual)</span>
                    <input className="am-input" type="number" min={0} max={99} value={hos}
                      onChange={(e) => setHos(Number(e.target.value))} onBlur={(e) => saveHos(Number(e.target.value))} />
                  </label>
                </div>

                <div className="opt-radius">
                  <span className="am-muted">Pickup within</span>
                  {RADII.map((r) => (
                    <button key={r} className={`opt-chip ${radius === r ? 'on' : ''}`} onClick={() => setRadius(r)}>{r}mi</button>
                  ))}
                  <span className="am-muted">of {endsAt || autoLaunch.name}</span>
                </div>
                <div className="opt-controls-row2">
                  <label className="opt-date"><span className="am-muted">Assign to</span><input type="date" className="am-input" value={assignDate} onChange={(e) => setAssignDate(e.target.value)} /></label>
                  <label className="am-usps-check"><input type="checkbox" checked={homeward} onChange={(e) => setHomeward(e.target.checked)} /> Prefer homeward</label>
                  <span className="am-muted">{matches.length} routes</span>
                </div>
              </div>
              {note && <div className="opt-assign-note">{note}</div>}
              {conflictMsg && <div className="opt-assign-note am-dblbook">{conflictMsg}</div>}

              {matches.length === 0 ? (
                <p className="am-muted">No routes within {radius} mi of {endsAt || autoLaunch.name}. Try a wider radius, or check the “Ends at” city.</p>
              ) : (
                <div className="am-scroll">
                  <table className="am-grid opt-table">
                    <thead>
                      <tr>
                        <th>Deadhead</th><th>Pickup</th><th>PU time</th><th>Destination</th><th>Trip #</th><th>Loaded mi</th><th>Est. hrs</th><th>Homeward</th><th>Fits HOS</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map((m) => (
                        <tr key={m.route} className={m.ok ? '' : 'opt-overhrs'}>
                          <td className="opt-dh"><b>{m.dh}</b> mi</td>
                          <td className="opt-route">{m.oN || m.route}<span className="am-muted"> · {m.planning}</span></td>
                          <td className="opt-putime">{m.puTime || m.departure || '—'}</td>
                          <td className="opt-dest"><b>{m.dN || '—'}</b></td>
                          <td className="am-muted">{tripCode(m.route) || '—'}</td>
                          <td>{m.miles}</td>
                          <td>{m.hrs}h</td>
                          <td>{m.hw > 0 ? <span className="opt-hw"><span className="opt-hw-bar" style={{ width: `${m.hw}%` }} />{m.hw}%</span> : <span className="am-muted">—</span>}</td>
                          <td>{m.ok ? <span style={{ color: 'var(--green)' }}>✓</span> : <span style={{ color: 'var(--red)' }}>over</span>}</td>
                          <td><button className={pending === m.route ? 'opt-assign opt-assign-warn' : 'opt-assign'} onClick={() => assign(m)}>{pending === m.route ? 'Assign anyway' : 'Assign →'}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
