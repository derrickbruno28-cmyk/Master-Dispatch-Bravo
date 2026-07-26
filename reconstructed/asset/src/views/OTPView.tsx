/* OTP / OTD — PHASE 6.

   THIS SCREEN NO LONGER TAKES INPUT.
   The "+ Log Shipment" form is gone on purpose. Every row here is derived from
   the loads and their milestone ladders, so the on-time number and the dispatch
   board can never tell two different stories. If a row looks wrong, the fix is
   on the load's Milestones tab — which is also where the late reason came from,
   because Phase 2 refuses to save a late completion without one.

   Pending is not a pass. A stop nobody logged is an unknown, and it stays out of
   the percentage instead of quietly inflating it. */

import { useEffect, useMemo, useState } from 'react';
import { onChange } from '../data/bus';
import { loadAll } from '../data/loadsStore';
import { fetchMilestones } from '../data/tms/milestonesStore';
import { fetchStops } from '../data/tms/stopsStore';
import { fetchAssignments } from '../data/tms/assignmentsStore';
import {
  allRows, computeStats, lateGroups, topFailReasons, targetColor, rowsToCsv, fmtActual,
  OTP_TARGET, OTD_TARGET, type OtpFlag, type GroupBy,
} from '../data/tms/performance';

const flag = (v: OtpFlag) =>
  v === 'On Time' ? <span className="badge badge-green">✓ ON TIME</span>
    : v === 'Late' ? <span className="badge badge-red">✗ LATE</span>
      : <span className="badge badge-amber">⏳ PENDING</span>;

const GROUPS: { key: GroupBy; label: string }[] = [
  { key: 'reason', label: 'By reason' },
  { key: 'driver', label: 'By driver' },
  { key: 'terminal', label: 'By terminal' },
  { key: 'customer', label: 'By customer' },
];

