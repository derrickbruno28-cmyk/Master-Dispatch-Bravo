/* Truck P&L — the report that answers "which trucks earn, and who is in them".

   Two things this screen does that a plain revenue-by-truck table does not:

   1. It shows revenue AND revenue per day worked side by side. Raw revenue
      rewards whoever got the long lanes; the same $80k over 22 days and over 30
      days are not the same truck, and sorting only by the first number will
      point the conversation at the wrong one.
   2. It marks any row whose revenue was SPLIT across legs without mileage to
      split it by. That number is a division, not a measurement, and the report
      says so rather than letting it pass as fact.

   Click any row and you get every load that truck ran. That is the "what loads
   did they run" question, one click deep. */

import { useEffect, useMemo, useState } from 'react';
import { onChange } from '../data/bus';
import { loadAll, loadById, fmtMoney, fmtMiles, type Load } from '../data/loadsStore';
import { TERMINALS, TERMINAL_LABELS } from '../data/fleet';
import { fetchAssignments } from '../data/tms/assignmentsStore';
import { fetchStops } from '../data/tms/stopsStore';
import { fetchMilestones } from '../data/tms/milestonesStore';
import { fetchExceptions } from '../data/tms/exceptionsStore';
import {
  buildTruckPnl, pnlTotals, pnlCsv, truckLoadsCsv, type TruckPnl, type PnlFilter,
} from '../data/tms/truckPnl';
import { BOOKING_AUTHORITIES, BILLING_STATUS_LABEL } from '../data/tms/types';
import { targetColor, OTP_TARGET, OTD_TARGET } from '../data/tms/performance';
import LoadDetailModal from './LoadDetailModal';

type SortKey = 'revenue' | 'revPerDayWorked' | 'revPerLoadedMile' | 'loads' | 'deadheadPct' | 'otdPct';

