import { useEffect, useMemo, useState } from 'react';
import { TERMINALS, TERMINAL_LABELS } from '../data/fleet';
import { loadFleet, saveTruck, teamStatusMeta, isShutdown, type FleetTruck } from '../data/fleetStore';
import { loadDrivers } from '../data/driversStore';
import { onChange } from '../data/bus';
import {
  loadAssignments, setAssignment, moveAssignment, ensureSeed, cellKey, parseCellKey,
  isoDate, mondayOf, addDays, driverConflicts, type Assignment,
} from '../data/schedule';
import { canDelete } from '../data/permStore';
import LoadDetailModal from './LoadDetailModal';
import { loadAll, moveLoadCell, clearLoadCell, type Load } from '../data/loadsStore';
import { documentStore } from '../integrations/documents';
import { fleetioClient, localOosList } from '../integrations/telematics';

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

export default function AssetMatrixView() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [assign, setAssign] = useState<Record<string, Assignment>>(() => { ensureSeed(); return loadAssignments(); });
  const [editing, setEditing] = useState<string | null>(null);
  const [editTab, setEditTab] = useState<'info' | 'dispatch' | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [newTruck, setNewTruck] = useState('');
  const [newDay, setNewDay] = useState(0);
  const [docCounts, setDocCounts] = useState<Record<string, number>>({});
  const [termFilter, setTermFilter] = useState<string>('ALL');
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [canDel, setCanDel] = useState<boolean>(() => canDelete());
  const [fleet, setFleet] = useState<FleetTruck[]>(() => loadFleet());
  const [oos, setOos] = useState<Set<string>>(new Set());

  /* Fleetio out-of-service set (+ local dispatch overrides) → row lock */
  function refreshOos() {
    void fleetioClient().serviceStatuses().then((ss) =>
      setOos(new Set([...localOosList(), ...ss.filter((s) => s.status === 'out_of_service').map((s) => s.truck)])));
  }

  /* live sync: reload fleet + assignments whenever any store changes (e.g. a team
     is set NTB on the Fleet card) so the matrix stays congruent without a reload */
  useEffect(() => {
    refreshOos();
    return onChange(() => { setFleet(loadFleet()); setAssign(loadAssignments()); setCanDel(canDelete()); refreshOos(); });
  }, []);

  /* rich-load index (cell → Load) + 📎 doc counts for the chips */
  const loadsByCell = useMemo(() => {
    const m = new Map<string, Load>();
    for (const l of loadAll()) {
      if (l.segments.length === 0) m.set(cellKey(l.assignedTruck, l.date), l);
      else for (const s of l.segments) m.set(cellKey(s.assignedTruck, l.date), l);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assign, fleet]);
  useEffect(() => { void documentStore().countByLoad().then(setDocCounts); }, [assign, editing]);

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
    setEditing(null); setEditTab(undefined);
    if (clear) clearLoadCell(tractor, date);
    void setAssignment(tractor, date, clear ? null : a);
  }

  /* drag an assignment onto an empty day (same or another truck) to move it */
  function move(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    setAssign((prev) => {
      const a = prev[fromKey]; if (!a) return prev;
      const next = { ...prev }; delete next[fromKey]; next[toKey] = a; return next;
    });
    moveLoadCell(fromKey, toKey);
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
          <button className="am-save fleet-add" onClick={() => { setCreating((c) => !c); setNewTruck(fleet[0]?.tractor ?? ''); }}>➕ Create Load</button>
        </div>
        {creating && (
          <div className="load-create-row">
            <select className="am-input" value={newTruck} onChange={(e) => setNewTruck(e.target.value)}>
              {fleet.map((t) => <option key={t.tractor} value={t.tractor}>#{t.tractor} — {[t.driver1, t.driver2].filter(Boolean).join(' / ') || t.type}</option>)}
            </select>
            <select className="am-input" value={newDay} onChange={(e) => setNewDay(Number(e.target.value))}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d} {dates[i]?.slice(5)}</option>)}
            </select>
            <button className="am-save" disabled={!newTruck} onClick={() => { setEditing(cellKey(newTruck, dates[newDay])); setEditTab('info'); setCreating(false); }}>Open load</button>
            <button className="am-cancel" onClick={() => setCreating(false)}>✕</button>
          </div>
        )}
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
                setEditing={(k) => { setEditing(k); setEditTab('info'); }}
                openDispatch={(k) => { setEditing(k); setEditTab('dispatch'); }}
                loads={loadsByCell}
                docCounts={docCounts}
                save={save}
                move={move}
                confirmClear={confirmClear}
                setConfirmClear={setConfirmClear}
                flash={flash}
                canDel={canDel}
                oos={oos}
              />
            ))}
          </tbody>
        </table>
      </div>

      {editing && (() => {
        const { tractor, date } = parseCellKey(editing);
        const conflicts = driverConflicts(tractor, date, assign, fleet);
        return (
          <LoadDetailModal
            tractor={tractor} date={date} assignment={assign[editing]} canDel={canDel} initialTab={editTab}
            warning={conflicts.length ? `⚠ Double-book: ${conflicts.map((c) => `${c.driver} is already on #${c.tractor}`).join('; ')} this day.` : undefined}
            onSave={(a) => save(editing, a)}
            onClear={() => save(editing, { route: '', status: 'covered', usps: false })}
            onClose={() => { setEditing(null); setEditTab(undefined); }}
          />
        );
      })()}
    </div>
  );
}

