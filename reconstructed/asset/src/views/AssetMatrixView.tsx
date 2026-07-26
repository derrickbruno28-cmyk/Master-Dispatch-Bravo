import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { TERMINALS, TERMINAL_LABELS } from '../data/fleet';
import { loadFleet, saveTruck, removeTruck, teamStatusMeta, isShutdown, blankTruck, TRUCK_TYPES, type FleetTruck } from '../data/fleetStore';
import { loadDrivers, driverNames } from '../data/driversStore';
import { onChange } from '../data/bus';
import {
  loadAssignments, setAssignment, moveAssignment, ensureSeed, cellKey, parseCellKey,
  isoDate, mondayOf, addDays, driverConflicts, type Assignment,
} from '../data/schedule';
import { canDelete, canApproveSoloOverride } from '../data/permStore';
import FastLog from './FastLog';
import LoadDetailModal from './LoadDetailModal';
import { loadAll, moveLoadCell, clearLoadCell, type Load } from '../data/loadsStore';
import { documentStore } from '../integrations/documents';
import { fleetioClient, localOosList } from '../integrations/telematics';
import { samsara } from '../integrations/samsara';
import { nextRouteSuggestions, parseRoute, tripCode, isTeamTrip, SOLO_MAX_MILES, type Match } from '../data/optimize';

/* Asset Matrix — the scheduling board for our OWN trucks.
   Rows = trucks grouped by home terminal (SA / Dallas / Memphis / Houston),
   each tagged with its live team status (NTB / Deadhead / Dispatched / Shutdown …
   set on the Fleet card); columns = days Mon→Sun, left→right; every cell is an
   editable assignment. Adding/editing loads is open; DELETING a load is gated
   behind delete access. All reads/writes go through data/schedule. */

/* Load lifecycle on a matrix cell, in real dispatch order: covered → dispatched →
   at yard → at shipper → en route → at receiver → delivered → completed
   (off = home/reset). */
