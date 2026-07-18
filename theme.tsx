/* Granular permissions (v2.11.0, Caleb's spec 2026-07-09).
   Tree: each tab is a root; everything inside it is a branch. Role defaults
   reproduce pre-v2.11 behavior EXACTLY; per-user allow/deny overrides tune
   individuals above or below their role. firestore.rules enforce the same
   keys server-side (hasPerm) — the UI gates are convenience, not security.

   Nesting logic:
   - Granting a branch auto-grants its ancestors (you can't edit bands without
     seeing Integrity) and its `requires` (offers need booking rights).
   - Denying a node auto-denies its whole subtree AND everything that requires
     it — no orphaned capabilities, no broken flows.
   - Role/permission management itself is deliberately NOT in this tree: it
     stays hard-gated to the provisioning matrix (owner etc.). */
import { canAdmin, canBook, canEditLanes, type AppUser } from './types';

export interface PermNode {
  key: string;
  label: string;
  parent?: string;
  requires?: string[];
}

export const PERMISSIONS: PermNode[] = [
  { key: 'matrix', label: 'Matrix — view the board' },
  { key: 'matrix.book', label: 'Book / edit loads (carriers, statuses, truck #, LS#, shuttles)', parent: 'matrix' },
  { key: 'matrix.create', label: 'Add loads to empty cells / extras', parent: 'matrix', requires: ['matrix.book'] },
  { key: 'matrix.chargebackLog', label: 'Log a chargeback / fallout on a load', parent: 'matrix', requires: ['matrix.book'] },
  { key: 'matrix.addLane', label: 'Add extras lanes (non-FA2D3 sections) from the Matrix', parent: 'matrix' },
  /* GLOBAL row order — everyone sees the result, so default = owner only;
     grant per-person via the permission tree (Caleb 07/14) */
  { key: 'matrix.reorder', label: 'Drag-reorder Matrix rows & headers (changes the order for EVERYONE)', parent: 'matrix' },
  { key: 'matrix.serviceNotes', label: 'Edit future service-change notes (ⓘ popover)', parent: 'matrix' },
  /* Rate cons: restricted for the stress-test period (Caleb 07/16) —
     owner / pricing manager / FedCom admins; widen later via overrides */
  { key: 'matrix.ratecon', label: 'Send / resend rate confirmations to carriers', parent: 'matrix' },

  { key: 'hub', label: 'Sales Hub — view the board' },
  { key: 'hub.fields', label: 'Edit working fields (posted rate, equipment, solo/team, notes, night pin)', parent: 'hub' },
  { key: 'hub.board', label: 'Hide / show loads on the carrier loadboard (👁)', parent: 'hub' },
  { key: 'hub.autoset', label: 'Auto-set open loads to Target / Ceiling', parent: 'hub.fields' },
  { key: 'hub.offers', label: 'Respond to carrier offers (accept / counter / deny)', parent: 'hub', requires: ['matrix.book'] },
  { key: 'hub.approve', label: 'Approve bookings (clears them off the hub)', parent: 'hub' },
  { key: 'hub.push', label: 'Push / rebuild the carrier loadboard', parent: 'hub' },

  { key: 'integrity', label: 'Integrity — view rates, TRM, dedicated & carrier DB' },
  { key: 'integrity.bands', label: 'Edit target / ceiling bands (reason-coded)', parent: 'integrity' },
  { key: 'integrity.trm', label: 'Edit TRM revenue data / upload the Master TRM', parent: 'integrity' },
  { key: 'integrity.lanes', label: 'Edit lane / planning data (Matrix ✎, add & remove lanes)', parent: 'integrity' },
  { key: 'integrity.dedicated', label: 'Edit the dedicated day-grid / re-import', parent: 'integrity' },
  { key: 'integrity.carriers', label: 'Edit the carrier database (name, MC, DOT, ⚑, notes)', parent: 'integrity' },

  { key: 'capacity', label: 'Capacity — view the empty-truck list' },
  { key: 'capacity.rebuild', label: 'Rebuild the capacity snapshot', parent: 'capacity' },

  { key: 'track', label: 'T&T — view Track & Trace' },
  { key: 'track.mark', label: 'Mark Loaded / Departed / Swap Complete', parent: 'track', requires: ['matrix.book'] },

  { key: 'analytics', label: 'Analytics — margin & KPI dashboards' },
  { key: 'analytics.settings', label: 'Edit margin settings (fuel, FSC, breakeven)', parent: 'analytics' },

  { key: 'qa', label: 'QA — view the BOL queue' },
  { key: 'qa.verify', label: 'Verify BOLs', parent: 'qa' },

  { key: 'ratecheck', label: 'Rate Check — dispatcher go/no-go rate tool' },
  { key: 'ratecheck.upload', label: 'Upload the master rate file (rebuilds rate-check lanes)', parent: 'ratecheck' },

  { key: 'import', label: 'Import — run TMS imports into the Matrix', requires: ['matrix.book'] },

  { key: 'trailers', label: 'Trailers — view the loadout trailer dashboard' },
  { key: 'trailers.mark', label: 'Enter trailer #s / mark trailers returned', parent: 'trailers' },
  { key: 'trailers.approve', label: 'Approve exceptions (alternate drop site, day extensions, relinks) + fine setting', parent: 'trailers' },

  { key: 'admin', label: 'Admin — view the module' },
  { key: 'admin.registrations', label: 'Approve / reject / send verification for loadboard registrations', parent: 'admin' },
  { key: 'admin.chargebacks', label: 'Chargebacks tab — register + CSV export', parent: 'admin' },
  { key: 'admin.chargebacks.decide', label: 'Decide chargebacks (confirm / dispute / recover / waive)', parent: 'admin.chargebacks' },
  { key: 'admin.accesslog', label: 'View the loadboard access log', parent: 'admin' },
];

