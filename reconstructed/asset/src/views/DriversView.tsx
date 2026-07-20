import { useMemo, useRef, useState } from 'react';
import {
  loadDrivers, saveDriver, removeDriver, blankDriver, importDriversCsv,
  DEFAULT_POSITIONS, type Driver,
} from '../data/driversStore';

/* Master Drivers List — every active driver, their position, address/phone, and
   constraints. Import the whole roster from CSV; names here autofill the Fleet
   Status team card, and constraints show next to the driver's name. */

export default function DriversView() {
  const [drivers, setDrivers] = useState<Driver[]>(() => loadDrivers());
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Driver | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return drivers.filter((d) => !n || `${d.name} ${d.position} ${d.constraints} ${d.address}`.toLowerCase().includes(n));
  }, [drivers, q]);

  function commit(d: Driver) {
    if (!d.name.trim()) { window.alert('Driver name is required.'); return; }
    setDrivers(saveDriver(d)); setEditing(null);
  }
  function del(d: Driver) {
    if (!window.confirm(`Remove ${d.name} from the master list?`)) return;
    setDrivers(removeDriver(d.id));
  }
  function runImport(text: string) {
    const res = importDriversCsv(text);
    setDrivers(loadDrivers());
    setImportMsg(`✓ Imported — ${res.added} added, ${res.updated} updated.`);
    setCsv('');
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    f.text().then(runImport);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Master Drivers List</h2>
        <input className="am-input" style={{ maxWidth: 240 }} placeholder="Search name / position / constraint…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="am-muted">{rows.length} of {drivers.length} drivers</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="am-clear" onClick={() => setImportOpen((o) => !o)}>⭳ Import</button>
          <button className="am-save" onClick={() => { setEditing(blankDriver()); setIsNew(true); }}>＋ Add Driver</button>
        </div>
      </div>

      {importOpen && (
        <div className="otp-form">
          <div className="otp-field-label" style={{ marginBottom: 6 }}>Import drivers (CSV) — columns: <b>name, position, address, phone, constraints</b> (a header row is auto-detected)</div>
          <textarea className="am-input" rows={5} placeholder={'name,position,address,phone,constraints\nJohn Smith,SATX Hero,"123 Main St, San Antonio TX",210-555-0100,no NYC'} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <div className="otp-form-btns">
            <button className="am-save" onClick={() => runImport(csv)} disabled={!csv.trim()}>Import pasted CSV</button>
            <label className="am-clear" style={{ cursor: 'pointer' }}>⭳ Upload .csv<input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={onFile} /></label>
            {importMsg && <span className="am-muted" style={{ color: 'var(--green)' }}>{importMsg}</span>}
          </div>
        </div>
      )}

      <div className="am-scroll">
        <table className="am-grid am-fleet">
          <thead><tr><th>Driver</th><th>Position</th><th>Address</th><th>Phone</th><th>Constraints</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="am-muted" style={{ textAlign: 'center', padding: 18 }}>No drivers. Add one, or Import a roster.</td></tr>
            ) : rows.map((d) => (
              <tr key={d.id}>
                <td className="am-tractor">{d.name}</td>
                <td><span className="am-pill" style={{ color: 'var(--accent)' }}>{d.position}</span></td>
                <td className="am-muted">{d.address || '—'}</td>
                <td className="am-muted">{d.phone || '—'}</td>
                <td className="fleet-constraints">{d.constraints || <span className="am-muted">—</span>}</td>
                <td className="fleet-actions">
                  <button className="am-clear" onClick={() => { setEditing({ ...d }); setIsNew(false); }}>✎ Edit</button>
                  <button className="fleet-del" onClick={() => del(d)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <DriverEditor driver={editing} isNew={isNew} onSave={commit} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function DriverEditor({ driver, isNew, onSave, onCancel }: { driver: Driver; isNew: boolean; onSave: (d: Driver) => void; onCancel: () => void }) {
  const [d, setD] = useState<Driver>(driver);
  function f<K extends keyof Driver>(k: K, v: Driver[K]) { setD((p) => ({ ...p, [k]: v })); }
  return (
    <div className="fleet-modal-back" onClick={onCancel}>
      <div className="fleet-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Add Driver' : `Edit ${driver.name}`}</h3>
        <div className="fleet-form-grid">
          <L t="Name"><input className="am-input" value={d.name} onChange={(e) => f('name', e.target.value)} /></L>
          <L t="Position"><input className="am-input" list="drv-positions" value={d.position} onChange={(e) => f('position', e.target.value)} /><datalist id="drv-positions">{DEFAULT_POSITIONS.map((p) => <option key={p} value={p} />)}</datalist></L>
          <L t="Phone"><input className="am-input" value={d.phone} onChange={(e) => f('phone', e.target.value)} /></L>
          <L t="Address"><input className="am-input" value={d.address} onChange={(e) => f('address', e.target.value)} /></L>
        </div>
        <L t="Constraints (e.g. no NYC · solo only · hazmat · home by Fri)">
          <textarea className="am-input" rows={2} value={d.constraints} onChange={(e) => f('constraints', e.target.value)} />
        </L>
        <div className="fleet-modal-btns">
          <button className="am-save" onClick={() => onSave(d)}>{isNew ? 'Add driver' : 'Save changes'}</button>
          <button className="am-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="otp-field" style={{ marginTop: 4 }}><span className="otp-field-label">{t}</span>{children}</label>;
}
