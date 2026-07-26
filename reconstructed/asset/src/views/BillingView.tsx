/* Billing work queue — PHASE 9B.

   A queue, not a report. Every row says what is stopping it in the words you'd
   use on the phone, and clicking one opens the load so you can do something
   about it. The CSV is the handoff artifact until invoicing lives in here. */

import { useEffect, useMemo, useState } from 'react';
import { onChange } from '../data/bus';
import { loadAll, loadById, fmtMoney, fmtMiles, type Load } from '../data/loadsStore';
import { fetchDocs } from '../data/tms/documentsStore';
import { allFinRows, queueGroups, blockedReason, billingCsv } from '../data/tms/billing';
import { rollup, type FinRow } from '../data/tms/financials';
import { BILLING_STATUS_LABEL, BOOKING_AUTHORITIES, BOOKING_TERMINALS, type BillingStatus } from '../data/tms/types';
import LoadDetailModal from './LoadDetailModal';

const STATUS_TONE: Record<BillingStatus, string> = {
  NOT_READY: 'var(--muted)', MISSING_DOCS: 'var(--red)', READY_FOR_ACCOUNTING: 'var(--green)',
  INVOICED: 'var(--accent)', PAID: '#a78bfa', ON_HOLD: 'var(--amber)', CANCELLED_TONU: 'var(--muted)',
};