export default function OTPView() {
  const [, force] = useState(0);
  const [fWeek, setFWeek] = useState('all');
  const [fDriver, setFDriver] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('reason');
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => onChange(() => force((n) => n + 1)), []);

  /* pull the subcollections this screen reads. In demo they're already local;
     live, this is the one place that warms them for every load on the page. */
  useEffect(() => {
    void (async () => {
      for (const l of loadAll()) {
        await Promise.all([fetchStops(l.id), fetchMilestones(l.id), fetchAssignments(l.id)]);
      }
      force((n) => n + 1);
    })();
  }, []);

  const rows = useMemo(() => allRows(), []);
  const weeks = useMemo(() => [...new Set(rows.map((r) => r.week).filter(Boolean))]
    .sort((a, b) => Number(b) - Number(a)), [rows]);
  const drivers = useMemo(() => [...new Set(rows.flatMap((r) => [r.driver, r.delDriver]).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    let d = rows;
    if (fWeek !== 'all') d = d.filter((r) => r.week === fWeek);
    if (fDriver !== 'all') d = d.filter((r) => r.driver === fDriver || r.delDriver === fDriver);
    if (fStatus === 'otp_fail') d = d.filter((r) => r.otp === 'Late');
    else if (fStatus === 'otd_fail') d = d.filter((r) => r.otd === 'Late');
    else if (fStatus === 'any_fail') d = d.filter((r) => r.otp === 'Late' || r.otd === 'Late');
    else if (fStatus === 'pending') d = d.filter((r) => r.otp === 'Pending' || r.otd === 'Pending');
    else if (fStatus === 'clean') d = d.filter((r) => r.otp === 'On Time' && r.otd === 'On Time');
    const n = q.trim().toLowerCase();
    if (n) d = d.filter((r) => `${r.trip} ${r.driver} ${r.delDriver} ${r.ls} ${r.truck} ${r.customer}`.toLowerCase().includes(n));
    return d;
  }, [rows, fWeek, fDriver, fStatus, q]);

  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const fails = useMemo(() => topFailReasons(filtered), [filtered]);
  const groups = useMemo(() => lateGroups(filtered, groupBy), [filtered, groupBy]);

  function exportCsv() {
    const blob = new Blob([rowsToCsv(filtered)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `otp-otd-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const KPIS = [
    { label: 'OTP RATE', val: `${stats.otpPct.toFixed(1)}%`, color: targetColor(stats.otpPct, OTP_TARGET), sub: `${stats.otpOnTime}/${stats.otpScored} scored` },
    { label: 'OTD RATE', val: `${stats.otdPct.toFixed(1)}%`, color: targetColor(stats.otdPct, OTD_TARGET), sub: `${stats.otdOnTime}/${stats.otdScored} scored` },
    { label: 'LOADS', val: String(stats.total), color: 'var(--text)', sub: 'in view' },
    { label: 'LATE', val: String(stats.otpLate + stats.otdLate), color: stats.otpLate + stats.otdLate ? 'var(--red)' : 'var(--green)', sub: `${stats.otpLate} pickup · ${stats.otdLate} delivery` },
    { label: 'UNLOGGED', val: String(stats.otpPending + stats.otdPending), color: 'var(--amber)', sub: 'not counted either way' },
  ];

  return (
    <div className="am-page">
      <div className="am-head">
        <div>
          <h2>OTP / OTD</h2>
          <span className="am-muted">
            Targets: OTP ≥ {OTP_TARGET}% · OTD ≥ {OTD_TARGET}% · read live from milestones — nothing is keyed in here
          </span>
        </div>
        <button className="am-clear" onClick={() => setReportOpen((o) => !o)}>
          {reportOpen ? '× Close late-reason report' : '📊 Late Reasons report'}
        </button>
        <button className="am-clear" onClick={exportCsv}>⭳ Export CSV</button>
      </div>

      <div className="otp-kpis">
        {KPIS.map((k) => (
          <div key={k.label} className="otp-kpi">
            <div className="otp-kpi-label">{k.label}</div>
            <div className="otp-kpi-val" style={{ color: k.color }}>{k.val}</div>
            <div className="otp-kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="am-head" style={{ marginTop: 4 }}>
        <select className="am-input" style={{ maxWidth: 130 }} value={fWeek} onChange={(e) => setFWeek(e.target.value)}>
          <option value="all">All weeks</option>{weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
        </select>
        <select className="am-input" style={{ maxWidth: 190 }} value={fDriver} onChange={(e) => setFDriver(e.target.value)}>
          <option value="all">All drivers</option>{drivers.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="am-input" style={{ maxWidth: 150 }} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="all">All statuses</option><option value="any_fail">Any late</option>
          <option value="otp_fail">Late pickup</option><option value="otd_fail">Late delivery</option>
          <option value="pending">Unlogged</option><option value="clean">Clean</option>
        </select>
        <input className="am-input" style={{ maxWidth: 220 }} placeholder="Search trip / driver / LS / customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="am-muted">{filtered.length} shown</span>
      </div>

      {fails.length > 0 && (
        <div className="otp-reasons">
          <span className="am-muted">Top fail reasons:</span>
          {fails.map((f) => <span key={f.key} className="otp-reason">{f.key} <b>{f.count}</b></span>)}
        </div>
      )}

      {reportOpen && (
        <div className="otp-report">
          <div className="otp-report-head">
            <b>Late Reasons</b>
            <span className="am-muted">
              Every late pickup or delivery in the current filter, grouped. The reason text comes
              from the milestone the driver or dispatcher logged — it is not re-typed here.
            </span>
            <span className="otp-groupchips">
              {GROUPS.map((g) => (
                <button key={g.key} className={`am-billchip ${groupBy === g.key ? 'on ready_for_accounting' : ''}`}
                  onClick={() => setGroupBy(g.key)}>{g.label}</button>
              ))}
            </span>
          </div>
          {groups.length === 0
            ? <div className="am-muted">No late stops in this filter. Nothing to explain.</div>
            : (
              <table className="am-grid otp-table">
                <thead><tr><th>{GROUPS.find((g) => g.key === groupBy)?.label.replace('By ', '')}</th><th>Late</th><th>Pickup</th><th>Delivery</th><th>Share</th></tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.key}>
                      <td>{g.key}</td>
                      <td><b>{g.count}</b></td>
                      <td className="am-muted">{g.pickup}</td>
                      <td className="am-muted">{g.delivery}</td>
                      <td>
                        <span className="otp-bar"><span className="otp-bar-fill" style={{ width: `${Math.min(100, g.share)}%` }} /></span>
                        <span className="am-muted otp-share">{g.share.toFixed(0)}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      )}

      <div className="am-scroll">
        <table className="am-grid otp-table">
          <thead>
            <tr>
              <th>LS #</th><th>Trip</th><th>Truck</th><th>Driver</th><th>Load type</th>
              <th>OTP</th><th>OTD</th><th>Week</th><th>Late reason</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="am-muted" style={{ textAlign: 'center', padding: 18 }}>
                No loads match this filter. Rows appear here as soon as a load exists — the OTP and OTD
                columns fill in when its pickup and delivery milestones are logged.
              </td></tr>
            ) : filtered.map((r) => (
              <tr key={r.loadId} className={r.otp === 'Late' || r.otd === 'Late' ? 'otp-fail-row' : ''}>
                <td>{r.ls || '—'}</td>
                <td className="opt-route">{r.trip || '—'}{r.hasException && <span className="am-excbadge" title="Open exception on this load"> ⚠</span>}</td>
                <td>{r.truck ? `#${r.truck}` : '—'}</td>
                <td>
                  {r.driver || '—'}
                  {r.delDriver && r.delDriver !== r.driver && <span className="am-muted"> → {r.delDriver}</span>}
                </td>
                <td className="am-muted">{r.loadType || '—'}</td>
                <td>{flag(r.otp)}{r.puActual && <div className="otp-fr" title={`appointment ${r.puAppt || '—'}`}>{fmtActual(r.puActual)}</div>}</td>
                <td>{flag(r.otd)}{r.delActual && <div className="otp-fr" title={`appointment ${r.delAppt || '—'}`}>{fmtActual(r.delActual)}</div>}</td>
                <td>{r.week || '—'}</td>
                <td>
                  {/* both sides can be late for different reasons — show both */}
                  {r.otpLateReason && <div><b className="otp-reasoncell">PU: {r.otpLateReason}</b>{r.otpLateReasonDetail && <div className="otp-fr">{r.otpLateReasonDetail}</div>}</div>}
                  {r.otdLateReason && <div><b className="otp-reasoncell">DEL: {r.otdLateReason}</b>{r.otdLateReasonDetail && <div className="otp-fr">{r.otdLateReasonDetail}</div>}</div>}
                  {!r.otpLateReason && !r.otdLateReason && <span className="am-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
