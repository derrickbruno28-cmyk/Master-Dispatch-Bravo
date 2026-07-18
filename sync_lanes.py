/* GHL Rate Check — ported into Bravo Matrix (v2.26.0) from the standalone
   ghl-ratecheck Firebase project (source: Desktop\ghl-ratecheck).

   Dispatcher go/no-go: origin/dest city+state + all-in buy rate → ONLY a
   green/red verdict. HARD REQUIREMENT carried over: the rate table never
   reaches the client — lookup + math happen here, the client gets a verdict.

   Branch A: lane match in `rateCheckLanes` (benchmark = mean all_in over the
   matching live trips, strict-under wins). Branch B: no lane match → Google
   Routes driving miles (cached in `rateCheckRouteCache`, 30-day TTL) vs the
   $/mi RATE_CAP. Every check is logged to `rateCheckLogs` (server-only, QA).

   Data updates: rateCheckUpdateMaster takes the GHL_USPS_Master_Rate_File
   .xlsx (base64), applies pending→current + live-date logic, resolves NASS
   aliases (unknown NASS hard-fails — add the alias HERE and redeploy), and
   rebuilds `rateCheckLanes`. None of these collections have client rules on
   purpose: the Admin SDK bypasses rules, clients get default-deny. */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import * as XLSX from 'xlsx';

const REGION = 'us-central1';
const GOOGLE_MAPS_KEY = defineSecret('GOOGLE_MAPS_KEY');

/* Back-office domains — mirror app/src/firebase.ts REQUIRED_DOMAINS (rule 9c:
   ajgtransport.com is never removed without Caleb's express written consent). */
const ALLOWED_DOMAINS = ['ghlogisticsllc.com', 'ajgtransport.com'];

const CONFIG = {
  FSC_RATE: 0.70,       // fuel surcharge $/mile added to linehaul for all-in
  RATE_CAP: 5.00,       // Branch B (no-lane) $/mile ceiling
  MATCH_REVERSE: false, // if true, A->B also matches B->A
  STRICT_UNDER: true,   // under = GREEN; equal = RED (strict `<`)
};

/* ---------------- normalization (port of lib/normalize.js) ---------------- */

const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca',
  colorado: 'co', connecticut: 'ct', delaware: 'de', 'district of columbia': 'dc',
  florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id', illinois: 'il',
  indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la',
  maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn',
  mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv',
  'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny',
  'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok',
  oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
  'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt',
  virginia: 'va', washington: 'wa', 'west virginia': 'wv', wisconsin: 'wi',
  wyoming: 'wy',
};

/* Alternate city names a dispatcher may type for the same endpoint, folded
   onto the canonical key. Keyed on the full "city|state" so same-named cities
   in other states are untouched (Caleb 07/16: either-or typing). */
const KEY_SYNONYMS: Record<string, string> = {
  'missouri city|tx': 'houston|tx', // 774LP SOUTH HOUSTON TX LPC sits in Missouri City (trip FA2D3-51)
};

function collapse(s: unknown): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}
function normState(state: unknown): string {
  const s = collapse(state);
  if (!s) return '';
  if (s.length === 2) return s;
  return STATE_NAME_TO_ABBR[s] || s;
}
function normKey(city: unknown, state: unknown): string {
  const key = `${collapse(city)}|${normState(state)}`;
  return KEY_SYNONYMS[key] || key;
}

/* ---------------- NASS -> city/state aliases (port of lib/aliases.js) ------
   Unknown NASS codes hard-fail the master upload rather than producing a
   silent mismatch. Keep in sync with Desktop\ghl-ratecheck until that site
   retires. */