function TerminalRows({ term, trucks, dates, assign, setEditing, openDispatch, loads, docCounts, save, move, confirmClear, setConfirmClear, flash, canDel, oos }: {
  term: string; trucks: FleetTruck[]; dates: string[];
  assign: Record<string, Assignment>;
  setEditing: (k: string) => void; openDispatch: (k: string) => void;
  loads: Map<string, Load>; docCounts: Record<string, number>;
  save: (k: string, a: Assignment) => void;
  move: (fromKey: string, toKey: string) => void;
  confirmClear: string | null; setConfirmClear: (k: string | null) => void;
  flash: (msg: string) => void; canDel: boolean; oos: Set<string>;
}) {
  const teams = trucks.filter((t) => (t.driver2 || '').trim());
  const solos = trucks.filter((t) => !(t.driver2 || '').trim());

  function renderTruck(t: FleetTruck) {
        const outOfService = oos.has(t.tractor);
        const down = isShutdown(t.status) || outOfService;
        const meta = teamStatusMeta(t.status);
        const sLower = (t.status || '').trim().toLowerCase();
        const statusLabel = sLower === 'deadhead' && (t.deadheadTo || '').trim() ? `Deadhead → ${t.deadheadTo}` : meta.label;
        const rowCls = outOfService ? 'row-oos' : down ? 'row-shutdown' : sLower === 'ntb' ? 'row-ntb' : sLower === 'deadhead' ? 'row-deadhead' : '';
        const hasFlyer = !!t.flyer;
        const nameCls = (confirmed: boolean) => confirmed ? 'am-driver-ok' : hasFlyer ? 'am-driver-flyer' : '';
        const drivers = [t.driver1, t.driver2].filter(Boolean);
        const confirmedN = (t.driver1 && t.confirm1 ? 1 : 0) + (t.driver2 && t.confirm2 ? 1 : 0);
        const pct = drivers.length ? Math.round((confirmedN / drivers.length) * 100) : 0;
        return (
        <tr key={t.tractor} className={rowCls}>
          <td className="am-truckcol">
            <div className="am-tractor">#{t.tractor} <span className="am-rating">{t.rating}</span></div>
            {outOfService && <div className="am-oosbadge" title="Blocked from assignment — clear on the Out of Service page">🛠 OUT OF SERVICE · Fleetio</div>}
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
            return (
              <td
                key={d}
                className={`am-cell${outOfService ? ' am-cell-oos' : ''}`}
                onClick={() => {
                  if (outOfService) { flash(`Truck #${t.tractor} is OUT OF SERVICE (Fleetio) — clear it on the Out of Service page to assign.`); return; }
                  if (down) { flash(`Team #${t.tractor} is in SHUTDOWN — cannot assign a route.`); return; }
                  setEditing(k);
                }}
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
                    {(() => {
                      const ld = loads.get(k); const dc = ld ? (docCounts[ld.id] ?? 0) : 0;
                      return (
                        <div className="am-chipbadges">
                          {dc > 0 && <span className="am-docbadge" title={`${dc} document${dc > 1 ? 's' : ''}`}>📎{dc}</span>}
                          {ld?.dispatchedAt && <span className="am-sentbadge" title="Dispatched — flyer sent">⚡sent</span>}
                          <button className="am-zap" title="Dispatch driver — load sheet" onClick={(e) => { e.stopPropagation(); openDispatch(k); }}>⚡</button>
                        </div>
                      );
                    })()}
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


