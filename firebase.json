import { useRef, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { useStore } from '../data/store';
import { can } from '../permissions';

/* GHL Rate Check (v2.26.0) — the standalone ghl-ratecheck tool as a Bravo tab.
   Dispatcher enters lane + all-in buy rate and gets ONLY a green/red verdict:
   the contract rates never reach the browser (the `rateCheck` callable does
   the lookup + math server-side; Branch B falls back to Google driving miles
   vs a $/mi cap when the lane isn't in the rate DB). Access = every role
   above base ('ratecheck'); master-file upload = 'ratecheck.upload'. */

type Verdict = 'green' | 'red' | 'error';

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

export default function RateCheckView() {
  const { currentUser, demoMode } = useStore();
  const [oCity, setOCity] = useState('');
  const [oState, setOState] = useState('');
  const [dCity, setDCity] = useState('');
  const [dState, setDState] = useState('');
  const [rate, setRate] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  /* Unknown lane (mileage-only estimate): hold the verdict behind the warning
     until the dispatcher explicitly proceeds — they can't skip past it. */
  const [pendingVerdict, setPendingVerdict] = useState<Verdict | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState('');
  const [uploadDetail, setUploadDetail] = useState('');

  const canUpload = can(currentUser, 'ratecheck.upload');

  async function runCheck() {
    setError('');
    setVerdict(null);
    setPendingVerdict(null);
    if (!oCity.trim() || !oState.trim() || !dCity.trim() || !dState.trim()) {
      setError('Fill in both cities and states.');
      return;
    }
    const r = parseFloat(rate.replace(/[^0-9.]/g, ''));
    if (!(r > 0)) {
      setError('Enter a positive all-in rate.');
      return;
    }
    if (demoMode || !app) {
      setError('Rate Check needs the live system — it is not available in demo mode.');
      return;
    }
    setChecking(true);
    try {
      const fn = httpsCallable(getFunctions(app), 'rateCheck');
      const res = await fn({ originCity: oCity, originState: oState, destCity: dCity, destState: dState, rate: r });
      const data = res.data as { verdict: Verdict; matched: boolean };
      if (data.verdict !== 'error' && data.matched === false) {
        setPendingVerdict(data.verdict);
      } else {
        setVerdict(data.verdict);
      }
    } catch (e) {
      setError((e as Error).message || 'Something went wrong.');
    } finally {
      setChecking(false);
    }
  }

  async function upload() {
    if (!file || demoMode || !app) return;
    setUploadState('Rebuilding…');
    setUploadDetail('');
    try {
      const buf = await file.arrayBuffer();
      const fn = httpsCallable(getFunctions(app), 'rateCheckUpdateMaster', { timeout: 300000 });
      const res = await fn({ fileBase64: toBase64(buf), filename: file.name });
      const r = res.data as { built: number; dropped: number };
      setUploadState(`✓ Rebuilt — ${r.built} live lanes (${r.dropped} dropped as expired / not yet live / no rate).`);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      const details = (e as { details?: { missing?: { nass: string; facility: string }[] } }).details;
      if (details?.missing?.length) {
        setUploadState('Unknown NASS codes — add them to functions/src/ratecheck.ts ALIASES and redeploy, then re-upload:');
        setUploadDetail(details.missing.map((m) => `${m.nass || '(blank)'} — ${m.facility || ''}`).join('\n'));
      } else {
        setUploadState(`Failed: ${(e as Error).message}`);
      }
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void runCheck();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>Rate Check</h2>
        <span className="muted">Enter the lane and your all-in buy rate — you get a simple go / no-go. Rates stay server-side.</span>
      </div>

      <section className="rc-card">
        <div className="rc-row">
          <label>Origin city
            <input value={oCity} onChange={(e) => setOCity(e.target.value)} onKeyDown={onKey} placeholder="Memphis" autoComplete="off" />
          </label>
          <label className="rc-state">State
            <input value={oState} onChange={(e) => setOState(e.target.value)} onKeyDown={onKey} placeholder="TN" maxLength={20} />
          </label>
        </div>
        <div className="rc-row">
          <label>Destination city
            <input value={dCity} onChange={(e) => setDCity(e.target.value)} onKeyDown={onKey} placeholder="Mobile" autoComplete="off" />
          </label>
          <label className="rc-state">State
            <input value={dState} onChange={(e) => setDState(e.target.value)} onKeyDown={onKey} placeholder="AL" maxLength={20} />
          </label>
        </div>
        <div className="rc-row">
          <label>All-in rate ($, total for the load)
            <input value={rate} onChange={(e) => setRate(e.target.value)} onKeyDown={onKey} placeholder="1800" inputMode="decimal" />
          </label>
        </div>
        <button className="btn-primary" onClick={() => void runCheck()} disabled={checking}>
          {checking ? 'Checking…' : 'Check'}
        </button>
        {error && <p className="error">{error}</p>}

        {pendingVerdict && (
          <div className="rc-warn">
            <div className="strong">⚠ No route match</div>
            <p>
              This lane isn't in our live rate system. Double-check the city and state spelling and try again.
              If you're 100% certain the input is correct, you can proceed — the result is a mileage-based
              estimate, so proceed with caution.
            </p>
            <button className="btn-ghost" onClick={() => { setVerdict(pendingVerdict); setPendingVerdict(null); }}>
              Proceed anyway
            </button>
          </div>
        )}

        {verdict && (
          <div className={`rc-verdict rc-${verdict}`}>
            <span className="rc-mark">{verdict === 'green' ? '✓' : verdict === 'red' ? '✗' : '⚠'}</span>
            <span>
              {verdict === 'green' && 'Within rate — OK to book'}
              {verdict === 'red' && 'Over rate — do not book'}
              {verdict === 'error' && "Couldn't price this lane — double-check the cities."}
            </span>
          </div>
        )}
      </section>

      {canUpload && (
        <section className="rc-card">
          <h3>Update master rate file</h3>
          <p className="muted">
            Upload the latest <code>GHL_USPS_Master_Rate_File_v{'{N}'}_{'{YYYY-MM-DD}'}.xlsx</code> — it's parsed
            server-side, live lanes rebuild, and expired / terminated trips drop automatically.
            Future-effective trips (e.g. a trip starting next month) only go live on a re-upload after their date.
          </p>
          <div className="rc-row">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button className="btn-primary" onClick={() => void upload()} disabled={!file || uploadState === 'Rebuilding…'}>
              Upload &amp; rebuild lanes
            </button>
          </div>
          {uploadState && <p className={uploadState.startsWith('✓') ? 'muted' : 'error'}>{uploadState}</p>}
          {uploadDetail && <pre className="rc-missing">{uploadDetail}</pre>}
        </section>
      )}
    </div>
  );
}