const ALIASES: Record<string, { city: string; state: string }> = {
  '750': { city: 'Coppell', state: 'TX' },
  '75H': { city: 'Coppell', state: 'TX' },
  '795': { city: 'Abilene', state: 'TX' },
  '790': { city: 'Amarillo', state: 'TX' },
  '335DC': { city: 'Tampa', state: 'FL' },
  '372MA': { city: 'Nashville', state: 'TN' },
  '330PM': { city: 'West Palm Beach', state: 'FL' },
  '328PM': { city: 'Orlando', state: 'FL' },
  '150PM': { city: 'Pittsburgh', state: 'PA' },
  '750PS': { city: 'Coppell', state: 'TX' },
  '196PS': { city: 'Scranton', state: 'PA' },
  '290': { city: 'Columbia', state: 'SC' },
  '294': { city: 'Charleston', state: 'SC' },
  '296': { city: 'Greenville', state: 'SC' },
  '390': { city: 'Jackson', state: 'MS' },
  '01Z': { city: 'Springfield', state: 'MA' },
  '07Z': { city: 'Kearny', state: 'NJ' },
  '20Z': { city: 'Washington', state: 'DC' },
  '220': { city: 'Merrifield', state: 'VA' },
  '303CX': { city: 'Atlanta', state: 'GA' },
  '66Z': { city: 'Kansas City', state: 'MO' },
  '94Z': { city: 'San Francisco', state: 'CA' },
  '07H': { city: 'Phillipsburg', state: 'NJ' },
  '144PM': { city: 'Rochester', state: 'NY' },
  '230': { city: 'Richmond', state: 'VA' },
  '270': { city: 'Greensboro', state: 'NC' },
  '275': { city: 'Raleigh', state: 'NC' },
  '280RP': { city: 'Charlotte', state: 'NC' },
  '283AN': { city: 'Fayetteville', state: 'NC' },
  '302RP': { city: 'Atlanta', state: 'GA' },
  '323': { city: 'Tallahassee', state: 'FL' },
  '325': { city: 'Pensacola', state: 'FL' },
  '32Z': { city: 'Jacksonville', state: 'FL' },
  '331': { city: 'Miami', state: 'FL' },
  '334': { city: 'West Palm Beach', state: 'FL' },
  '350': { city: 'Birmingham', state: 'AL' },
  '350AX': { city: 'Birmingham', state: 'AL' },
  '357': { city: 'Huntsville', state: 'AL' },
  '360': { city: 'Montgomery', state: 'AL' },
  '365AN': { city: 'Mobile', state: 'AL' },
  '370': { city: 'Nashville', state: 'TN' },
  '373': { city: 'Chattanooga', state: 'TN' },
  '377': { city: 'Knoxville', state: 'TN' },
  '381RP': { city: 'Memphis', state: 'TN' },
  '38Z': { city: 'Memphis', state: 'TN' },
  '400': { city: 'Louisville', state: 'KY' },
  '403': { city: 'Lexington', state: 'KY' },
  '440': { city: 'Cleveland', state: 'OH' },
  '45Z': { city: 'Cincinnati', state: 'OH' },
  '462RP': { city: 'Indianapolis', state: 'IN' },
  '606': { city: 'Chicago', state: 'IL' },
  '60S': { city: 'Chicago', state: 'IL' },
  '630FZ': { city: 'Saint Louis', state: 'MO' },
  '63Z': { city: 'Saint Louis', state: 'MO' },
  '660RP': { city: 'Kansas City', state: 'KS' },
  '700': { city: 'New Orleans', state: 'LA' },
  '720AX': { city: 'Little Rock', state: 'AR' },
  '730': { city: 'Oklahoma City', state: 'OK' },
  '752RT': { city: 'Dallas', state: 'TX' },
  '75Z': { city: 'Dallas', state: 'TX' },
  '773': { city: 'Houston', state: 'TX' },
  '774LP': { city: 'Houston', state: 'TX' }, // Missouri City — see KEY_SYNONYMS
  '785': { city: 'McAllen', state: 'TX' },
  '780': { city: 'San Antonio', state: 'TX' },
  '780MP': { city: 'San Antonio', state: 'TX' },
  '786FZ': { city: 'Austin', state: 'TX' },
  '793': { city: 'Lubbock', state: 'TX' },
  '80Z': { city: 'Denver', state: 'CO' },
  '850RP': { city: 'Phoenix', state: 'AZ' },
  '925MV': { city: 'Moreno Valley', state: 'CA' },
  '940': { city: 'San Francisco', state: 'CA' },
  '990': { city: 'Spokane', state: 'WA' },
};

/* ---------------- master-file export (port of lib/exportLanes.js) --------- */

