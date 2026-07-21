/* Roles & permissions — the access model for the Asset Matrix.

   Four roles, owner-controlled:
   - owner    → Derrick. Full control: edit, delete, AND assign user roles.
   - fmt_lead → FMT Lead. Everything EXCEPT assigning roles.
   - us_ops   → US Ops. Everything EXCEPT assigning roles (same as FMT Lead).
   - fmt      → FMT. Edit only: add / update / clear fields, but can NEVER delete
                a whole load, driver, or team from the system.

   Identity: in production the signed-in Google email (set by AuthGate) is the
   current user; owner emails are always owner, everyone else takes the role the
   owner assigned them (new staff default to FMT — the safest, edit-only role).
   In demo (no Firebase) there is no sign-in, so a demo role switcher lets you
   preview the app as any role. */

import { firebaseEnabled } from '../firebase';
import { emitChange } from './bus';

export type Role = 'owner' | 'fmt_lead' | 'us_ops' | 'fmt';

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  fmt_lead: 'FMT Lead',
  us_ops: 'US Ops',
  fmt: 'FMT',
};
export const ROLE_DESC: Record<Role, string> = {
  owner: 'Full control — edit, delete, and assign user roles.',
  fmt_lead: 'Everything except assigning user roles.',
  us_ops: 'Everything except assigning user roles.',
  fmt: 'Edit only — add and update info, but cannot delete loads, drivers, or teams.',
};
/* the owner assigns these three; nobody can be assigned "owner" from the UI */
export const ASSIGNABLE_ROLES: Role[] = ['fmt_lead', 'us_ops', 'fmt'];

/* the owner account(s) — recognized whether Derrick signs in with his Google
   account or his @ghlogisticsllc.com work account */
export const OWNER_EMAILS = ['derrick.bruno28@gmail.com', 'derrick@ghlogisticsllc.com'];

/* new signed-in staff who haven't been assigned a role yet start edit-only */
const DEFAULT_ROLE: Role = 'fmt';

const ROLES_KEY = 'asset-user-roles-v1';      // { [email]: Role } — owner-managed
const SESSION_KEY = 'asset-session-email-v1'; // set by AuthGate (prod) / demo
const DEMO_ROLE_KEY = 'asset-demo-role-v1';   // demo-only role preview

function norm(e: string) { return (e || '').trim().toLowerCase(); }
export function isOwnerEmail(email: string): boolean { return OWNER_EMAILS.some((o) => norm(o) === norm(email)); }

/* ---- role map (owner-assigned) ---- */
function readRoles(): Record<string, Role> {
  try { const r = localStorage.getItem(ROLES_KEY); if (r) { const m = JSON.parse(r) as Record<string, Role>; if (m && typeof m === 'object') return m; } } catch { /* ignore */ }
  return {};
}
function writeRoles(map: Record<string, Role>) {
  try { localStorage.setItem(ROLES_KEY, JSON.stringify(map)); } catch { /* ignore */ }
  emitChange();
}

/* the role for any email — owner emails always win, then the assigned role, then
   the edit-only default for a recognized (signed-in) email */
export function roleOf(email: string): Role | '' {
  const e = norm(email);
  if (!e) return '';
  if (isOwnerEmail(e)) return 'owner';
  return readRoles()[e] ?? DEFAULT_ROLE;
}

/* owner-managed assignments to show in the Manage Roles panel (owner excluded —
   the owner can't reassign themselves) */
export function roleAssignments(): { email: string; role: Role }[] {
  const m = readRoles();
  return Object.keys(m).sort().map((email) => ({ email, role: m[email] }));
}
export function setRole(email: string, role: Role): void {
  const e = norm(email); if (!e || isOwnerEmail(e)) return; // never demote/assign the owner
  const m = readRoles(); m[e] = role; writeRoles(m);
}
export function removeRole(email: string): void {
  const m = readRoles(); delete m[norm(email)]; writeRoles(m);
}

/* ---- current session identity ---- */
export function sessionEmail(): string { try { return localStorage.getItem(SESSION_KEY) || ''; } catch { return ''; } }
export function setSessionEmail(email: string): void { try { localStorage.setItem(SESSION_KEY, norm(email)); } catch { /* ignore */ } emitChange(); }
export function clearSession(): void { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } emitChange(); }

/* ---- demo role preview (only used when Firebase isn't configured) ---- */
export function demoRole(): Role { try { return (localStorage.getItem(DEMO_ROLE_KEY) as Role) || 'owner'; } catch { return 'owner'; } }
export function setDemoRole(role: Role): void { try { localStorage.setItem(DEMO_ROLE_KEY, role); } catch { /* ignore */ } emitChange(); }

/* ---- the resolved current role + capability helpers ---- */
export function currentRole(): Role | '' {
  if (!firebaseEnabled) return demoRole();     // demo: preview as any role
  return roleOf(sessionEmail());               // prod: signed-in Google email
}
export function currentEmail(): string {
  if (!firebaseEnabled) return `demo (${ROLE_LABELS[demoRole()]})`;
  return sessionEmail();
}

export function isOwner(): boolean { return currentRole() === 'owner'; }
/* delete a whole load / driver / team — everyone EXCEPT plain FMT */
export function canDelete(): boolean { const r = currentRole(); return r === 'owner' || r === 'fmt_lead' || r === 'us_ops'; }
/* add / edit / update info — any recognized role */
export function canEdit(): boolean { return currentRole() !== ''; }
/* assign user roles — owner only */
export function canManageRoles(): boolean { return isOwner(); }
