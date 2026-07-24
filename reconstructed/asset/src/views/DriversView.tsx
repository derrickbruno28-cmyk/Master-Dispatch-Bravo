import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadDrivers, saveDriver, removeDriver, blankDriver, importDriversCsv,
  availabilityOf, daysUntil, todayISO, AVAIL_PATTERNS,
  DEFAULT_POSITIONS, type Driver,
} from '../data/driversStore';
import { loadFleet } from '../data/fleetStore';
import { onChange } from '../data/bus';
import { canDelete } from '../data/permStore';

/* Master Drivers List — the driver-availability hub. Every driver carries a
   ready-to-go date, a return-home date, and a weekly availability pattern.
   Alerts at the top flag anyone missing a ready or return date; a blinking
   green LED marks who's AVAILABLE; a driver whose team already has a route on
   the Asset Matrix shows ASSIGNED so we can't double-book. Click the Driver or
   Position header to sort; filter by position with the chips. */

type SortKey = 'name' | 'position';

export default function DriversView({ seed }: { seed?: { q: string; nonce: number } } = {}) {
  const [drivers, setDrivers] = useState<Driver[]>(() => loadDrivers());
  const [q, setQ] = useState('');

  /* global search can jump here pre-filtered to a driver */
  useEffect(() => { if (seed && seed.q) setQ(seed.q); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [seed?.nonce]);
  const [posFilter, setPosFilter] = useState<string>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [canDel, setCanDel] = useState<boolean>(() => canDelete());
  const fileRef = useRef<HTMLInputElement>(null);

  /* live sync — a team going NTB on the Fleet card / Matrix reflects here too;
     also refresh delete access in case the role changed (demo switch / sign-in) */
  useEffect(() => onChange(() => { setDrivers(loadDrivers()); setCanDel(canDelete()); }), []);

  /* live availability for every driver, recomputed whenever the roster changes */
  const avail = useMemo(() => new Map(drivers.map((d) => [d.id, availabilityOf(d)])), [drivers]);

  /* each driver's team status (NTB / Deadhead / …) so the list stays congruent
     with the Fleet card and the Matrix */
  const teamStatusByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of loadFleet()) for (const nm of [t.driver1, t.driver2]) if ((nm || '').trim()) m.set(nm.trim().toLowerCase(), t.status);
    return m;
  }, [drivers]);

  const positions = useMemo(() => {
    const s = new Set<string>(DEFAULT_POSITIONS);
    for (const d of drivers) if (d.position) s.add(d.position);
    return [...s];
  }, [drivers]);

  /* alerts — who is missing a ready date / a return date, who's due home soon */
  const alerts = useMemo(() => {
    const noReady = drivers.filter((d) => !d.readyDate);
    const noReturn = drivers.filter((d) => !d.returnDate);
    const dueSoon = drivers
      .map((d) => ({ d, left: daysUntil(d.returnDate) }))
      .filter((x) => x.left !== null && x.left >= 0 && x.left <= 3)
      .sort((a, b) => (a.left! - b.left!));
    const overdue = drivers
      .map((d) => ({ d, left: daysUntil(d.returnDate) }))
      .filter((x) => x.left !== null && x.left < 0);
    const flagged = drivers.filter((d) => (d.flag || '').trim());
    return { noReady, noReturn, dueSoon, overdue, flagged };
  }, [drivers]);

  const availCount = useMemo(() => [...avail.values()].filter((a) => a.available).length, [avail]);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    let list = drivers.filter((d) => !n || `${d.name} ${d.position} ${d.constraints} ${d.address}`.toLowerCase().includes(n));
    if (posFilter !== 'ALL') list = list.filter((d) => d.position === posFilter);
    const cmp = (a: Driver, b: Driver) => (sortKey === 'name'
      ? a.name.localeCompare(b.name)
      : (a.position.localeCompare(b.position) || a.name.localeCompare(b.name)));
    return [...list].sort((a, b) => cmp(a, b) * sortDir);
  }, [drivers, q, posFilter, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(1); }
  }
  const sortArrow = (k: SortKey) => (sortKey === k ? (sortDir === 1 ? ' ▲' : ' ▼') : '');

  function commit(d: Driver) {
    setDrivers(saveDriver(d)); setEditing(null);
  }
  function del(id: string) {
    setDrivers(removeDriver(id)); setConfirmDel(null);
  }
  function runImport(text: string) {
    const res = importDriversCsv(text);
    setDrivers(loadDrivers());
    setImportMsg(`✓ Imported — ${res.added} added, ${res.updated} updated.`);
    setCsv('');
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    f.text().then(runImport);
    if (fileRef.current) fileRef.current.value = '';
  }

  /* Export the CURRENT (filtered) roster to CSV so it can be compared against an
     existing driver list. Exports every column plus live availability + team status. */
  function exportCsv() {
    const esc = (v: string) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const availLabel = (d: Driver) => {
      const ts = (teamStatusByName.get(d.name.trim().toLowerCase()) || '').toLowerCase();
      if (ts === 'ntb') return 'NTB — needs load';
      const a = avail.get(d.id);
      if (a?.assigned) return `Assigned (${a.assigned.route})`;
      if (a?.available) return 'Available';
      return !d.readyDate ? 'No ready date' : (a && a.daysLeft !== null && a.daysLeft < 0 ? 'Past due' : 'Out');
    };
    const cols = ['Name', 'Position', 'Home City', 'Phone', 'Address', 'Constraints', 'Ready Date', 'Return Date', 'Pattern', 'Review Flag', 'Availability', 'Team Status'];
    const lines = [cols.join(',')];
    for (const d of rows) {
      lines.push([
        d.name, d.position, d.homeCity, d.phone, d.address, d.constraints,
        d.readyDate, d.returnDate, d.pattern, d.flag, availLabel(d),
        teamStatusByName.get(d.name.trim().toLowerCase()) || '',
      ].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `asset-drivers-${todayISO()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Driver Availability</h2>
        <input className="am-input" style={{ maxWidth: 240 }} placeholder="Search name / position / constraint…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="am-muted">{rows.length} of {drivers.length} drivers</span>
        <span className="drv-availtag"><span className="drv-led" /> {availCount} available</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="am-clear" onClick={exportCsv} disabled={rows.length === 0} title="Download the current list as a CSV to compare with another roster">⭱ Export CSV</button>
          <button className="am-clear" onClick={() => setImportOpen((o) => !o)}>⭳ Import</button>
          <button className="am-save" onClick={() => { setEditing(blankDriver()); setIsNew(true); }}>＋ Add Driver</button>
        </div>
      </div>

      {/* availability alerts */}
      {(alerts.noReady.length > 0 || alerts.noReturn.length > 0 || alerts.dueSoon.length > 0 || alerts.overdue.length > 0 || alerts.flagged.length > 0) && (
        <div className="drv-alerts">
          {alerts.flagged.length > 0 && (
            <div className="drv-alert drv-alert-bad">
              🚩 <b>{alerts.flagged.length}</b> driver{alerts.flagged.length > 1 ? 's' : ''} to review:
              <span className="drv-alert-names"> {alerts.flagged.map((d) => `${d.name} (${d.flag})`).join(', ')}</span>
            </div>
          )}
          {alerts.noReady.length > 0 && (
            <div className="drv-alert drv-alert-warn">
              ⚠ <b>{alerts.noReady.length}</b> driver{alerts.noReady.length > 1 ? 's' : ''} with <b>no ready-to-go date</b>:
              <span className="drv-alert-names"> {alerts.noReady.map((d) => d.name).join(', ')}</span>
            </div>
          )}
          {alerts.noReturn.length > 0 && (
            <div className="drv-alert drv-alert-warn">
              ⚠ <b>{alerts.noReturn.length}</b> driver{alerts.noReturn.length > 1 ? 's' : ''} with <b>no return date</b>:
              <span className="drv-alert-names"> {alerts.noReturn.map((d) => d.name).join(', ')}</span>
            </div>
          )}
          {alerts.overdue.length > 0 && (
            <div className="drv-alert drv-alert-bad">
              🔴 <b>{alerts.overdue.length}</b> past due home:
              <span className="drv-alert-names"> {alerts.overdue.map((x) => `${x.d.name} (${-x.left!}d over)`).join(', ')}</span>
            </div>
          )}
          {alerts.dueSoon.length > 0 && (
            <div className="drv-alert drv-alert-soon">
              ⏰ due home soon:
              <span className="drv-alert-names"> {alerts.dueSoon.map((x) => `${x.d.name} (${x.left === 0 ? 'today' : `${x.left}d`})`).join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {importOpen && (
        <div className="otp-form">
          <div className="otp-field-label" style={{ marginBottom: 6 }}>Import drivers (CSV) — columns: <b>name, position, homecity, address, phone, constraints, ready, return, pattern</b> (a header row is auto-detected)</div>
          <textarea className="am-input" rows={5} placeholder={'name,position,homecity,address,phone,constraints,ready,return,pattern\nJohn Smith,SATX Hero,San Antonio TX,"123 Main St, San Antonio TX",210-555-0100,no NYC,2026-07-21,2026-07-27,Mon–Sat'} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <div className="otp-form-btns">
            <button className="am-save" onClick={() => runImport(csv)} disabled={!csv.trim()}>Import pasted CSV</button>
            <label className="am-clear" style={{ cursor: 'pointer' }}>⭳ Upload .csv<input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={onFile} /></label>
            {importMsg && <span className="am-muted" style={{ color: 'var(--green)' }}>{importMsg}</span>}
          </div>
        </div>
      )}

      {/* position filter chips */}
      <div className="am-termfilter drv-posfilter">
        {(['ALL', ...positions] as string[]).map((p) => (
          <button key={p} className={`am-tchip ${posFilter === p ? 'on' : ''}`} onClick={() => setPosFilter(p)}>
            {p === 'ALL' ? 'All positions' : p}
          </button>
        ))}
      </div>

      <div className="am-scroll">
        <table className="am-grid am-fleet drv-table">
          <thead>
            <tr>
              <th className="drv-sortable" onClick={() => toggleSort('name')}>Driver{sortArrow('name')}</th>
              <th className="drv-sortable" onClick={() => toggleSort('position')}>Position{sortArrow('position')}</th>
              <th>Availability</th>
              <th>Ready</th>
              <th>Return</th>
              <th>Pattern</th>
              <th>Constraints</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="am-muted" style={{ textAlign: 'center', padding: 18 }}>No drivers. Add one, or Import a roster.</td></tr>
            ) : rows.map((d) => {
              const a = avail.get(d.id)!;
              return (
                <tr key={d.id}>
                  <td className="am-tractor">{d.name}{(d.flag || '').trim() && <span className="drv-flag" title={d.flag}>🚩 {d.flag}</span>}</td>
                  <td><span className="am-pill" style={{ color: 'var(--accent)' }}>{d.position}</span></td>
                  <td>
                    {(teamStatusByName.get(d.name.trim().toLowerCase()) || '').toLowerCase() === 'ntb' ? (
                      <span className="drv-ntb" title="This driver's team is Need-To-Book — needs a load">NTB — needs load</span>
                    ) : a.assigned ? (
                      <span className="drv-assigned" title={`On ${a.assigned.route} (#${a.assigned.tractor}) ${a.assigned.date}`}>ASSIGNED</span>
                    ) : a.available ? (
                      <span className="drv-avail"><span className="drv-led" /> Available</span>
                    ) : (
                      <span className="drv-unavail">{!d.readyDate ? 'No ready date' : (a.daysLeft !== null && a.daysLeft < 0 ? 'Past due' : 'Out')}</span>
                    )}
                  </td>
                  <td className="am-muted">{d.readyDate || <span className="drv-miss">— none —</span>}</td>
                  <td className="am-muted">
                    {d.returnDate
                      ? <span>{d.returnDate}{a.daysLeft !== null && <span className={`drv-days ${a.daysLeft < 0 ? 'over' : a.daysLeft <= 3 ? 'soon' : ''}`}>{a.daysLeft < 0 ? `${-a.daysLeft}d over` : a.daysLeft === 0 ? 'today' : `${a.daysLeft}d left`}</span>}</span>
                      : <span className="drv-miss">— none —</span>}
                  </td>
                  <td>{d.pattern ? <span className="drv-pat">{d.pattern}</span> : <span className="am-muted">—</span>}</td>
                  <td className="fleet-constraints">{d.constraints || <span className="am-muted">—</span>}</td>
                  <td className="fleet-actions">
                    {confirmDel === d.id ? (
                      <>
                        <span className="am-muted" style={{ fontSize: 10.5 }}>Remove?</span>
                        <button className="fleet-del" title="Confirm remove" onClick={() => del(d.id)}>✓</button>
                        <button className="am-clear" title="Keep" onClick={() => setConfirmDel(null)}>✕</button>
                      </>
                    ) : (
                      <>
                        <button className="am-clear" onClick={() => { setEditing({ ...d }); setIsNew(false); }}>✎ Edit</button>
                        {canDel
                          ? <button className="fleet-del" onClick={() => setConfirmDel(d.id)}>🗑</button>
                          : <button className="fleet-del" disabled title="Deleting a driver is restricted to FMT Lead / US Ops / Owner">🔒</button>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && <DriverEditor driver={editing} isNew={isNew} onSave={commit} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function DriverEditor({ driver, isNew, onSave, onCancel }: { driver: Driver; isNew: boolean; onSave: (d: Driver) => void; onCancel: () => void }) {
  const [d, setD] = useState<Driver>(driver);
  function f<K extends keyof Driver>(k: K, v: Driver[K]) { setD((p) => ({ ...p, [k]: v })); }
  const left = daysUntil(d.returnDate);
  return (
    <div className="fleet-modal-back" onClick={onCancel}>
      <div className="fleet-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? 'Add Driver' : `Edit ${driver.name}`}</h3>
        <div className="fleet-form-grid">
          <L t="Name"><input className="am-input" value={d.name} onChange={(e) => f('name', e.target.value)} /></L>
          <L t="Position"><select className="am-input" value={d.position} onChange={(e) => f('position', e.target.value)}>
            {!DEFAULT_POSITIONS.includes(d.position) && d.position && <option value={d.position}>{d.position}</option>}
            {DEFAULT_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></L>
          <L t="Home city (where they're picked up — e.g. Dallas TX)"><input className="am-input" value={d.homeCity} onChange={(e) => f('homeCity', e.target.value)} placeholder="e.g. San Antonio TX" /></L>
          <L t="Phone"><input className="am-input" value={d.phone} onChange={(e) => f('phone', e.target.value)} /></L>
          <L t="Address"><input className="am-input" value={d.address} onChange={(e) => f('address', e.target.value)} /></L>
        </div>

        <div className="fleet-form-grid">
          <L t="Ready-to-go date"><input className="am-input" type="date" value={d.readyDate} onChange={(e) => f('readyDate', e.target.value)} /></L>
          <L t={`Return-home date${left !== null ? left < 0 ? ` · ${-left}d over` : ` · ${left}d left` : ''}`}>
            <input className="am-input" type="date" value={d.returnDate} onChange={(e) => f('returnDate', e.target.value)} />
          </L>
        </div>

        <div className="otp-field" style={{ marginTop: 4 }}>
          <span className="otp-field-label">Availability pattern</span>
          <div className="drv-pat-choices">
            {AVAIL_PATTERNS.map((p) => (
              <label key={p} className={`drv-pat-check ${d.pattern === p ? 'on' : ''}`}>
                <input type="checkbox" checked={d.pattern === p} onChange={() => f('pattern', d.pattern === p ? '' : p)} />
                {p}
              </label>
            ))}
          </div>
        </div>

        <L t="Constraints (e.g. no NYC · solo only · hazmat · home by Fri)">
          <textarea className="am-input" rows={2} value={d.constraints} onChange={(e) => f('constraints', e.target.value)} />
        </L>
        <L t="🚩 Review flag (needs 1-on-1 · unresponsive · off · no terminal … clear when resolved)">
          <input className="am-input" value={d.flag} onChange={(e) => f('flag', e.target.value)} placeholder="empty = no issue" />
        </L>
        <div className="fleet-modal-btns">
          <button className="am-save" disabled={!d.name.trim()} onClick={() => onSave(d)}>{isNew ? 'Add driver' : 'Save changes'}</button>
          <button className="am-cancel" onClick={onCancel}>Cancel</button>
          {!d.name.trim() && <span className="am-muted" style={{ fontSize: 11, color: 'var(--red)' }}>Driver name is required to save.</span>}
        </div>
      </div>
    </div>
  );
}

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="otp-field" style={{ marginTop: 4 }}><span className="otp-field-label">{t}</span>{children}</label>;
}
