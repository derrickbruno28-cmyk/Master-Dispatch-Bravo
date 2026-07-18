import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildCityStateMap, publicCity } from '../board';
import { useStore } from '../data/store';
import { bookingWindow, centralDateOf, cleanTimes, finalDelTime, fmtStamp, hubLabel, todayCentral } from '../dates';
import { effectiveEquipment, autoTeamSolo, cityDisplay, fmtMoney, fmtRateStr, isExposed, laneCompactName, laneShortName, normalizeMc, onSalesHub, shuttleLegExposed, equipmentColor, EQUIPMENT_OPTIONS, type Load, type Offer } from '../types';
import { bandFor, fmtBand, liveUpgraded, type IntegrityRecord } from '../pricing';
import { can } from '../permissions';

/* Live offers for a load. Accept books it, Counter sends a number back to the
   board, Deny closes it out. §5.3: COUNTERED offers stay visible here (who
   countered what, when) so nobody resends or mismatches a counter. §5.4:
   cards stack left→right sorted by lowest rate; each shows its submit time. */
const offerMoney = (s: string) => Number(String(s ?? '').replace(/[^0-9.]/g, '')) || Infinity;
const offerTime = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function OfferPanel({ load }: { load: Load }) {
  const { offers, respondOffer, updateLoad, carriers, addCarrier, currentUser, lanes } = useStore();
  const [counterDraft, setCounterDraft] = useState<Record<string, string>>({});
  const booker = can(currentUser, 'hub.offers'); // responding to an offer books the load
  const live = offers
    .filter((o) => o.loadId === load.id && (o.status === 'pending' || o.status === 'countered'))
    .sort((a, b) => offerMoney(a.rate) - offerMoney(b.rate));
  if (live.length === 0) return null;

  async function accept(o: Offer) {
    /* Resolve the offer to a real carrier NAME: match the registered MC (or a
       typed MC) against the carrier database so loads never book under a raw
       MC number. Mark accepted BEFORE booking so auto-deny skips this offer. */
    const mc = normalizeMc(o.mcNumber ?? '') || normalizeMc(/^\d[\d\s-]*$/.test(o.company) ? o.company : '');
    const matched =
      (mc && carriers.find((c) => normalizeMc(c.mcNumber ?? '') === mc)) ||
      carriers.find((c) => c.name.toLowerCase() === o.company.toLowerCase());
    if (matched?.dnu) {
      window.alert(`🚫 ${matched.name} is flagged DNU — Do Not Use. This offer can't be accepted; deny or counter instead.`);
      return;
    }
    let carrierName = matched?.name ?? o.company;
    if (!matched) {
      await addCarrier(o.company, o.mcNumber);
      carrierName = o.company;
    }
    const lane = lanes.find((l) => l.id === load.laneId);
    const cleanedPu = cleanTimes(((lane?.arrivalTime || lane?.departureTime) ?? '').split('\n')[0]);
    await respondOffer(o.id, {
      status: 'accepted',
      /* §5.5 snapshot for the carrier's My Loads (board doc vanishes on booking) */
      laneLabel: lane ? laneCompactName(lane) : load.laneId,
      puDate: load.date,
      puTime: /\d{2}:\d{2}/.exec(cleanedPu)?.[0] ?? '',
    });
    await updateLoad(load.id, { carrier: carrierName, rate: o.rate });
  }

  return (
    <div className="offer-panel">
      {live.map((o) => (
        <div key={o.id} className={`offer-card ${o.status === 'countered' ? 'is-countered' : ''}`}>
          <div className="offer-info">
            📨 <b>{fmtRateStr(o.rate)}</b> — {o.company}
            {o.mcNumber && <span className="muted"> · MC {o.mcNumber}</span>}
          </div>
          <div className="muted offer-meta">
            {o.phone && <>{o.phone} · </>}{o.email}
            <br />Submitted {offerTime(o.at)}
          </div>
          {o.status === 'countered' && (
            <div className="offer-countered-line">
              ↩ Countered <b>{o.counter}</b> by {o.respondedBy}
              {o.respondedAt && ` · ${offerTime(o.respondedAt)}`} — awaiting carrier
            </div>
          )}
          {booker && <span className="offer-actions">
            <button className="btn-offer-accept" onClick={() => accept(o)}>Accept</button>
            {o.status === 'pending' && (counterDraft[o.id] !== undefined ? (
              <>
                <input
                  className="inline-input offer-counter-input"
                  placeholder="$"
                  autoFocus
                  value={counterDraft[o.id]}
                  onChange={(e) => setCounterDraft((d) => ({ ...d, [o.id]: e.target.value }))}
                />
                <button
                  className="btn-offer-counter"
                  disabled={!counterDraft[o.id]?.trim()}
                  onClick={async () => {
                    await respondOffer(o.id, { status: 'countered', counter: counterDraft[o.id].trim() });
                    setCounterDraft((d) => { const { [o.id]: _drop, ...rest } = d; return rest; });
                  }}
                >
                  Send
                </button>
              </>
            ) : (
              <button
                className="btn-offer-counter"
                onClick={() => setCounterDraft((d) => ({ ...d, [o.id]: '' }))}
              >
                Counter
              </button>
            ))}
            <button className="btn-offer-deny" onClick={() => respondOffer(o.id, { status: 'denied' })}>
              Deny
            </button>
          </span>}
        </div>
      ))}
    </div>
  );
}

