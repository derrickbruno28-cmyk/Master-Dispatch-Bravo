/* SamsaraClient + FleetioClient — telematics + maintenance behind interfaces.
   Ship-state: mock implementations that render a "connected-state" UI with
   plausible data derived from the fleet, so the Fleet Map and Out-of-Service
   lock can be built and demoed with zero keys. Real impls read tokens from
   env via integrations/config.ts. */

import { integrationConfig, samsaraConfigured, fleetioConfigured, fleetioLiveEnabled } from './config';
import { CITY_COORDS } from '../data/fleet';
import { FLEETIO_UNITS, fleetioInService } from '../data/fleetUnits';
import { loadFleet } from '../data/fleetStore';
import { firebaseEnabled, firebaseProjectId, currentIdToken } from '../firebase';

export interface TruckPosition {
  truck: string; lat: number; lng: number;
  speedMph: number; heading: string; updatedAt: string;
  source: 'samsara' | 'mock';
}
export interface SamsaraClient {
  readonly connected: boolean; readonly label: string;
  positions(): Promise<TruckPosition[]>;
}

export type ServiceStatus = 'in_service' | 'out_of_service';
export interface VehicleService { truck: string; status: ServiceStatus; reason?: string; since?: string; source: 'fleetio' | 'mock' }
/* one Fleetio vehicle (READ ONLY — Asset Matrix never writes back to Fleetio) */
export interface FleetioUnit { truck: string; odometer: number; make: string; status: ServiceStatus; source: 'fleetio' | 'mock' }
export interface FleetioClient {
  readonly connected: boolean; readonly label: string;
  serviceStatuses(): Promise<VehicleService[]>;
  units(): Promise<FleetioUnit[]>;   // odometer + service per vehicle
}

/* ---- mock Samsara: park each truck at its current city's coordinates ---- */
class MockSamsara implements SamsaraClient {
  readonly connected = true;                       // connected-state UI, mock data
  readonly label = samsaraConfigured() ? 'Samsara: token set (impl pending)' : 'Samsara: connected (mock)';
  async positions(): Promise<TruckPosition[]> {
    return loadFleet().map((t, i) => {
      const c = CITY_COORDS[(t.currentCity || t.homeCity || '').toUpperCase()] ?? CITY_COORDS['DALLAS'];
      return {
        truck: t.tractor,
        lat: c.lat + ((i % 7) - 3) * 0.03, lng: c.lng + ((i % 5) - 2) * 0.03, // spread pins
        speedMph: (t.status || '').toLowerCase() === 'en route' ? 62 : 0,
        heading: 'N', updatedAt: new Date().toISOString(), source: 'mock',
      };
    });
  }
}
/* TODO(go-live): real Samsara — GET /fleet/vehicles/locations with
   Authorization: Bearer ${integrationConfig.samsaraToken}. */

/* ---- mock Fleetio: everything in service; the OOS override list below lets
   dispatch mark a truck out-of-service locally until Fleetio is wired ---- */
const OOS_KEY = 'asset-oos-override-v1';
export function localOosList(): string[] {
  try { const r = localStorage.getItem(OOS_KEY); if (r) return JSON.parse(r) as string[]; } catch { /* ignore */ }
  return [];
}
export function setLocalOos(truck: string, oos: boolean) {
  const list = new Set(localOosList());
  if (oos) list.add(truck); else list.delete(truck);
  try { localStorage.setItem(OOS_KEY, JSON.stringify([...list])); } catch { /* ignore */ }
}

/* the Fleetio vehicle export (data/fleetUnits) is the source of truth for the
   mock: real odometer, make, and service status per truck. A truck flagged
   Out of Service or In Shop in Fleetio is out_of_service here (blocks matrix
   assignment); dispatch can still mark any truck OOS locally on top of that. */
const FLEETIO_BY_TRUCK = new Map(FLEETIO_UNITS.map((u) => [u.tractor, u]));