const byKey = new Map(PERMISSIONS.map((p) => [p.key, p]));

export function permChildren(key: string): PermNode[] {
  return PERMISSIONS.filter((p) => p.parent === key);
}

function ancestorsOf(key: string): string[] {
  const out: string[] = [];
  let cur = byKey.get(key)?.parent;
  while (cur) {
    out.push(cur);
    cur = byKey.get(cur)?.parent;
  }
  return out;
}

/** Grant closure: the key + its ancestors + its requires (recursively). */
export function grantClosure(key: string, into = new Set<string>()): Set<string> {
  if (into.has(key)) return into;
  into.add(key);
  for (const a of ancestorsOf(key)) grantClosure(a, into);
  for (const r of byKey.get(key)?.requires ?? []) grantClosure(r, into);
  return into;
}

/** Deny closure: the key + its subtree + everything that requires any of it. */
export function denyClosure(key: string, into = new Set<string>()): Set<string> {
  if (into.has(key)) return into;
  into.add(key);
  for (const c of PERMISSIONS.filter((p) => p.parent === key)) denyClosure(c.key, into);
  for (const d of PERMISSIONS.filter((p) => (p.requires ?? []).includes(key))) denyClosure(d.key, into);
  return into;
}

/* ---- v2.32.0: OWNER-editable role defaults (settings/roleDefaults) ----
   The doc stores the effective permission-key list per role ('admin_fedcom'
   for FedCom-tagged admins). The store loads it once per snapshot and feeds
   this registry; roles absent from the doc fall back to the code defaults
   below. The OWNER is NEVER matrix-driven — always every key — so the owner
   cannot downgrade himself, accidentally or otherwise. UI-level for now: the
   Firestore rules keep enforcing the shipped baseline + per-user overrides. */
let ROLE_MATRIX: Record<string, string[]> | null = null;
export function setRoleMatrix(m: Record<string, string[]> | null): void {
  ROLE_MATRIX = m;
}
export function matrixKeyFor(u: AppUser): string {
  return u.role === 'admin' && u.fedCom ? 'admin_fedcom' : u.role;
}

/* ---- role defaults: EXACTLY the v2.15.1 capability matrix ---- */
const BASE_VIEWS = ['matrix', 'hub', 'capacity', 'track'];

