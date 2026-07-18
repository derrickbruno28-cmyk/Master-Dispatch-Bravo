import { addDays, cleanTimes } from './dates';

export const APP_VERSION = '2.33.1';

/* ---- Roles & permissions (Phase 2) ----
   Tiers, highest first: owner > pricing_manager > asset_admin ≈ admin >
   pricing_rep / broker_rep / asset_rep > base (read-only).
   FedCom is a designation ON an Admin, not a separate permission set. */
export type Role =
  | 'owner'
  | 'pricing_manager'
  | 'asset_admin'
  | 'admin'
  | 'pricing_rep'
  | 'broker_rep'
  | 'asset_rep'
  | 'qa_manager'
  | 'qa_rep'
  | 'trailer_manager'
  | 'trailer_rep'
  | 'base';

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  pricing_manager: 'Pricing Manager',
  asset_admin: 'Asset Admin',
  admin: 'Admin',
  pricing_rep: 'Pricing Rep',
  broker_rep: 'Broker Rep',
  asset_rep: 'Asset Rep',
  qa_manager: 'QA Manager',
  qa_rep: 'QA Rep',
  trailer_manager: 'Trailer Manager',
  trailer_rep: 'Trailer Rep',
  base: 'Base (read-only)',
};

/** Legacy docs predate Phase 2: 'user' accounts were migrated to Broker Rep —
    map any straggler the same way so nobody silently gains/loses access. */
export function normalizeRole(r: string | undefined): Role {
  if (r === 'user') return 'broker_rep';
  return (r && r in ROLE_LABELS ? r : 'base') as Role;
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Federal Committee tag — only meaningful on role 'admin'; owner-set. */
  fedCom?: boolean;
  /** §8.2 daily booked-loads goal — FedCom-edited; default from margin settings. */
  dailyGoal?: number;
  /** Morale badge: the user's NCAA D1 team key + resolved logo URL (self-set). */
  team?: string;
  teamLogoUrl?: string;
  /** Owner-checked: this user gets the team-spirit badge (per-user opt-in). */
  moraleOk?: boolean;
  /** v2.11 granular overrides (owner-set): permission keys granted above the
      role default / denied below it. Evaluated via permissions.ts closures;
      enforced server-side by firestore.rules hasPerm(). */
  permAllow?: string[];
  permDeny?: string[];
}

/** Chargeback DECISIONS (absorb/recover/waive/correct) — FCC/Tucker/Execs
    only (Caleb 07/10): owner + pricing manager + FedCom-tagged admins.
    LOGGING a chargeback stays open to all non-Asset roles. */
export function canDecideChargeback(u: AppUser): boolean {
  return u.role === 'owner' || u.role === 'pricing_manager' || (u.role === 'admin' && !!u.fedCom);
}

/* Admin-tier ops: booking approval, clearing, dashboards, admin page.
   Pricing Manager and Asset Admin both carry full admin ops (Caleb-confirmed). */
export function canAdmin(role: Role): boolean {
  return role === 'owner' || role === 'pricing_manager' || role === 'asset_admin' || role === 'admin';
}

/** Book/assign carriers, add loads to the Matrix, respond to offers. */
export function canBook(role: Role): boolean {
  return canAdmin(role) || role === 'broker_rep';
}

/** Asset Rep: GHL-scoped booking (lane check via assetLaneAllowed). */
export function isAssetRep(role: Role): boolean {
  return role === 'asset_rep';
}

/** Pricing bands + lane/planning data. Plain Admin does NOT have this. */
export function canEditLanes(role: Role): boolean {
  return role === 'owner' || role === 'pricing_manager' || role === 'pricing_rep';
}

/** Lane-data editing (the ✎ LaneEditor, Integrity-only as of v2.11.3):
    pricing tier + FedCom-tagged admins (Caleb 07/09 — Integrity is the
    source of truth for the lane; mirror this in firestore.rules /lanes). */
export function canEditLaneData(u: AppUser): boolean {
  return canEditLanes(u.role) || (u.role === 'admin' && !!u.fedCom);
}

/** Sales Hub working fields (posted rate, equipment, solo/team, notes, night
    pin, board visibility) — Admin-tier only (Caleb-confirmed). */
export function canEditHubFields(role: Role): boolean {
  return canAdmin(role);
}

/** Which roles each role may provision (grant AND revoke). A creator may only
    change users whose current role is also within their creatable set (or
    base) — nobody demotes above their own authority. Owner: everyone. */
export function creatableRoles(by: Role): Role[] {
  switch (by) {
    case 'owner':
      return ['pricing_manager', 'asset_admin', 'admin', 'pricing_rep', 'broker_rep', 'asset_rep', 'qa_manager', 'qa_rep', 'trailer_manager', 'trailer_rep', 'base'];
    case 'pricing_manager':
      return ['pricing_rep', 'broker_rep', 'base'];
    case 'admin':
      return ['broker_rep', 'base'];
    case 'asset_admin':
      return ['asset_rep', 'base'];
    default:
      return [];
  }
}

/** v2.18.0 (Caleb): FedCom admins provision up to Admin / Asset Admin —
    never the pricing tier, never the FedCom tag (owner-set), never the owner.
    Mirrors the isFedCom users-update branch in firestore.rules. */
