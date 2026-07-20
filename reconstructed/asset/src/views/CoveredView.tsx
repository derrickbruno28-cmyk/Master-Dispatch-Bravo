import { useMemo, useState } from 'react';
import { loadFleet } from '../data/fleetStore';
import { loadAssignments, parseCellKey } from '../data/schedule';

/* Routes Covered — DERIVED live from the Asset Matrix assignments (Bravo's
   pattern: the board is the system of record, roll-ups read from it — no
   separate data entry). Splits USPS contract routes from other freight. */

interface Row { tractor: string; date: string; route: string; status: string; usps: boolean; driver: string; terminal: string }

const STATUS_COLOR: Record<string, string> = {
  open: 'var(--muted)', covered: 'var(--green)', dispatched: '#00b8d4',
  departed: 'var(--accent)', delivered: '#6b7f9e', off: 'var(--muted)',
};
const COVERED = new Set(['covered', 'dispatched', 'departed', 'delivered']);

function loadRows(): Row[] {
  const data = loadAssignments();
  const byId = new Map(loadFleet().map((t) => [t.tractor, t]));
  const rows: Row[] = [];
  for (const [k, a] of Object.entries(data)) {
    if (!a.route?.trim()) continue;
    const { tractor, date } = parseCellKey(k);
    const t = byId.get(tractor);
    rows.push({ tractor, date, route: a.route, status: a.status, usps: !!a.usps, driver: t ? [t.driver1, t.driver2].filter(Boolean).join(' · ') : '', terminal: t?.homeCity ?? '' });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.tractor.localeCompare(b.tractor));
  return rows;
}

export default function CoveredView() {
  const [q, setQ] = useState('');
  const rows = useMemo(() => loadRows(), []);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? rows.filter((r) => `${r.route} ${r.tractor} ${r.driver} ${r.status}`.toLowerCase().includes(n)) : rows;
  }, [rows, q]);

  const usps = filtered.filter((r) => r.usps);
  const other = filtered.filter((r) => !r.usps);
  const coveredCount = filtered.filter((r) => COVERED.has(r.status)).length;

  return (
    <div className="am-page">
      <div className="am-head">
        <div>
          <h2>Routes Covered</h2>
          <span className="am-muted">Live roll-up of Asset Matrix assignments · {coveredCount} covered · {rows.length} assigned</span>
        </div>
        <input className="am-input" style={{ maxWidth: 240 }} placeholder="Search covered routes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="badge badge-blue">USPS: {usps.length}</span>
        <span className="badge badge-amber">Other: {other.length}</span>
      </div>

      {rows.length === 0 ? (
        <div className="am-note"><p>No routes assigned yet. Assign trucks in the <b>Asset Matrix</b> and they roll up here automatically.</p></div>
      ) : (
        <>
          <Section title="USPS Contract Routes" rows={usps} accent="var(--accent)" />
          <Section title="Other Freight" rows={other} accent="var(--amber)" />
        </>
      )}
    </div>
  );
}

function Section({ title, rows, accent }: { title: string; rows: Row[]; accent: string }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="cov-sec"><span className="cov-dot" style={{ background: accent }} />{title} ({rows.length})</div>
      <div className="am-scroll">
        <table className="am-grid">
          <thead><tr><th>Date</th><th>Truck</th><th>Driver</th><th>Terminal</th><th>Route</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.tractor}_${r.date}`}>
                <td>{r.date.slice(5)}</td>
                <td className="am-tractor">#{r.tractor}</td>
                <td>{r.driver || '—'}</td>
                <td className="am-muted">{r.terminal}</td>
                <td className="opt-route">{r.route}</td>
                <td style={{ color: STATUS_COLOR[r.status] ?? 'var(--text)', fontWeight: 700, textTransform: 'capitalize' }}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
