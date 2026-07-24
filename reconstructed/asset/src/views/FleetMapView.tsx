import { useEffect, useMemo, useState } from 'react';
import { loadFleet } from '../data/fleetStore';
import { CITY_COORDS } from '../data/fleet';
import { onChange } from '../data/bus';
import { samsaraClient, fleetioClient, localOosList, type TruckPosition, type VehicleService } from '../integrations/telematics';

/* Fleet Map — live GPS view of the whole fleet on a US map. Truck pins are
   placed by their telematics position (Samsara integration layer — mock data
   until a token is set) and colored by trip status. The side list names the
   data source per truck so it's always clear which pins are live vs. estimated.
   Out-of-service trucks (Fleetio) are flagged. Zero keys required to run. */

/* continental-US bounding box → SVG projection */
const VW = 1000, VH = 560;
const LNG0 = -125, LNG1 = -66.5, LAT0 = 24.5, LAT1 = 49.5;
const projX = (lng: number) => ((lng - LNG0) / (LNG1 - LNG0)) * VW;
const projY = (lat: number) => ((LAT1 - lat) / (LAT1 - LAT0)) * VH;

/* reference terminals + hub cities drawn faintly for orientation */
const REF_CITIES = ['SAN ANTONIO', 'DALLAS', 'HOUSTON', 'MEMPHIS', 'ATLANTA', 'CHICAGO', 'DENVER', 'LOS ANGELES', 'MIAMI', 'KANSAS CITY', 'NASHVILLE', 'INDIANAPOLIS', 'JACKSONVILLE'];

function statusClass(status: string): string {
  const s = (status || '').toLowerCase();
  if (/shutdown|out of service|oos/.test(s)) return 'oos';
  if (/reset|34/.test(s)) return 'reset';
  if (/en route|delivering|transit/.test(s)) return 'enroute';
  if (/dispatch/.test(s)) return 'dispatched';
  if (/ntb|available|empty|yard|home/.test(s)) return 'idle';
  return 'other';
}
const STATUS_HEX: Record<string, string> = {
  enroute: '#22c55e', dispatched: '#00b8d4', reset: '#e0a03d', oos: '#ef4444', idle: '#8aa0b6', other: '#a78bfa',
};
const STATUS_TEXT: Record<string, string> = {
  enroute: 'En route', dispatched: 'Dispatched', reset: '34-hr reset', oos: 'Out of service', idle: 'Available', other: 'Other',
};

