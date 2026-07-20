import { useMemo, useState } from 'react';
import { loadFleet } from '../data/fleetStore';
import { getMatches, type Match } from '../data/optimize';
import { setAssignment, isoDate, loadAssignments, driverConflicts } from '../data/schedule';

/* Route Optimizer — ported from the Operations Center onto the shared
   foundation. Pick a truck → the USPS routes it can cover, ranked by deadhead
   distance (with an HOS-hours check and a "homeward" pull toward its terminal). */

const RADII = [150, 250, 500, 1000];

export default function RouteOptimizerView() {
  const TRUCKS = useMemo(() => loadFleet(), []);
  const [tractor, setTractor] = useState<string>(TRUCKS[0]?.tractor ?? '');
  const [radius, setRadius] = useState(250);
  const [homeward, setHomeward] = useState(false);
  const [q, setQ] = useState('');
  const [assignDate, setAssignDate] = useState(isoDate(new Date()));
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<string>('');   // route awaiting an "assign anyway"
  const [conflictMsg, setConflictMsg] = useState('');

  const truck = useMemo(() => TRUCKS.find((t) => t.tractor === tractor), [tractor]);
  const trucks = useMemo(() => {
    const n = q.trim().toLowerCase();
    return TRUCKS.filter((t) => !n || `${t.tractor} ${t.driver1} ${t.driver2} ${t.currentCity}`.toLowerCase().includes(n));
  }, [q]);

  const matches = useMemo<Match[]>(() => {
    if (!truck) return [];
    const m = getMatches(truck, radius);
    m.sort((a, b) => (homeward ? b.hw - a.hw || a.dh - b.dh : a.dh - b.dh || b.hw - a.hw));
    return m;
  }, [truck, radius, homeward]);

  /* Assign a route straight onto the Asset Matrix (shared schedule) for the
     chosen truck + day — it shows up on the Matrix and Routes Covered. Guards
     against double-booking a driver already committed that day (one confirm). */
  function doAssign(m: Match) {
    if (!truck) return;
    void setAssignment(truck.tractor, assignDate, { route: m.route, status: 'covered', usps: true });
    setNote(`✓ Assigned ${m.route} to #${truck.tractor} on ${assignDate} — see it on the Asset Matrix.`);
    setPending(''); setConflictMsg('');
  }
  function assign(m: Match) {
    if (!truck) return;
    const conflicts = driverConflicts(truck.tractor, assignDate, loadAssignments(), TRUCKS);
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
        <span className="am-muted">Pick a truck — see the closest USPS routes it can cover.</span>
      </div>

      <div className="opt-wrap">
        {/* LEFT: truck picker */}
        <div className="opt-trucks">
          <input className="am-input" placeholder="Search truck / driver / city…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="opt-trucklist">
            {trucks.map((t) => (
              <button key={t.tractor} className={`opt-truck ${t.tractor === tractor ? 'on' : ''}`} onClick={() => setTractor(t.tractor)}>
                <div className="opt-truck-top">
                  <b>#{t.tractor}</b>
                  <span className="opt-hrs" style={{ color: t.hoursAvail === 0 ? 'var(--red)' : t.hoursAvail < 20 ? 'var(--amber)' : 'var(--green)' }}>{t.hoursAvail}h</span>
                </div>
                <div className="opt-truck-sub">{[t.driver1, t.driver2].filter(Boolean).join(' · ')}</div>
                <div className="opt-truck-loc">📍 {t.currentCity} → 🏠 {t.homeCity}</div>
              </button>
            ))}
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
                  <b>#{truck.tractor}</b> · {truck.currentCity} · {truck.hoursAvail}h available
                </div>
                <div className="opt-radius">
                  <span className="am-muted">Deadhead ≤</span>
                  {RADII.map((r) => (
                    <button key={r} className={`opt-chip ${radius === r ? 'on' : ''}`} onClick={() => setRadius(r)}>{r}mi</button>
                  ))}
                </div>
                <label className="opt-date"><span className="am-muted">Assign to</span><input type="date" className="am-input" value={assignDate} onChange={(e) => setAssignDate(e.target.value)} /></label>
                <label className="am-usps-check"><input type="checkbox" checked={homeward} onChange={(e) => setHomeward(e.target.checked)} /> Prefer homeward</label>
                <span className="am-muted">{matches.length} routes</span>
              </div>
              {note && <div className="opt-assign-note">{note}</div>}
              {conflictMsg && <div className="opt-assign-note am-dblbook">{conflictMsg}</div>}

              {matches.length === 0 ? (
                <p className="am-muted">No routes within {radius} mi deadhead of {truck.currentCity}. Try a wider radius.</p>
              ) : (
                <div className="am-scroll">
                  <table className="am-grid opt-table">
                    <thead>
                      <tr>
                        <th>Deadhead</th><th>Route</th><th>Loaded mi</th><th>Est. hrs</th><th>Homeward</th><th>Fits HOS</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map((m) => (
                        <tr key={m.route} className={m.ok ? '' : 'opt-overhrs'}>
                          <td className="opt-dh"><b>{m.dh}</b> mi</td>
                          <td className="opt-route">{m.route}<span className="am-muted"> · {m.planning}</span></td>
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
