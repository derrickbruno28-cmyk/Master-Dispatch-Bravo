import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { fmtStamp } from '../dates';
import { useStore } from '../data/store';
import { can } from '../permissions';
import { equipmentColor, laneTripNumber, normalizeCarrierName, DAY_LABELS, EQUIPMENT_OPTIONS, type Carrier, type Lane } from '../types';
import DedicatedView from './DedicatedView';
import LaneEditor from '../components/LaneEditor';
import { integrityIdForTripCode,
  fmtBand,
  trmIsStale,
  REASON_CODES,
  type Band,
  type BandHistoryEntry,
  type IntegrityRecord,
} from '../pricing';

/* §3.2 Integrity database — the single source of truth for lane rate data.
   Bands (cost side) are tuned per trip by the pricing tier with a required
   reason code; the TRM block (revenue side) refreshes from the weekly Master
   TRM upload, which reconciles and never touches bands. */

/* Parse a Master TRM workbook (FA2D3_Master / 7523D_Master sheets). */
function parseTrmFile(wb: XLSX.WorkBook): IntegrityRecord[] {
  const out: IntegrityRecord[] = [];
  for (const sheetName of wb.SheetNames) {
    const m = /^([A-Z0-9]+)_Master$/i.exec(sheetName);
    if (!m) continue;
    const contract = m[1].toUpperCase();
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { raw: true });
    for (const r of rows) {
      const tripNumber = String(r['Trip_ID'] ?? r['Trip_Ref'] ?? '').trim();
      if (!tripNumber) continue;
      /* FEV* rows are freight-auction/event entries in the master, NOT
         contract trips — they polluted Integrity once (Caleb 07/18). */
      if (/^FEV/i.test(tripNumber)) continue;
      const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
      const str = (v: unknown) => (v == null ? '' : String(v));
      out.push({
        id: `${contract}_${tripNumber}`,
        contract,
        tripNumber,
        tripCode: `${contract}-${tripNumber}`,
        odLabel: `${str(r['Origin_Facility'])} → ${str(r['Dest_Facility'])}`,
        bands: { weekday: { target: null, ceiling: null }, weekend: { target: null, ceiling: null } },
        trm: {
          currentRate: num(r['Current_Rate']),
          currentEff: str(r['Current_Eff']),
          currentExp: str(r['Current_Exp']),
          pendingRate: num(r['Pending_Rate']),
          pendingEff: str(r['Pending_Eff']),
          pendingExp: str(r['Pending_Exp']),
          miles: num(r['Trip_Miles']),
          hours: num(r['Trip_Hours']),
          freqCode: str(r['Freq_Code']),
          annualDays: num(r['Annual_Freq_Days'] ?? r['Annual_Count']),
          originNass: str(r['Origin_NASS']),
          destNass: str(r['Dest_NASS']),
        },
      });
    }
  }
  return out;
}

function BandEditor({
  record,
  dayType,
  onClose,
}: {
  record: IntegrityRecord;
  dayType: 'weekday' | 'weekend';
  onClose: () => void;
}) {
  const { saveBand } = useStore();
  const band = record.bands?.[dayType] ?? { target: null, ceiling: null };
  const [target, setTarget] = useState(band.target?.toString() ?? '');
  const [ceiling, setCeiling] = useState(band.ceiling?.toString() ?? '');
  const [reason, setReason] = useState('');

  async function save() {
    const next: Band = {
      target: target.trim() === '' ? null : Number(target),
      ceiling: ceiling.trim() === '' ? null : Number(ceiling),
    };
    await saveBand(record.id, dayType, next, reason);
    onClose();
  }

  return (
    <span className="band-editor">
      <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="target" className="inline-input band-input" />
      <input value={ceiling} onChange={(e) => setCeiling(e.target.value)} placeholder="ceiling" className="inline-input band-input" />
      <select className="inline-select band-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="">reason…</option>
        {REASON_CODES.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}
      </select>
      <button className="btn-primary btn-sm" disabled={!reason} onClick={save}>Save</button>
      <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
    </span>
  );
}

