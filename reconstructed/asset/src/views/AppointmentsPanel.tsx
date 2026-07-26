/* Appointment windows — PHASE 3.

   The legacy stop carries ONE datetime, which is why At Risk was toothless: with
   only a single instant you can say "late" but not "about to be late". A real
   window has a close, and At Risk is "arriving within 60 minutes of that close".

   So this panel edits the WINDOW (start, end, confirmed) on the stops
   subcollection, alongside the legacy address editor above it. Milestones read
   the window straight from these documents — set an end here and the timing
   column on the Milestones tab immediately starts distinguishing At Risk from
   On Time.

   `apptConfirmed` is the "Confirmed" chip: it records that somebody actually got
   the appointment agreed with the facility, as opposed to it being the time the
   schedule assumes. Those are different claims and the board should say which. */

import { useEffect, useState } from 'react';
import type { Load } from '../data/loadsStore';
import { stopsFor, fetchStops, saveStops, stopLabel } from '../data/tms/stopsStore';
import type { LoadStopDoc } from '../data/tms/types';

export default function AppointmentsPanel({ load }: { load: Load }) {
  const [stops, setStops] = useState<LoadStopDoc[]>(() => stopsFor(load));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchStops(load.id).then(() => { if (alive) setStops(stopsFor(load)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.id]);

  function patch(i: number, p: Partial<LoadStopDoc>) {
    setStops((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)));
    setDirty(true); setMsg('');
  }

  async function save() {
    setBusy(true); setMsg('');
    try {
      const saved = await saveStops(load.id, stops);
      setStops(saved); setDirty(false);
      setMsg(`✓ ${saved.length} appointment${saved.length === 1 ? '' : 's'} saved — the Milestones tab now judges timing against these windows.`);
    } catch (e) {
      setMsg(`Couldn't save — ${(e as Error).message}`);
    }
    setBusy(false);
  }

  if (stops.length === 0) return null;

  return (
    <div className="appt-panel">
      <div className="appt-head">
        <b>🕐 Appointment windows</b>
        <span className="am-muted">
          The window CLOSE is what At Risk is measured against — a stop with only a start time can be
          judged late, but never "about to be late". Confirmed means the facility actually agreed to it.
        </span>
      </div>

      <div className="appt-scroll">
        <table className="am-grid appt-table">
          <thead>
            <tr><th>Stop</th><th>Date</th><th>Window opens</th><th>Window closes</th><th>Confirmed</th><th>Action</th></tr>
          </thead>
          <tbody>
            {stops.map((s, i) => (
              <tr key={s.id}>
                <td>
                  <span className={`trip-stop-type ${s.type === 'Pickup' ? 'pu' : 'del'}`}>{s.type}</span>{' '}
                  {stopLabel(s)}
                </td>
                <td><input className="am-input appt-in" type="date" value={s.apptDate} onChange={(e) => patch(i, { apptDate: e.target.value })} /></td>
                <td><input className="am-input appt-in" type="time" value={s.apptWindowStart} onChange={(e) => patch(i, { apptWindowStart: e.target.value })} /></td>
                <td>
                  <input className="am-input appt-in" type="time" value={s.apptWindowEnd} onChange={(e) => patch(i, { apptWindowEnd: e.target.value })} />
                  {!s.apptWindowEnd && <div className="am-muted appt-hint">no close — At Risk can't fire</div>}
                </td>
                <td>
                  <label className="load-inc">
                    <input type="checkbox" checked={s.apptConfirmed} onChange={(e) => patch(i, { apptConfirmed: e.target.checked })} />
                    {s.apptConfirmed ? <span className="appt-confirmed">Confirmed</span> : <span className="am-muted">assumed</span>}
                  </label>
                </td>
                <td>
                  <select className="am-input appt-in" value={s.stopAction}
                    onChange={(e) => patch(i, { stopAction: e.target.value as LoadStopDoc['stopAction'] })}>
                    <option value="">— not set —</option>
                    <option>Live Load</option><option>Hook Trailer</option>
                    <option>Drop Trailer</option><option>Live Unload</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="appt-actions">
        <button className="am-save" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : dirty ? 'Save appointments' : 'Saved'}
        </button>
        {msg && <span className="am-muted">{msg}</span>}
      </div>
    </div>
  );
}
