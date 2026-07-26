/* Assignments — PHASE 1. Replaces the single Truck # field on Load Info.

   One load, many legs. Each card is a leg: truck, trailer, two driver seats,
   carrier authority, leg type, and the stop range it covers. Adding a leg is how
   a local shuttle hands off to an OTR team without faking two loads.

   Two deliberate behaviors:
   - An OUT-OF-SERVICE truck is blocked. Everything else only WARNS. A driver
     with no ready date, or one who's out, or a flagged one, shows a warning and
     saves anyway — dispatch overrides are real and the board shouldn't argue
     with the person who knows the situation.
   - Legs renumber themselves. legIndex is positional, so removing leg 2 of 3
     leaves 1 and 2, never a gap. */

import TrailerCombo from './TrailerCombo';
import { useEffect, useMemo, useState } from 'react';
import type { Load } from '../data/loadsStore';
import { loadFleet } from '../data/fleetStore';
import { loadTrailers } from '../data/trailersStore';
import { canDelete } from '../data/permStore';
import {
  legsFor, fetchAssignments, saveAssignments, blankAssignment,
  driverWarning, truckIsOutOfService, driversFromNames, seatName,
  driverOptions, LEG_TYPE_OPTIONS,
} from '../data/tms/assignmentsStore';
import { BOOKING_AUTHORITIES, type LoadAssignment, type LegType } from '../data/tms/types';

