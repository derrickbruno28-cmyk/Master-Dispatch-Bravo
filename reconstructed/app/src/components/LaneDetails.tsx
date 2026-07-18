import { useState } from 'react';
import { useStore } from '../data/store';
import { cleanTimes } from '../dates';
import { can } from '../permissions';
import { freqDescription, autoTeamSolo, expectedWeekdays, laneShortName, type Lane } from '../types';

interface Props {
  lane: Lane;
  onClose: () => void;
  onEdit: () => void; // opens LaneEditor (pricing tier)
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function LaneDetails({ lane, onClose, onEdit }: Props) {
  const { currentUser, patchLane } = useStore();
  const laneEditor = can(currentUser, 'integrity.lanes');
  /* future service changes (Caleb 07/14): admins / pricing / FedCom / QA */
  const maySvc = can(currentUser, 'matrix.serviceNotes');
  const [svcDraft, setSvcDraft] = useState(lane.serviceNotes ?? '');
  const days = expectedWeekdays(lane.frequency);

  const rows: Array<[string, string]> = [
    ['Trip #', lane.tripCode || '—'],
    ['Trip label', lane.tripLabel || '—'],
    ['Section', lane.section],
    ['Planning', lane.planning.split('\n')[0] || '—'],
    ['Frequency', freqDescription(lane)],
    ['Runs on', days ? days.map((d) => DAY_ABBR[d]).join(', ') : 'Not derivable from frequency'],
    ['Arrival', cleanTimes(lane.arrivalTime) || '—'],
    ['Departure', cleanTimes(lane.departureTime) || '—'],
    ['Delivery', cleanTimes(lane.delTime.replace(/\n/g, ' · ')) || '—'],
    ['Miles', lane.miles.split('\n')[0] || '—'],
    ['Auto Solo/Team', `${autoTeamSolo(lane) || '—'}${lane.soloApproved ? ' (solo approved)' : ''}`],
    ['Weekend rate', lane.weekendRate || '—'],
    ['Weekday rate', lane.weekdayRate || '—'],
    ['Default equipment', lane.defaultEquipment],
  ];

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor" onClick={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <div>
            <div className="editor-lane">{laneShortName(lane)}</div>
            <div className="editor-sub">Lane details</div>
          </div>
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={`svc-card ${lane.serviceNotes ? 'has-svc' : ''}`}>
          <div className="svc-title">⚠ Future service changes</div>
          {maySvc ? (
            <textarea
              rows={2}
              value={svcDraft}
              placeholder="e.g. Effective 8/1 PU moves to 04:30; trip drops Sundays…"
              onChange={(e) => setSvcDraft(e.target.value)}
              onBlur={() => {
                if (svcDraft.trim() !== (lane.serviceNotes ?? '').trim()) {
                  void patchLane(lane.id, { serviceNotes: svcDraft.trim() });
                }
              }}
            />
          ) : (
            <div className={lane.serviceNotes ? '' : 'muted'}>{lane.serviceNotes || 'None noted.'}</div>
          )}
        </div>

        <div className={`dedicated-card ${lane.dedicated ? 'is-dedicated' : ''}`}>
          {lane.dedicated ? (
            <>
              <div className="dedicated-title">● DEDICATED</div>
              <div><b>{lane.dedicatedCarrier || 'Carrier TBD'}</b>{lane.dedicatedRate && <span> @ {lane.dedicatedRate}</span>}</div>
              {lane.dedicatedNotes && lane.dedicatedNotes !== lane.dedicatedCarrier && (
                <div className="dedicated-note">{lane.dedicatedNotes}</div>
              )}
            </>
          ) : (
            <div className="muted">
              Not dedicated{/open to dedicate/i.test(lane.dedicatedNotes ?? '') && ' — open to dedicate'}
            </div>
          )}
        </div>

        <table className="detail-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="detail-key">{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="editor-actions">
          {laneEditor && <button className="btn-ghost" onClick={onEdit}>Edit lane</button>}
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
