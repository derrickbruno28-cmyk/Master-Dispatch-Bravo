/* Milestones tab — PHASE 2.

   The event ladder for every stop, laid out the way LoadStop does it:
   Actions | Event | Required | Date time | Status | Comments | Location |
   Reported Location | Source | Creation Info.

   Rungs that haven't been logged still SHOW, greyed, so the ladder reads as a
   checklist rather than a history that only appears after the fact — a
   dispatcher can see at a glance what the stop still owes.

   Every log goes through milestonesStore.logMilestone, so ladder order, the
   timing computation, and the Late-needs-a-reason rule are enforced for this
   screen exactly as they are for the board's fast-log. */

import { useEffect, useMemo, useState } from 'react';
import type { Load } from '../data/loadsStore';
import { canDelete } from '../data/permStore';
import { onChange } from '../data/bus';
import { stopsFor, fetchStops, plannedAtOf, stopLabel, isYardStop } from '../data/tms/stopsStore';
import { legsFor } from '../data/tms/assignmentsStore';
import {
  fetchMilestones, milestonesForStop, logMilestone, removeMilestone,
  detentionFor, varianceFor, latestLocationFor, nextRequiredEvent, ladderBlocker,
} from '../data/tms/milestonesStore';
import { loadAudit, fetchAudit } from '../data/tms/auditLog';
import {
  ladderFor, isRequiredEvent, LATE_REASONS, lateReasonNeedsDetail,
  type MilestoneEvent, type MilestoneSource, type LoadMilestone, type LoadStopDoc, type LateReason,
} from '../data/tms/types';

const SOURCES: MilestoneSource[] = ['DISPATCH', 'DRIVER', 'SAMSARA'];
const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const TIMING_COLOR: Record<string, string> = { 'On Time': 'var(--green)', 'At Risk': 'var(--amber)', Late: 'var(--red)' };

