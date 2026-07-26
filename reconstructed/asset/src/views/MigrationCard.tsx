/* Phase 0 migration — the REVIEW SCREEN.

   Hard rule: no feature silently writes parsed or inferred data. So this card
   never migrates on load, on mount, or on a single click. It plans first, shows
   every field it would write and where that value came from, makes the human
   resolve anything it had to guess, and only then writes.

   Owner-only: the migration rewrites shared load documents, which is the most
   destructive-adjacent thing in the app even though it is additive by design. */

import { useState } from 'react';
import { isOwner } from '../data/permStore';
import { firebaseEnabled } from '../firebase';
import { planMigration, applyMigration, verifyMigration, type MigrationPlan, type ApplyResult, type Provenance } from '../data/tms/migrate';
import { BOOKING_AUTHORITIES, BOOKING_TERMINALS, SCHEMA_VERSION } from '../data/tms/types';

const HOW_COLOR: Record<Provenance, string> = {
  carried: 'var(--green)',
  suggested: 'var(--amber)',
  defaulted: 'var(--muted)',
};
const HOW_LABEL: Record<Provenance, string> = {
  carried: 'carried',
  suggested: 'suggested',
  defaulted: 'default',
};

export default function MigrationCard() {
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [verified, setVerified] = useState<{ total: number; migrated: number; stops: number; assignments: number } | null>(null);
  const [confirm, setConfirm] = useState(false);

  if (!isOwner()) return null;

  function review() {
    setResult(null); setVerified(null); setConfirm(false);
    setPlan(planMigration());
  }

  /* the reviewer's picks live on the plan itself, so apply() writes exactly what
     is on screen — there is no second source of truth to drift from */
  function setPick(id: string, field: 'bookingAuthority' | 'bookingTerminal', value: string) {
    setPlan((p) => p && ({ ...p, plans: p.plans.map((x) => (x.id === id ? { ...x, [field]: value } : x)) }));
  }

  const pending = plan?.plans.filter((p) => !p.alreadyMigrated) ?? [];
  const unresolved = pending.filter((p) => !p.bookingAuthority || !p.bookingTerminal);
  const canApply = !!plan && pending.length > 0 && unresolved.length === 0 && firebaseEnabled;

  async function apply() {
    if (!plan) return;
    setBusy(true); setConfirm(false);
    const r = await applyMigration(plan);
    setResult(r);
    setVerified(await verifyMigration());
    setPlan(planMigration());   // re-plan so migrated rows flip to "already done"
    setBusy(false);
  }

  return (
    <div className="intg-card">
      <div className="intg-card-head">
        <div className="intg-card-title">
          <span className="intg-status-dot" style={{ background: 'var(--accent)' }} />
          🧱 TMS data model <span className="intg-card-sub">Phase 0 · schema v{SCHEMA_VERSION}</span>
        </div>
        <span className="intg-badge">Owner only</span>
      </div>

      <p className="am-muted" style={{ fontSize: 12.5, maxWidth: 760 }}>
        Upgrades existing load records to the TMS execution schema — load number, route/trip numbers,
        booking authority + terminal, billing status, refs, financials — and mirrors each load's stops and
        trucks into the new <b>stops</b> and <b>assignments</b> subcollections.
        <b> Nothing is removed:</b> every existing field stays exactly where it is, so the board, the load
        modal, and the reports keep working unchanged while the new schema fills in underneath.
      </p>

      <div className="intg-live-row">
        <button type="button" className="am-clear" disabled={busy} onClick={review}>
          {plan ? '↻ Re-scan loads' : '🔎 Review migration'}
        </button>
        {plan && (
          <span className="am-muted" style={{ fontSize: 12 }}>
            {plan.pending} to migrate · {plan.alreadyDone} already on v{SCHEMA_VERSION}
          </span>
        )}
      </div>

      {plan && plan.pending === 0 && (
        <div className="intg-mock-note" style={{ borderColor: 'var(--green)' }}>
          ✓ Every load is already on schema v{SCHEMA_VERSION}. Nothing to migrate.
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {pending.map((p) => {
            const isOpen = !!open[p.id];
            const needs = !p.bookingAuthority || !p.bookingTerminal;
            return (
              <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 11px', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="am-clear" onClick={() => setOpen((o) => ({ ...o, [p.id]: !isOpen }))}>
                    {isOpen ? '▾' : '▸'} {p.label}
                  </button>
                  <span className="am-muted" style={{ fontSize: 11.5 }}>
                    {p.stops.length} stop{p.stops.length === 1 ? '' : 's'} · {p.assignments.length} leg{p.assignments.length === 1 ? '' : 's'}
                  </span>
                  {needs && <span className="am-pill" style={{ color: 'var(--amber)' }}>needs 2 answers</span>}
                </div>

                {/* the two required enums with no legacy source — a human picks, we never guess */}
                <div className="load-two" style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700 }}>
                    Booking authority *
                    <select className="am-input" value={p.bookingAuthority} onChange={(e) => setPick(p.id, 'bookingAuthority', e.target.value)}>
                      <option value="">— pick one —</option>
                      {BOOKING_AUTHORITIES.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 11.5, fontWeight: 700 }}>
                    Booking terminal *
                    <select className="am-input" value={p.bookingTerminal} onChange={(e) => setPick(p.id, 'bookingTerminal', e.target.value)}>
                      <option value="">— pick one —</option>
                      {BOOKING_TERMINALS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                </div>

                {p.unresolvedDrivers.length > 0 && (
                  <div className="am-notice" style={{ color: 'var(--amber)', background: 'rgba(224,160,61,0.10)', borderColor: 'rgba(224,160,61,0.35)' }}>
                    ⚠ These driver names have no matching record in Driver Availability, so the leg keeps the
                    name but gets no driver link: <b>{p.unresolvedDrivers.join(', ')}</b>. Fix the spelling on the
                    driver record and re-scan, or leave it — Phase 1 lets you pick the driver directly.
                  </div>
                )}

                {isOpen && (
                  <div style={{ overflowX: 'auto', marginTop: 8 }}>
                    <table className="am-grid" style={{ fontSize: 11.5, minWidth: 620 }}>
                      <thead><tr><th>Field</th><th>Now</th><th>After</th><th>Source</th></tr></thead>
                      <tbody>
                        {p.fields.map((fp) => (
                          <tr key={fp.field}>
                            <td style={{ fontWeight: 700 }}>{fp.field}{fp.required ? ' *' : ''}</td>
                            <td className="am-muted">{fp.from}</td>
                            <td>{fp.to}</td>
                            <td>
                              <span className="am-pill" style={{ color: HOW_COLOR[fp.how] }}>{HOW_LABEL[fp.how]}</span>
                              {fp.why && <div className="am-muted" style={{ fontSize: 10.5, textTransform: 'none' }}>{fp.why}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {plan && unresolved.length > 0 && (
        <div className="am-notice" style={{ color: 'var(--amber)', background: 'rgba(224,160,61,0.10)', borderColor: 'rgba(224,160,61,0.35)' }}>
          Pick a booking authority and terminal on {unresolved.length} load{unresolved.length === 1 ? '' : 's'} before migrating.
          Those two are required by the schema and the legacy records don't carry them.
        </div>
      )}

      {plan && !firebaseEnabled && (
        <div className="intg-mock-note">
          You're on the demo build, which has no shared database — the review runs but <b>Apply is disabled</b>.
          Run the migration on the live app.
        </div>
      )}

      {canApply && !confirm && (
        <div className="intg-live-row" style={{ marginTop: 8 }}>
          <button type="button" className="am-save" disabled={busy} onClick={() => setConfirm(true)}>
            Migrate {pending.length} load{pending.length === 1 ? '' : 's'} →
          </button>
        </div>
      )}
      {confirm && (
        <div className="am-notice" style={{ color: 'var(--text)', background: 'var(--panel-2)', borderColor: 'var(--border)' }}>
          Write the schema onto {pending.length} shared load record{pending.length === 1 ? '' : 's'}? Existing fields are kept,
          so this is additive — but it does write to live data the whole team sees.
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <button type="button" className="am-save" disabled={busy} onClick={apply}>{busy ? 'Migrating…' : 'Yes, migrate'}</button>
            <button type="button" className="am-clear" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <div className="intg-mock-note" style={{ borderColor: result.errors.length ? 'var(--amber)' : 'var(--green)' }}>
          <b>{result.migrated} load{result.migrated === 1 ? '' : 's'} migrated</b> — {result.stops} stop docs and{' '}
          {result.assignments} leg docs created{result.skipped ? `, ${result.skipped} skipped` : ''}.
          {verified && (
            <div style={{ marginTop: 4 }}>
              Read back from the database: {verified.migrated} of {verified.total} loads on v{SCHEMA_VERSION},{' '}
              {verified.stops} stops, {verified.assignments} assignments.
            </div>
          )}
          {result.errors.map((e, i) => <div key={i} style={{ marginTop: 4, color: 'var(--amber)' }}>⚠ {e}</div>)}
        </div>
      )}
    </div>
  );
}
