import { useEffect, useMemo, useRef, useState } from 'react';
import { loadFleet } from '../data/fleetStore';
import { CITY_COORDS } from '../data/fleet';
import { onChange } from '../data/bus';
import { fleetioClient, localOosList, type VehicleService } from '../integrations/telematics';
import { samsara, importedGeofences, addImportedGeofences, saveImportedGeofences, type TruckGps, type Geofence } from '../integrations/samsara';
import { weatherProvider, trafficProvider, STATE_LABELS, type Congestion } from '../integrations/mapdata';

/* Fleet Map — a Samsara-style live map. Base layer toggles between satellite and
   terrain; a national weather overlay and road-traffic congestion coloring drop
   on top; interstate shields, and state names (zoomed out) or city names (zoomed
   in) follow the zoom. Truck GPS + geofences come through the Samsara adapter
   (mock until the backend is wired). Weather + traffic are stub providers behind
   clean interfaces so real feeds plug in later. Pan by dragging, zoom with ± . */

const VW = 1000, VH = 560;
const US_LNG_SPAN = 62, US_LAT_SPAN = 27, US_CENTER = { lng: -96, lat: 38.5 };
const ZOOMS = [1, 1.7, 2.6, 3.8];

function statusClass(status: string): string {
  const s = (status || '').toLowerCase();
  if (/shutdown|out of service|oos/.test(s)) return 'oos';
  if (/reset|34/.test(s)) return 'reset';
  if (/en route|delivering|transit/.test(s)) return 'enroute';
  if (/dispatch/.test(s)) return 'dispatched';
  if (/ntb|available|empty|yard|home/.test(s)) return 'idle';
  return 'other';
}
const STATUS_HEX: Record<string, string> = { enroute: '#22c55e', dispatched: '#00b8d4', reset: '#e0a03d', oos: '#ef4444', idle: '#8aa0b6', other: '#a78bfa' };
const STATUS_TEXT: Record<string, string> = { enroute: 'En route', dispatched: 'Dispatched', reset: '34-hr reset', oos: 'Out of service', idle: 'Available', other: 'Other' };
const CONG_HEX: Record<Congestion, string> = { clear: '#22c55e', moderate: '#eab308', heavy: '#ef4444' };
const WX_HEX: Record<string, string> = { rain: '#3b82f6', storm: '#8b5cf6', snow: '#cbd5e1', heat: '#f97316', clear: '#94a3b8' };