export default function MilestonesTab({ load, onStatus }: { load: Load; onStatus?: () => void }) {
  const [, force] = useState(0);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [logs, setLogs] = useState<{ at: string; by: string; summary: string }[] | null>(null);

  useEffect(() => onChange(() => force((n) => n + 1)), []);
  useEffect(() => {
    void Promise.all([fetchStops(load.id), fetchMilestones(load.id)]).then(() => force((n) => n + 1));
  }, [load.id]);

  const stops = stopsFor(load);
  const legs = useMemo(() => legsFor(load), [load]);
  const mayDelete = canDelete();

  async function log(stop: LoadStopDoc, event: MilestoneEvent, source: MilestoneSource, extra?: { lateReason?: LateReason | ''; lateReasonDetail?: string; comments?: string }) {
    setBusy(`${stop.id}:${event}`); setErr('');
    const truck = legs.find((g) => stop.seq >= g.fromStopSeq && stop.seq <= g.toStopSeq)?.truckNumber || '';
    /* a SAMSARA-sourced rung carries the position the adapter reports — that's
       what makes it authoritative for location and comparable to the manual one */
    const reportedLocation = source === 'SAMSARA' && truck ? await latestLocationFor(truck) : undefined;
    const res = await logMilestone(load, { stop, event, source, reportedLocation, ...extra });
    if (!res.ok) setErr(res.error || 'Could not log that milestone.');
    setBusy(''); force((n) => n + 1); onStatus?.();
  }

  async function pullLocation(stop: LoadStopDoc, m: LoadMilestone) {
    const truck = legs.find((g) => stop.seq >= g.fromStopSeq && stop.seq <= g.toStopSeq)?.truckNumber || '';
    if (!truck) { setErr('No truck on the leg covering this stop — assign one on Load Info first.'); return; }
    setBusy(`${m.id}:loc`); setErr('');
    const loc = await latestLocationFor(truck);
    if (!loc) setErr(`No position available for truck #${truck}. Connect a Samsara org on Integrations to get live GPS.`);
    else await logMilestone(load, { stop, event: m.eventType, source: m.source, actualAt: m.actualAt, reportedLocation: loc, comments: m.comments });
    setBusy(''); force((n) => n + 1);
  }

  return (
    <div className="ms-wrap">
      <div className="ms-head">
        <span className="am-muted">
          Every stop runs an ordered ladder. Required rungs are marked <b>*</b>; loading and detention rungs are optional —
          log them when they actually happen. <b>Board status is derived from these</b>, so logging here moves the truck on the matrix.
        </span>
        <button className="am-clear" onClick={() => { if (logs) { setLogs(null); return; } void fetchAudit(load.id).then(() => setLogs(loadAudit(load.id))); }}>
          {logs ? '✕ Hide update logs' : '🕓 View update logs'}
        </button>
      </div>

      {err && <div className="am-notice">{err}</div>}

      {logs && (
        <div className="ms-logs">
          {logs.length === 0
            ? <div className="am-muted">No changes recorded on this load yet. The trail starts with the first edit — it is append-only and can't be rewritten.</div>
            : logs.map((e, i) => (
              <div key={i} className="ms-log-row">
                <span className="am-muted">{fmt(e.at)}</span>
                <b>{e.by}</b>
                <span>{e.summary}</span>
              </div>
            ))}
        </div>
      )}

      {stops.length === 0 && <div className="am-muted">This load has no stops yet — add them on the Stops tab and the ladder appears here.</div>}

      {stops.map((stop) => {
        const ladder = ladderFor(stop.type);
        const logged = milestonesForStop(load.id, stop.id);
        const det = detentionFor(load.id, stop);
        const nextReq = nextRequiredEvent(load.id, stop);
        const planned = plannedAtOf(stop);

        return (
          <div key={stop.id} className="ms-stop">
            <div className="ms-stop-head">
              <span className="ms-stop-title">
                {isYardStop(stop) ? '🏗 ' : stop.type === 'Pickup' ? '📦 ' : '🏁 '}{stopLabel(stop)}
              </span>
              <span className="am-muted">appt {planned ? fmt(planned) : 'not set'}</span>
              {det.basis !== 'none' && (
                <span className={`ms-det ${det.minutes > 0 ? 'on' : ''}`} title={det.note}>
                  ⏱ detention {det.minutes} min <em>({det.basis})</em>
                </span>
              )}
              {nextReq && <span className="ms-next">next: {nextReq}</span>}
            </div>

            <div className="ms-scroll">
              <table className="am-grid ms-table">
                <thead>
                  <tr>
                    <th>Actions</th><th>Event type</th><th>Req</th><th>Date time</th><th>Status</th>
                    <th>Comments</th><th>Location</th><th>Reported location</th><th>Source</th><th>Creation info</th>
                  </tr>
                </thead>
                <tbody>
                  {ladder.map((ev) => {
                    /* every rung that exists for this event, whatever the source —
                       a manual and a Samsara record of the same rung both show */
                    const rows = logged.filter((m) => m.eventType === ev);
                    const v = varianceFor(load.id, stop.id, ev);
                    const blocked = ladderBlocker(load.id, stop, ev);

                    if (rows.length === 0) {
                      return (
                        <tr key={ev} className="ms-row-empty">
                          <td>
                            <div className="ms-actions">
                              {SOURCES.map((s) => (
                                <button key={s} className="am-clear ms-log-btn"
                                  disabled={!!busy || !!blocked}
                                  title={blocked ? `Log “${blocked}” first — the ladder is in order.` : `Log ${ev} · source ${s}`}
                                  onClick={() => void log(stop, ev, s)}>
                                  {s === 'DISPATCH' ? '🖥' : s === 'DRIVER' ? '🚚' : '📡'}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="am-muted">{ev}</td>
                          <td>{isRequiredEvent(ev) ? <b>*</b> : ''}</td>
                          <td colSpan={7} className="am-muted">
                            {blocked ? `waiting on “${blocked}”` : 'not logged yet'}
                          </td>
                        </tr>
                      );
                    }

                    return rows.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <div className="ms-actions">
                            <button className="am-clear ms-log-btn" disabled={busy === `${m.id}:loc`}
                              title="Pull the truck's current position from the telematics adapter"
                              onClick={() => void pullLocation(stop, m)}>📍</button>
                            {mayDelete && (
                              <button className="fleet-del ms-log-btn" title="Remove this logged event"
                                onClick={() => void removeMilestone(load.id, m.id).then(() => force((n) => n + 1))}>🗑</button>
                            )}
                          </div>
                        </td>
                        <td>{m.eventType}</td>
                        <td>{m.required ? <b>*</b> : ''}</td>
                        <td>{fmt(m.actualAt)}</td>
                        <td>
                          {m.timing
                            ? <span className="am-pill" style={{ color: TIMING_COLOR[m.timing] }}>{m.timing}</span>
                            : <span className="am-muted">—</span>}
                          {m.timingManualOverride && <span className="am-muted" title="a human overrode the computed result"> ✎</span>}
                          {m.lateReason && <div className="ms-late">⚠ {m.lateReason}{m.lateReasonDetail ? ` — ${m.lateReasonDetail}` : ''}</div>}
                          {v?.flagged && (
                            <div className="ms-variance" title="The manual entry and the Samsara reading disagree. Both are kept; Samsara is authoritative for location.">
                              ⚠ variance {v.reason}
                            </div>
                          )}
                        </td>
                        <td className="ms-cmt">{m.comments || '—'}</td>
                        <td className="am-muted">{[m.enteredLocation.city, m.enteredLocation.state].filter(Boolean).join(', ') || '—'}</td>
                        <td className="am-muted">
                          {m.reportedLocation
                            ? `${m.reportedLocation.lat?.toFixed(3)}, ${m.reportedLocation.lon?.toFixed(3)}`
                            : '—'}
                        </td>
                        <td><span className={`ms-src ms-src-${m.source.toLowerCase()}`}>{m.source}</span></td>
                        <td className="am-muted ms-cre">{m.sourceDetail}<br />{fmt(m.createdAt)}</td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>

            {/* completing a stop LATE has to say why — the control appears exactly
                when the rule bites, instead of being a field people ignore */}
            <LateCompletion stop={stop} load={load} busy={!!busy} onLog={log} />
          </div>
        );
      })}
    </div>
  );
}

/* The completion rung, with the structured late reason attached. Shown only when
   the completion hasn't been logged yet. */
function LateCompletion({ stop, load, busy, onLog }: {
  stop: LoadStopDoc; load: Load; busy: boolean;
  onLog: (s: LoadStopDoc, e: MilestoneEvent, src: MilestoneSource, extra?: { lateReason?: LateReason | ''; lateReasonDetail?: string; comments?: string }) => Promise<void>;
}) {
  const completion: MilestoneEvent = stop.type === 'Pickup' ? 'Pickup Completed' : 'Delivery Completed';
  const done = milestonesForStop(load.id, stop.id).some((m) => m.eventType === completion);
  const [reason, setReason] = useState<LateReason | ''>('');
  const [detail, setDetail] = useState('');
  if (done) return null;

  return (
    <div className="ms-complete">
      <span className="am-muted">If <b>{completion}</b> lands after the appointment, a structured late reason is required:</span>
      <select className="am-input ms-reason" value={reason} onChange={(e) => setReason(e.target.value as LateReason | '')}>
        <option value="">— late reason (only needed if late) —</option>
        {LATE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      {lateReasonNeedsDetail(reason) && (
        <input className="am-input ms-detail" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="required detail for “Other”" />
      )}
      <button className="am-save" disabled={busy}
        onClick={() => void onLog(stop, completion, 'DISPATCH', { lateReason: reason, lateReasonDetail: detail })}>
        ✓ {completion}
      </button>
    </div>
  );
}
