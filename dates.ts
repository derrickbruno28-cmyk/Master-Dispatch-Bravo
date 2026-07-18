import { useEffect, useMemo, useRef, useState } from 'react';
import StatusSelect from './StatusSelect';
import { useStore } from '../data/store';
import { can } from '../permissions';
import { effectiveEquipment, activeChargeback, carrierNameKey, dedicatedCoversDate, firstMoney, isAssetRep, laneShortName, fmtMoney, legStatusLabel, normalizeCarrierName, statusGroupsFor, GH_CARRIER_RE, type Lane, type Load } from '../types';
import { integrityIdForTripCode } from '../pricing';
import { baseFreeDays, buildTrailerLinks, openTrailersForCarrier } from '../trailers';
import { addDays, cleanTimes, finalDelTime, fmtStamp, headerLabel } from '../dates';

interface Props {
  lane: Lane;
  date: string;
  load: Load | undefined;
  onClose: () => void;
}

const GH_RE = /\bGH\b|GH\s*Logistics/i;
/* Covered-or-better: every confirmed status that means a carrier is on the
   hook — all of them require a rate in the Rate box (non-GH). */
const RATE_REQUIRED_STATUSES = new Set([
  'covered', 'booked_rc_pending', 'rc_signed', 'gtg', 'need_flyer',
  'flyer_sent', 'drivers_confirmed', 'dispatched', 'departed',
]);

