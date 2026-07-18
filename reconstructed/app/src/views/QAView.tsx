import { useMemo } from 'react';
import { useStore } from '../data/store';
import { fmtStamp, addDays, todayCentral } from '../dates';
import { laneCompactName } from '../types';
import { can } from '../permissions';

/* §9.1 QA queue: every covered load awaits the QA Manager's "BOL verified"
   approval — the same alert/badge pattern as approve-booking, but routed to
   the QA Manager (deliberately NOT admin-tier; the check stays independent).
   Scope: recent + upcoming loads (date ≥ 7 days back) so day one doesn't
   surface months of history. */

export const QA_WINDOW_DAYS_BACK = 7;

export default function QAView() {
  const { loads, lanes, currentUser, approveBol } = useStore();
  const laneMap = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);

  if (!can(currentUser, 'qa')) {
    return <div className="page"><p className="muted">QA Manager access required.</p></div>;
  }

  const cutoff = addDays(todayCentral(), -QA_WINDOW_DAYS_BACK);
  const queue = loads
    .filter((l) => !!l.carrier && !l.bolVerified && l.date >= cutoff
      && !['not_running', 'chargeback'].includes(l.status))
    .sort((a, b) => a.date.localeCompare(b.date));
  const done = loads
    .filter((l) => l.bolVerified && l.date >= cutoff)
    .sort((a, b) => (b.bolVerifiedAt ?? '').localeCompare(a.bolVerifiedAt ?? ''));

  return (
    <div className="page">
      <div className="page-head">
        <h2>QA — BOL Verification</h2>
        <span className="muted">
          Covered loads awaiting "BOL verified" · loads enter the LC Cover Report only once
          Loaded/Departed AND verified here · showing {QA_WINDOW_DAYS_BACK} days back + upcoming
        </span>
      </div>

      <section>
        <h3>Awaiting verification <span className="muted">({queue.length})</span></h3>
        {queue.length === 0 ? (
          <p className="muted">Queue clear. ✓</p>
        ) : (
          <table className="list-table table-dense">
            <thead>
              <tr><th>Date</th><th>Trip #</th><th>LS#</th><th>Lane</th><th>Carrier</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {queue.map((l) => {
                const lane = laneMap.get(l.laneId);
                return (
                  <tr key={l.id}>
                    <td>{Number(l.date.slice(5, 7))}/{Number(l.date.slice(8, 10))}</td>
                    <td>{lane?.tripCode.replace(/^FA2D3-/i, '') ?? '—'}</td>
                    <td className="strong">{l.loadNumber || '—'}</td>
                    <td className="wrap">{lane ? laneCompactName(lane) : l.laneId}</td>
                    <td className="strong wrap">{l.carrier}</td>
                    <td>{l.status.replace(/_/g, ' ')}</td>
                    <td>
                      <button className="btn-approve" onClick={() => approveBol(l.id)}>✓ BOL verified</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3>Verified <span className="muted">(last {QA_WINDOW_DAYS_BACK} days · {done.length})</span></h3>
        {done.length === 0 ? (
          <p className="muted">Nothing verified yet.</p>
        ) : (
          <table className="list-table table-dense">
            <thead>
              <tr><th>Date</th><th>LS#</th><th>Lane</th><th>Carrier</th><th>Verified by</th></tr>
            </thead>
            <tbody>
              {done.slice(0, 100).map((l) => {
                const lane = laneMap.get(l.laneId);
                return (
                  <tr key={l.id}>
                    <td>{Number(l.date.slice(5, 7))}/{Number(l.date.slice(8, 10))}</td>
                    <td>{l.loadNumber || '—'}</td>
                    <td className="wrap">{lane ? laneCompactName(lane) : l.laneId}</td>
                    <td className="wrap">{l.carrier}</td>
                    <td className="muted">
                      {l.bolVerifiedBy}
                      {l.bolVerifiedAt && ` · ${fmtStamp(l.bolVerifiedAt)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
