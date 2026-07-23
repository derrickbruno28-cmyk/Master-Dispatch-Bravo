import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  blankLoad, loadForCell, saveLoad, clearLoadCell, missingForDispatch,
  fmtMoney, fmtMiles, fmtCpm, type Load, type LoadStop, blankStop,
} from '../data/loadsStore';
import { loadCustomers, ensureCustomer, LOAD_TYPES, EQUIPMENT_TYPES } from '../data/customersStore';
import { loadFleet, saveTruck } from '../data/fleetStore';
import { documentStore, type LoadDocument } from '../integrations/documents';
import { routingProvider } from '../integrations/routing';
import type { Assignment } from '../data/schedule';

/* Load Detail modal — replaces the old 3-field inline cell editor. Tabbed shell
   (Load Info · Stops · Customer · Documents · Dispatch) over the rich Load
   record; the board's Assignment (route/status/usps) is written on Save so all
   existing views stay in sync. Only the * fields block dispatch — everything
   else can stay blank. */

const STATUSES = ['open', 'covered', 'dispatched', 'at yard', 'at shipper', 'en route', 'at receiver', 'delivered', 'completed', 'off'];

type Tab = 'info' | 'stops' | 'customer' | 'docs' | 'dispatch';

export default function LoadDetailModal({ tractor, date, assignment, canDel, initialTab, warning, onSave, onClear, onClose }: {
  tractor: string; date: string; assignment?: Assignment; canDel: boolean; initialTab?: Tab; warning?: string;
  onSave: (a: Assignment) => void; onClear: () => void; onClose: () => void;
}) {
  const [l, setL] = useState<Load>(() => {
    const ex = loadForCell(tractor, date);
    if (ex) return ex;
    return blankLoad(tractor, date, assignment ? { routeName: assignment.route, status: assignment.status, uspsContract: assignment.usps } : {});
  });
  const [tab, setTab] = useState<Tab>(initialTab ?? 'info');
  const [notice, setNotice] = useState('');
  const f = <K extends keyof Load>(k: K, v: Load[K]) => setL((p) => ({ ...p, [k]: v }));

  const missing = missingForDispatch(l);

  async function persist(next?: Partial<Load>): Promise<Load> {
    let out = { ...l, ...next };
    if (out.customerName.trim() && !out.customerId) out = { ...out, customerId: ensureCustomer(out.customerName).id };
    const saved = await saveLoad(out);
    setL(saved);
    return saved;
  }
  async function saveAndClose() {
    if (!l.routeName.trim()) { setNotice('Route name is required to place the load on the board.'); setTab('info'); return; }
    const saved = await persist();
    onSave({ route: saved.routeName, status: saved.status, usps: saved.uspsContract });
  }

  return (
    <div className="fleet-modal-back" onClick={onClose}>
      <div className="fleet-modal load-modal" onClick={(e) => e.stopPropagation()}>
        {/* header: title + summary strip + actions */}
        <div className="load-head">
          <div>
            <h3>{l.routeName.trim() || 'New Load'} <span className="am-muted">· #{tractor} · {date}</span></h3>
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
          {([['info', 'Load Info'], ['stops', 'Stops'], ['customer', 'Customer'], ['docs', 'Documents'], ['dispatch', 'Dispatch']] as [Tab, string][]).map(([k, lab]) => (
            <button key={k} className={`load-tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{lab}</button>
          ))}
        </div>

        {warning && <div className="am-dblbook" style={{ marginBottom: 6 }}>{warning}</div>}
        {notice && <div className="am-notice">{notice}</div>}

        {tab === 'info' && <InfoTab l={l} f={f} canDel={canDel} onClear={() => { clearLoadCell(tractor, date); onClear(); }} />}
        {tab === 'stops' && <StopsTab l={l} setL={setL} />}
        {tab === 'customer' && <CustomerTab l={l} f={f} />}
        {tab === 'docs' && <DocsTab loadId={l.id} />}
        {tab === 'dispatch' && (
          <DispatchTab l={l} missing={missing} flash={setNotice}
            onDispatched={async (sendTo) => {
              const saved = await persist({ status: 'dispatched', dispatchedAt: new Date().toISOString() });
              const t = loadFleet().find((x) => x.tractor === saved.assignedTruck);
              if (t) saveTruck({ ...t, flyer: sendTo === 'team' ? 'team' : 'driver' });
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
function InfoTab({ l, f, canDel, onClear }: { l: Load; f: <K extends keyof Load>(k: K, v: Load[K]) => void; canDel: boolean; onClear: () => void }) {
  const customers = useMemo(() => loadCustomers(), []);
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <div className="load-info-grid">
      <div className="load-fields">
        <L t="Route name *"><input className="am-input" value={l.routeName} onChange={(e) => f('routeName', e.target.value)} placeholder="FA2D3-544 Irving→SATX" /></L>
        <div className="load-two">
          <L t="Customer *">
            <input className="am-input" list="load-customers" value={l.customerName} onChange={(e) => f('customerName', e.target.value)} placeholder="pick or type…" />
            <datalist id="load-customers">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </L>
          <L t="Load type *"><select className="am-input" value={l.loadType} onChange={(e) => f('loadType', e.target.value)}>{LOAD_TYPES.map((t) => <option key={t}>{t}</option>)}</select></L>
        </div>
        <div className="load-two">
          <L t="Equipment (van type) *"><select className="am-input" value={l.equipment} onChange={(e) => f('equipment', e.target.value)}>
            <option value="">— select —</option>{EQUIPMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select></L>
          <L t="Status"><select className="am-input" value={l.status} onChange={(e) => f('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></L>
        </div>
        <div className="load-two">
          <L t="Rate (revenue $)"><input className="am-input load-rate-input" type="number" value={l.rate ?? ''} onChange={(e) => f('rate', e.target.value === '' ? null : Number(e.target.value))} placeholder="0.00" /></L>
          <L t="Weight"><input className="am-input" value={l.weight} onChange={(e) => f('weight', e.target.value)} placeholder="e.g. 24,000 lbs" /></L>
        </div>
        <div className="load-two">
          <L t="Reference / Conf #"><input className="am-input" value={l.referenceNo} onChange={(e) => f('referenceNo', e.target.value)} /></L>
          <L t="Booking authority"><input className="am-input" value={l.bookingAuthority} onChange={(e) => f('bookingAuthority', e.target.value)} /></L>
        </div>
        <L t="Commodity"><input className="am-input" value={l.commodity} onChange={(e) => f('commodity', e.target.value)} /></L>
        <L t="Dispatch notes"><textarea className="am-input" rows={2} value={l.dispatchNotes} onChange={(e) => f('dispatchNotes', e.target.value)} /></L>
        <label className="am-usps-check"><input type="checkbox" checked={l.uspsContract} onChange={(e) => f('uspsContract', e.target.checked)} /> USPS contract route</label>
        <div className="load-clear-row">
          {confirmClear
            ? <><span className="am-muted">Remove this load from the board?</span>
                <button className="fleet-del" onClick={onClear}>✓ Remove</button>
                <button className="am-clear" onClick={() => setConfirmClear(false)}>Keep</button></>
            : canDel
              ? <button className="am-clear" onClick={() => setConfirmClear(true)}>🗑 Clear load off this day</button>
              : <button className="am-clear" disabled title="Deleting is restricted to FMT Lead / US Ops / Owner">🔒 Clear (restricted)</button>}
        </div>
      </div>
      <StopsPanel l={l} />
    </div>
  );
}

function StopsPanel({ l }: { l: Load }) {
  const sorted = l.stops.slice().sort((a, b) => a.sequence - b.sequence);
  return (
    <div className="load-stops-panel">
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
function StopsTab({ l, setL }: { l: Load; setL: React.Dispatch<React.SetStateAction<Load>> }) {
  const upd = (i: number, k: keyof LoadStop, v: string | number) =>
    setL((p) => ({ ...p, stops: p.stops.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));
  const add = (type: LoadStop['type']) =>
    setL((p) => ({ ...p, stops: [...p.stops, blankStop(type, p.stops.length + 1)] }));
  const del = (i: number) => setL((p) => ({ ...p, stops: p.stops.filter((_, j) => j !== i) }));
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
        <span className="am-muted">Distance & CPM recalculate on Save.</span>
      </div>
    </div>
  );
}

/* ---------------- Customer ---------------- */
function CustomerTab({ l, f }: { l: Load; f: <K extends keyof Load>(k: K, v: Load[K]) => void }) {
  const customers = useMemo(() => loadCustomers(), []);
  return (
    <div className="load-fields" style={{ maxWidth: 460 }}>
      <L t="Customer *">
        <input className="am-input" list="load-customers2" value={l.customerName} onChange={(e) => f('customerName', e.target.value)} />
        <datalist id="load-customers2">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      </L>
      <p className="am-muted" style={{ fontSize: 12 }}>Typing a new name registers the customer automatically on Save. Full customer profiles (contacts, billing) come with the shared database step.</p>
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

/* ---------------- Dispatch (sheet → clipboard PNG / PDF) ---------------- */
function DispatchTab({ l, missing, flash, onDispatched }: {
  l: Load; missing: string[]; flash: (m: string) => void;
  onDispatched: (sendTo: 'both' | 'team') => void | Promise<void>;
}) {
  const [sendTo, setSendTo] = useState<'both' | 'team'>('both');
  const [inc, setInc] = useState({ stops: true, rate: true, ref: true, commodity: true, authority: true, notes: true });
  const sheetRef = useRef<HTMLDivElement>(null);
  const team = loadFleet().find((t) => t.tractor === l.assignedTruck);

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
  const sorted = l.stops.slice().sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="load-dispatch-grid">
      <div>
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
          <div style={{ fontSize: 15, fontWeight: 700, margin: '10px 0 2px' }}>{l.routeName || 'Load'}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
            Truck #{l.assignedTruck}{team && (sendTo === 'both' ? ` · ${[team.driver1, team.driver2].filter(Boolean).join(' & ')}` : ' · Team')} · {l.date}
          </div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}><tbody>
            <Row k="Equipment" v={l.equipment || '—'} />
            {inc.commodity && <Row k="Commodity / Wt" v={[l.commodity, l.weight].filter(Boolean).join(' · ') || '—'} />}
            {inc.rate && <Row k="Rate" v={fmtMoney(l.rate)} strong />}
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