class MockFleetio implements FleetioClient {
  readonly connected = true;
  readonly label = fleetioConfigured() ? 'Fleetio: token set (impl pending)' : 'Fleetio: connected (mock)';
  async serviceStatuses(): Promise<VehicleService[]> {
    const oos = new Set(localOosList());
    return loadFleet().map((t) => {
      const u = FLEETIO_BY_TRUCK.get(t.tractor);
      const fleetioOos = u ? !fleetioInService(u.status) : false;
      const out = oos.has(t.tractor) || fleetioOos;
      return {
        truck: t.tractor,
        status: out ? 'out_of_service' as const : 'in_service' as const,
        reason: oos.has(t.tractor) ? 'Marked out of service' : (fleetioOos ? u!.status : undefined),
        since: undefined, source: 'mock' as const,
      };
    });
  }
  async units(): Promise<FleetioUnit[]> {
    const oos = new Set(localOosList());
    return FLEETIO_UNITS.map((u) => ({
      truck: u.tractor, odometer: u.odometer, make: u.make,
      status: (oos.has(u.tractor) || !fleetioInService(u.status)) ? 'out_of_service' as const : 'in_service' as const,
      source: 'mock' as const,
    }));
  }
}

/* the read-only Fleetio connector (Cloud Function). The browser never holds the
   Fleetio token — it calls this same-project HTTPS function with the signed-in
   user's Firebase ID token; the function verifies the account server-side, reads
   the Fleetio secrets, and returns a sanitized vehicle list. */
/* the connector returns make + service only — odometers are never read from
   Fleetio (kept as set manually / from the export). rawStatus is the exact
   Fleetio status string (for diagnostics); inService is the server's verdict —
   true only when Fleetio marks the unit Active/In Service. */
export interface ProxyUnit { truck: string; make: string; rawStatus: string; inService: boolean }
export function fleetioProxyUrl(): string { return `https://us-central1-${firebaseProjectId}.cloudfunctions.net/fleetioVehicles`; }

interface ProxyResponse { units: ProxyUnit[]; count: number; statusCounts?: Record<string, number> }

async function fetchProxy(): Promise<ProxyResponse> {
  const idt = await currentIdToken();
  if (!idt) throw new Error('Sign-in required for live Fleetio sync.');
  const res = await fetch(fleetioProxyUrl(), { headers: { Authorization: `Bearer ${idt}` } });
  if (!res.ok) {
    let msg = `connector ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const body = await res.json();
  return { units: (body.units ?? []) as ProxyUnit[], count: body.count ?? 0, statusCounts: body.statusCounts };
}

async function fetchProxyUnits(): Promise<ProxyUnit[]> { return (await fetchProxy()).units; }

/* one-off connectivity check for the Integrations page — returns a count +
   the Fleetio status breakdown (or the server's error message), without
   changing what the app is using. */
export async function testFleetioProxy(): Promise<{ ok: boolean; count?: number; inService?: number; outOfService?: number; statusCounts?: Record<string, number>; error?: string }> {
  try {
    const r = await fetchProxy();
    const inService = r.units.filter((u) => u.inService).length;
    return { ok: true, count: r.units.length, inService, outOfService: r.units.length - inService, statusCounts: r.statusCounts };
  }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

class ProxyFleetio implements FleetioClient {
  readonly connected = true;
  readonly label = 'Fleetio: live (read-only connector)';
  private map(units: ProxyUnit[]): FleetioUnit[] {
    const oos = new Set(localOosList());
    const odoByTruck = new Map(loadFleet().map((t) => [t.tractor, t.odometer ?? 0]));
    return units.filter((u) => u.truck).map((u) => ({
      truck: u.truck,
      odometer: odoByTruck.get(u.truck) ?? 0,   // keep the existing odometer — never read from Fleetio
      make: u.make || '',
      status: (oos.has(u.truck) || !u.inService) ? 'out_of_service' as const : 'in_service' as const,
      source: 'fleetio' as const,
    }));
  }
  async units(): Promise<FleetioUnit[]> {
    try { return this.map(await fetchProxyUnits()); }
    catch (e) { console.warn('Fleetio connector unavailable — using the Fleetio export', (e as Error).message); return mockFleetio.units(); }
  }
  async serviceStatuses(): Promise<VehicleService[]> {
    return (await this.units()).map((u) => ({ truck: u.truck, status: u.status, source: 'fleetio' as const }));
  }
}

export function samsaraClient(): SamsaraClient { void integrationConfig; return mockSamsara; }
/* live connector when it's turned on AND Firebase is configured; otherwise the
   bundled Fleetio export (which is your real fleet as of the last export). */
export function fleetioClient(): FleetioClient { return (firebaseEnabled && fleetioLiveEnabled()) ? proxyFleetio : mockFleetio; }
const mockSamsara = new MockSamsara();
const mockFleetio = new MockFleetio();
const proxyFleetio = new ProxyFleetio();
