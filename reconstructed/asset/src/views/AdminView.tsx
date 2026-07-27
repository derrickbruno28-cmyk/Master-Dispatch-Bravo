/* Hidden owner-only admin page — PHASE 10B.2.

   These are one-time migration tools with destructive reach. They used to sit on
   the Integrations page next to the map key, one mis-click from wiping the
   shared board. They still exist — sometimes you genuinely need them — but they
   now live somewhere you have to mean to go: there is no nav link, you reach
   this by putting #admin in the address bar, and each action makes you type its
   confirmation phrase before it will run.

   A confirmation dialog you can dismiss with the Enter key is not a safeguard.
   Typing the words is. */

import { useEffect, useMemo, useState } from 'react';
import { isOwner } from '../data/permStore';
import { firebaseEnabled } from '../firebase';
import { clearAllAssignments } from '../data/schedule';
import { resetFleetToBare } from '../data/fleetStore';
import { hasLocalData, localCounts, restoreLocalToShared } from '../data/recoverLocal';
import { stuckLoads, deleteLoad, STUCK_HELP } from '../data/tms/deleteLoad';
import { fmtMoney } from '../data/loadsStore';
import { onChange } from '../data/bus';

export default function AdminView() {
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState('');
  const [, force] = useState(0);
  const [confirmStuck, setConfirmStuck] = useState('');
  const [stuckMsg, setStuckMsg] = useState('');
  const counts = localCounts();

  useEffect(() => onChange(() => force((n) => n + 1)), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stuck = useMemo(() => stuckLoads(), [confirmStuck, stuckMsg]);

  if (!isOwner()) {
    return (
      <div className="am-page">
        <div className="am-head"><h2>Admin</h2></div>
        <div className="am-notice">This page is owner-only.</div>
      </div>
    );
  }

  async function doReset() {
    setResetting(true); setResetMsg('');
    const loads = await clearAllAssignments();
    const trucks = await resetFleetToBare();
    setResetting(false); setResetPhrase('');
    setResetMsg(`✓ Board reset — cleared ${loads} calendar load${loads === 1 ? '' : 's'} and restored ${trucks} bare trucks (tractor + make only). Refresh and the board will match a clean fleet.`);
  }

  async function doRestore() {
    setRestoring(true); setRestoreMsg('');
    const res = await restoreLocalToShared();
    setRestoring(false);
    setRestoreMsg(`✓ Restored ${res.drivers} driver${res.drivers === 1 ? '' : 's'} and ${res.fleet} truck${res.fleet === 1 ? '' : 's'} from this device to the shared roster.`);
  }

  return (
    <div className="am-page">
      <div className="am-head">
        <div>
          <h2>Admin <span className="am-muted" style={{ fontWeight: 400, fontSize: 13 }}>· hidden · owner only</span></h2>
          <span className="am-muted">
            One-time migration tools. Everything here changes the data the whole team sees, so each
            one asks you to type its phrase first.
          </span>
        </div>
      </div>

      {/* Loads nobody can reach from the board. This is the list that answers
          "there are loads I can't delete" — with WHY each one is unreachable,
          because a delete button without an explanation just moves the mystery. */}
      <div className="intg-card">
        <div className="intg-card-head">
          <div className="intg-card-title">
            📦 Loads that aren't on the board <span className="intg-card-sub">{stuck.length} found</span>
          </div>
        </div>
        <p className="am-muted" style={{ fontSize: 12.5, maxWidth: 820 }}>
          A load is only removable from a board cell, so one with <b>no truck</b>, <b>no date</b>, or a
          truck/date that no longer has a chip on the calendar has nowhere to be deleted from. They are
          all here. Deleting one removes its stops, milestones, documents and any board chips —
          <b> the notes and the audit trail are kept</b>, so there is always a record of what was
          removed, by whom, and what anyone had said about it.
        </p>
        {stuckMsg && <div className="am-notice" style={{ color: 'var(--green)', marginBottom: 8 }}>{stuckMsg}</div>}
        {stuck.length === 0
          ? <div className="am-muted">Nothing stuck — every load is reachable from the board.</div>
          : (
            <div className="am-scroll">
              <table className="am-grid pnl-loads">
                <thead><tr><th>Load</th><th>Date</th><th>Customer</th><th>Truck</th><th>Rate</th><th>Why it's stuck</th><th></th></tr></thead>
                <tbody>
                  {stuck.map((x) => (
                    <tr key={x.load.id}>
                      <td><b>{x.label}</b><div className="am-muted bill-sub">{x.load.id}</div></td>
                      <td className="am-muted">{x.load.date || '—'}</td>
                      <td className="am-muted">{x.load.customerName || '—'}</td>
                      <td className="am-muted">{x.load.assignedTruck ? `#${x.load.assignedTruck}` : '—'}</td>
                      <td className="am-muted">{fmtMoney(x.load.rate)}</td>
                      <td>
                        <b className="bill-blocked">{x.reason}</b>
                        <div className="am-muted bill-sub">{STUCK_HELP[x.reason]}</div>
                      </td>
                      <td className="fleet-actions">
                        {confirmStuck === x.load.id
                          ? <>
                              <span className="am-muted">Delete?</span>
                              <button className="fleet-del" onClick={() => void deleteLoad(x.load).then((r) => {
                                setConfirmStuck('');
                                setStuckMsg(r.ok ? `✓ Deleted ${x.label}.` : r.reason);
                              })}>✓</button>
                              <button className="am-clear" onClick={() => setConfirmStuck('')}>✕</button>
                            </>
                          : <button className="fleet-del" onClick={() => setConfirmStuck(x.load.id)}>🗑</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <div className="intg-card" style={{ borderColor: 'var(--red)' }}>
        <div className="intg-card-head">
          <div className="intg-card-title">🧹 Reset the board to a clean fleet</div>
        </div>
        <p className="am-muted" style={{ fontSize: 12.5, maxWidth: 760 }}>
          Wipes the <b>calendar</b> and restores every truck to a <b>bare profile</b> — tractor # and make only,
          no drivers, terminal, type or status. This is for fixing a live board that still shows leftover
          seed fillers or stuck loads. <b>It changes the shared data everyone sees, and it cannot be undone.</b>
        </p>
        <div className="admin-confirm">
          <span className="am-muted">Type <b>RESET THE BOARD</b> to enable:</span>
          <input className="am-input" style={{ maxWidth: 240 }} value={resetPhrase}
            onChange={(e) => setResetPhrase(e.target.value)} placeholder="RESET THE BOARD" />
          <button className="am-save" style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
            disabled={resetting || resetPhrase.trim().toUpperCase() !== 'RESET THE BOARD'}
            onClick={() => void doReset()}>{resetting ? 'Resetting…' : '⚠ Reset the board now'}</button>
        </div>
        {resetMsg && <div className="am-notice" style={{ color: 'var(--green)', marginTop: 8 }}>{resetMsg}</div>}
      </div>

      {firebaseEnabled && hasLocalData() && (
        <div className="intg-card" style={{ borderColor: 'var(--amber)' }}>
          <div className="intg-card-head">
            <div className="intg-card-title">🛟 Restore this device's data to the team</div>
          </div>
          <p className="am-muted" style={{ fontSize: 12.5, maxWidth: 760 }}>
            This device has <b>{counts.drivers} drivers</b> and <b>{counts.fleet} trucks</b> saved from before the app
            shared data across the team. Run this <b>on the device where those edits were made</b> to push them into
            the shared roster. It only adds and updates — it never deletes anyone.
          </p>
          <div className="am-lockbtns">
            <button className="am-save" disabled={restoring} onClick={() => void doRestore()}>
              {restoring ? 'Restoring…' : '🛟 Restore to shared roster'}
            </button>
          </div>
          {restoreMsg && <div className="am-notice" style={{ color: 'var(--green)', marginTop: 8 }}>{restoreMsg}</div>}
        </div>
      )}
    </div>
  );
}
