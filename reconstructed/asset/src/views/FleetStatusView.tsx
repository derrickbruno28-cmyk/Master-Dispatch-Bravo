import { useMemo, useState } from 'react';
import { TRUCKS } from '../data/fleet';

/* Fleet Status — carried over from the Operations Center: every tractor, its
   drivers, current city / home terminal, HOS hours available, and live status. */

const STATUS_CLR: Record<string, string> = {
  dispatched: 'var(--green)', 'en route': 'var(--accent)', delivering: 'var(--amber)',
  'on 34hr reset': 'var(--red)', available: '#00b8d4',
};

export default function FleetStatusView() {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return TRUCKS.filter((t) => !n || `${t.tractor} ${t.driver1} ${t.driver2} ${t.homeCity} ${t.currentCity}`.toLowerCase().includes(n));
  }, [q]);

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Fleet Status</h2>
        <input className="am-input" style={{ maxWidth: 260 }} placeholder="Search truck / driver / city…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="am-muted">{rows.length} of {TRUCKS.length} trucks</span>
      </div>
      <div className="am-scroll">
        <table className="am-grid am-fleet">
          <thead>
            <tr>
              <th>Tractor</th><th>Rating</th><th>Drivers</th><th>Type</th>
              <th>Current</th><th>Home</th><th>Hrs</th><th>Status</th><th>Current route</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.tractor}>
                <td className="am-tractor">#{t.tractor}</td>
                <td className="am-muted">{t.rating}</td>
                <td>{[t.driver1, t.driver2].filter(Boolean).join(' · ')}</td>
                <td className="am-muted">{t.type}</td>
                <td>{t.currentCity}</td>
                <td>{t.homeCity}</td>
                <td style={{ color: t.hoursAvail === 0 ? 'var(--red)' : t.hoursAvail < 20 ? 'var(--amber)' : 'var(--green)' }}>{t.hoursAvail}</td>
                <td><span className="am-pill" style={{ color: STATUS_CLR[t.status] ?? 'var(--text)' }}>{t.status}</span></td>
                <td className="am-muted">{t.currentRoute}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
