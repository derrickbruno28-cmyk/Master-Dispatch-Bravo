import { useMemo, useState } from 'react';
import { TERMINALS, TERMINAL_LABELS, ROUTES } from '../data/fleet';
import { loadFleet, type FleetTruck } from '../data/fleetStore';
import {
  loadAssignments, setAssignment, moveAssignment, ensureSeed, cellKey, parseCellKey,
  isoDate, mondayOf, addDays, type Assignment,
} from '../data/schedule';

/* Asset Matrix — the Bravo-format scheduling board for our OWN trucks.
   Rows = trucks grouped by home terminal (SA / Dallas / Memphis / Houston);
   columns = days Mon→Sun, left→right; every cell is an editable assignment.
   All reads/writes go through data/schedule (browser today, shared Firestore
   when configured — USPS assignments then coincide with Bravo). */

type Status = 'open' | 'covered' | 'dispatched' | 'departed' | 'delivered' | 'completed' | 'off';
const STATUSES: Status[] = ['open', 'covered', 'dispatched', 'departed', 'delivered', 'completed', 'off'];
const STATUS_COLOR: Record<string, string> = {
  open: 'var(--muted)', covered: 'var(--green)', dispatched: '#00b8d4',
  departed: 'var(--accent)', delivered: '#6b7f9e', completed: '#a78bfa', off: 'var(--panel-2)',
};
const STATUS_LABEL: Record<string, string> = {
  open: 'Open', covered: 'Covered', dispatched: 'Dispatched',
  departed: 'Departed', delivered: 'Delivered', completed: 'Completed', off: 'Off / Home',
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ROUTE_OPTIONS = ROUTES.map((r) => r.route);
function looksUSPS(s: string) { return /FA2D3|FA28D|7523D|HCR/i.test(s); }

export default function AssetMatrixView() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [assign, setAssign] = useState<Record<string, Assignment>>(() => { ensureSeed(); return loadAssignments(); });
  const [editing, setEditing] = useState<string | null>(null);
  const [termFilter, setTermFilter] = useState<string>('ALL');
  const fleet = useMemo(() => loadFleet(), []);

  const dates = useMemo(() => DAYS.map((_, i) => isoDate(addDays(weekStart, i))), [weekStart]);
  const shownTerminals: string[] = termFilter === 'ALL' ? [...TERMINALS] : [termFilter];
  const dayCounts = useMemo(
    () => dates.map((d) => fleet.filter((t) => shownTerminals.includes(t.homeCity))
      .reduce((n, t) => n + (assign[cellKey(t.tractor, d)] ? 1 : 0), 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dates, assign, termFilter],
  );
  const weekTotal = dayCounts.reduce((a, b) => a + b, 0);
  const byTerminal = useMemo(() => {
    const m: Record<string, FleetTruck[]> = {};
    for (const term of TERMINALS) m[term] = [];
    for (const t of fleet) (m[t.homeCity] ?? (m[t.homeCity] = [])).push(t);
    return m;
  }, [fleet]);

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  function save(k: string, a: Assignment) {
    const { tractor, date } = parseCellKey(k);
    const clear = !a.route.trim();
    setAssign((prev) => { const next = { ...prev }; if (clear) delete next[k]; else next[k] = a; return next; });
    setEditing(null);
    void setAssignment(tractor, date, clear ? null : a);
  }

  /* drag an assignment onto an empty day (same or another truck) to move it */
  function move(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    setAssign((prev) => {
      const a = prev[fromKey]; if (!a) return prev;
      const next = { ...prev }; delete next[fromKey]; next[toKey] = a; return next;
    });
    void moveAssignment(fromKey, toKey);
  }

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Asset Matrix</h2>
        <div className="am-week">
          <button className="am-navbtn" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</button>
          <span className="am-weeklabel">Week of {weekLabel}</span>
          <button className="am-navbtn" onClick={() => setWeekStart(addDays(weekStart, 7))}>›</button>
          <button className="am-today" onClick={() => setWeekStart(mondayOf(new Date()))}>Today</button>
        </div>
        <div className="am-termfilter">
          {(['ALL', ...TERMINALS] as string[]).map((t) => (
            <button key={t} className={`am-tchip ${termFilter === t ? 'on' : ''}`} onClick={() => setTermFilter(t)}>
              {t === 'ALL' ? 'All terminals' : (TERMINAL_LABELS[t] ?? t)}
            </button>
          ))}
          <span className="am-muted">{weekTotal} assigned this week</span>
        </div>
        <div className="am-legend">
          {STATUSES.map((s) => (
            <span key={s} className="am-legend-item">
              <span className="am-dot" style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}
            </span>
          ))}
          <span className="am-legend-item"><span className="am-usps">USPS</span> = contract route</span>
        </div>
      </div>

      <div className="am-scroll">
        <table className="am-grid">
          <thead>
            <tr>
              <th className="am-truckcol">Truck / Drivers</th>
              {DAYS.map((d, i) => (
                <th key={d} className="am-daycol">
                  {d}<span className="am-datesub">{dates[i].slice(5)}</span>
                  {dayCounts[i] > 0 && <span className="am-daycount">{dayCounts[i]}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownTerminals.map((term) => (
              <TerminalRows
                key={term}
                term={term}
                trucks={byTerminal[term] ?? []}
                dates={dates}
                assign={assign}
                editing={editing}
                setEditing={setEditing}
                save={save}
                move={move}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TerminalRows({ term, trucks, dates, assign, editing, setEditing, save, move }: {
  term: string; trucks: FleetTruck[]; dates: string[];
  assign: Record<string, Assignment>; editing: string | null;
  setEditing: (k: string | null) => void; save: (k: string, a: Assignment) => void;
  move: (fromKey: string, toKey: string) => void;
}) {
  return (
    <>
      <tr className="am-term"><td colSpan={8}>{TERMINAL_LABELS[term] ?? term} · {trucks.length} trucks</td></tr>
      {trucks.map((t) => (
        <tr key={t.tractor}>
          <td className="am-truckcol">
            <div className="am-tractor">#{t.tractor} <span className="am-rating">{t.rating}</span></div>
            <div className="am-drivers">{[t.driver1, t.driver2].filter(Boolean).join(' · ')}</div>
            <div className="am-ttype">{t.type}</div>
          </td>
          {dates.map((d, di) => {
            const k = cellKey(t.tractor, d);
            const a = assign[k];
            const done = a && (a.status === 'delivered' || a.status === 'completed');
            const nextA = di < dates.length - 1 ? assign[cellKey(t.tractor, dates[di + 1])] : undefined;
            if (editing === k) return <td key={d} className="am-cell"><CellEditor init={a} onSave={(x) => save(k, x)} onCancel={() => setEditing(null)} /></td>;
            return (
              <td
                key={d}
                className="am-cell"
                onClick={() => setEditing(k)}
                onDragOver={(e) => { if (a === undefined) e.preventDefault(); }}
                onDrop={(e) => { const from = e.dataTransfer.getData('text/plain'); if (from) move(from, k); }}
              >
                {a ? (
                  <div
                    className="am-assign"
                    style={{ borderLeftColor: STATUS_COLOR[a.status] }}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', k); }}
                    onContextMenu={(e) => { e.preventDefault(); if (window.confirm('Clear this assignment?')) save(k, { route: '', status: a.status, usps: a.usps }); }}
                    title="Drag to an empty day to move · right-click to clear"
                  >
                    <div className="am-route">
                      {a.route}
                      {a.usps && <span className="am-usps">USPS</span>}
                      {a.usps && <span className="am-bravo" title="USPS contract — coincides with Bravo Matrix">⇄ Bravo</span>}
                    </div>
                    <div className="am-status" style={{ color: STATUS_COLOR[a.status] }}>{STATUS_LABEL[a.status] ?? a.status}</div>
                    {done && (nextA
                      ? <div className="am-next am-next-ok">→ next: {nextA.route.split(' ')[0]}</div>
                      : <div className="am-next am-next-need">🔴 Needs next load</div>)}
                  </div>
                ) : <span className="am-add">+</span>}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function CellEditor({ init, onSave, onCancel }: { init?: Assignment; onSave: (a: Assignment) => void; onCancel: () => void }) {
  const [route, setRoute] = useState(init?.route ?? '');
  const [status, setStatus] = useState<Status>((init?.status as Status) ?? 'covered');
  const [usps, setUsps] = useState(init?.usps ?? true);
  const [uspsTouched, setUspsTouched] = useState(false);
  function changeRoute(v: string) { setRoute(v); if (!uspsTouched) setUsps(looksUSPS(v)); }
  return (
    <div className="am-editor" onClick={(e) => e.stopPropagation()}>
      <input className="am-input" autoFocus list="am-routes" placeholder="Pick or type a route…" value={route}
        onChange={(e) => changeRoute(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave({ route, status, usps }); if (e.key === 'Escape') onCancel(); }} />
      <datalist id="am-routes">{ROUTE_OPTIONS.map((r) => <option key={r} value={r} />)}</datalist>
      <select className="am-input" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      <label className="am-usps-check"><input type="checkbox" checked={usps} onChange={(e) => { setUsps(e.target.checked); setUspsTouched(true); }} /> USPS contract route</label>
      <div className="am-editor-btns">
        <button className="am-save" onClick={() => onSave({ route, status, usps })}>Save</button>
        <button className="am-clear" onClick={() => onSave({ route: '', status, usps })}>Clear</button>
        <button className="am-cancel" onClick={onCancel}>✕</button>
      </div>
    </div>
  );
}
