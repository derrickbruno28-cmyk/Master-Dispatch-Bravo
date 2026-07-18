import { useMemo, useState } from 'react';
import { TRUCKS } from '../data/fleet';
import { getMatches, type Match } from '../data/optimize';

/* Route Optimizer — ported from the Operations Center onto the shared
   foundation. Pick a truck → the USPS routes it can cover, ranked by deadhead
   distance (with an HOS-hours check and a "homeward" pull toward its terminal). */

const RADII = [150, 250, 500, 1000];

export default function RouteOptimizerView() {
  const [tractor, setTractor] = useState<string>(TRUCKS[0]?.tractor ?? '');
  const [radius, setRadius] = useState(250);
  const [homeward, setHomeward] = useState(false);
  const [q, setQ] = useState('');

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
                <label className="am-usps-check"><input type="checkbox" checked={homeward} onChange={(e) => setHomeward(e.target.checked)} /> Prefer homeward</label>
                <span className="am-muted">{matches.length} routes</span>
              </div>

              {matches.length === 0 ? (
                <p className="am-muted">No routes within {radius} mi deadhead of {truck.currentCity}. Try a wider radius.</p>
              ) : (
                <div className="am-scroll">
                  <table className="am-grid opt-table">
                    <thead>
                      <tr>
                        <th>Deadhead</th><th>Route</th><th>Loaded mi</th><th>Rate</th><th>Est. hrs</th><th>Homeward</th><th>Fits HOS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches.map((m) => (
                        <tr key={m.route} className={m.ok ? '' : 'opt-overhrs'}>
                          <td className="opt-dh"><b>{m.dh}</b> mi</td>
                          <td className="opt-route">{m.route}<span className="am-muted"> · {m.planning}</span></td>
                          <td>{m.miles}</td>
                          <td className="opt-rate">{m.rate}</td>
                          <td>{m.hrs}h</td>
                          <td>{m.hw > 0 ? <span className="opt-hw"><span className="opt-hw-bar" style={{ width: `${m.hw}%` }} />{m.hw}%</span> : <span className="am-muted">—</span>}</td>
                          <td>{m.ok ? <span style={{ color: 'var(--green)' }}>✓</span> : <span style={{ color: 'var(--red)' }}>over</span>}</td>
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
