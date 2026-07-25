/* Unit rating by odometer — GH rates each tractor A / B / C / D by total mileage
   (A = lowest miles / best, D = highest). The thresholds below are a PLACEHOLDER
   until the Truck Rating SOP is dropped in; swap RATING_BANDS for the SOP's exact
   mileage cutoffs, re-run the Fleetio import once to re-rate every unit, then the
   ratings stay current from the hourly odometer sync. */

export interface RatingBand { grade: string; maxMiles: number }

/* placeholder cutoffs (miles) — replace with the SOP values */
export const RATING_BANDS: RatingBand[] = [
  { grade: 'A', maxMiles: 250_000 },
  { grade: 'B', maxMiles: 450_000 },
  { grade: 'C', maxMiles: 650_000 },
  { grade: 'D', maxMiles: Infinity },
];

export function rateByOdometer(miles: number | undefined | null): string {
  if (miles == null || !Number.isFinite(miles) || miles <= 0) return '';
  for (const b of RATING_BANDS) if (miles <= b.maxMiles) return b.grade;
  return 'D';
}

export const RATING_COLORS: Record<string, string> = {
  A: '#2f855a', B: '#3f7f8f', C: '#b58a4a', D: '#b26b62',
};

export function fmtOdometer(miles: number | undefined | null): string {
  if (miles == null || !Number.isFinite(miles) || miles <= 0) return '—';
  return `${Math.round(miles).toLocaleString()} mi`;
}
