/* Map data providers — national weather + road traffic for the Samsara-style
   Fleet Map. Ship-state: stub providers return plausible mock systems so the
   overlays render today; each sits behind an interface so a real feed (NWS,
   Samsara traffic, an HD-traffic vendor) can be dropped in later unchanged. */

export interface WeatherSystem {
  id: string; label: string; kind: 'rain' | 'storm' | 'snow' | 'heat' | 'clear';
  lat: number; lng: number; radiusDeg: number;   // rough coverage radius in degrees
}
export interface WeatherProvider { readonly label: string; systems(): WeatherSystem[]; }

export interface RoadSegment {
  id: string;          // e.g. "I-35"
  kind: 'interstate' | 'highway';
  points: [number, number][];   // [lng, lat] polyline across the US
}
export type Congestion = 'clear' | 'moderate' | 'heavy';
export interface TrafficProvider {
  readonly label: string;
  roads(): RoadSegment[];
  congestion(): Record<string, Congestion>;   // segmentId → level
}

export interface MapLabel { name: string; lat: number; lng: number }

/* ---- national weather (mock national forecast, not local) ---- */
const WEATHER: WeatherSystem[] = [
  { id: 'w1', label: 'Rain — Pacific NW', kind: 'rain', lat: 46.5, lng: -122.5, radiusDeg: 4.5 },
  { id: 'w2', label: 'Snow — N. Rockies', kind: 'snow', lat: 44.5, lng: -110.5, radiusDeg: 4 },
  { id: 'w3', label: 'Severe storms — Plains', kind: 'storm', lat: 37.5, lng: -97.5, radiusDeg: 5 },
  { id: 'w4', label: 'Heat advisory — Desert SW', kind: 'heat', lat: 33.5, lng: -112, radiusDeg: 4 },
  { id: 'w5', label: 'Rain — Gulf Coast', kind: 'rain', lat: 29.8, lng: -90.5, radiusDeg: 4.5 },
  { id: 'w6', label: 'Clear — Southeast', kind: 'clear', lat: 33, lng: -82, radiusDeg: 4.5 },
  { id: 'w7', label: 'Snow — Great Lakes', kind: 'snow', lat: 43.5, lng: -85, radiusDeg: 4 },
  { id: 'w8', label: 'Rain — Northeast', kind: 'rain', lat: 42.5, lng: -74, radiusDeg: 3.8 },
];
class StubWeather implements WeatherProvider {
  readonly label = 'Weather: national forecast (stub)';
  systems(): WeatherSystem[] { return WEATHER; }
}
export function weatherProvider(): WeatherProvider { return new StubWeather(); }
/* TODO(go-live): NWS national forecast → WeatherSystem[]. */

/* ---- interstates (approximate national polylines) + traffic ---- */
const ROADS: RoadSegment[] = [
  { id: 'I-5', kind: 'interstate', points: [[-122.3, 47.6], [-122.7, 45.5], [-122.3, 40.6], [-121.5, 38.6], [-119.8, 36.7], [-118.2, 34.0], [-117.1, 32.7]] },
  { id: 'I-10', kind: 'interstate', points: [[-118.2, 34.0], [-112.1, 33.4], [-106.5, 31.8], [-101.8, 30.9], [-98.5, 29.4], [-95.4, 29.8], [-90.1, 30.0], [-86.3, 30.4], [-82.3, 27.9]] },
  { id: 'I-20', kind: 'interstate', points: [[-101.8, 32.4], [-98.5, 32.7], [-96.8, 32.8], [-94.0, 32.5], [-90.2, 32.3], [-86.8, 33.5], [-84.4, 33.7], [-81.0, 33.9]] },
  { id: 'I-35', kind: 'interstate', points: [[-97.5, 27.8], [-98.5, 29.4], [-97.7, 30.3], [-96.8, 32.8], [-97.3, 35.5], [-97.5, 37.7], [-95.9, 41.3], [-93.1, 44.9]] },
  { id: 'I-40', kind: 'interstate', points: [[-118.4, 34.9], [-111.7, 35.2], [-106.6, 35.1], [-101.8, 35.2], [-97.5, 35.5], [-94.2, 35.5], [-90.0, 35.1], [-86.8, 36.2], [-80.8, 35.6]] },
  { id: 'I-70', kind: 'interstate', points: [[-112.0, 39.3], [-108.5, 39.1], [-104.9, 39.7], [-100.9, 39.1], [-97.5, 39.0], [-94.6, 39.1], [-90.2, 38.6], [-86.2, 39.8], [-82.0, 39.9]] },
  { id: 'I-80', kind: 'interstate', points: [[-122.3, 37.8], [-119.8, 39.5], [-115.8, 40.8], [-111.9, 41.2], [-107.2, 41.6], [-104.8, 41.1], [-100.8, 41.1], [-96.0, 41.3], [-91.5, 41.6], [-87.6, 41.6], [-84.0, 41.5], [-80.0, 40.9], [-74.0, 40.7]] },
  { id: 'I-75', kind: 'interstate', points: [[-84.5, 45.8], [-83.7, 43.0], [-84.5, 41.6], [-84.2, 39.1], [-84.5, 38.0], [-84.2, 35.0], [-84.4, 33.7], [-83.6, 31.6], [-82.5, 27.9], [-81.4, 25.9]] },
  { id: 'I-95', kind: 'interstate', points: [[-71.1, 42.4], [-73.2, 41.2], [-74.2, 40.2], [-75.6, 39.7], [-76.6, 39.3], [-77.0, 38.9], [-77.4, 37.5], [-78.5, 35.8], [-79.8, 34.0], [-81.1, 32.1], [-81.4, 30.3], [-80.2, 25.8]] },
  { id: 'I-90', kind: 'interstate', points: [[-122.3, 47.6], [-117.4, 47.7], [-111.0, 45.8], [-104.8, 44.1], [-100.3, 43.8], [-96.7, 43.6], [-91.2, 43.8], [-87.6, 41.9], [-81.7, 41.5], [-78.9, 42.9], [-73.8, 42.7]] },
];
class StubTraffic implements TrafficProvider {
  readonly label = 'Traffic: congestion (stub)';
  roads(): RoadSegment[] { return ROADS; }
  congestion(): Record<string, Congestion> {
    /* stable pseudo-random level per segment (deterministic so it doesn't flicker) */
    const levels: Congestion[] = ['clear', 'clear', 'moderate', 'clear', 'heavy', 'moderate', 'clear', 'heavy', 'moderate', 'clear'];
    const out: Record<string, Congestion> = {};
    ROADS.forEach((r, i) => { out[r.id] = levels[i % levels.length]; });
    return out;
  }
}
export function trafficProvider(): TrafficProvider { return new StubTraffic(); }
/* TODO(go-live): Samsara / HD-traffic feed → RoadSegment congestion. */

