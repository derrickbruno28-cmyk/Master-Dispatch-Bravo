/* Delete-permission gate. Adding and editing loads is open to everyone; DELETING
   an active load (clearing a cell) is restricted to authorized people, because a
   stray click on live freight is costly. Demo-side this is an email allowlist in
   localStorage + a per-session unlock; at go-live this maps to real auth (the
   authorized list becomes a role/permission, the session email becomes the
   signed-in user). The owner manages who's on the list. */

const AUTH_KEY = 'asset-authorized-deleters-v1';
const SESSION_KEY = 'asset-delete-session-v1';

/* seeded owner — the account this app belongs to (from CLAUDE.md userEmail) */
export const OWNER_EMAIL = 'derrick.bruno28@gmail.com';

function norm(e: string) { return (e || '').trim().toLowerCase(); }

function read(): string[] {
  try { const r = localStorage.getItem(AUTH_KEY); if (r) { const a = JSON.parse(r) as string[]; if (Array.isArray(a) && a.length) return a; } } catch { /* ignore */ }
  return [OWNER_EMAIL];
}
function write(list: string[]) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(list)); } catch { /* ignore */ } }

export function authorizedDeleters(): string[] { return read(); }
export function isAuthorized(email: string): boolean { const e = norm(email); return !!e && read().some((x) => norm(x) === e); }
export function addAuthorized(email: string): string[] {
  const e = email.trim(); if (!e) return read();
  const list = read(); if (!list.some((x) => norm(x) === norm(e))) list.push(e);
  write(list); return list;
}
export function removeAuthorized(email: string): string[] {
  const list = read().filter((x) => norm(x) !== norm(email));
  write(list.length ? list : [OWNER_EMAIL]); return read();
}

export function sessionEmail(): string { try { return localStorage.getItem(SESSION_KEY) || ''; } catch { return ''; } }
export function setSessionEmail(email: string) { try { localStorage.setItem(SESSION_KEY, email.trim()); } catch { /* ignore */ } }
export function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

/* is the current session allowed to delete? */
export function canDelete(): boolean { return isAuthorized(sessionEmail()); }
export function isOwner(): boolean { return norm(sessionEmail()) === norm(OWNER_EMAIL); }

/* Try to unlock delete access as `email`. Returns whether it worked. */
export function unlock(email: string): { ok: boolean; msg: string } {
  const e = email.trim();
  if (!e) return { ok: false, msg: 'Enter your email to unlock.' };
  if (!isAuthorized(e)) return { ok: false, msg: `${e} is not authorized to delete. Ask the owner to add you.` };
  setSessionEmail(e);
  return { ok: true, msg: `Delete access unlocked for ${e}.` };
}
