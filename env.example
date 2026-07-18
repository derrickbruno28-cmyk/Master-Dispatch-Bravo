# Bravo Matrix — Project Handoff & Context Document

> **Purpose of this file**: complete, self-contained context for working on Bravo Matrix
> from a Claude Project (or any fresh session with no repo access). Last updated
> **2026-07-12, at release v2.33.1**. The repo's `CLAUDE.md` remains the living
> per-session context file; this document is the deeper narrative version.

---

## 0. Delta since the last full rewrite (v2.22.0 → v2.27.0)

- **v2.33.1 — LoadStop carrier import**: 3,364 new + 77 enriched (fill-only) from
  the 9-page TMS export; 4 DNB carriers seeded DNU; Carrier.phone added (column on
  Integrity→Carriers). DB now ~3.8k. Dupe scan: 4 same-MC + 111 same-name clusters
  (pre-existing free-text vs formal records) pending Caleb's merge decision.
- **v2.33.0 — hub.board**: loadboard hide/show (👁) is its own permission key,
  split from hub.fields — admin-tier default (FedCom included), assignable per
  user or per role; rules enforce via a keys-only standalone branch.
- **v2.32.4 — density part two**: T&T on table-dense; Sales Hub dense but
  rule-8-safe (Lane/Notes still wrap; equipment select unclipped at 245px;
  Notes column guaranteed 200px — auto had collapsed to 0 on narrow screens;
  hub min-width 1430 w/ sideways scroll fallback); Integrity rates on the
  exact recipe. Hub rows 45px, zero clipped cells.
- **v2.32.3 — .table-dense utility**: the Trailers density recipe (2px/6px,
  11.5px/1.3, nowrap+ellipsis, flattened controls) as one class, applied to all
  18 remaining data tables app-wide.
- **v2.32.2 — soft-book clipping**: the hub toggle column was 40px with
  table-layout:fixed + overflow:hidden — content wider than a column gets CLIPPED
  (unreachable by scroll/zoom). Column now 100px; verified all three toggles
  visible at a 1280px viewport.
- **v2.32.1 — follow-ups**: GTG → Broker/General row; hub width floor 1240 so the
  toggle column fits on-screen (stacked mini-toggles); Integrity sticky header fixed
  (own scroll container + overflow:visible on the table — .list-table's
  overflow:hidden kills sticky); T&T rows tightened via button/checkbox resets;
  Role scopes capability column fixed at 470px.
- **v2.32.0 — app-walk batch**: QA glow (MISSING? + undocumented cancels);
  USPS frequency-code dictionary (freqSpec — Integrity freqCode seeds the
  engine, free-text fallback); two labeled chip rows + Jump-to header tags
  (6 new header rows in prod); current-week marker; cross-week LS# search with
  week restore; hub density + labeled 🌙/🟡/👁 toggles + tinted site rows;
  Integrity sticky header/density/FEV import-skip; T&T trailer-density; Admin
  collapsible user groups + search (trailer/QA-rep roles were invisible);
  Role scopes EDITABLE by owner (settings/roleDefaults, owner column immutable,
  UI-level — rules still enforce the shipped baseline + per-user overrides).
- **v2.28.0 — Loadout batch two**: weekly "Bill fines & reset" run (stamps
  billed-through days, CSV for accounting, outstanding = accrued − billed);
  live exemption list (settings/trailers.exemptions, seeded from the sheet,
  per-trailer "charge anyway" override); trailers table: notes column, row-click
  detail modal, return-site dropdown (SATX/Dallas/Memphis/Columbia/Other),
  return-site filter, fine-desc sort, "Mark returned?" label, narrower columns.
- **v2.27.0 — Loadout batch**: tiered trailer fines (3d @ $50 then $300/day,
  settings/trailers {tierDays,tier1PerDay,tier2PerDay}); Matrix "L.O.T Trailer #"
  cell chip; LoadEditor 3/5/7 free-days select (default from Loading/TRM via
  effectiveEquipment; trailerFreeDays now number|null); dense /trailers table
  (nowrap). Open questions: Days-Billed credit, pickup-vs-unload clock anchor,
  NTR/exemptions/one-way.

### Earlier delta (v2.22.0 → v2.25.0, 2026-07-14/15)

- **v2.22.0 — T&T Phase 1**: TrackView is a tabbed workstation — **Track**
  (site/date/OTR filters, show-uncovered toggle, facility column, on-site 🏭 +
  next-email ✉ marks w/ late auto-📧, DEFCON 🚨 pinning), **En Route** (departed
  not-delivered; ETA = departedAt + miles ÷ 55mph — `departedAt` auto-stamps on
  the first transition into 'departed'; PPWK mark; ✓ Delivered stamps
  `deliveredAt`, NOT a status), **Facilities** (contact directory collection,
  pre-seeded from lane origins; the CT spreadsheet is retired).
