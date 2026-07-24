import { useEffect, useMemo, useState } from 'react';
import { loadFleet, saveTruck, removeTruck, blankTruck, TRUCK_TYPES, TERMINALS, TERMINAL_LABELS, type FleetTruck } from '../data/fleetStore';
import { canDelete } from '../data/permStore';
import { onChange } from '../data/bus';

/* Trucks — the tractor roster (equipment-centric). Truck #, type, rating, home
   terminal and where it is now. Team make-up (which two drivers) is managed on
   Team Status; this page is the master list of the trucks themselves. */

export default function TrucksView() {
  const [fleet, setFleet] = useState<FleetTruck[]>(() => loadFleet());
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<FleetTruck | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [canDel, setCanDel] = useState<boolean>(() => canDelete());

  useEffect(() => onChange(() => { setFleet(loadFleet()); setCanDel(canDelete()); }), []);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return fleet
      .filter((t) => !n || `${t.tractor} ${t.type} ${t.rating} ${t.homeCity} ${t.currentCity} ${t.driver1} ${t.driver2}`.toLowerCase().includes(n))
      .slice().sort((a, b) => a.tractor.localeCompare(b.tractor, undefined, { numeric: true }));
  }, [fleet, q]);

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Trucks</h2>
        <input className="am-input" style={{ maxWidth: 220 }} placeholder="Search truck / type / city…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="am-muted">{rows.length} of {fleet.length} trucks</span>
        <button className="am-save fleet-add" onClick={() => { setEditing(blankTruck()); setIsNew(true); }}>＋ Add Truck</button>
      </div>

      <div className="am-scroll">
        <table className="am-grid am-fleet">
          <thead><tr><th>Truck #</th><th>Type</th><th>Rating</th><th>Home terminal</th><th>Current</th><th>Drivers (team)</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="am-muted" style={{ textAlign: 'center', padding: 16 }}>No trucks.</td></tr>}
            {rows.map((t) => (
              <tr key={t.tractor}>
                <td className="am-tractor">#{t.tractor}</td>
                <td className="am-muted">{t.type}</td>
                <td>{t.rating || <span className="am-muted">—</span>}</td>
                <td>{TERMINAL_LABELS[t.homeCity] ?? t.homeCity}</td>
                <td className="am-muted">{t.currentCity || '—'}</td>
                <td>{[t.driver1, t.driver2].filter(Boolean).join(' · ') || <span className="am-muted">unassigned</span>}</td>
                <td className="fleet-actions">
                  {confirmDel === t.tractor ? (
                    <>
                      <span className="am-muted" style={{ fontSize: 10.5 }}>Remove?</span>
                      <button className="fleet-del" onClick={() => { setFleet(removeTruck(t.tractor)); setConfirmDel(null); }}>✓</button>
                      <button className="am-clear" onClick={() => setConfirmDel(null)}>✕</button>
                    </>
                  ) : (
                    <>
                      <button className="am-clear" onClick={() => { setEditing({ ...t }); setIsNew(false); }}>✎ Edit</button>
                      {canDel
                        ? <button className="fleet-del" onClick={() => setConfirmDel(t.tractor)}>🗑</button>
                        : <button className="fleet-del" disabled title="Removing is restricted to FMT Lead / US Ops / Owner">🔒</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <TruckEquipEditor truck={editing} isNew={isNew} onSave={(t) => { setFleet(saveTruck(t)); setEditing(null); }} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function TruckEquipEditor({ truck, isNew, onSave, onCancel }: { truck: FleetTruck; isNew: boolean; onSave: (t: FleetTruck) => void; onCancel: () => void }) {
  const [t, setT] = useState<FleetTruck>(truck);
  const f = <K extends keyof FleetTruck>(k: K, v: FleetTruck[K]) => setT((p) => ({ ...p, [k]: v }));
  return (
    <div className="fleet-modal-back" onClick={onCancel}>
      <div className="fleet-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Add Truck' : `Edit Truck #${truck.tractor}`}</h3>
        <div className="fleet-form-grid">
          <label className="otp-field"><span className="otp-field-label">Truck #</span>
            <input className="am-input" value={t.tractor} disabled={!isNew} onChange={(e) => f('tractor', e.target.value)} placeholder="e.g. 512" /></label>
          <label className="otp-field"><span className="otp-field-label">Rating</span>
            <input className="am-input" value={t.rating} onChange={(e) => f('rating', e.target.value)} placeholder="e.g. A" /></label>
          <label className="otp-field"><span className="otp-field-label">Type</span>
            <select className="am-input" value={t.type} onChange={(e) => f('type', e.target.value)}>{TRUCK_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="otp-field"><span className="otp-field-label">Home terminal</span>
            <select className="am-input" value={t.homeCity} onChange={(e) => f('homeCity', e.target.value)}>{TERMINALS.map((x) => <option key={x} value={x}>{TERMINAL_LABELS[x] ?? x}</option>)}</select></label>
          <label className="otp-field"><span className="otp-field-label">Current city</span>
            <input className="am-input" value={t.currentCity} onChange={(e) => f('currentCity', e.target.value.toUpperCase())} /></label>
        </div>
        <div className="fleet-modal-btns">
          <button className="am-save" disabled={!t.tractor.trim()} onClick={() => onSave(t)}>{isNew ? 'Add truck' : 'Save changes'}</button>
          <button className="am-cancel" onClick={onCancel}>Cancel</button>
          {!t.tractor.trim() && <span className="am-muted" style={{ fontSize: 11, color: 'var(--red)' }}>Truck # is required.</span>}
        </div>
      </div>
    </div>
  );
}
