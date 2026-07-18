import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../data/store';
import { buildCityStateMap, publicCity } from '../board';
import { addDays, cleanTimes, finalDelTime, fmtStamp, todayCentral } from '../dates';
import { facilityId, laneCompactName, laneMiles, type Facility, type Lane, type Load } from '../types';
import { can } from '../permissions';

/* T&T Phase 1 (Caleb 07/11) — the Track & Trace workstation, tabbed like
   Admin: TRACK (pre-departure board w/ site/date/OTR filters, uncovered
   toggle, on-site marks, email flags, Defcon), EN ROUTE (departed loads w/
   55mph ETA off the departure mark, PPWK + Delivered), FACILITIES (contact
   directory — the CT spreadsheet, retired). No GPS anywhere: scheduled times
   + your marks are the truth. */

const CONFIRMED = new Set([
  'covered', 'booked_rc_pending', 'rc_signed', 'gtg', 'need_flyer', 'flyer_sent', 'drivers_confirmed', 'dispatched', 'asset',
]);

const HOUR = 3600_000;
const AVG_MPH = 55;

export default function TrackView() {
  const { loads, lanes, updateLoad, currentUser, statuses, facilities, saveFacility } = useStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'track' | 'enroute' | 'facilities'>('track');
  const [bucket, setBucket] = useState<'current' | 'older'>('current');
  const [siteFilter, setSiteFilter] = useState('');
  const [dayFilter, setDayFilter] = useState(''); // '' = whole window
  const [otrOnly, setOtrOnly] = useState(false); // 500+ mi
  const [showUncovered, setShowUncovered] = useState(false);
  /* mass selection (Think Tank 07/15): tick rows → one bulk Loaded/Departed */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const laneMap = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);
  const cityState = useMemo(() => buildCityStateMap(lanes), [lanes]);
  const booker = can(currentUser, 'track.mark');
  const statusLabel = (k: string) => statuses.find((st) => st.key === k)?.label ?? k.replace(/_/g, ' ');

  const puOf = (lane: Lane | undefined) =>
    /\d{2}:\d{2}/.exec(cleanTimes(((lane?.arrivalTime || lane?.departureTime) ?? '').split('\n')[0]))?.[0] ?? '23:59';

  const today = todayCentral();
  const tomorrow = addDays(today, 1);
  const nowStamp = `${today}T${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date())}`;

  /* ---------- TRACK tab rows: pre-departure, incl. optional uncovered ---------- */
  const rows = useMemo(
    () =>
      loads
        .filter((l) =>
          l.date <= tomorrow
          && ((!!l.carrier && CONFIRMED.has(l.status))
            || (showUncovered && !l.carrier && !['not_running', 'omitted', 'departed'].includes(l.status) && l.date >= addDays(today, -1))))
        .map((l) => {
          const lane = laneMap.get(l.laneId);
          const pu = `${l.date}T${puOf(lane)}`;
          return { load: l, lane, pu, overdue: pu < nowStamp };
        })
        .filter((r) => r.lane && !r.lane.isGroupHeader)
        .sort((a, b) => Number(b.load.defcon ?? false) - Number(a.load.defcon ?? false) || a.pu.localeCompare(b.pu)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loads, laneMap, showUncovered],
  );

  const siteOf = (laneId: string) => publicCity(laneMap.get(laneId)?.origin ?? '', cityState);
  const facilityOf = (laneId: string) => (laneMap.get(laneId)?.origin ?? '').split('\n')[0].trim();

  const cutoff24 = `${addDays(today, -1)}T${nowStamp.split('T')[1]}`;
  const current = rows.filter((r) => r.pu >= cutoff24);
  const older = rows.filter((r) => r.pu < cutoff24);
  const bucketRows = bucket === 'current' ? current : older;

  const sites = useMemo(
    () => [...new Set(bucketRows.map((r) => siteOf(r.load.laneId)))].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bucketRows],
  );
  const days = useMemo(() => [...new Set(bucketRows.map((r) => r.load.date))].sort(), [bucketRows]);

  const shown = bucketRows
    .filter((r) => !siteFilter || siteOf(r.load.laneId) === siteFilter)
    .filter((r) => !dayFilter || r.load.date === dayFilter)
    .filter((r) => !otrOnly || (laneMiles(r.lane!) ?? 0) >= 500);
  const overdue = current.filter((r) => r.overdue);

  /* email-needed auto-flag: >1h past scheduled PU and still not departed,
     or a manual next-email timer that has come due. Central-clock string
     math (same format as pu/nowStamp). */
  const hourAgo = (() => {
    const [d, t] = nowStamp.split('T');
    const h = Number(t.slice(0, 2));
    return h >= 1 ? `${d}T${String(h - 1).padStart(2, '0')}${t.slice(2)}` : `${addDays(d, -1)}T23${t.slice(2)}`;
  })();
  function emailDue(load: Load, pu: string): boolean {
    const manual = !!load.nextEmailAt && new Date(load.nextEmailAt).getTime() <= Date.now();
    return manual || (pu < hourAgo && !!load.carrier);
  }

  /* ---------- EN ROUTE tab rows: departed, not yet delivered ---------- */
  const enroute = useMemo(
    () =>
      loads
        .filter((l) => l.status === 'departed' && !l.deliveredAt && l.date >= addDays(today, -3) && l.date <= tomorrow)
        .map((l) => {
          const lane = laneMap.get(l.laneId);
          const miles = lane ? laneMiles(lane) : null;
          /* the 55mph estimate counts from the DEPARTED mark — no GPS */
          const eta = l.departedAt && miles != null
            ? new Date(new Date(l.departedAt).getTime() + (miles / AVG_MPH) * HOUR)
            : null;
          const delSched = lane ? finalDelTime(lane.delTime ?? '') : '';
          const lateDel = !!delSched && `${l.date}T${delSched}` < nowStamp;
          return { load: l, lane, eta, delSched, lateDel };
        })
        .filter((r) => r.lane && !r.lane.isGroupHeader)
        .sort((a, b) =>
          Number(b.load.defcon ?? false) - Number(a.load.defcon ?? false)
          || (a.eta?.getTime() ?? Infinity) - (b.eta?.getTime() ?? Infinity)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loads, laneMap],
  );

  const defconCount = rows.filter((r) => r.load.defcon).length + enroute.filter((r) => r.load.defcon).length;

  function confirmStamp(load: Load, field: 'onSiteAt' | 'ppwkAt' | 'deliveredAt', label: string) {
    const cur = load[field];
    if (cur) {
      if (window.confirm(`Remove the ${label} mark (${fmtStamp(cur)})?`)) void updateLoad(load.id, { [field]: '' });
      return;
    }
    void updateLoad(load.id, { [field]: new Date().toISOString() });
  }

  function markDeparted(load: Load) {
    if (!window.confirm(`Confirm load ${load.loadNumber || load.id} has picked up and departed?`)) return;
    void updateLoad(load.id, { status: 'departed' });
  }

  function setNextEmail(load: Load) {
    const h = window.prompt('Hours until the next required facility email (blank clears the timer):', '2');
    if (h == null) return;
    const n = Number(h);
    if (!h.trim() || !Number.isFinite(n) || n <= 0) { void updateLoad(load.id, { nextEmailAt: '' }); return; }
    void updateLoad(load.id, { nextEmailAt: new Date(Date.now() + n * HOUR).toISOString() });
  }

  const defconBtn = (load: Load) => (
    <button
      className={`btn-ghost btn-sm ${load.defcon ? 'btn-defcon-on' : ''}`}
      title={load.defcon ? 'DEFCON — click to stand down' : 'Mark DEFCON — pins the load red at the top for emphasis'}
      onClick={() => void updateLoad(load.id, { defcon: !load.defcon })}
    >
      🚨
    </button>
  );

  const loadLink = (load: Load) => (
    <button className="load-link" title="Open in Matrix" onClick={() => navigate(`/matrix?load=${encodeURIComponent(load.id)}`)}>
      {load.loadNumber || '—'}
    </button>
  );

  const fmtPu = (pu: string) => `${Number(pu.slice(5, 7))}/${Number(pu.slice(8, 10))} ${pu.slice(11)}`;

  return (
    <div className="page">
      <div className="page-head">
        <h2>Track &amp; Trace</h2>
        <button className={`chip ${tab === 'track' ? 'chip-on' : ''}`} onClick={() => setTab('track')}>
          Track ({current.length})
        </button>
        <button className={`chip ${tab === 'enroute' ? 'chip-on' : ''}`} onClick={() => setTab('enroute')}>
          En Route ({enroute.length})
        </button>
        <button className={`chip ${tab === 'facilities' ? 'chip-on' : ''}`} onClick={() => setTab('facilities')}>
          Facilities
        </button>
        {defconCount > 0 && <span className="exposed-count">🚨 {defconCount} DEFCON</span>}
      </div>

      {tab === 'track' && (
        <>
          <div className="track-filters">
            <button className={`chip ${bucket === 'current' ? 'chip-on' : ''}`} onClick={() => setBucket('current')}>
              Current ({current.length})
            </button>
            <button className={`chip ${bucket === 'older' ? 'chip-on' : ''}`} onClick={() => setBucket('older')}>
              Older than 24h ({older.length})
            </button>
            <select className="inline-select" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} title="Pickup site — carve out your section">
              <option value="">All pickup sites</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="inline-select" value={dayFilter} onChange={(e) => setDayFilter(e.target.value)} title="Pickup date">
              <option value="">All dates</option>
              {days.map((d) => <option key={d} value={d}>{Number(d.slice(5, 7))}/{Number(d.slice(8, 10))}</option>)}
            </select>
            <label className="chip-check"><input type="checkbox" checked={otrOnly} onChange={(e) => setOtrOnly(e.target.checked)} /> OTR (500+ mi)</label>
            <label className="chip-check"><input type="checkbox" checked={showUncovered} onChange={(e) => setShowUncovered(e.target.checked)} /> Show uncovered trips</label>
            {overdue.length > 0 && bucket === 'current' && (
              <span className="exposed-count">{overdue.length} past pickup</span>
            )}
            {selected.size > 0 && (
              <button
                className="btn-approve"
                onClick={() => {
                  if (!window.confirm(`Mark ${selected.size} selected load(s) as Loaded/Departed?`)) return;
                  for (const id of selected) void updateLoad(id, { status: 'departed' });
                  setSelected(new Set());
                }}
              >
                ✓ Mark {selected.size} selected Loaded / Departed
              </button>
            )}
            {bucket === 'older' && currentUser.role === 'owner' && older.length > 0 && (
              <button
                className="btn-ghost"
                onClick={() => {
                  if (!window.confirm(`Mark ALL ${older.length} stale trips as Loaded/Departed? This updates the Matrix for every one of them.`)) return;
                  for (const r of older) void updateLoad(r.load.id, { status: 'departed' });
                }}
              >
                ✓ Clear all ({older.length})
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="muted">Nothing to trace for these filters. ✓</p>
          ) : (
            <table className="list-table track-table table-dense">
              <thead>
                <tr>
                  <th>PU (sched)</th><th>Trip #</th><th>Facility</th><th>LS#</th><th>Lane</th><th>Carrier</th>
                  <th>Status</th><th>On-site</th><th>✉</th><th></th>
                  <th title="Select rows, then bulk-mark Loaded/Departed">
                    <input
                      type="checkbox"
                      checked={shown.length > 0 && shown.every((r) => !r.load.carrier || selected.has(r.load.id))}
                      onChange={(e) => setSelected(e.target.checked
                        ? new Set(shown.filter((r) => !!r.load.carrier).map((r) => r.load.id))
                        : new Set())}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ load, lane, overdue: late, pu }) => (
                  <tr key={load.id} className={load.defcon ? 'row-defcon' : late && bucket === 'current' ? 'row-overdue' : ''}>
                    <td className="strong">{late && bucket === 'current' && !load.defcon && '⏰ '}{fmtPu(pu)}</td>
                    <td>{lane!.tripCode.replace(/^FA2D3-/i, '')}</td>
                    <td className="wrap muted">{facilityOf(load.laneId)}</td>
                    <td>{loadLink(load)}</td>
                    <td className="wrap">
                      {laneCompactName(lane!)}
                      {load.isShuttle && <span className="hub-shuttle"> ⇄</span>}
                    </td>
                    <td className="strong wrap">
                      {load.carrier || <span className="hub-cb">EXPOSED</span>}
                      {load.truckNumber && <span className="muted"> · TRK {load.truckNumber}</span>}
                    </td>
                    <td>{statusLabel(load.status)}</td>
                    <td>
                      {booker && load.carrier ? (
                        <button
                          className={`btn-ghost btn-sm ${load.onSiteAt ? 'mark-on' : ''}`}
                          title={load.onSiteAt ? `On-site ${fmtStamp(load.onSiteAt)} — click to remove` : 'Mark truck on-site at the shipper'}
                          onClick={() => confirmStamp(load, 'onSiteAt', 'on-site')}
                        >
                          {load.onSiteAt ? `🏭 ${fmtStamp(load.onSiteAt).split(' ')[1]}` : '🏭'}
                        </button>
                      ) : load.onSiteAt ? fmtStamp(load.onSiteAt) : '—'}
                    </td>
                    <td className="track-email">
                      {emailDue(load, pu) && <span title="Facility email due (late vs schedule, or the manual timer fired)">📧</span>}
                      {booker && (
                        <button
                          className="btn-ghost btn-sm"
                          title={load.nextEmailAt ? `Next email ${fmtStamp(load.nextEmailAt)} — click to change/clear` : 'Set the next required email timer'}
                          onClick={() => setNextEmail(load)}
                        >
                          ✉{load.nextEmailAt ? ` ${fmtStamp(load.nextEmailAt).split(' ')[1]}` : ''}
                        </button>
                      )}
                    </td>
                    <td>
                      {booker && (
                        <div className="track-actions">
                          {load.carrier && (
                            <button className="btn-approve" onClick={() => markDeparted(load)}>
                              ✓ Loaded / Departed
                            </button>
                          )}
                          {load.isShuttle && load.shuttleLegStatus !== 'departed' && load.carrier && (
                            <button
                              className="btn-ghost btn-sm"
                              onClick={() => {
                                if (!window.confirm(`Confirm the swap is complete and leg 2 of ${load.loadNumber || load.id} is en route?`)) return;
                                void updateLoad(load.id, { shuttleLegStatus: 'departed' });
                              }}
                            >
                              ⇄ Swap Complete / En Route
                            </button>
                          )}
                          {defconBtn(load)}
                        </div>
                      )}
                    </td>
                    <td>
                      {booker && load.carrier && (
                        <input
                          type="checkbox"
                          checked={selected.has(load.id)}
                          onChange={() => toggleSel(load.id)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === 'enroute' && (
        <>
          <p className="muted">
            Departed, not yet delivered · ETA = departure mark + miles ÷ {AVG_MPH} mph (no GPS — the mark is the clock) ·
            📧 = past scheduled final del
          </p>
          {enroute.length === 0 ? (
            <p className="muted">Nothing en route. ✓</p>
          ) : (
            <table className="list-table track-table table-dense">
              <thead>
                <tr>
                  <th>Departed</th><th>Trip #</th><th>LS#</th><th>Lane</th><th>Carrier</th>
                  <th>Sched del</th><th>ETA (55mph)</th><th>PPWK</th><th></th>
                </tr>
              </thead>
              <tbody>
                {enroute.map(({ load, lane, eta, delSched, lateDel }) => (
                  <tr key={load.id} className={load.defcon ? 'row-defcon' : lateDel ? 'row-overdue' : ''}>
                    <td>{load.departedAt ? fmtStamp(load.departedAt) : '—'}</td>
                    <td>{lane!.tripCode.replace(/^FA2D3-/i, '')}</td>
                    <td>{loadLink(load)}</td>
                    <td className="wrap">{laneCompactName(lane!)}</td>
                    <td className="strong wrap">{load.carrier}</td>
                    <td>{lateDel && '📧 '}{delSched || '—'}</td>
                    <td className="strong">{eta ? fmtStamp(eta.toISOString()) : '—'}</td>
                    <td>
                      {booker ? (
                        <button
                          className={`btn-ghost btn-sm ${load.ppwkAt ? 'mark-on' : ''}`}
                          title={load.ppwkAt ? `PPWK received ${fmtStamp(load.ppwkAt)} — click to remove` : 'Mark PPWK/BOL received (QA still verifies separately)'}
                          onClick={() => confirmStamp(load, 'ppwkAt', 'PPWK')}
                        >
                          {load.ppwkAt ? '📄 ✓' : '📄'}
                        </button>
                      ) : load.ppwkAt ? '✓' : '—'}
                    </td>
                    <td>
                      {booker && (
                        <div className="track-actions">
                          <button className="btn-approve" onClick={() => confirmStamp(load, 'deliveredAt', 'delivered')}>
                            ✓ Delivered
                          </button>
                          {defconBtn(load)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === 'facilities' && <FacilitiesTab lanes={lanes} facilities={facilities} saveFacility={saveFacility} mayEdit={booker} />}
    </div>
  );
}

/* Facility contact directory — pre-seeded from every distinct active lane
   origin so the table is never empty; edits persist as facilities docs. */
function FacilitiesTab({ lanes, facilities, saveFacility, mayEdit }: {
  lanes: Lane[];
  facilities: Facility[];
  saveFacility: (f: Facility) => Promise<void>;
  mayEdit: boolean;
}) {
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Record<string, Partial<Facility>>>({});

  const rows = useMemo(() => {
    const byId = new Map(facilities.map((f) => [f.id, f]));
    const seen = new Set<string>();
    const out: Facility[] = [];
    for (const l of lanes) {
      if (l.isGroupHeader || !l.active) continue;
      const site = (l.origin ?? '').split('\n')[0].trim();
      if (!site) continue;
      const id = facilityId(site);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(byId.get(id) ?? { id, site, emails: '', notes: '' });
    }
    for (const f of facilities) if (!seen.has(f.id)) { seen.add(f.id); out.push(f); }
    const needle = q.trim().toLowerCase();
    return out
      .filter((f) => !needle || `${f.site} ${f.emails} ${f.notes}`.toLowerCase().includes(needle))
      .sort((a, b) => a.site.localeCompare(b.site));
  }, [lanes, facilities, q]);

  function cell(f: Facility, key: 'emails' | 'notes' | 'address', placeholder: string) {
    const value = (draft[f.id]?.[key] ?? f[key] ?? '') as string;
    if (!mayEdit) return <span className="wrap">{value || '—'}</span>;
    return (
      <input
        className="inline-input fac-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setDraft((d) => ({ ...d, [f.id]: { ...d[f.id], [key]: e.target.value } }))}
        onBlur={() => {
          const patch = draft[f.id];
          if (patch && patch[key] !== undefined && patch[key] !== (f[key] ?? '')) {
            void saveFacility({ ...f, ...patch } as Facility);
          }
        }}
      />
    );
  }

  return (
    <>
      <p className="muted">
        Facility contacts — pickup sites pre-listed from the lanes; enter the emails from the CT spreadsheet
        once and they live here. Comma-separate multiple addresses.
      </p>
      <div className="page-head" style={{ marginTop: 4 }}>
        <input className="matrix-search" placeholder="Search site / email / notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted">{rows.length} facilities</span>
      </div>
      <table className="list-table facilities-table table-dense">
        <colgroup><col className="w-fsite" /><col className="w-faddr" /><col className="w-femails" /><col className="w-fnotes" /><col className="w-fupd" /></colgroup>
        <thead><tr><th>Facility / site</th><th title="Street address — prints on rate confirmations">Address</th><th>Emails</th><th>Notes</th><th>Updated</th></tr></thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id}>
              <td className="strong wrap">{f.site}</td>
              <td>{cell(f, 'address', '4155 East Holmes Rd, Memphis, TN 38118')}</td>
              <td>{cell(f, 'emails', 'ops@site.gov, dock@site.gov…')}</td>
              <td>{cell(f, 'notes', 'hours, dock #, quirks…')}</td>
              <td className="muted">{f.updatedAt ? `${(f.updatedBy ?? '').split(' ')[0]} · ${fmtStamp(f.updatedAt)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
