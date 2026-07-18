import { Fragment, useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { seedFirestore, useStore } from '../data/store';
import { fmtStamp } from '../dates';
import { PERMISSIONS, can, defaultPerms, denyClosure, grantClosure } from '../permissions';
import PermissionsEditor from '../components/PermissionsEditor';
import { normalizeMc, ROLE_LABELS, creatableRoles, creatableRolesFor, laneCompactName, roleLabel, type AppUser, type Role } from '../types';

interface AccessEntry {
  email: string;
  name: string;
  at: string;
}

export default function AdminView() {
  const { users, currentUser, setUserRole, demoMode, lanes, loads, updateLoad, rebuildLoadboard, carrierUsers, respondCarrierUser, requestCarrierVerification, carriers, moraleEnabled, setMoraleEnabled, setUserMorale } = useStore();
  const isOwner = currentUser.role === 'owner';
  const grantable = creatableRolesFor(currentUser);
  /* A provisioner may only change users whose CURRENT role is within their own
     grantable set — nobody can demote above their authority (rules re-check). */
  const mayProvision = (u: AppUser) =>
    u.id !== currentUser.id && (isOwner || (grantable.length > 0 && grantable.includes(u.role)));
  /* Admin is four focused tabs (Caleb 07/09) - real buttons, not #anchors,
     which fought the hash router and bounced users to the Matrix. */
  const [tab, setTab] = useState<'users' | 'registrations' | 'chargebacks' | 'accesslog'>('users');
  const [permUser, setPermUser] = useState<AppUser | null>(null);
  const [showScopes, setShowScopes] = useState(false);
  /* v2.32.0: user groups collapse (click a section head to expand) + search */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [userQ, setUserQ] = useState('');
  const [seedState, setSeedState] = useState('');
  const [boardState, setBoardState] = useState('');
  const [accessLog, setAccessLog] = useState<AccessEntry[]>([]);
  const [verifyEmails, setVerifyEmails] = useState<Record<string, string>>({});
  const [cbQuery, setCbQuery] = useState('');

  useEffect(() => {
    if (demoMode || !db || !can(currentUser, 'admin.accesslog')) return;
    const q = query(collection(db, 'loadboardAccess'), orderBy('at', 'desc'), limit(50));
    return onSnapshot(q, (snap) => setAccessLog(snap.docs.map((d) => d.data() as AccessEntry)));
  }, [demoMode, currentUser.role]);

  if (!can(currentUser, 'admin')) {
    return <div className="page"><p className="muted">Admin access required.</p></div>;
  }

  const laneById = new Map(lanes.map((l) => [l.id, l]));
  /* Team & Roles subsections (Caleb 07/09) — grouped so the list is scannable
     without scrolling. Ordered by seniority within each group. */
  const ROLE_ORDER: Role[] = ['owner', 'pricing_manager', 'asset_admin', 'admin', 'pricing_rep', 'broker_rep', 'asset_rep', 'qa_manager', 'qa_rep', 'trailer_manager', 'trailer_rep', 'base'];
  const bySeniority = (a: AppUser, b: AppUser) =>
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name);
  const userGroups: Array<[string, AppUser[]]> = [
    ['GH Leadership & Admins', users.filter((u) => ['owner', 'pricing_manager', 'asset_admin', 'admin'].includes(u.role)).sort(bySeniority)],
    ['Reps & Specialists', users.filter((u) => ['pricing_rep', 'broker_rep', 'asset_rep', 'qa_manager', 'qa_rep', 'trailer_manager', 'trailer_rep'].includes(u.role)).sort(bySeniority)],
    ['Awaiting Clearance (Base)', users.filter((u) => u.role === 'base').sort(bySeniority)],
  ];
  const pendingRegs = carrierUsers.filter((c) => c.status === 'pending').length;
  const pendingUsers = users.filter((u) => u.role === 'base').length;
  /* §7.4 chargeback register: every load ever classified (class survives recovery) */
  const cbDecider = can(currentUser, 'admin.chargebacks.decide');
  const chargebacks = loads
    .filter((l) => l.chargebackClass || l.status === 'chargeback')
    .sort((a, b) => (b.chargebackAt ?? b.date).localeCompare(a.chargebackAt ?? a.date));
  const pendingCbs = chargebacks.filter(
    (l) => l.chargebackClass === 'once_recovered' && (l.chargebackStatus ?? 'pending') === 'pending',
  ).length;

  function exportChargebacks() {
    const head = ['date', 'carrier', 'lane', 'load#', 'class', 'amount', 'status', 'loggedBy', 'loggedAt', 'waiveNote', 'waivedBy'];
    const rows = chargebacks.map((l) => {
      const lane = laneById.get(l.laneId);
      return [
        l.date, l.chargebackCarrier || l.carrier, lane ? laneCompactName(lane) : l.laneId,
        l.loadNumber, l.chargebackClass ?? '', l.chargebackAmount ?? '',
        l.chargebackStatus ?? 'pending', l.chargebackBy ?? '', l.chargebackAt ?? '',
        l.chargebackWaiveNote ?? '', l.chargebackWaivedBy ?? '',
      ];
    });
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `chargebacks-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  async function runSeed() {
    setSeedState('Seeding…');
    try {
      await seedFirestore();
      setSeedState('Done — the Matrix is populated.');
    } catch (e) {
      setSeedState(`Failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Admin</h2>
        <span className="muted">Signed in as {currentUser.name} ({currentUser.role})</span>
      </div>

      <div className="status-chips" style={{ marginBottom: 16 }}>
        <button className={`chip ${tab === 'users' ? 'chip-on' : ''}`} onClick={() => setTab('users')}>
          Users {pendingUsers > 0 && <span className="badge">{pendingUsers}</span>}
        </button>
        {can(currentUser, 'admin.registrations') && <button className={`chip ${tab === 'registrations' ? 'chip-on' : ''}`} onClick={() => setTab('registrations')}>
          Registrations {pendingRegs > 0 && <span className="badge">{pendingRegs}</span>}
        </button>}
        {can(currentUser, 'admin.chargebacks') && <button className={`chip ${tab === 'chargebacks' ? 'chip-on' : ''}`} onClick={() => setTab('chargebacks')}>
          Chargebacks {pendingCbs > 0 && <span className="badge">{pendingCbs}</span>}
        </button>}
        {can(currentUser, 'admin.accesslog') && <button className={`chip ${tab === 'accesslog' ? 'chip-on' : ''}`} onClick={() => setTab('accesslog')}>
          Access Log
        </button>}
      </div>

      {!demoMode && isOwner && lanes.length === 0 && (
        <section className="seed-callout">
          <h3>Database is empty</h3>
          <p className="muted">
            Load the bundled Alpha Matrix data (193 lanes, 1,260 loads for 07/04–07/12, 337 carriers)
            into Firestore. One-time setup — safe to run once.
          </p>
          <button className="btn-primary" onClick={runSeed} disabled={seedState === 'Seeding…'}>
            Seed database from Alpha Matrix
          </button>
          {seedState && <p className="muted">{seedState}</p>}
        </section>
      )}

      {tab === 'users' && <section>
        <h3>Users & Permissions <span className="muted">({users.length})</span></h3>
        <button className="btn-ghost btn-sm" onClick={() => setShowScopes(true)}>📖 Role scopes</button>
        {isOwner && (
          <label className="shuttle-toggle" style={{ display: 'block', margin: '4px 0 10px' }}>
            <input type="checkbox" checked={moraleEnabled} onChange={(e) => void setMoraleEnabled(e.target.checked)} />
            {' '}Team-spirit badges <span className="muted">(master switch - then check the football box per user below)</span>
          </label>
        )}
        {demoMode && (
          <p className="muted">
            Demo mode — the real user list appears here once Firebase sign-in is live.
          </p>
        )}
        <p className="muted">
          New sign-ins land at Base (read-only) until provisioned. You can grant:{' '}
          {grantable.length ? grantable.map((r) => ROLE_LABELS[r]).join(', ') : 'nothing at your clearance'}
          {isOwner && ' — and Owner'}. FedCom is a tag on an Admin (federal committee), not a separate clearance.
        </p>
        <input
          className="search user-search"
          placeholder="Search team members by name or email…"
          value={userQ}
          onChange={(e) => setUserQ(e.target.value)}
        />
        <table className="list-table admin-users table-dense">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>FedCom</th><th title="Team-spirit badge (owner-set per user; the master switch is in this tab)">🏈</th><th></th></tr>
          </thead>
          <tbody>
            {userGroups.map(([groupLabel, groupUsersAll]) => {
              const needle = userQ.trim().toLowerCase();
              const groupUsers = needle
                ? groupUsersAll.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(needle))
                : groupUsersAll;
              const expanded = !!needle || !!openGroups[groupLabel];
              if (groupUsers.length === 0) return null;
              return (
              <Fragment key={groupLabel}>
                <tr
                  className="team-subhead"
                  onClick={() => setOpenGroups((g) => ({ ...g, [groupLabel]: !g[groupLabel] }))}
                  title={expanded ? 'Collapse section' : 'Expand section'}
                >
                  <td colSpan={6}>
                    <span className="grp-arrow">{expanded ? '▾' : '▸'}</span>
                    {groupLabel} <span className="muted">({groupUsers.length})</span>
                  </td>
                </tr>
                {expanded && groupUsers.map((u) => (
              <tr key={u.id}>
                <td className="strong">
                  {u.name}
                  {/* partner dispatch inferred from the sign-in domain — zero bookkeeping */}
                  {u.email && !u.email.endsWith('@ghlogisticsllc.com') && (
                    <span className="pill pill-partner" title="Partner dispatch (non-GH domain)">PARTNER</span>
                  )}
                </td>
                <td className="muted">{u.email}</td>
                <td>
                  {mayProvision(u) ? (
                    <select
                      className="inline-select"
                      value={u.role}
                      onChange={(e) => setUserRole(u.id, e.target.value as Role, u.fedCom)}
                    >
                      {(isOwner ? (['owner', ...creatableRoles('owner')] as Role[]) : grantable).map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                      {/* show the current role even when it isn't grantable, so the select isn't lying */}
                      {!((isOwner ? ['owner', ...creatableRoles('owner')] : grantable) as Role[]).includes(u.role) && (
                        <option value={u.role} disabled>{ROLE_LABELS[u.role]}</option>
                      )}
                    </select>
                  ) : (
                    <span className="pill pill-role">{roleLabel(u)}</span>
                  )}
                </td>
                <td>
                  {isOwner && u.role === 'admin' ? (
                    <input
                      type="checkbox"
                      checked={!!u.fedCom}
                      title="Federal Committee designation (owner-set; Admin role only)"
                      onChange={(e) => setUserRole(u.id, u.role, e.target.checked)}
                    />
                  ) : (
                    <span className="muted">{u.role === 'admin' && u.fedCom ? '✓' : '—'}</span>
                  )}
                </td>
                <td>
                  {/* per-user badge activation (Caleb 07/09): owner checks who
                      gets the team-spirit badge — it is NOT for everyone */}
                  {isOwner ? (
                    <input
                      type="checkbox"
                      checked={!!u.moraleOk}
                      title="Show the team-spirit badge for this user"
                      onChange={(e) => void setUserMorale(u.id, e.target.checked)}
                    />
                  ) : (
                    <span className="muted">{u.moraleOk ? '✓' : '—'}</span>
                  )}
                </td>
                <td>
                  {mayProvision(u) && u.role !== 'owner' && (
                    <button className="btn-ghost btn-sm" onClick={() => setPermUser(u)}>
                      Permissions{((u.permAllow?.length ?? 0) + (u.permDeny?.length ?? 0)) > 0 && <span className="perm-tuned" title="Has custom permissions"> ●</span>}
                    </button>
                  )}
                </td>
              </tr>
                ))}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>}

      {tab === 'registrations' && can(currentUser, 'admin.registrations') && <section>
        <h3>Registrations — Loadboard Access <span className="muted">({carrierUsers.filter((c) => c.status === 'pending').length} pending)</span></h3>
        <p className="muted">
          Carrier link: <b>https://ghl-loadboard.web.app</b> — any Google sign-in; the board mirrors
          open Sales Hub trips automatically (Rebuild below if it ever looks out of sync).
        </p>
        <button
          className="btn-ghost"
          onClick={async () => {
            setBoardState('Rebuilding…');
            const n = await rebuildLoadboard();
            setBoardState(`Done — ${n} trips on the board.`);
          }}
        >
          Rebuild loadboard
        </button>
        {boardState && <span className="muted"> {boardState}</span>}

        <p className="muted">
          Look the carrier up on Highway, paste their listed contact email, and Send verification —
          the contact gets an approve/deny link and the registration resolves itself. Approve/Reject
          remain as a manual override. Approved logins are locked to their carrier/MC — their offers
          book under the carrier name automatically.
        </p>
        {carrierUsers.length === 0 ? (
          <p className="muted">No registrations yet.</p>
        ) : (
          /* fixed-layout table so long emails/companies wrap instead of running past the viewport (§5.1) */
          <table className="list-table admin-regs table-dense">
            <colgroup>
              <col style={{ width: '24%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '26%' }} />
            </colgroup>
            <thead>
              <tr><th>Carrier</th><th>MC</th><th>Contact</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {[...carrierUsers].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).map((c) => (
                <tr key={c.uid}>
                  <td className="wrap">
                    <div className="strong">{c.company}</div>
                    {c.name && <div className="muted" style={{ fontSize: 12 }}>{c.name}</div>}
                  </td>
                  <td className="wrap">
                    {c.mcNumber}
                    {(() => {
                      /* carrier-DB link (Caleb 07/09): a registration whose MC
                         matches a database carrier links the dispatcher to it;
                         unknown MCs get flagged for a closer look. */
                      const match = carriers.find((k) => normalizeMc(k.mcNumber ?? '') && normalizeMc(k.mcNumber ?? '') === normalizeMc(c.mcNumber));
                      return match ? (
                        <div className="mc-link mc-known" title="MC matches the carrier database — this registration links to that carrier">
                          ✓ {match.name}{match.issue ? ' ⚑' : ''}
                        </div>
                      ) : (
                        <div className="mc-link mc-unknown" title="No carrier in the database carries this MC — verify carefully (Integrity → Carriers)">
                          MC not in carrier DB
                        </div>
                      );
                    })()}
                  </td>
                  <td className="muted wrap">{c.email}</td>
                  <td className="wrap">
                    <span className={`pill pill-status-${c.status}`}>{c.status}</span>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      req {fmtStamp(c.requestedAt)}
                    </div>
                    {c.status === 'pending' && c.verification && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {c.verification.status === 'sent' && <>verification sent to {c.verification.contactEmail}</>}
                        {c.verification.status === 'denied' && <>denied by {c.verification.contactEmail}</>}
                        {c.verification.status === 'failed' && <>email to {c.verification.contactEmail} failed — retry or approve manually</>}
                      </div>
                    )}
                  </td>
                  <td>
                    {c.status === 'pending' && (
                      <>
                        <span className="offer-actions" style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                          <input
                            className="inline-input"
                            type="email"
                            placeholder="Highway contact email"
                            style={{ minWidth: 0, flex: '1 1 150px' }}
                            value={verifyEmails[c.uid] ?? ''}
                            onChange={(e) => setVerifyEmails((prev) => ({ ...prev, [c.uid]: e.target.value }))}
                          />
                          <button
                            className="btn-ghost"
                            disabled={!/^\S+@\S+\.\S+$/.test(verifyEmails[c.uid] ?? '')}
                            onClick={() => {
                              void requestCarrierVerification(c.uid, (verifyEmails[c.uid] ?? '').trim());
                              setVerifyEmails((prev) => ({ ...prev, [c.uid]: '' }));
                            }}
                          >
                            {c.verification ? 'Resend' : 'Send verification'}
                          </button>
                        </span>
                        <span className="offer-actions">
                          <button className="btn-offer-accept" onClick={() => respondCarrierUser(c.uid, true)}>Approve</button>
                          <button className="btn-offer-deny" onClick={() => respondCarrierUser(c.uid, false)}>Reject</button>
                        </span>
                      </>
                    )}
                    {c.status !== 'pending' && c.respondedBy && (
                      <span className="muted" style={{ fontSize: 12 }}>{c.respondedBy}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </section>}

      {tab === 'chargebacks' && can(currentUser, 'admin.chargebacks') && <section>
        <h3>Chargebacks <span className="muted">({chargebacks.length} logged · {pendingCbs} pending decision)</span></h3>
        <p className="muted">
          Logged by any non-Asset role from the load editor (status → Chargeback / Fallout).
          The absorb decision — confirmed / disputed / recovered / waived — is limited to
          FCC / Pricing Manager / Owner; waiving requires a written reason. Wrong carrier or
          amount? ✎ corrects it in place; "logged in error" removes the chargeback entirely.
        </p>
        {chargebacks.length > 0 && (
          <div className="cb-toolbar">
            <input
              className="search"
              placeholder="Search carrier, load #, lane, rep…"
              value={cbQuery}
              onChange={(e) => setCbQuery(e.target.value)}
            />
            <button className="btn-ghost" onClick={exportChargebacks}>⬇ Export CSV (accounting)</button>
          </div>
        )}
        {chargebacks.length === 0 ? (
          <p className="muted">No chargebacks logged.</p>
        ) : (
          <table className="list-table table-dense">
            <thead>
              <tr><th>Date</th><th>Carrier</th><th>Lane</th><th>Load</th><th>Class</th><th>Amount</th><th>Logged by</th><th>Decision</th></tr>
            </thead>
            <tbody>
              {chargebacks.filter((l) => {
                if (!cbQuery.trim()) return true;
                const lane = laneById.get(l.laneId);
                const hay = [l.chargebackCarrier, l.carrier, l.loadNumber, l.chargebackBy, l.date,
                  lane ? laneCompactName(lane) : l.laneId].join(' ').toLowerCase();
                return cbQuery.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
              }).map((l) => {
                const lane = laneById.get(l.laneId);
                return (
                  <tr key={l.id}>
                    <td>{Number(l.date.slice(5, 7))}/{Number(l.date.slice(8, 10))}</td>
                    <td className="strong wrap">{l.chargebackCarrier || l.carrier || '—'}</td>
                    <td className="wrap">{lane ? laneCompactName(lane) : l.laneId}</td>
                    <td>{l.loadNumber || '—'}</td>
                    <td>{l.chargebackClass === 'none' ? 'No chargeback' : 'Once recovered'}</td>
                    <td>{l.chargebackAmount ? `$${l.chargebackAmount.replace(/^\$/, '')}` : '—'}</td>
                    <td className="muted wrap">{l.chargebackBy || '—'}</td>
                    <td>
                      <select
                        className="inline-select"
                        value={l.chargebackStatus ?? 'pending'}
                        disabled={!cbDecider}
                        title={cbDecider ? undefined : 'Decisions are limited to FCC / Pricing Manager / Owner'}
                        onChange={(e) => {
                          const v = e.target.value as NonNullable<typeof l.chargebackStatus>;
                          if (v === 'waived') {
                            /* waiving demands a written why — no note, no waive.
                               A waive FALLS OFF the Matrix (Caleb 07/10): the
                               load's status resets so no cell/modal notes remain. */
                            const note = (window.prompt('Waive this chargeback — explain why (required):') ?? '').trim();
                            if (!note) { e.target.value = l.chargebackStatus ?? 'pending'; return; }
                            void updateLoad(l.id, {
                              chargebackStatus: 'waived',
                              chargebackWaiveNote: note,
                              chargebackWaivedBy: currentUser.name || currentUser.email,
                              chargebackWaivedAt: new Date().toISOString(),
                              ...(l.status === 'chargeback' ? { status: l.carrier ? 'covered' : 'exposed' } : {}),
                            });
                            return;
                          }
                          void updateLoad(l.id, { chargebackStatus: v });
                        }}
                      >
                        <option value="pending">pending</option>
                        <option value="confirmed">confirmed — carrier absorbs</option>
                        <option value="disputed">disputed</option>
                        <option value="recovered">recovered</option>
                        <option value="waived">waived — reason required</option>
                      </select>
                      {l.chargebackStatus === 'waived' && l.chargebackWaiveNote && (
                        <div className="muted cb-waive-note" title={`Waived by ${l.chargebackWaivedBy ?? '—'}`}>
                          “{l.chargebackWaiveNote}” — {(l.chargebackWaivedBy ?? '').split(' ')[0]}
                        </div>
                      )}
                      {cbDecider && (
                        <div className="cb-correct">
                          <button
                            className="btn-ghost btn-sm"
                            title="Correct the chargeback — wrong carrier or amount"
                            onClick={() => {
                              const carrier = (window.prompt('Chargeback carrier (correcting a mis-log):', l.chargebackCarrier || l.carrier) ?? '').trim();
                              if (!carrier) return;
                              const amount = (window.prompt('Chargeback amount ($):', l.chargebackAmount ?? '') ?? '').trim();
                              void updateLoad(l.id, { chargebackCarrier: carrier, chargebackAmount: amount });
                            }}
                          >
                            ✎
                          </button>
                          <button
                            className="btn-ghost btn-sm"
                            title="Logged in error — remove this chargeback entirely (audited)"
                            onClick={() => {
                              if (!window.confirm('Remove this chargeback as logged-in-error? It disappears from the register and the Matrix (load history keeps the audit trail).')) return;
                              void updateLoad(l.id, {
                                chargebackClass: '' as never, chargebackAmount: '', chargebackStatus: '' as never,
                                chargebackCarrier: '', chargebackBy: '', chargebackAt: '',
                                chargebackWaiveNote: '', chargebackWaivedBy: '', chargebackWaivedAt: '',
                                ...(l.status === 'chargeback' ? { status: l.carrier ? 'covered' : 'exposed' } : {}),
                              });
                            }}
                          >
                            🗑
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

      </section>}

      {permUser && <PermissionsEditor user={permUser} onClose={() => setPermUser(null)} />}
      {showScopes && <RoleScopes onClose={() => setShowScopes(false)} />}

      {tab === 'accesslog' && can(currentUser, 'admin.accesslog') && <section>
        <h3>Loadboard Access Log <span className="muted">(last 50)</span></h3>
        {demoMode ? (
          <p className="muted">Access entries appear here once the board is live.</p>
        ) : accessLog.length === 0 ? (
          <p className="muted">No carrier visits yet.</p>
        ) : (
          <table className="list-table admin-users table-dense">
            <thead>
              <tr><th>When</th><th>Name</th><th>Email</th></tr>
            </thead>
            <tbody>
              {accessLog.map((a, i) => (
                <tr key={i}>
                  <td>{fmtStamp(a.at)}</td>
                  <td className="strong">{a.name || '—'}</td>
                  <td className="muted">{a.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>}
    </div>
  );
}

/* Role scopes reference (Caleb 07/17): what each role can do out of the box —
   we added many roles quickly and needed the scopes spelled out. Read-only;
   computed live from defaultPerms so it can never drift from the real rules. */
const SCOPE_COLS: Array<{ key: string; role: Role; fedCom?: boolean; label: string }> = [
  { key: 'owner', role: 'owner', label: 'Owner' },
  { key: 'pricing_manager', role: 'pricing_manager', label: 'Pricing Manager' },
  { key: 'admin', role: 'admin', label: 'Admin' },
  { key: 'admin_fedcom', role: 'admin', fedCom: true, label: 'Admin · FedCom' },
  { key: 'asset_admin', role: 'asset_admin', label: 'Asset Admin' },
  { key: 'pricing_rep', role: 'pricing_rep', label: 'Pricing Rep' },
  { key: 'broker_rep', role: 'broker_rep', label: 'Broker Rep' },
  { key: 'asset_rep', role: 'asset_rep', label: 'Asset Rep' },
  { key: 'qa_manager', role: 'qa_manager', label: 'QA Manager' },
  { key: 'qa_rep', role: 'qa_rep', label: 'QA Rep' },
  { key: 'trailer_manager', role: 'trailer_manager', label: 'Trailer Manager' },
  { key: 'trailer_rep', role: 'trailer_rep', label: 'Trailer Rep' },
  { key: 'base', role: 'base', label: 'Base' },
];

/* Role scopes (v2.30 reference → v2.32 EDITABLE, Caleb 07/18): the OWNER
   check/unchecks any role × permission cell to reshape role defaults live
   (stored in settings/roleDefaults; owner-only in firestore.rules). The
   closure logic mirrors the per-user editor — granting pulls ancestors +
   requirements, removing knocks out the subtree — so a role can never end up
   with a broken half-capability. The Owner column is IMMUTABLE: defaultPerms
   never consults the matrix for owner, so the owner cannot downgrade himself.
   Note: applies to everyone's UI instantly; the Firestore rules backstop
   still enforces the shipped baseline + per-user overrides underneath. */
function RoleScopes({ onClose }: { onClose: () => void }) {
  const { currentUser, roleMatrix, saveRoleDefaults } = useStore();
  const isOwner = currentUser.role === 'owner';
  const editable = (colKey: string) => isOwner && colKey !== 'owner';

  const permsFor = (col: typeof SCOPE_COLS[number]) =>
    defaultPerms({ id: col.key, name: '', email: '', role: col.role, fedCom: col.fedCom } as AppUser);

  function toggle(col: typeof SCOPE_COLS[number], permKey: string, on: boolean) {
    if (!editable(col.key)) return;
    const cur = new Set(permsFor(col));
    if (on) grantClosure(permKey).forEach((k) => cur.add(k));
    else denyClosure(permKey).forEach((k) => cur.delete(k));
    void saveRoleDefaults({ ...(roleMatrix ?? {}), [col.key]: [...cur].sort() });
  }

  const tuned = Object.keys(roleMatrix ?? {}).length > 0;

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor editor-wide scopes-modal" onClick={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <div>
            <div className="editor-lane">Role scopes{tuned && <span className="perm-tuned" title="One or more roles customized from the code defaults"> ●</span>}</div>
            <div className="editor-sub">
              {isOwner
                ? 'Owner-editable: checking a box grants that capability (and anything it needs); unchecking removes it and everything that depends on it. Applies to every user of that role immediately. The Owner column can never be reduced.'
                : 'Default permissions per role — the starting point before any per-user tuning.'}
            </div>
          </div>
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="grid-scroll">
          <table className="list-table scopes-table">
            <thead>
              <tr>
                <th>Capability</th>
                {SCOPE_COLS.map((c) => <th key={c.key}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => {
                const sets = SCOPE_COLS.map((c) => permsFor(c));
                return (
                  <tr key={p.key}>
                    <td className="wrap" style={{ paddingLeft: 8 + (p.parent ? 18 : 0) }}>{p.label}</td>
                    {SCOPE_COLS.map((c, i) => (
                      <td key={c.key} className={sets[i].has(p.key) ? 'scope-yes' : 'scope-no'}>
                        {editable(c.key) ? (
                          <input
                            type="checkbox"
                            checked={sets[i].has(p.key)}
                            onChange={(e) => toggle(c, p.key, e.target.checked)}
                          />
                        ) : (
                          sets[i].has(p.key) ? '✓' : ''
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="editor-actions">
          {isOwner && tuned && (
            <button
              className="btn-ghost btn-danger-ghost"
              onClick={() => {
                if (window.confirm('Reset EVERY role to the shipped defaults? Per-user tuning is untouched.')) void saveRoleDefaults({});
              }}
            >
              Reset all roles to defaults
            </button>
          )}
          <span className="spacer" />
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
