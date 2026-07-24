import { useEffect, useState } from 'react';
import { samsaraKey, setSamsaraKey, maskedKey, samsaraStatus, samsara, type ConnStatus } from '../integrations/samsara';
import { fleetioClient } from '../integrations/telematics';
import { onChange, emitChange } from '../data/bus';

/* Integrations — the connection panel for external telematics. Samsara is the
   big one: paste an API key here (kept in this browser only, never in code), and
   Driver HOS, Truck GPS tracking, and Geofence Import all read through the one
   Samsara adapter. Until the backend is wired the app runs on mock data, so
   every feature works now; the real link turns on once the key + backend land. */

const STATUS_META: Record<ConnStatus, { dot: string; text: string }> = {
  not_configured: { dot: 'var(--muted)', text: 'Not connected' },
  key_saved: { dot: 'var(--amber)', text: 'Key saved · backend pending' },
  connected: { dot: 'var(--green)', text: 'Connected' },
};

export default function SettingsView() {
  const [, force] = useState(0);
  useEffect(() => onChange(() => force((n) => n + 1)), []);

  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState('');
  const status = samsaraStatus();
  const meta = STATUS_META[status];
  const flt = fleetioClient();

  function save() {
    setSamsaraKey(draft);
    setDraft('');
    setSaved('✓ API key saved to this browser. It runs on mock data until the backend is wired.');
    emitChange();
    window.setTimeout(() => setSaved(''), 4000);
  }
  function clear() { setSamsaraKey(''); setDraft(''); emitChange(); }

  return (
    <div className="am-page">
      <div className="am-head"><h2>Integrations</h2></div>
      <p className="am-muted" style={{ fontSize: 12.5, maxWidth: 720 }}>
        Connect the trucks' telematics here. Keys live only in your browser and are never stored in the app's code.
        The connection UI is ready now; features run on realistic placeholder data until the backend link is finished.
      </p>

      {/* Samsara */}
      <div className="intg-card">
        <div className="intg-card-head">
          <div className="intg-card-title">
            <span className="intg-status-dot" style={{ background: meta.dot }} />
            📡 Samsara <span className="intg-card-sub">{meta.text}</span>
          </div>
          <span className="intg-badge">{samsara().label}</span>
        </div>

        <div className="intg-key-row">
          <div className="otp-field" style={{ flex: 1, minWidth: 260 }}>
            <span className="otp-field-label">Samsara API key</span>
            {samsaraKey()
              ? <div className="intg-saved-key">🔑 {maskedKey()} <button type="button" className="am-clear" onClick={clear}>Remove</button></div>
              : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="am-input" type="password" placeholder="paste your Samsara API token…" value={draft}
                    onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
                  <button type="button" className="am-save" disabled={!draft.trim()} onClick={save}>Save key</button>
                </div>
              )}
          </div>
        </div>
        {saved && <div className="am-notice" style={{ color: 'var(--green)', borderColor: 'rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.08)' }}>{saved}</div>}
        <p className="am-muted" style={{ fontSize: 11.5 }}>
          Paste the token when you're ready — nothing is sent anywhere yet. The live backend connection is being added next; saving the key now just gets it in place.
        </p>

        <div className="intg-feature-grid">
          <IntgFeature icon="🕒" title="Driver HOS" desc="Hours-of-service drives the route-suggestion ranking on the planning calendar." />
          <IntgFeature icon="🛰" title="Truck GPS Tracking" desc="Live positions plot every truck on the Fleet Map." />
          <IntgFeature icon="⬛" title="Geofence Import" desc="Pull yard & customer geofences in from Samsara onto the Fleet Map." />
        </div>
        <div className="intg-mock-note">All three run on <b>mock data</b> today via one shared Samsara adapter — the real feed swaps in behind the same interface.</div>
      </div>

      {/* Fleetio (already wired as a mock in Phase 3) */}
      <div className="intg-card">
        <div className="intg-card-head">
          <div className="intg-card-title">
            <span className="intg-status-dot" style={{ background: 'var(--amber)' }} />
            🛠 Fleetio <span className="intg-card-sub">Mock · backend pending</span>
          </div>
          <span className="intg-badge">{flt.label}</span>
        </div>
        <p className="am-muted" style={{ fontSize: 12 }}>Maintenance / out-of-service status. Drives the Out of Service board and the matrix row-lock. Runs on mock data until a Fleetio token is added.</p>
      </div>
    </div>
  );
}

function IntgFeature({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="intg-feature">
      <div className="intg-feature-title">{icon} {title} <span className="intg-mini-badge">mock</span></div>
      <div className="intg-feature-desc">{desc}</div>
    </div>
  );
}
