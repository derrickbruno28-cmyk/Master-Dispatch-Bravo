import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  blankLoad, loadForCell, loadById, saveLoad, clearLoadCell, missingForDispatch,
  buildSegments, proportionRevenue, syncSegmentAssignments,
  activeTrailerConflict, fmtMoney, fmtMiles, fmtCpm, type Load, type LoadStop, type LoadSegment, blankStop,
} from '../data/loadsStore';
import { loadCustomers, ensureCustomer, EQUIPMENT_TYPES } from '../data/customersStore';
import { loadFleet, saveTruck } from '../data/fleetStore';
import { loadTrailers } from '../data/trailersStore';
import { listAddresses } from '../data/addressStore';
import { routingProvider } from '../integrations/routing';
import { rateConParser } from '../integrations/ratecon';
import { LOAD_STATUS_LABEL, type Assignment } from '../data/schedule';
import AssignmentsSection from './AssignmentsSection';
import MilestonesTab from './MilestonesTab';
import TripPicker from './TripPicker';
import AppointmentsPanel from './AppointmentsPanel';
import DocumentsTab from './DocumentsTab';
import ExceptionsTab from './ExceptionsTab';
import { fetchExceptions, openExceptions } from '../data/tms/exceptionsStore';
import { onChange } from '../data/bus';
import NotesTab from './NotesTab';
import RateConReview from './RateConReview';
import { financialStrip, financialsOf } from '../data/tms/financials';
import { FSC_TYPES, BOOKING_AUTHORITIES, BOOKING_TERMINALS, type FscType, type LoadFinancials } from '../data/tms/types';
import { parseRateCon, type RateConProposal, type RateConPatch } from '../data/tms/rateconParse';
import {
  fetchNotes, noteCount, lockStateOf, acquireLock, heartbeat, releaseLock,
  forceUnlock, requestUnlock, LOCK_HEARTBEAT_MS,
} from '../data/tms/notesStore';
import { legsFor, missingForLegs, legTrucks, syncLegCells, seatName, driverNamesOf } from '../data/tms/assignmentsStore';
import type { LoadAssignment } from '../data/tms/types';

/* Load Detail modal — replaces the old 3-field inline cell editor. Tabbed shell
   (Load Info · Stops · Customer · Documents · Dispatch) over the rich Load
   record; the board's Assignment (route/status/usps) is written on Save so all
   existing views stay in sync. Only the * fields block dispatch — everything
   else can stay blank. */

const STATUSES = ['unassigned', 'open', 'covered', 'dispatched', 'at yard', 'at shipper', 'en route', 'at receiver', 'delivered', 'completed', 'off'];

