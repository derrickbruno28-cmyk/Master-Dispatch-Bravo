/* Carrier-verification Cloud Functions.

   Flow: admin pastes the carrier's Highway-listed contact email on the Admin
   page → client creates a verificationRequests doc → sendCarrierVerification
   emails that contact an Approve/Deny link carrying a single-use token →
   carrierVerify validates the token and approves/rejects the registration
   server-side (Admin SDK, bypasses rules — clients never gain write access).

   The Approve/Deny links land on a confirmation page; the actual decision is
   a POST from that page. Never act on the GET — corporate mail scanners
   prefetch every link in an email and would auto-approve. */
import { createHash, randomBytes } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import nodemailer from 'nodemailer';

export { sendRateCon, rateConPage, rateConCancelWatch } from './ratecon';

initializeApp();
const db = getFirestore();

/* GHL Rate Check (v2.26.0) — dispatcher go/no-go + master-file upload. */
export { rateCheck, rateCheckUpdateMaster } from './ratecheck';

const GMAIL_USER = defineString('GMAIL_USER', { default: 'caleb@ghlogisticsllc.com' });
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');

const REGION = 'us-central1';
const TOKEN_TTL_DAYS = 7;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const normalizeMc = (mc: string) => (mc ?? '').replace(/\D/g, '');
/* keep in sync with app/src/types.ts normalizeCarrierName (dup prevention) */
const normalizeCarrierName = (n: string) =>
  (n ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface VerificationRequest {
  carrierUid: string;
  contactEmail: string;
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'sent' | 'approved' | 'denied' | 'failed';
  // snapshot of the registration at send time (email + confirm page content)
  company?: string;
  mcNumber?: string;
  carrierEmail?: string;
  carrierName?: string;
  tokenHash?: string;
  expiresAt?: string;
  sentAt?: string;
}

function verifyUrl(reqId: string, token: string): string {
  const project = process.env.GCLOUD_PROJECT ?? 'bravo-matrix-gh';
  return `https://${REGION}-${project}.cloudfunctions.net/carrierVerify?id=${reqId}&token=${token}`;
}

/* ---------- send the verification email ---------- */

export const sendCarrierVerification = onDocumentCreated(
  { document: 'verificationRequests/{id}', secrets: [GMAIL_APP_PASSWORD] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const req = snap.data() as VerificationRequest;
    if (req.status !== 'pending') return;

    const cuRef = db.doc(`carrierUsers/${req.carrierUid}`);
    const cuSnap = await cuRef.get();
    if (!cuSnap.exists) {
      await snap.ref.update({ status: 'failed', error: 'carrier user not found' });
      return;
    }
    const cu = cuSnap.data()!;

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000).toISOString();
    const url = verifyUrl(snap.id, token);

    const company = String(cu.company ?? '');
    const mc = String(cu.mcNumber ?? '');
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
        <h2 style="font-weight:600">GH Logistics — loadboard access verification</h2>
        <p><b>${esc(String(cu.name ?? '') || 'A user')}</b> (${esc(String(cu.email ?? ''))}) requested access to the
        GH Logistics carrier loadboard on behalf of <b>${esc(company)}</b> (MC ${esc(mc)}).</p>
        <p>You're receiving this because this address is listed as ${esc(company)}'s contact on Highway.
        If this person works for your company and should be able to make offers on GH Logistics freight,
        confirm below.</p>
        <p style="margin:28px 0">
          <a href="${url}" style="background:#1d7a3e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Review request</a>
        </p>
        <p style="color:#666;font-size:13px">The link expires in ${TOKEN_TTL_DAYS} days and can be used once.
        If you don't recognize this request, you can deny it on the same page — or simply ignore this email.</p>
      </div>`;

    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
    });

    try {
      await transport.sendMail({
        from: `"GH Logistics Loadboard" <${GMAIL_USER.value()}>`,
        to: req.contactEmail,
        subject: `Verify loadboard access — ${company} (MC ${mc})`,
        html,
      });
    } catch (err) {
      logger.error('verification email failed', { reqId: snap.id, err });
      await snap.ref.update({ status: 'failed', error: String(err) });
      await cuRef.update({
        verification: { contactEmail: req.contactEmail, sentAt: new Date().toISOString(), status: 'failed' },
      });
      return;
    }

    const sentAt = new Date().toISOString();
    await snap.ref.update({
      status: 'sent',
      tokenHash: sha256(token),
      expiresAt,
      sentAt,
      company,
      mcNumber: mc,
      carrierEmail: String(cu.email ?? ''),
      carrierName: String(cu.name ?? ''),
    });
    await cuRef.update({
      verification: { contactEmail: req.contactEmail, sentAt, status: 'sent' },
    });
    logger.info('verification email sent', { reqId: snap.id, to: req.contactEmail, company });
  },
);

/* ---------- token landing page + decision ---------- */

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(title)}</title></head>
    <body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f5f5f7;margin:0;padding:40px 16px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;box-shadow:0 1px 4px rgba(0,0,0,.08)">
    <div style="font-weight:700;letter-spacing:.5px;margin-bottom:18px">GH LOGISTICS</div>${body}</div></body></html>`;
}

async function loadValidRequest(id: string, token: string) {
  if (!id || !token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const ref = db.doc(`verificationRequests/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const req = snap.data() as VerificationRequest;
  if (req.status !== 'sent' || !req.tokenHash || req.tokenHash !== sha256(token)) return null;
  if (req.expiresAt && req.expiresAt < new Date().toISOString()) return null;
  return { ref, req };
}

export const carrierVerify = onRequest({ region: REGION }, async (request, response) => {
  const id = String(request.query.id ?? request.body?.id ?? '');
  const token = String(request.query.token ?? request.body?.token ?? '');
  const found = await loadValidRequest(id, token);
  if (!found) {
    response.status(404).send(page('Link invalid', '<h3>This link is invalid or has expired.</h3><p>It may have already been used. Contact GH Logistics if you believe this is an error.</p>'));
    return;
  }
  const { ref, req } = found;

  // GET = mail-scanner-safe confirmation page; the decision itself is the POST below.
  if (request.method !== 'POST') {
    response.send(page('Verify loadboard access', `
      <h3 style="margin-top:0">Loadboard access request</h3>
      <p><b>${esc(req.carrierName || 'A user')}</b> (${esc(req.carrierEmail ?? '')}) says they work for
      <b>${esc(req.company ?? '')}</b> (MC ${esc(req.mcNumber ?? '')}) and requested access to the GH Logistics carrier loadboard.</p>
      <form method="POST" style="margin-top:24px">
        <input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="token" value="${esc(token)}">
        <button name="action" value="approve" style="background:#1d7a3e;color:#fff;border:0;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer">Approve — they're with us</button>
        <button name="action" value="deny" style="background:#fff;color:#b3261e;border:1px solid #b3261e;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;margin-left:10px">Deny</button>
      </form>`));
    return;
  }

  const action = String(request.body?.action ?? '');
  if (action !== 'approve' && action !== 'deny') {
    response.status(400).send(page('Bad request', '<h3>Bad request.</h3>'));
    return;
  }

  // Single use: transition sent → approved/denied atomically. Also bail if an
  // admin already resolved the registration manually — the email link must
  // never override a back-office decision.
  const cuRef = db.doc(`carrierUsers/${req.carrierUid}`);
  const decided = await db.runTransaction(async (tx) => {
    const [cur, cu] = await Promise.all([tx.get(ref), tx.get(cuRef)]);
    if (!cur.exists || (cur.data() as VerificationRequest).status !== 'sent') return false;
    if (!cu.exists || cu.data()!.status !== 'pending') return false;
    tx.update(ref, { status: action === 'approve' ? 'approved' : 'denied', respondedAt: new Date().toISOString() });
    return true;
  });
  if (!decided) {
    response.status(409).send(page('Already handled', '<h3>This request was already handled.</h3><p>No action was taken.</p>'));
    return;
  }

  const now = new Date().toISOString();
  const respondedBy = `Highway contact ${req.contactEmail} (email verification)`;
  await cuRef.update({
    status: action === 'approve' ? 'approved' : 'rejected',
    respondedBy,
    respondedAt: now,
    verification: { contactEmail: req.contactEmail, sentAt: req.sentAt ?? req.requestedAt, status: action === 'approve' ? 'approved' : 'denied' },
  });

  // Mirror the client-side approve logic: link the login to a carrier by MC
  // (or name), creating the carrier if it doesn't exist yet.
  if (action === 'approve') {
    const mc = normalizeMc(req.mcNumber ?? '');
    const company = req.company ?? '';
    const carriers = await db.collection('carriers').get();
    const existing = carriers.docs.find((d) => {
      const c = d.data();
      return (mc && normalizeMc(String(c.mcNumber ?? '')) === mc)
        || normalizeCarrierName(String(c.name ?? '')) === normalizeCarrierName(company);
    });
    if (!existing) {
      const carrierId = `carrier-${Date.now()}`;
      await db.doc(`carriers/${carrierId}`).set({ id: carrierId, name: company, mcNumber: req.mcNumber ?? '' });
    } else if (mc && !normalizeMc(String(existing.data().mcNumber ?? ''))) {
      await existing.ref.update({ mcNumber: req.mcNumber ?? '' });
    }
  }

  logger.info('carrier verification decision', { reqId: id, action, by: req.contactEmail });
  response.send(page(
    action === 'approve' ? 'Access approved' : 'Request denied',
    action === 'approve'
      ? `<h3>✅ Approved.</h3><p>${esc(req.carrierName || req.carrierEmail || 'The user')} can now sign in to the GH Logistics loadboard and make offers for ${esc(req.company ?? '')}. Thank you for confirming.</p>`
      : `<h3>Request denied.</h3><p>The registration has been rejected and the user cannot make offers. GH Logistics has been notified. Thank you for confirming.</p>`,
  ));
});

/* ---------- §6.4 empty-truck capacity snapshot ----------
   Inferred from Matrix load completions (assets AND external carriers),
   scheduled times only. Materialized to capacity/current at 08:00 Central
   daily + on-demand via the rebuildCapacity callable (admin-tier).
   Keep the inference in sync with app/src/capacity.ts. */

const GH_RE = /\bGH\b|GH\s*Logistics/i;

function centralDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Last HH:MM token in a delivery blob (port of app/src/dates.ts finalDelTime). */
function lastDelTime(delTime: string): string {
  const cleaned = (delTime ?? '').replace(/\n/g, ' ').replace(
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
  );
  const times = cleaned.match(/\d{2}:\d{2}/g);
  return times?.length ? times[times.length - 1] : '';
}

async function buildCapacitySnapshot(): Promise<number> {
  const today = centralDate();
  const yesterday = centralDate(-1);
  const [lanesSnap, loadsSnap] = await Promise.all([
    db.collection('lanes').get(),
    db.collection('loads').where('date', 'in', [yesterday, today]).get(),
  ]);
  const lanes = new Map(lanesSnap.docs.map((d) => [d.id, d.data()]));
  const entries: Record<string, unknown>[] = [];
  for (const doc of loadsSnap.docs) {
    const load = doc.data();
    if (!load.carrier || load.status === 'not_running') continue;
    const lane = lanes.get(load.laneId);
    if (!lane || lane.isGroupHeader) continue;
    const del = lastDelTime(String(lane.delTime ?? ''));
    const time = /^\d{2}:\d{2}$/.test(del) ? del : '23:59';
    const emptyDate = /next\s*day/i.test(String(lane.delTime ?? '')) ? addDaysIso(load.date, 1) : load.date;
    const isAsset = GH_RE.test(load.carrier);
    entries.push({
      unit: isAsset ? (load.truckNumber ? `GH #${load.truckNumber}` : 'GH asset') : load.carrier,
      carrier: load.carrier,
      isAsset,
      emptyAt: `${emptyDate}T${time}`,
      cityRaw: String(lane.destination ?? ''),
      laneLabel: `${lane.origin} → ${lane.destination}`,
      fromLoadId: doc.id,
      loadNumber: load.loadNumber || '',
    });
  }
  entries.sort((a, b) => String(a.emptyAt).localeCompare(String(b.emptyAt)));
  await db.doc('capacity/current').set({ builtAt: new Date().toISOString(), entries });
  logger.info('capacity snapshot built', { count: entries.length });
  return entries.length;
}

export const capacitySnapshot = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/Chicago', region: REGION },
  async () => {
    await buildCapacitySnapshot();
  },
);

export const rebuildCapacity = onCall({ region: REGION }, async (request) => {
  const email = String(request.auth?.token.email ?? '');
  if (!request.auth || !email.endsWith('@ghlogisticsllc.com')) {
    throw new HttpsError('permission-denied', 'Company sign-in required.');
  }
  const userDoc = await db.doc(`users/${request.auth.uid}`).get();
  const role = String(userDoc.data()?.role ?? 'base');
  const adminTier = ['owner', 'pricing_manager', 'asset_admin', 'admin'].includes(role === 'user' ? 'broker_rep' : role);
  if (!adminTier) throw new HttpsError('permission-denied', 'Admin access required.');
  const count = await buildCapacitySnapshot();
  return { count };
});