/* Append-only note log: notes save with author + time; only the author can
   delete their own note, and the deletion itself is recorded in load history. */
function NoteCell({ load }: { load: Load }) {
  const { addHubNote, deleteHubNote, currentUser } = useStore();
  const [draft, setDraft] = useState('');
  const editor = can(currentUser, 'hub.fields');

  async function save() {
    if (!draft.trim()) return;
    await addHubNote(load.id, draft);
    setDraft('');
  }

  const log = load.hubNoteLog ?? [];
  const me = currentUser.name || currentUser.email;
  return (
    <div className="note-cell">
      {(log.length > 0 || load.hubNotes) && (
        <div className="note-log">
          {load.hubNotes && <div className="note-line note-legacy">{load.hubNotes}</div>}
          {[...log].reverse().map((n, i) => (
            <div key={i} className="note-line">
              <span className="note-text">{n.action}</span>
              <span className="note-meta">
                {n.by} · {fmtStamp(n.at)}
              </span>
              {editor && n.by === me && (
                <button
                  className="note-delete"
                  title="Delete your note (logged in history)"
                  onClick={() => deleteHubNote(load.id, n.at)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {editor && <div className="note-input-row">
        <input
          className="inline-input"
          placeholder="Add note…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button className="btn-save-note" onClick={save} disabled={!draft.trim()}>
          SAVE NOTE
        </button>
      </div>}
    </div>
  );
}

/* Sales Hub is 100% derived from the Matrix: every exposed load inside the
   72-hour booking window appears here automatically. A booked load stays on
   the board marked BOOKED (rate + who booked it) until an admin approves the
   booking, which clears it. Posted rate, equipment, solo/team, night-shift
   pin, and notes are the editable fields. */
export default function SalesHubView() {
  const { lanes, loads, updateLoad, approveBooking, currentUser, rebuildLoadboard, demoMode, offers, integrity } = useStore();
  const mayApprove = can(currentUser, 'hub.approve');
  const mayPush = can(currentUser, 'hub.push');
  const canHub = can(currentUser, 'hub.fields'); // hub working fields (permission-tuned per user)
  /* board visibility is its own assignable key (Caleb 07/18) — admins incl.
     FedCom by default, grantable to individuals without the rest of hub.fields */
  const canBoard = can(currentUser, 'hub.board');
  /* night-shift pin opened to broker reps (v2.11.5) — pinnedNight is
     booker-writable in rules, so booking permission is enough to pin */
  const canPin = canHub || can(currentUser, 'matrix.book');
  const navigate = useNavigate();
  const [pushState, setPushState] = useState('');
  const [autoSetMsg, setAutoSetMsg] = useState('');
  const [query, setQuery] = useState('');
  const laneMap = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const cityState = useMemo(() => buildCityStateMap(lanes), [lanes]);
  const integrityByTrip = useMemo(
    () => new Map(integrity.map((r) => [r.tripCode.toUpperCase(), r])),
    [integrity],
  );
  const windowDays = bookingWindow();

  function integrityFor(load: Load): IntegrityRecord | undefined {
    const lane = laneMap.get(load.laneId);
    return lane ? integrityByTrip.get(lane.tripCode.toUpperCase()) : undefined;
  }

  /* §3.3 auto-set: one click sets every OPEN load in this section to its
     band's target (low end) or ceiling (top), using the §3.1 classifier
     against the integrity DB. Covered/booked loads are never touched. */
  async function autoSet(dayLoads: Load[], which: 'target' | 'ceiling') {
    let set = 0, skipped = 0;
    for (const load of dayLoads) {
      if (!isExposed(load)) continue; // open loads only
      const lane = laneMap.get(load.laneId);
      const rec = lane && integrityFor(load);
      const value = lane && rec ? rec.bands?.[bandFor(load, lane)]?.[which] : null;
      if (value == null) { skipped++; continue; }
      await updateLoad(load.id, { postedRate: String(value) });
      set++;
    }
    setAutoSetMsg(`Auto-set ${which}: ${set} open load(s) updated${skipped ? `, ${skipped} without a band skipped` : ''}.`);
  }

  /* PU appt = when the truck must be ON SITE at the shipper (arrival time).
     Some lanes carry long notes in that field — display just the first time token. */
  function puTime(laneId: string): string {
    const lane = laneMap.get(laneId);
    const raw = ((lane?.arrivalTime || lane?.departureTime) ?? '').split('\n')[0];
    const cleaned = cleanTimes(raw);
    if (cleaned.length <= 8) return cleaned;
    const m = /\d{2}:\d{2}/.exec(cleaned); // long note field — show just the first time
    return m ? m[0] : cleaned.slice(0, 8);
  }

  /* Phase 4 sink order within a day: open loads float, pinned night-shift
     sinks, covered/booked sinks below the pins (awaiting admin clear). */
  /* order (Caleb 07/14): open → 🌙 night pin → 🟡 soft book → ✓ covered */
  function sinkBand(l: Load): number {
    const booked = !isExposed(l) && !!l.carrier;
    if (booked) return l.softBook ? 2 : 3;
    return l.pinnedNight ? 1 : 0;
  }

  /* Pickup site for grouping — the lane's origin resolved to its CITY via the
     carrier-board mapper, so "Memphis RPDC", "Memphis TN RPDC" and
     "Memphis, TN" all land under one "Memphis, TN" block (Caleb 07/09). */
  function puSite(laneId: string): string {
    return publicCity(laneMap.get(laneId)?.origin ?? '', cityState).toLowerCase();
  }

  /* Shuttle whose DELIVERY leg is the open one: the hub row reads from the
     swap point (Troy, TX → Indianapolis) with the leg-1 ETA as its PU time
     and its own posted rate (Caleb 07/09). */
  function legTwoOpen(load: Load): boolean {
    return !!load.isShuttle && shuttleLegExposed(load) && !isExposed(load);
  }

  /* Everything searchable about a hub row, lane fields included. "night"
     matches the pinned-night marker so night-shift loads surface directly. */
  function searchText(load: Load): string {
    const lane = laneMap.get(load.laneId);
    return [
      load.loadNumber, load.carrier, load.rateNotes, load.postedRate,
      load.equipment ?? '', load.teamSolo ?? '', load.status, load.date,
      load.hubNotes, ...(load.hubNoteLog ?? []).map((n) => n.action),
      load.bookedBy ?? '', load.pinnedNight ? 'night shift' : '', load.softBook ? 'soft book' : '',
      load.shuttleCity ?? '', load.shuttleState ?? '', load.shuttleLocation ?? '',
      lane?.tripCode ?? '', lane ? laneShortName(lane) : '', lane?.section ?? '',
    ].join(' ').toLowerCase();
  }

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const open = loads
      .filter((l) => windowDays.includes(l.date) && onSalesHub(l))
      .filter((l) => !q || searchText(l).includes(q))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          /* Phase 4 sink bands: open → pinned night-shift → covered/booked */
          sinkBand(a) - sinkBand(b) ||
          /* group by pickup site, PU appointment order within each site */
          puSite(a.laneId).localeCompare(puSite(b.laneId)) ||
          puTime(a.laneId).localeCompare(puTime(b.laneId)),
      );
    return windowDays.map((date) => {
      const am: Load[] = [];
      const pm: Load[] = [];
      for (const l of open.filter((x) => x.date === date)) {
        const hour = parseInt(puTime(l.laneId), 10);
        (Number.isFinite(hour) && hour >= 12 ? pm : am).push(l);
      }
      return { date, am, pm };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loads, laneMap, windowDays, query]);

  function puAppt(load: Load): string {
    const arr = puTime(load.laneId);
    const [, m, d] = load.date.split('-');
    return `${Number(m)}/${Number(d)}${arr ? ` ${arr}` : ''}`;
  }

  const total = sections.reduce((n, s) => n + s.am.length + s.pm.length, 0);

  const clearedToday = useMemo(() => {
    const today = todayCentral();
    return loads
      .filter((l) => l.bookingApprovedAt && centralDateOf(l.bookingApprovedAt) === today)
      .sort((a, b) => (b.bookingApprovedAt ?? '').localeCompare(a.bookingApprovedAt ?? ''));
  }, [loads]);

  function table(dayLoads: Load[]) {
    if (dayLoads.length === 0) {
      return <div className="hub-clear">✓ CLEAR — no open trips in this block</div>;
    }
    return (
      <table className="list-table hub-table">
        <colgroup>
          <col className="w-trip" />
          <col className="w-load" />
          <col className="w-appt" />
          <col className="w-lane" />
          <col className="w-rate" />
          <col className="w-team" />
          <col className="w-equip" />
          <col className="w-target" />
          <col className="w-hubnotes" />
          <col className="w-pin" />
        </colgroup>
        <thead>
          <tr>
            <th>Trip #</th>
            <th>Load</th>
            <th>PU Appt</th>
            <th>Lane</th>
            <th>Rate</th>
            <th>Solo/Team</th>
            <th>Equipment</th>
            <th>Target</th>
            <th>Notes</th>
            <th title="Night pin · Soft book · Loadboard visibility">🌙 / SOFT / 👁</th>
          </tr>
        </thead>
        <tbody>
          {dayLoads.map((load, i) => {
            const lane = laneMap.get(load.laneId);
            if (!lane) return null;
            const booked = !isExposed(load) && !!load.carrier;
            /* pickup-site subheader (Caleb 07/09): rows already group by site —
               name the group so the ordering reads intentionally. Only sites
               with loads ever render (headers derive from the rows). Covered/
               booked loads sink to ONE "Covered / Booked" block — no per-site
               headers down there (they're green and done). */
            const prevLoad = i > 0 ? dayLoads[i - 1] : undefined;
            const band = sinkBand(load);
            const prevBand = prevLoad ? sinkBand(prevLoad) : -1;
            const siteChanged = !prevLoad || band !== prevBand || puSite(load.laneId) !== puSite(prevLoad.laneId);
            const siteHead = band === 3 ? (
              prevBand !== 3 ? (
                <tr key={`site-${load.id}`} className="site-row site-row-covered">
                  <td colSpan={10}>✓ Covered / Booked — awaiting admin clear</td>
                </tr>
              ) : null
            ) : band === 2 ? (
              prevBand !== 2 ? (
                <tr key={`site-${load.id}`} className="site-row site-row-soft">
                  <td colSpan={10}>🟡 Soft booked — still shopping for cheaper</td>
                </tr>
              ) : null
            ) : siteChanged ? (
              <tr key={`site-${load.id}`} className="site-row">
                <td colSpan={10}>{band === 1 ? '🌙 ' : ''}{publicCity(lane.origin, cityState) || cityDisplay(lane.origin) || 'Unknown origin'}</td>
              </tr>
            ) : null;
            return (<Fragment key={load.id}>
              {siteHead}
              <tr className={`${load.pinnedNight ? 'hub-pinned' : ''} ${booked ? 'hub-booked' : ''} ${load.softBook ? 'hub-soft' : ''}`}>
                <td>
                  {lane.tripCode.replace(/^FA2D3-/i, '')}
                  {lane.tripLabel && <span className="pill pill-label trip-letter">{lane.tripLabel.replace(/^Trip\s*/i, '')}</span>}
                </td>
                <td>
                  <button
                    className="load-link"
                    title="Open in Matrix"
                    onClick={() => navigate(`/matrix?load=${encodeURIComponent(load.id)}`)}
                  >
                    {load.loadNumber || '—'}
                  </button>
                </td>
                <td>{legTwoOpen(load) && load.shuttleSwapEta ? load.shuttleSwapEta : puAppt(load)}</td>
                <td className="strong hub-lane">
                  {/* compact origin → final (+N stops); full chain on hover, all stops in lane details.
                      Leg-2-exposed shuttles read FROM the swap point instead. */}
                  {legTwoOpen(load) && load.shuttleCity ? (
                    <span title={`Delivery leg from the swap point — lane: ${laneShortName(lane)}`}>
                      {load.shuttleCity}{load.shuttleState ? `, ${load.shuttleState}` : ''} → {lane.destination}
                    </span>
                  ) : (
                    <span title={laneShortName(lane)}>{laneCompactName(lane)}</span>
                  )}
                  {lane.delTime && <span className="muted hub-finaldel"> · Final del {finalDelTime(lane.delTime)}</span>}
                  {load.status === 'chargeback' && <span className="hub-cb"> · CHARGEBACK</span>}
                  {load.pinnedNight && <span className="hub-night"> · NIGHT SHIFT</span>}
                  {load.softBook && <span className="hub-softbook"> · SOFT BOOK — shopping cheaper</span>}
                  {load.isShuttle && (
                    <span className="hub-shuttle">
                      {' '}· {load.shuttleType === 'repower' ? '⚠ REPOWER' : '⇄ SHUTTLE'}{load.shuttleLocation ? ` @ ${load.shuttleLocation}` : ''}
                      {shuttleLegExposed(load) && (
                        <b className="hub-cb">{load.shuttleType === 'repower' ? ' — NEEDS REPOWER CARRIER' : ' — DELIVERY LEG EXPOSED'}</b>
                      )}
                    </span>
                  )}
                  {load.hideFromBoard && <span className="hub-hidden"> · OFF BOARD</span>}
                  {booked && (
                    <div className="hub-booked-line">
                      BOOKED — {load.carrier}
                      {/* rate ONLY — notes used to bleed in here as a fake rate */}
                      {fmtRateStr(load.rate ?? '') && <span> @ {fmtRateStr(load.rate ?? '')}</span>}
                      {load.bookedBy && <span className="muted"> · by {load.bookedBy}</span>}
                    </div>
                  )}
                  {!booked && <OfferPanel load={load} />}
                </td>
                <td>
                  {(() => {
                    if (booked && !legTwoOpen(load)) {
                      return <span className="strong">{fmtRateStr(load.rate ?? '') || '—'}</span>;
                    }
                    /* no posted rate yet → ghost the band TARGET (low end,
                       weekday/weekend-matched via bandFor) as a negotiating
                       anchor — read-only guidance, not a posted rate */
                    const rec = integrityFor(load);
                    const target = !legTwoOpen(load) && rec && lane ? rec.bands?.[bandFor(load, lane)]?.target ?? null : null;
                    if (canHub) {
                      return (
                        <input
                          className="inline-input"
                          placeholder={target != null ? `target ${fmtMoney(target)}` : '$'}
                          title={legTwoOpen(load) ? 'Leg 2 posted rate (from the swap point)' : target != null ? `Band target ${fmtMoney(target)} — type to post a rate` : undefined}
                          value={legTwoOpen(load) ? (load.shuttlePostedRate ?? '') : load.postedRate}
                          onChange={(e) => updateLoad(load.id, legTwoOpen(load) ? { shuttlePostedRate: e.target.value } : { postedRate: e.target.value })}
                        />
                      );
                    }
                    const posted = legTwoOpen(load) ? load.shuttlePostedRate : load.postedRate;
                    if (posted) return <span>{posted}</span>;
                    return target != null
                      ? <span className="muted rate-ghost" title="No posted rate yet — this is the band target for this day type">{fmtMoney(target)}</span>
                      : <span>—</span>;
                  })()}
                </td>
                <td>
                  <select
                    className="inline-select"
                    /* auto Solo/Team from loaded miles (§6.5) — manual pick overrides */
                    value={load.teamSolo || autoTeamSolo(lane)}
                    disabled={!canHub}
                    title={load.teamSolo ? 'Set manually' : 'Auto — under 500 mi = SOLO; 500+ = TEAM unless solo-approved'}
                    onChange={(e) => updateLoad(load.id, { teamSolo: e.target.value })}
                  >
                    <option value="">—</option>
                    <option value="SOLO">SOLO</option>
                    <option value="TEAM">TEAM</option>
                  </select>
                </td>
                <td>
                  <select
                    className="inline-select equip-select"
                    value={effectiveEquipment(load, lane)}
                    disabled={!canHub}
                    style={(() => {
                      const c = equipmentColor(load.equipment || lane.defaultEquipment);
                      return c ? { background: c, color: '#fff', borderColor: c } : undefined;
                    })()}
                    onChange={(e) => updateLoad(load.id, { equipment: e.target.value })}
                  >
                    {effectiveEquipment(load, lane) === 'LIVE/LIVE' && (
                      <option value="LIVE/LIVE">LIVE/LIVE (legacy)</option>
                    )}
                    {EQUIPMENT_OPTIONS.map((o) => (
                      <option key={o} value={o} style={{ background: equipmentColor(o), color: '#fff' }}>{o}</option>
                    ))}
                  </select>
                </td>
                <td className="hub-target muted">
                  {(() => {
                    const rec = integrityFor(load);
                    if (!rec) {
                      /* legacy fallback until this trip lands in the integrity DB */
                      return (
                        <>
                          {lane.weekdayRate && <div>WD {lane.weekdayRate}</div>}
                          {lane.weekendRate && <div>WE {lane.weekendRate}</div>}
                        </>
                      );
                    }
                    const active = bandFor(load, lane);
                    return (
                      <>
                        <div className={active === 'weekday' ? 'band-active' : ''}>WD {fmtBand(rec.bands?.weekday)}</div>
                        <div className={active === 'weekend' ? 'band-active' : ''}>
                          WE {fmtBand(rec.bands?.weekend)}
                          {liveUpgraded(load, lane) && <span className="band-live" title="Live load on a power-only lane — priced off the weekend band"> LIVE⇒WE</span>}
                        </div>
                      </>
                    );
                  })()}
                </td>
                <td>
                  {/* notes STAY on booked rows (Caleb+Zack 07/15: booking used
                      to swallow the note log and block new notes) */}
                  {booked && (
                    mayApprove ? (
                      <button
                        className="btn-approve"
                        onClick={() => approveBooking(load.id)}
                      >
                        ✓ Approve booking
                      </button>
                    ) : (
                      <span className="muted">Awaiting admin approval</span>
                    )
                  )}
                  <NoteCell load={load} />
                </td>
                <td>
                  {/* v2.32.0: the three toggles get LABELS — the bare
                      checkboxes were indistinguishable (Caleb couldn't find
                      soft book, and the 👁 read as decoration). */}
                  <div className="row-toggles">
                    <label className={`tog ${load.pinnedNight ? 'tog-on' : ''}`} title="Pin for night shift">
                      <input
                        type="checkbox"
                        className="pin-check"
                        checked={!!load.pinnedNight}
                        disabled={!canPin}
                        onChange={(e) => updateLoad(load.id, { pinnedNight: e.target.checked })}
                      />
                      <span>🌙<br />Night</span>
                    </label>
                    <label className={`tog ${load.softBook ? 'tog-on tog-soft' : ''}`} title="Soft book — booked high, still shopping for cheaper (row turns yellow)">
                      <input
                        type="checkbox"
                        checked={!!load.softBook}
                        disabled={!canPin}
                        onChange={(e) => updateLoad(load.id, { softBook: e.target.checked })}
                      />
                      <span>🟡<br />Soft</span>
                    </label>
                    <button
                      className={`hide-toggle tog ${load.hideFromBoard ? 'is-hidden' : ''}`}
                      disabled={!canBoard}
                      title={load.hideFromBoard ? 'HIDDEN from the carrier loadboard — click to show' : 'Visible on the carrier loadboard — click to hide'}
                      onClick={() => updateLoad(load.id, { hideFromBoard: !load.hideFromBoard })}
                    >
                      {load.hideFromBoard ? '🚫' : '👁'}<span>{load.hideFromBoard ? 'Off' : 'Board'}</span>
                    </button>
                  </div>
                </td>
              </tr>
            </Fragment>);
          })}
        </tbody>
      </table>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Sales Hub</h2>
        <input
          className="search"
          placeholder="Search city, load, trip, carrier…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="muted">
          Auto-built from the Matrix · next 72 hours · {total} open trips
          {offers.filter((o) => o.status === 'pending').length > 0 && (
            <span className="offer-badge">
              {' '}📨 {(() => { const n = offers.filter((o) => o.status === 'pending').length; return `${n} pending offer${n === 1 ? '' : 's'}`; })()}
            </span>
          )}
        </span>
        {mayPush && <button
          className="btn-ghost"
          title="Push current rates and visibility to the carrier loadboard"
          onClick={async () => {
            setPushState('Pushing…');
            if (demoMode) {
              setPushState('Demo mode — board derives live.');
              return;
            }
            const n = await rebuildLoadboard();
            setPushState(`Loadboard updated — ${n} trips posted.`);
          }}
        >
          ⟳ Push to Loadboard
        </button>}
        {pushState && <span className="muted">{pushState}</span>}
      </div>
      {autoSetMsg && <p className="muted">{autoSetMsg}</p>}
      {sections.map(({ date, am, pm }) => (
        <section key={date} className="hub-day">
          {([['MORNING', am], ['AFTERNOON', pm]] as const).map(([label, dayLoads]) => (
            <div key={label}>
              <h3 className="hub-banner">
                {hubLabel(date)} — {label} LOADS{' '}
                <span className="muted" title="Open = still needs a carrier; covered loads awaiting booking approval are excluded from the open count (Zack 07/12)">
                  ({dayLoads.filter((l) => isExposed(l) || shuttleLegExposed(l)).length} open · {dayLoads.length} total)
                </span>
                {can(currentUser, 'hub.autoset') && dayLoads.some((l) => isExposed(l)) && (
                  <span className="autoset-btns">
                    <button className="btn-autoset" title="Set every OPEN load in this section to its band's target (integrity DB)" onClick={() => autoSet(dayLoads, 'target')}>
                      ⚡ Set open → Target
                    </button>
                    <button className="btn-autoset ceiling" title="Set every OPEN load in this section to its band's ceiling (integrity DB)" onClick={() => autoSet(dayLoads, 'ceiling')}>
                      → Ceiling
                    </button>
                  </span>
                )}
              </h3>
              {table(dayLoads)}
            </div>
          ))}
        </section>
      ))}

      {/* Phase 4: what admins cleared off the hub today — audit-stamped by
          approveBooking; TMS imports carry no stamp so they don't flood this. */}
      {clearedToday.length > 0 && (
        <details className="hub-cleared">
          <summary className="hub-banner">CLEARED TODAY <span className="muted">({clearedToday.length})</span></summary>
          <table className="list-table hub-table">
            <thead>
              <tr><th>Trip #</th><th>Load</th><th>Date</th><th>Lane</th><th>Carrier</th><th>Rate</th><th>Cleared by</th></tr>
            </thead>
            <tbody>
              {clearedToday.map((load) => {
                const lane = laneMap.get(load.laneId);
                return (
                  <tr key={load.id}>
                    <td>{lane?.tripCode.replace(/^FA2D3-/i, '') ?? '—'}</td>
                    <td>
                      <button className="load-link" title="Open in Matrix" onClick={() => navigate(`/matrix?load=${encodeURIComponent(load.id)}`)}>
                        {load.loadNumber || '—'}
                      </button>
                    </td>
                    <td>{Number(load.date.slice(5, 7))}/{Number(load.date.slice(8, 10))}</td>
                    <td className="wrap">{lane ? laneCompactName(lane) : load.laneId}</td>
                    <td className="strong">{load.carrier}</td>
                    <td>{fmtRateStr(load.rate ?? '') || load.postedRate || '—'}</td>
                    <td className="muted">
                      {load.bookingApprovedBy}
                      {load.bookingApprovedAt && ` · ${fmtStamp(load.bookingApprovedAt).split(' ')[1]}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
