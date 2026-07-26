/* Rate con review screen — PHASE 8.

   This is the screen hard rule 5 is about. The parser has read the document and
   proposed values; NOTHING has been written. Every row says what was found,
   where it would go, and how sure the parser is, and every row can be switched
   off. Variances against the Load Repository are listed separately and start
   switched OFF, because a rate con that disagrees with the contract is a
   conversation to have, not a value to accept.

   The source PDF is attached to the load as a RATE_CON document on confirm —
   whatever you accept or reject, the paper that was sent stays with the load. */

import { useMemo, useState } from 'react';
import type { Load } from '../data/loadsStore';
import { uploadDoc } from '../data/tms/documentsStore';
import {
  buildPatch, type RateConProposal, type ProposedField,
} from '../data/tms/rateconParse';

const CONF_LABEL: Record<string, string> = { high: 'high', medium: 'medium', low: 'low — check it' };

export default function RateConReview({ proposal, load, file, onApply, onCancel }: {
  proposal: RateConProposal;
  load: Load;
  file: File | null;
  onApply: (patch: ReturnType<typeof buildPatch>) => void;
  onCancel: () => void;
}) {
  /* accept-by-default for parsed fields, reject-by-default for variances —
     the toggle's starting position is an opinion, so it should be the safe one */
  const [accepted, setAccepted] = useState<Set<string>>(
    () => new Set(proposal.fields.filter((f) => f.accept).map((f) => f.key)
      .concat(proposal.stops.map((s) => `stop.${s.type}`))),
  );
  const [busy, setBusy] = useState(false);

  const toggle = (k: string) => setAccepted((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const patch = useMemo(() => buildPatch(proposal, accepted), [proposal, accepted]);
  const nothingToTake = accepted.size === 0;

  async function confirm() {
    setBusy(true);
    /* the document itself goes on the load either way — the paper that was sent
       is part of the record even when none of its numbers were accepted */
    if (file) {
      try { await uploadDoc({ load, file, docType: 'RATE_CON', invoiceRequirement: 'DELIVERABLE' }); }
      catch (e) { console.error('rate con attach failed', e); }
    }
    setBusy(false);
    onApply(patch);
  }

  const row = (f: ProposedField, isVariance = false) => (
    <tr key={f.key} className={isVariance ? 'rc-variance' : ''}>
      <td>
        <label className="rc-take">
          <input type="checkbox" checked={accepted.has(f.key)} onChange={() => toggle(f.key)} />
          {accepted.has(f.key) ? 'Take' : 'Skip'}
        </label>
      </td>
      <td className="rc-label">{f.label}</td>
      <td className="rc-value">{f.display}</td>
      <td className="am-muted rc-target">→ {f.target}</td>
      <td><span className={`rc-conf ${f.confidence}`}>{CONF_LABEL[f.confidence]}</span></td>
      <td className="am-muted rc-note">{f.note || ''}</td>
    </tr>
  );

  return (
    <div className="rc-wrap">
      <div className="rc-head">
        <b>📄 Rate con read — nothing has been saved.</b>
        <span className="am-muted">
          {proposal.kind === 'usps' ? 'USPS contract document' : proposal.kind === 'broker' ? 'Broker rate confirmation' : 'Document type not recognized'}
          {proposal.tripIds.length > 0 && ` · trip ${proposal.tripIds[0].raw}`}
          {' · '}{proposal.fields.length} field{proposal.fields.length === 1 ? '' : 's'} found
        </span>
      </div>

      {proposal.textLooksEmpty && (
        <div className="docs-gate">
          <b>⛔ Nothing readable in this file.</b> It is almost certainly a scan or a photo. There is
          no OCR wired up, so the parser will not guess at an image — attach it as a document and fill
          the load in by hand.
        </div>
      )}

      {proposal.warnings.length > 0 && (
        <div className="trip-warn">
          <b>Read these first</b>
          <ul>{proposal.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {proposal.variances.length > 0 && (
        <>
          <div className="rc-section">⚠ The rate con disagrees with the Load Repository</div>
          <div className="am-muted rc-sectionsub">
            The contract is the repository's number. These rows start switched OFF on purpose — take
            one only if you have decided the rate con is right.
          </div>
          <table className="am-grid rc-table">
            <tbody>{proposal.variances.map((v) => row(v, true))}</tbody>
          </table>
        </>
      )}

      {proposal.unrecognized.length > 0 && (
        <div className="am-notice">
          Unrecognized trip format: {proposal.unrecognized.join(', ')} — not read as a trip identifier,
          not guessed at. Type it in by hand if one of these is the trip.
        </div>
      )}

      <div className="rc-section">Fields found</div>
      {proposal.fields.length === 0
        ? <div className="am-muted">Nothing recognized in this document.</div>
        : (
          <div className="rc-scroll">
            <table className="am-grid rc-table">
              <thead><tr><th>Take?</th><th>Field</th><th>Value</th><th>Goes to</th><th>Confidence</th><th>Note</th></tr></thead>
              <tbody>{proposal.fields.map((f) => row(f))}</tbody>
            </table>
          </div>
        )}

      {proposal.stops.length > 0 && (
        <>
          <div className="rc-section">Stops</div>
          <div className="rc-scroll">
            <table className="am-grid rc-table">
              <thead><tr><th>Take?</th><th>Stop</th><th>Address</th><th>Appointment</th><th>Action</th></tr></thead>
              <tbody>
                {proposal.stops.map((s) => (
                  <tr key={s.type}>
                    <td>
                      <label className="rc-take">
                        <input type="checkbox" checked={accepted.has(`stop.${s.type}`)} onChange={() => toggle(`stop.${s.type}`)} />
                        {accepted.has(`stop.${s.type}`) ? 'Take' : 'Skip'}
                      </label>
                    </td>
                    <td><span className={`trip-stop-type ${s.type === 'delivery' ? 'del' : 'pu'}`}>{s.type}</span></td>
                    <td className="rc-value">{s.city}, {s.state} {s.zip}<div className="am-muted rc-note">{s.address}</div></td>
                    <td>{s.apptDate || <span className="am-muted">no date found</span>}{s.apptWindowStart && ` ${s.apptWindowStart}`}{s.apptWindowEnd && `–${s.apptWindowEnd}`}</td>
                    <td className="am-muted">{s.stopAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="rc-actions">
        <button className="am-save" disabled={busy || nothingToTake} onClick={() => void confirm()}>
          ✓ Apply {accepted.size} field{accepted.size === 1 ? '' : 's'}{file ? ' + attach the PDF' : ''}
        </button>
        <button className="am-clear" disabled={busy} onClick={onCancel}>Cancel — write nothing</button>
        <span className="am-muted">
          {nothingToTake
            ? 'Everything is switched off — there is nothing to apply.'
            : `Applying: ${patch.applied.slice(0, 6).join(', ')}${patch.applied.length > 6 ? '…' : ''}`}
        </span>
      </div>
    </div>
  );
}
