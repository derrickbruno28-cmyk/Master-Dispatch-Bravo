import { useEffect, useMemo, useState } from 'react';
import { loadFleet, saveTruck, removeTruck, blankTruck, TRUCK_TYPES, TERMINALS, TERMINAL_LABELS, type FleetTruck } from '../data/fleetStore';
import { canDelete } from '../data/permStore';
import { onChange } from '../data/bus';
import { fleetioClient, localOosList, setLocalOos, type ServiceStatus } from '../integrations/telematics';
import { emitChange } from '../data/bus';
import { importFromFleetio } from '../data/fleetioSync';
import { MAKE_LABEL, normMake } from '../data/truckRating';

/* Trucks — the tractor roster (equipment-centric) + Fleetio unit data. Each unit
   carries an A/B/C/D rating by odometer, its live odometer (read from Fleetio
   hourly, never written back), and in-service / out-of-service status. Team
   make-up is managed on Team Status. */

export default function TrucksView() {
  const [fleet, setFleet] = useState<FleetTruck[]>(() => loadFleet());
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<FleetTruck | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [canDel, setCanDel] = useState<boolean>(() => canDelete());
  const [svc, setSvc] = useState<Record<string, ServiceStatus>>({});
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const fio = fleetioClient();

  useEffect(() => onChange(() => { setFleet(loadFleet()); setCanDel(canDelete()); }), []);
  useEffect(() => { void fio.serviceStatuses().then((list) => setSvc(Object.fromEntries(list.map((s) => [s.truck, s.status])))); }, [fleet]); // eslint-disable-line react-hooks/exhaustive-deps

  /* mark in / out of service — a local override on top of Fleetio's status
     (the Out-of-Service page folded into Trucks). Blocks matrix assignment. */
  function toggleService(truck: string, oos: boolean) {
    setLocalOos(truck, oos);
    emitChange();
    void fio.serviceStatuses().then((list) => setSvc(Object.fromEntries(list.map((s) => [s.truck, s.status]))));
  }
  const oosCount = Object.values(svc).filter((s) => s === 'out_of_service').length;

  async function runImport() {
    setImporting(true);
    const r = await importFromFleetio();
    setImporting(false);
    setNotice(`✓ Fleetio import — ${r.created} new profile${r.created === 1 ? '' : 's'} created, ${r.updated} updated (odometer + make) from ${r.total} units. Rate them manually in each profile.`);
    window.setTimeout(() => setNotice(''), 5000);
  }

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return fleet
      .filter((t) => !n || `${t.tractor} ${t.type} ${t.unitRating} ${t.homeCity} ${t.currentCity} ${t.driver1} ${t.driver2}`.toLowerCase().includes(n))
      .slice().sort((a, b) => a.tractor.localeCompare(b.tractor, undefined, { numeric: true }));
  }, [fleet, q]);

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Trucks</h2>
        <input className="am-input" style={{ maxWidth: 200 }} placeholder="Search truck / rating / city…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="am-muted">{rows.length} of {fleet.length} trucks · {oosCount} out of service</span>
        <span className="fleet-io-badge" title="Fleetio is read-only — Asset Matrix never writes to Fleetio">🔗 {fio.label}</span>
        <button className="am-clear" disabled={importing} title="Create a profile for every Fleetio unit + pull odometer &amp; make (read-only). Units import unrated — rate them manually." onClick={runImport}>⤓ {importing ? 'Importing…' : 'Import from Fleetio'}</button>
        <button className="am-save fleet-add" onClick={() => { setEditing(blankTruck()); setIsNew(true); }}>＋ Add Truck</button>
      </div>
      {notice && <div className="am-notice">{notice}</div>}
      <div className="am-muted" style={{ fontSize: 11.5, margin: '2px 0 10px' }}>
        Your fleet, imported from Fleetio. Make &amp; service refresh from Fleetio. <b>Out-of-service / in-shop units can't be assigned</b> on the Asset Matrix (in / out of service is managed right here).
      </div>

      <div className="am-scroll">
        <table className="am-grid am-fleet">
          <thead><tr><th>Truck #</th><th>Make</th><th>Service</th><th>Type</th><th>Home</th><th>Drivers (team)</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="am-muted" style={{ textAlign: 'center', padding: 16 }}>No trucks.</td></tr>}
            {rows.map((t) => {
              const oos = svc[t.tractor] === 'out_of_service';
              return (
              <tr key={t.tractor} className={oos ? 'fleet-shutdown' : ''}>
                <td className="am-tractor">#{t.tractor}</td>
                <td className="am-muted">{t.make ? MAKE_LABEL[normMake(t.make)] : '—'}</td>
                <td>
                  <div className="svc-cell">
                    {oos
                      ? <span className="am-pill" style={{ color: 'var(--red)' }}>⛔ Out of service</span>
                      : <span className="am-pill" style={{ color: 'var(--green)' }}>● In service</span>}
                    {localOosList().includes(t.tractor)
                      ? <button className="am-clear svc-toggle" title="Return this unit to service" onClick={() => toggleService(t.tractor, false)}>↩ In service</button>
                      : !oos && <button className="am-clear svc-toggle" title="Mark this unit out of service (blocks matrix assignment)" onClick={() => toggleService(t.tractor, true)}>⛔ Mark OOS</button>}
                  </div>
                </td>
                <td className="am-muted">{t.type}</td>
                <td>{TERMINAL_LABELS[t.homeCity] ?? t.homeCity}</td>
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
              );
            })}
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
          <label className="otp-field"><span className="otp-field-label">Make (drives the rating bands)</span>
            <input className="am-input" list="truck-makes" value={t.make ?? ''} onChange={(e) => f('make', e.target.value)} placeholder="International / Volvo / Peterbilt…" />
            <datalist id="truck-makes"><option value="International" /><option value="Volvo" /><option value="Peterbilt" /><option value="Freightliner" /></datalist></label>
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