export default function BillingView() {
  const [, force] = useState(0);
  const [status, setStatus] = useState<BillingStatus | 'ALL'>('ALL');
  const [authority, setAuthority] = useState('ALL');
  const [terminal, setTerminal] = useState('ALL');
  const [customer, setCustomer] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<Load | null>(null);

  useEffect(() => onChange(() => force((n) => n + 1)), []);
  useEffect(() => { void (async () => { for (const l of loadAll()) await fetchDocs(l.id); force((n) => n + 1); })(); }, []);

  const all = useMemo(() => allFinRows(), []);
  const customers = useMemo(() => [...new Set(all.map((r) => r.customer))].sort(), [all]);

  const rows = useMemo(() => all.filter((r) => {
    if (status !== 'ALL' && r.billingStatus !== status) return false;
    if (authority !== 'ALL' && r.authority !== authority) return false;
    if (terminal !== 'ALL' && r.terminal !== terminal) return false;
    if (customer !== 'ALL' && r.customer !== customer) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  }), [all, status, authority, terminal, customer, from, to]);

  const groups = useMemo(() => queueGroups(rows), [rows]);
  const byAuthority = useMemo(() => rollup(rows, (r) => r.authority), [rows]);
  const byTerminal = useMemo(() => rollup(rows, (r) => r.terminal), [rows]);

  const owed = rows.filter((r) => ['READY_FOR_ACCOUNTING', 'INVOICED'].includes(r.billingStatus))
    .reduce((n, r) => n + r.revenue, 0);
  const stuck = rows.filter((r) => r.billingStatus === 'MISSING_DOCS');

  function exportCsv() {
    const blob = new Blob([billingCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `billing-queue-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const row = (r: FinRow) => (
    <tr key={r.loadId} className="bill-row" onClick={() => setOpen(loadById(r.loadId) ?? null)}>
      <td><b>{r.loadNumber}</b><div className="am-muted bill-sub">{r.trip || r.routeName}</div></td>
      <td>{r.customer}<div className="am-muted bill-sub">{r.authority} · {r.terminal}</div></td>
      <td className="am-muted">{r.date}</td>
      <td>{r.truck ? `#${r.truck}` : '—'}<div className="am-muted bill-sub">{r.drivers.join(' / ')}</div></td>
      <td>{fmtMoney(r.revenue)}{r.fscAmount > 0 && <div className="am-muted bill-sub">incl. {fmtMoney(r.fscAmount)} FSC</div>}</td>
      <td className="am-muted">{fmtMiles(r.loadedMiles)}</td>
      <td>{r.cpm == null ? '—' : `$${r.cpm.toFixed(2)}/mi`}</td>
      <td><span className="bill-status" style={{ color: STATUS_TONE[r.billingStatus] }}>{BILLING_STATUS_LABEL[r.billingStatus]}</span></td>
      <td className={blockedReason(r).startsWith('waiting on B') || blockedReason(r).startsWith('waiting on P') ? 'bill-blocked' : 'am-muted'}>
        {blockedReason(r) || '—'}
      </td>
    </tr>
  );

  return (
    <div className="am-page">
      <div className="am-head">
        <div>
          <h2>Billing</h2>
          <span className="am-muted">
            The work queue between delivered and invoiced. Every row says what is holding it up;
            click one to open the load.
          </span>
        </div>
        <button className="am-clear" onClick={exportCsv}>⭳ Export CSV</button>
      </div>

      <div className="fin-kpis">
        <div className="fin-kpi"><div className="fin-kpi-label">READY + INVOICED</div>
          <div className="fin-kpi-val" style={{ color: 'var(--green)' }}>{fmtMoney(owed)}</div>
          <div className="am-muted bill-sub">revenue past the gate</div></div>
        <div className="fin-kpi"><div className="fin-kpi-label">STUCK ON DOCS</div>
          <div className="fin-kpi-val" style={{ color: stuck.length ? 'var(--red)' : 'var(--green)' }}>{stuck.length}</div>
          <div className="am-muted bill-sub">{fmtMoney(stuck.reduce((n, r) => n + r.revenue, 0))} waiting on paperwork</div></div>
        <div className="fin-kpi"><div className="fin-kpi-label">LOADS</div>
          <div className="fin-kpi-val">{rows.length}</div>
          <div className="am-muted bill-sub">in this filter</div></div>
      </div>

      <div className="am-billchips">
        <button className={`am-billchip ${status === 'ALL' ? 'on ready_for_accounting' : ''}`} onClick={() => setStatus('ALL')}>
          All<span className="am-billcount">{rows.length}</span>
        </button>
        {groups.map((g) => (
          <button key={g.status} className={`am-billchip ${status === g.status ? 'on ready_for_accounting' : ''} ${g.rows.length === 0 ? 'zero' : ''}`}
            title={`${fmtMoney(g.revenue)} of revenue`} onClick={() => setStatus(g.status)}>
            {g.label}<span className="am-billcount">{g.rows.length}</span>
          </button>
        ))}
      </div>

      <div className="am-head" style={{ marginTop: 4 }}>
        <select className="am-input am-filter" value={authority} onChange={(e) => setAuthority(e.target.value)}>
          <option value="ALL">All authorities</option>
          {BOOKING_AUTHORITIES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="am-input am-filter" value={terminal} onChange={(e) => setTerminal(e.target.value)}>
          <option value="ALL">All terminals</option>
          {BOOKING_TERMINALS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="am-input am-filter" value={customer} onChange={(e) => setCustomer(e.target.value)}>
          <option value="ALL">All customers</option>
          {customers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="am-input am-filter" type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From date" />
        <input className="am-input am-filter" type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To date" />
      </div>

      <div className="bill-breakdowns">
        <Breakdown title="By booking authority" groups={byAuthority} />
        <Breakdown title="By terminal" groups={byTerminal} />
      </div>

      <div className="am-scroll">
        <table className="am-grid bill-table">
          <thead>
            <tr>
              <th>Load</th><th>Customer</th><th>Date</th><th>Truck / drivers</th>
              <th>Revenue</th><th>Loaded</th><th>CPM</th><th>Billing</th><th>Blocked on</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={9} className="am-muted" style={{ textAlign: 'center', padding: 18 }}>Nothing matches this filter.</td></tr>
              : rows.map(row)}
          </tbody>
        </table>
      </div>

      {open && (
        <LoadDetailModal
          tractor={open.assignedTruck} date={open.date} canDel={false}
          seedLoad={open} initialTab="docs"
          onSave={() => setOpen(null)} onClear={() => setOpen(null)}
          onCreated={() => setOpen(null)} onClose={() => { setOpen(null); force((n) => n + 1); }}
        />
      )}
    </div>
  );
}

function Breakdown({ title, groups }: { title: string; groups: ReturnType<typeof rollup> }) {
  if (groups.length === 0) return null;
  return (
    <div className="bill-breakdown">
      <div className="rc-section">{title}</div>
      <table className="am-grid bill-mini">
        <tbody>
          {groups.map((g) => (
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
  );
}
