import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { addDays, todayCentral } from '../dates';
import { bandFor, integrityIdForTripCode } from '../pricing';
import { marginRowsFor, marginWeekOf, rollup, type LoadMargin } from '../margin';
import { isDedicatedPlugIn, canEditGoals, laneCompactName, loadRate } from '../types';
import { can } from '../permissions';

/* §8.1 Daily Margin Report (live rebuild of the workbook) + §8.2 KPI dashboard.
   Admin-tier only. PDF export = print-optimized view (browser Save as PDF);
   Google Drive archiving deliberately deferred (folder ID unused in the sheet). */

const $0 = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (p: number | null) => (p == null ? '—' : `${(p * 100).toFixed(1)}%`);
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function StatusPill({ r }: { r: LoadMargin }) {
  if (r.state === 'open') return <span className="pill m-open">OPEN</span>;
  if (r.state === 'no_trm') return <span className="pill m-notrm">NO TRM</span>;
  if (r.state === 'under') return <span className="pill m-under">UNDER BREAKEVEN</span>;
  return <span className="pill m-ok">ON TARGET</span>;
}

export default function AnalyticsView() {
  const { loads, lanes, integrity, marginSettings, saveMarginSettings, users, currentUser, setUserGoal, demoMode } = useStore();
  const [tab, setTab] = useState<'margin' | 'kpi'>('margin');
  const [day, setDay] = useState(todayCentral());
  const [kpiWin, setKpiWin] = useState<'today' | 'week' | 'month' | 'custom'>('week');
  const [kpiFrom, setKpiFrom] = useState(addDays(todayCentral(), -7));
  const [kpiTo, setKpiTo] = useState(todayCentral());
  const s = marginSettings;
  const week = marginWeekOf(day);
  const dayRows = useMemo(
    () => marginRowsFor(loads, lanes, integrity, s, [day]).sort((a, b) => a.lane.tripCode.localeCompare(b.lane.tripCode, undefined, { numeric: true })),
    [loads, lanes, integrity, s, day],
  );
  const weekRows = useMemo(() => marginRowsFor(loads, lanes, integrity, s, week), [loads, lanes, integrity, s, week]);
  const dayRoll = rollup(dayRows);
  const weekRoll = rollup(weekRows);
  const bookedWeek = weekRows.filter((r) => r.state === 'on_target' || r.state === 'under');
  const top5 = [...bookedWeek].sort((a, b) => b.marginD - a.marginD).slice(0, 5);
  const bottom5 = [...bookedWeek].sort((a, b) => a.marginD - b.marginD).slice(0, 5);

  /* per-rep margin over the week (§8.1 "per rep — new in-app") */
  const repWeek = useMemo(() => {
    const m = new Map<string, LoadMargin[]>();
    for (const r of bookedWeek) {
      if (!r.rep) continue;
      m.set(r.rep, [...(m.get(r.rep) ?? []), r]);
    }
    return [...m.entries()].map(([rep, rows]) => ({ rep, ...rollup(rows) })).sort((a, b) => b.marginD - a.marginD);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekRows]);

  /* ---- §8.2 KPI dashboard ---- */
  const kpiDates = useMemo(() => {
    const today = todayCentral();
    if (kpiWin === 'today') return [today];
    if (kpiWin === 'week') return marginWeekOf(today);
    if (kpiWin === 'month') {
      const first = `${today.slice(0, 7)}-01`;
      const out: string[] = [];
      for (let d = first; d <= today; d = addDays(d, 1)) out.push(d);
      return out;
    }
    const out: string[] = [];
    for (let d = kpiFrom; d <= kpiTo && out.length < 370; d = addDays(d, 1)) out.push(d);
    return out;
  }, [kpiWin, kpiFrom, kpiTo]);

  const kpi = useMemo(() => {
    const laneMap = new Map(lanes.map((l) => [l.id, l]));
    const recById = new Map(integrity.map((r) => [r.id, r]));
    interface RepAgg {
      rep: string; covers: number; plugIns: number; rateSum: number; rated: number;
      belowTarget: number; inBand: number; aboveCeiling: number; banded: number;
      marginRows: LoadMargin[]; chargebacks: number;
    }
    const m = new Map<string, RepAgg>();
    const get = (rep: string) => {
      if (!m.has(rep)) m.set(rep, { rep, covers: 0, plugIns: 0, rateSum: 0, rated: 0, belowTarget: 0, inBand: 0, aboveCeiling: 0, banded: 0, marginRows: [], chargebacks: 0 });
      return m.get(rep)!;
    };
    const rows = marginRowsFor(loads, lanes, integrity, s, kpiDates);
    for (const r of rows) {
      if (!r.rep || (r.state !== 'on_target' && r.state !== 'under')) continue;
      const a = get(r.rep);
      /* dedicated PLUG-IN ≠ cover (Think Tank 07/15): the dedicated carrier
         on its own dedicated lane earns no cover credit — a replacement
         carrier after a fall-off still counts (different name → cover). */
      if (isDedicatedPlugIn(r.load, laneMap.get(r.load.laneId))) {
        a.plugIns += 1;
        a.marginRows.push(r); // margin math still counts the freight
        continue;
      }
      a.covers += 1;
      a.marginRows.push(r);
      const rate = loadRate(r.load);
      if (rate != null) { a.rateSum += rate; a.rated += 1; }
      const lane = laneMap.get(r.load.laneId);
      const rec = lane ? recById.get(integrityIdForTripCode(lane.tripCode) ?? '') : undefined;
      const band = rec && lane ? rec.bands[bandFor(r.load, lane)] : undefined;
      if (rate != null && band && (band.target != null || band.ceiling != null)) {
        a.banded += 1;
        if (band.target != null && rate <= band.target) a.belowTarget += 1;
        else if (band.ceiling != null && rate > band.ceiling) a.aboveCeiling += 1;
        else a.inBand += 1;
      }
    }
    for (const l of loads) {
      if (l.chargebackBy && kpiDates.includes(l.date)) get(l.chargebackBy).chargebacks += 1;
    }
    return [...m.values()].sort((a, b) => b.covers - a.covers);
  }, [loads, lanes, integrity, s, kpiDates]);

  const goalFor = (rep: string) =>
    users.find((u) => u.name === rep || u.email === rep)?.dailyGoal ?? s.repGoalDefault;
  const userFor = (rep: string) => users.find((u) => u.name === rep || u.email === rep);
  const mayEditGoals = canEditGoals(currentUser);

  function exportKpiCsv() {
    const head = ['rep', 'covers', 'plugIns', 'goal/day', 'actual/day', 'avg booked rate', 'at/below target', 'within band', 'above ceiling', 'avg margin %', 'chargebacks'];
    const rows = kpi.map((a) => {
      const roll = rollup(a.marginRows);
      return [a.rep, a.covers, a.plugIns, goalFor(a.rep), (a.covers / kpiDates.length).toFixed(2),
        a.rated ? (a.rateSum / a.rated).toFixed(0) : '', a.belowTarget, a.inBand, a.aboveCeiling,
        roll.marginPct != null ? (roll.marginPct * 100).toFixed(2) : '', a.chargebacks];
    });
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `kpi-${kpiDates[0]}-${kpiDates[kpiDates.length - 1]}.csv`;
    a.click();
  }

  const num = (v: string) => Number(v.replace(/[^0-9.]/g, '')) || 0;

  if (!can(currentUser, 'analytics')) {
    return <div className="page"><p className="muted">Admin access required.</p></div>;
  }

  return (
    <div className="page analytics-page">
      <div className="page-head no-print">
        <h2>Analytics</h2>
        <div className="status-chips">
          <button className={`chip ${tab === 'margin' ? 'chip-on' : ''}`} onClick={() => setTab('margin')}>Margin Report</button>
          <button className={`chip ${tab === 'kpi' ? 'chip-on' : ''}`} onClick={() => setTab('kpi')}>KPI Dashboard</button>
        </div>
        {tab === 'margin' && (
          <>
            <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
            <button className="btn-ghost" onClick={() => window.print()} title="Print / Save as PDF with the company header">
              🖨 PDF
            </button>
          </>
        )}
        {demoMode && <span className="muted">demo TRM revenue (~ceiling +15%)</span>}
      </div>

      {/* print header (§8.1 PDF export) */}
      <div className="print-header">
        <b>{s.companyName}</b> — Daily Margin Report · {day} (week {week[0]} → {week[6]})
      </div>

      {tab === 'margin' && (
        <>
          <section className="no-print">
            <h3>Settings <span className="muted">(fuel daily · FSC weekly · one place)</span></h3>
            <div className="margin-settings">
              {([
                ['Fuel CPM ($/mi)', 'fuelCpm'],
                ['FSC ($/mi, company avg)', 'fscPerMile'],
                ['Driver CPM — Team', 'driverCpmTeam'],
                ['Driver CPM — Solo', 'driverCpmSolo'],
              ] as Array<[string, 'fuelCpm' | 'fscPerMile' | 'driverCpmTeam' | 'driverCpmSolo']>).map(([label, key]) => (
                <label key={key}>
                  {label}
                  <input type="number" step="0.01" value={s[key]} onChange={(e) => saveMarginSettings({ [key]: num(e.target.value) })} />
                </label>
              ))}
              <label>
                Breakeven %
                <input
                  type="number" step="0.05"
                  value={+(s.breakevenPct * 100).toFixed(2)}
                  onChange={(e) => saveMarginSettings({ breakevenPct: num(e.target.value) / 100 })}
                />
              </label>
              <label>
                Company (PDF header)
                <input value={s.companyName} onChange={(e) => saveMarginSettings({ companyName: e.target.value })} />
              </label>
            </div>
          </section>

          <section>
            <h3>{day} — Daily Dashboard</h3>
            <div className="dedicated-dash">
              {([['Total Loads', String(dayRoll.loads)], ['Booked', String(dayRoll.booked)], ['Open', String(dayRoll.open)],
                ['Revenue', $0(dayRoll.revenue)], ['Cost', $0(dayRoll.cost)], ['Margin $', $0(dayRoll.marginD)],
                ['Margin %', pct(dayRoll.marginPct)],
                ['Status', dayRoll.marginPct != null && dayRoll.marginPct < s.breakevenPct ? 'UNDER' : 'ON TARGET']] as const
              ).map(([k, v]) => (
                <div key={k} className={`dash-card ${(k === 'Status' && v === 'UNDER') || (k === 'Margin $' && dayRoll.marginD < 0) ? 'dash-bad' : ''}`}>
                  <div className="dash-value">{v}</div>
                  <div className="dash-label">{k}</div>
                </div>
              ))}
            </div>
            {dayRoll.noTrm > 0 && (
              <p className="muted">⚠ {dayRoll.noTrm} load(s) excluded — no TRM rate on file (fix on the Integrity page).</p>
            )}
            <table className="list-table margin-table table-dense">
              <thead>
                <tr><th>Trip #</th><th>Lane</th><th>Mi</th><th>Line Haul</th><th>FSC</th><th>Revenue</th><th>Coverage</th><th>Cost</th><th>Margin $</th><th>Margin %</th><th>Status</th></tr>
              </thead>
              <tbody>
                {dayRows.map((r) => (
                  <tr key={r.load.id} className={r.state === 'under' ? 'row-warn' : ''}>
                    <td>{r.lane.tripCode.replace(/^FA2D3-/i, '')}</td>
                    <td className="wrap">{laneCompactName(r.lane)}</td>
                    <td>{r.miles ?? '—'}</td>
                    <td>{r.lineHaul != null ? $0(r.lineHaul) : '—'}</td>
                    <td>{r.miles != null && r.lineHaul != null ? $0(s.fscPerMile * r.miles) : '—'}</td>
                    <td>{r.state === 'no_trm' ? '—' : $0(r.revenue)}</td>
                    <td>{r.state === 'open' ? <span className="muted">Open</span> : r.load.carrier}{r.isAsset && ' ⛟'}</td>
                    <td>{r.state === 'open' || r.state === 'no_trm' ? '—' : $0(r.cost + r.chargeback)}</td>
                    <td>{r.state === 'open' || r.state === 'no_trm' ? '—' : $0(r.marginD)}</td>
                    <td>{r.state === 'open' || r.state === 'no_trm' ? '—' : pct(r.marginPct)}</td>
                    <td><StatusPill r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h3>Week Rollup <span className="muted">({week[0]} → {week[6]})</span></h3>
            <table className="list-table table-dense">
              <thead>
                <tr><th>Day</th><th>Loads</th><th>Booked</th><th>Open</th><th>Revenue</th><th>Cost</th><th>Margin $</th><th>Margin %</th><th>Status</th></tr>
              </thead>
              <tbody>
                {week.map((d, i) => {
                  const roll = rollup(weekRows.filter((r) => r.load.date === d));
                  return (
                    <tr key={d} className={d === day ? 'row-today' : ''}>
                      <td className="strong">{DAY_NAMES[i]} {Number(d.slice(5, 7))}/{Number(d.slice(8, 10))}</td>
                      <td>{roll.loads}</td><td>{roll.booked}</td><td>{roll.open}</td>
                      <td>{$0(roll.revenue)}</td><td>{$0(roll.cost)}</td><td>{$0(roll.marginD)}</td><td>{pct(roll.marginPct)}</td>
                      <td>{roll.booked === 0 ? '—' : roll.marginPct != null && roll.marginPct < s.breakevenPct ? 'UNDER' : 'ON TARGET'}</td>
                    </tr>
                  );
                })}
                <tr className="strong">
                  <td>WEEK TOTAL</td>
                  <td>{weekRoll.loads}</td><td>{weekRoll.booked}</td><td>{weekRoll.open}</td>
                  <td>{$0(weekRoll.revenue)}</td><td>{$0(weekRoll.cost)}</td><td>{$0(weekRoll.marginD)}</td><td>{pct(weekRoll.marginPct)}</td>
                  <td>{weekRoll.marginPct != null && weekRoll.marginPct < s.breakevenPct ? 'UNDER' : 'ON TARGET'}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h3>Top 5 / Bottom 5 lanes by Margin $ <span className="muted">(booked, this week)</span></h3>
            <div className="top5-grid">
              {[['Top 5', top5], ['Bottom 5', bottom5]].map(([label, list]) => (
                <table key={label as string} className="list-table table-dense">
                  <thead><tr><th>{label as string}</th><th>Carrier</th><th>LC</th><th>Rev</th><th>Cost</th><th>Margin $</th><th>%</th></tr></thead>
                  <tbody>
                    {(list as LoadMargin[]).map((r) => (
                      <tr key={r.load.id}>
                        <td className="wrap">{r.lane.tripCode.replace(/^FA2D3-/i, '')} · {laneCompactName(r.lane)}</td>
                        <td className="wrap">{r.load.carrier}</td>
                        <td className="wrap">{(r.rep || '—').split(' ')[0]}</td>
                        <td>{$0(r.revenue)}</td><td>{$0(r.cost + r.chargeback)}</td>
                        <td className={r.marginD < 0 ? 'neg' : ''}>{$0(r.marginD)}</td><td>{pct(r.marginPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          </section>

          <section>
            <h3>Per Rep <span className="muted">(booked this week)</span></h3>
            <table className="list-table table-dense">
              <thead><tr><th>Rep</th><th>Booked</th><th>Revenue</th><th>Cost</th><th>Margin $</th><th>Avg Margin %</th></tr></thead>
              <tbody>
                {repWeek.map((r) => (
                  <tr key={r.rep}>
                    <td className="strong">{r.rep}</td>
                    <td>{r.booked}</td><td>{$0(r.revenue)}</td><td>{$0(r.cost)}</td><td>{$0(r.marginD)}</td><td>{pct(r.marginPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === 'kpi' && (
        <>
          <section className="no-print">
            <div className="status-chips">
              {(['today', 'week', 'month', 'custom'] as const).map((w) => (
                <button key={w} className={`chip ${kpiWin === w ? 'chip-on' : ''}`} onClick={() => setKpiWin(w)}>{w}</button>
              ))}
              {kpiWin === 'custom' && (
                <>
                  <input type="date" value={kpiFrom} onChange={(e) => e.target.value && setKpiFrom(e.target.value)} />
                  <input type="date" value={kpiTo} onChange={(e) => e.target.value && setKpiTo(e.target.value)} />
                </>
              )}
              <button className="btn-ghost" onClick={exportKpiCsv}>⬇ Export CSV</button>
            </div>
          </section>
          <section>
            <h3>Per-Rep KPIs <span className="muted">({kpiDates[0]} → {kpiDates[kpiDates.length - 1]} · goals {mayEditGoals ? 'editable (FedCom)' : 'FedCom-set'})</span></h3>
            <table className="list-table table-dense">
              <thead>
                <tr>
                  <th>Rep</th><th>Covers</th><th title="Dedicated carrier on its own dedicated lane — no cover credit">Plug-ins</th><th>Goal/day</th><th>Actual/day</th><th>Avg booked rate</th>
                  <th>≤ Target</th><th>In band</th><th>&gt; Ceiling</th><th>Avg margin %</th><th>Chargebacks</th>
                </tr>
              </thead>
              <tbody>
                {kpi.map((a) => {
                  const roll = rollup(a.marginRows);
                  const perDay = a.covers / kpiDates.length;
                  const goal = goalFor(a.rep);
                  const u = userFor(a.rep);
                  const healthy = roll.marginPct != null && roll.marginPct >= s.breakevenPct;
                  return (
                    <tr key={a.rep}>
                      <td className="strong">{a.rep}</td>
                      <td>{a.covers}</td>
                      <td className="muted">{a.plugIns || '—'}</td>
                      <td>
                        {mayEditGoals && u ? (
                          <input
                            type="number" min={0} style={{ width: 58 }}
                            value={u.dailyGoal ?? s.repGoalDefault}
                            onChange={(e) => setUserGoal(u.id, Number(e.target.value) || 0)}
                          />
                        ) : mayEditGoals ? (
                          <span className="muted" title="This rep books under a name with no matching user account — goals attach to accounts. Default applies.">
                            {goal}*
                          </span>
                        ) : goal}
                      </td>
                      <td className={perDay >= goal ? 'kpi-good' : 'kpi-bad'}>{perDay.toFixed(1)} {perDay >= goal ? '✓' : '▼'}</td>
                      <td>{a.rated ? $0(a.rateSum / a.rated) : '—'}</td>
                      <td>{a.belowTarget}</td><td>{a.inBand}</td><td>{a.aboveCeiling}</td>
                      <td className={healthy ? 'kpi-good' : 'kpi-bad'}>{pct(roll.marginPct)}</td>
                      <td>{a.chargebacks || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {kpi.length === 0 && <p className="muted">No booked loads in this window.</p>}
          </section>
        </>
      )}
    </div>
  );
}
