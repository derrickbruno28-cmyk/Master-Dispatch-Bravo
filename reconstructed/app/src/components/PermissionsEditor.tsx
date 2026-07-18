import { useState } from 'react';
import { useStore } from '../data/store';
import { roleLabel, type AppUser } from '../types';
import { PERMISSIONS, grantablePerms, grantClosure, nodeState } from '../permissions';

/* v2.11 per-user permission tuning (owner-only). Tri-state per node:
   Inherit (role default) / Allow / Deny. Prerequisites bundle automatically —
   allowing a branch also allows its ancestors and requirements; denying a node
   knocks out its whole subtree and everything that depends on it, so no
   combination can leave a broken half-capability. */

interface Props {
  user: AppUser;
  onClose: () => void;
}

function depthOf(key: string): number {
  let n = 0;
  let cur = PERMISSIONS.find((p) => p.key === key)?.parent;
  while (cur) {
    n++;
    cur = PERMISSIONS.find((p) => p.key === cur)?.parent;
  }
  return n;
}

export default function PermissionsEditor({ user, onClose }: Props) {
  const { setUserPermissions, currentUser } = useStore();
  /* an editor may only hand out capabilities they hold (Caleb 07/17); owner
     holds everything. Rows outside this set are locked to Inherit/Deny. */
  const grantable = grantablePerms(currentUser);
  const [allow, setAllow] = useState<string[]>(user.permAllow ?? []);
  const [deny, setDeny] = useState<string[]>(user.permDeny ?? []);
  const [saving, setSaving] = useState(false);

  function setMode(key: string, mode: 'inherit' | 'allow' | 'deny') {
    let a = allow.filter((k) => k !== key);
    let d = deny.filter((k) => k !== key);
    if (mode === 'allow') {
      /* bundle: the key plus everything it needs (ancestors + requires) */
      const closure = [...grantClosure(key)];
      a = [...new Set([...a, ...closure])];
      d = d.filter((k) => !closure.includes(k)); // an explicit allow un-denies its prerequisites
    }
    if (mode === 'deny') {
      d = [...d, key];
    }
    setAllow(a);
    setDeny(d);
  }

  async function save() {
    setSaving(true);
    await setUserPermissions(user.id, allow, deny);
    onClose();
  }

  const tuned = allow.length > 0 || deny.length > 0;

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor editor-wide perm-editor" onClick={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <div>
            <div className="editor-lane">Permissions — {user.name}</div>
            <div className="editor-sub">
              Role default: <b>{roleLabel(user)}</b> · Inherit follows the role; Allow grants above
              it; Deny removes below it. Prerequisites bundle automatically. Enforced server-side.
              {currentUser.role !== 'owner' && <> You can only grant capabilities you hold yourself.</>}
            </div>
          </div>
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="perm-tree">
          {PERMISSIONS.map((p) => {
            const st = nodeState(user, p.key, allow, deny);
            const depth = depthOf(p.key);
            return (
              <div key={p.key} className={`perm-row ${depth === 0 ? 'perm-root' : ''}`} style={{ paddingLeft: depth * 22 }}>
                <span className={`perm-eff ${st.effective ? 'on' : 'off'}`} title={st.effective ? 'Effective: allowed' : 'Effective: not allowed'}>
                  {st.effective ? '✓' : '✕'}
                </span>
                <span className="perm-label">
                  {p.label}
                  {p.requires?.length ? (
                    <span className="perm-req" title={`Requires: ${p.requires.join(', ')}`}> ⛓</span>
                  ) : null}
                </span>
                <span className={`perm-default ${st.byDefault ? 'on' : ''}`}>
                  default {st.byDefault ? 'on' : 'off'}
                </span>
                {(() => {
                  const canGrant = grantable.has(p.key);
                  return (
                    <select
                      className={`inline-select perm-mode ${st.mode}`}
                      value={st.mode}
                      onChange={(e) => setMode(p.key, e.target.value as 'inherit' | 'allow' | 'deny')}
                    >
                      <option value="inherit">Inherit</option>
                      {/* can't grant above your own level */}
                      <option value="allow" disabled={!canGrant}>Allow{canGrant ? '' : ' (above your level)'}</option>
                      <option value="deny">Deny</option>
                    </select>
                  );
                })()}
              </div>
            );
          })}
        </div>

        <div className="editor-actions">
          {tuned && (
            <button className="btn-ghost btn-danger-ghost" onClick={() => { setAllow([]); setDeny([]); }}>
              Reset to role default
            </button>
          )}
          <span className="spacer" />
          <button className="btn-primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save permissions'}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
