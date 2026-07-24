import { useEffect, useMemo, useState } from 'react';
import { loadFleet } from '../data/fleetStore';
import { onChange, emitChange } from '../data/bus';
import { fleetioClient, localOosList, setLocalOos, type VehicleService } from '../integrations/telematics';
import { canDelete } from '../data/permStore';

/* Out-of-Service — the maintenance board (Fleetio integration layer). A truck
   marked out of service here is LOCKED on the Asset Matrix (its row greys out
   and can't be assigned) until it's back in service. Fleetio is the source of
   truth once a token is set; until then dispatch can flag a truck locally and
   the same lock applies. */

export default function OutOfServiceView() {
  const [tick, setTick] = useState(0);
  const [services, setServices] = useState<VehicleService[]>([]);
  useEffect(() => onChange(() => setTick((n) => n + 1)), []);
  const flt = fleetioClient();
  useEffect(() => { void flt.serviceStatuses().then(setServices); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]);

  const fleet = useMemo(() => loadFleet(), [tick]);
  const overrides = useMemo(() => new Set(localOosList()), [tick, services]);
  const fleetioOos = useMemo(() => new Set(services.filter((s) => s.status === 'out_of_service' && s.source === 'fleetio').map((s) => s.truck)), [services]);
  const canEdit = canDelete();

  const rows = fleet.map((t) => {
    const localOff = overrides.has(t.tractor);
    const remoteOff = fleetioOos.has(t.tractor);
    return { t, localOff, remoteOff, oos: localOff || remoteOff };
  });
  const oosCount = rows.filter((r) => r.oos).length;

  function toggle(truck: string, oos: boolean) { setLocalOos(truck, oos); emitChange(); }

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Out of Service <span className="am-muted" style={{ fontWeight: 400, fontSize: 13 }}>· maintenance</span></h2>
        <div className="fleetmap-badges">
          <span className={`intg-badge ${flt.connected ? 'on' : ''}`} title={flt.label}>🛠 {flt.label}</span>
          <span className="am-muted">{oosCount} out of service</span>
        </div>
      </div>

      <p className="am-muted" style={{ fontSize: 12.5, maxWidth: 720 }}>
        Trucks flagged here are blocked from new assignments on the Asset Matrix — the row greys out with an OUT OF SERVICE badge and unlocks automatically when the flag is cleared. Once a Fleetio token is set, "Out of Service" vehicles sync in here read-only.
      </p>

      <div className="am-scroll">
        <table className="am-grid am-fleet">
          <thead><tr><th>Truck</th><th>Drivers</th><th>Type</th><th>Service status</th><th>Source</th><th>Action</th></tr></thead>
          <tbody>
            {rows.map(({ t, localOff, remoteOff, oos }) => (
              <tr key={t.tractor} className={oos ? 'row-shutdown' : ''}>
                <td className="am-tractor">#{t.tractor}</td>
                <td>{[t.driver1, t.driver2].filter(Boolean).join(' / ') || <span className="am-muted">—</span>}</td>
                <td className="am-muted">{t.type}</td>
                <td>{oos
                  ? <span className="oos-tag">🛠 OUT OF SERVICE</span>
                  : <span className="oos-ok">✓ In service</span>}</td>
                <td className="am-muted">{remoteOff ? 'Fleetio' : localOff ? 'Manual (dispatch)' : 'Fleetio (mock)'}</td>
                <td className="fleet-actions">
                  {remoteOff
                    ? <span className="am-muted" title="Managed in Fleetio">Fleetio-managed</span>
                    : !canEdit
                      ? <button className="am-clear" disabled title="Restricted to FMT Lead / US Ops / Owner">🔒</button>
                      : localOff
                        ? <button className="am-save" onClick={() => toggle(t.tractor, false)}>↩ Return to service</button>
                        : <button className="fleet-del" onClick={() => toggle(t.tractor, true)}>🛠 Mark out of service</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
