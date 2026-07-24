import { useMemo, useState } from 'react';
import { ROUTES, type AssetRoute } from '../data/fleet';

/* Load Repository — the master list of USPS loads/routes (merged from Caleb's
   Bravo Matrix lane list). Trip # (FA2D3-xxx), origin → destination, pickup time,
   departure, delivery appointment, frequency, miles, rate, planning. Reference /
   look-up only — dispatchers use it to find a route's details when building a load. */

interface RepoRow extends AssetRoute { tripCode: string; tripLabel: string; origin: string; destination: string; via: string; contract: string }

function parse(r: AssetRoute): RepoRow {
  const m = r.route.match(/\b([A-Z0-9]{2,6}-\d+[A-Za-z]?)\b(?:\s+Trip\s+([A-Z]))?\s*$/);
  const tripCode = m ? m[1] : '';
  const tripLabel = m && m[2] ? `Trip ${m[2]}` : '';
  const head = (m ? r.route.slice(0, m.index) : r.route).trim();
  const parts = head.split(' - ').map((s) => s.trim()).filter(Boolean);
  const origin = parts[0] || '';
  const destination = parts.length > 1 ? parts[parts.length - 1] : '';
  const via = parts.length > 2 ? parts.slice(1, -1).join(' · ') : '';
  const contract = tripCode.includes('-') ? tripCode.split('-')[0] : '';
  return { ...r, tripCode, tripLabel, origin, destination, via, contract };
}

export default function LoadRepositoryView() {
  const rows = useMemo(() => ROUTES.map(parse), []);
  const [q, setQ] = useState('');
  const [contract, setContract] = useState('ALL');
  const contracts = useMemo(() => [...new Set(rows.map((r) => r.contract).filter(Boolean))].sort(), [rows]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows
      .filter((r) => contract === 'ALL' || r.contract === contract)
      .filter((r) => !n || `${r.route} ${r.tripCode} ${r.origin} ${r.destination} ${r.freq}`.toLowerCase().includes(n))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.tripCode.localeCompare(b.tripCode, undefined, { numeric: true }));
  }, [rows, q, contract]);

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Load Repository</h2>
        <span className="am-muted">USPS loads / routes — trip #, lane, times &amp; appointments. Reference for building loads.</span>
        <select className="am-input am-filter" value={contract} onChange={(e) => setContract(e.target.value)}>
          <option value="ALL">All contracts</option>
          {contracts.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="am-input" style={{ maxWidth: 240 }} placeholder="Search trip # / city / freq…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="am-muted">{shown.length} of {rows.length} routes</span>
      </div>

      <div className="am-scroll">
        <table className="am-grid am-fleet repo-table">
          <thead>
            <tr>
              <th>Trip #</th><th>Origin → Destination</th><th>Freq</th>
              <th>PU time</th><th>Departure</th><th>Delivery appt</th><th>Miles</th><th>Rate</th><th>Planning</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={9} className="am-muted" style={{ textAlign: 'center', padding: 16 }}>No routes match.</td></tr>}
            {shown.map((r, i) => (
              <tr key={`${r.tripCode}-${i}`}>
                <td className="am-tractor">{r.tripCode || '—'}{r.tripLabel && <span className="repo-triplabel"> {r.tripLabel}</span>}</td>
                <td>
                  <div className="repo-lane"><b>{r.origin || '—'}</b> → <b>{r.destination || '—'}</b></div>
                  {r.via && <div className="am-muted repo-via">via {r.via}</div>}
                </td>
                <td className="am-muted">{r.freq || '—'}</td>
                <td>{r.puTime || '—'}</td>
                <td>{r.departure || '—'}</td>
                <td className="repo-del">{r.delivery || '—'}</td>
                <td className="am-muted">{r.miles || '—'}</td>
                <td>{r.rate || '—'}</td>
                <td className="am-muted">{r.planning || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
