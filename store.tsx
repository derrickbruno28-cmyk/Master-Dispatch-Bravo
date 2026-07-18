import { useState } from 'react';
import { useStore } from '../data/store';
import { isoToday } from '../dates';
import { laneDepartsNextDay, DEFAULT_SECTION, EQUIPMENT_OPTIONS, type Lane } from '../types';

interface Props {
  lane: Lane | null; // null = create new
  section?: string;
  onClose: () => void;
}

const SECTIONS = [
  DEFAULT_SECTION,
  'UMT Global',
  'Overflow / Extras',
  'USPS Freight Auction',
  'Empty Trailer Moves',
];

export default function LaneEditor({ lane, section, onClose }: Props) {
  const { updateLane, addLane, removeLane, loads, carriers } = useStore();
  const hasLoads = !!lane && loads.some((l) => l.laneId === lane.id);
  const [form, setForm] = useState({
    origin: lane?.origin ?? '',
    destination: lane?.destination ?? '',
    via: lane?.via?.join(', ') ?? '',
    tripCode: lane?.tripCode ?? '',
    tripLabel: lane?.tripLabel ?? '',
    section: lane?.section ?? section ?? DEFAULT_SECTION,
    frequency: lane?.frequency ?? '',
    planning: lane?.planning ?? 'PRELOAD',
    miles: lane?.miles ?? '',
    arrivalTime: lane?.arrivalTime ?? '',
    departureTime: lane?.departureTime ?? '',
    delTime: lane?.delTime ?? '',
    weekendRate: lane?.weekendRate ?? '',
    weekdayRate: lane?.weekdayRate ?? '',
    defaultEquipment: lane?.defaultEquipment ?? EQUIPMENT_OPTIONS[0],
    dedicatedCarrier: lane?.dedicatedCarrier ?? '',
    dedicatedRate: lane?.dedicatedRate ?? '',
    dedicatedNotes: lane?.dedicatedNotes ?? '',
    dedicatedStart: lane?.dedicatedStart ?? '',
  });
  const [dedicated, setDedicated] = useState(lane?.dedicated ?? false);
  const [soloApproved, setSoloApproved] = useState(lane?.soloApproved ?? false);
  const [freqNextDay, setFreqNextDay] = useState(lane ? laneDepartsNextDay(lane) : false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const via = form.via.split(',').map((s) => s.trim()).filter(Boolean);
    const name = [form.origin, ...via, form.destination].filter(Boolean).join(' - ')
      + (form.tripCode ? ` ${form.tripCode}` : '');
    if (lane) {
      await updateLane(lane.id, { ...form, via, name, dedicated, soloApproved, freqNextDay });
    } else {
      await addLane({
        ...form,
        via,
        name,
        dedicated,
        soloApproved,
        freqNextDay,
        targetRates: '',
        active: true,
      });
    }
    onClose();
  }

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor editor-wide" onClick={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <div className="editor-lane">{lane ? 'Edit Lane' : 'Add Lane'}</div>
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="form-grid">
          <label>Origin<input value={form.origin} onChange={set('origin')} placeholder="Memphis, TN RPDC" /></label>
          <label>Destination<input value={form.destination} onChange={set('destination')} placeholder="Tampa, FL" /></label>
          <label>Via stops (comma-sep)<input value={form.via} onChange={set('via')} placeholder="Little Rock, AR" /></label>
          <label>Trip #<input value={form.tripCode} onChange={set('tripCode')} placeholder="FA2D3-347" /></label>
          <label>Trip label<input value={form.tripLabel} onChange={set('tripLabel')} placeholder="Trip A / Trip B" /></label>
          <label>Section
            <select value={form.section} onChange={set('section')}>
              {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Planning<input value={form.planning} onChange={set('planning')} placeholder="PRELOAD / Live" /></label>
          <label>Arrival time<input value={form.arrivalTime} onChange={set('arrivalTime')} placeholder="02:30" /></label>
          <label>Departure time<input value={form.departureTime} onChange={set('departureTime')} placeholder="03:00" /></label>
          <label>Delivery time<input value={form.delTime} onChange={set('delTime')} /></label>
          <label>Miles<input value={form.miles} onChange={set('miles')} /></label>
          {/* Phase 3: rate bands moved to the Integrity DB — no inline lane edits */}
          <label className="grid-span">Rate bands
            <a className="btn-ghost" href={`#/integrity?trip=${encodeURIComponent(lane?.tripCode ?? '')}`}>
              Edit target / ceiling in Integrity →
            </a>
          </label>
          <label>Frequency<input value={form.frequency} onChange={set('frequency')} placeholder="Daily except Mondays" /></label>
          <label>Default equipment
            <select value={form.defaultEquipment} onChange={set('defaultEquipment')}>
              {EQUIPMENT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        </div>

        <div className="dedicated-fieldset">
          <label className="check-row">
            <input
              type="checkbox"
              checked={soloApproved}
              onChange={(e) => setSoloApproved(e.target.checked)}
            />
            <span>Solo approved (500+ mi route allowed to run solo — drives auto Solo/Team)</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={freqNextDay}
              onChange={(e) => setFreqNextDay(e.target.checked)}
            />
            <span>Departs after midnight — the frequency code counts the DEPARTURE day, so
              expected/missing flags shift one day earlier (auto-detected from the times; this pins it)</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={dedicated}
              onChange={(e) => setDedicated(e.target.checked)}
            />
            <span>Dedicated lane</span>
          </label>
          {dedicated && (
            <div className="form-grid">
              <label>Dedicated carrier
                {/* database dropdown (Caleb 07/14) — exact names keep the
                    Dedicated section, SEND TO cells and reconcile in sync */}
                <select value={form.dedicatedCarrier} onChange={set('dedicatedCarrier')}>
                  <option value="">— pick from the carrier database —</option>
                  {form.dedicatedCarrier && !carriers.some((c) => c.name === form.dedicatedCarrier) && (
                    <option value={form.dedicatedCarrier}>{form.dedicatedCarrier} (not in DB)</option>
                  )}
                  {[...carriers].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                    <option key={c.id} value={c.name} disabled={c.dnu}>{c.name}{c.dnu ? ' — 🚫 DNU' : ''}</option>
                  ))}
                </select>
              </label>
              <label>Dedication start date
                <input type="date" value={form.dedicatedStart} onChange={set('dedicatedStart')} title="The lane runs fully open until this date; SEND TO starts here. Blank = already live." />
              </label>
              <label>Dedicated rate
                <input value={form.dedicatedRate} onChange={set('dedicatedRate')} placeholder="$4050" />
              </label>
              <label className="grid-span">Dedicated notes
                <input value={form.dedicatedNotes} onChange={set('dedicatedNotes')} placeholder="Tue–Sun only, no chargebacks…" />
              </label>
            </div>
          )}
        </div>

        <div className="editor-actions">
          {lane && lane.retiredOn && (
            <button
              className="btn-ghost"
              title={`Retired ${lane.retiredOn} — restore to future weeks`}
              onClick={async () => { await updateLane(lane.id, { retiredOn: '' }); onClose(); }}
            >
              ↩ Restore lane
            </button>
          )}
          {lane && !lane.retiredOn && (
            confirmDelete ? (
              <button
                className="btn-danger"
                title={hasLoads
                  ? 'Past weeks keep the row and every load — it only disappears from the NEXT week forward'
                  : 'No loads exist on this lane — it will be removed entirely'}
                onClick={async () => {
                  /* Caleb 07/12: NEVER delete across the full board. A lane
                     with history is RETIRED (hidden from next week forward);
                     only a never-used lane is truly removed. */
                  if (hasLoads) await updateLane(lane.id, { retiredOn: isoToday() });
                  else await removeLane(lane.id);
                  onClose();
                }}
              >
                {hasLoads ? 'Confirm retire (next week forward)' : 'Confirm remove'}
              </button>
            ) : (
              <button className="btn-ghost btn-danger-ghost" onClick={() => setConfirmDelete(true)}>
                {hasLoads ? 'Retire lane…' : 'Remove lane'}
              </button>
            )
          )}
          <span className="spacer" />
          <button className="btn-primary" onClick={save}>Save</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
