import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  blankLoad, loadForCell, saveLoad, clearLoadCell, missingForDispatch,
  buildSegments, proportionRevenue, loadTotals, handoffLabel, syncSegmentAssignments, loadTrucks,
  fmtMoney, fmtMiles, fmtCpm, type Load, type LoadStop, type LoadSegment, blankStop,
} from '../data/loadsStore';
import { loadCustomers, ensureCustomer, EQUIPMENT_TYPES } from '../data/customersStore';
import { loadFleet, saveTruck } from '../data/fleetStore';
import { driverNames, driverByName } from '../data/driversStore';
import { documentStore, type LoadDocument } from '../integrations/documents';
import { routingProvider } from '../integrations/routing';
import { rateConParser, applyRateCon } from '../integrations/ratecon';
import { LOAD_STATUS_LABEL, type Assignment } from '../data/schedule';

/* Load Detail modal — replaces the old 3-field inline cell editor. Tabbed shell
   (Load Info · Stops · Customer · Documents · Dispatch) over the rich Load
   record; the board's Assignment (route/status/usps) is written on Save so all
   existing views stay in sync. Only the * fields block dispatch — everything
   else can stay blank. */

const STATUSES = ['unassigned', 'open', 'covered', 'dispatched', 'at yard', 'at shipper', 'en route', 'at receiver', 'delivered', 'completed', 'off'];

type Tab = 'info' | 'stops' | 'docs' | 'split' | 'dispatch';

/* per-driver dispatch state → color: confirmed = light green, flyer-sent-but-not-
   confirmed = yellow (pending), otherwise just assigned */
function driverState(flyer: boolean, confirmed: boolean): 'confirmed' | 'pending' | 'assigned' {
  return confirmed ? 'confirmed' : flyer ? 'pending' : 'assigned';
}

