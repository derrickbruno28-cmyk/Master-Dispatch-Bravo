import { useMemo, useState } from 'react';
import { can } from '../permissions';
import { useStore } from '../data/store';
import {
  DAY_LABELS,
  expectedWeekdays,
  laneTripNumber,
  type DedicatedLane,
  type Lane,
} from '../types';

/* §7.1 dedicated-day master — mirrors the Daily Margin Report "Dedicated
   Lanes" tab (the source of truth going forward). The Mon–Sun booleans are
   what the system expects: LoadEditor/Matrix stop suggesting the dedicated
   carrier on days that are false here. Reconcile is a REPORT (never an
   auto-overwrite): master vs CTS notes vs lane frequency. */

/** Origin hygiene: the tab has variants differing only by trailing spaces /
    a dangling "S" suffix (e.g. "LOG MEMPHIS TN RPDC          S"). */
export function normalizeOrigin(raw: string): string {
  return raw.replace(/\s{2,}S$/i, '').replace(/\s+/g, ' ').trim();
}


/* parseDedicatedSheet removed 07/14 — dedicated rows auto-create from
   Integrity lane edits; there is no sheet import anymore. */

const trueDays = (d: DedicatedLane) => (d.everyDay ? 7 : d.days.filter(Boolean).length);

export default function DedicatedView({ embedded = false }: { embedded?: boolean } = {}) {
  const { dedicated, lanes, carriers, currentUser, updateDedicated, removeDedicated, setCarrierIssue, demoMode } = useStore();
  const [dedSearch, setDedSearch] = useState('');
  const pricing = can(currentUser, 'integrity.dedicated');
  const admin = can(currentUser, 'integrity.carriers');

  const dash = useMemo(() => {
    const rev = dedicated.reduce((n, d) => n + (d.revenuePerDay ?? 0) * trueDays(d), 0);
    const cost = dedicated.reduce((n, d) => n + (d.carrierRate ?? 0) * trueDays(d), 0);
    return { lanes: dedicated.length, rev, cost, margin: rev - cost, pct: rev ? (rev - cost) / rev : 0 };
  }, [dedicated]);

  /* Reconcile report: master vs lane CTS notes + lane frequency. Report only. */
  const mismatches = useMemo(() => {
    const byTrip = new Map<string, Lane>();
    for (const l of lanes) {
      const t = laneTripNumber(l);
      if (t && !l.isGroupHeader) byTrip.set(t, l);
    }
    const out: Array<{ d: DedicatedLane; kind: string; detail: string }> = [];
    for (const d of dedicated) {
      const lane = byTrip.get(d.tripNumber);
      if (!lane) {
        out.push({ d, kind: 'no-lane', detail: 'No Matrix lane carries this trip # — other contract or retired trip.' });
        continue;
      }
      const cts = (lane.dedicatedCarrier ?? '').trim();
      if (cts && cts.toLowerCase() !== d.carrier.toLowerCase()) {
        out.push({ d, kind: 'carrier', detail: `CTS notes say "${cts}" — master says "${d.carrier}".` });
      } else if (!cts) {
        out.push({ d, kind: 'not-marked', detail: 'Lane is not marked dedicated in CTS notes at all.' });
      }
      const runDays = expectedWeekdays(lane.frequency); // Sun=0..Sat=6 or null
      if (runDays) {
        const extra = DAY_LABELS.filter((_, i) => {
          const sundayIdx = (i + 1) % 7; // Mon(0)->1 ... Sun(6)->0
          return (d.everyDay || d.days[i]) && !runDays.includes(sundayIdx);
        });
        if (extra.length) {
          out.push({ d, kind: 'freq', detail: `Dedicated on ${extra.join('/')} but the trip doesn't run those days (freq "${lane.frequency.split('\n')[0]}").` });
        }
      }
    }
    return out;
  }, [dedicated, lanes]);


  const carrierIssue = (name: string) =>
    carriers.find((c) => c.name.toLowerCase() === name.toLowerCase())?.issue ?? false;

  const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;

  return (
    <div className={embedded ? 'embedded-tab' : 'page'}>
      <div className="page-head">
        {!embedded && <h2>Dedicated</h2>}
        <span className="muted">
          Per-carrier dedicated days — the master, not CTS notes. {dedicated.length} lanes
          {demoMode && ' · demo (import to try it)'}
        </span>
        {/* XLSX import RETIRED (Caleb 07/14): rows are auto-created when a
            lane is marked dedicated in Integrity (✎ — carrier dropdown +
            start date); the TRM upload remains verification-only. */}
        <input
          className="matrix-search"
          placeholder="Search trip # / carrier / origin…"
          value={dedSearch}
          onChange={(e) => setDedSearch(e.target.value)}
        />
      </div>

      <section className="dedicated-dash">
        {[
          ['Total Dedicated Lanes', String(dash.lanes)],
          ['Weekly Dedicated Revenue', fmt$(dash.rev)],
          ['Weekly Dedicated Cost', fmt$(dash.cost)],
          ['Weekly Dedicated Margin $', fmt$(dash.margin)],
          ['Weekly Dedicated Margin %', `${(dash.pct * 100).toFixed(2)}%`],
        ].map(([k, v]) => (
          <div key={k} className={`dash-card ${k.includes('Margin') && dash.margin < 0 ? 'dash-bad' : ''}`}>
            <div className="dash-value">{v}</div>
            <div className="dash-label">{k}</div>
          </div>
        ))}
      </section>

      <section>
        <h3>Master <span className="muted">(one row per Trip # × Carrier; day boxes are the source of truth)</span></h3>
        {dedicated.length === 0 ? (
          <p className="muted">Empty — import the Daily Margin Report's Dedicated Lanes tab to seed it.</p>
        ) : (
          <table className="list-table dedicated-table table-dense">
            <thead>
              <tr>
                <th>Trip #</th><th>Origin</th><th>Destination</th><th>Mi</th><th>Carrier</th>
                <th title="LC who dedicated the trip — best relationship for sliding the carrier to an earlier PU">LC</th>
                <th>Rate/day</th><th>Rev/day</th>
                {DAY_LABELS.map((d) => <th key={d}>{d}</th>)}
                <th>Notes</th><th>✓</th><th></th>
              </tr>
            </thead>
            <tbody>
              {[...dedicated]
                .filter((d) => {
                  const q = dedSearch.trim().toLowerCase();
                  return !q || `${d.tripNumber} ${d.carrier} ${d.origin} ${d.destination} ${d.lc ?? ''}`.toLowerCase().includes(q);
                })
                .sort((a, b) => a.origin.localeCompare(b.origin) || Number(a.tripNumber) - Number(b.tripNumber)).map((d) => (
                <tr key={d.id}>
                  <td className="strong">{d.tripNumber}</td>
                  <td className="wrap">{d.origin}</td>
                  <td className="wrap">{d.destination}</td>
                  <td>{d.miles ?? '—'}</td>
                  <td className="wrap">
                    {d.carrier}
                    {carrierIssue(d.carrier) && <span title="Carrier flagged as an issue"> ⚠️</span>}
                    {admin && (
                      <button
                        className="btn-ghost btn-sm"
                        style={{ marginLeft: 4, padding: '0 6px' }}
                        title={carrierIssue(d.carrier) ? 'Clear issue flag' : 'Flag carrier as an issue'}
                        onClick={() => {
                          const c = carriers.find((x) => x.name.toLowerCase() === d.carrier.toLowerCase());
                          if (c) void setCarrierIssue(c.id, !c.issue);
                        }}
                      >
                        ⚑
                      </button>
                    )}
                  </td>
                  <td>
                    {pricing ? (
                      <input
                        className="inline-input lc-input"
                        value={d.lc ?? ''}
                        placeholder="LC"
                        onChange={(e) => void updateDedicated(d.id, { lc: e.target.value })}
                      />
                    ) : (
                      d.lc || '—'
                    )}
                  </td>
                  <td>{d.carrierRate != null ? `$${d.carrierRate}` : '—'}</td>
                  <td>{d.revenuePerDay != null ? `$${d.revenuePerDay}` : '—'}</td>
                  {DAY_LABELS.map((_, i) => (
                    <td key={i}>
                      <input
                        type="checkbox"
                        checked={d.everyDay || d.days[i]}
                        disabled={!pricing}
                        onChange={(e) => {
                          const days = d.days.slice();
                          days[i] = e.target.checked;
                          void updateDedicated(d.id, { days, everyDay: days.every(Boolean) });
                        }}
                      />
                    </td>
                  ))}
                  <td className="muted wrap">{d.notes || '—'}</td>
                  <td>{d.validated ? '✅' : '—'}</td>
                  <td>
                    {pricing && (
                      <button
                        className="btn-ghost btn-sm"
                        title="Remove this carrier from dedicated (trip goes back to open coverage)"
                        onClick={() => {
                          if (window.confirm(`Remove ${d.carrier} from dedicated trip ${d.tripNumber}? The trip goes back to open coverage.`)) {
                            void removeDedicated(d.id);
                          }
                        }}
                      >
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3>Reconcile report <span className="muted">({mismatches.length} — review only, nothing auto-overwrites)</span></h3>
        <p className="muted">
          Master vs the seeded CTS notes and each lane's frequency. The master wins going
          forward; fix CTS notes via the lane editor when a row below looks right.
        </p>
        {mismatches.length === 0 ? (
          <p className="muted">Clean — master, CTS notes, and trip frequencies agree. ✓</p>
        ) : (
          <table className="list-table table-dense">
            <thead>
              <tr><th>Trip #</th><th>Carrier</th><th>Type</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {mismatches.map((m, i) => (
                <tr key={i}>
                  <td className="strong">{m.d.tripNumber}</td>
                  <td className="wrap">{m.d.carrier}</td>
                  <td><span className={`pill pill-mismatch-${m.kind}`}>{m.kind}</span></td>
                  <td className="wrap muted">{m.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