export function defaultPerms(u: AppUser): Set<string> {
  const s = new Set<string>(BASE_VIEWS);
  const add = (...keys: string[]) => keys.forEach((k) => s.add(k));
  const r = u.role;

  if (r === 'owner') {
    PERMISSIONS.forEach((p) => s.add(p.key));
    return s;
  }
  {
    const custom = ROLE_MATRIX?.[matrixKeyFor(u)];
    if (custom) return new Set(custom);
  }
  /* Rate Check (v2.26.0, Caleb 07/16): every role above base gets the tool.
     Master-file upload = Owner + Pricing Manager ONLY (v2.26.1, Caleb 07/16;
     grantable to others via permAllow). */
  if (r !== 'base') add('ratecheck');
  if (r === 'pricing_manager') add('ratecheck.upload');
  if (r === 'asset_rep') add('matrix.book', 'matrix.create', 'track.mark'); // GHL-scoped in rules/UI
  if (canBook(r) && r !== 'asset_rep') {
    add('matrix.book', 'matrix.create', 'matrix.chargebackLog', 'matrix.addLane', 'hub.offers', 'track.mark', 'import');
  }
  if (canEditLanes(r)) {
    add('integrity', 'integrity.bands', 'integrity.trm', 'integrity.lanes',
        'integrity.dedicated', 'integrity.carriers', 'analytics.settings', 'matrix.serviceNotes');
  }
  /* qa_manager vs qa_rep: IMPORT access is the distinction (Caleb 07/14) —
     import writes loads, so it honestly carries matrix.book */
  if (r === 'qa_manager') add('qa', 'qa.verify', 'matrix.book', 'import', 'matrix.serviceNotes');
  if (r === 'qa_rep') add('qa', 'qa.verify');
  /* trailer team (Caleb 07/15): manager approves exceptions; rep enters and
     marks returns. Bookers get mark (trailer # is part of booking). */
  if (r === 'trailer_manager') add('trailers', 'trailers.mark', 'trailers.approve');
  if (r === 'trailer_rep') add('trailers', 'trailers.mark');
  if (canBook(r) && r !== 'asset_rep') add('trailers', 'trailers.mark');
  if (canAdmin(r)) {
    add('trailers', 'trailers.mark', 'trailers.approve',
        'integrity', 'hub.fields', 'hub.autoset', 'hub.board', 'hub.approve', 'hub.push', 'capacity.rebuild',
        'integrity.carriers', 'matrix.serviceNotes',
        'admin', 'admin.registrations', 'admin.chargebacks', 'admin.accesslog');
  }
  /* Analytics is $$$-sensitive — FedCom admins, Pricing Manager, Owner ONLY
     (Caleb 07/17): data unvetted, not for general eyes. Plain/Asset admins
     lose it. Widen later per-person via the permission tree. */
  if (r === 'pricing_manager' || (r === 'admin' && u.fedCom)) add('analytics', 'analytics.settings');
  /* FedCom parity (v2.13.0): TRM + lane data, and chargeback DECISIONS
     (FCC / Pricing Manager / Owner — Caleb 07/10). */
  if (r === 'admin' && u.fedCom) add('integrity.trm', 'integrity.lanes', 'integrity.dedicated');
  if (r === 'pricing_manager' || (r === 'admin' && u.fedCom)) add('admin.chargebacks.decide', 'matrix.ratecon');
  return s;
}

/* ---- effective permissions: defaults + allow − deny, with closures ---- */
export function effectivePerms(u: AppUser): Set<string> {
  const s = defaultPerms(u);
  for (const k of u.permAllow ?? []) {
    for (const g of grantClosure(k)) s.add(g);
  }
  for (const k of u.permDeny ?? []) {
    for (const d of denyClosure(k)) s.delete(d);
  }
  return s;
}

/** The permission keys an editor is allowed to GRANT (Caleb 07/17: admins may
    delegate up to — never beyond — their own level). Owner ⇒ all. Everyone
    else ⇒ exactly their own effective permissions. */
export function grantablePerms(editor: AppUser): Set<string> {
  if (editor.role === 'owner') return new Set(PERMISSIONS.map((p) => p.key));
  return effectivePerms(editor);
}

export function can(u: AppUser, key: string): boolean {
  return effectivePerms(u).has(key);
}

/** Editor state for one node given draft overrides. */
export function nodeState(
  u: AppUser,
  key: string,
  allow: string[],
  deny: string[],
): { mode: 'inherit' | 'allow' | 'deny'; byDefault: boolean; effective: boolean } {
  const mode = deny.includes(key) ? 'deny' : allow.includes(key) ? 'allow' : 'inherit';
  const byDefault = defaultPerms(u).has(key);
  const effective = effectivePerms({ ...u, permAllow: allow, permDeny: deny }).has(key);
  return { mode, byDefault, effective };
}
