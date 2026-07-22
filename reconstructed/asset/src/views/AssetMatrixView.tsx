import { useEffect, useMemo, useState } from 'react';
import { TERMINALS, TERMINAL_LABELS, ROUTES } from '../data/fleet';
import { loadFleet, saveTruck, teamStatusMeta, isShutdown, type FleetTruck } from '../data/fleetStore';
import { loadDrivers } from '../data/driversStore';
import { onChange } from '../data/bus';
import {
  loadAssignments, setAssignment, moveAssignment, ensureSeed, cellKey, parseCellKey,
  isoDate, mondayOf, addDays, driverConflicts, type Assignment, type DriverConflict,
} from '../data/schedule';
import { canDelete } from '../data/permStore';

/* Asset Matrix — the scheduling board for our OWN trucks.
   Rows = trucks grouped by home terminal (SA / Dallas / Memphis / Houston),
   each tagged with its live team status (NTB / Deadhead / Dispatched / Shutdown …
   set on the Fleet card); columns = days Mon→Sun, left→right; every cell is an
   editable assignment. Adding/editing loads is open; DELETING a load is gated
   behind delete access. All reads/writes go through data/schedule. */

/* Load lifecycle on a matrix cell, in real dispatch order: covered → dispatched →
   at yard → at shipper → en route → at receiver → delivered → completed
   (off = home/reset). */