const SORTS: { key: SortKey; label: string; hint: string }[] = [
  { key: 'revenue', label: 'Revenue', hint: 'the raw number — rewards long lanes' },
  { key: 'revPerDayWorked', label: 'Rev / day worked', hint: 'the fairer comparison between trucks' },
  { key: 'revPerLoadedMile', label: 'Rev / loaded mile', hint: 'how well the lane paid' },
  { key: 'loads', label: 'Loads', hint: 'how busy the truck was' },
  { key: 'deadheadPct', label: 'Deadhead %', hint: 'highest first — the empty miles you paid for' },
  { key: 'otdPct', label: 'OTD %', hint: 'lowest first — service problems (unscored trucks sort last)' },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

function download(name: string, body: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
}

export default function TruckPnlView() {
  const [, force] = useState(0);
  const [from, setFrom] = useState(() => daysAgo(30));
  const [to, setTo] = useState(() => iso(new Date()));
  const [terminal, setTerminal] = useState('ALL');
  const [authority, setAuthority] = useState('ALL');
  const [sort, setSort] = useState<SortKey>('revenue');
  const [open, setOpen] = useState<string>('');          // expanded truck
  const [openLoad, setOpenLoad] = useState<Load | null>(null);

  useEffect(() => onChange(() => force((n) => n + 1)), []);

  /* warm the subcollections this report reads — legs for the split, stops for
     the miles, milestones for on-time, exceptions for the count */
  useEffect(() => {
    void (async () => {
      for (const l of loadAll()) {
        await Promise.all([fetchAssignments(l.id), fetchStops(l.id), fetchMilestones(l.id), fetchExceptions(l.id)]);
      }
      force((n) => n + 1);
    })();
  }, []);

  const filter: PnlFilter = useMemo(() => ({ from, to, terminal, authority }), [from, to, terminal, authority]);
  const rows = useMemo(() => buildTruckPnl(filter), [filter]);
  const totals = useMemo(() => pnlTotals(rows), [rows]);

  const sorted = useMemo(() => {
    const v = (r: TruckPnl): number => {
      const n = r[sort];
      return typeof n === 'number' ? n : -1;
    };
    /* Deadhead and OTD read WORST first — those columns exist to find problems,
       and a "best first" sort buries the thing you opened the report to see.
       They are worst in OPPOSITE directions, which is the part that is easy to
       get backwards: the worst deadhead is the HIGHEST number, the worst OTD is
       the LOWEST. A truck with no scored on-time data sorts last rather than
       first, because "no data" is not "worst". */
    if (sort === 'deadheadPct') {
      return [...rows].sort((a, b) => (b.deadheadPct ?? -1) - (a.deadheadPct ?? -1));
    }
    if (sort === 'otdPct') {
      return [...rows].sort((a, b) => (a.otdPct ?? 101) - (b.otdPct ?? 101));
    }
    return [...rows].sort((a, b) => v(b) - v(a));
  }, [rows, sort]);

  const anyEstimated = rows.some((r) => r.anyEvenSplit);

  return (
    <div className="am-page">
      <div className="am-head">
        <div>
          <h2>Truck P&amp;L</h2>
          <span className="am-muted">
            What each truck earned, what it cost in empty miles, and how it ran. Click a truck for
            every load it pulled.
          </span>
        </div>
        <button className="am-clear" onClick={() => download(`truck-pnl-${to}.csv`, pnlCsv(sorted))}>⭳ Export CSV</button>
      </div>

      <div className="am-head" style={{ marginTop: 4 }}>
        <input className="am-input am-filter" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From" />
        <input className="am-input am-filter" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To" />
        <button className="am-clear" onClick={() => { setFrom(daysAgo(7)); setTo(iso(new Date())); }}>7d</button>
        <button className="am-clear" onClick={() => { setFrom(daysAgo(30)); setTo(iso(new Date())); }}>30d</button>
        <button className="am-clear" onClick={() => { setFrom(daysAgo(90)); setTo(iso(new Date())); }}>90d</button>
        <select className="am-input am-filter" value={terminal} onChange={(e) => setTerminal(e.target.value)}>
          <option value="ALL">All terminals</option>
          {TERMINALS.map((t) => <option key={t} value={t}>{TERMINAL_LABELS[t] ?? t}</option>)}
        </select>
        <select className="am-input am-filter" value={authority} onChange={(e) => setAuthority(e.target.value)}>
          <option value="ALL">All authorities</option>
          {BOOKING_AUTHORITIES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="am-muted">{rows.length} truck{rows.length === 1 ? '' : 's'} worked</span>
      </div>

      <div className="fin-kpis">
        <Kpi label="REVENUE" val={fmtMoney(totals.revenue)} tone="var(--green)" sub={`${totals.loads} legs across ${totals.trucks} trucks`} />
        <Kpi label="REV / LOADED MILE" val={totals.revPerLoadedMile == null ? '—' : `$${totals.revPerLoadedMile.toFixed(2)}`} sub={fmtMiles(Math.round(totals.loadedMiles))} />
        <Kpi label="DEADHEAD" val={totals.deadheadPct == null ? '—' : `${totals.deadheadPct.toFixed(1)}%`}
          tone={totals.deadheadPct != null && totals.deadheadPct > 15 ? 'var(--amber)' : undefined}
          sub={`${Math.round(totals.emptyMiles).toLocaleString()} empty miles`} />
        <Kpi label="BEST EARNER" val={totals.best ? `#${totals.best.truck}` : '—'} tone="var(--green)"
          sub={totals.best ? `${fmtMoney(totals.best.revenue)} · ${totals.best.crew.join(' / ') || 'no crew set'}` : ''} />
        <Kpi label="LOWEST EARNER" val={totals.worst ? `#${totals.worst.truck}` : '—'} tone="var(--red)"
          sub={totals.worst ? `${fmtMoney(totals.worst.revenue)} · ${totals.worst.crew.join(' / ') || 'no crew set'}` : ''} />
      </div>

      <div className="am-billchips pnl-sorts">
        <span className="am-muted">Sort by:</span>
        {SORTS.map((s) => (
          <button key={s.key} className={`am-billchip ${sort === s.key ? 'on ready_for_accounting' : ''}`}
            title={s.hint} onClick={() => setSort(s.key)}>{s.label}</button>
        ))}
      </div>

      {anyEstimated && (
        <div className="am-notice pnl-estnote">
          ⚖ Some loads run more than one leg and carry no per-stop mileage, so their revenue was split
          <b> evenly</b> between the trucks rather than by miles. Those rows are marked — add leg miles on
          the load's Stops tab and the split becomes a measurement instead of a division.
        </div>
      )}

      <div className="am-scroll">
        <table className="am-grid pnl-table">
          <thead>
            <tr>
              <th>Truck</th><th>Crew</th><th>Loads</th><th>Revenue</th>
              <th>Rev / day worked</th><th>Loaded</th><th>Deadhead</th>
              <th>Rev / loaded mi</th><th>OTP</th><th>OTD</th><th>⚠</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={11} className="am-muted" style={{ textAlign: 'center', padding: 18 }}>
                No trucks carried a load in this window. Widen the dates, or check that loads have a
                truck on their legs.
              </td></tr>
            )}
            {sorted.map((r) => (
              <FragmentRow key={r.truck} r={r} open={open === r.truck}
                onToggle={() => setOpen(open === r.truck ? '' : r.truck)}
                onOpenLoad={(id) => setOpenLoad(loadById(id) ?? null)} />
            ))}
          </tbody>
        </table>
      </div>

      {openLoad && (
        <LoadDetailModal
          tractor={openLoad.assignedTruck} date={openLoad.date} canDel={false} seedLoad={openLoad}
          onSave={() => setOpenLoad(null)} onClear={() => setOpenLoad(null)}
          onCreated={() => setOpenLoad(null)} onClose={() => { setOpenLoad(null); force((n) => n + 1); }}
        />
      )}
    </div>
  );
}

