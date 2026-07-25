import { useEffect, useMemo, useState } from 'react';
import { loadAll, fmtMoney, fmtMiles, type Load } from '../data/loadsStore';
import { onChange } from '../data/bus';
import { LOAD_STATUS_LABEL, LOAD_STATUS_COLOR } from '../data/schedule';

/* Loads — a READ-ONLY ledger of every load we've built, with a date-range filter
   to pull up what went out over a stretch. Status is view-only here: a load is
   marked Completed ONLY from the Asset Matrix calendar — nowhere else. */

function isoToday(): string { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

const STATUS_ORDER = ['unassigned', 'open', 'covered', 'dispatched', 'at yard', 'at shipper', 'en route', 'at receiver', 'delivered', 'completed', 'off'];

export default function LoadsView() {
  const [loads, setLoads] = useState<Load[]>(() => loadAll());
  const [from, setFrom] = useState<string>(() => daysAgo(30));
  const [to, setTo] = useState<string>(() => isoToday());
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  useEffect(() => onChange(() => setLoads(loadAll())), []);

  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return loads
      .filter((l) => (!from || l.date >= from) && (!to || l.date <= to))
      .filter((l) => statusFilter === 'ALL' || l.status === statusFilter)
      .filter((l) => !n || `${l.routeName} ${l.customerName} ${l.assignedTruck} ${l.assignedTrailer} ${l.referenceNo}`.toLowerCase().includes(n))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.routeName.localeCompare(b.routeName)));
  }, [loads, from, to, q, statusFilter]);

  const completedN = rows.filter((l) => l.status === 'completed' || l.status === 'delivered').length;

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Loads</h2>
        <div className="loads-filter">
          <label className="otp-field"><span className="otp-field-label">From</span>
            <input className="am-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="otp-field"><span className="otp-field-label">To</span>
            <input className="am-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <div className="loads-quick">
            <button className="am-clear" onClick={() => { setFrom(daysAgo(7)); setTo(isoToday()); }}>7d</button>
            <button className="am-clear" onClick={() => { setFrom(daysAgo(30)); setTo(isoToday()); }}>30d</button>
            <button className="am-clear" onClick={() => { setFrom(daysAgo(90)); setTo(isoToday()); }}>90d</button>
          </div>
          <select className="am-input am-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{LOAD_STATUS_LABEL[s] ?? s}</option>)}
          </select>
          <input className="am-input" style={{ maxWidth: 200 }} placeholder="Search route / customer / truck…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="am-muted">{rows.length} load{rows.length === 1 ? '' : 's'} · {completedN} completed/delivered</span>
        <span className="am-muted" style={{ fontSize: 11.5 }}>🔒 Read-only ledger — a load is marked <b>Completed</b> only from the Asset Matrix.</span>
      </div>

      <div className="am-scroll">
        <table className="am-grid am-fleet">
          <thead>
            <tr><th>Date</th><th>Route</th><th>Customer</th><th>Truck</th><th>Trailer</th><th>Miles</th><th>Rate</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="am-muted" style={{ textAlign: 'center', padding: 16 }}>No loads in this date range.</td></tr>}
            {rows.map((l) => {
              const done = l.status === 'completed';
              return (
                <tr key={l.id} className={done ? 'loads-done' : ''}>
                  <td className="am-muted">{l.date || '—'}</td>
                  <td>{l.routeName || <span className="am-muted">(no route)</span>}{l.uspsContract && <span className="am-usps" style={{ marginLeft: 6 }}>USPS</span>}</td>
                  <td>{l.customerName || <span className="am-muted">—</span>}</td>
                  <td>{l.assignedTruck ? `#${l.assignedTruck}` : <span className="am-muted">—</span>}</td>
                  <td className="am-muted">{l.assignedTrailer || '—'}</td>
                  <td className="am-muted">{fmtMiles(l.laneMiles)}</td>
                  <td className="am-muted">{fmtMoney(l.rate)}</td>
                  <td><span className="am-pill" style={{ color: LOAD_STATUS_COLOR[l.status] ?? 'var(--muted)' }}>{LOAD_STATUS_LABEL[l.status] ?? l.status}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
