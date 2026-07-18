/* Rate Confirmation module (Caleb 07/16) — mirrors the carrier-verification
   architecture: callable creates a rateCons doc + emails a single-use
   tokenized link; an onRequest page renders the FULL rate con (template
   v2 = LoadConfirmationPdfV2) and takes the dispatcher's e-signature +
   driver info; signing flows back onto the LOAD (status → rc_signed,
   drivers recorded) via the admin SDK. Send access enforced server-side:
   owner / pricing_manager / FedCom admins / explicit matrix.ratecon grant. */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import nodemailer from 'nodemailer';
import { createHash, randomBytes } from 'node:crypto';

const REGION = 'us-central1';
const GMAIL_USER = defineString('GMAIL_USER', { default: 'caleb@ghlogisticsllc.com' });
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
const FROM_ADDR = 'freight@ghlogisticsllc.com';
const TEMPLATE_VERSION = 'v2'; // LoadConfirmationPdfV2

const db = () => getFirestore();

function mailer() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
  });
}

function rcUrl(id: string, token: string): string {
  const project = process.env.GCLOUD_PROJECT ?? 'bravo-matrix-gh';
  return `https://${REGION}-${project}.cloudfunctions.net/rateConPage?id=${id}&token=${token}`;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------------- snapshot shape ---------------- */
export interface RcSnapshot {
  loadNumber: string;
  tripCode: string;
  broker: string; // booking rep (Caleb: "Broker: xyz" near the top)
  sentAtCentral: string;
  equipment: string;
  teamSolo: string; // TEAM ⇒ driver 2 required
  miles: string;
  rate: string; // grand total, digits
  carrierName: string;
  carrierMc: string;
  carrierDot: string;
  toEmail: string;
  puLabel: string; // facility label
  puAddress: string; // from facilities directory when present
  puDate: string;
  puTime: string;
  puType: string; // Live Load / Power Only …
  delLabel: string;
  delAddress: string;
  delDate: string;
  delTime: string;
  comments: string;
}

/* ---------------- the USPS requirements (template v2, verbatim) ---------------- */
const TERMS: Array<[string, string]> = [
  ['1) TEAM DRIVER REQUIREMENT', `All routes over 500 miles require TEAM drivers. USPS facilities will not load the truck unless two drivers are present at check-in. If the co-driver is asleep, the active driver must still present both CDLs at check-in and complete FORM 2081. IMPORTANT: Checking in without a TEAM will result in removal from the load and a deduction of up to $5,000. Drivers must speak English. Drivers who do not speak English may be removed from loads directly by USPS.`],
  ['2) DRIVER EQUIPMENT & PPE REQUIREMENTS', `Drivers must maintain the following at all times to remain compliant with USPS protocols: 12 straps, E-track compatible; padlock + key to secure the load after sealing; reflective safety vest, required anytime outside the truck on USPS property; closed-toed shoes only — no Crocs, sandals, or non-protective footwear; long pants preferred. PENALTY: Non-compliance will result in a $100 fine.`],
  ['3) TRACKING COMPLIANCE', `Tracking is mandatory for this load. Tracking is provided via FourKites and must remain active from start to finish. PENALTIES: Failure to track: up to $250 fine. Tracking disrupted during transit and not reactivated prior to delivery: up to $250 fine.`],
  ['4) COMMUNICATION REQUIREMENTS', `Any delay, stoppage, or issue must be reported to GH Logistics within 30 minutes. PENALTY: Failure to properly report a stoppage or delay will result in a $250 fine. POD / white slip must be submitted within 24 hours of delivery. PENALTY: Delayed POD submission will result in a $250 fine.`],
  ['5) PHOTO REQUIREMENTS', `Carriers must submit the following photos: trailer wheels chocked, per USPS safety requirement; white slip / BOL / POD at each pickup and delivery on the route; freight strapped and secured before doors are closed and sealed; trailer seal and padlock before leaving the shipper. PENALTY: Missing photo documentation will result in a $250 deduction.`],
  ['6) ON-TIME PICKUP / DELIVERY REQUIREMENTS', `Drivers must be docked and checked in 15 minutes prior to the scheduled appointment time. PENALTY: Late pickup or delivery caused by the carrier, or late pickup/delivery without proper communication, will result in fines up to $500.`],
  ['7) STOP CLEARANCE REQUIREMENT', `Carriers must not depart any facility without GH Logistics approval and confirmation that all requirements above have been completed. PENALTY: Leaving without clearance will result in a $250 fine.`],
  ['8) POWER ONLY / TRAILER REQUIREMENTS', `TRAILER MANAGEMENT & REPAIR TEAM — DIRECT LINE: (830) 554-4042. Carriers may call this number to reach the Trailer Management Team and the Repair Team directly for any mechanical or functionality issues. Calling this line does not replace the requirement to report repair issues before leaving the shipper (see below). TRAILER RETURN REQUIREMENT: Loadout trailers must be returned within 5 days of pickup from origin to avoid fees. LATE TRAILER FINES: Days 6–8: $50 per day. Day 9 and beyond: $300 per day until returned. TRAILER REPAIRS: GH Logistics will cover trailer repair issues only if they are reported before leaving the shipper. Any repair or maintenance issue not reported before departure, or occurring after departure, will be the responsibility of the carrier unless otherwise notified. If the carrier is in possession of the trailer longer than the agreed-upon loadout period, the carrier will forfeit the right for trailer repairs to be reimbursed or paid for by GH Logistics. GH Logistics reserves the right to charge back reimbursed repair costs that fall within the initial loadout period if the trailer is not returned by the agreed-upon due date. TOLLS: GH Logistics is not responsible for any tolls incurred by the carrier. Any toll charges billed to GH Logistics will be charged back to the carrier at cost plus a processing fee per toll invoice. TRAILER RETURN OBLIGATION: Carrier acknowledges and agrees that any trailer tendered under this agreement must be returned to the same facility from which it was originally dispatched unless otherwise authorized in writing by GH Logistics. Failure to return equipment as specified may result in applicable penalties, recovery charges, and/or withholding of final payment.`],
  ['9) TONU & DETENTION OUTLINE', `DETENTION: Detention begins 2 hours after appointment time at shipper or receiver. Detention rate: $25 per hour. GH Logistics must be notified 30 minutes before detention begins for approval. Tracking must remain active for the entire load for detention to be paid. TONU: TONU is paid at $150 per cancellation, unless otherwise outlined.`],
  ['10) RECOVERY AGREEMENT', `If a load must be recovered due to the carrier's inability to meet service obligations, the carrier will be responsible for all recovery costs. GH Logistics reserves the right to repower or recover any USPS load to meet customer service requirements.`],
  ['11) FEDERAL LABOR COMPLIANCE', `Carrier acknowledges that this load involves USPS mail freight and may be subject to the Service Contract Act (SCA), 41 U.S.C. § 6701 et seq. By accepting this rate confirmation, Carrier affirms full compliance with all applicable provisions of the SCA, including recordkeeping and notice requirements, Department of Labor wage determinations, and any other federal labor laws. Non-compliance constitutes a material breach. Carrier shall defend, indemnify, and hold harmless GH Logistics LLC from any claims, investigations, back wages, penalties, or enforcement actions arising from Carrier's failure to comply.`],
];

interface SignedRecord {
  printName: string;
  signatureName: string;
  driver1: string;
  phone1: string;
  driver2: string;
  phone2: string;
  at: string;
  ip: string;
  ua: string;
}

/* ---------------- HTML render ---------------- */
export function renderRateCon(
  s: RcSnapshot,
  mode: 'sign' | 'signed' | 'email',
  opts: { postUrl?: string; signed?: SignedRecord; linkUrl?: string; notice?: string } = {},
): string {
  const isTeam = /TEAM/i.test(s.teamSolo);
  const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td>${esc(v) || '—'}</td></tr>`;
  const head = `
  <div class="hdr">
    <div>
      <b>GH Logistics</b><br/>11844 Bandera Road, Ste 458, Helotes TX 78023<br/>
      MC#: 004003 · DOT: 2959846<br/>Phone: 210-759-0992 · Email: ${FROM_ADDR}
    </div>
    <div class="title">LOAD CONFIRMATION</div>
  </div>
  <table class="grid">
    ${row('Load #', s.loadNumber)}${row('Trip #', s.tripCode)}
    ${row('Broker', s.broker)}
    ${row('Date', s.sentAtCentral)}${row('Equipment', s.equipment)}
    ${row('Solo/Team', s.teamSolo)}${row('Distance', s.miles ? `${s.miles} miles` : '')}
  </table>
  <h3>Carrier Information</h3>
  <table class="grid">
    ${row('Carrier', s.carrierName)}${row('MC Number', s.carrierMc)}${row('DOT Number', s.carrierDot)}
    ${row('Email', s.toEmail)}
  </table>
  <h3>Stops</h3>
  <table class="grid">
    ${row('Stop 1 (Pickup)', `${s.puDate} ${s.puTime} — ${s.puLabel}${s.puAddress ? ` · ${s.puAddress}` : ''}`)}
    ${row('Pickup Type', s.puType)}
    ${row('Stop 2 (Delivery)', `${s.delDate} ${s.delTime} — ${s.delLabel}${s.delAddress ? ` · ${s.delAddress}` : ''}`)}
  </table>
  <h3>Pay</h3>
  <table class="grid">${row('Pay Type', 'Flat')}${row('Grand Total', s.rate ? `$${s.rate}` : '—')}</table>
  <h3>Bill To</h3>
  <p class="small">All invoices and required documentation must be submitted to
  accounting@ghlogisticsllc.com AND ${FROM_ADDR} within 24 hours of delivery.</p>
  ${s.comments ? `<h3>Comments</h3><p class="small">${esc(s.comments)}</p>` : ''}
  <h3>USPS LOAD REQUIREMENTS</h3>
  <p class="small"><b>Please review and confirm all requirements below before accepting this load.
  Acceptance of this rate confirmation constitutes agreement to all terms.</b></p>
  ${TERMS.map(([t, b]) => `<h4>${esc(t)}</h4><p class="small">${esc(b)}</p>`).join('')}
  <h3>CARRIER CONFIRMATION</h3>
  <p class="small">By accepting this load, Carrier confirms they have reviewed, understand, and agree
  to comply with all USPS load requirements listed above.</p>`;

  let tail = '';
  if (mode === 'sign') {
    tail = `
  <form method="POST" action="${esc(opts.postUrl ?? '')}" class="signform">
    <h3>Sign &amp; Confirm</h3>
    <label>Driver 1 name <input name="driver1" required /></label>
    <label>Driver 1 cell phone <input name="phone1" required /></label>
    ${isTeam
      ? `<label>Driver 2 name (TEAM load) <input name="driver2" required /></label>
         <label>Driver 2 cell phone <input name="phone2" required /></label>`
      : `<label>Driver 2 name (optional) <input name="driver2" /></label>
         <label>Driver 2 cell phone (optional) <input name="phone2" /></label>`}
    <label>Print name <input name="printName" required /></label>
    <label>Signature (type your full legal name) <input name="signatureName" required class="sig" /></label>
    <label class="chk"><input type="checkbox" name="consent" required />
      I agree that typing my name constitutes my electronic signature and that I accept all terms above
      on behalf of ${esc(s.carrierName)} (E-SIGN Act consent).</label>
    <button type="submit">✓ Sign &amp; Accept Load ${esc(s.loadNumber)}</button>
  </form>`;
  } else if (mode === 'signed' && opts.signed) {
    const g = opts.signed;
    tail = `
  <div class="signedbox">
    <h3>EXECUTED — Electronically signed</h3>
    <table class="grid">
      ${row('Signature', g.signatureName)}${row('Print name', g.printName)}
      ${row('Driver 1', `${g.driver1} · ${g.phone1}`)}
      ${g.driver2 ? row('Driver 2', `${g.driver2} · ${g.phone2}`) : ''}
      ${row('Signed at', g.at)}${row('IP', g.ip)}
    </table>
  </div>`;
  } else if (mode === 'email') {
    tail = `
  <p style="text-align:center;margin:24px 0">
    <a href="${esc(opts.linkUrl ?? '')}" style="background:#2563eb;color:#fff;padding:12px 26px;border-radius:8px;
      text-decoration:none;font-weight:700">Review &amp; Sign Load ${esc(s.loadNumber)}</a>
  </p>
  <p class="small">This link is unique to this load confirmation. Enter the driver information and sign
  electronically. Questions: reply to this email or call 210-759-0992.</p>`;
  }
  if (opts.notice) tail = `<div class="notice">${esc(opts.notice)}</div>` + tail;

  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Load Confirmation ${esc(s.loadNumber)} — GH Logistics</title>
  <style>
    body{font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:760px;margin:0 auto;padding:20px;color:#111}
    .hdr{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #111;padding-bottom:10px;font-size:13px}
    .title{font-size:22px;font-weight:800;align-self:center}
    h3{margin:18px 0 6px;font-size:14px;text-transform:uppercase;letter-spacing:.5px}
    h4{margin:14px 0 4px;font-size:13px}
    .grid{width:100%;border-collapse:collapse;font-size:13px}
    .grid td{border:1px solid #ccc;padding:5px 8px}.grid .k{font-weight:700;width:170px;background:#f5f5f5}
    .small{font-size:12px;line-height:1.5}
    .signform{border:2px solid #2563eb;border-radius:10px;padding:16px;margin-top:20px;display:flex;flex-direction:column;gap:10px}
    .signform label{display:flex;flex-direction:column;font-size:12px;font-weight:700;gap:3px}
    .signform input{padding:8px;font-size:14px;border:1px solid #bbb;border-radius:6px}
    .signform .sig{font-family:Georgia,serif;font-style:italic;font-size:17px}
    .signform .chk{flex-direction:row;align-items:flex-start;gap:8px;font-weight:400}
    .signform button{background:#16a34a;color:#fff;border:none;border-radius:8px;padding:12px;font-size:15px;font-weight:800;cursor:pointer}
    .signedbox{border:2px solid #16a34a;border-radius:10px;padding:14px;margin-top:18px}
    .notice{background:#fef3c7;border:1px solid #d97706;border-radius:8px;padding:10px;margin:14px 0;font-size:13px}
    @media print{.signform button{display:none}}
  </style></head><body>${head}${tail}
  <p class="small" style="color:#777;margin-top:22px">GH Logistics · Load Confirmation ${esc(s.loadNumber)} · template ${TEMPLATE_VERSION}</p>
  </body></html>`;
}

/* ---------------- permission check (server-side mirror) ---------------- */
async function assertMaySend(uid: string): Promise<{ name: string; email: string }> {
  const snap = await db().doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'No user record.');
  const u = snap.data() as { role?: string; fedCom?: boolean; permAllow?: string[]; permDeny?: string[]; name?: string; email?: string };
  const denied = (u.permDeny ?? []).includes('matrix.ratecon');
  const allowed = u.role === 'owner' || u.role === 'pricing_manager'
    || (u.role === 'admin' && !!u.fedCom) || (u.permAllow ?? []).includes('matrix.ratecon');
  if (denied || !allowed) throw new HttpsError('permission-denied', 'Rate cons are limited to Owner / Pricing Manager / FedCom for the test period.');
  return { name: u.name ?? u.email ?? 'GH Logistics', email: u.email ?? FROM_ADDR };
}