function normalizeTruck(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Name tokens for driver-similarity checks: "Franco & John" -> ["franco","john"] */
function nameTokens(text: string): string[] {
  const STOP = new Set([
    'and', 'the', 'with', 'driver', 'drivers', 'truck', 'trk', 'team', 'solo', 'info', 'received', 'via', 'email',
    /* day-of-week tokens are schedule notes ("Mon 3-5pm yard time"), never
       driver names — matching them double-book-flagged unrelated loads.
       Tokenizing keeps this whole-word: a carrier "Montez" still counts. */
    'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    /* common ops-note words ("do not move until…") kept flagging as driver
       names — screenshot from Caleb 07/09: "not, move" false positive */
    'not', 'move', 'until', 'after', 'before', 'yard', 'time', 'pickup', 'drop',
    'late', 'early', 'call', 'called', 'will', 'needs', 'need', 'load', 'loads',
    'rate', 'con', 'sent', 'signed', 'confirmed', 'per', 'from', 'this', 'that',
  ]);
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function similarNames(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return levenshtein(a, b) <= 1;
}

export default function LoadEditor({ lane, date, load, onClose }: Props) {
  const { lanes, loads, carriers, statuses, currentUser, upsertLoad, updateLoad, addCarrier, integrity, dedicated, trailerSettings, sendRateCon } = useStore();
  const role = currentUser.role;
  const assetRep = isAssetRep(role);
  /* Brokers and up can register a brand-new carrier while booking (§2.2). */
  const mayAddCarrier = can(currentUser, 'matrix.book');
  /* Load numbers come from the tender and are immutable once set; only an
     asset LS # may be appended (format: 123456 / 654321). */
  const [baseLoadNumber] = useState((load?.loadNumber ?? '').split('/')[0].trim());
  const [assetLs, setAssetLs] = useState((load?.loadNumber ?? '').split('/')[1]?.trim() ?? '');
  const loadNumberLocked = !!baseLoadNumber;
  const [loadNumber, setLoadNumber] = useState(load?.loadNumber ?? '');
  const [carrier, setCarrier] = useState(load?.carrier ?? '');
  const [mcNumber, setMcNumber] = useState('');
  const [rate, setRate] = useState(load?.rate ?? '');
  const [rateNotes, setRateNotes] = useState(load?.rateNotes ?? '');
  const [shuttleLegStatus, setShuttleLegStatus] = useState<string>(load?.shuttleLegStatus ?? '');
  const [truckNumber, setTruckNumber] = useState(load?.truckNumber ?? '');
  const [isShuttle, setIsShuttle] = useState(!!load?.isShuttle);
  const [shuttleType, setShuttleType] = useState<'meet_swap' | 'yard_stage' | 'repower'>(load?.shuttleType ?? 'meet_swap');
  const [shuttleLocation, setShuttleLocation] = useState(load?.shuttleLocation ?? '');
  const [shuttleCarrier, setShuttleCarrier] = useState(load?.shuttleCarrier ?? '');
  const [shuttleTruckNumber, setShuttleTruckNumber] = useState(load?.shuttleTruckNumber ?? '');
  const [shuttleAssetLs, setShuttleAssetLs] = useState(load?.shuttleAssetLs ?? '');
  const [shuttleLegNotes, setShuttleLegNotes] = useState(load?.shuttleLegNotes ?? '');
  const [shuttleCity, setShuttleCity] = useState(load?.shuttleCity ?? '');
  const [shuttleState, setShuttleState] = useState(load?.shuttleState ?? '');
  const [shuttleSwapEta, setShuttleSwapEta] = useState(load?.shuttleSwapEta ?? '');
  const [shuttlePostedRate, setShuttlePostedRate] = useState(load?.shuttlePostedRate ?? '');
  const [status, setStatus] = useState(load?.status ?? 'exposed');
  const [cancelReason, setCancelReason] = useState(load?.cancelReason ?? '');
  const [tonuBill, setTonuBill] = useState(!!load?.tonuBill);
  const [cbClass, setCbClass] = useState<'once_recovered' | 'none' | ''>(load?.chargebackClass ?? '');
  const [cbAmount, setCbAmount] = useState(load?.chargebackAmount ?? '');
  const [trailerNumber, setTrailerNumber] = useState(load?.trailerNumber ?? '');
  /* L.O.T free days: '' = default from the Loading/TRM setting (3 or 5 via
     effectiveEquipment); 3/5/7 pins an explicit override (Caleb 07/17). */
  const [trailerDays, setTrailerDays] = useState<string>(load?.trailerFreeDays ? String(load.trailerFreeDays) : '');
  const [removalPrompt, setRemovalPrompt] = useState(false);
  const [removalAck, setRemovalAck] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conflict, setConflict] = useState<{ hard: boolean; message: string } | null>(null);
  const [overrideWarning, setOverrideWarning] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => firstField.current?.focus(), []);

  const history = load?.history ?? [];
  const laneMap = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);

  /* Duplicate-proofing (v2.8.1): "known" is normalization-aware (case,
     spacing, punctuation), and near-matches (suffix-insensitive) surface a
     "did you mean" hint before a new carrier can be created. */
  const knownCarrier = useMemo(() => {
    const t = normalizeCarrierName(carrier);
    return !t || carriers.some((c) => normalizeCarrierName(c.name) === t);
  }, [carrier, carriers]);
  const nearMatches = useMemo(() => {
    const key = carrierNameKey(carrier);
    if (knownCarrier || key.length < 3) return [];
    return carriers.filter((c) => {
      const k = carrierNameKey(c.name);
      return k === key || (key.length >= 4 && (k.startsWith(key + ' ') || key.startsWith(k + ' ')));
    }).slice(0, 3);
  }, [carrier, carriers, knownCarrier]);

  /* DNU hard block (Zack 07/10): a DNU carrier can be SEEN (suggestions show
     the 🚫 hint) but never assigned — leg 1 or leg 2. */
  const dnuMatch = useMemo(() => {
    const hit = (name: string) => {
      const t = normalizeCarrierName(name);
      return t ? carriers.find((c) => c.dnu && normalizeCarrierName(c.name) === t) : undefined;
    };
    return hit(carrier) ?? hit(shuttleCarrier);
  }, [carrier, shuttleCarrier, carriers]);

  const isDedicated = !!lane.dedicated && !!lane.dedicatedCarrier;
  /* §7.1: the master's Mon–Sun booleans beat CTS notes — null = no master row */
  const dedCover = dedicatedCoversDate(dedicated, lane, date);
  const mayLogCb = can(currentUser, 'matrix.chargebackLog');
  /* classifying a fallout as "No Chargeback" is admin-tier only (Caleb 07/12) */
  const mayCbNone = can(currentUser, 'admin.chargebacks');
  const isChargeback = status === 'chargeback';
  const isGH = GH_RE.test(carrier);
  /* Omitted = the SITE cancelled — logged separately from a standard cancel,
     but both require a written reason (shows in the Matrix cell). */
  const isCancelled = status === 'not_running' || status === 'omitted';
  const cancelMissing = isCancelled && !cancelReason.trim();
  /* Asset Rep: may only set GH Logistics (or clear a GHL assignment) — never
     touch another carrier's booking. Lane scope is enforced at cell-click. */
  const assetScopeOk =
    !assetRep ||
    ((carrier.trim() === '' || GH_RE.test(carrier)) && ((load?.carrier ?? '') === '' || GH_RE.test(load?.carrier ?? '')));
  /* Caleb 07/12: a load can't be saved covered-or-better without a rate IN
     THE RATE BOX (margin/analytics depend on it). GH Logistics is exempt —
     straight pass-through, the Rate field doesn't even render. */
  const effStatus = ['exposed', 'covered', 'dedicated_pending'].includes(status)
    ? (carrier.trim() ? 'covered' : 'exposed')
    : status;
  const rateMissing =
    !isGH && !!carrier.trim() && !rate.trim() && RATE_REQUIRED_STATUSES.has(effStatus);
  const blocked = (!knownCarrier && !mayAddCarrier) || cancelMissing || !assetScopeOk || !!dnuMatch || rateMissing;

  /* §6.1 shuttle pay waterfall: carrier reconciles FIRST out of TRM revenue;
     remainder (never negative) flows to the asset leg. Both-asset legs split
     the pot manually (default 50/50). */
  const shuttleIsAsset = GH_CARRIER_RE.test(shuttleCarrier);
  const bothAssets = isShuttle && isGH && shuttleIsAsset;
  const rec = integrity.find((r) => r.id === integrityIdForTripCode(lane.tripCode));
  const trmPot = rec?.trm?.currentRate ?? null;
  const negotiated = firstMoney(rate) ?? firstMoney(rateNotes);
  /* Caleb 07/09: a GH Logistics load is a straight pass-through on the full
     rate — no rate entry needed (non-shuttles, and shuttles that are GH on
     BOTH legs). Mixed shuttles keep the waterfall. */
  const passThrough = isGH && (!isShuttle || bothAssets);
  /* Rate Con module (07/16): send restricted to Owner / Pricing Manager /
     FedCom for the stress-test window; resends prompt when key terms change */
  const mayRateCon = can(currentUser, 'matrix.ratecon');
  const carrierDbMatch = useMemo(
    () => carriers.find((c) => normalizeCarrierName(c.name) === normalizeCarrierName(carrier)),
    [carrier, carriers],
  );

  async function promptSendRateCon(existing?: string) {
    if (!load) return;
    const suggested = existing ?? load.rcEmail ?? carrierDbMatch?.email ?? '';
    const toEmail = (window.prompt(
      `Send the rate confirmation for load ${load.loadNumber || load.id} to:`,
      suggested,
    ) ?? '').trim();
    if (!toEmail) return;
    const save = carrierDbMatch && toEmail !== (carrierDbMatch.email ?? '')
      ? window.confirm(`Save ${toEmail} as ${carrierDbMatch.name}'s dispatch email in the carrier database?`)
      : false;
    try {
      await sendRateCon(load.id, toEmail, save ? carrierDbMatch?.id : undefined);
      window.alert(`Rate con sent to ${toEmail}. The load flips to RC Signed automatically when the dispatcher signs.`);
    } catch (e) {
      window.alert(`Rate con failed: ${(e as Error).message}`);
    }
  }
  /* Loadout Trailer Module (07/15): a PO load with a carrier is a trailer
     obligation — the trailer # is the one datum the Matrix doesn't know.
     If this carrier already has open trailers, picking one CHAINS the loads
     (the dashboard reads it as a relink; the old clock closes, this one runs). */
  const draftLoad = { ...(load ?? { id: '', laneId: lane.id, date, loadNumber: '', carrier: '', rateNotes: '', status: 'exposed', postedRate: '', equipment: '', hubNotes: '' }), carrier, equipment: load?.equipment ?? '' } as Load;
  const isPo = /POWER ONLY/i.test(effectiveEquipment(draftLoad, lane));
  const carrierOpenTrailers = useMemo(() => {
    if (!carrier.trim()) return [];
    return openTrailersForCarrier(buildTrailerLinks(loads, lanes, trailerSettings), carrier)
      .filter((t) => t.load.id !== load?.id);
  }, [carrier, loads, lanes, trailerSettings, load?.id]);

  function assignDedicated() {
    setCarrier(lane.dedicatedCarrier ?? '');
    if (lane.dedicatedRate && !rate) setRate(lane.dedicatedRate);
  }

  /** Same-day GH Logistics double-booking checks. Returns a conflict or null. */
  function findConflict(): { hard: boolean; message: string } | null {
    if (!isGH) return null;
    const sameDayGH = loads.filter(
      (l) => l.date === date && l.id !== (load?.id ?? `${lane.id}_${date}`) && GH_RE.test(l.carrier),
    );
    const myTruck = normalizeTruck(truckNumber);
    if (myTruck) {
      const dupe = sameDayGH.find((l) => normalizeTruck(l.truckNumber ?? '') === myTruck);
      if (dupe) {
        const otherLane = laneMap.get(dupe.laneId);
        return {
          hard: true,
          message: `Truck #${truckNumber.trim()} is already being used on load ${dupe.loadNumber}` +
            (otherLane ? ` (${laneShortName(otherLane)})` : '') +
            ` today. You can't double-book a truck — review this and try again.`,
        };
      }
    }
    /* §6.3 scheduled-time feasibility: a truck committed to an EARLIER load
       must be scheduled to drop before this load's pickup (scheduled times
       only — no ETAs; real-time tracking lives elsewhere). */
    if (myTruck) {
      const puTok = /\d{2}:\d{2}/.exec(cleanTimes(((lane.arrivalTime || lane.departureTime) ?? '').split('\n')[0]))?.[0] ?? '00:00';
      const myPickup = `${date}T${puTok}`;
      for (const other of loads) {
        if (other.id === (load?.id ?? `${lane.id}_${date}`)) continue;
        if (other.date >= date || other.status === 'not_running') continue; // same-day dupes are the hard rule above
        if (normalizeTruck(other.truckNumber ?? '') !== myTruck) continue;
        const ol = laneMap.get(other.laneId);
        if (!ol) continue;
        const dropTok = finalDelTime(ol.delTime ?? '');
        /* "next day" delivery blobs drop the day AFTER pickup (same rule as capacity.ts) */
        const dropDate = /next\s*day/i.test(ol.delTime ?? '') ? addDays(other.date, 1) : other.date;
        const drop = `${dropDate}T${/^\d{2}:\d{2}$/.test(dropTok) ? dropTok : '23:59'}`;
        if (drop > myPickup) {
          return {
            hard: false,
            message: `Truck #${truckNumber.trim()} is scheduled to still be on load ${other.loadNumber || other.id}` +
              ` (${laneShortName(ol)}) until ${dropTok || 'late'} on ${Number(dropDate.slice(5, 7))}/${Number(dropDate.slice(8, 10))}` +
              ` — that precludes an on-time ${puTok} pickup here. Consider pairing an empty truck (Capacity tab).`,
          };
        }
      }
    }
    const myNames = nameTokens(rateNotes);
    if (myNames.length) {
      for (const other of sameDayGH) {
        const otherNames = nameTokens(other.rateNotes ?? '');
        const hits = myNames.filter((a) => otherNames.some((b) => similarNames(a, b)));
        if (hits.length) {
          const otherLane = laneMap.get(other.laneId);
          return {
            hard: false,
            message: `“${hits.join(', ')}” looks very similar to the drivers assigned on load ${other.loadNumber}` +
              (otherLane ? ` (${laneShortName(otherLane)})` : '') +
              ` today. Make sure you aren't double-booking before you proceed.`,
          };
        }
      }
    }
    return null;
  }

  async function save() {
    if (blocked) return;
    const found = findConflict();
    if (found && (found.hard || !overrideWarning)) {
      setConflict(found);
      if (!found.hard) setOverrideWarning(true); // next Save proceeds past the soft warning
      return;
    }
    const trimmedCarrier = carrier.trim();
    /* §7.3: removing a carrier from a DEDICATED lane always prompts — will
       they fall off? Rep must classify before the save proceeds. */
    if (lane.dedicated && (load?.carrier ?? '') !== '' && trimmedCarrier === '' && !removalAck && status !== 'chargeback') {
      setRemovalPrompt(true);
      return;
    }
    /* §7.2 logging gate: setting Chargeback/Fallout requires log access */
    if (isChargeback && (load?.status !== 'chargeback' || cbClass !== (load?.chargebackClass ?? '')) && !mayLogCb) {
      setConflict({ hard: true, message: 'Logging a chargeback/fallout requires a non-Asset company role.' });
      return;
    }
    if (trimmedCarrier && !knownCarrier && mayAddCarrier) {
      await addCarrier(trimmedCarrier, mcNumber);
    }
    let nextStatus = status;
    if (['exposed', 'covered', 'dedicated_pending'].includes(status)) {
      nextStatus = trimmedCarrier ? 'covered' : 'exposed';
    }
    const base: Load = load ?? {
      id: `${lane.id}_${date}`,
      laneId: lane.id,
      date,
      loadNumber: '',
      carrier: '',
      rateNotes: '',
      status: 'exposed',
      postedRate: '',
      equipment: '',
      hubNotes: '',
    };
    const finalLoadNumber = loadNumberLocked
      ? assetLs.trim()
        ? `${baseLoadNumber} / ${assetLs.trim()}`
        : baseLoadNumber
      : loadNumber.trim();
    const patch = {
      loadNumber: finalLoadNumber,
      carrier: trimmedCarrier,
      rateNotes,
      truckNumber: isGH ? truckNumber.trim() : '',
      status: nextStatus,
      cancelReason: isCancelled ? cancelReason.trim() : '',
      tonuBill: isCancelled ? tonuBill : false,
      ...(isChargeback
        ? {
            chargebackClass: cbClass || 'once_recovered',
            chargebackAmount: cbAmount.trim(),
            chargebackStatus: load?.chargebackStatus ?? 'pending',
            chargebackCarrier: load?.chargebackCarrier || load?.carrier || trimmedCarrier,
            chargebackBy: load?.chargebackBy || (currentUser.name || currentUser.email),
            chargebackAt: load?.chargebackAt || new Date().toISOString(),
          }
        : {}),
      isShuttle,
      shuttleType: isShuttle ? shuttleType : 'meet_swap' as const,
      shuttleLocation: isShuttle ? shuttleLocation.trim() : '',
      shuttleCarrier: isShuttle ? shuttleCarrier.trim() : '',
      shuttleTruckNumber: isShuttle && shuttleIsAsset ? shuttleTruckNumber.trim() : '',
      shuttleAssetLs: isShuttle && shuttleIsAsset ? shuttleAssetLs.trim() : '',
      shuttleLegStatus: isShuttle ? shuttleLegStatus : '',
      shuttleLegNotes: isShuttle ? shuttleLegNotes.trim() : '',
      shuttleCity: isShuttle ? shuttleCity.trim() : '',
      shuttleState: isShuttle ? shuttleState.trim().toUpperCase() : '',
      shuttleSwapEta: isShuttle ? shuttleSwapEta.trim() : '',
      shuttlePostedRate: isShuttle ? shuttlePostedRate.trim() : '',
      rate: passThrough ? '' : rate.trim(),
      trailerNumber: isPo ? trailerNumber.trim() : '',
      trailerFreeDays: isPo && trailerNumber.trim() && trailerDays ? Number(trailerDays) : null,
    };
    if (load) await updateLoad(load.id, patch);
    else await upsertLoad({ ...base, ...patch });
    /* details changed on a load with an active RC → offer the updated resend
       (carrier REMOVAL is handled server-side: auto-cancel + carrier email) */
    if (load && mayRateCon && ['sent', 'signed'].includes(load.rcStatus ?? '')
        && trimmedCarrier === load.carrier
        && (patch.rate !== load.rate || patch.loadNumber !== load.loadNumber)) {
      if (window.confirm('This load has a rate con on file and its terms changed — resend the updated rate confirmation?')) {
        await promptSendRateCon(load.rcEmail);
      }
    }
    onClose();
  }

  /* Sectioned status dropdown, dept-filtered by the leg's carrier: GH →
     Assets only, outside carrier → Brokerage only, no carrier → both
     (Caleb 07/09). Q/A (GTG), top group and Cancelled always show. */
  const groups = statusGroupsFor(carrier);
  const statusField = (
    <label>
      Status
      <StatusSelect value={status} onChange={setStatus} groups={groups} statuses={statuses} />
    </label>
  );

  return (
    /* v2.20.0: clicking outside no longer closes the editor (Caleb) */
    <div className="editor-overlay">
      <div className={`editor ${isShuttle ? 'editor-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <div>
            <div className="editor-lane">
              {laneShortName(lane)}
              {lane.tripLabel && <span className="trip-label-tag">{lane.tripLabel}</span>}
            </div>
            <div className="editor-sub">
              {lane.tripCode && <span>{lane.tripCode} · </span>}
              {headerLabel(date)}
              {lane.departureTime && <span> · Departs {cleanTimes(lane.departureTime)}</span>}
              {lane.delTime && <span> · Delivers {cleanTimes(lane.delTime.split('\n')[0])}</span>}
            </div>
          </div>
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {isDedicated && !carrier && dedCover === false && (
          <div className="dedicated-off-day">
            Per the dedicated master, <b>{lane.dedicatedCarrier}</b> is <b>not</b> dedicated on this
            weekday — this trip needs open coverage today. (Dedicated tab has the day grid.)
          </div>
        )}
        {isDedicated && !carrier && dedCover !== false && (
          <div className="dedicated-banner">
            <div>
              <b>Dedicated lane</b> → {lane.dedicatedCarrier}
              {lane.dedicatedRate && <span> @ {lane.dedicatedRate}</span>}
              {lane.dedicatedNotes && lane.dedicatedNotes !== lane.dedicatedCarrier && (
                <div className="dedicated-note">{lane.dedicatedNotes}</div>
              )}
            </div>
            <button className="btn-dedicated" onClick={assignDedicated}>
              Assign {lane.dedicatedCarrier}
            </button>
          </div>
        )}

        {loadNumberLocked ? (
          <div className="load-num-row">
            <label>
              Primary LS # <span className="optional">(LoadStop — fixed)</span>
              <input value={baseLoadNumber} disabled title="Assigned by EDI intake; never changes, whoever runs the load" />
            </label>
            {/* §6.2: the secondary Asset LS# exists ONLY when a GH truck is on the load */}
            {isGH && (
              <label>
                Asset LS # <span className="optional">(GH asset leg)</span>
                <input
                  ref={firstField}
                  value={assetLs}
                  onChange={(e) => setAssetLs(e.target.value)}
                  placeholder="654321"
                />
              </label>
            )}
          </div>
        ) : (
          <label>
            Load #
            <input
              ref={firstField}
              value={loadNumber}
              onChange={(e) => setLoadNumber(e.target.value)}
              placeholder="e.g. 69255"
            />
          </label>
        )}

        {/* carrier suggestions shared by BOTH carrier inputs — must render
            unconditionally (leg 2's list broke when leg 1 was assigned) */}
        <datalist id="carrier-list">
          {carriers.map((c) => (
            <option key={c.id} value={c.name} label={c.dnu ? `${c.name} — 🚫 DNU` : undefined} />
          ))}
        </datalist>

        {isPo && carrier.trim() !== '' && (
          <div className="trailer-fieldset">
            <label>
              Loadout trailer # <span className="optional">(PO load — starts the return clock at unload; the Trailers page tracks it)</span>
              <input
                value={trailerNumber}
                onChange={(e) => setTrailerNumber(e.target.value)}
                placeholder="e.g. 4567"
                list="carrier-open-trailers"
              />
              <datalist id="carrier-open-trailers">
                {carrierOpenTrailers.map((t) => (
                  <option key={t.load.id} value={t.trailer} label={`${t.trailer} — from ${t.originSite}, due ${t.returnEta.slice(5)}`} />
                ))}
              </datalist>
            </label>
            {trailerNumber.trim() !== '' && (
              <label className="trailer-days">
                L.O.T free days
                <select value={trailerDays} onChange={(e) => setTrailerDays(e.target.value)}>
                  <option value="">Default — {baseFreeDays((load ?? { equipment: '' }) as Load, lane)} days (from Loading/TRM)</option>
                  <option value="3">3 days</option>
                  <option value="5">5 days</option>
                  <option value="7">7 days</option>
                </select>
              </label>
            )}
            {carrierOpenTrailers.length > 0 && (
              <div className="muted trailer-hint">
                {carrier.trim()} has {carrierOpenTrailers.length} open trailer{carrierOpenTrailers.length > 1 ? 's' : ''}:
                {carrierOpenTrailers.slice(0, 4).map((t) => (
                  <button key={t.load.id} type="button" className="btn-ghost btn-sm" onClick={() => setTrailerNumber(t.trailer)}>
                    {t.trailer} (due {t.returnEta.slice(5)})
                  </button>
                ))}
                — picking one chains this load onto it and restarts its clock.
              </div>
            )}
          </div>
        )}

        {/* §6.1 shuttle: a different truck delivers than picks up */}
        <label className="shuttle-toggle">
          <input type="checkbox" checked={isShuttle} onChange={(e) => setIsShuttle(e.target.checked)} />
          {' '}Shuttle / Repower — a different truck delivers than picks up
        </label>
        {isShuttle && (
          <div className="shuttle-row">
            <label>
              Type
              <select value={shuttleType} onChange={(e) => setShuttleType(e.target.value as 'meet_swap' | 'yard_stage' | 'repower')}>
                <option value="meet_swap">Meet &amp; swap</option>
                <option value="yard_stage">Yard stage</option>
                <option value="repower">Repower — replacement carrier takes over mid-route</option>
              </select>
            </label>
            <label>
              Swap / stage location
              <input
                value={shuttleLocation}
                onChange={(e) => setShuttleLocation(e.target.value)}
                placeholder="e.g. Love's #291"
              />
            </label>
            {/* structured city/state: an exposed leg 2 posts to the hub/board
                FROM the swap point ("Troy, TX → Indianapolis") */}
            <label>
              Swap city
              <input value={shuttleCity} onChange={(e) => setShuttleCity(e.target.value)} placeholder="Troy" />
            </label>
            <label className="swap-state">
              State
              <input value={shuttleState} onChange={(e) => setShuttleState(e.target.value)} placeholder="TX" maxLength={2} />
            </label>
            <label>
              ETA to swap <span className="optional">(leg-2 PU time)</span>
              <input value={shuttleSwapEta} onChange={(e) => setShuttleSwapEta(e.target.value)} placeholder="10:00" />
            </label>
          </div>
        )}

        <div className={isShuttle ? 'legs-grid' : undefined}>
        <div className={isShuttle ? 'leg-col' : undefined}>
        {isShuttle && <div className="leg-head">LEG 1 · PICKUP / SHUTTLE</div>}
        {assetRep ? (
          <label>
            Carrier <span className="optional">(asset rep — GH Logistics only)</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={carrier} disabled />
              <button
                className="btn-ghost"
                onClick={() => { setCarrier('GH Logistics'); setConflict(null); setOverrideWarning(false); }}
              >
                Assign GH
              </button>
              <button
                className="btn-ghost"
                onClick={() => { setCarrier(''); setConflict(null); setOverrideWarning(false); }}
              >
                Clear
              </button>
            </div>
          </label>
        ) : carrier.trim() !== '' && (load?.carrier ?? '') !== '' && carrier === load?.carrier ? (
          /* assigned: no dropdown — a clear Remove action instead (Caleb 07/09) */
          <label>
            Carrier
            <div className="carrier-assigned">
              <span className="strong">{carrier}</span>
              <button
                className="btn-ghost btn-sm btn-remove-carrier"
                onClick={() => { setCarrier(''); setConflict(null); setOverrideWarning(false); }}
              >
                ✕ Remove carrier
              </button>
            </div>
          </label>
        ) : (
          <label>
            Carrier
            <input
              value={carrier}
              onChange={(e) => { setCarrier(e.target.value); setConflict(null); setOverrideWarning(false); }}
              list="carrier-list"
              placeholder="Start typing…"
            />
          </label>
        )}

        {isGH && (
          <label>
            Truck # <span className="optional">(GH Logistics asset)</span>
            <input
              value={truckNumber}
              onChange={(e) => { setTruckNumber(e.target.value); setConflict(null); setOverrideWarning(false); }}
              placeholder="e.g. 3572"
            />
          </label>
        )}

        {!knownCarrier && mayAddCarrier && (
          <div className="new-carrier">
            {nearMatches.length > 0 && (
              <div className="carrier-blocked">
                ⚠ Similar carrier{nearMatches.length > 1 ? 's' : ''} already in the database — don't create a duplicate:
                {nearMatches.map((c) => (
                  <button key={c.id} className="btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => setCarrier(c.name)}>
                    use “{c.name}”
                  </button>
                ))}
              </div>
            )}
            <div className="new-carrier-note">
              ✚ New carrier — “{carrier.trim()}” will be added to the database.
            </div>
            <label>
              MC number <span className="optional">(optional)</span>
              <input
                value={mcNumber}
                onChange={(e) => setMcNumber(e.target.value)}
                placeholder="MC-123456"
              />
            </label>
          </div>
        )}
        {!knownCarrier && !mayAddCarrier && (
          <div className="carrier-blocked">
            “{carrier.trim()}” isn’t in the carrier database. Adding carriers requires booking
            access — ask a broker rep or admin to add this carrier, then book the load.
          </div>
        )}

        {passThrough ? (
          <div className="pass-through muted">
            GH Logistics — straight pass-through on the full rate; no rate entry needed.
          </div>
        ) : (
          <label>
            Rate <span className="optional">($ — the agreed carrier rate; used by margin, waterfall & KPIs)</span>
            <input
              value={rate}
              onChange={(e) => { setRate(e.target.value); setConflict(null); setOverrideWarning(false); }}
              placeholder="e.g. 2450"
            />
          </label>
        )}

        {isShuttle && statusField}

        <label>
          Notes <span className="optional">{isShuttle ? '(leg 1 only — driver, truck #, context)' : passThrough ? '(driver, truck #, context)' : '(driver, truck #, context — keep rates in the Rate field)'}</span>
          <textarea
            value={rateNotes}
            onChange={(e) => { setRateNotes(e.target.value); setConflict(null); setOverrideWarning(false); }}
            rows={3}
            placeholder="Driver name, phone, anything…"
          />
        </label>
        </div>

        {isShuttle && <div className="leg-arrow" title="shuttle handoff">⇄</div>}

        {isShuttle && (
          <div className="leg-col leg-col-2">
            <div className="leg-head">LEG 2 · TRANSIT / DELIVERY</div>
            <label>
              Carrier
              <input
                value={shuttleCarrier}
                onChange={(e) => setShuttleCarrier(e.target.value)}
                list="carrier-list"
                placeholder="carrier or GH Logistics"
              />
            </label>
            {shuttleIsAsset && (
              <div className="shuttle-row">
                <label>
                  Leg truck #
                  <input value={shuttleTruckNumber} onChange={(e) => setShuttleTruckNumber(e.target.value)} placeholder="e.g. 3581" />
                </label>
                <label>
                  Leg Asset LS #
                  <input value={shuttleAssetLs} onChange={(e) => setShuttleAssetLs(e.target.value)} placeholder="own LS# per asset leg" />
                </label>
              </div>
            )}
            <label>
              Status <span className="optional">(independent of leg 1)</span>
              {/* mirrors leg 1, but Loaded/Departed = the swap handoff */}
              <StatusSelect
                value={shuttleLegStatus}
                onChange={setShuttleLegStatus}
                groups={statusGroupsFor(shuttleCarrier)}
                statuses={statuses}
                labelFor={legStatusLabel}
                emptyOption="auto — covered when a carrier is set"
                excludeKeys={['dedicated_pending']}
              />
            </label>
            {!shuttleIsAsset && (
              <label>
                Leg 2 posted rate <span className="optional">($ — shows on hub/board from the swap point)</span>
                <input value={shuttlePostedRate} onChange={(e) => setShuttlePostedRate(e.target.value)} placeholder="e.g. 1800" />
              </label>
            )}
            <label>
              Notes <span className="optional">(leg 2 only — independent)</span>
              <textarea
                value={shuttleLegNotes}
                onChange={(e) => setShuttleLegNotes(e.target.value)}
                rows={3}
                placeholder="Delivery-leg driver, timing, context…"
              />
            </label>
          </div>
        )}
        </div>

        {isShuttle && (bothAssets ? (
          /* split % removed (Caleb 07/09): GH on both legs = straight
             pass-through on the full rate — nothing to divide. */
          <div className="shuttle-pay muted">
            Both legs GH Logistics — straight pass-through on the full rate; no rate or split needed.
          </div>
        ) : shuttleIsAsset || isGH ? (
          <div className="shuttle-pay muted">
            {trmPot == null
              ? 'No TRM revenue on file for this trip — waterfall can’t compute; note pay manually.'
              : negotiated == null
                ? `TRM revenue $${trmPot}. Enter the carrier’s negotiated rate in the Rate field — the remainder flows to the asset leg.`
                : (trmPot - negotiated) <= 0
                  ? `Carrier reconciles first: $${negotiated} ≥ TRM $${trmPot} — booked at a loss, the asset leg receives $0.`
                  : `Carrier reconciles first: TRM $${trmPot} − carrier $${negotiated} → asset leg $${trmPot - negotiated}.`}
          </div>
        ) : null)}

        {!isShuttle && statusField}

        {/* the chargeback survives a re-cover: once another carrier is on the
            load the status leaves 'chargeback', but the team still needs the
            who/how-much in the modal until it's recovered or waived */}
        {/* only while LIVE — waived/recovered/removed chargebacks leave no
            notes here (Caleb 07/10: a waive falls off completely) */}
        {!isChargeback && load && activeChargeback(load) && (
          <div className="cb-box cb-live">
            <b>⚠ Active chargeback</b>
            {' — '}{load.chargebackCarrier || 'carrier n/a'}
            {load.chargebackAmount && <> · ${load.chargebackAmount.replace(/^\$/, '')}</>}
            {' · '}<span className="muted">status: {load.chargebackStatus ?? 'pending'} (decisions on Admin → Chargebacks)</span>
          </div>
        )}

        {isChargeback && (
          <div className="cb-box">
            <label>
              Chargeback classification
              <select value={cbClass || 'once_recovered'} onChange={(e) => setCbClass(e.target.value as 'once_recovered' | 'none')} disabled={!mayLogCb}>
                <option value="once_recovered">Chargeback for fallout once recovered</option>
                <option value="none" disabled={!mayCbNone}>No Chargeback</option>
              </select>
            </label>
            {(cbClass || 'once_recovered') === 'once_recovered' && (
              <label>
                Amount <span className="optional">($ — optional, accounting uses it)</span>
                <input value={cbAmount} onChange={(e) => setCbAmount(e.target.value)} placeholder="e.g. 450" disabled={!mayLogCb} />
              </label>
            )}
            {load?.chargebackStatus && (
              <span className="muted">Audit status: {load.chargebackStatus} (admins advance it on the Admin page)</span>
            )}
          </div>
        )}

        {isCancelled && (
          <>
            <label>
              {status === 'omitted' ? 'Omission reason' : 'Cancellation reason'} <span className="required">(required)</span>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={2}
                placeholder={status === 'omitted'
                  ? 'Why did the site omit this trip? This shows in the Matrix cell.'
                  : 'Why is this load not running? This shows in the Matrix cell.'}
              />
            </label>
            <label className="shuttle-toggle">
              <input type="checkbox" checked={tonuBill} onChange={(e) => setTonuBill(e.target.checked)} />
              {' '}Bill USPS TONU (&lt; 4 hours)
            </label>
          </>
        )}

        {rateMissing && (
          <div className="carrier-blocked">
            💲 <b>Rate required</b> — this load can't be saved as covered (or beyond) without the
            carrier rate in the <b>Rate</b> box. GH Logistics pass-throughs are exempt.
          </div>
        )}
        {dnuMatch && (
          <div className="carrier-blocked">
            🚫 <b>{dnuMatch.name}</b> is flagged <b>DNU — Do Not Use</b>
            {dnuMatch.notes ? <> — {dnuMatch.notes}</> : null}. This carrier cannot be assigned to any load.
          </div>
        )}

        {mayRateCon && load && load.carrier && carrier === load.carrier && (
          <div className="rc-panel">
            <div className="rc-status">
              📄 <b>Rate Con:</b>{' '}
              {load.rcStatus === 'signed' ? (
                <span className="rc-signed">✓ SIGNED {load.rcSignedAt && fmtStamp(load.rcSignedAt)}
                  {load.rcDriver1 && <> — {load.rcDriver1} {load.rcPhone1}{load.rcDriver2 ? ` / ${load.rcDriver2} ${load.rcPhone2}` : ''}</>}
                </span>
              ) : load.rcStatus === 'sent' ? (
                <span className="rc-sent">sent {load.rcSentAt && fmtStamp(load.rcSentAt)} to {load.rcEmail} — awaiting signature</span>
              ) : load.rcStatus === 'cancelled' ? (
                <span className="muted">cancelled (carrier removed)</span>
              ) : (
                <span className="muted">not sent</span>
              )}
            </div>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => void promptSendRateCon()}
            >
              {load.rcStatus === 'sent' || load.rcStatus === 'signed' ? '↻ Resend updated rate con' : '📨 Send rate con'}
            </button>
          </div>
        )}

        {conflict && (
          <div className={conflict.hard ? 'carrier-blocked' : 'conflict-warn'}>
            {conflict.hard ? '⛔ ' : '⚠️ '}
            {conflict.message}
            {!conflict.hard && <div className="conflict-hint">Click Save again to proceed anyway.</div>}
          </div>
        )}

        {/* bands: the Integrity record is the truth (same numbers as the lane
            box, WD-first, en dash); legacy lane strings only when no record */}
        {rec?.bands?.weekday || rec?.bands?.weekend ? (
          <div className="editor-target">
            {rec.bands?.weekday?.target != null && (
              <span><b>WD</b> {fmtMoney(rec.bands.weekday.target)}{rec.bands.weekday.ceiling != null && <> – {fmtMoney(rec.bands.weekday.ceiling)}</>}</span>
            )}
            {rec.bands?.weekday?.target != null && rec.bands?.weekend?.target != null && <span> · </span>}
            {rec.bands?.weekend?.target != null && (
              <span><b>WE</b> {fmtMoney(rec.bands.weekend.target)}{rec.bands.weekend.ceiling != null && <> – {fmtMoney(rec.bands.weekend.ceiling)}</>}</span>
            )}
          </div>
        ) : (lane.weekendRate || lane.weekdayRate) ? (
          <div className="editor-target">
            {lane.weekdayRate && <span>Weekday {lane.weekdayRate.replace(/\s-\s/g, ' – ')}</span>}
            {lane.weekendRate && lane.weekdayRate && <span> · </span>}
            {lane.weekendRate && <span>Weekend {lane.weekendRate.replace(/\s-\s/g, ' – ')}</span>}
          </div>
        ) : null}

        {history.length > 0 && (
          <div className="history">
            <button className="history-toggle" onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? '▾' : '▸'} History ({history.length})
            </button>
            {showHistory && (
              <ul className="history-list">
                {[...history].reverse().map((h, i) => (
                  <li key={i}>
                    <span className="history-when">{fmtStamp(h.at)}</span>
                    <span className="history-who">{h.by}</span>
                    <span className="history-what">{h.action}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {removalPrompt && (
          <div className="removal-prompt">
            <b>Removing {load?.carrier} from a dedicated lane.</b>
            {carriers.find((c) => c.name.toLowerCase() === (load?.carrier ?? '').toLowerCase())?.issue && (
              <div className="removal-issue">⚠️ This carrier is flagged as an issue — treat as likely fallout.</div>
            )}
            <div>Will they fall off this lane? If this is a fallout, classify it — the lane flags as exposed either way.</div>
            <div className="offer-actions" style={{ marginTop: 6 }}>
              <button
                className="btn-offer-deny"
                onClick={() => {
                  setStatus('chargeback');
                  if (!cbClass) setCbClass('once_recovered');
                  setRemovalPrompt(false);
                  setRemovalAck(true);
                }}
              >
                Falling off — log fallout
              </button>
              <button
                className="btn-ghost"
                onClick={() => { setRemovalPrompt(false); setRemovalAck(true); }}
              >
                Just unassign (no fallout)
              </button>
            </div>
          </div>
        )}

        <div className="editor-actions">
          {cancelMissing && <span className="required">{status === 'omitted' ? 'Omission' : 'Cancellation'} reason is required.</span>}
          {!assetScopeOk && <span className="required">Asset reps can only assign or clear GH Logistics.</span>}
          <span className="spacer" />
          <button className="btn-primary" onClick={save} disabled={blocked}>Save</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
