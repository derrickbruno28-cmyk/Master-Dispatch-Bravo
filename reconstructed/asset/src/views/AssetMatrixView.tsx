import { useMemo, useState } from 'react';
import { TRUCKS, TERMINALS, TERMINAL_LABELS, type Truck } from '../data/fleet';

/* Asset Matrix — the Bravo-format scheduling board for our OWN trucks.
   Rows = trucks grouped by home terminal (SA / Dallas / Memphis / Houston);
   columns = days Mon→Sun, left→right; every cell is an editable assignment
   (route/load + status, flagged USPS or not). In-memory for the demo; Phase 2
   persists each cell to the SHARED Firestore as a status:'asset' load so a USPS
   assignment shows in Bravo automatically (the "coincide" mechanism). */

type Status = 'open' | 'covered' | 'dispatched' | 'departed' | 'delivered' | 'off';
const STATUSES: Status[] = ['open', 'covered', 'dispatched', 'departed', 'delivered', 'off'];
const STATUS_COLOR: Record<Status, string> = {
  open: 'var(--muted)',
  covered: 'var(--green)',
  dispatched: '#00b8d4',
  departed: 'var(--accent)',
  delivered: '#6b7f9e',
  off: 'var(--panel-2)',
};
const STATUS_LABEL: Record<Status, string> = {
  open: 'Open', covered: 'Covered', dispatched: 'Dispatched',
  departed: 'Departed', delivered: 'Delivered', off: 'Off / Home',
};

interface Assignment { route: string; status: Status; usps: boolean }
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* Monday-anchored week (local). Phase 3 swaps this for Bravo's Central/UTC
   dates.ts helpers so both boards key loads to the exact same day. */
function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function mondayOf(d: Date) { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const key = (tractor: string, date: string) => `${tractor}_${date}`;

function seed(): Record<string, Assignment> {
  const out: Record<string, Assignment> = {};
  const mon = mondayOf(new Date());
  const put = (tractor: string, dayIdx: number, a: Assignment) => { out[key(tractor, isoDate(addDays(mon, dayIdx)))] = a; };
  put('447', 0, { route: 'FA2D3-1 Coppell→Memphis', status: 'dispatched', usps: true });
  put('456', 1, { route: 'FA2D3-544 Irving→SATX', status: 'covered', usps: true });
  put('758', 2, { route: '16193 Opa-Irv', status: 'departed', usps: false });
  put('958', 0, { route: 'FA2D3-354 Memphis→Nashville', status: 'covered', usps: true });
  put('444', 3, { route: '34hr reset — Houston', status: 'off', usps: false });
  return out;
}

export default function AssetMatrixView() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [assign, setAssign] = useState<Record<string, Assignment>>(seed);
  const [editing, setEditing] = useState<string | null>(null);

  const dates = useMemo(
    () => DAYS.map((_, i) => isoDate(addDays(weekStart, i))),
    [weekStart],
  );
  const byTerminal = useMemo(() => {
    const m: Record<string, Truck[]> = {};
    for (const term of TERMINALS) m[term] = [];
    for (const t of TRUCKS) (m[t.homeCity] ?? (m[t.homeCity] = [])).push(t);
    return m;
  }, []);

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  function save(k: string, a: Assignment) {
    setAssign((prev) => {
      const next = { ...prev };
      if (!a.route.trim()) delete next[k]; else next[k] = a;
      return next;
    });
    setEditing(null);
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
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TERMINALS.map((term) => (
              <TerminalRows
                key={term}
                term={term}
                trucks={byTerminal[term] ?? []}
                dates={dates}
                assign={assign}
                editing={editing}
                setEditing={setEditing}
                save={save}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TerminalRows({ term, trucks, dates, assign, editing, setEditing, save }: {
  term: string; trucks: Truck[]; dates: string[];
  assign: Record<string, Assignment>; editing: string | null;
  setEditing: (k: string | null) => void; save: (k: string, a: Assignment) => void;
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
          {dates.map((d) => {
            const k = key(t.tractor, d);
            const a = assign[k];
            if (editing === k) return <td key={d} className="am-cell"><CellEditor init={a} onSave={(x) => save(k, x)} onCancel={() => setEditing(null)} /></td>;
            return (
              <td key={d} className="am-cell" onClick={() => setEditing(k)}>
                {a ? (
                  <div className="am-assign" style={{ borderLeftColor: STATUS_COLOR[a.status] }}>
                    <div className="am-route">{a.route}{a.usps && <span className="am-usps">USPS</span>}</div>
                    <div className="am-status" style={{ color: STATUS_COLOR[a.status] }}>{STATUS_LABEL[a.status]}</div>
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
  const [status, setStatus] = useState<Status>(init?.status ?? 'covered');
  const [usps, setUsps] = useState(init?.usps ?? true);
  return (
    <div className="am-editor" onClick={(e) => e.stopPropagation()}>
      <input className="am-input" autoFocus placeholder="Route / load (e.g. FA2D3-544)" value={route}
        onChange={(e) => setRoute(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSave({ route, status, usps }); if (e.key === 'Escape') onCancel(); }} />
      <select className="am-input" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      <label className="am-usps-check"><input type="checkbox" checked={usps} onChange={(e) => setUsps(e.target.checked)} /> USPS contract route</label>
      <div className="am-editor-btns">
        <button className="am-save" onClick={() => onSave({ route, status, usps })}>Save</button>
        <button className="am-clear" onClick={() => onSave({ route: '', status, usps })}>Clear</button>
        <button className="am-cancel" onClick={onCancel}>✕</button>
      </div>
    </div>
  );
}