export function creatableRolesFor(u: AppUser): Role[] {
  if (u.role === 'admin' && u.fedCom) {
    return ['admin', 'asset_admin', 'broker_rep', 'asset_rep', 'qa_manager', 'qa_rep', 'trailer_manager', 'trailer_rep', 'base'];
  }
  return creatableRoles(u.role);
}

export function roleLabel(u: AppUser): string {
  return ROLE_LABELS[u.role] + (u.role === 'admin' && u.fedCom ? ' · FedCom' : '');
}

export interface Lane {
  id: string;
  name: string;
  origin: string;
  destination: string;
  via: string[];
  tripCode: string;
  tripLabel?: string; // "Trip A" / "Trip B" designation from the schedule
  section: string;
  frequency: string;
  planning: string;
  miles: string;
  arrivalTime: string;
  departureTime: string;
  delTime: string;
  weekendRate: string;
  weekdayRate: string;
  targetRates: string;
  dedicated?: boolean;
  dedicatedCarrier?: string;
  /** Dedication go-live date (Caleb 07/14): before this date the lane
      behaves FULLY open — no "SEND TO carrier", normal hub exposure. */
  dedicatedStart?: string; // YYYY-MM-DD
  /** Future service-change notes — shown in the ⓘ details popover with a
      ⚠ marker on the Matrix (admins/pricing/FedCom/QA write). */
  serviceNotes?: string;
  dedicatedRate?: string;
  dedicatedNotes?: string;
  defaultEquipment: string;
  sortOrder: number;
  active: boolean;
  isGroupHeader?: boolean; // one-row divider from the sheet (e.g. "AUSTIN OUTBOUND")
  soloApproved?: boolean; // over-500-mi route approved to run solo (pricing tier sets)
  /** v2.19.0: the USPS frequency code counts the DEPARTURE day, but Matrix
      cells are dated by PICKUP. True = this lane departs after midnight
      (PU 23:31, departs 00:01), so frequency checks shift one day forward.
      Unset = auto-detected from the times (laneDepartsNextDay). */
  freqNextDay?: boolean;
  /** v2.20.0: retirement date (YYYY-MM-DD, '' = active). A retired lane
      disappears from Matrix weeks that START on/after this date — past weeks
      keep the row and every load (never delete history). */
  retiredOn?: string;
}

/** One-off sections whose rows only render on weeks that hold their loads
    (Overflow / Extras, USPS Freight Auction) — otherwise they pile up forever. */
export function isExtraLane(lane: Lane): boolean {
  return /overflow|extra|auction/i.test(lane.section ?? '');
}

