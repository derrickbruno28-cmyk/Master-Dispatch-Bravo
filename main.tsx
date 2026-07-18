import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from '../firebase';
import { useStore } from '../data/store';
import { PALETTES, useTheme } from '../theme';
import { can } from '../permissions';
import { APP_VERSION, roleLabel } from '../types';
import { fetchTeamLogo, teamByKey, teamInitials, TEAMS } from '../teams';

/* ☰ settings menu (Caleb 07/10): consolidates the topbar's right side —
   theme, color palette, team pick (when permitted), sign out — behind one
   button to give the tab strip its space back. */
export default function SettingsMenu() {
  const { currentUser, users, demoMode, moraleEnabled, setMyTeam } = useStore();
  const { theme, toggle, palette, setPalette } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [teamQuery, setTeamQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const me = users.find((u) => u.id === currentUser.id) ?? currentUser;
  const mayPickTeam = moraleEnabled && !!me.moraleOk;
  const team = teamByKey(me.team);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function pickTeam(key: string) {
    const t = teamByKey(key);
    if (!t) return;
    setSaving(true);
    const logo = await fetchTeamLogo(t);
    await setMyTeam(t.key, logo);
    setSaving(false);
    setTeamQuery('');
  }

  const q = teamQuery.trim().toLowerCase();
  const matches = q ? TEAMS.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 8) : [];

  return (
    <div className="settings-menu" ref={boxRef}>
      <button className="btn-ghost btn-icon settings-btn" title="Settings" onClick={() => setOpen((v) => !v)}>
        ☰
      </button>
      {open && (
        <div className="settings-panel">
          <div className="settings-identity">
            <div className="strong">{me.name}</div>
            <div className="muted">{roleLabel(me)}{demoMode && ' · DEMO'}</div>
          </div>

          <div className="settings-row">
            <span>Theme</span>
            <button className="btn-ghost btn-sm" onClick={toggle}>
              {theme === 'dark' ? '☀ Switch to light' : '☾ Switch to dark'}
            </button>
          </div>

          <div className="settings-row">
            <span>Palette</span>
            <select
              className="palette-select"
              value={palette}
              onChange={(e) => setPalette(e.target.value as typeof palette)}
            >
              {PALETTES.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>

          {mayPickTeam && (
            <div className="settings-team">
              <div className="settings-row">
                <span>Team spirit</span>
                {team ? (
                  <button className="btn-ghost btn-sm" onClick={() => { void setMyTeam('', ''); }}>
                    ✕ {team.name}
                  </button>
                ) : (
                  <span className="muted">none picked</span>
                )}
              </div>
              <input
                placeholder="Search NCAA D1 teams…"
                value={teamQuery}
                onChange={(e) => setTeamQuery(e.target.value)}
              />
              {saving && <div className="muted team-picker-note">Saving…</div>}
              {!saving && matches.map((t) => (
                <button key={t.key} className="team-option" onClick={() => void pickTeam(t.key)}>
                  <span className="team-mono" style={{ background: t.color }}>{teamInitials(t.name)}</span>
                  <span>{t.name}</span>
                </button>
              ))}
            </div>
          )}

          {can(currentUser, 'import') && (
            <button className="settings-action" onClick={() => { setOpen(false); navigate('/import'); }}>
              ⬆ Import loads (TMS)
            </button>
          )}
          {!demoMode && (
            <button className="settings-signout" onClick={() => signOut()}>
              Sign out
            </button>
          )}
          <div className="settings-version muted">Bravo Matrix v{APP_VERSION}</div>
        </div>
      )}
    </div>
  );
}
