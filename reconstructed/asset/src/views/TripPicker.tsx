/* Load Repository trip picker + diff preview — PHASE 3.

   Picking a trip does NOT write anything. It builds a proposal, shows every
   field as "current → proposed", and waits.

   The safety property worth stating plainly: a field the load already holds a
   DIFFERENT value for is a conflict and is UNTICKED by default. Filling a blank
   is ticked, because filling a blank can't destroy anything. So a fresh load is
   one click, and a load somebody already typed into makes you look at each
   overwrite. Anything the parser couldn't read confidently is listed as a
   warning next to the diff rather than quietly guessed. */

import { useMemo, useState } from 'react';
import type { Load } from '../data/loadsStore';
import type { AssetRoute } from '../data/fleet';
import { findTrips } from '../data/tms/repository';
import { proposeTrip, applyTrip, type TripProposal } from '../data/tms/applyTrip';

export default function TripPicker({ load, onApplied }: {
  load: Load;
  onApplied: (l: Load, summary: string) => void;
}) {
  const [q, setQ] = useState('');
  const [proposal, setProposal] = useState<TripProposal | null>(null);
  const [applyStops, setApplyStops] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const hits = useMemo(() => (q.trim() ? findTrips(q) : []), [q]);

  function pick(row: AssetRoute) {
    setErr('');
    setProposal(proposeTrip(load, row));
    setQ('');
  }

  function toggle(i: number) {
    setProposal((p) => p && ({ ...p, fields: p.fields.map((f, j) => (j === i ? { ...f, apply: !f.apply } : f)) }));
  }

  async function commit() {
    if (!proposal) return;
    setBusy(true); setErr('');
    try {
      const res = await applyTrip(load, proposal, { applyStops });
      const bits = [
        res.appliedFields.length ? `${res.appliedFields.length} field${res.appliedFields.length === 1 ? '' : 's'}` : '',
        res.stops ? `${res.stops} stops` : '',
      ].filter(Boolean).join(' + ');
      onApplied(res.load, `✓ Trip ${proposal.plan.tripCode || ''} applied — ${bits || 'nothing to change'}.`);
      setProposal(null);
    } catch (e) {
      setErr(`Couldn't apply the trip — ${(e as Error).message}`);
    }
    setBusy(false);
  }

  const conflicts = proposal?.fields.filter((f) => f.conflict) ?? [];

  return (
    <div className="trip-pick">
      <div className="trip-search">
        <label className="load-field" style={{ flex: 1 }}>
          <span className="load-field-label">Fill from the Load Repository — search a trip # or city</span>
          <input className="am-input" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="FA2D3-544 · Coppell · Memphis…" />
        </label>
      </div>

      {hits.length > 0 && (
        <div className="trip-hits">
          {hits.map(({ row, plan }) => (
            <button key={`${plan.tripCode}-${row.route}`} className="trip-hit" onClick={() => pick(row)}>
              <span className="trip-hit-code">{plan.tripCode || '—'}</span>
              <span className="trip-hit-route">{plan.origin} → {plan.deliveries.join(' → ') || '—'}</span>
              <span className="am-muted">{plan.freq || 'no frequency listed'}</span>
            </button>
          ))}
        </div>
      )}

      {proposal && (
        <div className="trip-diff">
          <div className="trip-diff-head">
            <b>Trip {proposal.plan.tripCode || '(no code)'}</b>
            <span className="am-muted">{proposal.plan.origin} → {proposal.plan.deliveries.join(' → ')}</span>
            <button className="am-clear" onClick={() => setProposal(null)}>✕ Cancel</button>
          </div>

          {proposal.warnings.length > 0 && (
            <div className="trip-warn">
              <b>⚠ The repository row wasn't fully readable</b> — these are shown so you can fix them by hand
              rather than having them guessed:
              <ul>{proposal.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}

          {proposal.fields.length === 0
            ? <div className="am-muted">This trip has nothing to add — the load already matches it.</div>
            : (
              <table className="am-grid trip-table">
                <thead><tr><th>Apply</th><th>Field</th><th>Now</th><th>From the trip</th></tr></thead>
                <tbody>
                  {proposal.fields.map((f, i) => (
                    <tr key={f.field} className={f.conflict ? 'trip-conflict' : ''}>
                      <td><input type="checkbox" checked={f.apply} onChange={() => toggle(i)} /></td>
                      <td>{f.label}{f.conflict && <span className="trip-flag" title="This load already holds a different value — ticking this overwrites it."> overwrite</span>}</td>
                      <td className="am-muted">{f.current}</td>
                      <td><b>{f.proposed}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

          <label className="load-inc trip-stops-toggle">
            <input type="checkbox" checked={applyStops} onChange={(e) => setApplyStops(e.target.checked)} />
            Replace the stop list with the trip's {proposal.stops.length} stop{proposal.stops.length === 1 ? '' : 's'}
            <span className="am-muted"> — appointment dates come off this load's route date; extra stops already on the load are kept.</span>
          </label>

          {proposal.stops.length > 0 && applyStops && (
            <div className="trip-stops">
              {proposal.stops.map((s) => (
                <div key={s.id} className="trip-stop-row">
                  <span className={`trip-stop-type ${s.type === 'Pickup' ? 'pu' : 'del'}`}>{s.type}</span>
                  <span>#{s.seq} {[s.location.city, s.location.state].filter(Boolean).join(', ') || '—'}</span>
                  <span className="am-muted">
                    {s.apptDate || 'no date'}{s.apptWindowStart ? ` ${s.apptWindowStart}` : ''}
                    {s.apptWindowEnd ? `–${s.apptWindowEnd}` : ''}
                  </span>
                  {s.stopAction && <span className="am-muted">{s.stopAction}</span>}
                </div>
              ))}
            </div>
          )}

          {proposal.stopNotes.map((n, i) => <div key={i} className="am-muted trip-note">{n}</div>)}
          {conflicts.length > 0 && (
            <div className="trip-warn">
              {conflicts.length} field{conflicts.length === 1 ? '' : 's'} already {conflicts.length === 1 ? 'holds' : 'hold'} a different
              value. Those are unticked — tick only what you actually want overwritten.
            </div>
          )}
          {err && <div className="am-notice">{err}</div>}

          <button className="am-save" disabled={busy} onClick={() => void commit()}>
            {busy ? 'Applying…' : '✓ Apply to this load'}
          </button>
        </div>
      )}
    </div>
  );
}
