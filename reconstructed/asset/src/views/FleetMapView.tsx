import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { loadFleet } from '../data/fleetStore';
import { onChange } from '../data/bus';
import { fleetioClient, localOosList, type VehicleService } from '../integrations/telematics';
import { samsara, importedGeofences, addImportedGeofences, saveImportedGeofences, type TruckGps, type Geofence } from '../integrations/samsara';
import { weatherProvider, trafficProvider, type Congestion } from '../integrations/mapdata';
import { baseStyles, styleFor, maptilerKey } from '../integrations/mapstyle';

/* Fleet Map — a real Samsara-style map on MapLibre GL. Free vector basemap
   (OpenFreeMap, no key), real zoom/pan, truck markers that glide as GPS updates
   come through the Samsara adapter (mock now — en-route trucks drift so you can
   see movement). Weather + traffic + geofences ride on top as toggleable layers.
   Satellite / hybrid / terrain unlock the moment a MapTiler key is set on the
   Integrations page (no code change). */

const STATUS_HEX: Record<string, string> = { enroute: '#22c55e', dispatched: '#00b8d4', reset: '#e0a03d', oos: '#ef4444', idle: '#8aa0b6', other: '#a78bfa' };
const STATUS_TEXT: Record<string, string> = { enroute: 'En route', dispatched: 'Dispatched', reset: '34-hr reset', oos: 'Out of service', idle: 'Available', other: 'Other' };
const CONG_HEX: Record<Congestion, string> = { clear: '#22c55e', moderate: '#eab308', heavy: '#ef4444' };
const WX_HEX: Record<string, string> = { rain: '#3b82f6', storm: '#8b5cf6', snow: '#93c5fd', heat: '#f97316', clear: '#94a3b8' };

function statusClass(status: string): string {
  const s = (status || '').toLowerCase();
  if (/shutdown|out of service|oos/.test(s)) return 'oos';
  if (/reset|34/.test(s)) return 'reset';
  if (/en route|delivering|transit/.test(s)) return 'enroute';
  if (/dispatch/.test(s)) return 'dispatched';
  if (/ntb|available|empty|yard|home/.test(s)) return 'idle';
  return 'other';
}

/* ---- GeoJSON from the stub providers ---- */
type FC = GeoJSON.FeatureCollection;
function weatherFC(): FC {
  return { type: 'FeatureCollection', features: weatherProvider().systems().map((w) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
    properties: { kind: w.kind, label: w.kind.toUpperCase(), color: WX_HEX[w.kind] },
  })) };
}
function trafficFC(): FC {
  const cong = trafficProvider().congestion();
  return { type: 'FeatureCollection', features: trafficProvider().roads().map((r) => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates: r.points },
    properties: { id: r.id, cong: cong[r.id] },
  })) };
}
function shieldFC(): FC {
  return { type: 'FeatureCollection', features: trafficProvider().roads().map((r) => {
    const mid = r.points[Math.floor(r.points.length / 2)];
    return { type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: { id: r.id } };
  }) };
}
function geoFC(geos: Geofence[]): FC {
  return { type: 'FeatureCollection', features: geos.map((g) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [g.lng, g.lat] },
    properties: { name: g.name, kind: g.kind },
  })) };
}
const GEO_KIND_COLOR = ['match', ['get', 'kind'], 'yard', '#f59e0b', 'terminal', '#a78bfa', 'customer', '#22c55e', '#38bdf8'] as unknown;