/* ---- labels that swap by zoom (states out, cities in) ---- */
export const STATE_LABELS: MapLabel[] = [
  { name: 'WASHINGTON', lat: 47.4, lng: -120.4 }, { name: 'OREGON', lat: 43.9, lng: -120.5 },
  { name: 'CALIFORNIA', lat: 37.2, lng: -119.7 }, { name: 'NEVADA', lat: 39.3, lng: -116.6 },
  { name: 'ARIZONA', lat: 34.2, lng: -111.7 }, { name: 'UTAH', lat: 39.3, lng: -111.7 },
  { name: 'COLORADO', lat: 39.0, lng: -105.5 }, { name: 'NEW MEXICO', lat: 34.4, lng: -106.1 },
  { name: 'TEXAS', lat: 31.5, lng: -99.3 }, { name: 'OKLAHOMA', lat: 35.6, lng: -97.5 },
  { name: 'KANSAS', lat: 38.5, lng: -98.4 }, { name: 'NEBRASKA', lat: 41.5, lng: -99.8 },
  { name: 'MINNESOTA', lat: 46.3, lng: -94.3 }, { name: 'IOWA', lat: 42.0, lng: -93.5 },
  { name: 'MISSOURI', lat: 38.4, lng: -92.5 }, { name: 'ARKANSAS', lat: 34.8, lng: -92.4 },
  { name: 'LOUISIANA', lat: 31.0, lng: -92.0 }, { name: 'ILLINOIS', lat: 40.0, lng: -89.2 },
  { name: 'INDIANA', lat: 39.9, lng: -86.3 }, { name: 'TENNESSEE', lat: 35.8, lng: -86.4 },
  { name: 'MISSISSIPPI', lat: 32.7, lng: -89.7 }, { name: 'ALABAMA', lat: 32.8, lng: -86.8 },
  { name: 'GEORGIA', lat: 32.9, lng: -83.5 }, { name: 'FLORIDA', lat: 28.6, lng: -81.8 },
  { name: 'SOUTH CAROLINA', lat: 33.9, lng: -80.9 }, { name: 'NORTH CAROLINA', lat: 35.5, lng: -79.4 },
  { name: 'VIRGINIA', lat: 37.5, lng: -78.9 }, { name: 'OHIO', lat: 40.3, lng: -82.8 },
  { name: 'KENTUCKY', lat: 37.8, lng: -85.3 }, { name: 'MICHIGAN', lat: 43.9, lng: -84.6 },
  { name: 'PENNSYLVANIA', lat: 40.9, lng: -77.7 }, { name: 'NEW YORK', lat: 42.9, lng: -75.5 },
  { name: 'WYOMING', lat: 43.0, lng: -107.5 }, { name: 'MONTANA', lat: 46.9, lng: -110.4 },
];
