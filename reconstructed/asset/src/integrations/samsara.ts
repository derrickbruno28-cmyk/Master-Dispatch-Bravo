/* Samsara integration — the single service/adapter layer that Driver HOS, truck
   GPS tracking, and geofence import all read from. Ship-state: the API key is
   NEVER hardcoded (it's pasted in the Integrations panel and kept in
   localStorage), and NO live call is made — every method returns plausible mock
   data derived from the fleet so the features work end to end today. When the
   backend is wired, swap MockSamsara for a real client behind this same
   interface and nothing else changes.

   Connection states:
     not_configured  — no key saved yet
     key_saved       — key pasted, but the backend isn't wired (still mock)
     connected       — real backend live (set only once the API is added)  */

import { loadFleet } from '../data/fleetStore';
import { CITY_COORDS } from '../data/fleet';

/* THREE Samsara organizations. Driver HOS + Truck GPS are READ from ALL orgs
   that have a key and merged. Geofences are pulled from ONE org only — the
   designated geofence source (AJG by default). Each org's read-only API token
   is pasted in the Integrations panel and kept in localStorage; never hardcoded,
   never sent anywhere until the backend proxy is wired. */

const ORG_STORE = 'asset-samsara-orgs-v1';
const GEO_SOURCE_STORE = 'asset-samsara-geo-source-v1';
const LEGACY_KEY = 'asset-samsara-key-v1';   // pre-multi-org single key (migrated in)
const GEO_STORE = 'asset-geofences-v1';

export type ConnStatus = 'not_configured' | 'key_saved' | 'connected';

export interface SamsaraOrg { id: string; name: string; key: string }

/* the three orgs, stable ids. Names are editable; AJG is the default geofence
   source per the ops rule "geofences only come from the AJG Samsara profile". */
const DEFAULT_ORGS: { id: string; name: string }[] = [
  { id: 'gh', name: 'GH Logistics' },
  { id: 'ajg', name: 'AJG Transport' },
  { id: 'org3', name: 'Third Organization' },
];
export const DEFAULT_GEO_SOURCE = 'ajg';

export function samsaraOrgs(): SamsaraOrg[] {
  let saved: SamsaraOrg[] = [];
  try { const r = localStorage.getItem(ORG_STORE); if (r) { const a = JSON.parse(r) as SamsaraOrg[]; if (Array.isArray(a)) saved = a; } } catch { /* ignore */ }
  let legacy = ''; try { legacy = localStorage.getItem(LEGACY_KEY) || ''; } catch { /* ignore */ }
  /* always exactly the three stable orgs; merge saved key/name, migrate the old
     single key into the first org if nothing else is saved there */
  return DEFAULT_ORGS.map((d, i) => {
    const s = saved.find((x) => x.id === d.id);
    const key = s?.key || (i === 0 && saved.length === 0 ? legacy : '');
    return { id: d.id, name: s?.name || d.name, key };
  });
}
function writeOrgs(orgs: SamsaraOrg[]) { try { localStorage.setItem(ORG_STORE, JSON.stringify(orgs)); } catch { /* ignore */ } }

export function setSamsaraOrgKey(id: string, key: string) {
  writeOrgs(samsaraOrgs().map((o) => (o.id === id ? { ...o, key: key.trim() } : o)));
}
export function setSamsaraOrgName(id: string, name: string) {
  writeOrgs(samsaraOrgs().map((o) => (o.id === id ? { ...o, name: name.trim() || o.name } : o)));
}

export function geofenceSourceId(): string {
  try { return localStorage.getItem(GEO_SOURCE_STORE) || DEFAULT_GEO_SOURCE; } catch { return DEFAULT_GEO_SOURCE; }
}
export function setGeofenceSourceId(id: string) { try { localStorage.setItem(GEO_SOURCE_STORE, id); } catch { /* ignore */ } }
export function geofenceSourceOrg(): SamsaraOrg | undefined {
  const orgs = samsaraOrgs();
  return orgs.find((o) => o.id === geofenceSourceId()) || orgs[0];
}

export function maskKey(k: string): string { return k ? `${k.slice(0, 4)}••••••••${k.slice(-4)}` : ''; }
export function connectedOrgCount(): number { return samsaraOrgs().filter((o) => o.key).length; }
/* real connection is deferred — even with keys saved we stay on mock until the
   backend is wired, so status never claims a live link it doesn't have */
export function samsaraStatus(): ConnStatus { return connectedOrgCount() > 0 ? 'key_saved' : 'not_configured'; }

/* ---- shared data shapes (what the real API will also return) ---- */
export interface DriverHos {
  truck: string; driver: string;
  hoursAvailable: number;   // drive hours left today (11-hr rule)
  hoursDriven: number;
  cycleHoursRemaining: number;   // 70-hr / 8-day cycle
  dutyStatus: 'driving' | 'on_duty' | 'off_duty' | 'sleeper';
  source: 'samsara' | 'mock';
}
export interface TruckGps {
  truck: string; lat: number; lng: number;
  speedMph: number; heading: string; updatedAt: string;
  source: 'samsara' | 'mock';
}
export interface Geofence {
  id: string; name: string; lat: number; lng: number;
  radiusMeters: number; kind: 'yard' | 'customer' | 'terminal' | 'other';
  source: 'samsara' | 'mock';
}

export interface SamsaraService {
  readonly status: ConnStatus;
  readonly label: string;
  hos(): Promise<DriverHos[]>;
  positions(): Promise<TruckGps[]>;
  /** geofences already imported into the app (persisted locally) */
  savedGeofences(): Geofence[];
  /** geofences available to pull FROM Samsara (the import source) */
  fetchRemoteGeofences(): Promise<Geofence[]>;
}

