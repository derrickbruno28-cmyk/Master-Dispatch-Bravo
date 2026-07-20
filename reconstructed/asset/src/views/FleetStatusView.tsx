import { useMemo, useState } from 'react';
import {
  loadFleet, saveTruck, removeTruck, blankTruck, TRUCK_TYPES, TERMINALS, TERMINAL_LABELS,
  type FleetTruck,
} from '../data/fleetStore';

/* Fleet Status = the admin console. Add / edit / remove teams; set driver names,
   home terminal, hours, and per-team constraints. Everything the Asset Matrix and
   Route Optimizer read comes from here, so edits flow through the whole app. */

const STATUS_CLR: Record<string, string> = {
  dispatched: 'var(--green)', 'en route': 'var(--accent)', delivering: 'var(--amber)',
  'on 34hr reset': 'var(--red)', available: '#00b8d4',
};

export default function FleetStatusView() {
  const [fleet, setFleet] = useState<FleetTruck[]>(() => loadFleet());
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<FleetTruck | null>(null);
  const [isNew, setIsNew] = useState(false);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return fleet.filter((t) => !n || `${t.tractor} ${t.driver1} ${t.driver2} ${t.homeCity} ${t.currentCity} ${t.constraints}`.toLowerCase().includes(n));
  }, [fleet, q]);

  function openAdd() { setEditing(blankTruck()); setIsNew(true); }
  function openEdit(t: FleetTruck) { setEditing({ ...t }); setIsNew(false); }
  function commit(t: FleetTruck) {
    if (!t.tractor.trim()) { window.alert('Tractor # is required.'); return; }
    setFleet(saveTruck(t));
    setEditing(null);
  }
  function del(t: FleetTruck) {
    if (!window.confirm(`Remove team #${t.tractor} (${t.driver1 || 'no driver'})?`)) return;
    setFleet(removeTruck(t.tractor));
  }

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Fleet Status</h2>
        <input className="am-input" style={{ maxWidth: 240 }} placeholder="Search truck / driver / city / constraint…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="am-muted">{rows.length} of {fleet.length} teams</span>
        <button className="am-save fleet-add" onClick={openAdd}>＋ Add Team</button>
      </div>

      <div className="am-scroll">
        <table className="am-grid am-fleet">
          <thead>
            <tr>
              <th>Tractor</th><th>Drivers</th><th>Type</th><th>Home terminal</th>
              <th>Current</th><th>Hrs</th><th>Status</th><th>Constraints</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.tractor}>
                <td className="am-tractor">#{t.tractor} <span className="am-rating">{t.rating}</span></td>
                <td>{[t.driver1, t.driver2].filter(Boolean).join(' · ') || <span className="am-muted">—</span>}</td>
                <td className="am-muted">{t.type}</td>
                <td>{TERMINAL_LABELS[t.homeCity] ?? t.homeCity}</td>
                <td className="am-muted">{t.currentCity}</td>
                <td style={{ color: t.hoursAvail === 0 ? 'var(--red)' : t.hoursAvail < 20 ? 'var(--amber)' : 'var(--green)' }}>{t.hoursAvail}</td>
                <td><span className="am-pill" style={{ color: STATUS_CLR[t.status] ?? 'var(--text)' }}>{t.status}</span></td>
                <td className="fleet-constraints">{t.constraints || <span className="am-muted">—</span>}</td>
                <td className="fleet-actions">
                  <button className="am-clear" onClick={() => openEdit(t)}>✎ Edit</button>
                  <button className="fleet-del" onClick={() => del(t)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <TruckEditor truck={editing} isNew={isNew} onSave={commit} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}

function TruckEditor({ truck, isNew, onSave, onCancel }: { truck: FleetTruck; isNew: boolean; onSave: (t: FleetTruck) => void; onCancel: () => void }) {
  const [t, setT] = useState<FleetTruck>(truck);
  function f<K extends keyof FleetTruck>(k: K, v: FleetTruck[K]) { setT((p) => ({ ...p, [k]: v })); }
  return (
    <div className="fleet-modal-back" onClick={onCancel}>
      <div className="fleet-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Add Team' : `Edit Team #${truck.tractor}`}</h3>
        <div className="fleet-form-grid">
          <L t="Tractor #"><input className="am-input" value={t.tractor} disabled={!isNew} onChange={(e) => f('tractor', e.target.value)} /></L>
          <L t="Rating"><input className="am-input" value={t.rating} onChange={(e) => f('rating', e.target.value)} /></L>
          <L t="Driver 1"><input className="am-input" value={t.driver1} onChange={(e) => f('driver1', e.target.value)} /></L>
          <L t="Driver 2"><input className="am-input" value={t.driver2} onChange={(e) => f('driver2', e.target.value)} /></L>
          <L t="Type"><select className="am-input" value={t.type} onChange={(e) => f('type', e.target.value)}>{TRUCK_TYPES.map((x) => <option key={x}>{x}</option>)}</select></L>
          <L t="Home terminal"><select className="am-input" value={t.homeCity} onChange={(e) => f('homeCity', e.target.value)}>{TERMINALS.map((x) => <option key={x} value={x}>{TERMINAL_LABELS[x] ?? x}</option>)}</select></L>
          <L t="Current city"><input className="am-input" value={t.currentCity} onChange={(e) => f('currentCity', e.target.value.toUpperCase())} /></L>
          <L t="Hours available"><input className="am-input" type="number" value={t.hoursAvail} onChange={(e) => f('hoursAvail', Number(e.target.value))} /></L>
          <L t="Status"><select className="am-input" value={t.status} onChange={(e) => f('status', e.target.value)}><option>available</option><option>dispatched</option><option>en route</option><option>delivering</option><option>on 34hr reset</option></select></L>
        </div>
        <L t="Driver constraints (e.g. no NYC · solo only · hazmat · home by Fri)">
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
