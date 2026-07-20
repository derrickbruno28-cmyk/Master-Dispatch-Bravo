import { useEffect, useMemo, useState } from 'react';
import {
  OTP_DRIVERS, OTP_FAIL_REASONS, OTD_FAIL_REASONS, OTP_TARGET, OTD_TARGET,
  loadShipments, saveShipments, computeStats, targetColor,
  type Shipment, type OtpFlag,
} from '../data/otp';

/* OTP / OTD Tracker — ported from the Operations Center. Manual logging today;
   built so a Samsara API fill can later create these same records automatically
   from tracking + trip history (stamping source:'samsara'). */

type Draft = Omit<Shipment, 'id'>;
const BLANK: Draft = {
  ls: '', loadId: '', trip: '', truck: '', primaryDriver: '', secondaryDriver: '',
  loadType: 'Live Load', puAppt: '', puActual: '', otp: '✓', otpFailReason: '',
  del1Appt: '', del1Actual: '', otd: '✓', otdFailReason: '', week: '', month: '',
  notes: '', source: 'manual',
};

function seed(): Shipment[] {
  const mk = (o: Partial<Shipment>, i: number): Shipment => ({ ...BLANK, id: `seed-${i}`, ...o });
  return [
    mk({ ls: '16186', trip: 'FA2D3-544', truck: '456', primaryDriver: 'Robert, Sr Spangler', otp: '✓', otd: '✓', week: '8', month: 'February 2026' }, 1),
    mk({ ls: '16191', trip: 'FA2D3-301', truck: '765', primaryDriver: 'Derek Brewer', otp: '✓', otd: '✗', otdFailReason: 'Consignee Dock Congestion', week: '8', month: 'February 2026' }, 2),
    mk({ ls: '16193', trip: 'FA26E-41', truck: '758', primaryDriver: 'Rafael Gama', otp: '✗', otpFailReason: 'Live Load – Dock Congestion', otd: 'Pending', week: '9', month: 'March 2026' }, 3),
    mk({ ls: '16207', trip: 'FA2D3-569', truck: '957', primaryDriver: 'Daniel Jay Williams', otp: '✓', otd: 'Pending', week: '9', month: 'March 2026' }, 4),
  ];
}

const flag = (v: OtpFlag) =>
  v === '✓' ? <span className="badge badge-green">✓ ON TIME</span>
  : v === '✗' ? <span className="badge badge-red">✗ LATE</span>
  : <span className="badge badge-amber">⏳ PENDING</span>;

