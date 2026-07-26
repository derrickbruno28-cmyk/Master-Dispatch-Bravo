import { useEffect, useMemo, useRef, useState } from 'react';
import { loadTrailers, saveTrailer, removeTrailer, blankTrailer, importTrailersCsv, TRAILER_TYPES, TRAILER_STATUSES, type Trailer } from '../data/trailersStore';
import { canDelete } from '../data/permStore';
import { onChange } from '../data/bus';

/* Trailers — the trailer pool. Add / edit / remove trailers, track type, status
   and where each one sits. (Trucks and Teams live on their own pages.) */

const STATUS_COLOR: Record<string, string> = {
  'available': 'var(--green)', 'in use': 'var(--accent)', 'in shop': 'var(--amber)', 'out of service': 'var(--red)',
};

export default function TrailersView() {
  const [trailers, setTrailers] = useState<Trailer[]>(() => loadTrailers());
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Trailer | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [canDel, setCanDel] = useState<boolean>(() => canDelete());

  useEffect(() => onChange(() => { setTrailers(loadTrailers()); setCanDel(canDelete()); }), []);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return trailers.filter((t) => !n || `${t.number} ${t.type} ${t.status} ${t.location} ${t.notes}`.toLowerCase().includes(n));
  }, [trailers, q]);

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Trailers</h2>
        <input className="am-input" style={{ maxWidth: 220 }} placeholder="Search trailer / status / location…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="am-muted">{rows.length} of {trailers.length} trailers</span>
        <button className="am-clear" onClick={() => setImportOpen((o) => !o)}>⭳ Import trailers (CSV)</button>
        <button className="am-save fleet-add" onClick={() => { setEditing(blankTrailer()); setIsNew(true); }}>＋ Add Trailer</button>
      </div>

      {/* PHASE 10A — the owned-trailer list arrives as a spreadsheet, so it
          imports as one. Matching is by trailer number, so re-importing an
          updated list corrects records instead of duplicating them. */}
      {importOpen && (
        <div className="exc-form">
          <div className="am-muted">Columns: <b>trailer #, type, status, location, notes</b>. A header row is optional.</div>
          <textarea className="am-input" rows={5} value={csv} placeholder={'53044,53\' Dry Van,Available,San Antonio,\n53045,53\' Reefer,In Shop,Dallas,brakes'}
            onChange={(e) => setCsv(e.target.value)} />
          <div className="exc-actions">
            <button className="am-save" disabled={!csv.trim()} onClick={() => {
              const r = importTrailersCsv(csv);
              setTrailers(loadTrailers()); setCsv('');
              setImportMsg(`✓ ${r.added} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (no trailer #)` : ''}.`);
            }}>Import</button>
            <button className="am-clear" onClick={() => fileRef.current?.click()}>Choose a CSV file…</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setCsv); e.target.value = ''; }} />
            <button className="am-clear" onClick={() => { setImportOpen(false); setCsv(''); }}>Close</button>
            {importMsg && <span className="am-muted">{importMsg}</span>}
          </div>
        </div>
      )}

      <div className="am-scroll">
        <table className="am-grid am-fleet">
          <thead><tr><th>Trailer #</th><th>Type</th><th>Status</th><th>Location</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="am-muted" style={{ textAlign: 'center', padding: 16 }}>No trailers.</td></tr>}
            {rows.map((t) => (
              <tr key={t.number}>
                <td className="am-tractor">#{t.number}</td>
                <td className="am-muted">{t.type}</td>
                <td><span className="am-pill" style={{ color: STATUS_COLOR[t.status.toLowerCase()] ?? 'var(--muted)' }}>{t.status}</span></td>
                <td className="am-muted">{t.location || '—'}</td>
                <td className="fleet-constraints">{t.notes || <span className="am-muted">—</span>}</td>
                <td className="fleet-actions">
                  {confirmDel === t.number ? (
                    <>
                      <span className="am-muted" style={{ fontSize: 10.5 }}>Remove?</span>
                      <button className="fleet-del" onClick={() => { setTrailers(removeTrailer(t.number)); setConfirmDel(null); }}>✓</button>
                      <button className="am-clear" onClick={() => setConfirmDel(null)}>✕</button>
                    </>
                  ) : (
                    <>
                      <button className="am-clear" onClick={() => { setEditing({ ...t }); setIsNew(false); }}>✎ Edit</button>
                      {canDel
                        ? <button className="fleet-del" onClick={() => setConfirmDel(t.number)}>🗑</button>
                        : <button className="fleet-del" disabled title="Removing is restricted to FMT Lead / US Ops / Owner">🔒</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <TrailerEditor trailer={editing} isNew={isNew} onSave={(t) => { setTrailers(saveTrailer(t)); setEditing(null); }} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function TrailerEditor({ trailer, isNew, onSave, onCancel }: { trailer: Trailer; isNew: boolean; onSave: (t: Trailer) => void; onCancel: () => void }) {
  const [t, setT] = useState<Trailer>(trailer);
  const f = <K extends keyof Trailer>(k: K, v: Trailer[K]) => setT((p) => ({ ...p, [k]: v }));
  return (
    <div className="fleet-modal-back" onClick={onCancel}>
      <div className="fleet-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Add Trailer' : `Edit Trailer #${trailer.number}`}</h3>
        <div className="fleet-form-grid">
          <label className="otp-field"><span className="otp-field-label">Trailer #</span>
            <input className="am-input" value={t.number} disabled={!isNew} onChange={(e) => f('number', e.target.value)} placeholder="e.g. 53012" /></label>
          <label className="otp-field"><span className="otp-field-label">Type</span>
            <select className="am-input" value={t.type} onChange={(e) => f('type', e.target.value)}>{TRAILER_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="otp-field"><span className="otp-field-label">Status</span>
            <select className="am-input" value={t.status} onChange={(e) => f('status', e.target.value)}>{TRAILER_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="otp-field"><span className="otp-field-label">Current location</span>
            <input className="am-input" value={t.location} onChange={(e) => f('location', e.target.value.toUpperCase())} placeholder="city / yard" /></label>
        </div>
        <label className="otp-field" style={{ marginTop: 4 }}><span className="otp-field-label">Notes</span>
          <textarea className="am-input" rows={2} value={t.notes} onChange={(e) => f('notes', e.target.value)} /></label>
        <div className="fleet-modal-btns">
          <button className="am-save" disabled={!t.number.trim()} onClick={() => onSave(t)}>{isNew ? 'Add trailer' : 'Save changes'}</button>
          <button className="am-cancel" onClick={onCancel}>Cancel</button>
          {!t.number.trim() && <span className="am-muted" style={{ fontSize: 11, color: 'var(--red)' }}>Trailer # is required.</span>}
        </div>
      </div>
    </div>
  );
}
