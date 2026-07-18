import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../data/store';
import { can } from '../permissions';
import { buildTrailerLinks, openTrailerLinks, siteDrift, type TrailerLink } from '../trailers';
import { fmtMoney, laneCompactName, type Load } from '../types';
import { fmtStamp, todayCentral } from '../dates';

/* Loadout Trailers (Caleb 07/15, upgraded 07/17) — Sam's dashboard. Everything
   derives from loads carrying a trailer #: the return clock starts at UNLOAD,
   fines accrue on the tiered rate-con schedule, the weekly "Bill & reset" run
   charges outstanding fines against carrier payables (stamping billed-through
   days so counters restart), and the exemption list waives carrier+destination
   pairs unless a trailer is overridden. */

const SITE_CHOICES = ['San Antonio, TX', 'Dallas, TX', 'Memphis, TN', 'Columbia, SC'];

export default function TrailersView() {
  const { loads, lanes, updateLoad, currentUser, trailerSettings, saveTrailerSettings } = useStore();
  const navigate = useNavigate();
  const [showClosed, setShowClosed] = useState(false);
  const [q, setQ] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [siteEditId, setSiteEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [exCarrier, setExCarrier] = useState('');
  const [exDest, setExDest] = useState('');
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const mayMark = can(currentUser, 'trailers.mark');
  const mayApprove = can(currentUser, 'trailers.approve');

  const links = useMemo(() => buildTrailerLinks(loads, lanes, trailerSettings), [loads, lanes, trailerSettings]);
  const open = openTrailerLinks(links);
  const drift = useMemo(() => siteDrift(links), [links]);
  const accruing = open.reduce((n, l) => n + l.fine, 0);
  const overdue = open.filter((l) => l.daysLeft < 0);
  const returnSites = useMemo(() => [...new Set(links.map((l) => l.returnSite))].sort(), [links]);

  /* oldest / highest outstanding fines float to the top (Caleb 07/17) */
  const shown = (showClosed ? links : open)
    .filter((l) => !siteFilter || l.returnSite === siteFilter)
    .filter((l) => {
      const needle = q.trim().toLowerCase();
      return !needle || `${l.trailer} ${l.carrier} ${l.load.loadNumber} ${l.originSite} ${l.returnSite} ${l.load.trailerNotes ?? ''}`.toLowerCase().includes(needle);
    })
    .sort((a, b) =>
      Number(a.returned || a.rolled) - Number(b.returned || b.rolled)
      || b.fine - a.fine
      || a.daysLeft - b.daysLeft);

  const detail = detailId ? links.find((l) => l.load.id === detailId) ?? null : null;

  function markReturned(link: TrailerLink) {
    const load = link.load;
    if (load.trailerReturnedAt) {
      if (window.confirm(`Un-mark trailer ${link.trailer} as returned?`)) void updateLoad(load.id, { trailerReturnedAt: '' });
      return;
    }
    if (!window.confirm(`Trailer ${link.trailer} is back at ${link.returnSite}?`)) return;
    void updateLoad(load.id, { trailerReturnedAt: new Date().toISOString() });
  }

  function extendDays(link: TrailerLink) {
    const v = window.prompt(
      `Approved free days for trailer ${link.trailer} (blank resets to the PO default):`,
      String(link.freeDays),
    );
    if (v == null) return;
    const n = Number(v);
    if (!v.trim() || !Number.isFinite(n) || n <= 0) { void updateLoad(link.load.id, { trailerFreeDays: null }); return; }
    void updateLoad(link.load.id, { trailerFreeDays: Math.round(n) });
  }

  function pickSite(link: TrailerLink, v: string) {
    setSiteEditId(null);
    if (!v) return;
    if (v === '__other') {
      const site = (window.prompt(`Alternate drop site for trailer ${link.trailer}:`, link.returnSite) ?? '').trim();
      if (site) void updateLoad(link.load.id, { trailerReturnSite: site });
      return;
    }
    if (v === '__origin') { void updateLoad(link.load.id, { trailerReturnSite: '' }); return; }
    void updateLoad(link.load.id, { trailerReturnSite: v });
  }

  function saveNote(load: Load) {
    const v = noteDraft[load.id];
    if (v != null && v !== (load.trailerNotes ?? '')) void updateLoad(load.id, { trailerNotes: v });
  }

  /* Weekly billing run (Caleb 07/17): charge every outstanding fine against
     carrier payables and reset the counters — stamps billed-through days so
     accrual restarts from zero while history keeps the running total. */
  const billable = open.filter((l) => l.fine > 0);
  function billAll() {
    const total = billable.reduce((n, l) => n + l.fine, 0);
    if (!window.confirm(
      `Bill ${billable.length} trailer fine${billable.length === 1 ? '' : 's'} totalling ${fmtMoney(total)} against carrier payables and reset the counters?\n\nA CSV of this run downloads for accounting.`,
    )) return;
    const stamp = new Date().toISOString();
    const rows = [['Billed at', 'Trailer #', 'Carrier', 'LS#', 'Lane', 'Days late', 'Amount billed (this run)', 'Billed to date (total)']];
    for (const l of billable) {
      rows.push([
        stamp, l.trailer, l.carrier, l.load.loadNumber || '', laneCompactName(l.lane),
        String(l.lateDays), String(l.fine), String(l.fineBilled + l.fine),
      ]);
      void updateLoad(l.load.id, { trailerBilledDays: l.lateDays, trailerBilledAt: stamp });
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `trailer-fines-billed-${todayCentral()}.csv`;
    a.click();
  }

  const loadLink = (load: Load) => (
    <button className="load-link" title="Open in Matrix" onClick={(e) => { e.stopPropagation(); navigate(`/matrix?load=${encodeURIComponent(load.id)}`); }}>
      {load.loadNumber || load.id}
    </button>
  );

  return (
    <div className="page">
      <div className="page-head">
        <h2>Loadout Trailers</h2>
        <span className="muted">
          derived from PO loads carrying a trailer # — the clock starts at unload
        </span>
        {overdue.length > 0 && <span className="exposed-count">{overdue.length} overdue · {fmtMoney(accruing)} outstanding</span>}
      </div>

      <section className="dedicated-dash">
        <div className="dash-card">
          <div className="dash-value">{open.length}</div>
          <div className="dash-label">Trailers out</div>
        </div>
        <div className="dash-card">
          <div className="dash-value">{overdue.length}</div>
          <div className="dash-label">Overdue</div>
        </div>
        <div className="dash-card">
          <div className="dash-value">{fmtMoney(accruing)}</div>
          <div className="dash-label">Fines outstanding</div>
        </div>
        {drift.map((d) => (
          <div key={d.site} className="dash-card">
            <div className="dash-value">{d.net > 0 ? `+${d.net}` : d.net}</div>
            <div className="dash-label">{d.site}</div>
          </div>
        ))}
      </section>

      <div className="track-filters">
        <input className="matrix-search" placeholder="Search trailer # / carrier / LS# / site / notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inline-select" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} title="Filter by return site">
          <option value="">All return sites</option>
          {returnSites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="chip-check">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show returned / rolled
        </label>
        {mayApprove && (
          <label className="chip-check" title="Tiered late fine (rate-con): the first N overdue days bill at the lower rate, every day after at the higher rate">
            Fine: first
            <input className="inline-input fine-input" type="number" min={0} value={trailerSettings.tierDays}
              onChange={(e) => void saveTrailerSettings({ tierDays: Math.max(0, Number(e.target.value) || 0) })} />
            d @ $
            <input className="inline-input fine-input" type="number" min={0} value={trailerSettings.tier1PerDay}
              onChange={(e) => void saveTrailerSettings({ tier1PerDay: Math.max(0, Number(e.target.value) || 0) })} />
            then $
            <input className="inline-input fine-input" type="number" min={0} value={trailerSettings.tier2PerDay}
              onChange={(e) => void saveTrailerSettings({ tier2PerDay: Math.max(0, Number(e.target.value) || 0) })} />
            /day
          </label>
        )}
        {mayApprove && billable.length > 0 && (
          <button className="btn-primary" title="Weekly run: charge every outstanding fine against carrier payables and restart the counters (CSV downloads for accounting)" onClick={billAll}>
            ⚖ Bill fines & reset ({billable.length} · {fmtMoney(billable.reduce((n, l) => n + l.fine, 0))})
          </button>
        )}
      </div>

      {mayApprove && (
        <details className="exemption-box">
          <summary>Exemption list ({(trailerSettings.exemptions ?? []).length}) — carrier + destination pairs that never accrue fines</summary>
          <p className="muted">
            Trailers on these pairings stay tracked but fine at $0. To charge one
            anyway, open its row and use “Charge fines anyway”.
          </p>
          <ul className="exemption-list">
            {(trailerSettings.exemptions ?? []).map((e, i) => (
              <li key={`${e.carrier}|${e.dest}`}>
                <b>{e.carrier}</b> → {e.dest}
                <button className="btn-ghost btn-sm" title="Remove this exemption"
                  onClick={() => void saveTrailerSettings({ exemptions: (trailerSettings.exemptions ?? []).filter((_, j) => j !== i) })}>
                  🗑
                </button>
              </li>
            ))}
          </ul>
          <div className="exemption-add">
            <input className="inline-input" placeholder="Carrier (e.g. Ocean Star)" value={exCarrier} onChange={(e) => setExCarrier(e.target.value)} />
            <input className="inline-input" placeholder="Destination (e.g. Opa Locka)" value={exDest} onChange={(e) => setExDest(e.target.value)} />
            <button className="btn-ghost" disabled={!exCarrier.trim() || !exDest.trim()}
              onClick={() => {
                void saveTrailerSettings({ exemptions: [...(trailerSettings.exemptions ?? []), { carrier: exCarrier.trim(), dest: exDest.trim() }] });
                setExCarrier(''); setExDest('');
              }}>
              ＋ Add
            </button>
          </div>
        </details>
      )}

      {shown.length === 0 ? (
        <p className="muted">
          No loadout trailers on the books{q || siteFilter ? ' for this filter' : ''} — trailer #s get entered when booking a PO load. ✓
        </p>
      ) : (
        <table className="list-table trailers-table">
          <thead>
            <tr>
              <th>Trailer #</th><th>Carrier</th><th>LS#</th><th>Lane</th><th>PU</th>
              <th title="deliveredAt when T&T marked it; scheduled otherwise">Unload</th>
              <th>Free</th><th>ETA</th><th>Return site</th>
              <th>Days left</th><th>Fine</th><th>Notes</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr
                key={l.load.id}
                className={l.returned || l.rolled ? 'trailer-closed' : l.daysLeft < 0 ? 'row-overdue' : ''}
                onClick={() => setDetailId(l.load.id)}
                title="Click for full trailer details"
              >
                <td className="strong t-num">{l.trailer}</td>
                <td className="wrap">{l.carrier}</td>
                <td className="t-sm">{loadLink(l.load)}</td>
                <td className="wrap">{laneCompactName(l.lane)}</td>
                <td className="t-sm">{Number(l.load.date.slice(5, 7))}/{Number(l.load.date.slice(8, 10))}</td>
                <td>
                  {Number(l.unloadDate.slice(5, 7))}/{Number(l.unloadDate.slice(8, 10))}
                  {!l.unloadIsActual && <span className="muted" title="Scheduled — T&T hasn't marked Delivered yet"> (sched)</span>}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {l.freeDays}{l.load.trailerFreeDays ? <b title="Approved override">*</b> : ''}
                  {mayApprove && !l.returned && !l.rolled && (
                    <button className="btn-ghost btn-sm pencil-gap" title="Approve a free-day extension" onClick={() => extendDays(l)}>✎</button>
                  )}
                </td>
                <td className="t-sm">{Number(l.returnEta.slice(5, 7))}/{Number(l.returnEta.slice(8, 10))}</td>
                <td className="wrap" onClick={(e) => e.stopPropagation()}>
                  {siteEditId === l.load.id ? (
                    <select
                      autoFocus
                      className="inline-select"
                      defaultValue=""
                      onChange={(e) => pickSite(l, e.target.value)}
                      onBlur={() => setSiteEditId(null)}
                    >
                      <option value="">— pick return site —</option>
                      {SITE_CHOICES.map((s) => <option key={s} value={s}>{s}</option>)}
                      <option value="__other">Other…</option>
                      <option value="__origin">↩ {l.originSite} (origin default)</option>
                    </select>
                  ) : (
                    <>
                      {l.returnSite}
                      {l.returnSite.toLowerCase() !== l.originSite.toLowerCase() && (
                        <span className="muted" title={`Approved away from ${l.originSite}`}> (from {l.originSite})</span>
                      )}
                      {mayApprove && !l.returned && !l.rolled && (
                        <button className="btn-ghost btn-sm pencil-gap" title="Approve an alternate drop site" onClick={() => setSiteEditId(l.load.id)}>✎</button>
                      )}
                    </>
                  )}
                </td>
                <td className={`t-sm ${l.daysLeft < 0 ? 'strong' : ''}`}>
                  {l.returned ? `ret ${fmtStamp(l.load.trailerReturnedAt!).split(' ')[0]}`
                    : l.rolled ? 'rolled'
                    : l.daysLeft < 0 ? `${-l.daysLeft} late` : l.daysLeft}
                </td>
                <td className={`t-sm ${l.fine > 0 ? 'strong neg' : ''}`}>
                  {l.exempt ? <span className="muted" title="Exemption list — open the row to charge anyway">exempt</span>
                    : l.fine > 0 ? fmtMoney(l.fine) : '—'}
                  {l.fineBilled > 0 && <span className="muted" title={`${fmtMoney(l.fineBilled)} already billed`}>*</span>}
                </td>
                <td className="t-notes" onClick={(e) => e.stopPropagation()}>
                  {mayMark ? (
                    <input
                      className="inline-input trailer-note-input"
                      value={noteDraft[l.load.id] ?? l.load.trailerNotes ?? ''}
                      placeholder="notes…"
                      onChange={(e) => setNoteDraft((d) => ({ ...d, [l.load.id]: e.target.value }))}
                      onBlur={() => saveNote(l.load)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  ) : (l.load.trailerNotes || '—')}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {mayMark && !l.rolled && (
                    <button className={l.returned ? 'btn-ghost btn-sm' : 'btn-approve'} onClick={() => markReturned(l)}>
                      {l.returned ? 'undo' : 'Mark returned?'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detail && (
        <div className="editor-overlay" onClick={() => setDetailId(null)}>
          <div className="editor trailer-detail" onClick={(e) => e.stopPropagation()}>
            <div className="editor-head">
              <div>
                <div className="editor-lane">Trailer {detail.trailer} — {detail.carrier}</div>
                <div className="editor-sub">{laneCompactName(detail.lane)} · LS# {detail.load.loadNumber || '—'}</div>
              </div>
              <button className="btn-ghost btn-icon" onClick={() => setDetailId(null)} aria-label="Close">✕</button>
            </div>
            <div className="trailer-detail-grid">
              <span className="muted">Picked up</span><span>{detail.load.date} from {detail.originSite}</span>
              <span className="muted">Unloaded</span>
              <span>{detail.unloadDate}{detail.unloadIsActual ? '' : ' (scheduled — not yet T&T-confirmed)'}</span>
              <span className="muted">Free days</span>
              <span>{detail.freeDays}{detail.load.trailerFreeDays ? ' (approved override)' : ' (from Loading/TRM)'}</span>
              <span className="muted">Return ETA</span><span>{detail.returnEta}</span>
              <span className="muted">Return site</span>
              <span>{detail.returnSite}{detail.returnSite.toLowerCase() !== detail.originSite.toLowerCase() ? ` (origin ${detail.originSite})` : ''}</span>
              <span className="muted">Status</span>
              <span>
                {detail.returned ? `Returned ${fmtStamp(detail.load.trailerReturnedAt!)}`
                  : detail.rolled ? 'Rolled — a later load restarted the clock'
                  : detail.daysLeft < 0 ? `${-detail.daysLeft} day${detail.daysLeft === -1 ? '' : 's'} OVERDUE` : `${detail.daysLeft} day(s) left`}
              </span>
              <span className="muted">Fine accrued</span><span>{fmtMoney(detail.fineAccrued)}</span>
              <span className="muted">Billed to date</span>
              <span>{detail.fineBilled > 0 ? `${fmtMoney(detail.fineBilled)}${detail.load.trailerBilledAt ? ` (last run ${fmtStamp(detail.load.trailerBilledAt)})` : ''}` : '—'}</span>
              <span className="muted">Outstanding</span><span className={detail.fine > 0 ? 'strong neg' : ''}>{fmtMoney(detail.fine)}</span>
              <span className="muted">Exemption</span>
              <span>
                {detail.exempt ? 'On the exemption list — no fines'
                  : detail.load.trailerFineOverride ? 'Exemption OVERRIDDEN — fines charge' : '—'}
                {mayApprove && (detail.exempt || detail.load.trailerFineOverride) && (
                  <button className="btn-ghost btn-sm pencil-gap"
                    onClick={() => void updateLoad(detail.load.id, { trailerFineOverride: !detail.load.trailerFineOverride })}>
                    {detail.load.trailerFineOverride ? '↩ Re-exempt' : 'Charge fines anyway'}
                  </button>
                )}
              </span>
            </div>
            {links.filter((x) => x.trailer === detail.trailer && x.load.id !== detail.load.id).length > 0 && (
              <>
                <h4>Journey chain</h4>
                <ul className="trailer-chain">
                  {links.filter((x) => x.trailer === detail.trailer).sort((a, b) => a.load.date.localeCompare(b.load.date)).map((x) => (
                    <li key={x.load.id} className={x.load.id === detail.load.id ? 'strong' : ''}>
                      {x.load.date} · {laneCompactName(x.lane)} · LS# {x.load.loadNumber || '—'} ·{' '}
                      {x.returned ? 'returned' : x.rolled ? 'rolled' : 'open'}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <label className="trailer-detail-notes">
              Notes
              <textarea
                rows={2}
                readOnly={!mayMark}
                value={noteDraft[detail.load.id] ?? detail.load.trailerNotes ?? ''}
                onChange={(e) => setNoteDraft((d) => ({ ...d, [detail.load.id]: e.target.value }))}
                onBlur={() => saveNote(detail.load)}
              />
            </label>
            <div className="editor-actions">
              <button className="btn-ghost" onClick={(e) => { e.stopPropagation(); navigate(`/matrix?load=${encodeURIComponent(detail.load.id)}`); }}>
                Open load in Matrix →
              </button>
              <span className="spacer" />
              <button className="btn-ghost" onClick={() => setDetailId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
