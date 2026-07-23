/* RoutingProvider — lane-distance calculation behind an interface so the
   estimate implementation (no API key) can be swapped for exact driving miles
   later via config (VITE_ROUTING_PROVIDER=googleMaps). */

import { findCC, hd } from '../data/optimize';
import { integrationConfig } from './config';

export interface RoutePoint { city: string; state?: string; address?: string }
export interface RoutingProvider {
  readonly kind: string;
  readonly label: string;
  /** total miles across an ordered list of stops; null when it can't resolve */
  laneMiles(points: RoutePoint[]): Promise<number | null>;
}

/* Road-circuity factor: straight-line (haversine) distance × 1.2 approximates
   US highway routing well enough for CPM planning. */
const CIRCUITY = 1.2;

class EstimateRouting implements RoutingProvider {
  readonly kind: string = 'estimate';
  readonly label: string = 'Estimate (haversine × 1.2)';
  async laneMiles(points: RoutePoint[]): Promise<number | null> {
    const ccs = points.map((p) => findCC([p.city, p.state ?? ''].filter(Boolean).join(' ')) ?? findCC(p.address ?? ''));
    let total = 0; let legs = 0;
    for (let i = 0; i < ccs.length - 1; i++) {
      const a = ccs[i]; const b = ccs[i + 1];
      if (!a || !b) continue;
      total += hd(a.lat, a.lng, b.lat, b.lng) * CIRCUITY;
      legs++;
    }
    return legs > 0 ? Math.round(total) : null;
  }
}

/* TODO(go-live): exact driving miles via Google Routes API.
   Requires VITE_GOOGLE_MAPS_KEY; call the Distance Matrix / Routes endpoint
   with the stop addresses and return route.distanceMeters / 1609.34.
   Until then this stub falls back to the estimate so nothing breaks. */
class GoogleMapsRouting extends EstimateRouting implements RoutingProvider {
  override readonly kind: string = 'googleMaps';
  override readonly label: string = 'Google Maps (falling back to estimate — key not wired)';
}

export function routingProvider(): RoutingProvider {
  return integrationConfig.routingProvider === 'googleMaps' && integrationConfig.googleMapsKey
    ? new GoogleMapsRouting()
    : new EstimateRouting();
}
