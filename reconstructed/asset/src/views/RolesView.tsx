import { useEffect, useState } from 'react';
import {
  currentEmail, currentRole, canManageRoles, canManageRoleManagers,
  roleAssignments, setRole, removeRole,
  roleManagers, addRoleManager, removeRoleManager,
  ASSIGNABLE_ROLES, ROLE_LABELS, ROLE_DESC, OWNER_EMAILS,
  demoRole, setDemoRole, type Role,
} from '../data/permStore';
import { firebaseEnabled } from '../firebase';
import { onChange } from '../data/bus';

/* Roles & Access — a dedicated, restricted tab. Only the owner (Derrick) and
   designated role managers (Anna, Caleb) can see it. Here they assign each
   teammate a role (FMT Lead / US Ops / FMT); the owner additionally controls
   WHO is allowed to manage roles at all. */

export default function RolesView() {
  const [, force] = useState(0);
  const [list, setList] = useState(() => roleAssignments());
  const [managers, setManagers] = useState(() => roleManagers());
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('fmt');
  const [newMgr, setNewMgr] = useState('');

  useEffect(() => onChange(() => { setList(roleAssignments()); setManagers(roleManagers()); force((n) => n + 1); }), []);

  function refresh() { setList(roleAssignments()); setManagers(roleManagers()); force((n) => n + 1); }
  function assign(email: string, r: Role) { setRole(email, r); refresh(); }
  function addNew() { const e = newEmail.trim(); if (!e) return; setRole(e, newRole); setNewEmail(''); refresh(); }
  function addMgr() { const e = newMgr.trim(); if (!e) return; addRoleManager(e); setNewMgr(''); refresh(); }

  const role = currentRole();

  return (
    <div className="am-page">
      <div className="am-head">
        <h2>Roles &amp; Access</h2>
        <span className="am-muted">Signed in as <b>{currentEmail() || '—'}</b>{role && <> · <b>{ROLE_LABELS[role]}</b></>}</span>
      </div>

      {/* who can do what */}
      <div className="roles-legend">
        {(['owner', ...ASSIGNABLE_ROLES] as Role[]).map((r) => (
          <div key={r} className="roles-legend-card">
            <div className="roles-legend-title">{ROLE_LABELS[r]}</div>
            <div className="roles-legend-desc">{ROLE_DESC[r]}</div>
          </div>
        ))}
      </div>

      {!firebaseEnabled && (
        <div className="roles-section">
          <div className="roles-section-h">Preview as role <span className="am-muted">(demo only)</span></div>
          <div className="am-termfilter" style={{ marginTop: 6 }}>
            {(['owner', ...ASSIGNABLE_ROLES] as Role[]).map((r) => (
              <button key={r} className={`am-tchip ${demoRole() === r ? 'on' : ''}`} onClick={() => { setDemoRole(r); refresh(); }}>{ROLE_LABELS[r]}</button>
            ))}
          </div>
        </div>
      )}

      {/* team roster — everyone who has signed in, auto-populated */}
      <div className="roles-section">
        <div className="roles-section-h">Team <span className="am-muted">— everyone who has signed in. New sign-ins appear here automatically with FMT (edit-only); just pick their role.</span></div>
        <div className="am-scroll roles-scroll">
          <table className="am-grid am-fleet">
            <thead><tr><th>Person</th><th>Role</th><th>Last signed in</th><th></th></tr></thead>
            <tbody>
              {OWNER_EMAILS.map((e) => (
                <tr key={e}><td className="am-tractor">{e}</td><td><span className="am-pill" style={{ color: 'var(--accent)' }}>Owner</span></td><td className="am-muted" style={{ fontSize: 11 }}>—</td><td className="am-muted" style={{ fontSize: 11 }}>always owner</td></tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={4} className="am-muted" style={{ textAlign: 'center', padding: 14 }}>No one else has signed in yet. As teammates sign in with their work Google account, they'll show up here — or pre-add someone below.</td></tr>
              )}
              {list.map((u) => (
                <tr key={u.email}>
                  <td className="am-tractor">
                    {u.displayName ? <><b>{u.displayName}</b><div className="am-muted" style={{ fontSize: 11 }}>{u.email}</div></> : u.email}
                  </td>
                  <td>
                    <select className="am-input" style={{ maxWidth: 150 }} value={u.role} onChange={(e) => assign(u.email, e.target.value as Role)}>
                      {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  </td>
                  <td className="am-muted" style={{ fontSize: 11 }}>{u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}</td>
                  <td className="fleet-actions"><button className="fleet-del" title="Reset to FMT (edit-only)" onClick={() => { removeRole(u.email); refresh(); }}>↺</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="am-lockbtns" style={{ marginTop: 8 }}>
          <span className="am-muted" style={{ fontSize: 11.5 }}>Pre-add someone before they sign in:</span>
          <input className="am-input" style={{ maxWidth: 280 }} placeholder="teammate@ghlogisticsllc.com" value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNew(); }} />
          <select className="am-input" style={{ maxWidth: 150 }} value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
            {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <button className="am-save" disabled={!newEmail.trim()} onClick={addNew}>Add</button>
        </div>
      </div>

      {/* owner-only: who is allowed to manage roles + see this tab */}
      {canManageRoleManagers() && (
        <div className="roles-section">
          <div className="roles-section-h">Who can manage roles <span className="am-muted">(owner only — controls who sees this tab)</span></div>
          <div className="am-scroll roles-scroll">
            <table className="am-grid am-fleet">
              <thead><tr><th>Work email</th><th></th></tr></thead>
              <tbody>
                {OWNER_EMAILS.map((e) => (
                  <tr key={e}><td className="am-tractor">{e} <span className="am-muted" style={{ fontSize: 11 }}>(owner)</span></td><td></td></tr>
                ))}
                {managers.length === 0 && (
                  <tr><td colSpan={2} className="am-muted" style={{ textAlign: 'center', padding: 12 }}>Just the owner. Add Anna and Caleb's work emails below.</td></tr>
                )}
                {managers.map((e) => (
                  <tr key={e}><td className="am-tractor">{e}</td><td className="fleet-actions"><button className="fleet-del" title="Remove" onClick={() => { removeRoleManager(e); refresh(); }}>🗑</button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="am-lockbtns" style={{ marginTop: 8 }}>
            <input className="am-input" style={{ maxWidth: 300 }} placeholder="anna@ghlogisticsllc.com" value={newMgr}
              onChange={(e) => setNewMgr(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addMgr(); }} />
            <button className="am-save" disabled={!newMgr.trim()} onClick={addMgr}>Add manager</button>
          </div>
        </div>
      )}

      {!canManageRoles() && (
        <div className="roles-section"><div className="am-muted">You don't have access to manage roles.</div></div>
      )}
    </div>
  );
}
