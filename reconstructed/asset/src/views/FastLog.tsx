/* Fast-log — PHASE 2.

   A dispatcher moving twenty trucks along should not have to open a modal
   twenty times. This is the ⚡ on a board cell: it names the next required rung
   for that load and logs it in ONE tap, tagged DISPATCH.

   It is deliberately the same write path as the Milestones tab
   (milestonesStore.logMilestone), so ladder order, the timing computation, and
   the Late-needs-a-reason rule apply here identically. When the rung it's about
   to log would land Late, the popover grows a reason picker instead of quietly
   refusing — the rule is explained at the point it bites. */

import { useEffect, useState } from 'react';
import type { Load } from '../data/loadsStore';
import { fetchStops, plannedAtOf, stopLabel } from '../data/tms/stopsStore';
import { fetchMilestones, nextRequiredForLoad, logMilestone, computeTiming } from '../data/tms/milestonesStore';
import { windowCloseOf } from '../data/tms/stopsStore';
import { LATE_REASONS, lateReasonNeedsDetail, type LateReason } from '../data/tms/types';

export default function FastLog({ load, onClose, onLogged }: {
  load: Load; onClose: () => void; onLogged?: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reason, setReason] = useState<LateReason | ''>('');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    void Promise.all([fetchStops(load.id), fetchMilestones(load.id)]).then(() => setReady(true));
  }, [load.id]);

  const next = ready ? nextRequiredForLoad(load) : null;

  /* work out NOW whether this tap would be late, so the reason picker appears
     before the click rather than after a rejection */
  const wouldBeLate = next
    ? computeTiming(new Date().toISOString(), plannedAtOf(next.stop), windowCloseOf(next.stop)) === 'Late'
      && (next.event === 'Pickup Completed' || next.event === 'Delivery Completed')
    : false;

  async function log() {
    if (!next) return;
    setBusy(true); setErr('');
    const res = await logMilestone(load, {
      stop: next.stop, event: next.event, source: 'DISPATCH',
      lateReason: reason, lateReasonDetail: detail,
    });
    setBusy(false);
    if (!res.ok) { setErr(res.error || 'Could not log that.'); return; }
    onLogged?.();
    onClose();
  }

  return (
    <div className="fastlog" onClick={(e) => e.stopPropagation()}>
      <div className="fastlog-head">
        <b>⚡ Quick log</b>
        <button className="am-clear fastlog-x" onClick={onClose}>✕</button>
      </div>

      {!ready && <div className="am-muted">Loading the ladder…</div>}

      {ready && !next && (
        <div className="am-muted">
          Every required rung on this load is logged. Open the load's <b>Milestones</b> tab for the
          optional ones (loading, detention).
        </div>
      )}

      {ready && next && (
        <>
          <div className="fastlog-next">
            <div className="fastlog-ev">{next.event}</div>
            <div className="am-muted">{stopLabel(next.stop)}</div>
            <div className="am-muted">appt {plannedAtOf(next.stop) ? new Date(plannedAtOf(next.stop)).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'not set'}</div>
          </div>

          {wouldBeLate && (
            <div className="fastlog-late">
              ⚠ Logging this now is <b>Late</b> against the appointment — pick a reason:
              <select className="am-input" value={reason} onChange={(e) => setReason(e.target.value as LateReason | '')}>
                <option value="">— select a late reason —</option>
                {LATE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              {lateReasonNeedsDetail(reason) && (
                <input className="am-input" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="required detail for “Other”" />
              )}
            </div>
          )}

          {err && <div className="am-notice">{err}</div>}

          <button className="am-save fastlog-go" disabled={busy} onClick={() => void log()}>
            {busy ? 'Logging…' : `✓ Log ${next.event}`}
          </button>
          <div className="am-muted fastlog-foot">Recorded as <b>DISPATCH</b> at the current time. The board status follows automatically.</div>
        </>
      )}
    </div>
  );
}