/* ---- HOS: drive-hours left comes straight off the fleet card's hoursAvail,
   split into an 11-hr daily view + a 70-hr cycle so the optimizer can gate on
   realistic numbers today ---- */
function dutyFromStatus(s: string): DriverHos['dutyStatus'] {
  const t = (s || '').toLowerCase();
  if (/reset|34|shutdown/.test(t)) return 'off_duty';
  if (/en route|delivering|dispatch/.test(t)) return 'driving';
  if (/ntb|yard|home|available/.test(t)) return 'on_duty';
  return 'on_duty';
}

class MockSamsara implements SamsaraService {
  get status(): ConnStatus { return samsaraStatus(); }
  get label(): string {
    const n = connectedOrgCount();
    return n === 0 ? 'Samsara: no orgs connected (mock data)'
      : `Samsara: ${n} of 3 orgs · key${n === 1 ? '' : 's'} saved · backend pending (mock data)`;
  }
  async hos(): Promise<DriverHos[]> {
    return loadFleet().map((t) => {
      const avail = Math.max(0, Math.min(11, t.hoursAvail > 11 ? 11 : t.hoursAvail));
      const driven = Math.round((11 - avail) * 10) / 10;
      return {
        truck: t.tractor,
        driver: [t.driver1, t.driver2].filter(Boolean).join(' / ') || t.type,
        hoursAvailable: avail,
        hoursDriven: driven,
        cycleHoursRemaining: Math.max(0, Math.min(70, t.hoursAvail)),
        dutyStatus: dutyFromStatus(t.status),
        source: 'mock',
      };
    });
  }
  async positions(): Promise<TruckGps[]> {
    const now = Date.now() / 1000;
    return loadFleet().map((t, i) => {
      const c = CITY_COORDS[(t.currentCity || t.homeCity || '').toUpperCase()] ?? CITY_COORDS['DALLAS'];
      const moving = /en route|delivering|transit/.test((t.status || '').toLowerCase());
      /* until real GPS is wired, en-route trucks drift on a slow loop so you can
         see the markers move; parked trucks sit still (source stays 'mock') */
      const driftLng = moving ? Math.sin(now / 9 + i) * 0.6 : 0;
      const driftLat = moving ? Math.cos(now / 11 + i) * 0.3 : 0;
      return {
        truck: t.tractor,
        lat: c.lat + ((i % 7) - 3) * 0.05 + driftLat,
        lng: c.lng + ((i % 5) - 2) * 0.05 + driftLng,
        speedMph: moving ? 58 + (i % 8) : 0,
        heading: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][i % 8],
        updatedAt: new Date().toISOString(), source: 'mock',
      };
    });
  }
  savedGeofences(): Geofence[] { return importedGeofences(); }
  async fetchRemoteGeofences(): Promise<Geofence[]> {
    /* Geofences come from ONE org only — the designated geofence source (AJG).
       Mock returns a stub set tagged to that org; when the backend is wired this
       reads geofenceSourceOrg().key and hits only that org's /fleet/geofences. */
    const src = geofenceSourceOrg();
    const at = (city: string, name: string, kind: Geofence['kind'], r: number): Geofence => {
      const c = CITY_COORDS[city] ?? CITY_COORDS['DALLAS'];
      return { id: `sg-${city.toLowerCase().replace(/\s+/g, '-')}-${kind}`, name, lat: c.lat, lng: c.lng, radiusMeters: r, kind, source: 'mock' };
    };
    const label = src ? src.name : 'AJG Transport';
    return [
      at('DALLAS', `${label} Dallas Yard`, 'yard', 400),
      at('SAN ANTONIO', `${label} San Antonio Terminal`, 'terminal', 500),
      at('MEMPHIS', `${label} Memphis Yard`, 'yard', 350),
      at('COPPELL', 'USPS Coppell NDC', 'customer', 300),
      at('ATLANTA', 'USPS Atlanta P&DC', 'customer', 300),
      at('HOUSTON', `${label} Houston Drop`, 'other', 250),
    ];
  }
}

const mock = new MockSamsara();
export function samsara(): SamsaraService { return mock; }
/* TODO(go-live): real client — for each org in samsaraOrgs() with a key, POST to
   the backend proxy that holds that org's token server-side; MERGE the results:
   HOS from /fleet/hos_daily_logs and GPS from /fleet/vehicles/locations across
   ALL connected orgs → DriverHos/TruckGps; geofences from /fleet/geofences on
   geofenceSourceOrg() ONLY → Geofence. Same shapes; nothing else changes. */

/* ---- imported-geofence store (persists what the user pulled in) ---- */
export function importedGeofences(): Geofence[] {
  try { const r = localStorage.getItem(GEO_STORE); if (r) return JSON.parse(r) as Geofence[]; } catch { /* ignore */ }
  return [];
}
export function saveImportedGeofences(list: Geofence[]) {
  try { localStorage.setItem(GEO_STORE, JSON.stringify(list)); } catch { /* ignore */ }
}
export function addImportedGeofences(add: Geofence[]) {
  const byId = new Map(importedGeofences().map((g) => [g.id, g]));
  for (const g of add) byId.set(g.id, g);
  saveImportedGeofences([...byId.values()]);
}
export function removeImportedGeofence(id: string) {
  saveImportedGeofences(importedGeofences().filter((g) => g.id !== id));
}
