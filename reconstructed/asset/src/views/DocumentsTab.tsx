/* Documents + billing gate — PHASE 4.

   The gate is the reason this screen exists: a load can't reach
   READY_FOR_ACCOUNTING without a BOL and a POD, and the person chasing paperwork
   needs to see WHICH one is missing without opening anything. So the gate banner
   is the first thing on the tab, and it names the missing document rather than
   just refusing.

   BOL and POD default to WITHHOLD (they don't ship with the invoice); everything
   else defaults to DELIVERABLE. That's the spec's default and it's per-document
   editable, because the exception exists. */

import { useEffect, useRef, useState } from 'react';
import { loadById, type Load } from '../data/loadsStore';
import { canDelete } from '../data/permStore';
import { onChange } from '../data/bus';
import { documentStore } from '../integrations/documents';
import {
  fetchDocs, storedDocs, uploadDoc, patchDoc, removeDoc, billingGate, setBillingStatus,
} from '../data/tms/documentsStore';
import { stopsFor } from '../data/tms/stopsStore';
import {
  DOC_TYPES, INVOICE_REQUIREMENTS, BILLING_STATUSES, BILLING_STATUS_LABEL,
  type DocType, type InvoiceRequirement, type BillingStatus, type TmsLoad,
} from '../data/tms/types';

const fmtSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);
const fmtWhen = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function DocumentsTab({ load: prop, onLoad }: { load: Load; onLoad?: (l: Load) => void }) {
  const [, force] = useState(0);
  const [docType, setDocType] = useState<DocType>('BOL');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmDel, setConfirmDel] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => onChange(() => force((n) => n + 1)), []);
  useEffect(() => { void fetchDocs(prop.id).then(() => force((n) => n + 1)); }, [prop.id]);

  /* READ THE LOAD FROM THE STORE, not the prop.
     The billing status moves on its own here — uploading the last missing
     document lifts MISSING_DOCS to READY_FOR_ACCOUNTING inside refreshDocFlags,
     which writes to the store and never touches the parent's copy. Rendering
     from the prop showed the OLD status after the auto-lift, so the screen said
     "still missing docs" over a green gate. The prop is only the fallback for a
     load that isn't in the store yet (a brand-new, unsaved one). */
  const load = loadById(prop.id) ?? prop;

  const docs = storedDocs(load.id);
  const gate = billingGate(load.id);
  const mayDelete = canDelete();
  const t = load as unknown as Partial<TmsLoad>;
  const billing = (t.billingStatus ?? 'NOT_READY') as BillingStatus;
  const stops = stopsFor(load);

  async function take(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true); setMsg('');
    try {
      for (const f of Array.from(files)) await uploadDoc({ load, file: f, docType });
      setMsg(`✓ ${files.length} ${docType} document${files.length === 1 ? '' : 's'} attached.`);
    } catch (e) {
      setMsg(`Upload failed — ${(e as Error).message}`);
    }
    setBusy(false); force((n) => n + 1);
  }

  async function view(id: string) {
    const blob = await documentStore().data(id);
    if (!blob) { setMsg('That file is no longer in storage.'); return; }
    window.open(URL.createObjectURL(blob), '_blank');
  }
  async function download(id: string, name: string) {
    const blob = await documentStore().data(id);
    if (!blob) { setMsg('That file is no longer in storage.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
  }
  /* Email is a mailto: hand-off, not a mail server. The app has no outbound mail
     of its own, so pretending to "send" would be a lie — this opens the user's
     mail client with the load already described and the file to attach named. */
  function email(fileName: string) {
    const subj = encodeURIComponent(`${t.loadNumber ? `Load ${t.loadNumber}` : load.routeName} — ${fileName}`);
    const body = encodeURIComponent(
      `Load: ${load.routeName}\nDate: ${load.date}\nDocument: ${fileName}\n\n(attach the file you just downloaded)`,
    );
    window.location.href = `mailto:?subject=${subj}&body=${body}`;
  }

  async function moveBilling(next: BillingStatus) {
    setBusy(true); setMsg('');
    const res = await setBillingStatus(load, next);
    setBusy(false);
    if (!res.ok) { setMsg(`⛔ Can't mark ${BILLING_STATUS_LABEL[next]} — ${res.reason}.`); return; }
    setMsg(`✓ Billing set to ${BILLING_STATUS_LABEL[next]}.`);
    onLoad?.({ ...load, ...({ billingStatus: next } as Partial<Load>) });
    force((n) => n + 1);
  }

  return (
    <div className="docs-wrap">
      {/* the gate, stated before anything else */}
      <div className={`docs-gate ${gate.ok ? 'ok' : ''}`}>
        {gate.ok
          ? <><b>✓ Billable</b> — BOL and POD are both attached, so this load can go to accounting.</>
          : <><b>⛔ Not billable yet</b> — still {gate.reason}. <span className="am-muted">
              READY FOR ACCOUNTING is blocked until both are here, in the app <b>and</b> on the server.</span></>}
      </div>

      <div className="docs-billing">
        <span className="load-field-label">Billing status</span>
        <select className="am-input" value={billing} disabled={busy}
          onChange={(e) => void moveBilling(e.target.value as BillingStatus)}>
          {BILLING_STATUSES.map((s) => <option key={s} value={s}>{BILLING_STATUS_LABEL[s]}</option>)}
        </select>
        <span className="am-muted">
          Delivered → Missing docs → Ready for accounting happens on its own as documents land;
          Invoiced and Paid are set by hand.
        </span>
      </div>

      <div className="docs-upload">
        <label className="load-field docs-type">
          <span className="load-field-label">Document type</span>
          <select className="am-input" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {DOC_TYPES.map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
          </select>
        </label>

        <div className={`ratecon-drop docs-drop ${drag ? 'on' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void take(e.dataTransfer.files); }}>
          <span>📎 Drop <b>{docType.replace(/_/g, ' ')}</b> files here</span>
          <button className="am-clear" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : 'Upload document'}
          </button>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
            onChange={(e) => { void take(e.target.files); e.target.value = ''; }} />
        </div>
      </div>

      {msg && <div className="am-notice" style={{ color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{msg}</div>}

      {docs.length === 0
        ? <div className="am-muted">No documents on this load yet.</div>
        : (
          <div className="docs-scroll">
            <table className="am-grid docs-table">
              <thead>
                <tr><th>Type</th><th>File</th><th>Invoice</th><th>Ties to</th><th>Expires</th><th>Size</th><th>Uploaded</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td><span className={`docs-type-pill ${d.docType === 'BOL' || d.docType === 'POD' ? 'req' : ''}`}>{d.docType.replace(/_/g, ' ')}</span></td>
                    <td className="docs-name">{d.fileName}</td>
                    <td>
                      <select className="am-input docs-in" value={d.invoiceRequirement}
                        onChange={(e) => void patchDoc(load.id, d.id, { invoiceRequirement: e.target.value as InvoiceRequirement })}>
                        {INVOICE_REQUIREMENTS.map((r) => <option key={r} value={r}>{r === 'WITHHOLD' ? 'Withhold' : 'Deliverable'}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="am-input docs-in" value={d.stopId}
                        onChange={(e) => void patchDoc(load.id, d.id, { stopId: e.target.value })}>
                        <option value="">— whole load —</option>
                        {stops.map((s) => <option key={s.id} value={s.id}>{s.type} #{s.seq}</option>)}
                      </select>
                    </td>
                    <td>
                      <input className="am-input docs-in" type="date" value={d.expirationDate}
                        onChange={(e) => void patchDoc(load.id, d.id, { expirationDate: e.target.value })} />
                      {d.daysRemaining != null && (
                        <div className={`am-muted docs-days ${d.daysRemaining < 0 ? 'expired' : ''}`}>
                          {d.daysRemaining < 0 ? `expired ${-d.daysRemaining}d ago` : `${d.daysRemaining}d left`}
                        </div>
                      )}
                    </td>
                    <td className="am-muted">{fmtSize(d.sizeBytes)}</td>
                    <td className="am-muted docs-when">{d.uploadedBy}<br />{fmtWhen(d.uploadedAt)}</td>
                    <td className="fleet-actions">
                      {confirmDel === d.id
                        ? <><span className="am-muted">Delete?</span>
                            <button className="fleet-del" onClick={() => { void removeDoc(load, d.id); setConfirmDel(''); }}>✓</button>
                            <button className="am-clear" onClick={() => setConfirmDel('')}>✕</button></>
                        : <>
                            <button className="am-clear" onClick={() => void view(d.id)}>View</button>
                            <button className="am-clear" onClick={() => void download(d.id, d.fileName)}>⭳</button>
                            <button className="am-clear" onClick={() => email(d.fileName)} title="Open your mail client with this load described">✉</button>
                            {mayDelete
                              ? <button className="fleet-del" onClick={() => setConfirmDel(d.id)}>🗑</button>
                              : <button className="am-clear" disabled title="Deleting is restricted to FMT Lead / US Ops / Owner">🔒</button>}
                          </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
