/* Route Optimizer engine — ported verbatim from the AJG/GH Operations Center.
   Given a truck's current city, rank USPS routes by deadhead distance, hours
   available, and "homeward" pull. Pure functions; no backend needed. */

import { CITY_COORDS, ROUTES, type AssetRoute, type Truck } from './fleet';

export interface CC { lat: number; lng: number; name: string }

/* Great-circle miles (haversine, R = 3959 mi). */
export function hd(a1: number, n1: number, a2: number, n2: number): number {
  const R = 3959;
  const dL = (a2 - a1) * Math.PI / 180;
  const dN = (n2 - n1) * Math.PI / 180;
  const x = Math.sin(dL / 2) ** 2 + Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dN / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/* Resolve a free-text city to coordinates by substring match against the map. */
export function findCC(s: string): CC | null {
  if (!s) return null;
  const u = s.toUpperCase().replace(/[.,]/g, '').trim();
  for (const [k, v] of Object.entries(CITY_COORDS)) if (u.includes(k)) return { ...v, name: k };
  return null;
}

export interface ParsedRoute { origin: CC | null; destination: CC | null; oN: string; dN: string }

/* Pull origin/destination out of a route label like
   "Coppell TX - San Antonio TX FA2D3-569". */
export function parseRoute(r: string): ParsedRoute {
  if (!r) return { origin: null, destination: null, oN: '', dN: '' };
  const c = r
    .replace(/FA\w+-?\w*/g, '')
    .replace(/TRIP\s*[A-Z]/g, '')
    .replace(/HCR\s*\w+/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/Solo Approved/gi, '')
    .trim();
  const p = c.split(/[-→➔>]+/).map((s) => s.trim()).filter((s) => s.length > 2);
  if (p.length < 2) return { origin: null, destination: null, oN: c, dN: '' };
  return {
    origin: findCC(p[0]),
    destination: findCC(p[p.length - 1]),
    oN: p[0].replace(/\n/g, ' ').trim(),
    dN: p[p.length - 1].replace(/\n/g, ' ').trim(),
  };
}

function milesNum(m: string): number { return parseInt(m, 10) || 0; }

export interface Match extends AssetRoute, ParsedRoute {
  dh: number;   // deadhead road miles (great-circle × 1.25)
  hw: number;   // homeward pull, 0–100 (% closer to home terminal)
  hrs: number;  // estimated drive hours (deadhead + loaded) ÷ 45 mph
  ok: boolean;  // fits the driver's hours available
}

/* Rank routes for a driver within a deadhead radius (road miles).
   `fromCity` overrides the start point — pass the destination of the truck's
   CURRENT route so the suggestions are the best NEXT loads out of where the
   team will actually be once they finish. Defaults to the truck's current city. */
export function getMatches(d: Truck, radius: number, fromCity?: string): Match[] {
  const start = (fromCity && fromCity.trim()) || d.currentCity;
  const dc = findCC(start);
  if (!dc) return [];
  const hc = findCC(d.homeCity);
  const out: Match[] = [];
  for (const r of ROUTES) {
    const p = parseRoute(r.route);
    if (!p.origin) continue;
    const dhRoad = hd(dc.lat, dc.lng, p.origin.lat, p.origin.lng) * 1.25;
    if (dhRoad > radius) continue;
    let hw = 0;
    if (hc && p.destination) {
      const dH = hd(p.destination.lat, p.destination.lng, hc.lat, hc.lng);
      const cH = hd(dc.lat, dc.lng, hc.lat, hc.lng);
      hw = cH > 0 ? Math.max(0, Math.round((cH - dH) / cH * 100)) : 0;
    }
    const hrs = Math.round((milesNum(r.miles) + dhRoad) / 45 * 10) / 10;
    out.push({ ...r, ...p, dh: Math.round(dhRoad), hw, hrs, ok: d.hoursAvail >= hrs });
  }
  return out;
}