export default function FleetMapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const targetsRef = useRef<Map<string, [number, number]>>(new Map());
  const animRef = useRef<number>(0);
  const readyRef = useRef(false);

  const [baseId, setBaseId] = useState<string>('streets');
  const [layers, setLayers] = useState({ weather: true, traffic: true, geofences: true });
  const [importOpen, setImportOpen] = useState(false);
  const [geos, setGeos] = useState<Geofence[]>(() => importedGeofences());
  const [services, setServices] = useState<VehicleService[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => onChange(() => setTick((n) => n + 1)), []);
  const sam = samsara();
  const flt = fleetioClient();
  const hasKey = !!maptilerKey();

  useEffect(() => { void flt.serviceStatuses().then(setServices); setGeos(importedGeofences()); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]);
  const oos = useMemo(() => new Set([...localOosList(), ...services.filter((s) => s.status === 'out_of_service').map((s) => s.truck)]), [tick, services]);

  /* build the map once */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor('streets').url,
      center: [-96, 38.5], zoom: 3.7, attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    startAnim();   // glide markers independent of tile/style load
    map.on('load', () => { readyRef.current = true; addOverlays(map); });
    return () => { cancelAnimationFrame(animRef.current); map.remove(); mapRef.current = null; readyRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* overlays (weather / traffic / shields / geofences) — re-added after any style swap */
  function addOverlays(map: maplibregl.Map) {
    if (!map.getSource('wx')) map.addSource('wx', { type: 'geojson', data: weatherFC() });
    if (!map.getLayer('wx-fill')) map.addLayer({
      id: 'wx-fill', type: 'circle', source: 'wx',
      paint: { 'circle-color': ['get', 'color'], 'circle-opacity': 0.16,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 34, 6, 130], 'circle-blur': 0.4 },
    });
    if (!map.getLayer('wx-label')) map.addLayer({
      id: 'wx-label', type: 'symbol', source: 'wx',
      layout: { 'text-field': ['get', 'label'], 'text-size': 10, 'text-font': ['Noto Sans Bold'] },
      paint: { 'text-color': '#e5e7eb', 'text-halo-color': '#0b1220', 'text-halo-width': 1.4 },
    });

    if (!map.getSource('traffic')) map.addSource('traffic', { type: 'geojson', data: trafficFC() });
    if (!map.getLayer('traffic-casing')) map.addLayer({
      id: 'traffic-casing', type: 'line', source: 'traffic',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0b1220', 'line-opacity': 0.5, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 5, 8, 11] },
    });
    if (!map.getLayer('traffic-line')) map.addLayer({
      id: 'traffic-line', type: 'line', source: 'traffic',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['match', ['get', 'cong'], 'heavy', CONG_HEX.heavy, 'moderate', CONG_HEX.moderate, CONG_HEX.clear] as unknown as maplibregl.ExpressionSpecification,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.6, 8, 7] },
    });
    if (!map.getSource('shields')) map.addSource('shields', { type: 'geojson', data: shieldFC() });
    if (!map.getLayer('shields-label')) map.addLayer({
      id: 'shields-label', type: 'symbol', source: 'shields',
      layout: { 'text-field': ['get', 'id'], 'text-size': 11, 'text-font': ['Noto Sans Bold'] },
      paint: { 'text-color': '#ffffff', 'text-halo-color': '#0b1220', 'text-halo-width': 2.2 },
    });

    if (!map.getSource('geo')) map.addSource('geo', { type: 'geojson', data: geoFC(importedGeofences()) });
    if (!map.getLayer('geo-fill')) map.addLayer({
      id: 'geo-fill', type: 'circle', source: 'geo',
      paint: { 'circle-color': GEO_KIND_COLOR as maplibregl.ExpressionSpecification, 'circle-opacity': 0.18,
        'circle-stroke-color': GEO_KIND_COLOR as maplibregl.ExpressionSpecification, 'circle-stroke-width': 1.5,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 10, 34] },
    });
    if (!map.getLayer('geo-label')) map.addLayer({
      id: 'geo-label', type: 'symbol', source: 'geo',
      layout: { 'text-field': ['get', 'name'], 'text-size': 10.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': '#e5e7eb', 'text-halo-color': '#0b1220', 'text-halo-width': 1.6 },
    });
    applyVisibility(map);
  }

  function applyVisibility(map: maplibregl.Map) {
    const set = (id: string, on: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    set('wx-fill', layers.weather); set('wx-label', layers.weather);
    set('traffic-casing', layers.traffic); set('traffic-line', layers.traffic); set('shields-label', layers.traffic);
    set('geo-fill', layers.geofences); set('geo-label', layers.geofences);
  }
  useEffect(() => { const m = mapRef.current; if (m && readyRef.current) applyVisibility(m); }, [layers]);

  /* base-style switch — re-add overlays + markers after the new style loads */
  function switchBase(id: string) {
    const st = styleFor(id);
    if (st.needsKey && !maptilerKey()) return;
    setBaseId(id);
    const map = mapRef.current; if (!map) return;
    map.setStyle(st.url);
    map.once('styledata', () => { addOverlays(map); });
  }

  /* poll positions + glide markers */
  function startAnim() {
    const loop = () => {
      markersRef.current.forEach((mk, truck) => {
        const t = targetsRef.current.get(truck); if (!t) return;
        const c = mk.getLngLat();
        mk.setLngLat([c.lng + (t[0] - c.lng) * 0.12, c.lat + (t[1] - c.lat) * 0.12]);
      });
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const pos = await sam.positions();
      if (!alive || !mapRef.current) return;
      syncMarkers(pos);
    };
    void pull();
    const iv = window.setInterval(pull, 2500);   // trucks tick toward new GPS every 2.5s
    return () => { alive = false; window.clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  function syncMarkers(pos: TruckGps[]) {
    const map = mapRef.current; if (!map) return;
    const fleet = loadFleet();
    const statusByTruck = new Map(fleet.map((t) => [t.tractor, t.status]));
    const seen = new Set<string>();
    for (const p of pos) {
      seen.add(p.truck);
      targetsRef.current.set(p.truck, [p.lng, p.lat]);
      const cls = oos.has(p.truck) ? 'oos' : statusClass(statusByTruck.get(p.truck) || '');
      let mk = markersRef.current.get(p.truck);
      if (!mk) {
        const el = document.createElement('div');
        el.className = 'fmap-marker';
        el.innerHTML = `<span class="fmap-marker-dot"></span><span class="fmap-marker-num">${p.truck}</span>`;
        mk = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map);
        mk.getElement().addEventListener('click', () => {
          const t = fleet.find((x) => x.tractor === p.truck);
          new maplibregl.Popup({ offset: 14, closeButton: false })
            .setLngLat(targetsRef.current.get(p.truck) as [number, number])
            .setHTML(`<div class="fmap-pop"><b>#${p.truck}</b> · ${STATUS_TEXT[cls]}<br><span class="fmap-pop-sub">${t ? [t.driver1, t.driver2].filter(Boolean).join(' / ') || t.type : ''}</span><br><span class="fmap-pop-sub">${p.speedMph ? p.speedMph + ' mph' : 'stopped'} · ${p.source === 'samsara' ? 'live GPS' : 'mock'}</span></div>`)
            .addTo(map);
        });
        markersRef.current.set(p.truck, mk);
      }
      const dot = mk.getElement().querySelector('.fmap-marker-dot') as HTMLElement | null;
      if (dot) dot.style.background = STATUS_HEX[cls];
    }
    for (const [truck, mk] of markersRef.current) if (!seen.has(truck)) { mk.remove(); markersRef.current.delete(truck); targetsRef.current.delete(truck); }
  }

  /* geofence import → update the source live */
  function importGeofences(list: Geofence[]) {
    addImportedGeofences(list); const g = importedGeofences(); setGeos(g);
    const src = mapRef.current?.getSource('geo') as maplibregl.GeoJSONSource | undefined; src?.setData(geoFC(g));
    setImportOpen(false);
  }
  function clearGeofences() {
    saveImportedGeofences([]); setGeos([]);
    const src = mapRef.current?.getSource('geo') as maplibregl.GeoJSONSource | undefined; src?.setData(geoFC([]));
  }

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of loadFleet()) { const c = oos.has(t.tractor) ? 'oos' : statusClass(t.status); m[c] = (m[c] ?? 0) + 1; }
    return m;
  }, [oos, tick]);

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
        <div ref={containerRef} className="fmap-canvas" />

        {/* Samsara-style layer control */}
        <div className="fmap-controls">
          <div className="fmap-ctl-label">Base map</div>
          <div className="fmap-basegrid">
            {baseStyles().map((s) => (
              <button key={s.id} className={`fmap-base ${baseId === s.id ? 'on' : ''} ${s.needsKey && !hasKey ? 'locked' : ''}`}
                title={s.needsKey && !hasKey ? 'Add a MapTiler key on the Integrations page to enable satellite imagery' : s.label}
                onClick={() => switchBase(s.id)}>
                {s.label}{s.needsKey && !hasKey ? ' 🔒' : ''}
              </button>
            ))}
          </div>
          <div className="fmap-ctl-divider" />
          <label className="fmap-ctl-row"><input type="checkbox" checked={layers.weather} onChange={(e) => setLayers((l) => ({ ...l, weather: e.target.checked }))} /> Weather (national)</label>
          <label className="fmap-ctl-row"><input type="checkbox" checked={layers.traffic} onChange={(e) => setLayers((l) => ({ ...l, traffic: e.target.checked }))} /> Traffic</label>
          <label className="fmap-ctl-row"><input type="checkbox" checked={layers.geofences} onChange={(e) => setLayers((l) => ({ ...l, geofences: e.target.checked }))} /> Geofences ({geos.length})</label>
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
        <span className="am-muted">Real map (OpenFreeMap · no key). Satellite / hybrid / terrain unlock when you add a MapTiler key on the Integrations page. Truck positions come through the Samsara adapter — en-route trucks are simulated moving until the live GPS backend is wired.</span>
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
      <div className="fleet-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
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
                  <span className="geo-import-main"><b>{g.name}</b><span className="am-muted"> · {g.kind} · {g.radiusMeters} m {already.has(g.id) ? '· already imported' : ''}</span></span>
                </label>
              ))}
            </div>
            <div className="load-dispatch-actions" style={{ marginTop: 10 }}>
              <button className="am-save" disabled={selected.length === 0} onClick={() => onImport(selected)}>Import {selected.length} geofence{selected.length === 1 ? '' : 's'}</button>
              <span className="am-muted" style={{ fontSize: 11.5 }}>They'll drop onto the Fleet Map. No live Samsara call is made.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