- **v2.23.0 — Bravo Notes batch**: Matrix **drag-reorder** (`matrix.reorder`
  perm, owner-default; global order, sortOrder midpoints, render sorts by
  sortOrder); **FA2D3 MISC** section (ex-UMT Global, renamed in prod); soft-book
  hub band (open→🌙→🟡soft→✓covered) + soft-booked loads stay on the carrier
  board (BoardDoc.sortLast, no hint leaks); lane **serviceNotes** (⚠ in ⓘ,
  `matrix.serviceNotes`); **qa_rep** role (= qa_manager minus import);
  dedicated **start date** + carrier **dropdown from the DB** + trip search +
  **auto-flow**: marking a lane dedicated in Integrity creates the Dedicated row
  (LC auto-stamped); the dedicated XLSX import is retired.
- **v2.24.0 — Think Tank batch**: booked hub rows keep the NoteCell (the
  notes-vanish bug); Matrix ⛟ Assets chip, TRK# search box, O/D in search,
  Alpha-style highlight; hub trip letter + crew-based PO lot-back days
  (`effectiveEquipment`: TEAM=5/SOLO=3); T&T mass-select bulk departed;
  KPI **plug-ins split from covers** (`isDedicatedPlugIn` — dedicated carrier
  on its own live-dedicated lane earns no cover credit).
- **v2.25.0 — Loadout Trailer Module**: fully DERIVED (`trailers.ts`) — only
  new datum is `Load.trailerNumber` (+ `trailerReturnSite`/`trailerFreeDays`/
  `trailerReturnedAt` overrides). Journey = chain of PO loads sharing
  trailer#+carrier; last link owns the clock, earlier links are "rolled".
  Clock starts at UNLOAD; 3/5 free calendar days by PO equipment; fine =
  late days × `settings/trailers.finePerDay` (default $100, adjustable);
  LIVE loads never count; per-site NET drift from approved cross-site drops.
  `/trailers` page (own nav tab); roles **trailer_manager** (mark+approve) /
  **trailer_rep** (mark); perms `trailers` / `trailers.mark` /
  `trailers.approve`; narrow load-write rule branches for the trailer team.
- New roles ladder addition: `qa_rep`, `trailer_manager`, `trailer_rep`
  (owner + FedCom-admin provisionable). New permission keys: `matrix.reorder`,
  `matrix.serviceNotes`, `trailers`, `trailers.mark`, `trailers.approve`.

---

## 1. What this is

**Bravo Matrix** is a freight-coverage web app for **GH Logistics** (a USPS contract
freight broker). It replaced the "Alpha Matrix" Google Sheet, where 30–50 people
manually keyed loads into weekly tabs. The app is the single operating surface for:

- **The Matrix** — a calendar board of ~190 lanes × days, showing every load's status by color.
- **The Sales Hub** — auto-derived list of exposed (uncovered) loads in the next 72 hours,
  which brokers work to cover; includes carrier offers, posted rates, booking approval.
