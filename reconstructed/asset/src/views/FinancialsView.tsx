import { useEffect, useMemo, useState } from 'react';
import { loadAll, attributionRows, fmtMoney, fmtMiles, fmtCpm, type AttributionRow } from '../data/loadsStore';
import { loadFleet } from '../data/fleetStore';
import { loadDrivers } from '../data/driversStore';
import { TERMINALS, TERMINAL_LABELS } from '../data/fleet';
import { mondayOf, isoDate } from '../data/schedule';
import { onChange } from '../data/bus';
import { allFinRows } from '../data/tms/billing';
import { rollup } from '../data/tms/financials';

/* Financials — revenue & CPM analytics off the load records. Revenue attributes
   to the assigned truck + team (per SEGMENT for split loads, via attributionRows).
   Four pages (from the Financials ▾ nav): Revenue/CPM by lane, by Customer, by
   Truck/Team, and Driver Miles. Week/month + terminal filters, CSV export. */

export type FinPage = 'cpm' | 'customer' | 'truck' | 'miles';

const PAGE_TITLE: Record<FinPage, string> = {
  cpm: 'Revenue / CPM', customer: 'Revenue by Customer', truck: 'Revenue by Truck / Team', miles: 'Driver Miles',
};

function csvDownload(name: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const body = [header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FinancialsView({ page }: { page: FinPage }) {
  const [, force] = useState(0);
  useEffect(() => onChange(() => force((n) => n + 1)), []);

  const [range, setRange] = useState<'week' | 'month' | 'all'>('month');
  const [term, setTerm] = useState('ALL');

  /* truck → home terminal, for the terminal filter + team labels */
  const truckTerm = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of loadFleet()) m.set(t.tractor, t.homeCity);
    return m;
  }, []);
  const teamLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of loadFleet()) m.set(t.tractor, [t.driver1, t.driver2].filter(Boolean).join(' / ') || t.type);
    return m;
  }, []);

  const rows = useMemo(() => {
    const all = attributionRows(loadAll());
    const today = isoDate(new Date());
    const weekStart = isoDate(mondayOf(new Date()));
    const monthStart = today.slice(0, 8) + '01';
    return all.filter((r) => {
      if (range === 'week' && r.date < weekStart) return false;
      if (range === 'month' && r.date < monthStart) return false;
      if (term !== 'ALL' && (truckTerm.get(r.truck) ?? '') !== term) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, term, truckTerm]);

  const kpis = useMemo(() => {
    const revenue = rows.reduce((n, r) => n + r.revenue, 0);
    const miles = rows.reduce((n, r) => n + r.miles, 0);
    const loads = new Set(rows.map((r) => r.loadId)).size;
    return { revenue, miles, loads, avgCpm: miles ? revenue / miles : null };
  }, [rows]);

  const rangeChips = (
    <div className="am-termfilter" style={{ gap: 6 }}>
      {(['week', 'month', 'all'] as const).map((r) => (
        <button key={r} className={`am-tchip ${range === r ? 'on' : ''}`} onClick={() => setRange(r)}>{r === 'week' ? 'This week' : r === 'month' ? 'This month' : 'All time'}</button>
      ))}
      <select className="am-input am-filter" value={term} onChange={(e) => setTerm(e.target.value)}>
        <option value="ALL">All terminals</option>
        {TERMINALS.map((t) => <option key={t} value={t}>{TERMINAL_LABELS[t] ?? t}</option>)}
      </select>
    </div>
  );

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>{PAGE_TITLE[page]}</h2>
        {rangeChips}
      </div>

      <div className="fin-kpis">
        <Kpi label="Total Revenue" val={fmtMoney(kpis.revenue)} accent="var(--green)" />
        <Kpi label="Loads Run" val={String(kpis.loads)} />
        <Kpi label="Total Miles" val={fmtMiles(kpis.miles)} />
        <Kpi label="Avg CPM" val={fmtCpm(kpis.avgCpm)} accent="var(--accent)" />
      </div>

      {/* PHASE 9 — five entities across three terminals, so every report carries
          the authority and terminal split. Without it "revenue was up" is a
          sentence with no owner. */}
      <AuthorityTerminal range={range} term={term} />

      {page === 'cpm' && <ByLane rows={rows} />}
      {page === 'customer' && <ByGroup rows={rows} keyOf={(r) => r.customer} label="Customer" file="revenue-by-customer" />}
      {page === 'truck' && <ByGroup rows={rows} keyOf={(r) => r.truck || '(unassigned)'} label="Truck" file="revenue-by-truck"
        extra={(k) => teamLabel.get(k) ?? ''} extraHead="Team" />}
      {page === 'miles' && <DriverMiles rows={rows} />}
    </div>
  );
}

