/* Unit rating by odometer + make — GH "Truck Rating & Monthly Re-Rating SOP" v1.1.
   Each power unit is rated A/B/C/D by accumulated mileage, with MAKE-SPECIFIC
   thresholds (Internationals rated more conservatively; Volvo/Peterbilt carry
   higher thresholds). 750,000 mi is a HARD line into D for every make (the
   transmission is out of warranty past 750K). Bands read low-to-high: a unit AT
   a threshold moves into the next tier DOWN (so exactly 350K Int'l → B). */

export type Make = 'international' | 'volvo_peterbilt' | 'other';

export function normMake(make: string | undefined | null): Make {
  const m = (make || '').toLowerCase();
  if (m.includes('international') || /\bintl?\b/.test(m) || m.includes('navistar')) return 'international';
  if (m.includes('volvo') || m.includes('peterbilt') || /\bpete\b/.test(m)) return 'volvo_peterbilt';
  return 'other';
}

/* [A upper, B upper, C upper] in miles; D = at/above C upper (always 750K) */
const BANDS: Record<Make, [number, number, number]> = {
  international: [350_000, 550_000, 750_000],
  volvo_peterbilt: [450_000, 650_000, 750_000],
  other: [400_000, 600_000, 750_000],
};

export const HARD_D_MILES = 750_000;   // transmission warranty cutoff — D for every make

export function rateByOdometer(miles: number | undefined | null, make?: string | null): string {
  if (miles == null || !Number.isFinite(miles) || miles <= 0) return '';
  if (miles >= HARD_D_MILES) return 'D';
  const [a, b, c] = BANDS[normMake(make)];
  if (miles < a) return 'A';
  if (miles < b) return 'B';
  if (miles < c) return 'C';
  return 'D';
}

/* lane eligibility summary per rating (SOP §4) */
export const LANE_ELIGIBILITY: Record<string, string> = {
  A: 'Unrestricted — any lane type, any distance (incl. longest OTR).',
  B: 'Unrestricted (monitored) — any lane; watch mileage toward C.',
  C: 'Regional out-and-back near hubs · 2–3 days, returns weekly · SOLO only. Keep close to the hub network.',
  D: 'Local / inter-hub within tow range only (e.g. SA↔Dallas, Dallas↔Memphis). Never beyond ~a day of a hub.',
};

export const RATING_COLORS: Record<string, string> = {
  A: '#2f855a', B: '#3f7f8f', C: '#b58a4a', D: '#b26b62',
};

export const MAKE_LABEL: Record<Make, string> = {
  international: 'International', volvo_peterbilt: 'Volvo / Peterbilt', other: 'Other',
};

export function fmtOdometer(miles: number | undefined | null): string {
  if (miles == null || !Number.isFinite(miles) || miles <= 0) return '—';
  return `${Math.round(miles).toLocaleString()} mi`;
}