- **A carrier-facing loadboard** — a sanitized public mirror where carriers see open
  freight and submit offers (never sees internal rates, load #s, trip #s, or notes).
- Supporting modules: Integrity (rate bands / TRM / lane data / dedicated / carrier DB),
  Capacity (empty-truck list), T&T (track & trace), Analytics (margin + KPIs),
  QA (BOL verification), Import (TMS import), Admin (users, registrations, chargebacks, access log).

**Owner / decision-maker**: Caleb Paul (caleb@ghlogisticsllc.com). All product decisions
route through him; several features carry "Caleb's call" notes below — treat those as settled.

---

## 2. Live system, accounts, environments

| Thing | Value |
|---|---|
| Main app | https://bravo-matrix-gh.web.app |
| Carrier loadboard | https://ghl-loadboard.web.app (same build, hostname-switched branding) |
| Firebase project | `bravo-matrix-gh` (Blaze plan, billing acct 0158C4-158262-BDFFC5) |
| GitHub repo | https://github.com/cdpmoney23/bravo-matrix (private; git user `cdpmoney23`) |
| Cloud Functions | `functions/` — TypeScript, Node 20, us-central1 |
| Email secret | `GMAIL_APP_PASSWORD` in Secret Manager (Google app password for caleb@ghlogisticsllc.com); sender override via `GMAIL_USER` param |

**Warning**: a `gh-financial` Firebase project also exists in the same account — it is
NOT this app. Never point `.firebaserc` or deploys at it.

**Sign-in**: Google-only, restricted to **@ghlogisticsllc.com and @ajgtransport.com**
(AJG = partner dispatch, activated v2.15.1). The domain list is env-driven
(`VITE_ALLOWED_DOMAIN`, comma-separated, first = primary brand) and enforced server-side
in `firestore.rules` (`isCompanyUser()` regex). AJG must be Google Workspace on that
domain. New sign-ins land at role `base` (read-only) until provisioned. The carrier
board accepts any Google account (separate registration/verification flow).

**Deploy** (from repo root):
```
cd app && npm run build
cd .. && firebase deploy --only hosting          # both sites (targets: app, loadboard)
firebase deploy --only firestore:rules            # rules
firebase deploy --only functions                  # functions (see Node-24 gotcha §9)
```

**Local dev**: `cd app && npm run dev` → **DEMO MODE** (bundled Alpha Matrix seed data;
`.env.development.local` blanks the Firebase config). Production config lives in
gitignored `app/.env.local` — recreate via `firebase apps:sdkconfig web --project bravo-matrix-gh`.
Demo-only URL params: `?role=broker_rep` (walk the app as any role), `&fedcom=1`
(FedCom-tagged admin POV), `?showreg` on the board (carrier registration walkthrough).
A demo user "Demo Broker" exists so the Permissions editor is testable in demo.

**Stack**: Vite + React 19 + TypeScript in `app/`; react-router **HashRouter**
(never use bare `#anchor` hrefs — they get parsed as routes); Firestore; Firebase Hosting
multisite; Firebase Auth (Google popup w/ redirect fallback).

---

## 3. Domain model (Firestore collections)

- **`lanes`** (~190) — the routes; 3-row clusters in the old sheet. Fields:
  origin/destination/via, tripCode (`FA2D3-XXX` etc.), tripLabel (Trip A/B), section
  (FA2D3 Schedule / UMT Global / Overflow / USPS FA), arrival/departure/del times,
  weekendRate/weekdayRate (legacy display fallback only), frequency, planning, miles,
  defaultEquipment, soloApproved, dedicated{Carrier,Rate,Notes}, sortOrder, active,
  `isGroupHeader` (one-row dividers like "AUSTIN OUTBOUND" — no loads; kept for stable IDs).
- **`loads`** — id = **`${laneId}_${YYYY-MM-DD}`** (weeks are views, not tabs). Fields:
  loadNumber (**immutable once set**; asset LS suffix "123456 / 654321" convention),
  carrier ('' = exposed), rate (first-class since v2.7 — read via `loadRate()`, never
  parse rateNotes for money), rateNotes (free text incl. drivers), status, postedRate,
  equipment, teamSolo, hubNotes + hubNoteLog (append-only), truckNumber (GH-only,
  same-day double-book guard), bookedBy, bookingApproved(+By/At), pinnedNight,
  hideFromBoard, softBook, tonuBill, history[] (audit trail), shuttle fields
  (isShuttle/shuttleType/Location/Carrier/TruckNumber/AssetLs/SplitPct/LegStatus/
  LegNotes/City/State/SwapEta/PostedRate), chargeback fields (class/amount/status/
  carrier/by/at/waiveNote/waivedBy/waivedAt), bolVerified(+By/At), cancelReason.
- **Statuses**: exposed / dedicated_pending / covered / booked_rc_pending / rc_signed /
  gtg / need_flyer / flyer_sent / drivers_confirmed / dispatched / departed / asset
  (GH-only, legacy picker-hidden) / chargeback / omitted / not_running (both cancels
  require cancelReason; TONU checkbox available). Status dropdown is **dept-filtered**
  by the leg's carrier (GH → Assets group, outside carrier → Brokerage group) via
  `statusGroupsFor`, rendered with color-dot custom listbox (`StatusSelect.tsx`).
- **`carriers`** — name, mcNumber, dotNumber, issue ⚑ flag, **dnu** (do-not-use: hard
  block in editor/datalist/offer-accept — client-side only), restrictedDrivers, notes.
  Dedupe is permanent-prevention (normalizeCarrierName reuse + near-match warnings).
- **`users`** — role + fedCom tag + dailyGoal + team/teamLogoUrl/moraleOk +
  **permAllow[]/permDeny[]** (v2.16 granular overrides, owner-set only).
- **`loadboard`** — SANITIZED mirror for carriers (no load#/trip#/targets/notes);
  synced on every load mutation + reconcile on admin session start + manual Rebuild.
  Carrier board window = today + tomorrow ONLY. Booked-pending-approval loads stay OFF it.
- **`offers`** — carrier offers (pending/accepted/countered/denied). Accept books under
  the carrier NAME resolved by MC; booking auto-denies other pending offers; acceptance
  is in-app only (no email — Caleb's call). Countered offers stay visible (dashed card).
- **`carrierUsers`** — loadboard registrations (company/MC/email); gate offer creation;
  verified via emailed Highway-contact link (single-use token, sha256 stored, 7-day
  expiry) or manual Approve/Reject. `verification` subfield written ONLY by Cloud Functions.
- **`verificationRequests`** — one per "Send verification" click; creating one triggers
  the `sendCarrierVerification` function. The GET renders a confirm page only (mail
  scanners prefetch links — **never act on the GET**); POST approves/denies; the link
  can never override a manual admin decision.
- **`integrity/{CONTRACT_trip}`** (~190 docs) — pricing bands (target/ceiling,
  weekday/weekend) + TRM revenue blocks + bandHistory subcollection (immutable,
  reason-coded). TRM upload reconciles, never touches bands. Monday staleness banner >7d.
- **`dedicated`** (~81 rows) — id `${tripNumber}_${carrier-slug}`; **Mon–Sun booleans are
  THE source of truth** (never CTS notes); day-grid master + reconcile REPORT (never
  auto-overwrite); `lc` field (v2.15). `dedicatedCoversDate()` gates dedicated_pending.
- **`capacity/current`** — empty-truck snapshot, written ONLY by Cloud Functions
  (08:00 America/Chicago schedule + admin rebuild callable). Inference logic is DUPLICATED
  in `app/src/capacity.ts` for demo — **keep the two ports in sync** (incl. the "next day"
  delivery +1 shift and the LS# column). Display-side 12-hour freshness filter (v2.14.2).
- **`settings/{margin|morale}`** — margin knobs (fuel daily / FSC weekly / breakeven 9.75%);
  morale master switch is owner-only.
- **`loadboardAccess`** — access log of board sign-ins.

**Margin engine** (`app/src/margin.ts`): Revenue = TRM currentRate + FSC/mi × laneMiles;
Cost = carrier rate (brokered) or (fuelCpm + driverCpm[solo .65 | team .80]) × mi (asset,
GH regex); chargebacks subtract until 'recovered' ('waived' keeps subtracting — loss we
ate); loads without a TRM rate are EXCLUDED and flagged (no fake numbers — Caleb).

**Pricing classifier** (`app/src/pricing.ts`): weekday = Mon–Thu; weekend = Fri/Sat/Sun +
actual-date holidays + day-before; PLUS the Live rule — a LIVE load on a non-natively-live
lane prices off the weekend band.

---

## 4. Roles & the granular permission system (v2.16.0)

### Role ladder
`owner` > `pricing_manager` ≈ `asset_admin` ≈ `admin` (admin may carry the **FedCom** tag,
owner-set) > `pricing_rep` / `broker_rep` / `asset_rep` / `qa_manager` > `base` (read-only).
Legacy role `'user'` == broker_rep (normalizeRole guards stragglers).
Provisioning matrix (grant AND revoke, never above own authority): owner→all;
pricing_manager→pricing_rep/broker_rep; admin→broker_rep; asset_admin→asset_rep.

### The permission tree (`app/src/permissions.ts` — 30 keys)
Each tab is a root; branches are capabilities inside it. ⛓ = `requires` cross-link.

```
matrix                      Matrix — view the board
├─ matrix.book              Book / edit loads (carriers, statuses, truck #, LS#, shuttles)
├─ matrix.create            Add loads to empty cells / extras          ⛓ matrix.book
├─ matrix.chargebackLog     Log a chargeback / fallout                 ⛓ matrix.book
└─ matrix.addLane           Add extras lanes (non-FA2D3 sections, v2.17)
hub                         Sales Hub — view
├─ hub.fields               Edit working fields (posted rate, equipment, solo/team, notes, night pin, visibility)
│  └─ hub.autoset           Auto-set open loads to Target / Ceiling
├─ hub.offers               Respond to carrier offers                  ⛓ matrix.book
├─ hub.approve              Approve bookings (clears the hub)
└─ hub.push                 Push / rebuild the carrier loadboard
integrity                   Integrity — view (rates/TRM/dedicated/carrier DB)
├─ integrity.bands          Edit target/ceiling bands (reason-coded)
├─ integrity.trm            Edit TRM revenue data / upload Master TRM
├─ integrity.lanes          Edit lane / planning data (✎, add & remove lanes)
├─ integrity.dedicated      Edit the dedicated day-grid / re-import
└─ integrity.carriers       Edit the carrier database
capacity                    Capacity — view
└─ capacity.rebuild         Rebuild the capacity snapshot
track                       T&T — view
└─ track.mark               Mark Loaded / Departed / Swap Complete     ⛓ matrix.book
analytics                   Analytics — margin & KPI dashboards
└─ analytics.settings       Edit margin settings
qa                          QA — view the BOL queue
└─ qa.verify                Verify BOLs
import                      Run TMS imports                            ⛓ matrix.book
admin                       Admin — view the module
├─ admin.registrations      Loadboard registration approvals + verification
├─ admin.chargebacks        Chargebacks tab (register + CSV)
│  └─ admin.chargebacks.decide  Decide chargebacks (confirm/dispute/recover/waive)
└─ admin.accesslog          View the loadboard access log
```

### Semantics
- **Defaults** (`defaultPerms(user)`) reproduce the v2.15.1 role behavior exactly:
  base views (matrix/hub/capacity/track) for everyone; booking suite + extras-lane creation (matrix.addLane, v2.17) for bookers;
  Integrity view = admin + pricing only (bookers get a **Carriers-tab-only** nav link via
  matrix.book; asset reps excluded); Integrity editing = pricing tier, **plus FedCom
  admins get integrity.trm + integrity.lanes** (never bands); Analytics view = admin-tier;
  chargeback DECISIONS = owner / pricing_manager / FedCom admins; QA = qa_manager + owner
  (deliberately NOT admins — approvers shouldn't verify their own work); night pin =
  hub.fields OR matrix.book.
- **Overrides**: per-user `permAllow`/`permDeny` arrays, owner-set via the **Permissions**
  button on Admin→Users (`components/PermissionsEditor.tsx`, tri-state Inherit/Allow/Deny,
  live effective ✓/✕, ● tuned dot, Reset to role default).
- **Closures** (the bundling logic): granting a key auto-grants its ancestors + `requires`
  (recursively); denying a key knocks out its whole subtree + everything that requires it.
  No combination can produce a broken half-capability.
- **Evaluation**: `effective = defaults + grantClosure(allow) − denyClosure(deny)`;
  deny beats allow beats default; **owner can never be denied**.
- **UI**: every view/nav/button gate calls `can(user, key)`. The capability helpers in
  `types.ts` (canAdmin/canBook/canEditLanes/…) remain ONLY as default-matrix inputs —
  **never gate UI with them directly again**.
- **Server**: `firestore.rules` mirrors everything via `hasPerm(p, roleDefault)` on every
  write gate. Loads update is branch-per-capability, including **standalone grants**
  (a tuned non-admin with hub.fields / hub.approve / admin.chargebacks.decide gets
  keys-only write paths) and **deny-guards on the admin full-write branch** (a denied
  capability binds even for admin-tier). Integrity writes split bands-vs-TRM by
  affectedKeys. permAllow/permDeny are writable ONLY via the owner branch.
- **Deliberately NOT in the tree**: role provisioning and permission editing themselves
  (not overridable), and Asset Rep's GH-Logistics-only lane scoping (intrinsic; no
  override widens it — checked in both UI and rules via `laneOpenToAsset`/`isGhCarrier`).
- **Caveat**: base-tab "view" permissions are nav/UX-level. Firestore reads stay
  company-wide — do not promise read isolation without reworking read rules.

---

## 5. Hard-won engineering rules — DO NOT REGRESS

1. **Field-level writes only** for load mutations: `updateDoc` + `arrayUnion`/`arrayRemove`.
   Whole-doc `setDoc` from client state resurrected deleted notes (stale-snapshot clobber).
2. **All date math is UTC-anchored string ops** (`T00:00:00Z`, getUTC*). Mixing local parse
   with `toISOString()` shifted days for UTC+ users (Manila). "Today" = `todayCentral()`
   (America/Chicago) everywhere. Windows Node IGNORES the TZ env var — emulate offsets to test.
3. **Wait for snapshot loads before create-if-absent writes** — deciding from a pre-load
   empty list demoted admins on refresh (v1.7.1).
4. Displayed times are 24h HH:MM via `cleanTimes()`. Time-token regexes must whitelist TZ
   tokens (`[CEMP]S?T`) — loose `[A-Z]{2,3}` matched "CI" from "CI TIME". App-standard
   timestamp is `fmtStamp()` ("7/9 22:41") — no AM/PM `toLocaleString` calls.
5. Firestore `batchWrite` rejects the same doc twice in one request — merge per-doc patches.
6. Sales Hub / Exposed window = 72h Central; carrier board = today + tomorrow ONLY.
7. Booked-pending-approval loads stay OFF the carrier board; night pin ≠ hide from board.
8. Hub tables must never clip text (Caleb screenshots them for carrier blasts) — fixed
   colgroup widths + generous min-width; the page scrolls sideways instead.
9. **Never compute a Firestore write from values captured inside a setState updater** —
   React defers updaters, so the write silently never persists (vanishing night pins,
   reappearing deleted notes). Compute from `loadsRef`/`offersRef` BEFORE setState.
   Also: `arrayRemove` needs an exact element match — remove array items by filtering the
   SERVER copy inside a transaction (see deleteHubNote).
10. **Cross-callback refs MUST be `useRef`** — a `{ current: x }` object literal in the
    component body is a new object every render; memoized callbacks capture the first
    render's object, freezing state and rebuilding from a stale base (v2.5.0).
11. Never use bare `#anchor` hrefs (HashRouter parses them as routes and bounces to Matrix).
12. Verify UI visibility with **computed styles**, not element counts (the invisible
    Integrity pencil reused an opacity-0 class; DOM-count "verification" missed it).
13. Python file edits: a truncate-open followed by a unicode encode error DESTROYS the
    file — encode to bytes first, then write (`open(p,'wb').write(s.encode('utf-8'))`).
14. LoadStop import: trip refs like `FA2D3_346_0704` — regex must NOT use trailing `\b`
    (underscore suffixes). Skipped rows get a report, never silent (non-Matrix freight
    like FedEx/LA Foods is expected there). TMS may migrate to Monarch → second profile.

---

## 6. Key source files

| File | What it is |
|---|---|
| `app/src/types.ts` | APP_VERSION, Role model + capability helpers (default-matrix inputs only), Load/Lane/Carrier types, STATUS_GROUPS, formatters (fmtMoney/fmtRateStr/cityDisplay), autoTeamSolo, normalizeCarrierName |
| `app/src/permissions.ts` | The 30-key permission catalog, closures, defaultPerms, effectivePerms, `can()` |
| `app/src/data/store.tsx` | All Firestore I/O + demo mode; field-level mutation helpers; setUserPermissions |
| `app/src/pricing.ts` | Band classifier + IntegrityRecord |
| `app/src/margin.ts` | §8.1 margin engine |
| `app/src/board.ts` | Sanitized loadboard mirror builder (incl. shuttle leg-2 swap-point posting) |
| `app/src/capacity.ts` | Demo-side empty-truck inference (functions port must stay in sync) |
| `app/src/dates.ts` | todayCentral, UTC string math, cleanTimes, fmtStamp |
| `app/src/actions.ts` | Action Center item derivation (live, role-scoped, no collection) |
| `app/src/components/` | LoadEditor, PermissionsEditor, StatusSelect, ActionCenter, SettingsMenu, TeamBadge, LaneEditor, LaneDetails |
| `app/src/views/` | MatrixView, SalesHubView, IntegrityView, CapacityView, TrackView, AnalyticsView, QAView, ImportView, AdminView, LoadboardPage |
| `firestore.rules` | Server enforcement of everything (roles + hasPerm overrides) |
| `functions/src/` | sendCarrierVerification, carrierVerify, capacitySnapshot (08:00 CT), rebuildCapacity |
| `tools/extract_seed.py` | ALPHA MATRIX 2026.xlsx → seed/ |
| `tools/parse_schedule.py` | Official FA2D3 HCR schedule PDF → seed/schedule.json (authoritative trip times) |
| `tools/sync_lanes.py`, `sync_loads_v14.py` | Prod migrations via REST + gcloud OAuth (bypass client rules through IAM) |
| `tools/migrate_pricing.py` | The gh-financial → integrity migration (rerunnable) |

---

## 7. Cross-machine protocol (IMPORTANT — learned the hard way)

Caleb works from a **desktop and a laptop**, each running its own Claude Code sessions
against the same GitHub repo. In July 2026 the two machines diverged badly: the desktop
built "v2.11.0" (permissions) while the laptop shipped an unrelated v2.11.0→v2.15.1 line.
The desktop's stale deploy briefly **rolled back production** (including partner-domain
rules — an outage for AJG users) before a manual rebase reconciled everything as v2.16.0.

Rules going forward:
1. **`git pull --rebase` at the START of every session**, and push at the end.
2. **Never deploy before pulling** — a deploy from a stale base rolls prod back.
3. Version numbers: check `git log origin/master` before picking the next one.
4. `CLAUDE.md` release notes travel with every commit — they are the cross-machine memory.
5. After any rebase touching `firestore.rules` or gate files, redeploy rules + hosting.

---

## 8. Current release state (v2.16.0, 2026-07-12)

Everything through v2.15.1 plus the granular permission system is **live and pushed**.
Recent release highlights (full detail in repo `CLAUDE.md`):

- **v2.21.1** — AJG sign-in restored: a stale single-domain `.env.local` on the
  desktop had silently excluded ajgtransport.com from every v2.16–v2.21 bundle.
  `firebase.ts` now hard-codes REQUIRED_DOMAINS as a floor (env can only add).
  STANDING RULE: removing ajgtransport.com access requires Caleb's express
  written consent; verify `grep -c ajgtransport app/dist/assets/*.js` ≥ 1 pre-deploy.
- **v2.21.0** — Zack triage: hub day-sections count "(N open · M total)" (covered-
  awaiting-approval excluded from open); repower = third shuttle type reusing the
  split-leg machinery (hub tags "⚠ REPOWER", board posts takeover leg from swap
  point); 'POWER ONLY - ONE WAY' equipment option added (trip 2000).
- **v2.20.0** — extras rows auto-scope to weeks holding their loads; lanes RETIRE
  (Lane.retiredOn — hidden next week forward, history untouched) instead of hard
  delete when they have loads; LoadEditor no longer closes on outside click; stale
  "Asset Truck" legend chip removed; Integrity Loading-default changes cascade into
  all future loads' equipment (rules: integrity.lanes may write equipment+history).
- **v2.19.0** — long-press a load cell (~500ms) to move it to an open day on the
  SAME lane (click or drag-release; pending offers block the move; history carries a
  "moved" entry; loads delete widened to bookers for this). Departure-day frequency
  anchor: `laneDepartsNextDay()` auto-detects after-midnight departures (PU 23:31 →
  departs 00:01) and shifts expected/MISSING? checks one day, with a LaneEditor
  override checkbox — fixes R1-style codes on late-night pickup lanes (trip 580).
- **v2.18.1** — currentUser spreads the full user doc; building it from scratch had
  dropped permAllow/permDeny, so per-user overrides never applied to the signed-in
  user's own UI (editor showed them; server honored them; nav didn't).
- **v2.18.0** — CRITICAL rules fix: Firestore rules cap evaluation at 1000
  expressions/request; the v2.16 helper nesting blew it on complex writes and
  read as permission denials — helpers flattened, `tools/test_rules.py` (21-case
  suite vs the firebaserules :test API) must pass before every rules deploy.
  Plus: 5-second permission-denial toast (bottom-right, names the required key);
  dedicated-row removal (pricing + FedCom); chargeback register search;
  "No Chargeback" class is admin-tier only (UI + rules); CB strip anchors to the
  cell bottom; FedCom admins provision up to Admin/Asset Admin (never pricing,
  never the FedCom tag); Integrity surfaces Matrix lanes missing an Integrity
  record with a create-stub button (the "trip 6" drift can't recur silently).
- **v2.17.0** — Matrix opens on the CURRENT week (Saturday-midnight-CT changeover);
  rate REQUIRED in the Rate box to save a load covered-or-better (non-GH; GH
  pass-throughs exempt); load/offer/note write failures now alert with the server's
  rejection reason (never silently snap back); brokers get "+ Add lane" for extras
  sections (new `matrix.addLane` permission; rules bar booker lane-creates in the
  main FA2D3 Schedule section); Integrity ✎ Edit lane button on its own line.
- **v2.16.0** — granular per-user permissions (§4 above).
- **v2.15.1** — ajgtransport.com back-office logins; PARTNER pill on Admin Users.
- **v2.15.0** — Zack batch: chargeback ✎ corrections + 🗑 void ("logged in error"),
  waive falls off the Matrix completely, decider permissions, DNU carriers (hard block),
  restrictedDrivers, dedicated LC column, SOFT BOOK (yellow hub row, "shopping cheaper"),
  Capacity LS# column, Analytics LC column.
- **v2.14.x** — Action Center (live role-scoped data-health items + Fix→ deep links),
  need_flyer status, color-dot status dropdowns, ☰ settings menu, capacity 12-hour freshness.
- **v2.13.0** — FedCom parity (TRM inline edit, Add lane from Integrity, KPI goal hints).
- **v2.12.x** — broker-POV audit fixes, hub city-grouped site headers, T&T buckets +
  owner mass-clear, band-target ghost in hub Rate column, fmtStamp everywhere.
- **v2.11.x (laptop)** — Cover Report REMOVED, admin-gated Integrity/Analytics, visible
  band editing, mobile bottom tab bar, loading-option colors + per-route default,
  chargeback persistence + waive, Integrity owns lane editing, brand-as-home,
  night pin for broker reps.

---

## 9. Known gotchas / operational notes

- `firebase deploy --only functions` discovery can flake on Node 24 (local OOM/timeout) —
  retry with `NODE_OPTIONS=--max-old-space-size=6144 FUNCTIONS_DISCOVERY_TIMEOUT=120`.
- Demo data is noisy for Action Center counts (seed predates the rate field) and has NO
  dedicated seed rows (the Dedicated tab renders empty in demo — not a bug).
- TMS imports write carrier+bookingApproved together (the "pre-approved tender" rules
  pattern) and carry no approval stamp on purpose (would flood "Cleared today").
- The carriers collection is booker-creatable by design (brokers add carriers mid-booking).
- Carrier-facing surfaces must NEVER say "Bravo Matrix" (index.html ships the neutral
  "GHL Loadboard" title; the back office renames itself at runtime). Never re-add a
  total-trips counter to the board (carriers used open-load counts as rate leverage).
- `lane-048` "MEMPHIS MPA OUTBOUND" group header was hard-deleted from prod + seed.
- **Firestore rules evaluate at most 1000 expressions per request.** Keep rules
  helpers flat (no isCompanyUser inside helpers — once per allow statement), and run
  `python tools/test_rules.py` before every rules deploy. Exceeding the budget
  surfaces as "Missing or insufficient permissions" for permitted users (v2.18.0).
- Load/offer/note writes surface server rejections via `writeFailed()` in store.tsx
  (v2.17.0) — permission rejections show a 5s bottom-right toast naming the required
  permission; never add a silent `.catch(() => {})` on a user-facing write; optimistic
  local state plus a swallowed rules rejection reads as "it won't save." 
- A load cannot be saved covered-or-better without a rate in the Rate box
  (RATE_REQUIRED_STATUSES in LoadEditor; GH = pass-through, exempt). Client-side only.
- "Master Dispatch - DB/" in the project folder is a SEPARATE project — gitignored;
  never commit it to bravo-matrix (use targeted `git add`, not `git add -A`, when
  untracked folders are present).
- 'LIVE/LIVE' equipment retired; "(legacy)" fallback option renders any straggler value.

## 10. Pending / next up / backlog

**Awaiting Caleb:**
- FMCSA/MC validation at registration — needs a free webKey from mobile.fmcsa.dot.gov/QCDevsite (Caleb to register).
- Pricing Console (Netlify) decommission — after validation period with Shay.
- "Expired/inactive trips" hiding rule — Caleb will define (NOT simply past-PU-time).
- Zack items declined/parked: LC Cover Count restore, Trailer Return tab (separate
  project later), Zack's asset color scheme (Caleb's palette stands), AJG Hedge (needs detail).
- Clarifications parked from v2.7: Dedicated Send-to-Carrier dropdown / LS#-recognition
  idea; "TRIP 2000 reflects PO-ONE WAY".

**Roadmap candidates:**
- Track-and-Trace ROLE + QA role wiring into Action Center (T&T overdue, BOL queue items
  are parked until Caleb creates the roles).
- Status manager UI (statuses are code-side in DEFAULT_STATUSES).
- Per-carrier history / carrier admin page.
- Saved quick filters on Sales Hub; default landing page + notification prefs under ☰;
  someday email digest; Samsara ETA layer for the truck-conflict guard.
- True read isolation for view permissions (if ever promised, read rules must be reworked).

## 11. Style & working conventions

- Caleb wants crisp, minimal, Apple-like UI; light/dark + 5 accent palettes; GH logo at
  `app/public/logo.png`; version badge in topbar — **bump `APP_VERSION` in types.ts on
  every release** and add a release note to `CLAUDE.md`.
- Verify in demo mode (role-POV via `?role=`) before deploying; verify visibility with
  computed styles; test permission changes both in UI and against rules.
- Ask before inventing data fields (e.g., the PARTNER pill deliberately infers from the
  sign-in domain rather than adding a field).
- When something is ambiguous, present options + a recommendation; Caleb decides fast.

## 12. Glossary

| Term | Meaning |
|---|---|
| HCR / FA2D3 | USPS Highway Contract Route / the main contract's schedule designation |
| Trip # / tripCode | USPS trip identifier on a lane (e.g. FA2D3-346) |
| LS# | LoadStop TMS load number (`loadNumber`); asset second leg uses "primary / assetLS" |
| TRM | The revenue master file (rates USPS pays) — uploaded to Integrity |
| Bands | Internal target/ceiling buy rates per lane per day-type |
| Exposed | Load with no carrier — red, appears on Sales Hub |
| Dedicated | Lane pre-committed to a carrier on set weekdays |
| Chargeback | USPS penalty when a load falls off; classes once_recovered/none; decisions confirmed/disputed/recovered/waived |
| TONU | Truck Ordered Not Used — billable to USPS if cancelled < 4 hours |
| Shuttle | Two-leg move (meet-swap or yard-stage); legs status independently |
| FedCom | "Federal Committee" tag on an Admin — unlocks TRM/lane edits, chargeback decisions, rep goals |
| FCC | The chargeback-decision group (owner + Tucker/PM + FedCom) |
| DNU | Do-not-use carrier — hard booking block |
| Soft book | Booked but pricey — still shopping cheaper (yellow hub row) |
| Night pin | Keeps a load on the hub overnight for the night shift |
| GTG | Good-to-go QA status (post-RC-signed, pre-departure) |
| Highway | The carrier-identity service the verification email flow mimics |
