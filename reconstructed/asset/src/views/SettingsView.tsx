import { useEffect, useState } from 'react';
import { samsaraOrgs, setSamsaraOrgKey, geofenceSourceId, setGeofenceSourceId, maskKey, samsaraStatus, samsara, type ConnStatus, type SamsaraOrg } from '../integrations/samsara';
import { fleetioClient } from '../integrations/telematics';
import { maptilerKey, setMaptilerKey, maptilerMasked } from '../integrations/mapstyle';
import { onChange, emitChange } from '../data/bus';
import { firebaseEnabled } from '../firebase';
import { hasLocalData, localCounts, restoreLocalToShared } from '../data/recoverLocal';
import { runDiagnostics, type Diag } from '../data/diagnostics';
import { refreshDriversFromShared } from '../data/driversStore';
import { refreshFleetFromShared } from '../data/fleetStore';

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

  const [mtDraft, setMtDraft] = useState('');
  const status = samsaraStatus();
  const meta = STATUS_META[status];
  const flt = fleetioClient();
  const orgs = samsaraOrgs();
  const geoSource = geofenceSourceId();

  function saveMt() { setMaptilerKey(mtDraft); setMtDraft(''); emitChange(); }
  function clearMt() { setMaptilerKey(''); setMtDraft(''); emitChange(); }

  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState('');
  const counts = localCounts();

  const [diag, setDiag] = useState<Diag | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [reloadMsg, setReloadMsg] = useState('');
  async function checkSync() { setDiagBusy(true); setDiag(await runDiagnostics()); setDiagBusy(false); }
  useEffect(() => { if (firebaseEnabled) void checkSync(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  async function reloadShared() {
    setReloadMsg('');
    const d = await refreshDriversFromShared();
    const f = await refreshFleetFromShared();
    setReloadMsg(`↻ Pulled ${d} drivers and ${f} trucks from the shared database into this screen.`);
    void checkSync();
  }
  async function doRestore() {
    setRestoring(true); setRestoreMsg('');
    const res = await restoreLocalToShared();
    setRestoring(false);
    setRestoreMsg(`✓ Restored ${res.drivers} driver${res.drivers === 1 ? '' : 's'} and ${res.fleet} truck${res.fleet === 1 ? '' : 's'} from this device to the shared team roster. Everyone will see them now.`);
  }

  return (
    <div className="am-page">
      <div className="am-head"><h2>Integrations</h2></div>
      <p className="am-muted" style={{ fontSize: 12.5, maxWidth: 720 }}>
        Connect the trucks' telematics here. Keys live only in your browser and are never stored in the app's code.
        The connection UI is ready now; features run on realistic placeholder data until the backend link is finished.
      </p>

      {/* recover data saved on this device before shared sync existed */}
      {firebaseEnabled && hasLocalData() && (
        <div className="intg-card" style={{ borderColor: 'var(--amber)' }}>
          <div className="intg-card-head">
            <div className="intg-card-title">🛟 Restore this device's data to the team</div>
          </div>
          <p className="am-muted" style={{ fontSize: 12.5, maxWidth: 720 }}>
            This device has <b>{counts.drivers} drivers</b> and <b>{counts.fleet} trucks</b> saved from before the app shared data across the team.
            If your Driver Availability or Fleet Status edits went missing after an update, click below on <b>the device where you made those edits</b> to
            push them into the shared roster for everyone. It only adds/updates — it never deletes anyone.
          </p>
          <div className="am-lockbtns">
            <button className="am-save" disabled={restoring} onClick={doRestore}>{restoring ? 'Restoring…' : '🛟 Restore to shared roster'}</button>
          </div>
          {restoreMsg && <div className="am-notice" style={{ color: 'var(--green)', marginTop: 8 }}>{restoreMsg}</div>}
        </div>
      )}

      {/* sync diagnostics — what's actually in the shared database right now */}
      {firebaseEnabled && (
        <div className="intg-card">
          <div className="intg-card-head">
            <div className="intg-card-title">🔎 Sync status <span className="intg-card-sub">{diag?.email || 'checking…'}</span></div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="am-clear" type="button" disabled={diagBusy} onClick={checkSync}>{diagBusy ? 'Checking…' : '↻ Check'}</button>
              <button className="am-save" type="button" onClick={reloadShared}>⤓ Reload data from shared</button>
            </div>
          </div>
          <p className="am-muted" style={{ fontSize: 12.5, maxWidth: 720 }}>
            Live document counts read straight from the shared team database. If a number here is higher than what your screen shows,
            tap <b>Reload data from shared</b>. If a row shows a red error, that's a database-permission problem — send me the exact text.
          </p>
          <div className="am-scroll">
            <table className="am-grid am-fleet">
              <thead><tr><th>Shared data</th><th>In database</th><th>Status</th></tr></thead>
              <tbody>
                {!diag && <tr><td colSpan={3} className="am-muted" style={{ textAlign: 'center', padding: 12 }}>Checking the shared database…</td></tr>}
                {diag?.cols.map((c) => (
                  <tr key={c.name}>
                    <td className="am-tractor">{c.label} <span className="am-muted" style={{ fontSize: 11 }}>({c.name})</span></td>
                    <td><b>{c.error ? '—' : c.count}</b></td>
                    <td>{c.error
                      ? <span style={{ color: 'var(--red)', fontSize: 11.5, fontWeight: 700 }}>⚠ {c.error}</span>
                      : <span style={{ color: 'var(--green)', fontSize: 11.5, fontWeight: 700 }}>✓ readable</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {reloadMsg && <div className="am-notice" style={{ color: 'var(--green)', marginTop: 8 }}>{reloadMsg}</div>}
        </div>
      )}

      {/* Samsara — three organizations */}
      <div className="intg-card">
        <div className="intg-card-head">
          <div className="intg-card-title">
            <span className="intg-status-dot" style={{ background: meta.dot }} />
            📡 Samsara <span className="intg-card-sub">{meta.text}</span>
          </div>
          <span className="intg-badge">{samsara().label}</span>
        </div>
        <p className="am-muted" style={{ fontSize: 12.5, maxWidth: 760 }}>
          Three Samsara organizations. <b>Driver HOS</b> and <b>Truck GPS</b> read from <b>all three</b> (read-only) and merge together.
          <b> Geofences</b> import from the <b>one org you mark below</b> — set to <b>AJG Transport</b> by default. Keys live only in your browser and are never stored in the app's code.
        </p>

        <div className="am-scroll">
          <table className="am-grid am-fleet">
            <thead><tr><th>Organization</th><th>Read-only API key</th><th>Geofence source</th></tr></thead>
            <tbody>
              {orgs.map((o) => (
                <SamsaraOrgRow key={o.id} org={o} isGeoSource={geoSource === o.id}
                  onGeoSource={() => { setGeofenceSourceId(o.id); emitChange(); }} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="am-muted" style={{ fontSize: 11.5 }}>
          Paste each org's <b>read-only</b> token when you're ready — nothing is sent anywhere yet. The live backend connection is being added next; saving the keys now just gets them in place.
        </p>

        <div className="intg-feature-grid">
          <IntgFeature icon="🕒" title="Driver HOS" desc="Reads from all 3 orgs · drives the route-suggestion ranking on the planning calendar." />
          <IntgFeature icon="🛰" title="Truck GPS Tracking" desc="Reads from all 3 orgs · plots every truck on the Fleet Map." />
          <IntgFeature icon="⬛" title="Geofence Import" desc="From the AJG org only · pulls yard & customer geofences onto the Fleet Map." />
        </div>
        <div className="intg-mock-note">All run on <b>mock data</b> today via one shared Samsara adapter — the real per-org feeds swap in behind the same interface.</div>
      </div>

      {/* Map imagery (optional) — enables satellite/hybrid/terrain on the Fleet Map */}
      <div className="intg-card">
        <div className="intg-card-head">
          <div className="intg-card-title">
            <span className="intg-status-dot" style={{ background: maptilerKey() ? 'var(--green)' : 'var(--muted)' }} />
            🛰 Map imagery <span className="intg-card-sub">{maptilerKey() ? 'satellite enabled' : 'optional — streets active'}</span>
          </div>
        </div>
        <p className="am-muted" style={{ fontSize: 12 }}>The Fleet Map runs on a free street basemap with no key. Add a free MapTiler key to unlock <b>satellite / hybrid / terrain</b> (the full Samsara look).</p>
        <div className="intg-key-row">
          <div className="otp-field" style={{ flex: 1, minWidth: 260 }}>
            <span className="otp-field-label">MapTiler key</span>
            {maptilerKey()
              ? <div className="intg-saved-key">🔑 {maptilerMasked()} <button type="button" className="am-clear" onClick={clearMt}>Remove</button></div>
              : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="am-input" type="password" placeholder="paste a MapTiler key (free tier)…" value={mtDraft} onChange={(e) => setMtDraft(e.target.value)} autoComplete="off" />
                  <button type="button" className="am-save" disabled={!mtDraft.trim()} onClick={saveMt}>Save key</button>
                </div>
              )}
          </div>
        </div>
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

function SamsaraOrgRow({ org, isGeoSource, onGeoSource }: { org: SamsaraOrg; isGeoSource: boolean; onGeoSource: () => void }) {
  const [draft, setDraft] = useState('');
  function save() { if (draft.trim()) { setSamsaraOrgKey(org.id, draft); setDraft(''); emitChange(); } }
  function remove() { setSamsaraOrgKey(org.id, ''); setDraft(''); emitChange(); }
  return (
    <tr>
      <td className="am-tractor">{org.name}</td>
      <td>
        {org.key
          ? <span className="intg-saved-key">🔑 {maskKey(org.key)} <button type="button" className="am-clear" onClick={remove}>Remove</button></span>
          : (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="am-input" type="password" style={{ maxWidth: 240 }} placeholder="paste read-only token…" value={draft}
                onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} autoComplete="off" />
              <button type="button" className="am-save" disabled={!draft.trim()} onClick={save}>Save</button>
            </span>
          )}
      </td>
      <td>
        <label className="samsara-geo-pick">
          <input type="radio" name="samsara-geo-source" checked={isGeoSource} onChange={onGeoSource} />
          {isGeoSource ? <b>Geofences from here</b> : <span className="am-muted" style={{ fontSize: 11.5 }}>use for geofences</span>}
        </label>
      </td>
    </tr>
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
