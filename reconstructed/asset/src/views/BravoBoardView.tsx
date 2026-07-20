import { useMemo, useState } from 'react';
import { ROUTES } from '../data/fleet';
import { loadFleet } from '../data/fleetStore';
import {
  loadAssignments, setAssignment, cellKey, parseCellKey,
  isoDate, mondayOf, addDays, type Assignment,
} from '../data/schedule';

/* Bravo Matrix (brokerage side) — a focused board so you can switch ⇄ between
   the two matrices in one place AND see the coincide live: assign a GH asset
   truck to a USPS lane here, and it auto-fills that truck's cell on the Asset
   Matrix. Rows = USPS lanes, columns = days. Shares the same schedule store. */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LANES = ROUTES.filter((r) => /FA2D3|FA26E/i.test(r.route)).slice(0, 34);

export default function BravoBoardView() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [assign, setAssign] = useState<Record<string, Assignment>>(() => loadAssignments());
  const [editing, setEditing] = useState<string | null>(null); // `${route}__${date}`
  const fleet = useMemo(() => loadFleet(), []);

  const dates = useMemo(() => DAYS.map((_, i) => isoDate(addDays(weekStart, i))), [weekStart]);
  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  /* route+date -> covering tractor (from the shared schedule) */
  const coverage = useMemo(() => {
    const m = new Map<string, string>();
    for (const [k, a] of Object.entries(assign)) {
      const { tractor, date } = parseCellKey(k);
      m.set(`${a.route}__${date}`, tractor);
    }
    return m;
  }, [assign]);

  function cover(route: string, date: string, tractor: string) {
    // clear any existing cover of this lane/day, then assign the chosen truck
    const prev = coverage.get(`${route}__${date}`);
    setAssign((cur) => {
      const next = { ...cur };
      if (prev) delete next[cellKey(prev, date)];
      if (tractor) next[cellKey(tractor, date)] = { route, status: 'covered', usps: true };
      return next;
    });
    if (prev) void setAssignment(prev, date, null);
    if (tractor) void setAssignment(tractor, date, { route, status: 'covered', usps: true });
    setEditing(null);
  }

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Bravo Matrix <span className="am-muted" style={{ fontWeight: 400 }}>· brokerage coverage board</span></h2>
        <div className="am-week">
          <button className="am-navbtn" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</button>
          <span className="am-weeklabel">Week of {weekLabel}</span>
          <button className="am-navbtn" onClick={() => setWeekStart(addDays(weekStart, 7))}>›</button>
          <button className="am-today" onClick={() => setWeekStart(mondayOf(new Date()))}>Today</button>
        </div>
        <span className="am-muted">Assign a GH truck to a lane → it appears on the Asset Matrix.</span>
      </div>

      <div className="am-scroll">
        <table className="am-grid">
          <thead>
            <tr>
              <th className="am-truckcol">USPS Lane</th>
              {DAYS.map((d, i) => (
                <th key={d} className="am-daycol">{d}<span className="am-datesub">{dates[i].slice(5)}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LANES.map((lane) => (
              <tr key={lane.route}>
                <td className="am-truckcol">
                  <div className="am-route">{lane.route}</div>
                  <div className="am-ttype">{lane.freq} · {lane.miles} mi</div>
                </td>
                {dates.map((d) => {
                  const kk = `${lane.route}__${d}`;
                  const truck = coverage.get(kk);
                  if (editing === kk) {
                    return (
                      <td key={d} className="am-cell">
                        <select className="am-input" autoFocus defaultValue={truck ?? ''} onChange={(e) => cover(lane.route, d, e.target.value)} onBlur={() => setEditing(null)}>
                          <option value="">— exposed —</option>
                          {fleet.map((t) => <option key={t.tractor} value={t.tractor}>#{t.tractor} {t.driver1}</option>)}
                        </select>
                      </td>
                    );
                  }
                  return (
                    <td key={d} className="am-cell" onClick={() => setEditing(kk)}>
                      {truck ? (
                        <div className="am-assign" style={{ borderLeftColor: 'var(--green)' }}>
                          <div className="am-route">🚛 #{truck}</div>
                          <div className="am-status" style={{ color: 'var(--green)' }}>COVERED (GH)</div>
                        </div>
                      ) : <span className="bravo-exposed">EXPOSED</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