function FragmentRow({ r, open, onToggle, onOpenLoad }: {
  r: TruckPnl; open: boolean; onToggle: () => void; onOpenLoad: (id: string) => void;
}) {
  return (
    <>
      <tr className="bill-row pnl-row" onClick={onToggle}>
        <td>
          <b>{open ? '▾' : '▸'} #{r.truck}</b>
          <div className="am-muted bill-sub">{r.terminal}{r.type ? ` · ${r.type}` : ''}</div>
        </td>
        <td>
          {r.crew.length ? r.crew.join(' / ') : <span className="am-muted">no crew on the roster</span>}
        </td>
        <td>{r.loads}<div className="am-muted bill-sub">{r.daysWorked} day{r.daysWorked === 1 ? '' : 's'}</div></td>
        <td>
          <b>{fmtMoney(r.revenue)}</b>
          {r.anyEvenSplit && <span className="pnl-est" title="At least one load's revenue was split evenly between legs because no per-stop mileage was recorded">⚖</span>}
        </td>
        <td>{r.revPerDayWorked == null ? '—' : fmtMoney(Math.round(r.revPerDayWorked))}</td>
        <td className="am-muted">{fmtMiles(Math.round(r.loadedMiles))}</td>
        <td className={r.deadheadPct != null && r.deadheadPct > 15 ? 'bill-blocked' : 'am-muted'}>
          {r.deadheadPct == null ? '—' : `${r.deadheadPct.toFixed(0)}%`}
          <div className="am-muted bill-sub">{Math.round(r.emptyMiles).toLocaleString()} mi</div>
        </td>
        <td>{r.revPerLoadedMile == null ? '—' : `$${r.revPerLoadedMile.toFixed(2)}`}</td>
        <td><Pct v={r.otpPct} target={OTP_TARGET} on={r.otpOnTime} late={r.otpLate} /></td>
        <td><Pct v={r.otdPct} target={OTD_TARGET} on={r.otdOnTime} late={r.otdLate} /></td>
        <td className={r.exceptions ? 'bill-blocked' : 'am-muted'}>{r.exceptions || '—'}</td>
      </tr>

      {open && (
        <tr className="pnl-detail-row">
          <td colSpan={11}>
            <div className="pnl-detail">
              <div className="pnl-detail-head">
                <b>Every load #{r.truck} pulled</b>
                <span className="am-muted">
                  {r.rows.length} load{r.rows.length === 1 ? '' : 's'} · click one to open it
                </span>
                <button className="am-clear" onClick={(e) => {
                  e.stopPropagation();
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(new Blob([truckLoadsCsv(r)], { type: 'text/csv;charset=utf-8' }));
                  a.download = `truck-${r.truck}-loads.csv`;
                  a.click();
                }}>⭳ CSV</button>
              </div>
              <table className="am-grid pnl-loads">
                <thead>
                  <tr>
                    <th>Date</th><th>Load</th><th>Customer</th><th>Drivers</th>
                    <th>Revenue</th><th>Loaded</th><th>CPM</th><th>OTP</th><th>OTD</th><th>Billing</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((x) => (
                    <tr key={`${x.loadId}-${x.legLabel}`} className="bill-row"
                      onClick={(e) => { e.stopPropagation(); onOpenLoad(x.loadId); }}>
                      <td className="am-muted">{x.date}</td>
                      <td>
                        <b>{x.loadNumber}</b>
                        <div className="am-muted bill-sub">
                          {x.trip || x.routeName}{x.legLabel && ` · ${x.legLabel}`}
                        </div>
                      </td>
                      <td>{x.customer}<div className="am-muted bill-sub">{x.authority}</div></td>
                      <td className="am-muted">{x.drivers.join(' / ') || '—'}</td>
                      <td>
                        {fmtMoney(x.revenue)}
                        {x.share < 1 && (
                          <div className="am-muted bill-sub">
                            {(x.share * 100).toFixed(0)}% of {fmtMoney(x.fullRevenue)}{x.evenSplit ? ' ⚖' : ''}
                          </div>
                        )}
                      </td>
                      <td className="am-muted">{fmtMiles(Math.round(x.loadedMiles))}</td>
                      <td>{x.cpm == null ? '—' : `$${x.cpm.toFixed(2)}`}</td>
                      <td><Flag v={x.otp} /></td>
                      <td><Flag v={x.otd} /></td>
                      <td className="am-muted">{BILLING_STATUS_LABEL[x.billingStatus]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Pct({ v, target, on, late }: { v: number | null; target: number; on: number; late: number }) {
  if (v == null) return <span className="am-muted" title="nothing scored yet — no completed milestones">—</span>;
  return (
    <span style={{ color: targetColor(v, target), fontWeight: 700 }} title={`${on} on time · ${late} late`}>
      {v.toFixed(0)}%
    </span>
  );
}

function Flag({ v }: { v: 'On Time' | 'Late' | 'Pending' }) {
  return v === 'On Time' ? <span className="badge badge-green">✓</span>
    : v === 'Late' ? <span className="badge badge-red">✗</span>
      : <span className="am-muted">—</span>;
}

function Kpi({ label, val, sub, tone }: { label: string; val: string; sub?: string; tone?: string }) {
  return (
    <div className="fin-kpi">
      <div className="fin-kpi-label">{label}</div>
      <div className="fin-kpi-val" style={tone ? { color: tone } : undefined}>{val}</div>
      {sub && <div className="am-muted bill-sub">{sub}</div>}
    </div>
  );
}
