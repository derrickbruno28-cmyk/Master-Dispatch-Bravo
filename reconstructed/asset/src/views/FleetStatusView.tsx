import { useMemo, useState } from 'react';
import {
  loadFleet, saveTruck, removeTruck, blankTruck, TERMINAL_LABELS,
  type FleetTruck,
} from '../data/fleetStore';
import { driverNames, driverByName } from '../data/driversStore';
import { getOptions, addOption, type OptionKind } from '../data/optionsStore';

/* Fleet Status = the team admin console. Add / edit / remove teams. Driver names
   autofill from the Master Drivers List; the Type / Home terminal / Status
   dropdowns are editable (add your own options). The bottom box is TEAM / ROUTE
   NOTES (driver constraints live on the Master Drivers List and show next to the
   driver's name). Set Status = "shutdown" to red-flag the team and block dispatch. */

const STATUS_CLR: Record<string, string> = {
  dispatched: 'var(--green)', 'en route': 'var(--accent)', delivering: 'var(--amber)',
  'on 34hr reset': 'var(--red)', available: '#00b8d4', shutdown: 'var(--red)',
};

function withConstraint(name: string): React.ReactNode {
  const c = driverByName(name)?.constraints;
  return <span>{name}{c ? <span className="drv-con"> ({c})</span> : null}</span>;
}

export default function FleetStatusView() {
  const [fleet, setFleet] = useState<FleetTruck[]>(() => loadFleet());
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<FleetTruck | null>(null);
  const [isNew, setIsNew] = useState(false);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return fleet.filter((t) => !n || `${t.tractor} ${t.driver1} ${t.driver2} ${t.homeCity} ${t.currentCity} ${t.constraints}`.toLowerCase().includes(n));
  }, [fleet, q]);

  function commit(t: FleetTruck) {
    if (!t.tractor.trim()) { window.alert('Tractor # is required.'); return; }
    setFleet(saveTruck(t)); setEditing(null);
  }
  function del(t: FleetTruck) {
    if (!window.confirm(`Remove team #${t.tractor} (${t.driver1 || 'no driver'})?`)) return;
    setFleet(removeTruck(t.tractor));
  }

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Fleet Status</h2>
        <input className="am-input" style={{ maxWidth: 220 }} placeholder="Search team / driver / city…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="am-muted">{rows.length} of {fleet.length} teams</span>
        <button className="am-save fleet-add" onClick={() => { setEditing(blankTruck()); setIsNew(true); }}>＋ Add Team</button>
      </div>

      <div className="am-scroll">
        <table className="am-grid am-fleet">
          <thead>
            <tr><th>Tractor</th><th>Drivers (constraints)</th><th>Type</th><th>Home terminal</th><th>Current</th><th>Hrs</th><th>Status</th><th>Team / route notes</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.tractor} className={t.status === 'shutdown' ? 'fleet-shutdown' : ''}>
                <td className="am-tractor">#{t.tractor} <span className="am-rating">{t.rating}</span></td>
                <td>{[t.driver1, t.driver2].filter(Boolean).map((n, i) => <span key={i}>{i > 0 && ' · '}{withConstraint(n)}</span>)}{!t.driver1 && !t.driver2 && <span className="am-muted">—</span>}</td>
                <td className="am-muted">{t.type}</td>
                <td>{TERMINAL_LABELS[t.homeCity] ?? t.homeCity}</td>
                <td className="am-muted">{t.currentCity}</td>
                <td style={{ color: t.hoursAvail === 0 ? 'var(--red)' : t.hoursAvail < 20 ? 'var(--amber)' : 'var(--green)' }}>{t.hoursAvail}</td>
                <td><span className="am-pill" style={{ color: STATUS_CLR[t.status] ?? 'var(--text)' }}>{t.status === 'shutdown' ? '⛔ shutdown' : t.status}</span></td>
                <td className="fleet-constraints">{t.constraints || <span className="am-muted">—</span>}</td>
                <td className="fleet-actions">
                  <button className="am-clear" onClick={() => { setEditing({ ...t }); setIsNew(false); }}>✎ Edit</button>
                  <button className="fleet-del" onClick={() => del(t)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <TruckEditor truck={editing} isNew={isNew} onSave={commit} onCancel={() => setEditing(null)} />}
    </div>
  );
}

/* editable dropdown: options come from the options store; ＋ adds a new one */
function OptSelect({ kind, value, onChange }: { kind: OptionKind; value: string; onChange: (v: string) => void }) {
  const [opts, setOpts] = useState<string[]>(() => getOptions(kind));
  function add() {
    const v = window.prompt(`Add a new ${kind} option:`);
    if (v && v.trim()) { const next = addOption(kind, v); setOpts(next); onChange(v.trim()); }
  }
  return (
    <div className="opt-select-row">
      <select className="am-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {!opts.includes(value) && value && <option value={value}>{value}</option>}
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <button type="button" className="opt-add-btn" title={`Add a ${kind} option`} onClick={add}>＋</button>
    </div>
  );
}

function TruckEditor({ truck, isNew, onSave, onCancel }: { truck: FleetTruck; isNew: boolean; onSave: (t: FleetTruck) => void; onCancel: () => void }) {
  const [t, setT] = useState<FleetTruck>(truck);
  const names = useMemo(() => driverNames(), []);
  function f<K extends keyof FleetTruck>(k: K, v: FleetTruck[K]) { setT((p) => ({ ...p, [k]: v })); }
  return (
    <div className="fleet-modal-back" onClick={onCancel}>
      <div className="fleet-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Add Team' : `Edit Team #${truck.tractor}`}</h3>
        <div className="fleet-form-grid">
          <L t="Tractor #"><input className="am-input" value={t.tractor} disabled={!isNew} onChange={(e) => f('tractor', e.target.value)} /></L>
          <L t="Truck rating"><input className="am-input" value={t.rating} onChange={(e) => f('rating', e.target.value)} /></L>
          <L t="Driver 1 (autofills from roster)"><input className="am-input" list="fleet-drivers" value={t.driver1} onChange={(e) => f('driver1', e.target.value)} /></L>
          <L t="Driver 2 (autofills from roster)"><input className="am-input" list="fleet-drivers" value={t.driver2} onChange={(e) => f('driver2', e.target.value)} /></L>
          <L t="Type"><OptSelect kind="type" value={t.type} onChange={(v) => f('type', v)} /></L>
          <L t="Home terminal"><OptSelect kind="terminal" value={t.homeCity} onChange={(v) => f('homeCity', v)} /></L>
          <L t="Current city (empty / standby location)"><input className="am-input" value={t.currentCity} onChange={(e) => f('currentCity', e.target.value.toUpperCase())} /></L>
          <L t="Hours available"><input className="am-input" type="number" value={t.hoursAvail} onChange={(e) => f('hoursAvail', Number(e.target.value))} /></L>
          <L t="Status (set 'shutdown' to block dispatch)"><OptSelect kind="status" value={t.status} onChange={(v) => f('status', v)} /></L>
        </div>
        <datalist id="fleet-drivers">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <L t="Team / route notes (shows on the Asset Matrix)">
          <textarea className="am-input" rows={2} value={t.constraints} onChange={(e) => f('constraints', e.target.value)} />
        </L>
        <div className="fleet-modal-btns">
          <button className="am-save" onClick={() => onSave(t)}>{isNew ? 'Add team' : 'Save changes'}</button>
          <button className="am-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="otp-field" style={{ marginTop: 4 }}><span className="otp-field-label">{t}</span>{children}</label>;
}