/* Inline TRM edits (Caleb: update revenue data in-app instead of only via the
   weekly Master upload — the upload stays as bulk sync). */
function TrmEditor({ record, onClose }: { record: IntegrityRecord; onClose: () => void }) {
  const { saveTrm } = useStore();
  const [rateV, setRateV] = useState(record.trm?.currentRate?.toString() ?? '');
  const [milesV, setMilesV] = useState(record.trm?.miles?.toString() ?? '');
  const [freqV, setFreqV] = useState(record.trm?.freqCode ?? '');
  return (
    <span className="band-editor">
      <input value={rateV} onChange={(e) => setRateV(e.target.value)} placeholder="rate $" className="inline-input band-input" />
      <input value={milesV} onChange={(e) => setMilesV(e.target.value)} placeholder="miles" className="inline-input band-input" />
      <input value={freqV} onChange={(e) => setFreqV(e.target.value)} placeholder="freq" className="inline-input band-input" />
      <button
        className="btn-primary btn-sm"
        onClick={async () => {
          await saveTrm(record.id, {
            currentRate: rateV.trim() === '' ? null : Number(rateV),
            miles: milesV.trim() === '' ? null : Number(milesV),
            freqCode: freqV.trim(),
          });
          onClose();
        }}
      >
        Save
      </button>
      <button className="btn-ghost btn-sm" onClick={onClose}>✕</button>
    </span>
  );
}

