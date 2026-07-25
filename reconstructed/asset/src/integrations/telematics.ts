/* SamsaraClient + FleetioClient — telematics + maintenance behind interfaces.
   Ship-state: mock implementations that render a "connected-state" UI with
   plausible data derived from the fleet, so the Fleet Map and Out-of-Service
   lock can be built and demoed with zero keys. Real impls read tokens from
   env via integrations/config.ts. */

import { integrationConfig, samsaraConfigured, fleetioConfigured } from './config';
import { CITY_COORDS } from '../data/fleet';
import { FLEETIO_UNITS, fleetioInService } from '../data/fleetUnits';
import { loadFleet } from '../data/fleetStore';

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

/* Real Fleetio — READ ONLY (no writes are ever sent to Fleetio). Reads
   GET /api/v1/vehicles when a token + account are configured; on any failure it
   falls back to the mock so the app never breaks. NOTE for go-live: Fleetio's
   API may not send CORS headers for direct browser calls — if so, route this
   through a small read-only proxy / Cloud Function (same pattern as routing). */
class LiveFleetio implements FleetioClient {
  readonly connected = true;
  readonly label = 'Fleetio: connected (live, read-only)';
  private async fetchVehicles(): Promise<Record<string, unknown>[]> {
    const res = await fetch('https://secure.fleetio.com/api/v1/vehicles?per_page=100', {
      headers: {
        Authorization: `Token ${integrationConfig.fleetioToken}`,
        'Account-Token': integrationConfig.fleetioAccount,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Fleetio ${res.status}`);
    const body = await res.json();
    return Array.isArray(body) ? body : (body.records ?? []);
  }
  async serviceStatuses(): Promise<VehicleService[]> {
    return (await this.units()).map((u) => ({ truck: u.truck, status: u.status, source: 'fleetio' as const }));
  }
  async units(): Promise<FleetioUnit[]> {
    try {
      const rows = await this.fetchVehicles();
      return rows.map((v) => {
        const name = String((v as { name?: unknown }).name ?? '').trim();
        const odo = Number((v as { current_meter_value?: unknown }).current_meter_value ?? 0);
        const st = String((v as { vehicle_status_name?: unknown }).vehicle_status_name ?? '').toLowerCase();
        const make = String((v as { make?: unknown }).make ?? '');
        return { truck: name, odometer: Number.isFinite(odo) ? odo : 0, make, status: st.includes('out of service') ? 'out_of_service' as const : 'in_service' as const, source: 'fleetio' as const };
      }).filter((u) => u.truck);
    } catch (e) {
      console.error('Fleetio read failed — using mock', e);
      return mockFleetio.units();
    }
  }
}

export function samsaraClient(): SamsaraClient { void integrationConfig; return mockSamsara; }
export function fleetioClient(): FleetioClient { return fleetioConfigured() ? liveFleetio : mockFleetio; }
const mockSamsara = new MockSamsara();
const mockFleetio = new MockFleetio();
const liveFleetio = new LiveFleetio();