const STATUSES = ['unassigned', 'open', 'covered', 'dispatched', 'at yard', 'at shipper', 'en route', 'at receiver', 'delivered', 'completed', 'off'] as const;
const STATUS_COLOR: Record<string, string> = {
  unassigned: 'var(--muted)', open: 'var(--muted)', covered: 'var(--green)', dispatched: '#00b8d4',
  'at yard': '#b0842a', 'at shipper': '#e8a33d', 'en route': 'var(--accent)',
  'at receiver': '#7c5cff', delivered: '#6b7f9e', completed: '#a78bfa', off: 'var(--panel-2)',
};
const STATUS_LABEL: Record<string, string> = {
  unassigned: 'Unassigned', open: 'Open', covered: 'Covered', dispatched: 'Dispatched',
  'at shipper': 'At Shipper', 'at yard': 'At Yard', 'en route': 'En Route',
  'at receiver': 'At Receiver', delivered: 'Delivered', completed: 'Completed', off: 'Off / Home',
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* "SAN ANTONIO" → "San Antonio" for the suggestion popover */
function cityTitle(s: string): string {
  return (s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AssetMatrixView() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [assign, setAssign] = useState<Record<string, Assignment>>(() => { ensureSeed(); return loadAssignments(); });
  const [editing, setEditing] = useState<string | null>(null);
  const [editTab, setEditTab] = useState<'info' | 'dispatch' | undefined>(undefined);
  const [createNew, setCreateNew] = useState(false);
  const [addTeam, setAddTeam] = useState(false);               // quick "add a team to the board" modal
  const [placing, setPlacing] = useState<Load | null>(null);   // an unassigned load being placed on the board
  const [loadsTick, setLoadsTick] = useState(0);               // bump to recompute load-derived views
  const [docCounts, setDocCounts] = useState<Record<string, number>>({});
  const [termFilter, setTermFilter] = useState<string>('ALL');
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [canDel, setCanDel] = useState<boolean>(() => canDelete());
  const [fleet, setFleet] = useState<FleetTruck[]>(() => loadFleet());
  const [oos, setOos] = useState<Set<string>>(new Set());
  const [hosByTruck, setHosByTruck] = useState<Record<string, number>>({});
  const [sugCell, setSugCell] = useState<string | null>(null);

  /* Fleetio out-of-service set (+ local dispatch overrides) → row lock */
  function refreshOos() {
    void fleetioClient().serviceStatuses().then((ss) =>
      setOos(new Set([...localOosList(), ...ss.filter((s) => s.status === 'out_of_service').map((s) => s.truck)])));
  }

  /* live sync: reload fleet + assignments whenever any store changes (e.g. a team
     is set NTB on the Fleet card) so the matrix stays congruent without a reload */
  /* HOS per truck (from the Samsara adapter — mock until the backend is wired);
     drives the ranking + gating of the next-route suggestions */
  function refreshHos() {
    void samsara().hos().then((list) => setHosByTruck(Object.fromEntries(list.map((h) => [h.truck, h.hoursAvailable]))));
  }
  useEffect(() => {
    refreshOos(); refreshHos();
    return onChange(() => { setFleet(loadFleet()); setAssign(loadAssignments()); setCanDel(canDelete()); setLoadsTick((n) => n + 1); refreshOos(); refreshHos(); });
  }, []);

  /* loads created without a truck live here until placed on the board */
  const unassignedLoads = useMemo(
    () => loadAll().filter((l) => !l.assignedTruck.trim() && l.segments.length === 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadsTick, editing, createNew, placing],
  );

  /* place a just-saved new/unassigned load: write its board cell if it has a
     truck + date, otherwise leave it in the Unassigned tray */
  function commitNewLoad(saved: Load) {
    setCreateNew(false); setPlacing(null);
    if (saved.assignedTruck.trim() && saved.date) {
      const k = cellKey(saved.assignedTruck, saved.date);
      /* route can be blank (schedule entry started before the route is known) —
         keep the cell occupied with a placeholder so it stays on the board */
      const a: Assignment = { route: saved.routeName.trim() || '⏳ route TBD', status: saved.status, usps: saved.uspsContract };
      setAssign((prev) => ({ ...prev, [k]: a }));
      void setAssignment(saved.assignedTruck, saved.date, a);
      flash(`✓ Load created on #${saved.assignedTruck} · ${saved.date}`);
    } else {
      flash('✓ Load saved to the Unassigned tray — assign a truck to place it on the board.');
    }
    setLoadsTick((n) => n + 1);
  }

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

  /* the calendar shows CREWS only — a truck is on the board once it has at least
     one driver assigned (via ＋ Add Team or the Team Status editor). Freshly
     imported units sit in the Trucks list, unassigned, until you build a crew, so
     the board stays clean. Out-of-service trucks are handled on the Trucks tab —
     they never go on the calendar. */
  const hasCrew = (t: FleetTruck) => !!(t.driver1 || '').trim() || !!(t.driver2 || '').trim();
  const byTerminal = useMemo(() => {
    const m: Record<string, FleetTruck[]> = {};
    for (const term of TERMINALS) m[term] = [];
    for (const t of fleet) { if (!hasCrew(t) || !matchesPos(t)) continue; (m[t.homeCity] ?? (m[t.homeCity] = [])).push(t); }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet, posFilter, driverPos]);
  const crewCount = useMemo(() => fleet.filter(hasCrew).length, [fleet]);

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
          <button className="am-save fleet-add" onClick={() => setAddTeam(true)}>👥 Add Team</button>
          <button className="am-save fleet-add" onClick={() => setCreateNew(true)}>➕ Create Load</button>
        </div>
        {unassignedLoads.length > 0 && (
          <div className="am-unassigned">
            <span className="am-unassigned-h">📥 Unassigned loads ({unassignedLoads.length}) — assign a truck to place on the board:</span>
            {unassignedLoads.map((l) => (
              <button key={l.id} className="am-unassigned-chip" title="Open to assign a truck + date" onClick={() => setPlacing(l)}>
                {l.routeName || 'Untitled load'}{l.customerName ? ` · ${l.customerName}` : ''}
              </button>
            ))}
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
            {crewCount === 0 && (
              <tr><td colSpan={DAYS.length + 1} className="am-empty-board">
                No teams on the board yet. Your trucks are in the <b>Fleet ▸ Trucks</b> list — add a crew with <b>＋ Add Team</b> (or assign drivers on <b>Team Status</b>) and they’ll show up here.
              </td></tr>
            )}
            {shownTerminals.filter((term) => (byTerminal[term]?.length ?? 0) > 0).map((term) => (
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
                hosByTruck={hosByTruck}
                sugCell={sugCell}
                setSugCell={setSugCell}
                advanceWeek={() => setWeekStart(addDays(weekStart, 7))}
                driverPos={driverPos}
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

      {/* Create Load → a blank card straight away (no truck/date gate). Assign a
          truck inside the card, or leave it unassigned to place from the tray. */}
      {createNew && (
        <LoadDetailModal
          tractor="" date={isoDate(new Date())} canDel={canDel} initialTab="info" newLoad
          onSave={() => {}} onClear={() => {}}
          onCreated={commitNewLoad}
          onClose={() => setCreateNew(false)}
        />
      )}
      {placing && (
        <LoadDetailModal
          tractor={placing.assignedTruck} date={placing.date} canDel={canDel} initialTab="info" seedLoad={placing}
          onSave={() => {}} onClear={() => {}}
          onCreated={commitNewLoad}
          onClose={() => setPlacing(null)}
        />
      )}
      {addTeam && <AddTeamModal onClose={() => setAddTeam(false)} onAdded={(tractor) => { setAddTeam(false); flash(`✓ Team #${tractor} added to the board.`); }} />}
    </div>
  );
}

/* Quick "add a team to the board" — type driver 1 & 2, a truck # and trailer,
   pick the type/home terminal, Add. Creates a fleet team so it shows up as a row
   on the Asset Matrix immediately (the full editor lives on Team Status). */
function AddTeamModal({ onClose, onAdded }: { onClose: () => void; onAdded: (tractor: string) => void }) {
  const roster = useMemo(() => driverNames(), []);
  const truckNums = useMemo(() => loadFleet().map((x) => x.tractor).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), []);
  const [t, setT] = useState<FleetTruck>(() => blankTruck());
  const set = <K extends keyof FleetTruck>(k: K, v: FleetTruck[K]) => setT((p) => ({ ...p, [k]: v }));
  const existing = useMemo(() => loadFleet().find((x) => x.tractor === t.tractor.trim()), [t.tractor]);
  function add() {
    const num = t.tractor.trim();
    if (!num) return;
    /* attach the crew to the existing (Fleetio-imported) unit — keep its
       odometer / make / rating / service — else create a brand-new truck */
    saveTruck(existing
      ? { ...existing, driver1: t.driver1, driver2: t.driver2, type: t.type, homeCity: t.homeCity }
      : { ...t, tractor: num });
    onAdded(num);
  }
  return (
    <div className="fleet-modal-back" onClick={onClose}>
      <div className="fleet-modal" onClick={(e) => e.stopPropagation()}>
        <h3>👥 Add Team to the Board</h3>
        <p className="am-muted" style={{ fontSize: 12.5, marginTop: -4 }}>Type the two drivers and pick the truck # from your fleet, then Add. It shows up as a row on the matrix right away (its odometer, make &amp; rating carry over from Fleetio). Trailers are assigned per route inside each load (teams run power-only).</p>
        <div className="fleet-form-grid">
          <label className="otp-field"><span className="otp-field-label">Driver 1</span>
            <input className="am-input" list="addteam-roster" value={t.driver1} onChange={(e) => set('driver1', e.target.value)} placeholder="type or pick a driver…" /></label>
          <label className="otp-field"><span className="otp-field-label">Driver 2 (leave blank for solo)</span>
            <input className="am-input" list="addteam-roster" value={t.driver2} onChange={(e) => set('driver2', e.target.value)} placeholder="type or pick a driver…" /></label>
          <label className="otp-field"><span className="otp-field-label">Truck # (pick from your fleet)</span>
            <input className="am-input" list="addteam-trucks" value={t.tractor} onChange={(e) => set('tractor', e.target.value)} placeholder="e.g. 442" />
            {t.tractor.trim() && (existing
              ? <span className="am-muted" style={{ fontSize: 10.5, color: 'var(--green)' }}>✓ #{existing.tractor} · {existing.make || 'make —'} · {existing.odometer ? existing.odometer.toLocaleString() + ' mi' : 'no odo'}</span>
              : <span className="am-muted" style={{ fontSize: 10.5, color: 'var(--amber)' }}>new truck (not in Fleetio import)</span>)}
          </label>
          <label className="otp-field"><span className="otp-field-label">Type</span>
            <select className="am-input" value={t.type} onChange={(e) => set('type', e.target.value)}>{TRUCK_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="otp-field"><span className="otp-field-label">Home terminal</span>
            <select className="am-input" value={t.homeCity} onChange={(e) => set('homeCity', e.target.value)}>{TERMINALS.map((x) => <option key={x} value={x}>{TERMINAL_LABELS[x] ?? x}</option>)}</select></label>
        </div>
        <datalist id="addteam-roster">{roster.map((n) => <option key={n} value={n} />)}</datalist>
        <datalist id="addteam-trucks">{truckNums.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="fleet-modal-btns">
          <button className="am-save" disabled={!t.tractor.trim()} onClick={add}>Add team</button>
          <button className="am-cancel" onClick={onClose}>Cancel</button>
          {!t.tractor.trim() && <span className="am-muted" style={{ fontSize: 11, color: 'var(--red)' }}>Truck # is required.</span>}
        </div>
      </div>
    </div>
  );
}

function TerminalRows({ term, trucks, dates, assign, setEditing, openDispatch, loads, docCounts, save, move, confirmClear, setConfirmClear, flash, canDel, oos, hosByTruck, sugCell, setSugCell, advanceWeek, driverPos }: {
  term: string; trucks: FleetTruck[]; dates: string[];
  assign: Record<string, Assignment>;
  setEditing: (k: string) => void; openDispatch: (k: string) => void;
  loads: Map<string, Load>; docCounts: Record<string, number>;
  save: (k: string, a: Assignment) => void;
  move: (fromKey: string, toKey: string) => void;
  confirmClear: string | null; setConfirmClear: (k: string | null) => void;
  flash: (msg: string) => void; canDel: boolean; oos: Set<string>;
  hosByTruck: Record<string, number>; sugCell: string | null; setSugCell: (k: string | null) => void;
  advanceWeek: () => void; driverPos: Map<string, string>;
}) {
  /* which cell has the ⚡ quick-log popover open (cell key, or null) */
  const [fastLog, setFastLog] = useState<string | null>(null);
  const teams = trucks.filter((t) => (t.driver2 || '').trim());
  const solos = trucks.filter((t) => !(t.driver2 || '').trim());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);   // team being carried to next week
  const [moveTruck, setMoveTruck] = useState('');
  const [editRow, setEditRow] = useState<string | null>(null); // truck-column edit mode (guards accidental clicks)
  const posOf = (name: string) => driverPos.get((name || '').trim().toLowerCase()) || '';

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
        /* Assigned — NTD (Need To Dispatch): the truck has a route on the board
           this week that isn't dispatched yet (pre-dispatch status). */
        const hasUndispatchedRoute = dates.some((d) => {
          const a = assign[cellKey(t.tractor, d)];
          return a && a.route.trim() && ['unassigned', 'open', 'covered'].includes((a.status || '').toLowerCase());
        });
        const editing = editRow === t.tractor;   // interactive controls only in edit mode (no fat-finger changes)
        const p1 = posOf(t.driver1), p2 = posOf(t.driver2);
        return (
        <tr key={t.tractor} className={rowCls}>
          <td className="am-truckcol">
            <div className="am-tractor">#{t.tractor} <span className="am-rating">{t.rating}</span>
              {editing
                ? <span className="am-teamedit-actions">
                    <button className="am-teamnext" title="Carry these drivers to next week on a (possibly different) truck" onClick={() => { setMoving(t.tractor); setMoveTruck(''); }}>→ wk</button>
                    {canDel && (confirmRemove === t.tractor
                      ? <span className="am-teamremove-c"><span className="am-muted">Remove?</span>
                          <button className="fleet-del" title="Remove team" onClick={() => { removeTruck(t.tractor); setConfirmRemove(null); }}>✓</button>
                          <button className="am-clear" title="Keep" onClick={() => setConfirmRemove(null)}>✕</button></span>
                      : <button className="am-teamremove" title="Remove this team from the board (not running / not utilized)" onClick={() => setConfirmRemove(t.tractor)}>✕</button>)}
                    <button className="am-teamdone" title="Done editing" onClick={() => { setEditRow(null); setConfirmRemove(null); setMoving(null); }}>✓ Done</button>
                  </span>
                : <button className="am-teameditbtn" title="Edit — confirm drivers, send flyer, move to next week (prevents accidental clicks)" onClick={() => setEditRow(t.tractor)}>✎</button>}
            </div>
            {editing && moving === t.tractor && (
              <div className="am-teammove">
                <span className="am-muted">Next wk — {[t.driver1, t.driver2].filter(Boolean).map((n) => n.split(' ')[0]).join(' / ') || 'team'} on truck #</span>
                <input className="am-input" style={{ maxWidth: 78 }} value={moveTruck} autoFocus placeholder="new #"
                  onChange={(e) => setMoveTruck(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && moveTruck.trim()) { saveTruck({ ...t, tractor: moveTruck.trim(), confirm1: false, confirm2: false, flyer: '' }); setMoving(null); setEditRow(null); advanceWeek(); flash(`✓ ${[t.driver1, t.driver2].filter(Boolean).map((n) => n.split(' ')[0]).join(' / ')} carried to next week on #${moveTruck.trim()}.`); } if (e.key === 'Escape') setMoving(null); }} />
                <button className="am-save" disabled={!moveTruck.trim()} title="Create the team on the new truck for next week (drivers kept)"
                  onClick={() => { saveTruck({ ...t, tractor: moveTruck.trim(), confirm1: false, confirm2: false, flyer: '' }); setMoving(null); setEditRow(null); advanceWeek(); flash(`✓ ${[t.driver1, t.driver2].filter(Boolean).map((n) => n.split(' ')[0]).join(' / ')} carried to next week on #${moveTruck.trim()}.`); }}>✓ Move</button>
                <button className="am-clear" onClick={() => setMoving(null)}>✕</button>
              </div>
            )}
            {outOfService && <div className="am-oosbadge" title="Blocked from assignment — clear on the Out of Service page">🛠 OUT OF SERVICE · Fleetio</div>}
            {editing ? (
              <>
                <div className="am-drivers-confirm">
                  {t.driver1 && <label className={`am-driverchk ${nameCls(!!t.confirm1)}`}><input type="checkbox" checked={!!t.confirm1} onChange={(e) => saveTruck({ ...t, confirm1: e.target.checked })} />{t.driver1}{p1 && <span className="am-poschip">{p1}</span>}</label>}
                  {t.driver2 && <label className={`am-driverchk ${nameCls(!!t.confirm2)}`}><input type="checkbox" checked={!!t.confirm2} onChange={(e) => saveTruck({ ...t, confirm2: e.target.checked })} />{t.driver2}{p2 && <span className="am-poschip">{p2}</span>}</label>}
                </div>
                <div className="am-flyerrow">
                  <select className="am-flyersel" value={t.flyer || ''} onChange={(e) => saveTruck({ ...t, flyer: e.target.value as FleetTruck['flyer'] })} title="Dispatch flyer status — drivers turn yellow when sent, green when confirmed">
                    <option value="">— no flyer —</option>
                    <option value="driver">Flyer sent → driver</option>
                    <option value="team">Flyer sent → team</option>
                  </select>
                  {hasFlyer && <span className={`am-confirmpct ${pct === 100 ? 'full' : ''}`}>{pct}% confirmed</span>}
                </div>
              </>
            ) : (
              <>
                <div className="am-drivers-ro">
                  {t.driver1 && <span className={`am-drvro ${t.confirm1 ? 'ok' : hasFlyer ? 'flyer' : ''}`}>{t.confirm1 ? '✓ ' : hasFlyer ? '• ' : ''}{t.driver1}{p1 && <span className="am-poschip">{p1}</span>}</span>}
                  {t.driver2 && <span className={`am-drvro ${t.confirm2 ? 'ok' : hasFlyer ? 'flyer' : ''}`}>{t.confirm2 ? '✓ ' : hasFlyer ? '• ' : ''}{t.driver2}{p2 && <span className="am-poschip">{p2}</span>}</span>}
                  {!t.driver1 && !t.driver2 && <span className="am-muted">—</span>}
                </div>
                {hasFlyer && <div className="am-flyerrow-ro"><span className="am-flyer-ro-lab">✈ Flyer sent → {t.flyer === 'team' ? 'team' : 'driver'}</span><span className={`am-confirmpct ${pct === 100 ? 'full' : ''}`}>{pct}% confirmed</span></div>}
              </>
            )}
            <div className="am-ttype">{t.type}</div>
            {!down && hasUndispatchedRoute
              ? <div className="am-teamstatus am-ntd" title="Has a route assigned but not dispatched yet">Assigned — NTD</div>
              : meta.onMatrix && <div className="am-teamstatus" style={{ color: meta.color, background: meta.tint }}>{statusLabel}</div>}
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
                    style={{ borderLeftColor: STATUS_COLOR[a.status], '--sc': STATUS_COLOR[a.status] } as CSSProperties}
                    draggable
                    onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', k); }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!canDel) { flash('🔒 Deleting a load is restricted — unlock delete access in the header.'); return; } setConfirmClear(k); }}
                    title={canDel ? 'Drag to an empty day to move · right-click to clear' : 'Drag to an empty day to move · deleting is restricted'}
                  >
                    <div className="am-route">
                      {a.route}
                      {a.usps && <span className="am-usps">USPS</span>}
                      {/* PHASE 1: a multi-leg load writes a cell on every truck row
                          it touches. This chip is what stops those rows reading as
                          separate loads — same load, different leg. */}
                      {(a.legCount ?? 0) > 1 && (
                        <span className="am-legchip" title={`This load runs ${a.legCount} legs — this row is leg ${a.legIndex}. The other legs sit on their own trucks' rows.`}>
                          leg {a.legIndex} of {a.legCount}
                        </span>
                      )}
                    </div>
                    <div className="am-status" style={{ color: STATUS_COLOR[a.status] }}>{STATUS_LABEL[a.status] ?? a.status}</div>
                    {(() => { const ld = loads.get(k); const tr = (ld?.assignedTrailer || '').trim();
                      return tr ? <div className="am-trailer" title={`Trailer #${tr} on this route`}>🚟 #{tr}</div> : null; })()}
                    {(() => {
                      const ld = loads.get(k); const dc = ld ? (docCounts[ld.id] ?? 0) : 0;
                      return (
                        <div className="am-chipbadges">
                          {/* PHASE 2 fast-log: one tap moves the truck along without
                              opening the modal. Stops propagation so the cell's own
                              click (open the load) still works everywhere else. */}
                          {ld && (
                            <span className="am-fastwrap">
                              <button className="am-fastbtn" title="Quick-log the next required milestone"
                                onClick={(e) => { e.stopPropagation(); setFastLog(fastLog === k ? null : k); }}>⚡</button>
                              {fastLog === k && (
                                <FastLog load={ld} onClose={() => setFastLog(null)} onLogged={() => setFastLog(null)} />
                              )}
                            </span>
                          )}
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
                ) : (() => {
                  const prevA = di > 0 ? assign[cellKey(t.tractor, dates[di - 1])] : undefined;
                  if (down || outOfService || !prevA || !prevA.route.trim()) return <span className="am-add">+</span>;
                  const dest = parseRoute(prevA.route).destination;
                  const fromCity = dest?.name || '';
                  if (!fromCity) return <span className="am-add">+</span>;
                  const hos = hosByTruck[t.tractor] ?? t.hoursAvail ?? 0;
                  const soloTruck = !(t.driver2 || '').trim();   // solo → solo trips only (≤550 mi)
                  const sugs = nextRouteSuggestions(fromCity, t.homeCity, hos, 600, 5, soloTruck);
                  if (sugs.length === 0) return <span className="am-add">+</span>;
                  const open = sugCell === k;
                  return (
                    <div className="am-suggest">
                      <button className="am-suggest-badge" title={`Route Optimizer — next-load ideas from ${cityTitle(fromCity)}, gated by ${hos.toFixed(1)}h HOS`}
                        onClick={(e) => { e.stopPropagation(); setSugCell(open ? null : k); }}>
                        🧭 {sugs.length} optimized route suggestions
                      </button>
                      {open && (
                        <div className="am-suggest-pop" onClick={(e) => e.stopPropagation()}>
                          <div className="am-suggest-head">Next load from {cityTitle(fromCity)} · {hos.toFixed(1)}h HOS left</div>
                          {sugs.map((s: Match, i: number) => (
                            <button key={i} className={`am-suggest-item ${s.ok ? '' : 'over'}`}
                              title={s.ok ? 'Fits remaining hours — click to assign' : 'Exceeds remaining HOS — click to assign anyway'}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (soloTruck && isTeamTrip(s) && !canApproveSoloOverride()) {
                                  flash(`⛔ #${t.tractor} is a SOLO driver — that's a TEAM trip (over ${SOLO_MAX_MILES} mi). An FMT Lead or US Ops must approve it.`);
                                  return;
                                }
                                save(k, { route: s.route, status: 'covered', usps: /fa\w+|hcr/i.test(s.route) }); setSugCell(null);
                              }}>
                              <span className="am-suggest-rank">{i + 1}</span>
                              <span className="am-suggest-main">
                                <span className="am-suggest-route">{tripCode(s.route) || s.route}</span>
                                <span className="am-suggest-meta">{s.oN || '—'} → {s.dN || '—'} · DH {s.dh}mi · {s.hrs}h{s.ok ? '' : ' · over HOS'}</span>
                              </span>
                            </button>
                          ))}
                          <div className="am-suggest-foot">Ranked by available hours · from Route Optimizer</div>
                        </div>
                      )}
                    </div>
                  );
                })()}
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