export default function AssignmentsSection({ load, onChanged }: {
  load: Load;
  onChanged?: (legs: LoadAssignment[]) => void;
}) {
  const [legs, setLegs] = useState<LoadAssignment[]>(() => legsFor(load));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  /* pull the real leg documents once the modal opens; until they arrive the
     synthesized leg from the legacy fields is what's shown, so the section is
     never empty and never blocks on the network */
  useEffect(() => {
    let alive = true;
    void fetchAssignments(load.id).then(() => { if (alive) setLegs(legsFor(load)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.id]);

  const fleet = useMemo(() => loadFleet(), []);
  const trailers = useMemo(() => loadTrailers(), []);
  const drivers = useMemo(() => driverOptions(), []);
  const stopCount = Math.max(1, load.stops.length);
  const mayDelete = canDelete();

  async function commit(next: LoadAssignment[]) {
    setLegs(next);                       // optimistic: the card reflects the edit instantly
    setBusy(true); setErr('');
    try {
      const saved = await saveAssignments(load.id, next);
      setLegs(saved);
      onChanged?.(saved);
    } catch (e) {
      setErr(`Couldn't save the legs — ${(e as Error).message}`);
    }
    setBusy(false);
  }

  function patch(i: number, p: Partial<LoadAssignment>) {
    void commit(legs.map((g, j) => (j === i ? { ...g, ...p } : g)));
  }
  function addLeg() {
    const prev = legs[legs.length - 1];
    void commit([...legs, blankAssignment(legs.length + 1, stopCount, {
      /* a new leg picks up where the last one ended — the common case is a
         handoff, not an overlap */
      fromStopSeq: prev ? Math.min(prev.toStopSeq, stopCount) : 1,
      toStopSeq: stopCount,
    })]);
  }
  function dropLeg(i: number) {
    void commit(legs.filter((_, j) => j !== i).map((g, j) => ({ ...g, legIndex: j + 1 })));
  }

  return (
    <div className="load-assign-box">
      <div className="load-assign-title">
        Assignments
        <span className="am-muted"> — one block per leg. A local shuttle that hands off to an OTR team is
        two legs on <b>this same load</b>, each with its own truck and crew.</span>
      </div>

      {legs.map((g, i) => {
        const oos = truckIsOutOfService(g.truckNumber);
        const d1 = seatName(g, 'primary');
        const d2 = seatName(g, 'co');
        const w1 = driverWarning(d1);
        const w2 = driverWarning(d2);
        const badRange = !(g.fromStopSeq >= 1) || !(g.toStopSeq >= g.fromStopSeq);
        return (
          <div key={g.id} className={`leg-card${g.cancelled ? ' leg-cancelled' : ''}`}>
            <div className="leg-card-head">
              <span className="leg-chip">leg {g.legIndex} of {legs.length}</span>
              <select className="am-input leg-type" value={g.legType}
                onChange={(e) => patch(i, { legType: e.target.value as LegType })}>
                {LEG_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {g.cancelled && <span className="am-pill" style={{ color: 'var(--red)' }}>⛔ cancelled</span>}
              {legs.length > 1 && (mayDelete
                ? <button className="fleet-del leg-drop" onClick={() => dropLeg(i)} title="Remove this leg">🗑</button>
                : <button className="am-clear leg-drop" disabled title="Removing a leg is restricted to FMT Lead / US Ops / Owner">🔒</button>)}
            </div>

            <div className="load-two">
              <L t="Truck #">
                <input className={`am-input${oos ? ' leg-blocked' : ''}`} list="leg-trucks" value={g.truckNumber}
                  onChange={(e) => patch(i, { truckNumber: e.target.value })}
                  placeholder="type a truck #" />
              </L>
              <L t="Trailer #">
                <TrailerCombo value={g.trailerNumber} loadId={load.id}
                  onChange={(v) => patch(i, { trailerNumber: v })} />
              </L>
            </div>
            {oos && (
              <div className="am-notice">
                ⛔ Truck #{g.truckNumber} is <b>out of service</b> — it can't be dispatched. Pick another unit,
                or return it to service on Fleet → Trucks.
              </div>
            )}

            <div className="load-two">
              <L t="Driver 1 (primary)">
                <input className="am-input" list="leg-drivers" value={d1}
                  onChange={(e) => patch(i, { drivers: driversFromNames(e.target.value, d2) })}
                  placeholder="assign a driver" />
              </L>
              <L t="Driver 2 (co-driver)">
                <input className="am-input" list="leg-drivers" value={d2}
                  onChange={(e) => patch(i, { drivers: driversFromNames(d1, e.target.value) })}
                  placeholder="team runs only" />
              </L>
            </div>
            {(w1 || w2) && (
              <div className="leg-warn">
                ⚠ {[w1, w2].filter(Boolean).map((w) => `${w!.name} — ${w!.reason}`).join(' · ')}.
                <span className="am-muted"> Saved anyway; this is a heads-up, not a block.</span>
              </div>
            )}

            <div className="load-two">
              <L t="Carrier authority (this leg)">
                <select className="am-input" value={g.carrierAuthority}
                  onChange={(e) => patch(i, { carrierAuthority: e.target.value })}>
                  <option value="">— same as the load —</option>
                  {BOOKING_AUTHORITIES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </L>
              <L t={`Stops covered (1–${stopCount})`}>
                <div className="leg-range">
                  <input className={`am-input${badRange ? ' leg-blocked' : ''}`} type="number" min={1} max={stopCount}
                    value={g.fromStopSeq}
                    onChange={(e) => patch(i, { fromStopSeq: Number(e.target.value) || 1 })} />
                  <span className="am-muted">→</span>
                  <input className={`am-input${badRange ? ' leg-blocked' : ''}`} type="number" min={1} max={stopCount}
                    value={g.toStopSeq}
                    onChange={(e) => patch(i, { toStopSeq: Number(e.target.value) || 1 })} />
                </div>
              </L>
            </div>
            {badRange && <div className="am-notice">This leg's stop range runs backwards — the last stop must be at or after the first.</div>}
          </div>
        );
      })}

      <div className="leg-actions">
        <button className="am-clear" onClick={addLeg} disabled={busy}>＋ Add leg</button>
        {busy && <span className="am-muted" style={{ fontSize: 11.5 }}>saving…</span>}
        {err && <span className="am-notice" style={{ marginTop: 0 }}>{err}</span>}
      </div>

      {/* shared option lists for every leg's typeaheads */}
      <datalist id="leg-trucks">
        {fleet.map((t) => (
          <option key={t.tractor} value={t.tractor}>
            {[(t.status || '').toLowerCase() === 'out of service' ? '⛔ OUT OF SERVICE' : '',
              [t.driver1, t.driver2].filter(Boolean).join(' / ') || t.type].filter(Boolean).join(' · ')}
          </option>
        ))}
      </datalist>
      <datalist id="leg-trailers">
        {trailers.map((t) => <option key={t.number} value={t.number}>{[t.type, t.status].filter(Boolean).join(' · ')}</option>)}
      </datalist>
      <datalist id="leg-drivers">
        {drivers.map((d) => <option key={d.name} value={d.name}>{d.hint}</option>)}
      </datalist>
    </div>
  );
}

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="load-field"><span className="load-field-label">{t}</span>{children}</label>;
}