export default function FleetMapView() {
  const [positions, setPositions] = useState<TruckGps[]>([]);
  const [services, setServices] = useState<VehicleService[]>([]);
  const [base, setBase] = useState<'satellite' | 'terrain'>('satellite');
  const [layers, setLayers] = useState({ weather: true, traffic: true, geofences: true });
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState(US_CENTER);
  const [hover, setHover] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [geos, setGeos] = useState<Geofence[]>(() => importedGeofences());
  const drag = useRef<{ x: number; y: number; lng: number; lat: number; moved: boolean } | null>(null);

  const [tick, setTick] = useState(0);
  useEffect(() => onChange(() => setTick((n) => n + 1)), []);
  const sam = samsara();
  const flt = fleetioClient();
  useEffect(() => { void sam.positions().then(setPositions); void flt.serviceStatuses().then(setServices); setGeos(importedGeofences()); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]);

  const fleet = useMemo(() => loadFleet(), [tick, positions]);
  const oos = useMemo(() => new Set([...localOosList(), ...services.filter((s) => s.status === 'out_of_service').map((s) => s.truck)]), [tick, services]);
  const posByTruck = useMemo(() => { const m = new Map<string, TruckGps>(); for (const p of positions) m.set(p.truck, p); return m; }, [positions]);
  const wx = useMemo(() => weatherProvider(), []);
  const tf = useMemo(() => trafficProvider(), []);
  const congestion = useMemo(() => tf.congestion(), [tf]);

  /* projection for the current zoom + pan window */
  const Z = ZOOMS[Math.min(zoom, ZOOMS.length) - 1];
  const lngSpan = US_LNG_SPAN / Z, latSpan = US_LAT_SPAN / Z;
  const bnd = { l: center.lng - lngSpan / 2, r: center.lng + lngSpan / 2, t: center.lat + latSpan / 2, b: center.lat - latSpan / 2 };
  const projX = (lng: number) => ((lng - bnd.l) / (bnd.r - bnd.l)) * VW;
  const projY = (lat: number) => ((bnd.t - lat) / (bnd.t - bnd.b)) * VH;
  const inView = (lng: number, lat: number) => lng >= bnd.l && lng <= bnd.r && lat >= bnd.b && lat <= bnd.t;
  const pxPerDegLat = VH / (bnd.t - bnd.b);

  /* pan by dragging the map */
  function onDown(e: React.PointerEvent) { drag.current = { x: e.clientX, y: e.clientY, lng: center.lng, lat: center.lat, moved: false }; (e.target as Element).setPointerCapture?.(e.pointerId); }
  function onMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    setCenter({ lng: drag.current.lng - (dx / rect.width) * lngSpan, lat: drag.current.lat + (dy / rect.height) * latSpan });
  }
  function onUp() { drag.current = null; }
  const resetView = () => { setZoom(1); setCenter(US_CENTER); };

  const pins = fleet.map((t, i) => {
    const p = posByTruck.get(t.tractor);
    const cls = oos.has(t.tractor) ? 'oos' : statusClass(t.status);
    const co = CITY_COORDS[(t.currentCity || t.homeCity || '').toUpperCase()] ?? CITY_COORDS['DALLAS'];
    return { t, p, cls, lng: p?.lng ?? co.lng + ((i % 5) - 2) * 0.05, lat: p?.lat ?? co.lat + ((i % 7) - 3) * 0.05 };
  });
  const counts = pins.reduce((m, pin) => { m[pin.cls] = (m[pin.cls] ?? 0) + 1; return m; }, {} as Record<string, number>);

  const cityLabels = useMemo(() => Object.entries(CITY_COORDS).map(([name, c]) => ({ name, ...c })), []);

  function importGeofences(list: Geofence[]) { addImportedGeofences(list); setGeos(importedGeofences()); setImportOpen(false); }
  function clearGeofences() { saveImportedGeofences([]); setGeos([]); }

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Fleet Map <span className="am-muted" style={{ fontWeight: 400, fontSize: 13 }}>· live GPS</span></h2>
        <div className="fleetmap-badges">
          <span className="intg-badge on" title={sam.label}>📡 {sam.label}</span>
          <button className="am-save" onClick={() => setImportOpen(true)}>⬛ Import Geofences from Samsara</button>
        </div>
      </div>

      <div className="fmap-shell">
        <svg className={`fmap-svg ${base}`} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          <defs>
            <linearGradient id="fmap-sat" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#12261b" /><stop offset="0.5" stopColor="#183a2a" /><stop offset="1" stopColor="#0f2233" />
            </linearGradient>
            <linearGradient id="fmap-ter" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#e7e2d0" /><stop offset="0.5" stopColor="#cfd8be" /><stop offset="1" stopColor="#bcc9d6" />
            </linearGradient>
            <clipPath id="fmap-clip"><rect x="0" y="0" width={VW} height={VH} /></clipPath>
          </defs>

          <g clipPath="url(#fmap-clip)">
            <rect x={0} y={0} width={VW} height={VH} fill={base === 'satellite' ? 'url(#fmap-sat)' : 'url(#fmap-ter)'} />
            {/* graticule */}
            {[-120, -110, -100, -90, -80, -70].map((lng) => <line key={`v${lng}`} x1={projX(lng)} y1={0} x2={projX(lng)} y2={VH} className="fmap-grat" />)}
            {[30, 35, 40, 45].map((lat) => <line key={`h${lat}`} x1={0} y1={projY(lat)} x2={VW} y2={projY(lat)} className="fmap-grat" />)}

            {/* weather overlay (national) */}
            {layers.weather && wx.systems().map((w) => inView(w.lng, w.lat) && (
              <g key={w.id}>
                <circle cx={projX(w.lng)} cy={projY(w.lat)} r={w.radiusDeg * pxPerDegLat} fill={WX_HEX[w.kind]} opacity={0.16} />
                <circle cx={projX(w.lng)} cy={projY(w.lat)} r={w.radiusDeg * pxPerDegLat} fill="none" stroke={WX_HEX[w.kind]} strokeOpacity={0.5} strokeDasharray="4 4" />
                <text x={projX(w.lng)} y={projY(w.lat)} className="fmap-wx-label" textAnchor="middle">{w.kind.toUpperCase()}</text>
              </g>
            ))}

            {/* traffic: interstates colored by congestion + shields */}
            {layers.traffic && tf.roads().map((r) => {
              const pts = r.points.map(([lng, lat]) => `${projX(lng)},${projY(lat)}`).join(' ');
              const mid = r.points[Math.floor(r.points.length / 2)];
              return (
                <g key={r.id}>
                  <polyline points={pts} fill="none" stroke="#0b1220" strokeOpacity={0.5} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points={pts} fill="none" stroke={CONG_HEX[congestion[r.id]]} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
                  {inView(mid[0], mid[1]) && (
                    <g transform={`translate(${projX(mid[0])},${projY(mid[1])})`}>
                      <rect x={-15} y={-9} width={30} height={18} rx={3} className="fmap-shield" />
                      <text y={4} textAnchor="middle" className="fmap-shield-txt">{r.id}</text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* geofences (imported) */}
            {layers.geofences && geos.map((g) => inView(g.lng, g.lat) && (
              <g key={g.id}>
                <circle cx={projX(g.lng)} cy={projY(g.lat)} r={Math.max(6, (g.radiusMeters / 111000) * pxPerDegLat)} className={`fmap-geo ${g.kind}`} />
                <text x={projX(g.lng)} y={projY(g.lat) - Math.max(8, (g.radiusMeters / 111000) * pxPerDegLat) - 3} textAnchor="middle" className="fmap-geo-label">⬛ {g.name}</text>
              </g>
            ))}

            {/* labels: states when zoomed out, cities when zoomed in */}
            {zoom <= 2
              ? STATE_LABELS.filter((s) => inView(s.lng, s.lat)).map((s) => (
                <text key={s.name} x={projX(s.lng)} y={projY(s.lat)} textAnchor="middle" className={`fmap-state ${base}`}>{s.name}</text>
              ))
              : cityLabels.filter((c) => inView(c.lng, c.lat)).slice(0, 28).map((c) => (
                <g key={c.name}>
                  <circle cx={projX(c.lng)} cy={projY(c.lat)} r={2} className={`fmap-citydot ${base}`} />
                  <text x={projX(c.lng) + 4} y={projY(c.lat) + 3} className={`fmap-city ${base}`}>{c.name[0] + c.name.slice(1).toLowerCase()}</text>
                </g>
              ))}

            {/* truck pins */}
            {pins.map((pin) => {
              const active = hover === pin.t.tractor;
              if (!inView(pin.lng, pin.lat)) return null;
              return (
                <g key={pin.t.tractor} transform={`translate(${projX(pin.lng)},${projY(pin.lat)})`}
                  onMouseEnter={() => setHover(pin.t.tractor)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                  <circle r={active ? 11 : 7.5} fill={STATUS_HEX[pin.cls]} className={`fmap-pin ${active ? 'active' : ''}`} />
                  <text y={3.4} textAnchor="middle" className="fmap-pin-txt">{pin.t.tractor}</text>
                  {active && (
                    <g>
                      <rect x={-70} y={-46} width={140} height={30} rx={5} className="fmap-tip-bg" />
                      <text y={-32} textAnchor="middle" className="fmap-tip-t">#{pin.t.tractor} · {STATUS_TEXT[pin.cls]}</text>
                      <text y={-21} textAnchor="middle" className="fmap-tip-s">{pin.p?.speedMph ? `${pin.p.speedMph} mph` : 'stopped'} · {pin.p?.source === 'samsara' ? 'live' : 'est.'}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Samsara-style layer control */}
        <div className="fmap-controls">
          <div className="fmap-ctl-seg">
            <button className={base === 'satellite' ? 'on' : ''} onClick={() => setBase('satellite')}>Satellite</button>
            <button className={base === 'terrain' ? 'on' : ''} onClick={() => setBase('terrain')}>Terrain</button>
          </div>
          <label className="fmap-ctl-row"><input type="checkbox" checked={layers.weather} onChange={(e) => setLayers((l) => ({ ...l, weather: e.target.checked }))} /> Weather (national)</label>
          <label className="fmap-ctl-row"><input type="checkbox" checked={layers.traffic} onChange={(e) => setLayers((l) => ({ ...l, traffic: e.target.checked }))} /> Traffic</label>
          <label className="fmap-ctl-row"><input type="checkbox" checked={layers.geofences} onChange={(e) => setLayers((l) => ({ ...l, geofences: e.target.checked }))} /> Geofences ({geos.length})</label>
        </div>

        {/* zoom + reset */}
        <div className="fmap-zoom">
          <button onClick={() => setZoom((z) => Math.min(ZOOMS.length, z + 1))} title="Zoom in">＋</button>
          <button onClick={() => setZoom((z) => Math.max(1, z - 1))} title="Zoom out">−</button>
          <button onClick={resetView} title="Reset view" className="fmap-reset">⤢</button>
        </div>

        {/* legend */}
        <div className="fmap-legend">
          <div className="fmap-legend-row">
            {(['enroute', 'dispatched', 'reset', 'idle', 'oos'] as const).map((k) => counts[k]
              ? <span key={k} className="fmap-legend-item"><span className="fleetmap-dot" style={{ background: STATUS_HEX[k] }} />{STATUS_TEXT[k]} {counts[k]}</span> : null)}
          </div>
          {layers.traffic && (
            <div className="fmap-legend-row">
              <span className="fmap-legend-cap">Traffic</span>
              {(['clear', 'moderate', 'heavy'] as const).map((c) => <span key={c} className="fmap-legend-item"><span className="fmap-legend-line" style={{ background: CONG_HEX[c] }} />{c}</span>)}
            </div>
          )}
        </div>
      </div>

      <div className="fmap-note">
        <span className="am-muted">Base map, weather & traffic are stubbed for now (no keys). Truck positions and geofences come through the Samsara adapter — mock until the backend link is added on the Integrations page.</span>
        {geos.length > 0 && <button className="am-clear" onClick={clearGeofences}>Clear imported geofences</button>}
      </div>

      {importOpen && <GeofenceImport onClose={() => setImportOpen(false)} onImport={importGeofences} already={new Set(geos.map((g) => g.id))} />}
    </div>
  );
}

/* ---- Geofence import (front-end only; stub importer via the Samsara adapter) ---- */
function GeofenceImport({ onClose, onImport, already }: { onClose: () => void; onImport: (g: Geofence[]) => void; already: Set<string> }) {
  const [remote, setRemote] = useState<Geofence[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void samsara().fetchRemoteGeofences().then((g) => { setRemote(g); setPicked(new Set(g.filter((x) => !already.has(x.id)).map((x) => x.id))); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selected = (remote ?? []).filter((g) => picked.has(g.id));

  return (
    <div className="fleet-modal-back" onClick={onClose}>
      <div className="fleet-modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="load-head"><div><h3>Import Geofences from Samsara</h3>
          <div className="am-muted" style={{ fontSize: 12 }}>Front-end preview — pulls a stubbed geofence set until the Samsara backend is wired.</div></div>
          <button className="am-cancel" onClick={onClose}>Close</button></div>

        {loading ? <div className="am-muted" style={{ padding: 16 }}>Loading geofences from Samsara…</div> : (
          <>
            <div className="geo-import-list">
              {(remote ?? []).map((g) => (
                <label key={g.id} className={`geo-import-row ${already.has(g.id) ? 'dim' : ''}`}>
                  <input type="checkbox" checked={picked.has(g.id)} onChange={() => toggle(g.id)} />
                  <span className={`geo-chip ${g.kind}`}>⬛</span>
                  <span className="geo-import-main">
                    <b>{g.name}</b>
                    <span className="am-muted"> · {g.kind} · {(g.radiusMeters)} m radius {already.has(g.id) ? '· already imported' : ''}</span>
                  </span>
                </label>
              ))}
            </div>
            {/* mini preview onto a US mini-map */}
            <GeoPreview geos={selected} />
            <div className="load-dispatch-actions" style={{ marginTop: 10 }}>
              <button className="am-save" disabled={selected.length === 0} onClick={() => onImport(selected)}>Import {selected.length} geofence{selected.length === 1 ? '' : 's'}</button>
              <span className="am-muted" style={{ fontSize: 11.5 }}>They'll appear on the Fleet Map. No live Samsara call is made.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GeoPreview({ geos }: { geos: Geofence[] }) {
  const W = 560, H = 200;
  const L = -125, R = -66.5, T = 49.5, B = 24.5;
  const x = (lng: number) => ((lng - L) / (R - L)) * W;
  const y = (lat: number) => ((T - lat) / (T - B)) * H;
  return (
    <div className="geo-preview">
      <div className="geo-preview-cap">Preview on the map</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="geo-preview-svg">
        <rect x={0} y={0} width={W} height={H} rx={8} className="geo-preview-bg" />
        {geos.map((g) => (
          <g key={g.id}>
            <circle cx={x(g.lng)} cy={y(g.lat)} r={7} className={`fmap-geo ${g.kind}`} />
            <text x={x(g.lng) + 9} y={y(g.lat) + 3} className="geo-preview-lbl">{g.name}</text>
          </g>
        ))}
        {geos.length === 0 && <text x={W / 2} y={H / 2} textAnchor="middle" className="geo-preview-lbl">Select geofences to preview</text>}
      </svg>
    </div>
  );
}
