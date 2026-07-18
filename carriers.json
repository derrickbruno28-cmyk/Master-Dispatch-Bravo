/* All date arithmetic is timezone-neutral (UTC-anchored string math) so every
   user sees the identical calendar. "Today" is always US Central time — the
   operational master clock — regardless of the viewer's local timezone. */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Today's date in US Central time (master display timezone for the org). */
export function todayCentral(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // en-CA gives YYYY-MM-DD
}

/** Alias — the app's notion of "today" is always Central. */
export function isoToday(): string {
  return todayCentral();
}

/** The Central-time calendar date (YYYY-MM-DD) of an ISO timestamp. */
export function centralDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** Rolling booking window: today through +72 hours (3 days), Central time. */
export function bookingWindow(): string[] {
  const start = todayCentral();
  return [start, addDays(start, 1), addDays(start, 2)];
}

/** Carrier loadboard window: today + the following calendar day ONLY (cutoff
    is tomorrow 23:59 Central; rolls forward at midnight). */
export function boardWindow(): string[] {
  const start = todayCentral();
  return [start, addDays(start, 1)];
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0=Sun..6=Sat for an ISO date, independent of viewer timezone. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Snap to the Saturday on or before the given date (week anchor). */
export function weekStart(iso: string): string {
  const offset = (weekdayOf(iso) + 1) % 7; // Sat=6 -> 0, Sun=0 -> 1, ...
  return addDays(iso, -offset);
}

export function dateRange(startIso: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(startIso, i));
}

/** Standardize every time token in a string to 24-hour HH:MM.
    AM/PM is folded in, timezone suffixes (CT/EST/PST…) are dropped —
    times are always local to where the pickup occurs. */
export function cleanTimes(text: string): string {
  return (text ?? '')
    .replace(
      /(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?\.?\s*(?:[CEMP][SD]?T\b)?/gi,
      (_all, h: string, m: string, ap?: string) => {
        let hh = parseInt(h, 10);
        if (ap) {
          const up = ap.toUpperCase();
          if (up === 'PM' && hh < 12) hh += 12;
          if (up === 'AM' && hh === 12) hh = 0;
        }
        return `${String(hh).padStart(2, '0')}:${m}`;
      },
    )
    .replace(/\b(\d{1,2})\s*(AM|PM)\b/gi, (_all, h: string, ap: string) => {
      let hh = parseInt(h, 10);
      if (ap.toUpperCase() === 'PM' && hh < 12) hh += 12;
      if (ap.toUpperCase() === 'AM' && hh === 12) hh = 0;
      return `${String(hh).padStart(2, '0')}:00`;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Scheduled arrival at the FINAL stop: the last time token in a delivery
    blob. Multi-drop lanes list every stop there (often with a revised
    "Effective" block appended), so the last token is the current final-stop
    appointment — the one the main views show. Full text stays in lane details. */
export function finalDelTime(delTime: string): string {
  const cleaned = cleanTimes((delTime ?? '').replace(/\n/g, ' '));
  const times = cleaned.match(/\d{2}:\d{2}/g);
  return times?.length ? times[times.length - 1] : cleaned.slice(0, 8);
}

/** "Sat 07/04" style header label. */
export function headerLabel(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${DAY_NAMES[weekdayOf(iso)]} ${m}/${d}`;
}

/** "MONDAY 7/6" style Sales Hub section label. */
export function hubLabel(iso: string): string {
  const names = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const [, m, d] = iso.split('-');
  return `${names[weekdayOf(iso)]} ${Number(m)}/${Number(d)}`;
}

/** App-standard timestamp: "7/9 22:41" — 24h everywhere (rule 4); replaces
    the scattered toLocaleString AM/PM calls. */
export function fmtStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