interface RateCheckLane {
  trip_id: string;
  contract: string;
  origin_key: string;
  dest_key: string;
  origin_label: string;
  dest_label: string;
  effective_rate: number;
  trip_miles: number;
  all_in: number;
  live_from: string | null;
  live_to: string | null;
}

type Row = Record<string, unknown>;

const MASTER_SHEETS = [
  { sheet: 'FA2D3_Master', contract: 'FA2D3' },
  { sheet: '7523D_Master', contract: '7523D' },
];

function toISODate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Live linehaul: pending wins when its window covers today, else current. */
function liveRate(row: Row, today: string): { rate: number | null; eff: string | null; exp: string | null } {
  const pend = toNum(row.Pending_Rate);
  const pEff = toISODate(row.Pending_Eff);
  const pExp = toISODate(row.Pending_Exp);
  if (pend != null && pEff != null && pEff <= today && (pExp == null || pExp >= today)) {
    return { rate: pend, eff: pEff, exp: pExp };
  }
  return { rate: toNum(row.Current_Rate), eff: toISODate(row.Current_Eff), exp: toISODate(row.Current_Exp) };
}

function parseWorkbook(buffer: Buffer): Record<string, Row[]> {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const out: Record<string, Row[]> = {};
  for (const name of wb.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { defval: null, raw: true });
  }
  return out;
}

function buildLanes(sheets: Record<string, Row[]>, today: string) {
  const lanes: RateCheckLane[] = [];
  const dropped: { tripId: string; contract: string; reason: string }[] = [];
  const missing = new Map<string, string>();

  const resolve = (nass: unknown, facility: unknown) => {
    const key = String(nass ?? '').trim();
    const alias = ALIASES[key];
    if (!alias) {
      missing.set(key, String(facility ?? '').trim());
      return null;
    }
    return alias;
  };

  for (const { sheet, contract } of MASTER_SHEETS) {
    for (const row of sheets[sheet] ?? []) {
      const tripId = row.Trip_ID == null ? null : String(row.Trip_ID).trim();
      if (!tripId) continue;

      const { rate, eff: rateEff, exp: rateExp } = liveRate(row, today);
      const liveFrom = toISODate(row.Schedule_Eff_Date) || rateEff;
      const liveTo = row.Schedule_Exp_Date !== undefined && toISODate(row.Schedule_Exp_Date) != null
        ? toISODate(row.Schedule_Exp_Date)
        : rateExp;
      const miles = toNum(row.Trip_Miles);

      if (rate == null || rate <= 0) { dropped.push({ tripId, contract, reason: 'no live rate' }); continue; }
      if (miles == null || miles <= 0) { dropped.push({ tripId, contract, reason: 'missing/zero trip_miles' }); continue; }
      if (liveFrom && liveFrom > today) { dropped.push({ tripId, contract, reason: `not yet live (from ${liveFrom})` }); continue; }
      if (liveTo && liveTo < today) { dropped.push({ tripId, contract, reason: `expired (to ${liveTo})` }); continue; }

      const o = resolve(row.Origin_NASS, row.Origin_Facility);
      const d = resolve(row.Dest_NASS, row.Dest_Facility);
      if (!o || !d) continue;

      lanes.push({
        trip_id: tripId,
        contract,
        origin_key: normKey(o.city, o.state),
        dest_key: normKey(d.city, d.state),
        origin_label: `${o.city}, ${o.state}`,
        dest_label: `${d.city}, ${d.state}`,
        effective_rate: round2(rate),
        trip_miles: miles,
        all_in: round2(rate + CONFIG.FSC_RATE * miles),
        live_from: liveFrom,
        live_to: liveTo,
      });
    }
  }

  if (missing.size > 0) {
    const err = new HttpsError(
      'failed-precondition',
      `Upload aborted: ${missing.size} unknown NASS code(s) need an alias in functions/src/ratecheck.ts`,
      { missing: [...missing.entries()].map(([nass, facility]) => ({ nass, facility })) },
    );
    throw err;
  }
  return { lanes, dropped, counts: { built: lanes.length, dropped: dropped.length } };
}