/* ---------------- send (callable) ---------------- */
export const sendRateCon = onCall({ region: REGION, secrets: [GMAIL_APP_PASSWORD] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in.');
  const sender = await assertMaySend(request.auth.uid);
  const { loadId, toEmail, saveToCarrierId } = request.data as { loadId: string; toEmail: string; saveToCarrierId?: string };
  if (!loadId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail ?? '')) {
    throw new HttpsError('invalid-argument', 'Valid load and carrier email required.');
  }

  const loadSnap = await db().doc(`loads/${loadId}`).get();
  if (!loadSnap.exists) throw new HttpsError('not-found', 'Load not found.');
  const load = loadSnap.data() as Record<string, string | boolean | undefined>;
  if (!load.carrier) throw new HttpsError('failed-precondition', 'No carrier on the load — book it first.');
  const laneSnap = await db().doc(`lanes/${String(load.laneId)}`).get();
  const lane = (laneSnap.data() ?? {}) as Record<string, string | undefined>;

  /* carrier DB enrichment (MC/DOT) */
  const carrierQ = await db().collection('carriers').where('name', '==', load.carrier).limit(1).get();
  const carrierDoc = carrierQ.docs[0]?.data() as { mcNumber?: string; dot?: string } | undefined;

  /* facility addresses when the directory has them */
  const facId = (site: string) => site.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'unknown';
  const origin = String(lane.origin ?? '').split('\n')[0].trim();
  const dest = String(lane.destination ?? '').split('\n')[0].trim();
  const [puFac, delFac] = await Promise.all([
    db().doc(`facilities/${facId(origin)}`).get(),
    db().doc(`facilities/${facId(dest)}`).get(),
  ]);

  const central = (d: Date) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
  const timeTok = (raw?: string) => /\d{2}:\d{2}/.exec(String(raw ?? '').split('\n')[0])?.[0] ?? '';
  const lastTime = (raw?: string) => { const m = String(raw ?? '').match(/\d{2}:\d{2}/g); return m ? m[m.length - 1] : ''; };
  const nextDay = /next\s*day/i.test(String(lane.delTime ?? ''));
  const delDate = nextDay
    ? new Date(Date.parse(`${load.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    : String(load.date);

  const snapshot: RcSnapshot = {
    loadNumber: String(load.loadNumber ?? ''),
    tripCode: String(lane.tripCode ?? ''),
    broker: String(load.bookedBy ?? sender.name),
    sentAtCentral: central(new Date()),
    equipment: String(load.equipment ?? lane.defaultEquipment ?? ''),
    teamSolo: String(load.teamSolo ?? ''),
    miles: String(lane.miles ?? '').split('\n')[0],
    rate: String(load.rate ?? '').replace(/^\$/, ''),
    carrierName: String(load.carrier),
    carrierMc: carrierDoc?.mcNumber ?? '',
    carrierDot: carrierDoc?.dot ?? '',
    toEmail,
    puLabel: origin,
    puAddress: String((puFac.data() as { address?: string } | undefined)?.address ?? ''),
    puDate: String(load.date),
    puTime: timeTok(lane.arrivalTime) || timeTok(lane.departureTime),
    puType: String(load.equipment ?? lane.defaultEquipment ?? ''),
    delLabel: dest,
    delAddress: String((delFac.data() as { address?: string } | undefined)?.address ?? ''),
    delDate,
    delTime: lastTime(lane.delTime),
    comments: `Contact: ${sender.name}, ${sender.email}`,
  };

  /* void any previous active RC for this load */
  const prev = await db().collection('rateCons')
    .where('loadId', '==', loadId).where('status', 'in', ['sent', 'signed']).get();
  const batch = db().batch();
  prev.docs.forEach((d) => batch.update(d.ref, { status: 'voided', voidedAt: new Date().toISOString() }));
  await batch.commit();

  const token = randomBytes(24).toString('hex');
  const ref = db().collection('rateCons').doc();
  await ref.set({
    id: ref.id,
    loadId,
    status: 'sent',
    tokenHash: sha256(token),
    templateVersion: TEMPLATE_VERSION,
    toEmail,
    sentAt: new Date().toISOString(),
    sentBy: sender.name,
    sentByEmail: sender.email,
    expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    snapshot,
  });

  const url = rcUrl(ref.id, token);
  await mailer().sendMail({
    from: `"GH Logistics" <${GMAIL_USER.value()}>`,
    to: toEmail,
    replyTo: sender.email,
    subject: `Rate Confirmation — Load ${snapshot.loadNumber} · ${origin} → ${dest} · $${snapshot.rate}`,
    html: renderRateCon(snapshot, 'email', { linkUrl: url }),
  });

  await db().doc(`loads/${loadId}`).update({
    rcStatus: 'sent', rcSentAt: new Date().toISOString(), rcEmail: toEmail, rcSignedAt: '',
    history: FieldValue.arrayUnion({ at: new Date().toISOString(), by: sender.name, action: `rate con sent to ${toEmail}` }),
  });
  if (saveToCarrierId) {
    await db().doc(`carriers/${saveToCarrierId}`).update({ email: toEmail }).catch(() => undefined);
  }
  logger.info('rate con sent', { loadId, toEmail, rc: ref.id });
  return { ok: true, rateConId: ref.id };
});

/* ---------------- signing page (GET view / POST sign) ---------------- */
export const rateConPage = onRequest({ region: REGION, secrets: [GMAIL_APP_PASSWORD] }, async (req, res) => {
  const id = String(req.query.id ?? (req.body as Record<string, string>)?.id ?? '');
  const token = String(req.query.token ?? (req.body as Record<string, string>)?.token ?? '');
  const snap = id ? await db().doc(`rateCons/${id}`).get() : null;
  const rc = snap?.exists ? snap.data() as {
    status: string; tokenHash: string; expiresAt: string; loadId: string;
    snapshot: RcSnapshot; signed?: SignedRecord; toEmail: string; sentByEmail?: string; sentBy?: string;
  } : null;

  const fail = (msg: string) => {
    res.status(400).send(`<html><body style="font-family:sans-serif;max-width:520px;margin:60px auto">
      <h2>GH Logistics — Rate Confirmation</h2><p>${esc(msg)}</p>
      <p>Questions? Email ${FROM_ADDR} or call 210-759-0992.</p></body></html>`);
  };

  if (!rc || sha256(token) !== rc.tokenHash) return fail('This link is invalid.');
  if (rc.status === 'voided') return fail('This rate confirmation was superseded by an updated version — check your inbox for the latest link.');
  if (rc.status === 'cancelled') return fail('This load was cancelled. No action is needed.');

  if (req.method === 'GET') {
    if (rc.status === 'signed') {
      res.send(renderRateCon(rc.snapshot, 'signed', { signed: rc.signed, notice: 'Already signed — this is your executed copy.' }));
      return;
    }
    if (rc.expiresAt < new Date().toISOString()) return fail('This link has expired. Ask GH Logistics to resend the rate confirmation.');
    res.send(renderRateCon(rc.snapshot, 'sign', { postUrl: rcUrl(id, token) }));
    return;
  }

  /* POST — the signature */
  if (rc.status === 'signed') { res.redirect(rcUrl(id, token)); return; }
  if (rc.expiresAt < new Date().toISOString()) return fail('This link has expired.');
  const b = req.body as Record<string, string>;
  const isTeam = /TEAM/i.test(rc.snapshot.teamSolo);
  const need = ['printName', 'signatureName', 'driver1', 'phone1', ...(isTeam ? ['driver2', 'phone2'] : [])];
  for (const k of need) if (!String(b[k] ?? '').trim()) return fail(`Missing required field: ${k}. Go back and complete the form.`);
  if (!b.consent) return fail('The e-signature consent box is required.');

  const signed: SignedRecord = {
    printName: String(b.printName).trim(),
    signatureName: String(b.signatureName).trim(),
    driver1: String(b.driver1).trim(),
    phone1: String(b.phone1).trim(),
    driver2: String(b.driver2 ?? '').trim(),
    phone2: String(b.phone2 ?? '').trim(),
    at: new Date().toISOString(),
    ip: String(req.headers['x-forwarded-for'] ?? req.ip ?? ''),
    ua: String(req.headers['user-agent'] ?? ''),
  };

  /* transaction: only a still-'sent' RC can be signed */
  const okSign = await db().runTransaction(async (tx) => {
    const cur = await tx.get(db().doc(`rateCons/${id}`));
    if (!cur.exists || (cur.data() as { status: string }).status !== 'sent') return false;
    tx.update(db().doc(`rateCons/${id}`), { status: 'signed', signed });
    return true;
  });
  if (!okSign) return fail('This rate confirmation was already handled.');

  /* flow-back onto the load: status → rc_signed, drivers recorded */
  const loadRef = db().doc(`loads/${rc.loadId}`);
  const loadSnap = await loadRef.get();
  if (loadSnap.exists) {
    const cur = loadSnap.data() as { status?: string; rateNotes?: string };
    const driverLine = `RC signed — Driver: ${signed.driver1} ${signed.phone1}${signed.driver2 ? ` / ${signed.driver2} ${signed.phone2}` : ''}`;
    await loadRef.update({
      rcStatus: 'signed',
      rcSignedAt: signed.at,
      rcDriver1: signed.driver1, rcPhone1: signed.phone1,
      rcDriver2: signed.driver2, rcPhone2: signed.phone2,
      ...(['covered', 'booked_rc_pending'].includes(cur.status ?? '') ? { status: 'rc_signed' } : {}),
      rateNotes: `${cur.rateNotes ? cur.rateNotes + '\n' : ''}${driverLine}`,
      history: FieldValue.arrayUnion({ at: signed.at, by: signed.signatureName, action: `rate con e-signed (${signed.printName})` }),
    });
  }

  /* executed copies to both parties */
  const executed = renderRateCon(rc.snapshot, 'signed', { signed });
  await mailer().sendMail({
    from: `"GH Logistics" <${GMAIL_USER.value()}>`,
    to: rc.toEmail,
    cc: rc.sentByEmail,
    subject: `EXECUTED Rate Confirmation — Load ${rc.snapshot.loadNumber}`,
    html: executed,
  }).catch((e) => logger.error('executed-copy email failed', e));

  res.send(renderRateCon(rc.snapshot, 'signed', { signed, notice: '✓ Signed. An executed copy has been emailed to you. You may close this page.' }));
});

/* ---------------- cancellation: carrier removed after an RC existed ---------------- */
export const rateConCancelWatch = onDocumentUpdated(
  { document: 'loads/{id}', secrets: [GMAIL_APP_PASSWORD], region: REGION },
  async (event) => {
    const before = event.data?.before.data() as { carrier?: string; rcStatus?: string; rcEmail?: string; loadNumber?: string } | undefined;
    const after = event.data?.after.data() as { carrier?: string; rcStatus?: string } | undefined;
    if (!before || !after) return;
    const hadRc = before.rcStatus === 'sent' || before.rcStatus === 'signed';
    if (!hadRc || !before.carrier || after.carrier) return; // only fires on carrier REMOVAL with an active RC

    const rcs = await db().collection('rateCons')
      .where('loadId', '==', event.params.id).where('status', 'in', ['sent', 'signed']).get();
    const batch = db().batch();
    rcs.docs.forEach((d) => batch.update(d.ref, { status: 'cancelled', cancelledAt: new Date().toISOString() }));
    batch.update(event.data!.after.ref, { rcStatus: 'cancelled' });
    await batch.commit();

    if (before.rcEmail) {
      await mailer().sendMail({
        from: `"GH Logistics" <${GMAIL_USER.value()}>`,
        to: before.rcEmail,
        subject: `CANCELLED — Load ${before.loadNumber ?? ''} rate confirmation`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
          <h2>Load ${esc(before.loadNumber ?? '')} — CANCELLED</h2>
          <p>The rate confirmation previously ${before.rcStatus === 'signed' ? 'signed' : 'sent'} for this load has been
          <b>cancelled</b> by GH Logistics. Do not dispatch on this load.</p>
          <p>Questions: ${FROM_ADDR} · 210-759-0992</p></div>`,
      }).catch((e) => logger.error('cancel email failed', e));
      logger.info('rate con cancelled + carrier notified', { loadId: event.params.id, to: before.rcEmail });
    }
  },
);