function AuthorityTerminal({ range, term }: { range: 'week' | 'month' | 'all'; term: string }) {
  const rows = useMemo(() => {
    const today = isoDate(new Date());
    const weekStart = isoDate(mondayOf(new Date()));
    const monthStart = today.slice(0, 8) + '01';
    return allFinRows().filter((r) => {
      if (range === 'week' && r.date < weekStart) return false;
      if (range === 'month' && r.date < monthStart) return false;
      if (term !== 'ALL' && r.terminal !== term) return false;
      return true;
    });
  }, [range, term]);

  const byAuthority = useMemo(() => rollup(rows, (r) => r.authority), [rows]);
  const byTerminal = useMemo(() => rollup(rows, (r) => r.terminal), [rows]);
  if (rows.length === 0) return null;

  return (
    <div className="bill-breakdowns">
      {[['By booking authority', byAuthority], ['By terminal', byTerminal]].map(([title, groups]) => (
        <div className="bill-breakdown" key={title as string}>
          <div className="rc-section">{title as string}</div>
          <table className="am-grid bill-mini">
            <tbody>
              {(groups as ReturnType<typeof rollup>).map((g) => (
                <tr key={g.key}>
                  <td>{g.key}</td>
                  <td className="am-muted">{g.loads} load{g.loads === 1 ? '' : 's'}</td>
                  <td><b>{fmtMoney(g.revenue)}</b></td>
                  <td className="am-muted">{g.cpm == null ? '—' : `$${g.cpm.toFixed(2)}/mi`}</td>
                  <td>
                    <span className="otp-bar"><span className="otp-bar-fill bill-fill" style={{ width: `${Math.min(100, g.share)}%` }} /></span>
                    <span className="am-muted otp-share">{g.share.toFixed(0)}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function Kpi({ label, val, accent }: { label: string; val: string; accent?: string }) {
  return (
    <div className="fin-kpi">
      <div className="fin-kpi-label">{label}</div>
      <div className="fin-kpi-val" style={{ color: accent }}>{val}</div>
    </div>
  );
}

function ByLane({ rows }: { rows: AttributionRow[] }) {
  const data = useMemo(() => {
    const m = new Map<string, { lane: string; customer: string; loads: Set<string>; revenue: number; miles: number }>();
    for (const r of rows) {
      const e = m.get(r.laneKey) ?? { lane: r.laneKey, customer: r.customer, loads: new Set<string>(), revenue: 0, miles: 0 };
      e.loads.add(r.loadId); e.revenue += r.revenue; e.miles += r.miles; m.set(r.laneKey, e);
    }
    return [...m.values()].map((e) => ({ ...e, count: e.loads.size, cpm: e.miles ? e.revenue / e.miles : null }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [rows]);
  return (
    <Table
      head={['Lane', 'Customer', 'Loads', 'Revenue', 'Miles', 'CPM']}
      rows={data.map((d) => [d.lane, d.customer, d.count, fmtMoney(d.revenue), fmtMiles(d.miles), fmtCpm(d.cpm)])}
      onCsv={() => csvDownload('cpm-by-lane.csv', ['Lane', 'Customer', 'Loads', 'Revenue', 'Miles', 'CPM'],
        data.map((d) => [d.lane, d.customer, d.count, d.revenue, d.miles, d.cpm ?? '']))}
    />
  );
}

function ByGroup({ rows, keyOf, label, file, extra, extraHead }: {
  rows: AttributionRow[]; keyOf: (r: AttributionRow) => string; label: string; file: string;
  extra?: (k: string) => string; extraHead?: string;
}) {
  const data = useMemo(() => {
    const m = new Map<string, { key: string; loads: Set<string>; revenue: number; miles: number }>();
    for (const r of rows) {
      const k = keyOf(r);
      const e = m.get(k) ?? { key: k, loads: new Set<string>(), revenue: 0, miles: 0 };
      e.loads.add(r.loadId); e.revenue += r.revenue; e.miles += r.miles; m.set(k, e);
    }
    return [...m.values()].map((e) => ({ ...e, count: e.loads.size, cpm: e.miles ? e.revenue / e.miles : null }))
      .sort((a, b) => b.revenue - a.revenue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const head = [label, ...(extraHead ? [extraHead] : []), 'Loads', 'Revenue', 'Miles', 'CPM'];
  return (
    <Table
      head={head}
      rows={data.map((d) => [d.key, ...(extra ? [extra(d.key)] : []), d.count, fmtMoney(d.revenue), fmtMiles(d.miles), fmtCpm(d.cpm)])}
      onCsv={() => csvDownload(`${file}.csv`, head, data.map((d) => [d.key, ...(extra ? [extra(d.key)] : []), d.count, d.revenue, d.miles, d.cpm ?? '']))}
    />
  );
}

function DriverMiles({ rows }: { rows: AttributionRow[] }) {
  /* miles per driver: each segment's miles credit to both drivers on its truck */
  const data = useMemo(() => {
    const fleet = loadFleet(); const drivers = loadDrivers();
    const truckDrivers = new Map<string, string[]>();
    for (const t of fleet) truckDrivers.set(t.tractor, [t.driver1, t.driver2].filter(Boolean));
    const m = new Map<string, { driver: string; miles: number; revenue: number; loads: Set<string> }>();
    for (const r of rows) {
      for (const dn of truckDrivers.get(r.truck) ?? []) {
        const e = m.get(dn) ?? { driver: dn, miles: 0, revenue: 0, loads: new Set<string>() };
        e.miles += r.miles; e.revenue += r.revenue; e.loads.add(r.loadId); m.set(dn, e);
      }
    }
    const posOf = new Map(drivers.map((d) => [d.name.toLowerCase(), d.position]));
    return [...m.values()].map((e) => ({ ...e, count: e.loads.size, position: posOf.get(e.driver.toLowerCase()) ?? '' }))
      .sort((a, b) => b.miles - a.miles);
  }, [rows]);
  return (
    <Table
      head={['Driver', 'Position', 'Loads', 'Miles', 'Revenue on their trucks']}
      rows={data.map((d) => [d.driver, d.position, d.count, fmtMiles(d.miles), fmtMoney(d.revenue)])}
      onCsv={() => csvDownload('driver-miles.csv', ['Driver', 'Position', 'Loads', 'Miles', 'Revenue'],
        data.map((d) => [d.driver, d.position, d.count, d.miles, d.revenue]))}
      note="Miles credit to both drivers on a truck; split-load segments credit their own leg."
    />
  );
}

function Table({ head, rows, onCsv, note }: { head: string[]; rows: (string | number)[][]; onCsv: () => void; note?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 8px' }}>
        {note ? <span className="am-muted" style={{ fontSize: 11.5 }}>{note}</span> : <span />}
        <button className="am-clear" onClick={onCsv} disabled={rows.length === 0}>⭱ Export CSV</button>
      </div>
      <div className="am-scroll">
        <table className="am-grid am-fleet">
          <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={head.length} className="am-muted" style={{ textAlign: 'center', padding: 16 }}>No load revenue in this range yet.</td></tr>
              : rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j === 0 ? 'am-tractor' : ''}>{c}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
