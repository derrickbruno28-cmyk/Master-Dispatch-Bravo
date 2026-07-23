/* SamsaraClient + FleetioClient — telematics + maintenance behind interfaces.
   Ship-state: mock implementations that render a "connected-state" UI with
   plausible data derived from the fleet, so the Fleet Map and Out-of-Service
   lock can be built and demoed with zero keys. Real impls read tokens from
   env via integrations/config.ts. */

import { integrationConfig, samsaraConfigured, fleetioConfigured } from './config';
import { CITY_COORDS } from '../data/fleet';
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
export interface FleetioClient {
  readonly connected: boolean; readonly label: string;
  serviceStatuses(): Promise<VehicleService[]>;
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

class MockFleetio implements FleetioClient {
  readonly connected = true;
  readonly label = fleetioConfigured() ? 'Fleetio: token set (impl pending)' : 'Fleetio: connected (mock)';
  async serviceStatuses(): Promise<VehicleService[]> {
    const oos = new Set(localOosList());
    return loadFleet().map((t) => ({
      truck: t.tractor,
      status: oos.has(t.tractor) ? 'out_of_service' as const : 'in_service' as const,
      reason: oos.has(t.tractor) ? 'Marked out of service' : undefined,
      since: undefined, source: 'mock' as const,
    }));
  }
}
/* TODO(go-live): real Fleetio — GET /api/v1/vehicles with
   Authorization: Token ${integrationConfig.fleetioToken},
   Account-Token: ${integrationConfig.fleetioAccount}; match on vehicle name ==
   tractor number; out_of_service = vehicle_status_name === 'Out of Service'. */

export function samsaraClient(): SamsaraClient { void integrationConfig; return mockSamsara; }
export function fleetioClient(): FleetioClient { return mockFleetio; }
const mockSamsara = new MockSamsara();
const mockFleetio = new MockFleetio();