export default function OTPView() {
  const [ships, setShips] = useState<Shipment[]>(() => { const l = loadShipments(); return l.length ? l : seed(); });
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Draft>(BLANK);
  const [fWeek, setFWeek] = useState('all');
  const [fDriver, setFDriver] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => { saveShipments(ships); }, [ships]);

  const weeks = useMemo(() => [...new Set(ships.map((s) => s.week).filter(Boolean))].sort(), [ships]);
  const filtered = useMemo(() => {
    let d = ships;
    if (fWeek !== 'all') d = d.filter((s) => s.week === fWeek);
    if (fDriver !== 'all') d = d.filter((s) => s.primaryDriver === fDriver || s.secondaryDriver === fDriver);
    if (fStatus === 'otp_fail') d = d.filter((s) => s.otp === '✗');
    else if (fStatus === 'otd_fail') d = d.filter((s) => s.otd === '✗');
    else if (fStatus === 'any_fail') d = d.filter((s) => s.otp === '✗' || s.otd === '✗');
    else if (fStatus === 'pending') d = d.filter((s) => s.otp === 'Pending' || s.otd === 'Pending');
    else if (fStatus === 'clean') d = d.filter((s) => s.otp === '✓' && s.otd === '✓');
    const n = q.trim().toLowerCase();
    if (n) d = d.filter((s) => `${s.trip} ${s.primaryDriver} ${s.loadId} ${s.ls} ${s.truck}`.toLowerCase().includes(n));
    return d;
  }, [ships, fWeek, fDriver, fStatus, q]);

  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const reasons = useMemo(() => {
    const m: Record<string, number> = {};
    ships.forEach((s) => { if (s.otpFailReason) m[s.otpFailReason] = (m[s.otpFailReason] ?? 0) + 1; if (s.otdFailReason) m[s.otdFailReason] = (m[s.otdFailReason] ?? 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [ships]);

  function set<K extends keyof Draft>(k: K, v: Draft[K]) { setForm((f) => ({ ...f, [k]: v })); }
  function add() {
    if (!form.trip && !form.ls) return;
    setShips((p) => [{ ...form, id: `s-${Date.now()}` }, ...p]);
    setForm(BLANK); setFormOpen(false);
  }

  const KPIS = [
    { label: 'OTP RATE', val: `${stats.otpPct.toFixed(1)}%`, color: targetColor(stats.otpPct, OTP_TARGET) },
    { label: 'OTD RATE', val: `${stats.otdPct.toFixed(1)}%`, color: targetColor(stats.otdPct, OTD_TARGET) },
    { label: 'LOADS', val: String(stats.total), color: 'var(--text)' },
    { label: 'OTP FAILS', val: String(stats.otpFail), color: stats.otpFail ? 'var(--red)' : 'var(--green)' },
    { label: 'PENDING', val: String(stats.otpPend + stats.otdPend), color: 'var(--amber)' },
  ];

  return (
    <div className="am-page">
      <div className="am-head">
        <div>
          <h2>OTP / OTD Tracker</h2>
          <span className="am-muted">Targets: OTP ≥ {OTP_TARGET}% · OTD ≥ {OTD_TARGET}% · {ships.length} loads tracked</span>
        </div>
        <span className="otp-samsara" title="Planned: auto-fill these records from Samsara tracking + trip history">🔗 Samsara auto-fill — planned</span>
        <button className="am-save otp-log-btn" onClick={() => setFormOpen((o) => !o)}>{formOpen ? '× Close' : '+ Log Shipment'}</button>
      </div>

      <div className="otp-kpis">
        {KPIS.map((k) => (
          <div key={k.label} className="otp-kpi">
            <div className="otp-kpi-label">{k.label}</div>
            <div className="otp-kpi-val" style={{ color: k.color }}>{k.val}</div>
          </div>
        ))}
      </div>

      {formOpen && (
        <div className="otp-form">
          <div className="otp-form-grid">
            <L t="LS #"><input className="am-input" value={form.ls} onChange={(e) => set('ls', e.target.value)} /></L>
            <L t="Load ID"><input className="am-input" value={form.loadId} onChange={(e) => set('loadId', e.target.value)} /></L>
            <L t="Trip #"><input className="am-input" placeholder="FA2D3-575" value={form.trip} onChange={(e) => set('trip', e.target.value)} /></L>
            <L t="Truck #"><input className="am-input" value={form.truck} onChange={(e) => set('truck', e.target.value)} /></L>
            <L t="Primary driver"><select className="am-input" value={form.primaryDriver} onChange={(e) => set('primaryDriver', e.target.value)}><option value="">Select…</option>{OTP_DRIVERS.map((d) => <option key={d}>{d}</option>)}</select></L>
            <L t="Secondary driver"><select className="am-input" value={form.secondaryDriver} onChange={(e) => set('secondaryDriver', e.target.value)}><option value="">None</option>{OTP_DRIVERS.map((d) => <option key={d}>{d}</option>)}</select></L>
            <L t="Load type"><select className="am-input" value={form.loadType} onChange={(e) => set('loadType', e.target.value)}><option>Live Load</option><option>Pre-Load</option></select></L>
            <L t="PU appt"><input className="am-input" type="datetime-local" value={form.puAppt} onChange={(e) => set('puAppt', e.target.value)} /></L>
            <L t="PU actual"><input className="am-input" type="datetime-local" value={form.puActual} onChange={(e) => set('puActual', e.target.value)} /></L>
            <L t="OTP status"><select className="am-input" value={form.otp} onChange={(e) => set('otp', e.target.value as OtpFlag)}><option value="✓">✓ On Time</option><option value="✗">✗ Late</option><option value="Pending">⏳ Pending</option></select></L>
            {form.otp === '✗' && <L t="OTP fail reason"><select className="am-input" value={form.otpFailReason} onChange={(e) => set('otpFailReason', e.target.value)}><option value="">Select…</option>{OTP_FAIL_REASONS.map((r) => <option key={r}>{r}</option>)}</select></L>}
            <L t="Del appt"><input className="am-input" type="datetime-local" value={form.del1Appt} onChange={(e) => set('del1Appt', e.target.value)} /></L>
            <L t="Del actual"><input className="am-input" type="datetime-local" value={form.del1Actual} onChange={(e) => set('del1Actual', e.target.value)} /></L>
            <L t="OTD status"><select className="am-input" value={form.otd} onChange={(e) => set('otd', e.target.value as OtpFlag)}><option value="✓">✓ On Time</option><option value="✗">✗ Late</option><option value="Pending">⏳ Pending</option></select></L>
            {form.otd === '✗' && <L t="OTD fail reason"><select className="am-input" value={form.otdFailReason} onChange={(e) => set('otdFailReason', e.target.value)}><option value="">Select…</option>{OTD_FAIL_REASONS.map((r) => <option key={r}>{r}</option>)}</select></L>}
            <L t="Week #"><input className="am-input" value={form.week} onChange={(e) => set('week', e.target.value)} /></L>
            <L t="Month"><input className="am-input" placeholder="March 2026" value={form.month} onChange={(e) => set('month', e.target.value)} /></L>
          </div>
          <div className="otp-form-btns">
            <button className="am-save" disabled={!form.trip && !form.ls} onClick={add}>✅ Save Shipment</button>
            <button className="am-cancel" onClick={() => setFormOpen(false)}>Cancel</button>
            {!form.trip && !form.ls && <span className="am-muted" style={{ fontSize: 11, color: 'var(--red)' }}>Enter at least a Trip # or LS #.</span>}
          </div>
        </div>
      )}

      <div className="am-head" style={{ marginTop: 4 }}>
        <select className="am-input" style={{ maxWidth: 130 }} value={fWeek} onChange={(e) => setFWeek(e.target.value)}><option value="all">All weeks</option>{weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}</select>
        <select className="am-input" style={{ maxWidth: 170 }} value={fDriver} onChange={(e) => setFDriver(e.target.value)}><option value="all">All drivers</option>{OTP_DRIVERS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
        <select className="am-input" style={{ maxWidth: 150 }} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="all">All statuses</option><option value="any_fail">Any fail</option><option value="otp_fail">OTP fail</option><option value="otd_fail">OTD fail</option><option value="pending">Pending</option><option value="clean">Clean</option>
        </select>
        <input className="am-input" style={{ maxWidth: 200 }} placeholder="Search trip / driver / LS…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="am-muted">{filtered.length} shown</span>
      </div>

      {reasons.length > 0 && (
        <div className="otp-reasons">
          <span className="am-muted">Top fail reasons:</span>
          {reasons.map(([r, n]) => <span key={r} className="otp-reason">{r} <b>{n}</b></span>)}
        </div>
      )}

      <div className="am-scroll">
        <table className="am-grid otp-table">
          <thead><tr><th>LS</th><th>Trip</th><th>Truck</th><th>Driver</th><th>Load type</th><th>OTP</th><th>OTD</th><th>Week</th><th>Src</th></tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="am-muted" style={{ textAlign: 'center', padding: 18 }}>No shipments match. Log one with “+ Log Shipment”.</td></tr>
            ) : filtered.map((s) => (
              <tr key={s.id} className={s.otp === '✗' || s.otd === '✗' ? 'otp-fail-row' : ''}>
                <td>{s.ls || '—'}</td>
                <td className="opt-route">{s.trip || '—'}</td>
                <td>{s.truck ? `#${s.truck}` : '—'}</td>
                <td>{s.primaryDriver || '—'}{s.secondaryDriver && <span className="am-muted"> · {s.secondaryDriver}</span>}</td>
                <td className="am-muted">{s.loadType}</td>
                <td>{flag(s.otp)}{s.otpFailReason && <div className="otp-fr">{s.otpFailReason}</div>}</td>
                <td>{flag(s.otd)}{s.otdFailReason && <div className="otp-fr">{s.otdFailReason}</div>}</td>
                <td>{s.week || '—'}</td>
                <td>{s.source === 'samsara' ? <span className="badge badge-blue">Samsara</span> : <span className="am-muted">manual</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="otp-field"><span className="otp-field-label">{t}</span>{children}</label>;
}