type Tab = 'info' | 'stops' | 'milestones' | 'docs' | 'exceptions' | 'notes' | 'dispatch';

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
  const prevTrucks = useRef<string[]>(legTrucks(l));
  const f = <K extends keyof Load>(k: K, v: Load[K]) => setL((p) => ({ ...p, [k]: v }));

  /* PHASE 1: the legs are the assignment now. Leg 1 is MIRRORED back onto the
     legacy assignedTruck/assignedTrailer/driver fields so the board, the Loads
     ledger, Team Status and the reports keep working untouched while they're
     migrated one phase at a time. Drop this mirror only when nothing reads
     those fields any more. */
  const [legs, setLegs] = useState<LoadAssignment[]>(() => legsFor(l));
  function onLegs(next: LoadAssignment[]) {
    setLegs(next);
    const first = next[0];
    if (!first) return;
    setL((p) => ({
      ...p,
      assignedTruck: first.truckNumber,
      assignedTeamId: first.truckNumber,
      assignedTrailer: first.trailerNumber,
      driver1: seatName(first, 'primary'),
      driver2: seatName(first, 'co'),
    }));
  }

  /* the shell rules (route, customer, equipment, stops) plus every leg's own */
  const missing = [...missingForDispatch(l), ...missingForLegs(legs)];

  /* Phase 5 — an open exception is loud on the tab, so nobody has to open the
     tab to find out something went wrong. */
  useEffect(() => { void fetchExceptions(l.id); }, [l.id]);
  const openExc = openExceptions(l.id).length;
  useEffect(() => { void fetchNotes(l.id); }, [l.id]);
  const notes = noteCount(l.id);

  /* PHASE 7 — the record lock.
     Claimed when the card opens, refreshed on a timer while it stays open, and
     given back on close, on save, and on the tab going away. A lock that stops
     breathing for five minutes is treated as gone (see types.lockIsActive), so a
     closed laptop heals itself and nobody has to hunt for an admin. */
  const [lock, setLock] = useState(() => lockStateOf(l));
  useEffect(() => {
    let alive = true;
    void acquireLock(l).then((st) => { if (alive) setLock(st); });
    const t = window.setInterval(() => { void heartbeat(l.id); }, LOCK_HEARTBEAT_MS);
    const drop = () => { void releaseLock(l.id); };
    window.addEventListener('beforeunload', drop);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.removeEventListener('beforeunload', drop);
      drop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l.id]);
  /* re-read the claim on every store change — somebody else may have taken or
     released it while this card sat open */
  useEffect(() => onChange(() => setLock(lockStateOf(loadById(l.id) ?? l))), [l.id, l]);
  const readOnly = lock.readOnly;

  /* PHASE 8 — rate-con drop → parse → REVIEW SCREEN. The parse writes nothing
     and does not even touch the form: the proposal goes on screen field by
     field, and only "Apply" moves anything onto the load. */
  const [proposal, setProposal] = useState<RateConProposal | null>(null);
  const [rcFile, setRcFile] = useState<File | null>(null);
  async function onRateCon(file: File) {
    setNotice('⏳ Reading the rate con…');
    try {
      const res = await rateConParser().parse(file);
      const p = parseRateCon(res.text || '');
      setRcFile(file);
      setProposal(p);
      setNotice('');
      setTab('info');
    } catch {
      setNotice('Could not read that file — is it a PDF rate con? You can still fill the load in manually.');
    }
  }

  function applyProposal(patch: RateConPatch) {
    setL((prev) => {
      const next = { ...prev, ...(patch.load as Partial<Load>) } as Load;
      if (patch.stops.length) {
        const stops = prev.stops.slice();
        for (const ps of patch.stops) {
          let i = stops.findIndex((s) => s.type === ps.type);
          if (i < 0) { stops.push(blankStop(ps.type as LoadStop['type'], stops.length + 1)); i = stops.length - 1; }
          stops[i] = { ...stops[i], ...ps };
        }
        next.stops = stops;
      }
      return next;
    });
    setAutoFilled(new Set(Object.keys(patch.load)));
    setProposal(null); setRcFile(null);
    const n = patch.applied.length + patch.stops.length;
    setNotice(`✓ Applied ${n} item${n === 1 ? '' : 's'} from the rate con — nothing is saved until you press Save.`);
  }

  async function persist(next?: Partial<Load>): Promise<Load> {
    let out = { ...l, ...next };
    if (out.customerName.trim() && !out.customerId) out = { ...out, customerId: ensureCustomer(out.customerName).id };
    const saved = await saveLoad(out);
    setL(saved);
    return saved;
  }
  async function saveAndClose() {
    /* new/unassigned loads can be saved with NO route — the point is to start the
       schedule entry with a truck + drivers + date and fill the rest in later.
       Existing (cell-bound) loads still need a route to stay on the board. */
    if (!(newLoad || seedLoad) && !l.routeName.trim()) { setNotice('Route name is required to save the load.'); setTab('info'); return; }
    const saved = await persist();
    if (legs.length > 1 || saved.segments.length > 0) {
      /* multi-leg (or legacy split): a board cell per leg truck, clearing the
         rows this load no longer touches */
      if (legs.length > 1) await syncLegCells(saved, prevTrucks.current);
      else await syncSegmentAssignments(saved, prevTrucks.current);
      prevTrucks.current = legTrucks(saved);
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
              {/* PHASE 9 — the computed strip. Everything except rate, FSC and
                  empty miles is derived on read, so these can never disagree
                  with the inputs below them. */}
              {financialStrip(l).map((s) => (
                <Sum key={s.label} label={s.label} val={s.value} money={s.label === 'Revenue' || s.label === 'Flat Rate'} />
              ))}
              <Sum label="Stops" val={String(l.stops.length)} />
              <Sum label="Weight" val={l.weight || '—'} />
            </div>
          </div>
          <div className="load-head-btns">
            <button className="load-dispatch-btn" onClick={() => setTab('dispatch')}>⚡ Dispatch Driver</button>
            <button className="am-save" disabled={readOnly}
              title={readOnly ? `${lock.holder} has this load open — saving is off until they close it` : 'Save'}
              onClick={saveAndClose}>Save</button>
            <button className="am-cancel" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* tabs */}
        <div className="load-tabs">
          {([['info', 'Load Info'], ['stops', l.segments.length ? `Stops · ✂${l.segments.length}` : 'Stops'], ['milestones', 'Milestones'], ['docs', 'Documents'], ['exceptions', openExc > 0 ? `Exceptions · ⚠${openExc}` : 'Exceptions'], ['notes', notes > 0 ? `Notes · 💬${notes}` : 'Notes'], ['dispatch', 'Dispatch']] as [Tab, string][]).map(([k, lab]) => (
            <button key={k} className={`load-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{lab}</button>
          ))}
        </div>

        {readOnly && (
          <div className="lock-banner">
            🔒 <b>{lock.holder} has this load open.</b> You are reading it, not editing it — saving is
            off until they close it or their session times out.
            <span className="lock-actions">
              <button className="am-clear" onClick={() => void requestUnlock(l).then(() => setNotice('Asked them to close it — the request is in the notes thread.'))}>
                Ask them to close it
              </button>
              {canDel && (
                <button className="fleet-del" title="Break their claim. This is logged with their name."
                  onClick={() => void forceUnlock(l).then((r) => { setNotice(r.ok ? '✓ Lock released.' : r.reason); setLock(lockStateOf(loadById(l.id) ?? l)); })}>
                  Force unlock
                </button>
              )}
            </span>
          </div>
        )}
        {warning && <div className="am-dblbook" style={{ marginBottom: 6 }}>{warning}</div>}
        {notice && <div className="am-notice">{notice}</div>}

        {tab === 'info' && proposal && (
          <RateConReview proposal={proposal} load={l} file={rcFile}
            onApply={applyProposal} onCancel={() => { setProposal(null); setRcFile(null); }} />
        )}
        {tab === 'info' && !proposal && <InfoTab l={l} f={f} onLegs={onLegs} canDel={canDel} assignable={!!(newLoad || seedLoad)} autoFilled={autoFilled} onRateCon={onRateCon} onNotice={setNotice} onClear={() => { clearLoadCell(tractor, date); onClear(); }} />}
        {tab === 'stops' && <StopsTab l={l} setL={setL} persist={persist} />}
        {tab === 'milestones' && <MilestonesTab load={l} onStatus={() => setL((p) => ({ ...p }))} />}
        {tab === 'docs' && <DocumentsTab load={l} onLoad={(n) => setL(n)} />}
        {tab === 'exceptions' && <ExceptionsTab load={l} onOpenLoad={(n) => setL(n)} />}
        {tab === 'notes' && <NotesTab load={l} readOnly={readOnly} />}
        {tab === 'dispatch' && (
          <DispatchTab l={l} legs={legs} missing={missing} flash={setNotice}
            onDispatched={async (sendTo) => {
              const saved = await persist({
                status: 'dispatched', dispatchedAt: new Date().toISOString(),
                segments: l.segments.map((s) => ({ ...s, status: 'dispatched' })),
              });
              for (const truck of legTrucks(saved)) {
                const t = loadFleet().find((x) => x.tractor === truck);
                if (t) saveTruck({ ...t, flyer: sendTo === 'team' ? 'team' : 'driver' });
              }
              if (legs.length > 1 || saved.segments.length > 0) {
                if (legs.length > 1) await syncLegCells(saved, prevTrucks.current);
                else await syncSegmentAssignments(saved, prevTrucks.current);
                prevTrucks.current = legTrucks(saved);
                if (onCreated) onCreated(saved);
                onClose();
                return;
              }
              /* a freshly-created load dispatches through onCreated (places it on
                 the board); an existing cell dispatches through onSave. Without
                 this, dispatching a NEW load hit the no-op onSave and did nothing. */
              if (onCreated) { onCreated(saved); return; }
              onSave({ route: saved.routeName, status: 'dispatched', usps: saved.uspsContract });
            }} />
        )}
      </div>
    </div>
  );
}

/* One place that writes financials, so the nested object is never half-replaced.
   `f` is the InfoTab's field setter — the patch lands on the in-memory load and
   is saved with everything else, not written behind the user's back. */
function setFin(l: Load, f: <K extends keyof Load>(k: K, v: Load[K]) => void, patch: Partial<LoadFinancials>) {
  const next = { ...financialsOf(l), ...patch };
  (f as unknown as (k: string, v: unknown) => void)('financials', next);
}

function Sum({ label, val, money }: { label: string; val: string; money?: boolean }) {
  return <span className="load-sum"><span className="load-sum-label">{label}</span><b className={money ? 'load-sum-money' : ''}>{val}</b></span>;
}

/* ---------------- Load Info ---------------- */
function InfoTab({ l, f, canDel, assignable, autoFilled, onRateCon, onNotice, onClear, onLegs }: {
  l: Load; f: <K extends keyof Load>(k: K, v: Load[K]) => void; canDel: boolean; assignable?: boolean;
  autoFilled: Set<string>; onRateCon: (file: File) => void | Promise<void>; onNotice: (m: string) => void;
  onClear: () => void; onLegs: (legs: LoadAssignment[]) => void;
}) {
  const customers = useMemo(() => loadCustomers(), []);
  const trailers = useMemo(() => loadTrailers(), []);
  const [confirmClear, setConfirmClear] = useState(false);
  const [drag, setDrag] = useState(false);
  const hl = (k: string) => `am-input${autoFilled.has(k) ? ' load-autofilled' : ''}`;
  /* trailer safety lock: block a second trailer on a truck until its active
     route completes (which frees the trailer). Clearing is always allowed. */
  function trySetTrailer(v: string) {
    if (v.trim()) {
      const c = activeTrailerConflict(l.assignedTruck, l.id);
      if (c) { onNotice(`🔒 Truck #${l.assignedTruck} still has trailer #${c.assignedTrailer} on ${c.routeName || 'an active route'}${c.date ? ` (${c.date})` : ''}. Mark that route Completed to free the trailer before assigning a new one.`); return; }
    }
    f('assignedTrailer', v);
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
            <div className="load-assign-title">Schedule entry <span className="am-muted">— the day this load sits on the board. Trucks and crews are assigned per leg below; you can save with no route and fill the rest in later.</span></div>
            <div className="load-two">
              <L t="Route date (pickup day)"><input className="am-input" type="date" value={l.date} onChange={(e) => f('date', e.target.value)} /></L>
              <span />
            </div>
          </div>
        )}

        {/* PHASE 1: legs replace the single Truck # field. The first leg's truck
            is mirrored back onto the legacy assignedTruck/assignedTrailer fields
            by onLegs below, so the board and every pre-Phase-1 view keep working
            while they're migrated one at a time. */}
        <AssignmentsSection load={l} onChanged={onLegs} />
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
        <div className="load-two">
          <L t="Equipment (van type) *"><select className={hl('equipment')} value={l.equipment} onChange={(e) => f('equipment', e.target.value)}>
            <option value="">— select —</option>{EQUIPMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select></L>
          <L t="Trailer # (one per truck until this route completes)">
            <input className={`am-input load-trailer-input${l.assignedTrailer.trim() ? ' has-trailer' : ''}`} list="load-trailers"
              value={l.assignedTrailer} onChange={(e) => trySetTrailer(e.target.value)}
              placeholder={l.assignedTruck.trim() ? 'power-only? leave blank · else assign a trailer' : 'assign a truck first'}
              disabled={!l.assignedTruck.trim()} />
            <datalist id="load-trailers">{trailers.map((t) => <option key={t.number} value={t.number}>{[t.type, t.status].filter(Boolean).join(' · ')}</option>)}</datalist>
          </L>
        </div>
        <div className="load-two">
          <L t="Rate (revenue $)"><input className={`${hl('rate')} load-rate-input`} type="number" value={l.rate ?? ''}
            onChange={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); f('rate', v); setFin(l, f, { rate: v }); }} placeholder="0.00" /></L>
          {/* PHASE 9 — fuel surcharge. The TYPE is stored with the number because
              $0.42 per mile and 42% of the invoice are not the same money. */}
          <L t="FSC type">
            <select className="am-input" value={financialsOf(l).fscType}
              onChange={(e) => setFin(l, f, { fscType: e.target.value as FscType | '' })}>
              <option value="">— no fuel surcharge —</option>
              {FSC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </L>
          <L t="FSC rate"><input className="am-input" type="number" value={financialsOf(l).fscRate ?? ''}
            placeholder={financialsOf(l).fscType === 'Per Mile' ? '$ per mile' : financialsOf(l).fscType === 'Invoice %' ? 'percent' : 'dollars'}
            onChange={(e) => setFin(l, f, { fscRate: e.target.value === '' ? null : Number(e.target.value) })} /></L>
          <L t="Empty / deadhead miles"><input className="am-input" type="number" value={financialsOf(l).emptyMiles ?? ''}
            placeholder="0" onChange={(e) => setFin(l, f, { emptyMiles: e.target.value === '' ? null : Number(e.target.value) })} /></L>
          <L t="Weight"><input className={hl('weight')} value={l.weight} onChange={(e) => f('weight', e.target.value)} placeholder="e.g. 24,000 lbs" /></L>
        </div>
        <div className="load-two">
          <L t="Reference / Conf #"><input className={hl('referenceNo')} value={l.referenceNo} onChange={(e) => f('referenceNo', e.target.value)} /></L>
          {/* PHASE 10B.9 — five entities, not free text. A typo'd authority is a
              load that never shows up in its own company's numbers. */}
          <L t="Booking authority *">
            <select className={hl('bookingAuthority')} value={l.bookingAuthority}
              onChange={(e) => f('bookingAuthority', e.target.value)}>
              <option value="">— pick an authority —</option>
              {BOOKING_AUTHORITIES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </L>
        </div>
        {/* PHASE 10B.10 — the board filters by terminal but the load never carried
            one; it was being inferred from whichever truck happened to be on it. */}
        <div className="load-two">
          <L t="Booking terminal">
            <select className="am-input" value={(l as unknown as { bookingTerminal?: string }).bookingTerminal ?? ''}
              onChange={(e) => (f as unknown as (k: string, v: unknown) => void)('bookingTerminal', e.target.value)}>
              <option value="">— pick a terminal —</option>
              {BOOKING_TERMINALS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </L>
          <L t="Commodity"><input className={hl('commodity')} value={l.commodity} onChange={(e) => f('commodity', e.target.value)} /></L>
        </div>
        <L t="Dispatch notes"><textarea className="am-input" rows={2} value={l.dispatchNotes} onChange={(e) => f('dispatchNotes', e.target.value)} /></L>
        <label className="am-usps-check"><input type="checkbox" checked={l.uspsContract} onChange={(e) => f('uspsContract', e.target.checked)} /> USPS contract route</label>

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
  const [tripMsg, setTripMsg] = useState('');
  const upd = (i: number, k: keyof LoadStop, v: string | number) =>
    setL((p) => ({ ...p, stops: p.stops.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));
  const add = (type: LoadStop['type']) =>
    setL((p) => ({ ...p, stops: [...p.stops, blankStop(type, p.stops.length + 1)] }));
  const del = (i: number) => setL((p) => ({ ...p, stops: p.stops.filter((_, j) => j !== i) }));

  /* split control — live here next to ＋Pickup/＋Delivery so the split can be
     added and MOVED right from the stops list. Per-leg truck assignment lives
     here too (no separate Split tab). A "cut" is a stop index between pickup
     and delivery. */
  const sorted = useMemo(() => l.stops.slice().sort((a, b) => a.sequence - b.sequence), [l.stops]);
  const canSplit = sorted.length >= 3;
  const cuts = l.segments.slice(0, -1).map((s) => s.toStop);
  const fleet = useMemo(() => loadFleet(), []);
  const addrBook = useMemo(() => listAddresses(), []);
  /* pick a remembered street address → auto-fill the city/state/zip too */
  function setAddress(i: number, v: string) {
    const m = addrBook.find((a) => a.address.toLowerCase() === v.trim().toLowerCase());
    setL((p) => ({ ...p, stops: p.stops.map((s, j) => (j === i
      ? { ...s, address: v, ...(m ? { city: s.city || m.city, state: s.state || m.state, zip: s.zip || m.zip } : {}) }
      : s)) }));
  }

  /* live distance between each consecutive stop (haversine estimate) */
  const [legMiles, setLegMiles] = useState<(number | null)[]>([]);
  useEffect(() => {
    let off = false;
    (async () => {
      const rp = routingProvider();
      const out: (number | null)[] = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i], b = sorted[i + 1];
        out.push(await rp.laneMiles([{ city: a.city, state: a.state, address: a.address }, { city: b.city, state: b.state, address: b.address }]));
      }
      if (!off) setLegMiles(out);
    })();
    return () => { off = true; };
  }, [sorted]);

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
  async function updSeg(i: number, patch: Partial<LoadSegment>) {
    setL(await persist({ segments: l.segments.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  }
  const cutLabel = (c: number) => `#${sorted[c]?.sequence} ${[sorted[c]?.city, sorted[c]?.state].filter(Boolean).join(', ') || sorted[c]?.type || 'stop'}`;
  const stopIdxInSorted = (s: LoadStop) => sorted.findIndex((x) => x === s);

  return (
    <div>
      {/* PHASE 3: fill the load from a Load Repository trip. Proposes first,
          writes only what the reviewer ticks. */}
      <TripPicker load={l} onApplied={(next, summary) => { setL(next); setTripMsg(summary); }} />
      {tripMsg && <div className="intg-mock-note" style={{ borderColor: 'var(--green)' }}>{tripMsg}</div>}

      {l.stops.map((s, i) => (
        <div key={i} className={`load-stopedit ${s.type}`}>
          <div className="load-stopedit-head">
            <b>{s.type === 'pickup' ? '📦 Pickup' : '📍 Delivery'}</b>
            <input className="am-input load-seq" type="number" title="Sequence" value={s.sequence} onChange={(e) => upd(i, 'sequence', Number(e.target.value))} />
            <button className="fleet-del" onClick={() => del(i)}>🗑</button>
          </div>
          <div className="load-two">
            <input className="am-input" placeholder="Address" list="load-addresses" value={s.address} onChange={(e) => setAddress(i, e.target.value)} />
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
          {(() => { const si = stopIdxInSorted(s); return si >= 0 && si < sorted.length - 1
            ? <div className="load-leg-miles" title="Estimated distance to the next stop">↓ {legMiles[si] != null ? fmtMiles(legMiles[si]) : '…'} to next stop</div>
            : null; })()}
        </div>
      ))}
      <datalist id="load-addresses">{addrBook.map((a, i) => <option key={i} value={a.address}>{[a.city, a.state].filter(Boolean).join(', ')}</option>)}</datalist>
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
          <div className="load-split-ctl-row">
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
          </div>
          {/* per-leg assignment — each segment gets its own truck / revenue / status */}
          {l.segments.map((s, i) => (
            <div key={s.id} className="load-split-seg">
              <div className="load-split-seg-head">
                <b>Leg {i + 1}</b>
                <span className="am-muted">stops #{sorted[s.fromStop]?.sequence}→#{sorted[s.toStop]?.sequence} · {fmtMiles(s.segmentMiles)} · {fmtCpm(s.segmentCpm)}</span>
              </div>
              <div className="load-three">
                <L t="Truck #">
                  <input className="am-input" list="load-trucks-split" value={s.assignedTruck}
                    onChange={(e) => updSeg(i, { assignedTruck: e.target.value, assignedTeamId: e.target.value })} placeholder="type a truck #" />
                </L>
                <L t="Leg revenue $"><input className="am-input load-rate-input" type="number" value={s.segmentRevenue ?? ''} onChange={(e) => updSeg(i, { segmentRevenue: e.target.value === '' ? null : Number(e.target.value) })} /></L>
                <L t="Status"><select className="am-input" value={s.status} onChange={(e) => updSeg(i, { status: e.target.value })}>{STATUSES.map((x) => <option key={x} value={x}>{LOAD_STATUS_LABEL[x] ?? x}</option>)}</select></L>
              </div>
            </div>
          ))}
          <datalist id="load-trucks-split">{fleet.map((t) => <option key={t.tractor} value={t.tractor}>{[t.driver1, t.driver2].filter(Boolean).join(' / ') || t.type}</option>)}</datalist>
        </div>
      )}

      {/* PHASE 3: the appointment WINDOW lives on the stops subcollection — it's
          what gives At Risk something to measure against. */}
      <AppointmentsPanel load={l} />
    </div>
  );
}

/* ---------------- Dispatch (sheet → clipboard PNG / PDF) ---------------- */
function DispatchTab({ l, legs, missing, flash, onDispatched }: {
  l: Load; legs: LoadAssignment[]; missing: string[]; flash: (m: string) => void;
  onDispatched: (sendTo: 'both' | 'team') => void | Promise<void>;
}) {
  const [sendTo, setSendTo] = useState<'both' | 'team'>('both');
  const [inc, setInc] = useState({ stops: true, rate: true, ref: true, commodity: true, authority: true, notes: true });
  const [sheetIdx, setSheetIdx] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const allSorted = l.stops.slice().sort((a, b) => a.sequence - b.sequence);

  /* PHASE 1: one sheet per LEG, plus one per individual DRIVER on that leg —
     the Load/Driver Sheet dropdown. A driver sheet is the same leg cropped to
     the one person, so a co-driver gets a sheet with their own name on it
     instead of a copy addressed to the team. */
  const sheets = useMemo(() => {
    const out: { key: string; label: string; leg: LoadAssignment; driver?: string }[] = [];
    for (const g of legs) {
      const names = driverNamesOf(g);
      const who = names.length ? names.join(' / ') : 'no driver';
      out.push({
        key: `${g.id}`,
        label: `${legs.length > 1 ? `Leg ${g.legIndex} of ${legs.length}` : 'Load sheet'} · #${g.truckNumber || '—'} · ${who}`,
        leg: g,
      });
      if (names.length > 1) {
        for (const n of names) out.push({ key: `${g.id}:${n}`, label: `    ↳ Driver sheet · ${n} · #${g.truckNumber || '—'}`, leg: g, driver: n });
      }
    }
    return out;
  }, [legs]);

  const active = sheets[Math.min(sheetIdx, sheets.length - 1)] ?? sheets[0];
  const activeLeg = active?.leg;
  const activeTruck = activeLeg?.truckNumber || l.assignedTruck;
  /* leg stop range is 1-based and inclusive; slice is 0-based and exclusive */
  const activeStops = activeLeg
    ? allSorted.slice(Math.max(0, activeLeg.fromStopSeq - 1), activeLeg.toStopSeq)
    : allSorted;
  const activeRevenue = legs.length > 1 ? null : l.rate;
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
        {sheets.length > 1 && (
          <L t={`Load / Driver sheet (${sheets.length}) — one per leg, plus one per driver`}>
            <select className="am-input" value={sheetIdx} onChange={(e) => setSheetIdx(Number(e.target.value))}>
              {sheets.map((sh, i) => <option key={sh.key} value={i}>{sh.label}</option>)}
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
            title={missing.length ? 'Fill the required fields first' : 'Set the load to Dispatched + mark the load info sent to the driver/team'}
            onClick={() => { flash('✓ Marked Dispatched — load info sent to the driver/team.'); onDispatched(sendTo); }}>✓ Mark Dispatched &amp; Load Info Sent</button>
        </div>
      </div>

      {/* live sheet preview — explicit colors (html2canvas-safe) */}
      <div className="load-sheet-wrap">
        <div ref={sheetRef} style={{ width: 420, background: '#ffffff', color: '#111827', fontFamily: 'Arial, sans-serif', padding: 18, borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #1e3a8a', paddingBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 18, color: '#1e3a8a' }}>GH LOGISTICS</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>DRIVER LOAD SHEET</div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, margin: '10px 0 2px' }}>
            {l.routeName || 'Load'}{activeLeg && legs.length > 1 ? ` — ${activeLeg.legType}` : ''}
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
            Truck #{activeTruck || '—'}
            {/* a DRIVER sheet is addressed to that one person; a leg sheet lists the crew */}
            {active?.driver
              ? ` · ${active.driver}`
              : (activeLeg && driverNamesOf(activeLeg).length
                  ? ` · ${sendTo === 'both' ? driverNamesOf(activeLeg).join(' & ') : 'Team'}`
                  : (team ? ` · ${[team.driver1, team.driver2].filter(Boolean).join(' & ')}` : ''))}
            {' · '}{l.date}
            {legs.length > 1 && activeLeg ? ` · leg ${activeLeg.legIndex} of ${legs.length}` : ''}
          </div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><tbody>
            <Row k="Equipment" v={l.equipment || '—'} />
            {inc.commodity && <Row k="Commodity / Wt" v={[l.commodity, l.weight].filter(Boolean).join(' · ') || '—'} />}
            {inc.rate && legs.length === 1 && <Row k="Rate" v={fmtMoney(activeRevenue)} strong />}
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
