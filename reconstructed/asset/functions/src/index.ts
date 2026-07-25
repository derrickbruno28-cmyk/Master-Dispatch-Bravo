/* Fleetio → Asset Matrix connector (READ ONLY — nothing is ever written to
   Fleetio). A single HTTPS function that:
     1. verifies the caller's Firebase ID token and that it's a signed-in
        GH Logistics / AJG Transport work account (same gate as Firestore),
     2. reads the Fleetio API + Account tokens from Secret Manager (never in the
        client bundle, never in the repo),
     3. pulls every vehicle from Fleetio and returns a sanitized list
        (truck #, make, service status) as JSON.
   Odometers are deliberately NOT read from Fleetio — they stay as set manually /
   from the one-time export. The browser app calls this instead of Fleetio
   directly — Fleetio's API can't be called safely from a browser (token
   exposure + no CORS). */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

initializeApp();

const FLEETIO_API_TOKEN = defineSecret('FLEETIO_API_TOKEN');
const FLEETIO_ACCOUNT_TOKEN = defineSecret('FLEETIO_ACCOUNT_TOKEN');

const COMPANY_EMAIL = /@(ghlogisticsllc|ajgtransport)\.com$/i;

/* A truck is available ONLY when Fleetio marks it Active (or "In Service").
   ANY other status — Out of Service, In Shop, Inactive, Down, Maintenance, a
   custom status, etc. — means it can't be assigned, so it maps to out-of-service.
   Blank/unknown is treated as available (don't block a truck we can't classify). */
function isFleetioActive(raw: string): boolean {
  const t = (raw || '').trim().toLowerCase();
  if (!t) return true;                                  // unknown → assume available
  if (/out.?of.?service|\boos\b|in.?shop|inactive|\bdown\b|maintenance|repair|shop|sold|retired|archiv|disposed|totaled/.test(t)) return false;
  return /active|in.?service|available|operational|ready|in.?use|assigned/.test(t) || false;
}

/* pull the vehicle status string from whichever field this Fleetio account uses */
function readStatus(v: Record<string, unknown>): string {
  const vs = v.vehicle_status as { name?: unknown } | undefined;
  return String(
    v.vehicle_status_name ?? (vs && vs.name) ?? v.status_name ?? v.status ?? v.vehicle_status_label ?? '',
  ).trim();
}

interface SanitizedUnit { truck: string; make: string; rawStatus: string; inService: boolean }

export const fleetioVehicles = onRequest(
  {
    secrets: [FLEETIO_API_TOKEN, FLEETIO_ACCOUNT_TOKEN],
    region: 'us-central1',
    cors: true,              // the function is still gated by a company ID token
    timeoutSeconds: 60,
    memory: '256MiB',
    invoker: 'public',       // access is enforced by the ID-token check below
  },
  async (req, res) => {
    // 1) auth — require a verified GH / AJG work account
    try {
      const authz = req.get('Authorization') || '';
      const m = authz.match(/^Bearer (.+)$/i);
      if (!m) { res.status(401).json({ error: 'Sign-in required.' }); return; }
      const decoded = await getAuth().verifyIdToken(m[1]);
      const email = (decoded.email || '').toLowerCase();
      if (!decoded.email_verified || !COMPANY_EMAIL.test(email)) {
        res.status(403).json({ error: 'Not an authorized work account.' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Invalid or expired session.' });
      return;
    }

    const token = FLEETIO_API_TOKEN.value();
    const account = FLEETIO_ACCOUNT_TOKEN.value();
    if (!token || !account) {
      res.status(500).json({ error: 'Fleetio secrets are not set on the server.' });
      return;
    }

    // 2) pull every vehicle (paginated) and 3) sanitize
    try {
      const units: SanitizedUnit[] = [];
      const statusCounts: Record<string, number> = {};   // raw Fleetio status → how many, for diagnostics
      for (let page = 1; page <= 25; page++) {
        const r = await fetch(`https://secure.fleetio.com/api/v1/vehicles?per_page=100&page=${page}`, {
          headers: {
            Authorization: `Token ${token}`,
            'Account-Token': account,
            'Content-Type': 'application/json',
          },
        });
        if (!r.ok) { res.status(502).json({ error: `Fleetio responded ${r.status}.` }); return; }
        const body = (await r.json()) as unknown;
        const rows: Array<Record<string, unknown>> = Array.isArray(body)
          ? (body as Array<Record<string, unknown>>)
          : (((body as { records?: unknown }).records as Array<Record<string, unknown>>) ?? []);
        for (const v of rows) {
          const truck = String(v.name ?? '').trim();
          if (!truck) continue;
          // odometer (current_meter_value) is intentionally NOT read from Fleetio
          const rawStatus = readStatus(v);
          const inService = isFleetioActive(rawStatus);
          const key = rawStatus || '(blank)';
          statusCounts[key] = (statusCounts[key] ?? 0) + 1;
          units.push({
            truck,
            make: String(v.make ?? '').trim(),
            rawStatus,
            inService,
          });
        }
        if (rows.length < 100) break;
      }
      res.set('Cache-Control', 'private, max-age=300');
      res.json({ units, count: units.length, syncedAt: new Date().toISOString(), statusCounts });
    } catch (e) {
      res.status(502).json({ error: 'Fleetio fetch failed.', detail: String((e as Error)?.message || e) });
    }
  },
);