export default function LoadDetailModal({ tractor, date, assignment, canDel, initialTab, warning, newLoad, seedLoad, onSave, onClear, onCreated, onClose }: {
  tractor: string; date: string; assignment?: Assignment; canDel: boolean; initialTab?: Tab; warning?: string;
  newLoad?: boolean; seedLoad?: Load;
  onSave: (a: Assignment) => void; onClear: () => void; onCreated?: (l: Load) => void; onClose: () => void;
}) {
  const [l, setL] = useState<Load>(() => {
    if (seedLoad) return seedLoad;
    if (newLoad) return blankLoad('', date);   // blank, unassigned — truck/date set inside the card
    const ex = loadForCell(tractor, date);
    if (ex) return ex;
    return blankLoad(tractor, date, assignment ? { routeName: assignment.route, status: assignment.status, uspsContract: assignment.usps } : {});
  });
  const [tab, setTab] = useState<Tab>(initialTab ?? 'info');
  const [notice, setNotice] = useState('');
  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set());
  const [verify, setVerify] = useState<{ filled: string[]; confidence: string } | null>(null);
  const prevTrucks = useRef<string[]>(loadTrucks(l));
  const f = <K extends keyof Load>(k: K, v: Load[K]) => setL((p) => ({ ...p, [k]: v }));

  const missing = missingForDispatch(l);

  /* rate-con drop → parse → apply as a highlighted, must-verify suggestion */
  async function onRateCon(file: File) {
    setNotice('⏳ Reading the rate con…');
    try {
      const res = await rateConParser().parse(file);
      if (res.keys.length === 0) { setNotice('No fields recognized in that PDF — fill the load in manually.'); return; }
      const { load, changed } = applyRateCon(l, res.fields);
      setL(load);
      setAutoFilled(new Set(changed));
      setVerify({ filled: res.filled, confidence: res.confidence });
      setNotice('');
      setTab('info');
    } catch {
      setNotice('Could not read that file — is it a PDF rate con? You can still fill the load in manually.');
    }
  }

  async function persist(next?: Partial<Load>): Promise<Load> {
    let out = { ...l, ...next };
    if (out.customerName.trim() && !out.customerId) out = { ...out, customerId: ensureCustomer(out.customerName).id };
    const saved = await saveLoad(out);
    setL(saved);
    return saved;
  }
  async function saveAndClose() {
    if (verify) { setNotice('⚠ Verify the auto-filled fields, then click “✓ Verified” before saving.'); setTab('info'); return; }
    /* new/unassigned loads can be saved with NO route — the point is to start the
       schedule entry with a truck + drivers + date and fill the rest in later.
       Existing (cell-bound) loads still need a route to stay on the board. */
    if (!(newLoad || seedLoad) && !l.routeName.trim()) { setNotice('Route name is required to save the load.'); setTab('info'); return; }
    const saved = await persist();
    if (saved.segments.length > 0) {
      /* split load: write a board cell per segment truck (and clear dropped ones) */
      await syncSegmentAssignments(saved, prevTrucks.current);
      prevTrucks.current = loadTrucks(saved);
      onClose();
      return;
    }
    /* new load: the card owns its own truck + date. The parent places it on the
       board if a truck is assigned, or keeps it in the Unassigned tray if not. */
    if (newLoad || seedLoad) { onCreated?.(saved); return; }
    onSave({ route: saved.routeName, status: saved.status, usps: saved.uspsContract });
  }

  return (
    <div className="fleet-modal-back" onClick={onClose}>
      <div className="fleet-modal load-modal" onClick={(e) => e.stopPropagation()}>
        {/* header: title + summary strip + actions */}
        <div className="load-head">
          <div>
            <h3>{l.routeName.trim() || 'New Load'} <span className="am-muted">· {l.assignedTruck ? `#${l.assignedTruck}` : 'unassigned'} · {l.date || '—'}</span></h3>
            <div className="load-summary">
              <Sum label="Rate / Revenue" val={fmtMoney(l.rate)} money />
              <Sum label="Distance" val={fmtMiles(l.laneMiles)} />
              <Sum label="CPM (rev/mi)" val={fmtCpm(l.cpm)} />
              <Sum label="Stops" val={String(l.stops.length)} />
              <Sum label="Weight" val={l.weight || '—'} />
            </div>
          </div>
          <div className="load-head-btns">
            <button className="load-dispatch-btn" onClick={() => setTab('dispatch')}>⚡ Dispatch Driver</button>
            <button className="am-save" onClick={saveAndClose}>Save</button>
            <button className="am-cancel" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* tabs */}
        <div className="load-tabs">
          {([['info', 'Load Info'], ['stops', 'Stops'], ['docs', 'Documents'], ['split', l.segments.length ? `✂ Split (${l.segments.length})` : '✂ Split'], ['dispatch', 'Dispatch']] as [Tab, string][]).map(([k, lab]) => (
            <button key={k} className={`load-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{lab}</button>
          ))}
        </div>

        {warning && <div className="am-dblbook" style={{ marginBottom: 6 }}>{warning}</div>}
        {notice && <div className="am-notice">{notice}</div>}
        {verify && (
          <div className="ratecon-verify">
            <div className="ratecon-verify-head">
              📄 Auto-filled from rate con <span className={`ratecon-conf ${verify.confidence}`}>{verify.confidence} confidence</span>
            </div>
            <div className="ratecon-verify-body">
              Review the highlighted fields — {verify.filled.join(' · ')}. Nothing saves until you confirm.
            </div>
            <div className="ratecon-verify-actions">
              <button className="am-save" onClick={() => { setVerify(null); setAutoFilled(new Set()); }}>✓ Verified — looks right</button>
              <button className="am-clear" onClick={() => { setVerify(null); setAutoFilled(new Set()); }}>Dismiss</button>
            </div>
          </div>
        )}

        {tab === 'info' && <InfoTab l={l} f={f} canDel={canDel} assignable={!!(newLoad || seedLoad)} autoFilled={autoFilled} onRateCon={onRateCon} onClear={() => { clearLoadCell(tractor, date); onClear(); }} />}
        {tab === 'stops' && <StopsTab l={l} setL={setL} persist={persist} />}
        {tab === 'docs' && <DocsTab loadId={l.id} />}
        {tab === 'split' && <SplitTab l={l} setL={setL} persist={persist} />}
        {tab === 'dispatch' && (
          <DispatchTab l={l} missing={missing} flash={setNotice}
            onDispatched={async (sendTo) => {
              const saved = await persist({
                status: 'dispatched', dispatchedAt: new Date().toISOString(),
                segments: l.segments.map((s) => ({ ...s, status: 'dispatched' })),
              });
              for (const truck of loadTrucks(saved)) {
                const t = loadFleet().find((x) => x.tractor === truck);
                if (t) saveTruck({ ...t, flyer: sendTo === 'team' ? 'team' : 'driver' });
              }
              if (saved.segments.length > 0) {
                await syncSegmentAssignments(saved, prevTrucks.current);
                prevTrucks.current = loadTrucks(saved);
                onClose();
                return;
              }
              onSave({ route: saved.routeName, status: 'dispatched', usps: saved.uspsContract });
            }} />
        )}
      </div>
    </div>
  );
}

function Sum({ label, val, money }: { label: string; val: string; money?: boolean }) {
  return <span className="load-sum"><span className="load-sum-label">{label}</span><b className={money ? 'load-sum-money' : ''}>{val}</b></span>;
}

/* ---------------- Load Info ---------------- */
function InfoTab({ l, f, canDel, assignable, autoFilled, onRateCon, onClear }: {
  l: Load; f: <K extends keyof Load>(k: K, v: Load[K]) => void; canDel: boolean; assignable?: boolean;
  autoFilled: Set<string>; onRateCon: (file: File) => void | Promise<void>; onClear: () => void;
}) {
  const customers = useMemo(() => loadCustomers(), []);
  const fleet = useMemo(() => loadFleet(), []);
  const roster = useMemo(() => driverNames(), []);
  const [confirmClear, setConfirmClear] = useState(false);
  const [drag, setDrag] = useState(false);
  const hl = (k: string) => `am-input${autoFilled.has(k) ? ' load-autofilled' : ''}`;
  /* driver-availability check against the board date */
  function availWarn(name: string): string {
    const d = driverByName(name); if (!d || !d.readyDate || !l.date) return '';
    if (l.date < d.readyDate) return `⚠ ${(name.split(' ')[0] || name)} isn't available until ${d.readyDate} (ready-to-go date)`;
    return '';
  }
  function pickTruck(v: string) {
    f('assignedTruck', v); f('assignedTeamId', v);
    const t = fleet.find((x) => x.tractor === v);
    if (t) { if (!l.driver1) f('driver1', t.driver1 || ''); if (!l.driver2) f('driver2', t.driver2 || ''); }
  }
  return (
    <div className="load-info-grid">
      <div className="load-fields">
        <div className={`ratecon-drop ${drag ? 'on' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const fl = e.dataTransfer.files?.[0]; if (fl) void onRateCon(fl); }}>
          <span>📄 Drop a <b>rate con PDF</b> here to auto-fill this load</span>
          <label className="am-clear ratecon-browse">Browse…
            <input type="file" accept="application/pdf,.pdf,.txt" style={{ display: 'none' }} onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void onRateCon(fl); e.target.value = ''; }} />
          </label>
        </div>
        {assignable && (
          <div className="load-assign-box">
            <div className="load-assign-title">Assignment <span className="am-muted">— start the schedule entry: pick the team, truck &amp; trailer and a date. You can save with no route and fill the rest in later.</span></div>
            <div className="load-two">
              <L t="Assign to truck">
                <select className="am-input" value={l.assignedTruck} onChange={(e) => pickTruck(e.target.value)}>
                  <option value="">— Unassigned (place later) —</option>
                  {fleet.map((t) => <option key={t.tractor} value={t.tractor}>#{t.tractor} — {[t.driver1, t.driver2].filter(Boolean).join(' / ') || t.type}</option>)}
                </select>
              </L>
              <L t="Trailer #"><input className="am-input" value={l.assignedTrailer} onChange={(e) => f('assignedTrailer', e.target.value)} placeholder="e.g. 53012" /></L>
            </div>
            <L t="Board date (pickup day)"><input className="am-input" type="date" value={l.date} onChange={(e) => f('date', e.target.value)} /></L>
          </div>
        )}
        <L t="Route name *"><input className={hl('routeName')} value={l.routeName} onChange={(e) => f('routeName', e.target.value)} placeholder="FA2D3-544 Irving→SATX" /></L>
        <div className="load-two">
          <L t="Customer">
            <input className={hl('customerName')} list="load-customers" value={l.customerName} onChange={(e) => f('customerName', e.target.value)} placeholder="pick or type…" />
            <datalist id="load-customers">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </L>
          <L t="Status">
            <select className="am-input" value={l.status} onChange={(e) => f('status', e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{LOAD_STATUS_LABEL[s] ?? s}</option>)}
            </select>
          </L>
        </div>
        <L t="Equipment (van type) *"><select className={hl('equipment')} value={l.equipment} onChange={(e) => f('equipment', e.target.value)}>
          <option value="">— select —</option>{EQUIPMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select></L>
        <div className="load-two">
          <L t="Rate (revenue $)"><input className={`${hl('rate')} load-rate-input`} type="number" value={l.rate ?? ''} onChange={(e) => f('rate', e.target.value === '' ? null : Number(e.target.value))} placeholder="0.00" /></L>
          <L t="Weight"><input className={hl('weight')} value={l.weight} onChange={(e) => f('weight', e.target.value)} placeholder="e.g. 24,000 lbs" /></L>
        </div>
        <div className="load-two">
          <L t="Reference / Conf #"><input className={hl('referenceNo')} value={l.referenceNo} onChange={(e) => f('referenceNo', e.target.value)} /></L>
          <L t="Booking authority"><input className="am-input" value={l.bookingAuthority} onChange={(e) => f('bookingAuthority', e.target.value)} /></L>
        </div>
        <L t="Commodity"><input className={hl('commodity')} value={l.commodity} onChange={(e) => f('commodity', e.target.value)} /></L>
        <L t="Dispatch notes"><textarea className="am-input" rows={2} value={l.dispatchNotes} onChange={(e) => f('dispatchNotes', e.target.value)} /></L>
        <label className="am-usps-check"><input type="checkbox" checked={l.uspsContract} onChange={(e) => f('uspsContract', e.target.checked)} /> USPS contract route</label>

        {/* Drivers & confirmation — assign each driver + track flyer/confirm per driver */}
        <div className="load-drivers-conf">
          <div className="load-assign-title">Drivers &amp; confirmation <span className="am-muted">— flyer sent → <b className="dc-y">pending</b>, confirmed → <b className="dc-g">ready</b>. Each driver independently.</span></div>
          <DriverConfRow n={1} name={l.driver1} roster={roster} warn={availWarn(l.driver1)}
            flyer={l.driver1Flyer} confirmed={l.driver1Confirmed}
            onName={(v) => f('driver1', v)} onFlyer={(v) => f('driver1Flyer', v)} onConfirm={(v) => f('driver1Confirmed', v)} />
          <DriverConfRow n={2} name={l.driver2} roster={roster} warn={availWarn(l.driver2)} optional
            flyer={l.driver2Flyer} confirmed={l.driver2Confirmed}
            onName={(v) => f('driver2', v)} onFlyer={(v) => f('driver2Flyer', v)} onConfirm={(v) => f('driver2Confirmed', v)} />
          <datalist id="load-roster">{roster.map((n) => <option key={n} value={n} />)}</datalist>
        </div>

        {!assignable && (
          <div className="load-clear-row">
            {confirmClear
              ? <><span className="am-muted">Remove this load from the board?</span>
                  <button className="fleet-del" onClick={onClear}>✓ Remove</button>
                  <button className="am-clear" onClick={() => setConfirmClear(false)}>Keep</button></>
              : canDel
                ? <button className="am-clear" onClick={() => setConfirmClear(true)}>🗑 Clear load off this day</button>
                : <button className="am-clear" disabled title="Deleting is restricted to FMT Lead / US Ops / Owner">🔒 Clear (restricted)</button>}
          </div>
        )}
      </div>
      <StopsPanel l={l} highlight={autoFilled.has('stops')} />
    </div>
  );
}

function StopsPanel({ l, highlight }: { l: Load; highlight?: boolean }) {
  const sorted = l.stops.slice().sort((a, b) => a.sequence - b.sequence);
  return (
    <div className={`load-stops-panel${highlight ? ' load-autofilled' : ''}`}>
      <div className="load-dist-banner">🛣 Lane distance: <b>{fmtMiles(l.laneMiles)}</b> <span className="am-muted">· {routingProvider().label}</span></div>
      {sorted.map((s, i) => (
        <div key={i} className={`load-stopcard ${s.type}`}>
          <div className="load-stopcard-head">{s.type === 'pickup' ? '📦 PICKUP' : '📍 DELIVERY'} <span className="am-muted">#{s.sequence}</span></div>
          <div>{[s.address, s.city, s.state, s.zip].filter(Boolean).join(', ') || <span className="am-muted">no address yet</span>}</div>
          {s.dateTime && <div className="am-muted">{s.dateTime.replace('T', ' · ')}</div>}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Stops ---------------- */
function StopsTab({ l, setL, persist }: { l: Load; setL: React.Dispatch<React.SetStateAction<Load>>; persist: (n?: Partial<Load>) => Promise<Load> }) {
  const upd = (i: number, k: keyof LoadStop, v: string | number) =>
    setL((p) => ({ ...p, stops: p.stops.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));
  const add = (type: LoadStop['type']) =>
    setL((p) => ({ ...p, stops: [...p.stops, blankStop(type, p.stops.length + 1)] }));
  const del = (i: number) => setL((p) => ({ ...p, stops: p.stops.filter((_, j) => j !== i) }));

  /* split control — live here next to ＋Pickup/＋Delivery so the split can be
     added and MOVED right from the stops list (the ✂ Split tab still assigns
     a truck to each leg). A "cut" is a stop index between pickup and delivery. */
  const sorted = useMemo(() => l.stops.slice().sort((a, b) => a.sequence - b.sequence), [l.stops]);
  const canSplit = sorted.length >= 3;
  const cuts = l.segments.slice(0, -1).map((s) => s.toStop);
  async function rebuild(nextCuts: number[]) {
    const withSegs = { ...l, segments: buildSegments(l, nextCuts) };
    setL(await persist(proportionRevenue(await persist(withSegs))));
  }
  async function splitLoad() {
    if (!canSplit) return;
    await rebuild(cuts.length ? cuts : [Math.max(1, Math.min(sorted.length - 2, Math.round(sorted.length / 2)))]);
  }
  async function moveCut(idx: number, dir: -1 | 1) {
    const next = cuts.slice(); const nv = next[idx] + dir;
    if (nv <= 0 || nv >= sorted.length - 1 || next.some((c, j) => j !== idx && c === nv)) return;
    next[idx] = nv; await rebuild(next.sort((a, b) => a - b));
  }
  async function removeSplit() { setL(await persist({ segments: [] })); }
  const cutLabel = (c: number) => `#${sorted[c]?.sequence} ${[sorted[c]?.city, sorted[c]?.state].filter(Boolean).join(', ') || sorted[c]?.type || 'stop'}`;

  return (
    <div>
      {l.stops.map((s, i) => (
        <div key={i} className={`load-stopedit ${s.type}`}>
          <div className="load-stopedit-head">
            <b>{s.type === 'pickup' ? '📦 Pickup' : '📍 Delivery'}</b>
            <input className="am-input load-seq" type="number" title="Sequence" value={s.sequence} onChange={(e) => upd(i, 'sequence', Number(e.target.value))} />
            <button className="fleet-del" onClick={() => del(i)}>🗑</button>
          </div>
          <div className="load-two">
            <input className="am-input" placeholder="Address" value={s.address} onChange={(e) => upd(i, 'address', e.target.value)} />
            <input className="am-input" placeholder="Date & time" type="datetime-local" value={s.dateTime} onChange={(e) => upd(i, 'dateTime', e.target.value)} />
          </div>
          <div className="load-three">
            <input className="am-input" placeholder="City" value={s.city} onChange={(e) => upd(i, 'city', e.target.value)} />
            <input className="am-input" placeholder="State" value={s.state} onChange={(e) => upd(i, 'state', e.target.value)} />
            <input className="am-input" placeholder="ZIP" value={s.zip} onChange={(e) => upd(i, 'zip', e.target.value)} />
          </div>
          <div className="load-three">
            <input className="am-input" placeholder="PO #" value={s.poNumber} onChange={(e) => upd(i, 'poNumber', e.target.value)} />
            <input className="am-input" placeholder="Ref #" value={s.refNo} onChange={(e) => upd(i, 'refNo', e.target.value)} />
            <input className="am-input" placeholder="Notes" value={s.notes} onChange={(e) => upd(i, 'notes', e.target.value)} />
          </div>
        </div>
      ))}
      <div className="load-stopadd">
        <button className="am-save" onClick={() => add('pickup')}>＋ Pickup</button>
        <button className="am-save" style={{ background: '#7c5cff', color: '#fff' }} onClick={() => add('delivery')}>＋ Delivery</button>
        {l.segments.length === 0 && (
          <button className="am-save load-split-btn" disabled={!canSplit}
            title={canSplit ? 'Split into two legs at a shuttle/relay stop — you can move the split point after' : 'Add a middle stop (a shuttle/handoff) first — need at least 3 stops to split'}
            onClick={splitLoad}>✂ Split load</button>
        )}
        <span className="am-muted">Distance & CPM recalculate on Save.</span>
      </div>
      {l.segments.length > 0 && (
        <div className="load-split-ctl">
          <span className="load-split-ctl-title">✂ Split into {l.segments.length} legs</span>
          {cuts.map((c, idx) => (
            <span key={idx} className="load-split-chip">
              <span className="load-split-chip-lab">split after {cutLabel(c)}</span>
              <button className="split-move" title="Move split one stop earlier" disabled={c <= 1 || cuts.some((x, j) => j !== idx && x === c - 1)} onClick={() => moveCut(idx, -1)}>▲</button>
              <button className="split-move" title="Move split one stop later" disabled={c >= sorted.length - 2 || cuts.some((x, j) => j !== idx && x === c + 1)} onClick={() => moveCut(idx, 1)}>▼</button>
            </span>
          ))}
          {sorted.length > l.segments.length + 1 && (
            <button className="am-clear split-add-cut" title="Add another split point" onClick={() => rebuild([...cuts, sorted.slice(1, -1).map((_, i) => i + 1).find((i) => !cuts.includes(i)) ?? cuts[cuts.length - 1]])}>＋ Cut</button>
          )}
          <button className="am-clear" onClick={removeSplit}>✕ Remove split</button>
          <span className="am-muted">Assign a truck to each leg on the ✂ Split tab.</span>
        </div>
      )}
    </div>
  );
}

/* one driver row: name + flyer + confirmed toggles, colored by state. Yellow =
   flyer sent / pending; light green = confirmed. Independent per driver. */
function DriverConfRow({ n, name, warn, flyer, confirmed, optional, onName, onFlyer, onConfirm }: {
  n: number; name: string; roster: string[]; warn: string;
  flyer: boolean; confirmed: boolean; optional?: boolean;
  onName: (v: string) => void; onFlyer: (v: boolean) => void; onConfirm: (v: boolean) => void;
}) {
  const st = driverState(flyer, confirmed);
  const chip = st === 'confirmed' ? 'Confirmed' : st === 'pending' ? 'Pending' : (name.trim() ? 'Assigned' : '—');
  return (
    <div className={`drv-conf drv-conf-${st}`}>
      <span className="drv-conf-num">D{n}</span>
      <input className="am-input drv-conf-name" list="load-roster" value={name}
        placeholder={optional ? 'solo? leave blank' : 'pick or type a driver…'} onChange={(e) => onName(e.target.value)} />
      <button type="button" className={`drv-conf-btn ${flyer ? 'on-y' : ''}`} disabled={!name.trim()}
        title="Flyer sent → pending confirmation (yellow)" onClick={() => onFlyer(!flyer)}>{flyer ? '✈ Flyer sent' : '✈ Send flyer'}</button>
      <button type="button" className={`drv-conf-btn ${confirmed ? 'on-g' : ''}`} disabled={!name.trim()}
        title="Driver confirmed (light green)" onClick={() => onConfirm(!confirmed)}>{confirmed ? '✓ Confirmed' : 'Confirm'}</button>
      <span className={`drv-conf-chip ${st}`}>{chip}</span>
      {warn && <span className="load-avail-warn">{warn}</span>}
    </div>
  );
}

/* ---------------- Documents ---------------- */
function DocsTab({ loadId }: { loadId: string }) {
  const store = documentStore();
  const [docs, setDocs] = useState<LoadDocument[]>([]);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => { void store.list(loadId).then(setDocs); };
  useEffect(refresh, [loadId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const fl of Array.from(files)) await store.put(loadId, fl);
    refresh();
  }
  async function view(id: string) {
    const b = await store.data(id); if (!b) return;
    window.open(URL.createObjectURL(b), '_blank');
  }
  async function download(d: LoadDocument) {
    const b = await store.data(d.id); if (!b) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = d.name; a.click();
  }
  return (
    <div>
      <div className="load-docs-head">
        <span className="load-storage-badge">🗄 {store.label}</span>
        <label className="am-save" style={{ cursor: 'pointer' }}>⭳ Upload document
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => addFiles(e.target.files)} />
        </label>
      </div>
      <div className={`load-dropzone ${drag ? 'on' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}>
        Drag & drop rate cons, BOLs, PODs here
      </div>
      <table className="am-grid am-fleet load-docs-table">
        <thead><tr><th>Name</th><th>Type</th><th>Uploaded</th><th>Actions</th></tr></thead>
        <tbody>
          {docs.length === 0 && <tr><td colSpan={4} className="am-muted" style={{ textAlign: 'center', padding: 12 }}>No documents yet.</td></tr>}
          {docs.map((d) => (
            <tr key={d.id}>
              <td>{renaming === d.id
                ? <span style={{ display: 'flex', gap: 6 }}>
                    <input className="am-input" value={name} onChange={(e) => setName(e.target.value)} />
                    <button className="am-save" onClick={async () => { await store.rename(d.id, name); setRenaming(null); refresh(); }}>✓</button>
                  </span>
                : d.name}</td>
              <td className="am-muted">{d.type.split('/').pop()}</td>
              <td className="am-muted">{d.uploadedAt.slice(0, 16).replace('T', ' ')}</td>
              <td className="fleet-actions">
                {confirmDel === d.id
                  ? <><span className="am-muted">To trash?</span>
                      <button className="fleet-del" onClick={async () => { await store.softDelete(d.id); setConfirmDel(null); refresh(); }}>✓</button>
                      <button className="am-clear" onClick={() => setConfirmDel(null)}>✕</button></>
                  : <>
                      <button className="am-clear" onClick={() => view(d.id)}>View</button>
                      <button className="am-clear" onClick={() => { setRenaming(d.id); setName(d.name); }}>Rename</button>
                      <button className="am-clear" onClick={() => download(d)}>⭳</button>
                      <button className="fleet-del" onClick={() => setConfirmDel(d.id)}>🗑</button>
                    </>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Split / relay ---------------- */
function SplitTab({ l, setL, persist }: { l: Load; setL: React.Dispatch<React.SetStateAction<Load>>; persist: (n?: Partial<Load>) => Promise<Load> }) {
  const sorted = useMemo(() => l.stops.slice().sort((a, b) => a.sequence - b.sequence), [l.stops]);
  const teams = useMemo(() => loadFleet(), []);
  const [cut, setCut] = useState(1);
  const totals = loadTotals(l);

  async function splitAt(i: number) {
    const withSegs = { ...l, segments: buildSegments(l, [i]) };
    const priced = proportionRevenue(await persist(withSegs)); // persist recalcs segment miles
    setL(await persist(priced));
  }
  async function addCutHere() {
    const cuts = new Set(l.segments.slice(0, -1).map((s) => s.toStop)); cuts.add(cut);
    const withSegs = { ...l, segments: buildSegments(l, [...cuts]) };
    setL(await persist(proportionRevenue(await persist(withSegs))));
  }
  async function unsplit() { setL(await persist({ segments: [] })); }
  async function updSeg(i: number, patch: Partial<LoadSegment>) {
    const segments = l.segments.map((s, j) => (j === i ? { ...s, ...patch } : s));
    setL(await persist({ segments }));
  }

  if (l.segments.length === 0) {
    return (
      <div className="load-fields" style={{ maxWidth: 560 }}>
        <p className="am-muted" style={{ fontSize: 12.5 }}>
          Split a load at a shuttle / relay stop so each leg runs on its own truck (e.g. a solo shipper→shuttle,
          then a team shuttle→receiver). Revenue and miles attribute to each segment's truck.
        </p>
        {sorted.length < 3
          ? <div className="load-missing">Add at least 3 stops (a shuttle/handoff between pickup and delivery) on the Stops tab first.</div>
          : (
            <div className="split-choose">
              <span>✂ Split at stop:</span>
              <select className="am-input" style={{ maxWidth: 320 }} value={cut} onChange={(e) => setCut(Number(e.target.value))}>
                {sorted.map((s, i) => (i > 0 && i < sorted.length - 1)
                  ? <option key={i} value={i}>#{s.sequence} {s.type} — {[s.city, s.state].filter(Boolean).join(', ') || s.address || 'stop'}</option>
                  : null)}
              </select>
              <button className="am-save" onClick={() => splitAt(cut)}>Split here</button>
            </div>
          )}
      </div>
    );
  }

  return (
    <div>
      <div className="split-totals">
        <Sum label="Total Revenue" val={fmtMoney(totals.revenue)} money />
        <Sum label="Total Miles" val={fmtMiles(totals.miles)} />
        <Sum label="Blended CPM" val={fmtCpm(totals.blendedCpm)} />
        <Sum label="Segments" val={String(totals.segments)} />
        <Sum label="Trucks used" val={String(totals.trucks)} />
        <button className="am-clear" style={{ marginLeft: 'auto' }} onClick={unsplit}>↺ Un-split</button>
      </div>
      {l.segments.map((s, i) => (
        <div key={s.id}>
          <div className="split-seg">
            <div className="split-seg-head">
              <b>{s.label}</b>
              <span className="am-muted">stops #{sorted[s.fromStop]?.sequence}→#{sorted[s.toStop]?.sequence}</span>
              <span className="split-seg-cpm">{fmtMoney(s.segmentRevenue)} · {fmtMiles(s.segmentMiles)} · {fmtCpm(s.segmentCpm)}</span>
            </div>
            <div className="load-three">
              <label className="otp-field"><span className="otp-field-label">Truck / team</span>
                <select className="am-input" value={s.assignedTruck} onChange={(e) => updSeg(i, { assignedTruck: e.target.value, assignedTeamId: e.target.value })}>
                  <option value="">— unassigned —</option>
                  {teams.map((t) => <option key={t.tractor} value={t.tractor}>#{t.tractor} — {[t.driver1, t.driver2].filter(Boolean).join(' / ') || t.type}</option>)}
                </select>
              </label>
              <label className="otp-field"><span className="otp-field-label">Segment revenue $</span>
                <input className="am-input load-rate-input" type="number" value={s.segmentRevenue ?? ''} onChange={(e) => updSeg(i, { segmentRevenue: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
              <label className="otp-field"><span className="otp-field-label">Status</span>
                <select className="am-input" value={s.status} onChange={(e) => updSeg(i, { status: e.target.value })}>
                  {STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
            </div>
          </div>
          {i < l.segments.length - 1 && <div className="split-handoff">⇄ shuttle handoff · {handoffLabel(l, i)}</div>}
        </div>
      ))}
      {sorted.length - 1 - l.segments.length >= 0 && sorted.length > l.segments.length + 1 && (
        <div className="split-choose" style={{ marginTop: 10 }}>
          <span>Add another cut at stop:</span>
          <select className="am-input" style={{ maxWidth: 260 }} value={cut} onChange={(e) => setCut(Number(e.target.value))}>
            {sorted.map((s, i) => (i > 0 && i < sorted.length - 1)
              ? <option key={i} value={i}>#{s.sequence} — {[s.city, s.state].filter(Boolean).join(', ') || 'stop'}</option>
              : null)}
          </select>
          <button className="am-save" onClick={addCutHere}>＋ Cut</button>
        </div>
      )}
      <p className="am-muted" style={{ fontSize: 11.5, marginTop: 8 }}>Save writes each segment onto its truck's board row. Dispatch generates a separate driver sheet per segment.</p>
    </div>
  );
}

/* ---------------- Dispatch (sheet → clipboard PNG / PDF) ---------------- */
function DispatchTab({ l, missing, flash, onDispatched }: {
  l: Load; missing: string[]; flash: (m: string) => void;
  onDispatched: (sendTo: 'both' | 'team') => void | Promise<void>;
}) {
  const [sendTo, setSendTo] = useState<'both' | 'team'>('both');
  const [inc, setInc] = useState({ stops: true, rate: true, ref: true, commodity: true, authority: true, notes: true });
  const [segIdx, setSegIdx] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const allSorted = l.stops.slice().sort((a, b) => a.sequence - b.sequence);
  const isSplit = l.segments.length > 0;
  const seg = isSplit ? l.segments[Math.min(segIdx, l.segments.length - 1)] : null;
  const activeTruck = seg ? seg.assignedTruck : l.assignedTruck;
  const activeStops = seg ? allSorted.slice(seg.fromStop, seg.toStop + 1) : allSorted;
  const activeRevenue = seg ? seg.segmentRevenue : l.rate;
  const team = loadFleet().find((t) => t.tractor === activeTruck);

  async function toCanvas() {
    if (!sheetRef.current) return null;
    return html2canvas(sheetRef.current, { backgroundColor: '#ffffff', scale: 2 });
  }
  async function copyImage() {
    try {
      const c = await toCanvas(); if (!c) return;
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
      if (!blob) throw new Error('render failed');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      flash('✓ Load sheet copied as an image — paste it into the driver text/chat.');
    } catch { flash('Could not copy the image in this browser — use Download PDF instead.'); }
  }
  async function downloadPdf() {
    const c = await toCanvas(); if (!c) return;
    const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    const w = pdf.internal.pageSize.getWidth() - 48;
    pdf.addImage(c.toDataURL('image/png'), 'PNG', 24, 24, w, (c.height / c.width) * w);
    pdf.save(`load-sheet-${l.routeName.replace(/[^\w-]+/g, '_') || l.id}.pdf`);
  }

  const chk = (k: keyof typeof inc, lab: string) => (
    <label className="load-inc"><input type="checkbox" checked={inc[k]} onChange={(e) => setInc((p) => ({ ...p, [k]: e.target.checked }))} />{lab}</label>
  );
  const sorted = activeStops;

  return (
    <div className="load-dispatch-grid">
      <div>
        {isSplit && (
          <L t={`Segment (${l.segments.length}) — a separate sheet per leg`}>
            <select className="am-input" value={segIdx} onChange={(e) => setSegIdx(Number(e.target.value))}>
              {l.segments.map((s, i) => <option key={s.id} value={i}>{s.label} · #{s.assignedTruck || '—'} · {handoffLabel(l, i - 1 < 0 ? 0 : i)}</option>)}
            </select>
          </L>
        )}
        <L t="Send to"><select className="am-input" value={sendTo} onChange={(e) => setSendTo(e.target.value as 'both' | 'team')}>
          <option value="both">Both drivers</option><option value="team">Team only</option>
        </select></L>
        <div className="load-inc-list">
          {chk('stops', 'Stops & times')}{chk('rate', 'Rate & revenue')}{chk('ref', 'Reference / Conf #')}
          {chk('commodity', 'Commodity & weight')}{chk('authority', 'Booking authority')}{chk('notes', 'Dispatch notes')}
        </div>
        {missing.length > 0 && (
          <div className="load-missing">⚠ Missing before dispatch: {missing.join(' · ')}</div>
        )}
        <div className="load-dispatch-actions">
          <button className="am-save" onClick={copyImage}>📋 Copy image</button>
          <button className="am-clear" onClick={downloadPdf}>⭳ Download PDF</button>
          <button className="load-dispatch-btn" disabled={missing.length > 0}
            title={missing.length ? 'Fill the required fields first' : 'Set load to Dispatched + mark flyer sent'}
            onClick={() => onDispatched(sendTo)}>✓ Mark Dispatched & flyer sent</button>
        </div>
      </div>

      {/* live sheet preview — explicit colors (html2canvas-safe) */}
      <div className="load-sheet-wrap">
        <div ref={sheetRef} style={{ width: 420, background: '#ffffff', color: '#111827', fontFamily: 'Arial, sans-serif', padding: 18, borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #1e3a8a', paddingBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 18, color: '#1e3a8a' }}>GH LOGISTICS</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>DRIVER LOAD SHEET</div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, margin: '10px 0 2px' }}>{l.routeName || 'Load'}{seg && ` — ${seg.label}`}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
            Truck #{activeTruck}{team && (sendTo === 'both' ? ` · ${[team.driver1, team.driver2].filter(Boolean).join(' & ')}` : ' · Team')} · {l.date}
            {seg && ` · leg ${segIdx + 1} of ${l.segments.length}`}
          </div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><tbody>
            <Row k="Equipment" v={l.equipment || '—'} />
            {inc.commodity && <Row k="Commodity / Wt" v={[l.commodity, l.weight].filter(Boolean).join(' · ') || '—'} />}
            {inc.rate && <Row k={seg ? 'Segment rate' : 'Rate'} v={fmtMoney(activeRevenue)} strong />}
            {inc.ref && <Row k="Ref / Conf #" v={l.referenceNo || '—'} />}
            {inc.authority && <Row k="Booking auth." v={l.bookingAuthority || '—'} />}
          </tbody></table>
          {inc.stops && sorted.map((s, i) => (
            <div key={i} style={{ margin: '8px 0', padding: '7px 10px', borderRadius: 6, background: s.type === 'pickup' ? '#ecfdf5' : '#f5f3ff', borderLeft: `4px solid ${s.type === 'pickup' ? '#15803d' : '#7c5cff'}` }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: s.type === 'pickup' ? '#15803d' : '#6d28d9' }}>{s.type === 'pickup' ? 'PICKUP' : 'DELIVERY'} #{s.sequence}</div>
              <div style={{ fontSize: 12 }}>{[s.address, s.city, s.state, s.zip].filter(Boolean).join(', ') || '—'}</div>
              {s.dateTime && <div style={{ fontSize: 11, color: '#374151' }}>{s.dateTime.replace('T', ' · ')}</div>}
              {(s.poNumber || s.refNo) && <div style={{ fontSize: 11, color: '#374151' }}>{[s.poNumber && `PO ${s.poNumber}`, s.refNo && `Ref ${s.refNo}`].filter(Boolean).join(' · ')}</div>}
            </div>
          ))}
          {inc.notes && l.dispatchNotes && (
            <div style={{ marginTop: 8, fontSize: 11, background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6, padding: '6px 9px' }}>📝 {l.dispatchNotes}</div>
          )}
        </div>
      </div>
    </div>
  );
}
function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <tr><td style={{ color: '#6b7280', padding: '2px 8px 2px 0', whiteSpace: 'nowrap' }}>{k}</td><td style={{ fontWeight: strong ? 800 : 500 }}>{v}</td></tr>;
}

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="otp-field" style={{ marginTop: 4 }}><span className="otp-field-label">{t}</span>{children}</label>;
}
