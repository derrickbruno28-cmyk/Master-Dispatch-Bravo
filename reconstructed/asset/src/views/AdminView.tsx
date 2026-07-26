/* Hidden owner-only admin page — PHASE 10B.2.

   These are one-time migration tools with destructive reach. They used to sit on
   the Integrations page next to the map key, one mis-click from wiping the
   shared board. They still exist — sometimes you genuinely need them — but they
   now live somewhere you have to mean to go: there is no nav link, you reach
   this by putting #admin in the address bar, and each action makes you type its
   confirmation phrase before it will run.

   A confirmation dialog you can dismiss with the Enter key is not a safeguard.
   Typing the words is. */

import { useState } from 'react';
import { isOwner } from '../data/permStore';
import { firebaseEnabled } from '../firebase';
import { clearAllAssignments } from '../data/schedule';
import { resetFleetToBare } from '../data/fleetStore';
import { hasLocalData, localCounts, restoreLocalToShared } from '../data/recoverLocal';

export default function AdminView() {
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState('');
  const counts = localCounts();

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