const STATUSES = ['open', 'covered', 'dispatched', 'at yard', 'at shipper', 'en route', 'at receiver', 'delivered', 'completed', 'off'] as const;
type Status = typeof STATUSES[number];
const STATUS_COLOR: Record<string, string> = {
  open: 'var(--muted)', covered: 'var(--green)', dispatched: '#00b8d4',
  'at yard': '#b0842a', 'at shipper': '#e8a33d', 'en route': 'var(--accent)',
  'at receiver': '#7c5cff', delivered: '#6b7f9e', completed: '#a78bfa', off: 'var(--panel-2)',
};
const STATUS_LABEL: Record<string, string> = {
  open: 'Open', covered: 'Covered', dispatched: 'Dispatched',
  'at shipper': 'At Shipper', 'at yard': 'At Yard', 'en route': 'En Route',
  'at receiver': 'At Receiver', delivered: 'Delivered', completed: 'Completed', off: 'Off / Home',
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ROUTE_OPTIONS = ROUTES.map((r) => r.route);
function looksUSPS(s: string) { return /FA2D3|FA28D|7523D|HCR/i.test(s); }

export default function AssetMatrixView() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [assign, setAssign] = useState<Record<string, Assignment>>(() => { ensureSeed(); return loadAssignments(); });
  const [editing, setEditing] = useState<string | null>(null);
  const [termFilter, setTermFilter] = useState<string>('ALL');
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [canDel, setCanDel] = useState<boolean>(() => canDelete());
  const [fleet, setFleet] = useState<FleetTruck[]>(() => loadFleet());

  /* live sync: reload fleet + assignments whenever any store changes (e.g. a team
     is set NTB on the Fleet card) so the matrix stays congruent without a reload */
  useEffect(() => onChange(() => { setFleet(loadFleet()); setAssign(loadAssignments()); setCanDel(canDelete()); }), []);

  /* transient inline notice — replaces window.alert (blocked in sandboxes) */
  function flash(msg: string) { setNotice(msg); window.setTimeout(() => setNotice(''), 3200); }

  const dates = useMemo(() => DAYS.map((_, i) => isoDate(addDays(weekStart, i))), [weekStart]);
  const shownTerminals: string[] = termFilter === 'ALL' ? [...TERMINALS] : [termFilter];
  const dayCounts = useMemo(
    () => dates.map((d) => fleet.filter((t) => shownTerminals.includes(t.homeCity))
      .reduce((n, t) => n + (assign[cellKey(t.tractor, d)] ? 1 : 0), 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dates, assign, termFilter],
  );
  const weekTotal = dayCounts.reduce((a, b) => a + b, 0);

  /* driver name → position (from the Master Drivers List), so we can filter the
     matrix by position / hero teams without cluttering the board */
  const driverPos = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of loadDrivers()) m.set(d.name.trim().toLowerCase(), d.position);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet]);
  const positions = useMemo(() => [...new Set([...driverPos.values()].filter(Boolean))].sort(), [driverPos]);
  function truckPositions(t: FleetTruck): string[] {
    return [t.driver1, t.driver2].map((n) => driverPos.get((n || '').trim().toLowerCase()) || '').filter(Boolean);
  }
  function matchesPos(t: FleetTruck): boolean {
    if (posFilter === 'ALL') return true;
    const ps = truckPositions(t);
    if (posFilter === '__HERO') return ps.some((p) => /hero/i.test(p));
    return ps.includes(posFilter);
  }

  const byTerminal = useMemo(() => {
    const m: Record<string, FleetTruck[]> = {};
    for (const term of TERMINALS) m[term] = [];
    for (const t of fleet) { if (!matchesPos(t)) continue; (m[t.homeCity] ?? (m[t.homeCity] = [])).push(t); }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet, posFilter, driverPos]);

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  function save(k: string, a: Assignment) {
    const { tractor, date } = parseCellKey(k);
    const clear = !a.route.trim();
    /* delete gate: clearing a load requires delete access; adding/editing is open */
    if (clear && !canDel) { flash('🔒 Deleting a load is restricted — unlock delete access in the header.'); setEditing(null); setConfirmClear(null); return; }
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
          <select className="am-input am-filter" value={termFilter} onChange={(e) => setTermFilter(e.target.value)}>
            <option value="ALL">All terminals</option>
            {TERMINALS.map((t) => <option key={t} value={t}>{TERMINAL_LABELS[t] ?? t}</option>)}
          </select>
          <select className="am-input am-filter" value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
            <option value="ALL">All positions</option>
            <option value="__HERO">★ Hero teams</option>
            {positions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
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
        {notice && <div className="am-notice">{notice}</div>}
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
                confirmClear={confirmClear}
                setConfirmClear={setConfirmClear}
                flash={flash}
                fleet={fleet}
                canDel={canDel}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TerminalRows({ term, trucks, dates, assign, editing, setEditing, save, move, confirmClear, setConfirmClear, flash, fleet, canDel }: {
  term: string; trucks: FleetTruck[]; dates: string[];
  assign: Record<string, Assignment>; editing: string | null;
  setEditing: (k: string | null) => void; save: (k: string, a: Assignment) => void;
  move: (fromKey: string, toKey: string) => void;
  confirmClear: string | null; setConfirmClear: (k: string | null) => void;
  flash: (msg: string) => void; fleet: FleetTruck[]; canDel: boolean;
}) {
  const teams = trucks.filter((t) => (t.driver2 || '').trim());
  const solos = trucks.filter((t) => !(t.driver2 || '').trim());

  function renderTruck(t: FleetTruck) {
        const down = isShutdown(t.status);
        const meta = teamStatusMeta(t.status);
        const sLower = (t.status || '').trim().toLowerCase();
        const statusLabel = sLower === 'deadhead' && (t.deadheadTo || '').trim() ? `Deadhead → ${t.deadheadTo}` : meta.label;
        const rowCls = down ? 'row-shutdown' : sLower === 'ntb' ? 'row-ntb' : sLower === 'deadhead' ? 'row-deadhead' : '';
        const hasFlyer = !!t.flyer;
        const nameCls = (confirmed: boolean) => confirmed ? 'am-driver-ok' : hasFlyer ? 'am-driver-flyer' : '';
        const drivers = [t.driver1, t.driver2].filter(Boolean);
        const confirmedN = (t.driver1 && t.confirm1 ? 1 : 0) + (t.driver2 && t.confirm2 ? 1 : 0);
        const pct = drivers.length ? Math.round((confirmedN / drivers.length) * 100) : 0;
        return (
        <tr key={t.tractor} className={rowCls}>
          <td className="am-truckcol">
            <div className="am-tractor">#{t.tractor} <span className="am-rating">{t.rating}</span></div>
            <div className="am-drivers-confirm">
              {t.driver1 && <label className={`am-driverchk ${nameCls(!!t.confirm1)}`}><input type="checkbox" checked={!!t.confirm1} onChange={(e) => saveTruck({ ...t, confirm1: e.target.checked })} />{t.driver1}</label>}
              {t.driver2 && <label className={`am-driverchk ${nameCls(!!t.confirm2)}`}><input type="checkbox" checked={!!t.confirm2} onChange={(e) => saveTruck({ ...t, confirm2: e.target.checked })} />{t.driver2}</label>}
            </div>
            <div className="am-flyerrow">
              <select className="am-flyersel" value={t.flyer || ''} onChange={(e) => saveTruck({ ...t, flyer: e.target.value as FleetTruck['flyer'] })} title="Dispatch flyer status — drivers turn yellow when sent, green when confirmed">
                <option value="">— no flyer —</option>
                <option value="driver">Flyer sent → driver</option>
                <option value="team">Flyer sent → team</option>
              </select>
              {hasFlyer && <span className={`am-confirmpct ${pct === 100 ? 'full' : ''}`}>{pct}% confirmed</span>}
            </div>
            <div className="am-ttype">{t.type}</div>
            {meta.onMatrix && <div className="am-teamstatus" style={{ color: meta.color, background: meta.tint }}>{statusLabel}</div>}
            {t.constraints && <div className="am-teamnote">📝 {t.constraints}</div>}
          </td>
          {dates.map((d, di) => {
            const k = cellKey(t.tractor, d);
            const a = assign[k];
            const done = a && (a.status === 'delivered' || a.status === 'completed');
            const nextA = di < dates.length - 1 ? assign[cellKey(t.tractor, dates[di + 1])] : undefined;
            if (editing === k) return <td key={d} className="am-cell"><CellEditor init={a} conflicts={driverConflicts(t.tractor, d, assign, fleet)} canDel={canDel} onSave={(x) => save(k, x)} onCancel={() => setEditing(null)} /></td>;
            return (
              <td
                key={d}
                className="am-cell"
                onClick={() => { if (down) { flash(`Team #${t.tractor} is in SHUTDOWN — cannot assign a route.`); return; } setEditing(k); }}
                onDragOver={(e) => { if (a === undefined && !down) e.preventDefault(); }}
                onDrop={(e) => { if (down) return; const from = e.dataTransfer.getData('text/plain'); if (from) move(from, k); }}
              >
                {a ? (
                  <div
                    className="am-assign"
                    style={{ borderLeftColor: STATUS_COLOR[a.status] }}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', k); }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!canDel) { flash('🔒 Deleting a load is restricted — unlock delete access in the header.'); return; } setConfirmClear(k); }}
                    title={canDel ? 'Drag to an empty day to move · right-click to clear' : 'Drag to an empty day to move · deleting is restricted'}
                  >
                    <div className="am-route">
                      {a.route}
                      {a.usps && <span className="am-usps">USPS</span>}
                    </div>
                    <div className="am-status" style={{ color: STATUS_COLOR[a.status] }}>{STATUS_LABEL[a.status] ?? a.status}</div>
                    {done && (nextA
                      ? <div className="am-next am-next-ok">→ next: {nextA.route.split(' ')[0]}</div>
                      : <div className="am-next am-next-need">🔴 Needs next load</div>)}
                    {confirmClear === k && (
                      <div className="am-clearconfirm" onClick={(e) => e.stopPropagation()}>
                        <span>Clear?</span>
                        <button className="am-cc-yes" title="Clear assignment" onClick={(e) => { e.stopPropagation(); save(k, { route: '', status: a.status, usps: a.usps }); setConfirmClear(null); }}>✓</button>
                        <button className="am-cc-no" title="Keep" onClick={(e) => { e.stopPropagation(); setConfirmClear(null); }}>✕</button>
                      </div>
                    )}
                  </div>
                ) : <span className="am-add">+</span>}
              </td>
            );
          })}
        </tr>
        );
  }

  return (
    <>
      <tr className="am-term"><td colSpan={8}>{TERMINAL_LABELS[term] ?? term} · {trucks.length} truck{trucks.length === 1 ? '' : 's'}</td></tr>
      {teams.length > 0 && <tr className="am-subterm"><td colSpan={8}>▸ Teams · {teams.length}</td></tr>}
      {teams.map(renderTruck)}
      {solos.length > 0 && <tr className="am-subterm"><td colSpan={8}>▸ Solo · {solos.length}</td></tr>}
      {solos.map(renderTruck)}
    </>
  );
}

function CellEditor({ init, conflicts, canDel, onSave, onCancel }: { init?: Assignment; conflicts: DriverConflict[]; canDel: boolean; onSave: (a: Assignment) => void; onCancel: () => void }) {
  const [route, setRoute] = useState(init?.route ?? '');
  const [status, setStatus] = useState<Status>((init?.status as Status) ?? 'covered');
  const [usps, setUsps] = useState(init?.usps ?? true);
  const [uspsTouched, setUspsTouched] = useState(false);
  function changeRoute(v: string) { setRoute(v); if (!uspsTouched) setUsps(looksUSPS(v)); }
  /* double-booking guard: warn only when actually assigning a route (not clearing);
     the same cell already held this driver's route, so editing it isn't a new book */
  const hasConflict = conflicts.length > 0 && !!route.trim();
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
      {hasConflict && (
        <div className="am-dblbook">
          ⚠ Double-book: {conflicts.map((c) => `${c.driver} is already on #${c.tractor} (${c.route.split(' ')[0]})`).join('; ')} this day.
        </div>
      )}
      <div className="am-editor-btns">
        <button className={hasConflict ? 'am-save am-save-warn' : 'am-save'} onClick={() => onSave({ route, status, usps })}>{hasConflict ? 'Assign anyway' : 'Save'}</button>
        {init && (canDel
          ? <button className="am-clear" onClick={() => onSave({ route: '', status, usps })}>Clear</button>
          : <button className="am-clear" disabled title="Deleting is restricted — unlock delete access in the header">🔒 Clear</button>)}
        <button className="am-cancel" onClick={onCancel}>✕</button>
      </div>
    </div>
  );
}

