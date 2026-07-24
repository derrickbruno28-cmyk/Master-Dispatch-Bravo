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

/* Resolve a free-text city to coordinates by substring match against the map.
   Prefers the LONGEST matching key so "San Antonio" wins over a shorter alias
   and partial collisions don't grab the wrong city. */
export function findCC(s: string): CC | null {
  if (!s) return null;
  const u = s.toUpperCase().replace(/[.,]/g, '').trim();
  let best: CC | null = null;
  for (const [k, v] of Object.entries(CITY_COORDS)) {
    if (u.includes(k) && (!best || k.length > best.name.length)) best = { ...v, name: k };
  }
  return best;
}

/* Extract the trip / load code for display: FA2D3-xxx, HCR 7523D-7504, LS 16182,
   or a bare 4+ digit load number. */
export function tripCode(r: string): string {
  const m = r.match(/FA\w+-?\w+|HCR\s*[\w-]+|LS\s*\d+|\b\d{4,}\b/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

export interface ParsedRoute { origin: CC | null; destination: CC | null; oN: string; dN: string }

/* Pull origin/destination out of a route label like
   "Coppell TX - San Antonio TX FA2D3-569" or
   "Cleveland OH - Akron OH - Irving TX HCR 7523D-7504" (multi-stop → last leg). */
export function parseRoute(r: string): ParsedRoute {
  if (!r) return { origin: null, destination: null, oN: '', dN: '' };
  const c = r
    .replace(/FA\w+[-\s]?\w*/gi, '')
    .replace(/HCR\s*[\w-]+/gi, '')
    .replace(/TRIP\s*[A-Z]/gi, '')
    .replace(/\bRPDC\b|\bNDC\b/gi, '')
    .replace(/\(.*?\)/g, '')
    .replace(/Solo Approved/gi, '')
    .replace(/\bLS\b\s*\d+/gi, '')
    .replace(/\b\d{4,}\b/g, '')
    .trim();
  const p = c.split(/[-–→➜>]+/).map((s) => s.trim().replace(/\n/g, ' ')).filter((s) => s.length > 2);
  if (p.length < 2) { const only = findCC(c); return { origin: only, destination: null, oN: c, dN: '' }; }
  return {
    origin: findCC(p[0]),
    destination: findCC(p[p.length - 1]),
    oN: p[0],
    dN: p[p.length - 1],
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

/* Next-route suggestions for the planning calendar — rank routes launching from
   where a team FINISHES their current trip, gated by their remaining HOS. Fits-
   in-hours suggestions first, then shortest deadhead, then most homeward. HOS is
   read from the Samsara adapter by the caller and passed in here. */
export function nextRouteSuggestions(fromCity: string, homeCity: string, hosHours: number, radius = 600, n = 5): Match[] {
  if (!fromCity || !findCC(fromCity)) return [];
  const synth = { currentCity: fromCity, homeCity, hoursAvail: hosHours } as Truck;
  return getMatches(synth, radius, fromCity)
    .sort((a, b) => (Number(b.ok) - Number(a.ok)) || (a.dh - b.dh) || (b.hw - a.hw))
    .slice(0, n);
}