/* ---------------- Branch B mileage (port of lib/routes.js) ---------------- */

const METERS_PER_MILE = 1609.344;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function routeMiles(originKey: string, destKey: string, rawApiKey: string): Promise<number | null> {
  /* Sanitize the secret: a BOM or stray whitespace in the stored value makes
     fetch() reject the header with an opaque ByteString error (07/16 incident
     — a PowerShell pipe BOM'd the secret and every Branch B check errored). */
  const apiKey = rawApiKey.replace(/^\uFEFF/, '').trim();
  const db = getFirestore();
  const ref = db.doc(`rateCheckRouteCache/${originKey}__${destKey}`);
  const snap = await ref.get();
  if (snap.exists) {
    const c = snap.data()!;
    if (typeof c.miles === 'number' && Date.now() - (c.ts || 0) < CACHE_TTL_MS) return c.miles;
  }
  const addr = (key: string) => {
    const [city, state] = key.split('|');
    return `${city}, ${state}, USA`;
  };
  const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters',
    },
    body: JSON.stringify({
      origin: { address: addr(originKey) },
      destination: { address: addr(destKey) },
      travelMode: 'DRIVE',
      units: 'IMPERIAL',
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Routes API ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = (await resp.json()) as { routes?: { distanceMeters?: number }[] };
  const meters = data.routes?.[0]?.distanceMeters;
  if (!Number.isFinite(meters) || (meters as number) <= 0) return null;
  const miles = (meters as number) / METERS_PER_MILE;
  await ref.set({ miles, ts: Date.now(), origin_key: originKey, dest_key: destKey });
  return miles;
}

/* ---------------- auth: Bravo permission model ----------------------------
   Server-side mirror of permissions.ts can(user, key): deny beats allow beats
   role default; owner is never denied. Role default for 'ratecheck' = every
   role above base (Caleb 07/16); 'ratecheck.upload' = owner only. */

async function requirePerm(request: CallableRequest, key: string, roleDefault: (role: string) => boolean): Promise<string> {
  const token = request.auth?.token;
  if (!token) throw new HttpsError('unauthenticated', 'Sign in required.');
  const email = String(token.email ?? '').toLowerCase();
  if (!token.email_verified || !ALLOWED_DOMAINS.some((d) => email.endsWith(`@${d}`))) {
    throw new HttpsError('permission-denied', 'Company sign-in required.');
  }
  const udoc = await getFirestore().doc(`users/${request.auth!.uid}`).get();
  const u = udoc.data() ?? {};
  const rawRole = String(u.role ?? 'base');
  const role = rawRole === 'user' ? 'broker_rep' : rawRole;
  const allow = Array.isArray(u.permAllow) && u.permAllow.includes(key);
  const deny = Array.isArray(u.permDeny) && u.permDeny.includes(key);
  const ok = role === 'owner' || (!deny && (roleDefault(role) || allow));
  if (!ok) throw new HttpsError('permission-denied', `Rate Check requires the '${key}' permission.`);
  return email;
}

/* Every provisioned role above base — keep in sync with types.ts Role.
   (qa_rep v2.23.0; trailer_manager/trailer_rep v2.25.0.) */
const KNOWN_ROLES = ['owner', 'pricing_manager', 'asset_admin', 'admin', 'pricing_rep', 'broker_rep', 'asset_rep', 'qa_manager', 'qa_rep', 'trailer_manager', 'trailer_rep'];
const aboveBase = (role: string) => KNOWN_ROLES.includes(role);
/* Master-file upload: Owner + Pricing Manager (Caleb 07/16, v2.26.1). */
const uploadTier = (role: string) => role === 'owner' || role === 'pricing_manager';

function todayCentralISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/* ---------------- callables ---------------------------------------------- */

export const rateCheck = onCall(
  { region: REGION, secrets: [GOOGLE_MAPS_KEY] },
  async (request) => {
    const email = await requirePerm(request, 'ratecheck', aboveBase);
    const db = getFirestore();
    const d = (request.data ?? {}) as Record<string, unknown>;

    const originCity = String(d.originCity ?? '').trim();
    const originState = String(d.originState ?? '').trim();
    const destCity = String(d.destCity ?? '').trim();
    const destState = String(d.destState ?? '').trim();
    const rate = Number(d.rate);
    if (!originCity || !originState || !destCity || !destState) {
      throw new HttpsError('invalid-argument', 'Enter origin and destination city/state.');
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new HttpsError('invalid-argument', 'Enter a positive all-in rate.');
    }

    const o = normKey(originCity, originState);
    const dKey = normKey(destCity, destState);
    const today = todayCentralISO();

    const queries = [
      db.collection('rateCheckLanes').where('origin_key', '==', o).where('dest_key', '==', dKey).get(),
    ];
    if (CONFIG.MATCH_REVERSE) {
      queries.push(db.collection('rateCheckLanes').where('origin_key', '==', dKey).where('dest_key', '==', o).get());
    }
    const snaps = await Promise.all(queries);
    const matches: RateCheckLane[] = [];
    for (const snap of snaps) {
      snap.forEach((doc) => {
        const lane = doc.data() as RateCheckLane;
        if ((!lane.live_from || lane.live_from <= today) && (!lane.live_to || lane.live_to >= today)) {
          matches.push(lane);
        }
      });
    }

    let verdict: 'green' | 'red' | 'error';
    let matched = matches.length > 0;
    let branch: 'A' | 'B';
    if (matched) {
      branch = 'A';
      const benchmark = matches.reduce((s, m) => s + (m.all_in || 0), 0) / matches.length;
      verdict = (CONFIG.STRICT_UNDER ? rate < benchmark : rate <= benchmark) ? 'green' : 'red';
    } else {
      branch = 'B';
      let miles: number | null = null;
      try {
        miles = await routeMiles(o, dKey, GOOGLE_MAPS_KEY.value());
      } catch (e) {
        logger.error('Routes API failed', { o, dKey, err: (e as Error).message });
      }
      if (miles == null || miles <= 0) {
        verdict = 'error';
        await db.collection('rateCheckLogs').add({ email, o, dKey, rate, verdict, branch, ts: FieldValue.serverTimestamp() });
        return { verdict, matched };
      }
      const rpm = rate / miles;
      verdict = (CONFIG.STRICT_UNDER ? rpm < CONFIG.RATE_CAP : rpm <= CONFIG.RATE_CAP) ? 'green' : 'red';
    }

    await db.collection('rateCheckLogs').add({ email, o, dKey, rate, verdict, branch, ts: FieldValue.serverTimestamp() });
    return { verdict, matched };
  },
);

export const rateCheckUpdateMaster = onCall(
  { region: REGION, memory: '512MiB', timeoutSeconds: 300 },
  async (request) => {
    const email = await requirePerm(request, 'ratecheck.upload', uploadTier);
    const db = getFirestore();
    const d = (request.data ?? {}) as Record<string, unknown>;
    const b64 = d.fileBase64;
    if (!b64 || typeof b64 !== 'string') throw new HttpsError('invalid-argument', 'No file provided.');

    const today = todayCentralISO();
    let result: ReturnType<typeof buildLanes>;
    try {
      result = buildLanes(parseWorkbook(Buffer.from(b64, 'base64')), today);
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error('buildLanes failed', { err: (e as Error).message });
      throw new HttpsError('invalid-argument', `Could not read the master file: ${(e as Error).message}`);
    }

    // clear then rebuild
    while (true) {
      const snap = await db.collection('rateCheckLanes').limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      if (snap.size < 400) break;
    }
    let batch = db.batch();
    let n = 0;
    for (const lane of result.lanes) {
      batch.set(db.doc(`rateCheckLanes/${lane.contract}__${lane.trip_id}`), lane);
      if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();

    await db.doc('rateCheckMeta/lanes').set({
      updated_at: FieldValue.serverTimestamp(),
      updated_by: email,
      filename: String(d.filename ?? '').slice(0, 200),
      built: result.counts.built,
      dropped: result.counts.dropped,
      as_of: today,
    });
    logger.info('rate-check master updated', { by: email, ...result.counts });
    return { ok: true, built: result.counts.built, dropped: result.counts.dropped, droppedDetail: result.dropped.slice(0, 50) };
  },
);