/** First dollar/number token in free text — e.g. the negotiated rate out of rateNotes. */
export function firstMoney(text: string): number | null {
  const m = /\$?\s*(\d[\d,]*(?:\.\d+)?)/.exec(text ?? '');
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** The carrier rate as a number: the dedicated rate field first, falling back
    to legacy rate-in-notes for loads from before the split. */
export function loadRate(load: Load): number | null {
  return firstMoney(load.rate ?? '') ?? firstMoney(load.rateNotes);
}

/* §6.4 empty-truck list: inferred from Matrix load completions, materialized
   to capacity/current by a Cloud Function at 08:00 Central (+ manual rebuild). */
export interface CapacityEntry {
  unit: string; // GH truck # or the carrier name for external units
  carrier: string;
  isAsset: boolean;
  emptyAt: string; // scheduled: `${date}T${HH:MM}` local to the drop
  cityRaw: string; // raw lane destination — normalize with publicCity() at read time
  laneLabel: string;
  fromLoadId: string;
  loadNumber?: string; // LS# of the load the truck came off (Zack 07/10)
}
export interface CapacityList {
  builtAt: string;
  entries: CapacityEntry[];
}

/** First numeric token of the lane's miles field ("1,253.40\n(23hr transit)…"). */
export function laneMiles(lane: Lane): number | null {
  const m = /[\d,]+(?:\.\d+)?/.exec(lane.miles ?? '');
  return m ? Number(m[0].replace(/,/g, '')) : null;
}

/** Auto Solo/Team (§6.5, pulled forward 2026-07-06): under 500 loaded miles runs
    SOLO; 500+ runs TEAM unless the route is solo-approved. Manual dropdown on a
    load always overrides. '' when miles are unknown (no guess). */
export function autoTeamSolo(lane: Lane): '' | 'SOLO' | 'TEAM' {
  const miles = laneMiles(lane);
  if (miles == null) return '';
  if (miles < 500) return 'SOLO';
  return lane.soloApproved || /\bsolo\b/i.test(lane.planning ?? '') ? 'SOLO' : 'TEAM';
}

export interface HistoryEntry {
  at: string; // ISO timestamp
  by: string; // user name/email
  action: string; // human-readable change summary
}

export interface Load {
  id: string; // `${laneId}_${date}`
  laneId: string;
  date: string; // YYYY-MM-DD
  loadNumber: string;
  carrier: string; // empty string = exposed
  /** The agreed carrier rate — a FIRST-CLASS number ("$2450" / "2450"), kept
      SEPARATE from notes so margin/waterfall/KPIs read it directly. Legacy
      loads may only have it embedded in rateNotes — always read via loadRate(). */
  rate?: string;
  rateNotes: string; // free-text notes ONLY going forward (driver, truck #, context)
  status: string; // StatusDef key
  postedRate: string; // Sales Hub posted rate
  equipment: string; // Sales Hub equipment override; empty = lane default
  teamSolo?: string; // SOLO | TEAM (Sales Hub)
  hubNotes: string;
  truckNumber?: string; // GH Logistics asset truck
  cancelReason?: string; // required when status = not_running
  tonuBill?: boolean; // Cancelled: "Bill USPS TONU (< 4 hours)" yes/no
  bookedBy?: string; // who assigned the carrier
  bookingApproved?: boolean; // admin sign-off; false = stays on Sales Hub as BOOKED
  bookingApprovedBy?: string; // Phase 4: which admin cleared it (imports leave this unset)
  bookingApprovedAt?: string; // Phase 4: ISO timestamp of the clear — drives "Cleared today"
  pinnedNight?: boolean;
  /** Soft book (Zack 07/10): booked but pricey — still shopping for cheaper.
      Hub row highlights yellow; no status change. */
  softBook?: boolean; // pinned for night shift on Sales Hub
  /* ---- T&T Phase 1 (07/11): tracking marks, all ISO stamps ---- */
  onSiteAt?: string; // truck marked on-site at the shipper
  departedAt?: string; // auto-stamped on the FIRST transition into 'departed' — drives the 55mph ETA
  deliveredAt?: string; // En Route tab's "✓ Delivered" (not a status)
  ppwkAt?: string; // PPWK/BOL received by T&T (QA's bolVerified stays the formal verification)
  defcon?: boolean; // 🚨 emphasis: pins the load red at the top of its T&T tab
  nextEmailAt?: string; // next required facility email (manual timer; late auto-flags are computed)
  /* ---- Loadout Trailer Module (07/15): the ONE missing datum is the
     trailer # — everything else (carrier, PO 3/5-day, unload, origin site)
     derives from the load. Chains derive from trailer# + carrier. ---- */
  trailerNumber?: string;
  trailerReturnSite?: string; // approved alternate drop (default: pickup origin)
  trailerFreeDays?: number | null; // 3/5/7 override (null/absent = default from PO equipment/Loading)
  /** Trailer-team working notes (Trailers tab column + detail modal). */
  trailerNotes?: string;
  /** Weekly billing run (Caleb 07/17): fines charged against carrier payables
      through this many late days — outstanding = fine(lateDays) − fine(billedDays). */
  trailerBilledDays?: number;
  trailerBilledAt?: string;
  /** Charge fines even when the carrier+destination exemption list matches. */
  trailerFineOverride?: boolean;
  trailerReturnedAt?: string; // ISO — trailer physically back
  /* ---- Rate Confirmation module (07/16): mirror fields written by the
     Cloud Functions (admin SDK) so the UI shows RC state without reading
     the rateCons collection. ---- */
  rcStatus?: '' | 'sent' | 'signed' | 'cancelled';
  rcSentAt?: string;
  rcSignedAt?: string;
  rcEmail?: string; // where the active RC went (prefills resends)
  rcDriver1?: string; // signed driver info flows back onto the load
  rcPhone1?: string;
  rcDriver2?: string;
  rcPhone2?: string;
  hideFromBoard?: boolean; // keep this load off the carrier loadboard
  /* §7.2/§7.4 chargeback lifecycle — attached to the LOAD (Caleb-confirmed).
     Logging: all roles except Asset Rep. The FINAL call (confirmed/disputed/
     recovered/none) is admin-tier and feeds the pending-admin bubble. */
  chargebackClass?: 'once_recovered' | 'none'; // dropdown 2
  chargebackAmount?: string; // optional $ — Phase 8 profit subtracts it
  chargebackStatus?: 'pending' | 'confirmed' | 'disputed' | 'recovered' | 'waived';
  chargebackCarrier?: string; // stamped at log time (carrier may be cleared after fallout)
  chargebackBy?: string;
  chargebackAt?: string;
  /* waiving requires a written why (decider-gated: canDecideChargeback) */
  chargebackWaiveNote?: string;
  chargebackWaivedBy?: string;
  chargebackWaivedAt?: string;
  /* §9.1/§9.2 QA gate: BOL verification by the QA Manager. A covered load
     enters the LC Cover Report only when status is 'departed' AND bolVerified. */
  bolVerified?: boolean;
  bolVerifiedBy?: string;
  bolVerifiedAt?: string;
  /* §6.1 shuttle: a different truck delivers than picked up. Pay waterfall:
     carrier's negotiated rate reconciles FIRST out of TRM revenue; only the
     remainder flows to the GH asset leg (never negative — asset gets $0 on a
     loss; GH never takes pay ahead of the carrier). */
  isShuttle?: boolean;
  shuttleType?: 'meet_swap' | 'yard_stage' | 'repower'; // repower = replacement carrier takes over mid-route (Zack 07/12)
  shuttleLocation?: string; // where the swap/stage happens
  shuttleCarrier?: string; // second (delivery) leg carrier; GH = asset leg
  shuttleTruckNumber?: string; // second-leg GH truck #
  shuttleAssetLs?: string; // §6.2: each asset leg carries its OWN Asset LS#
  /** Shuttle legs are marked INDEPENDENTLY: leg 1 = the load's own carrier/
      status; this is the delivery leg. '' / unset = auto (covered when a
      2nd-leg carrier is set, exposed otherwise). */
  /** Full status key for the delivery leg (mirrors the leg-1 statuses;
      'departed' displays as "Swap Complete / En Route"). Legacy values
      'covered'/'exposed' still honored. '' = auto by leg-2 carrier. */
  shuttleLegStatus?: string;
  shuttleLegNotes?: string; // independent notes for the delivery/transit leg
  /* Exposed shuttles start from the SWAP point on the hub/board:
     "Troy, TX → Indianapolis" instead of the lane's own origin. */
  shuttleCity?: string;
  shuttleState?: string;
  shuttleSwapEta?: string; // HH:MM — leg-1 ETA to the swap; becomes leg-2's PU time
  shuttlePostedRate?: string; // leg-2 posted rate for hub + carrier board
  shuttleSplitPct?: number; // both-legs-asset: % of the pot to leg 1 (default 50, manual)
  hubNoteLog?: HistoryEntry[]; // append-only Sales Hub notes (who/when/text)
  history?: HistoryEntry[];
  cellColor?: string | null; // legacy color imported from Alpha Matrix
}

/** Duplicate-prevention (post-cleanup, v2.8.1): carriers are considered THE
    SAME when names match after case/whitespace/punctuation normalization —
    addCarrier() reuses instead of creating. carrierNameKey additionally
    strips legal/industry suffixes for "did you mean" near-match warnings. */
export function normalizeCarrierName(name: string): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function carrierNameKey(name: string): string {
  return normalizeCarrierName(name)
    .replace(/\b(llc|inc|corp|co|ltd|trucking|transport(ation)?|logistics|carriers?|freight)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Carrier {
  id: string;
  name: string;
  mcNumber?: string;
  loadCount?: number;
  /** §7.3 manual "issue" flag (admin-set): removal prompts warn harder. */
  issue?: boolean;
  dot?: string; // DOT number (carrier DB tab in Integrity)
  phone?: string; // dispatch phone (LoadStop one-time import, Caleb 07/18)
  notes?: string; // flags / issue context (carrier DB)
  /** DNU = hard block (Zack 07/10): red name everywhere, cannot be assigned
      to any load (⚑ issue stays the softer warn-only flag). */
  dnu?: boolean;
  /** "No-load drivers": restricted drivers within the fleet, e.g.
      "2 drivers banned from Coppell — J. Smith, R. Diaz". */
  restrictedDrivers?: string;
  /** dispatch email (Highway-verified, manual entry) — prefills rate cons */
  email?: string;
}

/* ---- §7.1 dedicated-day master (mirrors the Daily Margin Report
   "Dedicated Lanes" tab — the source of truth going forward). One row per
   dedicated Trip# × Carrier; the Mon–Sun booleans are what the system
   expects — never CTS notes. */
export interface DedicatedLane {
  id: string; // `${tripNumber}_${carrier-slug}`
  tripNumber: string; // TRM trip id — joins integrity/tripCode ("48" → FA2D3-48)
  origin: string; // normalized (trailing-space/"S" variants collapsed at import)
  destination: string;
  miles: number | null;
  carrier: string;
  carrierRate: number | null; // per-day cost ($)
  revenuePerDay: number | null; // per-day revenue ($)
  days: boolean[]; // Mon..Sun — the dedicated-day source of truth
  everyDay: boolean;
  notes: string;
  validated: boolean; // the tab's ✅ column
  /** LC who dedicated the trip to this carrier (Zack 07/10) — best
      relationship = best shot at sliding the carrier to an earlier PU. */
  lc?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Monday-first weekday index (Mon=0 … Sun=6) for a YYYY-MM-DD. */
export function mondayIndex(dateIso: string): number {
  return (new Date(`${dateIso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Bare trip number off a lane's tripCode ("FA2D3-48" → "48"). */
export function laneTripNumber(lane: Lane): string {
  const m = /(\d+)\s*$/.exec(lane.tripCode ?? '');
  return m ? String(Number(m[1])) : '';
}

/** §7.1: is a dedicated carrier expected on this lane THIS date?
    true = covered · false = master says NOT this day (the "expects them on a
    Mon trip" bug) · null = no master row, fall back to legacy CTS behavior. */
export function dedicatedCoversDate(dedicated: DedicatedLane[], lane: Lane, dateIso: string): boolean | null {
  /* dedication go-live gate (Caleb 07/14): before dedicatedStart the lane is
     FULLY open — no SEND TO, no dedicated banner, normal exposure */
  if (lane.dedicatedStart && dateIso < lane.dedicatedStart) return false;
  const trip = laneTripNumber(lane);
  if (!trip) return null;
  const rows = dedicated.filter((d) => d.tripNumber === trip);
  if (rows.length === 0) return null;
  const idx = mondayIndex(dateIso);
  return rows.some((r) => r.everyDay || r.days[idx]);
}

/** §7.2 logging a chargeback/fallout: everyone except Asset Rep (Asset Admin
    carries full admin ops per Caleb, so it may log). Base is read-only. */
export function canLogChargeback(role: Role): boolean {
  return canBook(role) || role === 'pricing_rep';
}

/** §9.1 BOL verification is the QA Manager's independent check (Owner as
    fallback) — deliberately NOT admin-tier, so the people clearing bookings
    aren't the ones verifying them (Caleb-confirmed). Owner-only provisions. */
export function canQaApprove(role: Role): boolean {
  /* qa_rep verifies BOLs too — the qa_manager/qa_rep distinction is IMPORT
     access only (Caleb 07/14) */
  return role === 'qa_manager' || role === 'qa_rep' || role === 'owner';
}


/** §8.2 rep goals: FedCom-designated Admins + Owner edit them. */
export function canEditGoals(u: AppUser): boolean {
  return u.role === 'owner' || (u.role === 'admin' && !!u.fedCom);
}

export interface StatusDef {
  key: string;
  label: string;
  color: string; // cell background
  textColor: string;
  order: number;
  auto?: boolean; // system-managed (exposed/covered)
}

export const EQUIPMENT_OPTIONS = [
  'POWER ONLY LOT BACK 3 DAYS',
  'POWER ONLY LOT BACK 5 DAYS',
  /* one-way PO — no lot-back leg (trip 2000, Zack 07/12) */
  'POWER ONLY - ONE WAY',
  /* 'LIVE/LIVE' retired (redundant with LIVE LOAD, Caleb 07/09) — legacy
     values migrated to LIVE LOAD in prod; color kept for stragglers */
  'LIVE LOAD',
] as const;

/* Loading-option colors (Caleb 07/09): LIVE/LIVE is his copper #a65f21; the
   3-day and 5-day lot-backs are the same blue family, deliberately a shade
   apart so they read differently at a glance. */
export const EQUIPMENT_COLORS: Record<string, string> = {
  'LIVE/LIVE': '#a65f21',
  'LIVE LOAD': '#a65f21',
  'POWER ONLY LOT BACK 3 DAYS': '#5b7c99',
  'POWER ONLY LOT BACK 5 DAYS': '#31536e',
  'POWER ONLY - ONE WAY': '#7d97b8',
};
/** PO lot-back days follow the crew (Zack 07/15): TEAM = 5 days, SOLO = 3.
    A per-load equipment pick always wins; the lane default only steers when
    it's a POWER ONLY option. */
export function effectiveEquipment(load: Load, lane: Lane): string {
  if (load.equipment) return load.equipment;
  const base = lane.defaultEquipment ?? '';
  if (/POWER ONLY LOT BACK/i.test(base)) {
    const crew = load.teamSolo || autoTeamSolo(lane);
    return crew === 'TEAM' ? 'POWER ONLY LOT BACK 5 DAYS' : 'POWER ONLY LOT BACK 3 DAYS';
  }
  return base;
}

/** Dedicated PLUG-IN vs load COVER (Think Tank 07/15): filling a dedicated
    lane with its own dedicated carrier (dedication live for that date) is a
    plug-in — NOT a cover, no KPI credit. Any other carrier = a real cover. */
export function isDedicatedPlugIn(load: Load, lane: Lane | undefined): boolean {
  if (!lane?.dedicated || !lane.dedicatedCarrier || !load.carrier) return false;
  if (lane.dedicatedStart && load.date < lane.dedicatedStart) return false;
  return normalizeCarrierName(load.carrier) === normalizeCarrierName(lane.dedicatedCarrier);
}

export function equipmentColor(v: string): string | undefined {
  return EQUIPMENT_COLORS[(v ?? '').trim().toUpperCase()];
}

export const DEFAULT_SECTION = 'FA2D3 Schedule';

/* Status dropdown structure (Caleb 07/09): Exposed sits on top (cross-dept),
   then Brokerage, then Assets, then Cancelled. Loaded/Departed lives in BOTH
   dept sections (same status). Covered/dedicated-pending stay in the top
   group — they're auto-managed cross-dept states. */
export const STATUS_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: '', keys: ['exposed', 'covered', 'dedicated_pending'] },
  { label: 'Brokerage', keys: ['booked_rc_pending', 'rc_signed', 'departed', 'chargeback'] },
  /* GTG = Good to Go: the Q/A step after RC Signed (cross-dept, lavender). */
  { label: 'Q/A', keys: ['gtg'] },
  /* 'asset' (Asset Truck) removed from the picker per Caleb 07/09 — the
     status still EXISTS for legacy loads (colors/chips); the editor shows a
     "(legacy)" option only when the open load already carries it. */
  { label: 'Assets', keys: ['need_flyer', 'flyer_sent', 'drivers_confirmed', 'dispatched', 'departed'] },
  /* Omitted = the SITE cancelled it — logged separately from a standard cancel. */
  { label: 'Cancelled', keys: ['not_running', 'omitted'] },
];

/* Dropdown dept filtering (Caleb 07/09): GH carrier → no Brokerage section;
   non-GH carrier → no Assets; no carrier yet → show both. Q/A, top and
   Cancelled always show. */
export function statusGroupsFor(carrier: string): Array<{ label: string; keys: string[] }> {
  const gh = GH_CARRIER_RE.test(carrier);
  return STATUS_GROUPS.filter((g) => {
    if (g.label === 'Brokerage') return !carrier || !gh;
    if (g.label === 'Assets') return !carrier || gh;
    return true;
  });
}

/** Format a raw rate STRING for display (Matrix cells / hub): parse and
    strip ".00" cents; unparseable text passes through with a $ prefix. */
export function fmtRateStr(raw: string): string {
  const t = (raw ?? '').trim().replace(/^\$/, '');
  if (!t) return '';
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? fmtMoney(n) : `$${t}`;
}

/** Display money without ".00" — flat dollars are the norm ("$2,450");
    keep real cents when present ("$2,993.76"). */
export function fmtMoney(n: number): string {
  return Number.isInteger(n) ? `$${n.toLocaleString()}` : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const DEFAULT_STATUSES: StatusDef[] = [
  { key: 'exposed', label: 'Exposed', color: '#e5484d', textColor: '#ffffff', order: 0, auto: true },
  { key: 'dedicated_pending', label: 'Dedicated – Send to Carrier', color: '#f76b15', textColor: '#ffffff', order: 0.5, auto: true },
  { key: 'covered', label: 'Covered', color: '#30a46c', textColor: '#ffffff', order: 1, auto: true },
  { key: 'booked_rc_pending', label: 'Booked – RC Pending', color: '#f5d90a', textColor: '#1c1c1c', order: 2 },
  { key: 'rc_signed', label: 'RC Signed', color: '#8fce9f', textColor: '#1c1c1c', order: 3 },
  { key: 'gtg', label: 'Q/A — GTG', color: '#aa99ec', textColor: '#1c1c1c', order: 3.2 },
  /* asset pre-step (Caleb 07/09): flags the load for the asset team's
     Action Center until the flyer goes out */
  { key: 'need_flyer', label: 'Need to Send Flyer', color: '#e8590c', textColor: '#ffffff', order: 3.35 },
  { key: 'flyer_sent', label: 'Flyer Sent to Drivers', color: '#f5d90a', textColor: '#1c1c1c', order: 3.4 },
  { key: 'drivers_confirmed', label: 'Drivers Confirmed', color: '#8fce9f', textColor: '#1c1c1c', order: 3.6 },
  { key: 'dispatched', label: 'Dispatched', color: '#00ffff', textColor: '#1c1c1c', order: 4 }, // Caleb's asset-dispatch cyan (07/09)
  { key: 'departed', label: 'Loaded / Departed', color: '#39ff14', textColor: '#1c1c1c', order: 4.5 },
  { key: 'asset', label: 'Asset Truck', color: '#aa99ec', textColor: '#1c1c1c', order: 5 },
  { key: 'chargeback', label: 'Chargeback / Fallout', color: '#c2255c', textColor: '#ffffff', order: 5.5 },
  { key: 'not_running', label: 'Not Running / Cancelled', color: '#26282b', textColor: '#ffffff', order: 6 },
  { key: 'omitted', label: 'Omitted (site cancelled)', color: '#000000', textColor: '#ffffff', order: 6.5 },
];

/** Normalize a city/site label for DISPLAY only (the data stays as-is):
    "Coppell TX" → "Coppell, TX"; collapses spaces. Site-code suffixes like
    "Palmetto GA 303Cx" are INTENTIONAL (differentiates 303Cx vs 302RP —
    Caleb 07/09) and pass through untouched. */
export function cityDisplay(raw: string): string {
  let t = (raw ?? '').split('\n')[0].replace(/\s{2,}/g, ' ').trim().replace(/[,\s]+$/, '');
  /* "City TX" → "City, TX" (only when the tail is a bare 2-letter state) */
  t = t.replace(/([a-z\)])\s+([A-Z]{2})$/, '$1, $2');
  return t;
}

export function laneShortName(lane: Lane): string {
  if (lane.origin && lane.destination) {
    const mid = lane.via?.length ? ` → ${lane.via.map(cityDisplay).join(' → ')}` : '';
    return `${cityDisplay(lane.origin)}${mid} → ${cityDisplay(lane.destination)}`;
  }
  return lane.name.split('\n')[0];
}

/** Multi-drop-safe lane label for tight columns: origin → final destination
    with a "+N stops" marker instead of the full via chain (which gets cut
    off). The complete chain stays in lane details / hover titles. */
export function laneCompactName(lane: Lane): string {
  if (lane.origin && lane.destination) {
    const n = lane.via?.length ?? 0;
    return `${cityDisplay(lane.origin)} → ${cityDisplay(lane.destination)}${n ? ` (+${n} stop${n > 1 ? 's' : ''})` : ''}`;
  }
  return lane.name.split('\n')[0];
}

/** A chargeback that is still LIVE on this load — logged "once recovered"
    and neither recovered nor waived yet. Drives the Matrix cell strip and
    the persistent modal box even after another carrier covers the trip. */
export function activeChargeback(load: Load): boolean {
  return load.chargebackClass === 'once_recovered'
    && !['recovered', 'waived'].includes(load.chargebackStatus ?? 'pending');
}

export function isExposed(load: Load): boolean {
  if (load.status === 'chargeback') return true; // fell out — needs recovery
  return !!load.loadNumber && !load.carrier && load.status !== 'not_running' && load.status !== 'omitted';
}

export const GH_CARRIER_RE = /\bGH\b|GH\s*Logistics/i;

/** Asset Rep lane scope (Caleb-confirmed): GHL-dedicated lanes AND open lanes
    (no dedicated carrier) — never a lane dedicated to another carrier. */
export function assetLaneAllowed(lane: Lane): boolean {
  return !lane.dedicatedCarrier || GH_CARRIER_RE.test(lane.dedicatedCarrier);
}

/** Carrier offer submitted from the public loadboard. */
export interface Offer {
  id: string;
  loadId: string;
  rate: string;
  company: string;
  mcNumber?: string;
  phone: string;
  email: string;
  name: string;
  at: string;
  status: 'pending' | 'accepted' | 'countered' | 'denied';
  counter?: string;
  respondedBy?: string;
  respondedAt?: string;
  /* §5.5 acceptance snapshot: booked loads leave the open board instantly, so
     the carrier's "My Loads" renders from these, stamped at accept time. */
  laneLabel?: string;
  puDate?: string;
  puTime?: string;
}

/** A loadboard user's registration, tying their Google login to a carrier/MC.
    Offers are only allowed once the back office verifies (e.g. against Highway)
    that this email belongs to that carrier and approves the account. */
export interface CarrierUser {
  uid: string;
  email: string;
  name: string;
  company: string;
  mcNumber: string;
  phone: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  respondedBy?: string;
  respondedAt?: string;
  /** Written by the sendCarrierVerification / carrierVerify Cloud Functions. */
  verification?: {
    contactEmail: string;
    sentAt: string;
    status: 'sent' | 'approved' | 'denied' | 'failed';
  };
}

/** Facility contact directory (T&T Phase 1) — replaces the CT spreadsheet. */
export interface Facility {
  id: string; // slug of the site label
  site: string;
  emails: string;
  notes: string;
  address?: string; // street address — prints on rate confirmations
  updatedBy?: string;
  updatedAt?: string;
}

export function facilityId(site: string): string {
  return site.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'unknown';
}

export function normalizeMc(mc: string): string {
  return (mc ?? '').replace(/\D/g, '');
}

/** Is a shuttle's DELIVERY leg uncovered? Manual mark wins; otherwise it's
    exposed until a second-leg carrier is assigned. */
export function shuttleLegExposed(load: Load): boolean {
  if (!load.isShuttle) return false;
  if (load.shuttleLegStatus) return load.shuttleLegStatus === 'exposed';
  return !load.shuttleCarrier;
}

/** Leg-2 label: same statuses as leg 1, but Loaded/Departed reads as the
    swap handoff (Caleb 07/09). */
export function legStatusLabel(key: string): string {
  if (key === 'departed') return 'Swap Complete / En Route';
  return DEFAULT_STATUSES.find((st) => st.key === key)?.label ?? key;
}

/** On the Sales Hub board: exposed, booked-awaiting-approval, or a shuttle
    whose delivery leg still needs coverage (legs are marked independently). */
export function onSalesHub(load: Load): boolean {
  if (load.status === 'not_running' || load.status === 'omitted') return false;
  if (isExposed(load)) return true;
  if (shuttleLegExposed(load)) return true;
  return !!load.carrier && load.bookingApproved === false;
}

const DAY_TOKENS: Array<[RegExp, number]> = [
  [/\bsun(day)?s?\b/, 0],
  [/\bmon(day)?s?\b/, 1],
  [/\btue(sday)?s?\b/, 2],
  [/\bwed(nesday)?s?\b/, 3],
  [/\bthu(r(sday)?)?s?\b/, 4],
  [/\bfri(day)?s?\b/, 5],
  [/\bsat(urday)?s?\b/, 6],
];

/* ---- USPS frequency-code dictionary (Caleb 07/18) ----
   Standardizes the 46 free-text formats inherited from the Alpha sheet.
   Digits name weekdays 1=Mon … 7=Sun. Families:
   R/L/Q + digits = daily EXCEPT those days AND days after holidays;
   X + digits     = daily EXCEPT those days (no holiday clause);
   digits + X     = ONLY those days, except holidays;
   bare digits    = ONLY those days.
   Unknown codes fall back to parsing the lane's free text exactly as before,
   so nothing breaks while data gets cleaned. */
const USPS_DAY: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 0 };
const DAY_FULL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
function dayList(digits: string): number[] {
  return [...new Set([...digits].map((d) => USPS_DAY[d]).filter((d) => d !== undefined))];
}
function dayNames(days: number[]): string {
  const names = days.map((d) => DAY_FULL[d]);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}
export interface FreqSpec {
  desc: string;
  days: number[];
  holiday?: 'after' | 'on';
}
export function freqSpec(codeRaw: string): FreqSpec | null {
  const c = (codeRaw ?? '').trim().toUpperCase();
  if (!c) return null;
  if (c === 'DAILY') return { desc: 'Runs every day.', days: ALL_DAYS };
  if (c === 'OO2') return { desc: 'Tuesdays only (also operates the second day after a holiday).', days: [2], holiday: 'on' };
  let m = /^([RLQ])(\d{0,4})$/.exec(c);
  if (m) {
    const off = dayList(m[2]);
    const days = ALL_DAYS.filter((d) => !off.includes(d));
    return {
      desc: off.length
        ? `Daily except ${dayNames(off)} and days after holidays.`
        : 'Daily except days after holidays.',
      days,
      holiday: 'after',
    };
  }
  m = /^X(\d{1,4})$/.exec(c);
  if (m) {
    const off = dayList(m[1]);
    return { desc: `Daily except ${dayNames(off)}.`, days: ALL_DAYS.filter((d) => !off.includes(d)) };
  }
  m = /^(\d{1,4})X$/.exec(c);
  if (m) {
    const on = dayList(m[1]);
    return { desc: `${dayNames(on)} only, except holidays.`, days: on, holiday: 'on' };
  }
  m = /^(\d{1,4})$/.exec(c);
  if (m) {
    const on = dayList(m[1]);
    return { desc: `${dayNames(on)} only.`, days: on };
  }
  return null;
}
/** The frequency CODE token off the lane's free text ("R1 / Daily Except…" → "R1"). */
export function freqCodeOf(lane: Lane): string {
  const first = (lane.frequency ?? '').split('\n')[0].trim();
  const tok = first.split(/[\s\-/·–—]+/)[0].trim().replace(/[.,]$/, '');
  return freqSpec(tok) ? tok.toUpperCase() : '';
}
/** Human description for hover/ⓘ — dictionary text when the code is known,
    the lane's own free text otherwise. Integrity's freqCode (when present)
    wins over the lane text. */
export function freqDescription(lane: Lane, integrityCode?: string): string {
  const code = (integrityCode ?? '').trim() || freqCodeOf(lane);
  const spec = code ? freqSpec(code) : null;
  if (spec) return `${code.toUpperCase()} — ${spec.desc}`;
  return (lane.frequency ?? '').replace(/\n/g, ' · ') || '—';
}
/** Display token for the Matrix pill: "Freq R1". */
export function freqDisplay(lane: Lane, integrityCode?: string): string {
  return (integrityCode ?? '').trim().toUpperCase() || freqCodeOf(lane) || (lane.frequency ?? '').split('\n')[0];
}

/** Parse a lane's frequency text into the weekdays it runs, or null if unparseable. */
export function expectedWeekdays(frequency: string): number[] | null {
  const f = frequency.toLowerCase();
  if (!f.includes('daily')) return null;
  const afterExcept = f.split(/except/)[1] ?? '';
  const excluded = new Set<number>();
  for (const [rx, day] of DAY_TOKENS) {
    if (rx.test(afterExcept)) excluded.add(day);
  }
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !excluded.has(d));
}

/* ---------- US federal holidays (USPS-observed) ---------- */

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** nth (1-based) occurrence of a weekday (0=Sun) in a month; n=-1 for last. UTC-anchored. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return iso(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0));
  return iso(year, month, lastDay.getUTCDate() - ((lastDay.getUTCDay() - weekday + 7) % 7));
}

const holidayCache = new Map<number, Set<string>>();

export function usHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const set = new Set<string>([
    iso(year, 1, 1), // New Year's Day
    nthWeekday(year, 1, 1, 3), // MLK Day
    nthWeekday(year, 2, 1, 3), // Washington's Birthday
    nthWeekday(year, 5, 1, -1), // Memorial Day
    iso(year, 6, 19), // Juneteenth
    iso(year, 7, 4), // Independence Day
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 10, 1, 2), // Columbus Day
    iso(year, 11, 11), // Veterans Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    iso(year, 12, 25), // Christmas
  ]);
  holidayCache.set(year, set);
  return set;
}

export function isHoliday(dateIso: string): boolean {
  return usHolidays(Number(dateIso.slice(0, 4))).has(dateIso);
}

export function isDayAfterHoliday(dateIso: string): boolean {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return isHoliday(d.toISOString().slice(0, 10));
}

/** After-midnight departure (trip 580: PU 23:31, departs 00:01 next day).
    USPS frequency codes anchor to the DEPARTURE day; Matrix cells anchor to
    the PICKUP day. Auto-detected when the first departure time token is
    EARLIER than the pickup time token (a truck can't depart before it picks
    up same-day, so earlier == crossed midnight); lane.freqNextDay overrides. */
export function laneDepartsNextDay(lane: Lane): boolean {
  if (typeof lane.freqNextDay === 'boolean') return lane.freqNextDay;
  const tok = (v?: string) => /\d{2}:\d{2}/.exec(cleanTimes((v ?? '').split('\n')[0]))?.[0] ?? '';
  const pu = tok(lane.arrivalTime);
  const dep = tok(lane.departureTime);
  return !!pu && !!dep && dep < pu;
}

/** The date the FREQUENCY code should be evaluated against for a given
    Matrix cell date — shifted +1 for after-midnight departures. */
export function freqDateFor(lane: Lane, dateIso: string): string {
  return laneDepartsNextDay(lane) ? addDays(dateIso, 1) : dateIso;
}

/** Does this lane run on the given date, per its stated frequency (incl. holiday clauses)? */
export function runsOn(lane: Lane, dateIso: string, codeOverride?: string): boolean {
  /* v2.32.0: the frequency-code dictionary is the primary engine (seeded by
     Integrity's freqCode when the trip has a record); unknown codes fall back
     to the legacy free-text parser so nothing regresses mid-cleanup. */
  const code = (codeOverride ?? '').trim() || freqCodeOf(lane);
  const spec = code ? freqSpec(code) : null;
  if (spec) {
    if (!spec.days.includes(new Date(`${dateIso}T00:00:00Z`).getUTCDay())) return false;
    if (spec.holiday === 'after' && isDayAfterHoliday(dateIso)) return false;
    if (spec.holiday === 'on' && isHoliday(dateIso)) return false;
    return true;
  }
  const days = expectedWeekdays(lane.frequency);
  if (!days) return false;
  if (!days.includes(new Date(`${dateIso}T00:00:00Z`).getUTCDay())) return false;
  const f = lane.frequency.toLowerCase();
  if (/(day|days)\s+after\s+([a-z]+\s+)?holiday/.test(f) && isDayAfterHoliday(dateIso)) return false;
  if (/except[^.]*\bholidays?\b/.test(f) && !/after/.test(f) && isHoliday(dateIso)) return false;
  return true;
}
