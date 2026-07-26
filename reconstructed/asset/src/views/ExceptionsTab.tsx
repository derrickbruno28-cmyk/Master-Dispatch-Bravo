/* Exceptions + replacement loads — PHASE 5.

   The shape of this screen follows the rule that nothing parsed or inferred gets
   written silently. Logging the exception and SPAWNING the replacement are two
   separate acts: you log what went wrong, then — if the freight still has to
   move — you press "Preview replacement load", read exactly what will be copied
   and what will be closed, and only then write it. */

import { useEffect, useState } from 'react';
import { loadById, type Load } from '../data/loadsStore';
import { canDelete } from '../data/permStore';
import { onChange } from '../data/bus';
import {
  storedExceptions, fetchExceptions, blankException, saveException, removeException,
  planSpawn, applySpawn, parentOf, EXCEPTION_TYPE_HINT, type SpawnPlan,
} from '../data/tms/exceptionsStore';
import { stopsFor, stopLabel } from '../data/tms/stopsStore';
import { legsFor } from '../data/tms/assignmentsStore';
import { driverOptions } from '../data/tms/assignmentsStore';
import {
  EXCEPTION_TYPES, type ExceptionType, type LoadException,
} from '../data/tms/types';

const fmtWhen = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function ExceptionsTab({ load: prop, onOpenLoad }: { load: Load; onOpenLoad?: (l: Load) => void }) {
  const [, force] = useState(0);
  const [draft, setDraft] = useState<LoadException | null>(null);
  const [plan, setPlan] = useState<SpawnPlan | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState('');

  useEffect(() => onChange(() => force((n) => n + 1)), []);
  useEffect(() => { void fetchExceptions(prop.id).then(() => force((n) => n + 1)); }, [prop.id]);

  /* same reason as the Documents tab — spawning writes to the store, and the
     parent's copy of the load doesn't hear about it */
  const load = loadById(prop.id) ?? prop;
  const list = storedExceptions(load.id);
  const stops = stopsFor(load);
  const legs = legsFor(load);
  const mayDelete = canDelete();
  const parent = parentOf(load);

  function startDraft() {
    setPlan(null); setMsg('');
    setDraft(blankException({
      assignmentId: legs.length === 1 ? legs[0].id : '',
      fromStopSeq: stops.find((s) => !s.actualOut)?.seq ?? null,
    }));
  }

  async function logIt(spawnAfter: boolean) {
    if (!draft) return;
    if (!draft.reason.trim()) { setMsg('A reason is required — this is what the customer gets told.'); return; }
    setBusy(true);
    const saved = await saveException(load, draft);
    setBusy(false);
    setDraft(null);
    setMsg(`✓ ${saved.exceptionType} logged.`);
    if (spawnAfter) setPlan(planSpawn(loadById(load.id) ?? load, saved));
    force((n) => n + 1);
  }

  async function commitSpawn() {
    if (!plan) return;
    setBusy(true);
    const res = await applySpawn(plan);
    setBusy(false);
    if (!res.ok) { setMsg(`Nothing was written — ${res.reason}.`); return; }
    setPlan(null);
    setMsg(`✓ Replacement load created. It is sitting in the Unassigned tray on the board — assign a truck to place it.`);
    force((n) => n + 1);
  }

  return (
    <div className="exc-wrap">
      {/* linked-load banners, both directions */}
      {parent && (
        <div className="exc-link">
          ↩ <b>This is a replacement load.</b> Spawned from{' '}
          <button className="exc-linkbtn" onClick={() => onOpenLoad?.(parent)}>{parent.routeName || parent.id}</button>
          {' '}· {parent.date}. The stops and appointments came from that load; the actuals did not.
        </div>
      )}

      <div className="exc-head">
        <div>
          <b>Exceptions</b>
          <div className="am-muted">
            Log what stopped the plan. If the freight still has to move, spawn the replacement load
            from here so the customer, references, appointments and terms carry forward instead of
            being retyped.
          </div>
        </div>
        {!draft && <button className="am-save" onClick={startDraft}>⚠ Log an exception</button>}
      </div>

      {msg && <div className="am-notice" style={{ color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{msg}</div>}

      {draft && (
        <div className="exc-form">
          <div className="exc-grid">
            <label className="load-field">
              <span className="load-field-label">What happened</span>
              <select className="am-input" value={draft.exceptionType}
                onChange={(e) => setDraft({ ...draft, exceptionType: e.target.value as ExceptionType })}>
                {EXCEPTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="am-muted exc-hint">{EXCEPTION_TYPE_HINT[draft.exceptionType]}</span>
            </label>

            <label className="load-field">
              <span className="load-field-label">Which leg could not finish</span>
              <select className="am-input" value={draft.assignmentId}
                onChange={(e) => setDraft({ ...draft, assignmentId: e.target.value })}>
                <option value="">— pick a leg —</option>
                {legs.map((g) => (
                  <option key={g.id} value={g.id}>
                    Leg {g.legIndex} · {g.truckNumber || 'no truck'}{g.cancelled ? ' (already cancelled)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="load-field">
              <span className="load-field-label">Driver</span>
              <select className="am-input" value={draft.driverId}
                onChange={(e) => setDraft({ ...draft, driverId: e.target.value })}>
                <option value="">— none —</option>
                {driverOptions().map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
            </label>

            <label className="load-field">
              <span className="load-field-label">Replacement starts at</span>
              <select className="am-input" value={draft.fromStopSeq ?? ''}
                onChange={(e) => setDraft({ ...draft, fromStopSeq: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">— pick a stop —</option>
                {stops.map((s) => <option key={s.id} value={s.seq}>#{s.seq} · {stopLabel(s)}</option>)}
              </select>
              <span className="am-muted exc-hint">Everything from this stop forward copies to the replacement load.</span>
            </label>
          </div>

          <label className="load-field">
            <span className="load-field-label">Reason — required</span>
            <textarea className="am-input" rows={2} value={draft.reason} autoFocus
              placeholder="Out of hours in Junction, 4 hours short of Memphis."
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
          </label>

          <div className="exc-actions">
            <button className="am-save" disabled={busy} onClick={() => void logIt(false)}>Log it</button>
            <button className="am-save" disabled={busy} onClick={() => void logIt(true)}>Log it + preview replacement load</button>
            <button className="am-clear" onClick={() => { setDraft(null); setMsg(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* THE REVIEW SCREEN — nothing above this line has written a child load */}
      {plan && (
        <div className="exc-plan">
          <div className="exc-plan-head">
            🧾 <b>Replacement load — preview.</b> Nothing has been created yet. This is exactly what
            the button below will write.
          </div>

          {plan.warnings.length > 0 && (
            <div className="trip-warn">
              <b>Check these first</b>
              <ul>{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}

          <div className="exc-plan-grid">
            <div>
              <div className="exc-plan-lab">Carries forward</div>
              <ul className="exc-carry">{plan.carried.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
            <div>
              <div className="exc-plan-lab">Does NOT carry</div>
              <ul className="exc-carry drop">
                <li>arrival and departure actuals — the replacement truck has not been anywhere</li>
                <li>milestones and detention already logged on this load</li>
                <li>truck, drivers and trailer — the replacement starts Unassigned</li>
                <li>documents already attached to this load</li>
              </ul>
            </div>
          </div>

          <div className="exc-plan-lab">Stops copied ({plan.childStops.length})</div>
          <div className="trip-stops">
            {plan.childStops.map((s) => (
              <div key={s.id} className="trip-stop-row">
                <span className={`trip-stop-type ${s.type === 'Delivery' ? 'del' : 'pu'}`}>{s.type}</span>
                <span>#{s.seq} {stopLabel(s)}</span>
                <span className="am-muted">
                  {s.apptDate ? `${s.apptDate} ${s.apptWindowStart || ''}${s.apptWindowEnd ? `–${s.apptWindowEnd}` : ''}` : 'no appointment'}
                  {s.apptConfirmed ? ' · confirmed' : ''}
                </span>
              </div>
            ))}
          </div>

          <div className="exc-plan-lab">Closes out</div>
          <div className="am-muted exc-closes">
            {plan.cancelLeg
              ? plan.cancelLeg.cancelled
                ? `Leg ${plan.cancelLeg.legIndex} is already cancelled — it stays as it is.`
                : `Leg ${plan.cancelLeg.legIndex}${plan.cancelLeg.truckNumber ? ` (truck #${plan.cancelLeg.truckNumber})` : ''} will be marked cancelled with the reason above. The load keeps its status; one leg of it did not happen.`
              : 'No leg will be closed — no leg was selected.'}
          </div>

          <div className="exc-actions">
            <button className="am-save" disabled={busy || !plan.ok} onClick={() => void commitSpawn()}>
              ✓ Create this replacement load
            </button>
            <button className="am-clear" onClick={() => setPlan(null)}>Cancel — write nothing</button>
          </div>
        </div>
      )}

      {list.length === 0 && !draft
        ? <div className="am-muted">No exceptions on this load.</div>
        : (
          <div className="exc-list">
            {list.map((x) => {
              const child = x.childLoadId ? loadById(x.childLoadId) : undefined;
              return (
                <div key={x.id} className={`exc-card ${x.resolved ? 'done' : ''}`}>
                  <div className="exc-card-head">
                    <span className={`exc-type ${x.resolved ? 'done' : ''}`}>{x.resolved ? '✓ ' : '⚠ '}{x.exceptionType}</span>
                    <span className="am-muted">{x.createdBy} · {fmtWhen(x.createdAt)}</span>
                    <span className="exc-card-actions">
                      <button className="am-clear" onClick={() => void saveException(load, { ...x, resolved: !x.resolved })}>
                        {x.resolved ? 'Reopen' : 'Mark resolved'}
                      </button>
                      {!x.childLoadId && (
                        <button className="am-clear" onClick={() => { setMsg(''); setPlan(planSpawn(load, x)); }}>
                          Preview replacement load
                        </button>
                      )}
                      {confirmDel === x.id
                        ? <><span className="am-muted">Delete?</span>
                            <button className="fleet-del" onClick={() => { void removeException(load, x.id); setConfirmDel(''); }}>✓</button>
                            <button className="am-clear" onClick={() => setConfirmDel('')}>✕</button></>
                        : mayDelete
                          ? <button className="fleet-del" onClick={() => setConfirmDel(x.id)}>🗑</button>
                          : <button className="am-clear" disabled title="Deleting is restricted to FMT Lead / US Ops / Owner">🔒</button>}
                    </span>
                  </div>
                  <div className="exc-reason">{x.reason}</div>
                  <div className="am-muted exc-meta">
                    {x.driverId && <>driver {x.driverId} · </>}
                    {x.fromStopSeq != null && <>from stop #{x.fromStopSeq} · </>}
                    {x.assignmentId && <>leg {legs.find((g) => g.id === x.assignmentId)?.legIndex ?? '?'}</>}
                  </div>
                  {x.childLoadId && (
                    <div className="exc-link inline">
                      → <b>Replacement load created.</b>{' '}
                      {child
                        ? <button className="exc-linkbtn" onClick={() => onOpenLoad?.(child)}>{child.routeName || child.id}</button>
                        : <span className="am-muted">{x.childLoadId}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