export default function FleetMapView() {
  const [tick, setTick] = useState(0);
  const [positions, setPositions] = useState<TruckPosition[]>([]);
  const [services, setServices] = useState<VehicleService[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => onChange(() => setTick((n) => n + 1)), []);
  const sam = samsaraClient();
  const flt = fleetioClient();
  useEffect(() => { void sam.positions().then(setPositions); void flt.serviceStatuses().then(setServices); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]);

  const fleet = useMemo(() => loadFleet(), [tick, positions]);
  const oos = useMemo(() => new Set([...localOosList(), ...services.filter((s) => s.status === 'out_of_service').map((s) => s.truck)]), [tick, services]);
  const posByTruck = useMemo(() => { const m = new Map<string, TruckPosition>(); for (const p of positions) m.set(p.truck, p); return m; }, [positions]);

  const pins = fleet.map((t) => {
    const p = posByTruck.get(t.tractor);
    const cls = oos.has(t.tractor) ? 'oos' : statusClass(t.status);
    const lat = p?.lat ?? CITY_COORDS[(t.currentCity || t.homeCity || '').toUpperCase()]?.lat ?? CITY_COORDS['DALLAS'].lat;
    const lng = p?.lng ?? CITY_COORDS[(t.currentCity || t.homeCity || '').toUpperCase()]?.lng ?? CITY_COORDS['DALLAS'].lng;
    return { t, p, cls, x: projX(lng), y: projY(lat) };
  });

  const counts = pins.reduce((m, pin) => { m[pin.cls] = (m[pin.cls] ?? 0) + 1; return m; }, {} as Record<string, number>);

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Fleet Map <span className="am-muted" style={{ fontWeight: 400, fontSize: 13 }}>· live GPS</span></h2>
        <div className="fleetmap-badges">
          <span className={`intg-badge ${sam.connected ? 'on' : ''}`} title={sam.label}>📡 {sam.label}</span>
          <span className={`intg-badge ${flt.connected ? 'on' : ''}`} title={flt.label}>🛠 {flt.label}</span>
        </div>
      </div>

      <div className="fleetmap-legend">
        {(['enroute', 'dispatched', 'reset', 'idle', 'oos', 'other'] as const).map((k) => (
          (counts[k] ? <span key={k} className="fleetmap-legend-item"><span className="fleetmap-dot" style={{ background: STATUS_HEX[k] }} />{STATUS_TEXT[k]} <b>{counts[k]}</b></span> : null)
        ))}
      </div>

      <div className="fleetmap-grid">
        <div className="fleetmap-mapwrap">
          <svg className="fleetmap-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet">
            <rect x={0} y={0} width={VW} height={VH} rx={16} className="fleetmap-bg" />
            {/* lat/lng orientation grid */}
            {[-120, -110, -100, -90, -80, -70].map((lng) => <line key={`v${lng}`} x1={projX(lng)} y1={0} x2={projX(lng)} y2={VH} className="fleetmap-grid-line" />)}
            {[30, 35, 40, 45].map((lat) => <line key={`h${lat}`} x1={0} y1={projY(lat)} x2={VW} y2={projY(lat)} className="fleetmap-grid-line" />)}
            {/* reference cities */}
            {REF_CITIES.map((c) => { const co = CITY_COORDS[c]; if (!co) return null; return (
              <g key={c}>
                <circle cx={projX(co.lng)} cy={projY(co.lat)} r={2.5} className="fleetmap-refdot" />
                <text x={projX(co.lng) + 5} y={projY(co.lat) + 3} className="fleetmap-reflabel">{c[0] + c.slice(1).toLowerCase()}</text>
              </g>
            ); })}
            {/* truck pins */}
            {pins.map((pin) => {
              const active = hover === pin.t.tractor || selected === pin.t.tractor;
              return (
                <g key={pin.t.tractor} transform={`translate(${pin.x},${pin.y})`}
                  onMouseEnter={() => setHover(pin.t.tractor)} onMouseLeave={() => setHover(null)}
                  onClick={() => setSelected(pin.t.tractor)} style={{ cursor: 'pointer' }}>
                  <circle r={active ? 11 : 7} fill={STATUS_HEX[pin.cls]} className={`fleetmap-pin ${active ? 'active' : ''}`} />
                  <text y={3.5} textAnchor="middle" className="fleetmap-pinlabel">{pin.t.tractor}</text>
                  {active && <text y={-14} textAnchor="middle" className="fleetmap-pintip">#{pin.t.tractor} · {pin.p?.speedMph ? `${pin.p.speedMph} mph` : 'stopped'}</text>}
                </g>
              );
            })}
          </svg>
        </div>

        <div className="fleetmap-list">
          <div className="fleetmap-list-head">Trucks · {fleet.length}</div>
          {pins.slice().sort((a, b) => a.t.tractor.localeCompare(b.t.tractor)).map((pin) => {
            const p = pin.p;
            const src = pin.p?.source === 'samsara' ? 'Samsara (live)' : 'Est. (mock)';
            return (
              <div key={pin.t.tractor} className={`fleetmap-row ${selected === pin.t.tractor ? 'on' : ''}`}
                onMouseEnter={() => setHover(pin.t.tractor)} onMouseLeave={() => setHover(null)} onClick={() => setSelected(pin.t.tractor)}>
                <span className="fleetmap-row-dot" style={{ background: STATUS_HEX[pin.cls] }} />
                <div className="fleetmap-row-main">
                  <div className="fleetmap-row-top">#{pin.t.tractor} <span className="am-muted">{[pin.t.driver1, pin.t.driver2].filter(Boolean).join(' / ') || pin.t.type}</span></div>
                  <div className="fleetmap-row-sub">
                    {STATUS_TEXT[pin.cls]} · {pin.t.currentCity || pin.t.homeCity}{p?.speedMph ? ` · ${p.speedMph} mph` : ''}
                  </div>
                </div>
                <span className={`fleetmap-src ${pin.p?.source === 'samsara' ? 'live' : ''}`}>{src}</span>
              </div>
            );
          })}
          <div className="fleetmap-list-note">Pins are estimated from each truck's last known city until a Samsara token is set (integration layer ready). Out-of-service comes from Fleetio.</div>
        </div>
      </div>
    </div>
  );
}