export default function IntegrityView() {
  const { integrity, trmMeta, importTrm, getBandHistory, currentUser, demoMode, dedicated, lanes, updateLane, createIntegrityRecord } = useStore();
  const mayBands = can(currentUser, 'integrity.bands');
  const mayTrm = can(currentUser, 'integrity.trm');
  const mayLanes = can(currentUser, 'integrity.lanes');
  const pricing = mayBands; // band editing (pricing tier by default)
  /* the lane ✎ + Loading default + TRM: pricing tier + FedCom admins by default */
  const laneData = mayTrm || mayLanes;
  /* no Integrity view permission -> ONLY the Carriers tab (broker MC/DOT hygiene) */
  const carriersOnly = !can(currentUser, 'integrity');
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<'rates' | 'dedicated' | 'carriers'>(
    searchParams.get('tab') === 'dedicated' ? 'dedicated'
      : searchParams.get('tab') === 'carriers' ? 'carriers' : 'rates',
  );
  const effTab = carriersOnly ? 'carriers' : tab;
  const [query, setQuery] = useState(searchParams.get('trip') ?? '');
  const [editing, setEditing] = useState<{ id: string; dayType: 'weekday' | 'weekend' } | null>(null);
  const [trmEditing, setTrmEditing] = useState<string | null>(null);
  const [laneEdit, setLaneEdit] = useState<Lane | null>(null);
  const [addingLane, setAddingLane] = useState(false);
  const laneByTrip = useMemo(() => {
    const m = new Map<string, Lane>();
    for (const l of lanes) {
      const t = laneTripNumber(l);
      if (t && !l.isGroupHeader && !m.has(t)) m.set(t, l);
    }
    return m;
  }, [lanes]);
  /* v2.18.0 (Caleb, "trip 6"): the Matrix must be a reflection of the
     Integrity database — any active lane with a trip code but no Integrity
     record is surfaced here so it can't silently drift again. */
  const missingRecords = useMemo(() => {
    const have = new Set(integrity.map((r) => r.id));
    return lanes.filter((l) =>
      l.active !== false && !l.isGroupHeader && !!l.tripCode
      && integrityIdForTripCode(l.tripCode) != null
      && !have.has(integrityIdForTripCode(l.tripCode)!));
  }, [lanes, integrity]);

  const dedByTrip = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const d of dedicated) {
      const days = d.everyDay ? [0, 1, 2, 3, 4, 5, 6] : d.days.flatMap((v, i) => (v ? [i] : []));
      m.set(d.tripNumber, [...new Set([...(m.get(d.tripNumber) ?? []), ...days])].sort());
    }
    return m;
  }, [dedicated]);
  const [importState, setImportState] = useState('');
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<BandHistoryEntry[]>([]);

  const stale = trmIsStale(trmMeta);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...integrity]
      .filter((r) => !q || `${r.tripCode} ${r.odLabel} ${r.contract}`.toLowerCase().includes(q))
      .sort((a, b) => a.contract.localeCompare(b.contract) || Number(a.tripNumber) - Number(b.tripNumber) || a.tripNumber.localeCompare(b.tripNumber));
  }, [integrity, query]);

  async function handleTrmFile(file: File) {
    setImportState('Reading…');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const records = parseTrmFile(wb);
    if (!records.length) {
      setImportState('No *_Master sheets found in that file.');
      return;
    }
    setImportState(`Reconciling ${records.length} trips…`);
    const res = await importTrm(records, file.name);
    setImportState(
      `Done — ${res.added} new trips added, ${res.updated} TRM blocks refreshed, bands untouched.` +
      (res.missing.length ? ` ⚠ ${res.missing.length} existing trips not in this file (kept): ${res.missing.slice(0, 6).join(', ')}${res.missing.length > 6 ? '…' : ''}` : ''),
    );
  }

  async function toggleHistory(id: string) {
    if (historyFor === id) { setHistoryFor(null); return; }
    setHistoryFor(id);
    setHistory(await getBandHistory(id));
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Integrity</h2>
        <div className="status-chips">
          {!carriersOnly && <>
          <button className={`chip ${effTab === 'rates' ? 'chip-on' : ''}`} onClick={() => setTab('rates')}>Rates & TRM</button>
          <button className={`chip ${effTab === 'dedicated' ? 'chip-on' : ''}`} onClick={() => setTab('dedicated')}>Dedicated</button>
          <button className={`chip ${effTab === 'carriers' ? 'chip-on' : ''}`} onClick={() => setTab('carriers')}>Carriers</button>
          </>}
      {effTab === 'rates' && missingRecords.length > 0 && (
        <div className="missing-integrity">
          <b>⚠ {missingRecords.length} Matrix lane{missingRecords.length === 1 ? '' : 's'} missing from the Integrity database</b>
          {' — these trips render on the Matrix but have no bands/TRM here:'}
          <ul>
            {missingRecords.map((l) => (
              <li key={l.id}>
                <b>{l.tripCode}</b> {l.origin} → {l.destination}
                {mayBands && (
                  <button className="btn-ghost btn-sm" onClick={() => void createIntegrityRecord(l)}>
                    ＋ Create record
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

          {effTab === 'rates' && laneData && (
            <button className="btn-ghost btn-sm lane-edit-visible" onClick={() => setAddingLane(true)}>
              ＋ Add lane / trip
            </button>
          )}
        </div>
        {effTab === 'rates' && <input
          className="search"
          placeholder="Search trip #, lane, contract…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />}
        <span className="muted">
          {effTab === 'carriers'
            ? 'carrier database — MC / DOT / issue flags; registrations link here by MC'
            : effTab === 'rates'
            ? `${integrity.length} trips · bands drive Matrix, Sales Hub & auto-set`
            : 'dedicated days, rates & margin — same trips, planning side'}
          {effTab === 'rates' && pricing && (
            <b> — click any Target/Ceiling or TRM value to edit it in place (✎)</b>
          )}
          {effTab === 'rates' && !pricing && laneData && (
            <b> — TRM and lane data (✎) are yours to edit; Target/Ceiling bands are pricing-team-owned (read-only here)</b>
          )}
          {!pricing && !laneData && ' · read-only (no integrity edit permission — see your manager)'}
        </span>
      </div>

      {effTab === 'dedicated' && <DedicatedView embedded />}
      {effTab === 'carriers' && <CarrierDbTab />}
      {effTab === 'rates' && <>

      <div className={`trm-banner ${stale ? 'trm-stale' : 'trm-fresh'}`}>
        {trmMeta ? (
          <span>
            Master TRM: <b>{trmMeta.filename}</b> · imported{' '}
            {fmtStamp(trmMeta.importedAt)} by {trmMeta.importedBy}
            {stale && <b> — ⚠ STALE: expected weekly refresh (every Monday)</b>}
          </span>
        ) : (
          <span>⚠ No Master TRM imported yet — revenue data missing. Upload the weekly TRM pull (expected every Monday).</span>
        )}
        {mayTrm && (
          <label className="btn-ghost trm-upload">
            ⬆ Upload Master TRM
            <input type="file" accept=".xlsx,.xls" hidden onChange={(e) => e.target.files?.[0] && handleTrmFile(e.target.files[0])} />
          </label>
        )}
        {importState && <span className="muted"> {importState}</span>}
        {demoMode && <span className="muted"> (demo — bands parsed from seed lanes)</span>}
      </div>

      {/* v2.32.1: the sticky header needs ITS OWN scroll container — inside
          the page-level scroller it just rode along with the rows */}
      <div className="integrity-scroll">
      <table className="list-table integrity-table">
        <colgroup>
          <col className="wi-trip" /><col className="wi-lane" /><col className="wi-band" /><col className="wi-band" />
          <col className="wi-trm" /><col className="wi-meta" /><col className="wi-hist" />
        </colgroup>
        <thead>
          <tr>
            <th>Trip</th>
            <th>Lane</th>
            <th title="Default loading option for this route — hub rows inherit it unless overridden per load">Loading</th>
            <th>Weekday band (Mon–Thu)</th>
            <th>Weekend band (Fri–Sun / holiday / ±1)</th>
            <th>TRM (revenue)</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <>
              <tr key={r.id}>
                <td className="strong">{r.tripCode}</td>
                <td className="wrap">
                  {r.odLabel}
                  {r.loadType === 'Live' && <span className="pill pill-plan"> LIVE</span>}
                  {dedByTrip.has(r.tripNumber) && (
                    <span
                      className="pill pill-ded"
                      title={`Dedicated ${dedByTrip.get(r.tripNumber)!.map((i) => DAY_LABELS[i]).join('/')}`}
                      onClick={() => setTab('dedicated')}
                    >
                      DED {dedByTrip.get(r.tripNumber)!.length === 7 ? 'daily' : dedByTrip.get(r.tripNumber)!.map((i) => DAY_LABELS[i][0]).join('')}
                    </span>
                  )}
                  {mayLanes && laneByTrip.has(r.tripNumber) && (
                    /* own line UNDER the lane text — inline it overlapped the
                       O/D label on narrow columns (Caleb 07/12) */
                    <button
                      className="btn-ghost btn-sm lane-edit-visible lane-edit-under"
                      title="Edit lane data — times, miles, dedicated CTS, solo-approved, planning (source of truth)"
                      onClick={() => setLaneEdit(laneByTrip.get(r.tripNumber)!)}
                    >
                      ✎ Edit lane
                    </button>
                  )}
                </td>
                <td>
                  {(() => {
                    /* default loading option lives on the LANE (defaultEquipment)
                       — Sales Hub + board inherit it unless a load overrides */
                    const lane = laneByTrip.get(r.tripNumber);
                    if (!lane) return <span className="muted">—</span>;
                    const v = lane.defaultEquipment ?? '';
                    const c = equipmentColor(v);
                    return (
                      <select
                        className="inline-select equip-select"
                        value={v}
                        disabled={!laneData}
                        style={c ? { background: c, color: '#fff', borderColor: c } : undefined}
                        onChange={(e) => void updateLane(lane.id, { defaultEquipment: e.target.value })}
                      >
                        <option value="">—</option>
                        {v === 'LIVE/LIVE' && <option value="LIVE/LIVE">LIVE/LIVE (legacy)</option>}
                        {EQUIPMENT_OPTIONS.map((o) => (
                          <option key={o} value={o} style={{ background: equipmentColor(o), color: '#fff' }}>{o}</option>
                        ))}
                      </select>
                    );
                  })()}
                </td>
                {(['weekday', 'weekend'] as const).map((dt) => (
                  <td key={dt}>
                    {editing?.id === r.id && editing.dayType === dt ? (
                      <BandEditor record={r} dayType={dt} onClose={() => setEditing(null)} />
                    ) : (
                      <span
                        className={mayBands ? 'band-cell editable' : 'band-cell'}
                        title={mayBands ? 'Click to edit target / ceiling (reason required)' : undefined}
                        onClick={() => mayBands && setEditing({ id: r.id, dayType: dt })}
                      >
                        {fmtBand(r.bands?.[dt])}
                        {pricing && <span className="edit-hint">✎</span>}
                      </span>
                    )}
                  </td>
                ))}
                <td className="muted">
                  {trmEditing === r.id ? (
                    <TrmEditor record={r} onClose={() => setTrmEditing(null)} />
                  ) : (
                    <span
                      className={mayTrm ? 'band-cell editable' : 'band-cell'}
                      title={mayTrm ? 'Click to edit TRM in-app (upload stays as bulk sync)' : undefined}
                      onClick={() => mayTrm && setTrmEditing(r.id)}
                    >
                      {r.trm?.currentRate != null ? `$${r.trm.currentRate.toLocaleString()}` : '—'}
                      {r.trm?.pendingRate != null && <span className="trm-pending"> → ${r.trm.pendingRate.toLocaleString()} pending</span>}
                      {r.trm?.freqCode && <span> · {r.trm.freqCode}</span>}
                      {laneData && <span className="edit-hint">✎</span>}
                    </span>
                  )}
                </td>
                <td className="muted">
                  {r.updatedBy ? `${r.updatedBy.split(' ')[0]} · ${r.updatedAt ? new Date(r.updatedAt).toLocaleDateString([], { month: 'numeric', day: 'numeric' }) : ''}` : '—'}
                </td>
                <td>
                  <button className="btn-ghost btn-sm" onClick={() => toggleHistory(r.id)}>
                    {historyFor === r.id ? '▾' : '▸'} log
                  </button>
                </td>
              </tr>
              {historyFor === r.id && (
                <tr key={`${r.id}-hist`}>
                  <td colSpan={7} className="hist-cell">
                    {history.length === 0 ? (
                      <span className="muted">No band changes logged{demoMode ? ' (demo)' : ''}.</span>
                    ) : (
                      history.map((h, i) => (
                        <div key={i} className="note-line">
                          <span className="note-text">{h.dayType}: {fmtBand({ target: h.target, ceiling: h.ceiling })} · {h.reasonCode}</span>
                          <span className="note-meta">{h.setBy} · {fmtStamp(h.at)}</span>
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      </div>
      </>}

      {(laneEdit || addingLane) && (
        <LaneEditor lane={addingLane ? null : laneEdit} onClose={() => { setLaneEdit(null); setAddingLane(false); }} />
      )}
    </div>
  );

}


/* Carrier database (Caleb 07/09): every carrier with MC / DOT / flags+notes.
   This is what new dispatcher registrations link against by MC number.
   Edits: admin-tier + pricing manager (bookers still CREATE carriers while
   booking — that flow is unchanged). */
function CarrierDbTab() {
  const { carriers, loads, updateCarrier, setCarrierIssue, currentUser } = useStore();
  const mayEdit = can(currentUser, 'integrity.carriers');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Record<string, Partial<Carrier>>>({});

  /* quick usage signal so dead entries are obvious */
  const loadCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of loads) {
      for (const name of [l.carrier, l.shuttleCarrier ?? '']) {
        const k = normalizeCarrierName(name);
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [loads]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...carriers]
      .filter((c) => !needle || `${c.name} ${c.mcNumber} ${c.dot ?? ''} ${c.notes ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [carriers, q]);

  function field(c: Carrier, key: 'mcNumber' | 'dot' | 'notes' | 'restrictedDrivers' | 'email' | 'phone', placeholder: string) {
    const value = draft[c.id]?.[key] ?? c[key] ?? '';
    if (!mayEdit) return <span>{value || '—'}</span>;
    return (
      <input
        className="inline-input"
        value={value as string}
        placeholder={placeholder}
        onChange={(e) => setDraft((d) => ({ ...d, [c.id]: { ...d[c.id], [key]: e.target.value } }))}
        onBlur={() => {
          const patch = draft[c.id];
          if (patch && patch[key] !== undefined && patch[key] !== (c[key] ?? '')) {
            void updateCarrier(c.id, { [key]: (patch[key] as string).trim() });
          }
        }}
      />
    );
  }

  return (
    <div className="carrier-db">
      <div className="page-head" style={{ marginTop: 8 }}>
        <input
          className="matrix-search"
          placeholder="Search name / MC / DOT / notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="muted">{rows.length} carrier{rows.length === 1 ? '' : 's'}</span>
      </div>
      <table className="list-table carrier-db-table table-dense">
        <colgroup>
          <col className="w-cname" /><col className="w-cmc" /><col className="w-cdot" />
          <col className="w-cloads" /><col className="w-cflag" /><col className="w-cdnu" /><col className="w-cnotes" /><col className="w-cdrivers" />
        </colgroup>
        <thead>
          <tr><th>Carrier</th><th>MC #</th><th>DOT #</th><th>Loads</th><th title="Issue flag — warn-only; hardens removal warnings">⚑</th><th title="Do Not Use — hard block: this carrier cannot be assigned to any load">DNU</th><th title="Dispatch email (Highway-verified) — prefills rate cons">Email</th><th>Phone</th><th>Flags / notes</th><th title="Restricted drivers within the fleet (e.g. banned from a site)">No-load drivers</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={`${c.issue ? 'carrier-issue-row' : ''} ${c.dnu ? 'carrier-dnu-row' : ''}`}>
              <td className="strong wrap">{c.name}{c.dnu && <b className="dnu-tag"> 🚫 DNU</b>}</td>
              <td>{field(c, 'mcNumber', 'MC-123456')}</td>
              <td>{field(c, 'dot', 'DOT #')}</td>
              <td className="muted">{loadCount.get(normalizeCarrierName(c.name)) ?? 0}</td>
              <td>
                <button
                  className={`chip ${c.issue ? 'chip-on' : ''}`}
                  disabled={!mayEdit}
                  title={c.issue ? 'Flagged as an issue carrier — click to clear' : 'Flag as issue carrier'}
                  onClick={() => void setCarrierIssue(c.id, !c.issue)}
                >
                  ⚑
                </button>
              </td>
              <td>
                <button
                  className={`chip ${c.dnu ? 'chip-on chip-dnu' : ''}`}
                  disabled={!mayEdit}
                  title={c.dnu ? 'DNU — click to allow this carrier again' : 'Flag DNU — blocks assignment on every load'}
                  onClick={() => {
                    if (!c.dnu && !window.confirm(`Flag ${c.name} as DNU? Nobody will be able to assign them to any load.`)) return;
                    void updateCarrier(c.id, { dnu: !c.dnu });
                  }}
                >
                  🚫
                </button>
              </td>
              <td>{field(c, 'email', 'dispatch@carrier.com')}</td>
                <td>{field(c, 'phone', '555-…')}</td>
              <td>{field(c, 'notes', 'issue context, docs, anything…')}</td>
              <td>{field(c, 'restrictedDrivers', 'e.g. 2 drivers banned from Coppell — names…')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
