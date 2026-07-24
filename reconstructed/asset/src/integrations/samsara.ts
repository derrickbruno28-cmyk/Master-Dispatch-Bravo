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

const KEY_STORE = 'asset-samsara-key-v1';
const GEO_STORE = 'asset-geofences-v1';

export type ConnStatus = 'not_configured' | 'key_saved' | 'connected';

export function samsaraKey(): string { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } }
export function setSamsaraKey(k: string) { try { k.trim() ? localStorage.setItem(KEY_STORE, k.trim()) : localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } }
export function maskedKey(): string { const k = samsaraKey(); return k ? `${k.slice(0, 4)}••••••••${k.slice(-4)}` : ''; }
/* real connection is deferred — even with a key saved we stay on mock until the
   backend is wired, so status never claims a live link it doesn't have */
export function samsaraStatus(): ConnStatus { return samsaraKey() ? 'key_saved' : 'not_configured'; }

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
    const s = samsaraStatus();
    return s === 'not_configured' ? 'Samsara: not connected (mock data)'
      : s === 'key_saved' ? 'Samsara: key saved · backend pending (mock data)'
      : 'Samsara: connected';
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
    /* the set that "exists in Samsara" and can be imported (stub) */
    const at = (city: string, name: string, kind: Geofence['kind'], r: number): Geofence => {
      const c = CITY_COORDS[city] ?? CITY_COORDS['DALLAS'];
      return { id: `sg-${city.toLowerCase().replace(/\s+/g, '-')}-${kind}`, name, lat: c.lat, lng: c.lng, radiusMeters: r, kind, source: 'mock' };
    };
    return [
      at('DALLAS', 'GH Dallas Yard', 'yard', 400),
      at('SAN ANTONIO', 'GH San Antonio Terminal', 'terminal', 500),
      at('MEMPHIS', 'GH Memphis Yard', 'yard', 350),
      at('COPPELL', 'USPS Coppell NDC', 'customer', 300),
      at('ATLANTA', 'USPS Atlanta P&DC', 'customer', 300),
      at('HOUSTON', 'GH Houston Drop', 'other', 250),
    ];
  }
}

const mock = new MockSamsara();
export function samsara(): SamsaraService { return mock; }
/* TODO(go-live): real client — read samsaraKey(), POST to the backend proxy that
   holds the token server-side; map /fleet/hos_daily_logs → DriverHos,
   /fleet/vehicles/locations → TruckGps, /fleet/geofences → Geofence. Same shapes. */

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
