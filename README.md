# Bravo Matrix — project context for Claude Code

Freight coverage board for GH Logistics (USPS contract freight broker). Replaces the
"Alpha Matrix" Google Sheet where 30–50 people manually keyed loads into weekly tabs.
Owner: Caleb Paul (caleb@ghlogisticsllc.com).

## Live system

- **App**: https://bravo-matrix-gh.web.app (Firebase project `bravo-matrix-gh`, Blaze plan,
  billing acct 0158C4-158262-BDFFC5). NOTE: a `gh-financial` project also exists in this
  account — it is NOT this app; never point .firebaserc/deploys at it.
- **Carrier loadboard**: https://ghl-loadboard.web.app (Hosting multisite target `loadboard`,
  same build — App.tsx switches to board-only, carrier-branded "GHL Loadboard" mode by
  hostname; domain is in the Auth authorized-domains list). `#/board` on the main host
  still works. Carriers must never see "Bravo Matrix" (index.html ships the neutral title).
- **Repo**: https://github.com/cdpmoney23/bravo-matrix (private)
- Deploy: `cd app && npm run build` then `firebase deploy --only hosting[,firestore:rules,functions]` from root
- **Cloud Functions** (`functions/`, TypeScript, Node 20, us-central1): carrier verification
  emails via Gmail SMTP from caleb@ghlogisticsllc.com. Secret `GMAIL_APP_PASSWORD` (Google
  app password) set via `firebase functions:secrets:set GMAIL_APP_PASSWORD`; sender override
  via `GMAIL_USER` param.
- Local dev: `cd app && npm run dev` → DEMO MODE (bundled seed data; `.env.development.local`
  blanks the Firebase config; production values live in gitignored `app/.env.local` —
  recreate via `firebase apps:sdkconfig web --project bravo-matrix-gh`)

## Domain model (Firestore)

- `lanes` — ~190 routes; 3-row clusters in the old sheet. Fields: origin/destination/via,
  tripCode (FA2D3-XXX etc.), tripLabel (Trip A/B), section (FA2D3 Schedule / UMT Global /
  Overflow / USPS FA), times, weekendRate/weekdayRate, dedicated{Carrier,Rate,Notes},
  isGroupHeader (one-row dividers like "AUSTIN OUTBOUND" — no loads, kept for stable IDs)
- `loads` — id = `${laneId}_${YYYY-MM-DD}` (weeks are just views; no weekly tabs).
  loadNumber (immutable once set; asset LS suffix "123456 / 654321" allowed), carrier
  ('' = exposed), rateNotes (free text incl. drivers), status (exposed/dedicated_pending/
  covered/booked_rc_pending/rc_signed/dispatched/asset[GH only]/chargeback/not_running
  [requires cancelReason]), postedRate/equipment/teamSolo/hubNotes+hubNoteLog (append-only),
  truckNumber (GH only, same-day double-book guard), bookedBy/bookingApproved (admin
  approval clears Sales Hub), pinnedNight, hideFromBoard, history[]
- `carriers` — name + mcNumber
- `users` — Phase 2 role model (v2.0.0): owner / pricing_manager / asset_admin / admin
  (+ optional `fedCom` bool tag, owner-set, admin-role only) / pricing_rep / broker_rep /
  asset_rep / base. Self-registration lands at `base` (read-only). Capability helpers live
  in types.ts (canAdmin=admin-tier ops incl. PricingMgr+AssetAdmin, canBook=+broker_rep,
  canEditLanes=pricing tier ONLY — plain Admin does NOT edit lanes/bands,
  canEditHubFields=admin-tier only, creatableRoles=provisioning matrix:
  owner→all incl. FedCom; pricing_manager→pricing_rep/broker_rep; admin→broker_rep;
  asset_admin→asset_rep). Asset Rep scope: GH Logistics carrier only, on GHL-dedicated OR
  open lanes (assetLaneAllowed). firestore.rules enforce ALL of this server-side (roles
  read from users/{uid}; broker load-writes restricted to booking keys; bookingApproved=true
  needs admin unless written alongside carrier — the TMS-import pattern). Legacy role
  'user' == broker_rep (migrated 2026-07-06; normalizeRole guards stragglers).
- `loadboard` — SANITIZED mirror for carriers (no load#/trip#/targets/notes); synced on every
  load mutation + reconcile on admin session start + manual Rebuild
- `offers` — carrier offers (pending/accepted/countered/denied); accept books under carrier
  NAME resolved by MC; booking auto-denies other pending offers
- `carrierUsers` — loadboard registrations (company/MC/email), gate offer creation via rules;
  verified via emailed Highway-contact link (or manual Approve/Reject fallback); `verification`
  subfield (contactEmail/sentAt/status) is written ONLY by Cloud Functions
- `verificationRequests` — one per "Send verification" click on the Admin page; creating one
  triggers the `sendCarrierVerification` function (email w/ single-use token link, sha256 hash
  stored, 7-day expiry); `carrierVerify` HTTPS function handles the approve/deny POST. The GET
  renders a confirm page only — mail scanners prefetch links, so never act on the GET. The link
  can never override a manual admin decision (transaction checks carrierUser still pending).

## Hard-won rules — do not regress

1. **Field-level writes only** for load mutations: `updateDoc` + `arrayUnion`/`arrayRemove`.
   Whole-doc `setDoc` from client state resurrected deleted notes (stale-snapshot clobber).
2. **All date math is UTC-anchored string ops** (`T00:00:00Z`, getUTC*). Mixing local parse
   with `toISOString()` shifted days for UTC+ users (Manila). "Today" = `todayCentral()`
   (America/Chicago) everywhere. Windows Node IGNORES the TZ env var — emulate offsets to test.
3. **Wait for snapshot loads before create-if-absent writes** — the users registration
   effect demoted admins on refresh by deciding from a pre-load empty list (v1.7.1 fix).
4. All displayed times are 24h HH:MM via `cleanTimes()` (strips AM/PM + TZ tokens; assumes
   pickup-local). Time-token regexes must whitelist TZ tokens (`[CEMP]S?T`) — loose
   `[A-Z]{2,3}` matched "CI" from "CI TIME".
5. Firestore `batchWrite` rejects the same doc twice in one request — merge per-doc patches.
6. Sales Hub / Exposed window = 72h Central; carrier board = today + tomorrow ONLY.
7. Booked-pending-approval loads stay OFF the carrier board; night pin ≠ hide from board.
8. Hub tables must never clip text (Caleb screenshots them for carrier blasts) —
   fixed colgroup widths + generous min-width; page scrolls sideways instead.
9c. **NEVER remove ajgtransport.com sign-in access — Caleb's express written
   consent required** (Caleb 07/13). firebase.ts REQUIRED_DOMAINS is a floor
   the env can only ADD to (a stale single-domain .env.local silently locked
   AJG out of every v2.16–v2.21 desktop build). Before ANY hosting deploy:
   `grep -c ajgtransport app/dist/assets/*.js` must be ≥ 1.
9b. **Firestore rules evaluate at most 1000 EXPRESSIONS per request** — deep
   helper nesting (isCompanyUser inside every isX, udata() re-evaluated per
   call) blows the budget on complex writes and surfaces as "Missing or
   insufficient permissions" for perfectly-permitted users (v2.18.0 fix).
   Keep helpers flat, assert isCompanyUser once per allow statement, and run
   `python tools/test_rules.py` (Rules :test API, 21 cases) before EVERY
   rules deploy.
9a. **Cross-callback refs MUST be `useRef`.** A `{ current: x }` object literal
   in the component body is a NEW object every render, but memoized callbacks
   capture the FIRST render's object — freezing the state they read at its
   initial value. updateLoad then rebuilt loads from a stale base, silently
   reverting prior local edits (v2.5.0 fix; prod was masked by the Firestore
   listener echoing correct state, but history diffs/derived fields were wrong).
9. **Never compute a Firestore write from values captured inside a setState
   updater.** React defers updaters when other updates are queued (snapshots,
   rapid clicks), so the captured variable is still undefined when the write
   runs — the mutation silently never persists. This is what made night pins
   vanish and deleted notes reappear (v1.9.0 fix). Compute from `loadsRef`/
   `offersRef` BEFORE setState; keep writes field-level. Also: `arrayRemove`
   needs an exact element match — remove array items by filtering the SERVER
   copy inside a transaction instead (see deleteHubNote).

## Source of truth files

- `tools/extract_seed.py` — parses ALPHA MATRIX 2026.xlsx (in Caleb's Downloads) → seed/;
  group headers = col-A label immediately followed by another col-A label
- `tools/parse_schedule.py` — official FA2D3 HCR schedule PDF → seed/schedule.json
  (authoritative trip times; used for audit + lane time backfill)
- `tools/sync_lanes.py` / `sync_loads_v14.py` — prod migrations via REST + gcloud OAuth
  (bypasses client rules through IAM)
- LoadStop import: trip refs like `FA2D3_346_0704` live in PO Number / Pickup-ref columns;
  regex must NOT use trailing `\b` (underscore suffixes). TMS may migrate to Monarch —
  importer will need a second profile.

## Pending / next up

- **Carrier dedupe MERGE executed (2026-07-18, same day as v2.33.1)** —
  Caleb's rule: canonical = the OFFICIAL name (LoadStop/registry record
  preferred, else the MC-bearing record, else most formal), final names
  UPPERCASED. 114 clusters merged: 115 duplicate carrier docs DELETED,
  630 loads renamed (carrier/shuttleCarrier/chargebackCarrier), 23 dedicated
  rows renamed, 3 canonical docs cleaned up (case/backfill); data folded
  into survivors (dnu/issue/notes/contacts kept). Post-scan: 0 same-MC and
  0 same-name clusters across 3,682 carriers. Audit trail:
  carrier-merge-log.csv (repo root). Duplicate PREVENTION (v2.8.1
  normalizeCarrierName + near-match hints) remains the ongoing guard.
- **v2.33.1 (2026-07-18)** — LOADSTOP CARRIER IMPORT (one-time, Caleb-launched)
  + Carrier.phone field. Nine LoadStop export pages (3,506 unique after MC
  dedupe; full A–Z) → 3,364 NEW carriers created (id carrier-ls-<MC>; name/
  mcNumber/dot/email/phone), 77 existing enriched FILL-ONLY (MC/DOT/phone/
  email backfilled where blank — the MC cross-check now works for them),
  64 same-MC variants skipped, 4 "(Non-RMIS DNB)" carriers seeded with
  dnu=true + prefix stripped (Cargoprime, Crescent Cargo, JRD, Suraiya).
  City/state deliberately NOT imported (Caleb). Carrier DB now 3,797.
  Phone = new Carrier field + editable column on Integrity→Carriers.
  DUPE SCAN (post-import): 4 same-MC clusters (all PRE-existing: Atlas Team/
  ATLAS, POP AND SONS/POP & SONS, cargo freight llc/CARGO FREIGHT, g glov/
  G-Glove) + 111 same-name clusters, mostly "free-text booking name w/o MC"
  vs "formal record w/ MC" (Shon Express/SHON EXPRESS INC, ABA CARRIERS,
  WRNR/WRNR LLC…). Report: scratchpad carrier_dupes.json. MERGING requires
  renaming loads.carrier/shuttleCarrier + dedicated.carrier onto the
  canonical (what the removed v2.8 merge module did) — awaiting Caleb's call.
- **v2.33.0 (2026-07-18)** — hub.board: loadboard hide/show (👁/🚫) split out
  of hub.fields into its OWN permission key (Caleb: FedCom has it + assignable
  per person). Default = admin-tier (incl. FedCom — nobody lost anything);
  grantable/deniable individually via the Permissions button and per-role via
  Role scopes. hub.fields label loses "board visibility". Rules:
  hideFromBoard removed from hubFieldKeysOnly → new boardKeysOnly standalone
  branch (hasPerm('hub.board', false)); adminDeniesOk checks
  denyP('hub.board') for hideFromBoard. Suite 37/37 incl. FedCom-allow /
  broker-deny / tuned-broker-allow / admin-denied-deny.
- **v2.32.4 (2026-07-18)** — density rollout part two (Caleb). T&T's two work
  tables adopt `table-dense` (was custom CSS — one recipe now). SALES HUB
  DENSE, rule-8-safe: 2px/6px + 11.5px on cells, flattened buttons/selects/
  inputs, note-log capped at 64px w/ 10.5px lines, offer cards compacted,
  hub banners slimmed — but Lane/Notes KEEP WRAPPING (hub text is never
  clipped; Caleb screenshots it). Verification caught two rule-8 regressions
  the dense pass would have shipped: the equipment select was 10px clipped
  (w-equip back to 245 + select min-width 0 at the smaller font) and the
  auto-width NOTES column collapsed to 0px on narrow screens — now a
  guaranteed 200px (.w-hubnotes) with hub min-width 1430 (page scrolls
  sideways below that, per rule 8). INTEGRITY rates table matched to the
  exact recipe (2px/6px + flat controls). Verified: hub rows 45px, ZERO
  clipped cells, table 1430px w/ working sideways scroll at a 1280 viewport.
- **v2.32.3 (2026-07-18)** — .table-dense: the Trailers-tab density recipe
  (Caleb: "I like it — replicate it") codified as ONE utility class:
  2px/6px cell padding · 11.5px @ 1.3 line-height · hard single-line
  (nowrap; .wrap cells ellipsize at 260px) · flattened controls (buttons/
  selects/checkboxes stripped of vertical padding — the hidden row-height
  drivers). Applied to 18 tables across Admin (users/regs/chargebacks/access
  log), Analytics (all 4), Capacity (both), Dedicated (both), Import (both),
  Integrity→Carriers, QA (both), T&T Facilities. trailers/track/integrity/
  hub/scopes tables keep their tuned styles. Any future table: add
  `table-dense` next to `list-table`. Verified: QA rows 21px.
- **v2.32.2 (2026-07-18)** — SOFT BOOK CLIPPING ROOT-CAUSED (Caleb: couldn't
  scroll OR zoom to it). It was never off-page: the hub's toggle column
  (.w-pin) was still 40px from the lone-checkbox era, and .list-table's
  table-layout:fixed + overflow:hidden CLIP anything wider than its column —
  unreachable by scrolling by definition. Fix: .hub-table .w-pin 100px
  (equip 235 / target 130 give the room back). VERIFIED with a real hub row
  at a 1280px viewport: table right edge 1269px (fits), all three toggles
  fully visible. Demo-testing note: hub rows require an LS# — isExposed()
  deliberately needs loadNumber (pre-EDI placeholders stay off the hub), so
  a demo repro must set a load # before saving. Also: the first nav .badge
  is NOT necessarily Sales Hub's (badges only render when nonzero).
- **v2.32.1 (2026-07-18)** — Caleb's follow-up fixes on the app-walk batch.
  GTG chip moved to the Broker/General row; "Asset tags:" → "Asset:".
  HUB FITS ON SCREEN: .hub-table min-width 1560→1240 + .w-lane 320→265 —
  the width floor was pushing the toggles column past the viewport; the
  three toggles are now tiny stacked mini-buttons (emoji over 8.5px label).
  INTEGRITY STICKY FIXED (two causes): the table needed its OWN scroll
  container (.integrity-scroll, max-height calc(100vh−250px)) — inside the
  page-level scroller the header just rode along; AND .list-table's
  overflow:hidden on the table itself kills position:sticky (ANY non-visible
  overflow between the sticky el and its scroll container does) —
  .integrity-table { overflow: visible }. LESSON for any future sticky
  header: dedicated scroll wrapper + overflow:visible on the table.
  T&T DENSITY: buttons/checkboxes/selects were the row-height drivers, not
  padding — td 1px/6px + button padding 0 5px line-height 1.5 min-height 0 +
  checkbox margin 0 + select 0 4px. ROLE SCOPES: capability column fixed at
  470px (was wrapping 3-4 lines). Verified: sticky pins at scrollTop 500,
  capability col measures 470px, GTG on row 1. T&T/hub row height need
  Caleb's eyes on PROD (demo hub/track are empty this week — seed ends 07/12).
- **v2.32.0 (2026-07-18)** — Caleb's full app-walk batch (15 notes, 3 answers).
  QA GLOW: MISSING? cells pulse red w/ "REQUIRES QA REVIEW ASAP"; cancelled
  cells (not_running/omitted) ALSO glow when they carry an LS# but NO cancel
  reason (tendered + undocumented cancel = possible error; reason already
  shows in the cell). FREQUENCY DICTIONARY (types.freqSpec/freqCodeOf/
  freqDescription/freqDisplay): USPS code families — R/L/Q+digits = daily
  except those days + days-after-holidays; X+digits = daily except days;
  digits+X = only those days except holidays; bare digits = only those days;
  digits 1=Mon…7=Sun; OO2 special-cased. Matrix pill now ALWAYS "Freq CODE"
  w/ hover description; ⓘ shows the dictionary text; runsOn() is
  dictionary-first (INTEGRITY trm.freqCode wins when the trip has a record —
  the seeding Caleb wanted) with the legacy free-text parser as fallback for
  unknown codes. CHIP ROWS: "Broker / General:" row + "Asset tags:" row
  (assets = Assets+Q/A groups incl. departed) + "Jump to:" tag row —
  Coppell/Irving/SATX/ATX/Memphis/Columbia/Tampa/Inbound TX jump to header
  rows (data-jump attr), Extras/FA jump to their section titles. SIX NEW
  HEADER ROWS created in prod (Caleb-authorized, placed by current order,
  draggable like any header): COPPELL OUTBOUND, IRVING OUTBOUND, SAN ANTONIO
  (SATX) OUTBOUND, INBOUND TX (before Memphis→Dallas), COLUMBIA OUTBOUND +
  TAMPA OUTBOUND (both in FA2D3 MISC). WEEK DROPDOWN: current week = "● …
  — current". CROSS-WEEK SEARCH: searching an LS# not in the visible window
  flips to that load's week (exact match preferred, else most recent);
  clearing the search RESTORES the pre-search week. HUB: cell padding halved
  (4px/8px + line-height 1.3); the three row toggles are now LABELED (🌙
  Night / 🟡 Soft / 👁 On board–🚫 Off board buttons) — Caleb couldn't find
  soft book and the eye read as decoration; site rows get an accent-tinted
  background + left bar. INTEGRITY: sticky column header (top:0), 3px/8px
  density, Loading select min-width 250 (unclipped); rows were ALREADY
  sorted by contract + numeric trip # (laptop line). FEV MYSTERY SOLVED:
  FEV* integrity docs (16: FEV01, FEV12…) are freight-auction rows the TRM
  master upload auto-created (updatedBy shay.n) — parseTrmFile now SKIPS
  ^FEV Trip_IDs; the 16 existing docs still await Caleb's explicit delete
  go-ahead (integrity delete rule is false — needs REST). T&T density =
  trailers-table treatment (2px/6px, 11.5px, nowrap+ellipsis). ADMIN: user
  groups are COLLAPSED sections (click head to expand, ▸/▾) + name/email
  search (search auto-expands); groups now include qa_rep/trailer_manager/
  trailer_rep (they were INVISIBLE — filter lists predated the roles).
  ROLE SCOPES → EDITABLE (owner-only): settings/roleDefaults stores the
  effective key list per role ('admin_fedcom' for FedCom admins);
  permissions.ts setRoleMatrix registry consulted by defaultPerms;
  grant/deny closures on every toggle so no half-capabilities; OWNER column
  immutable (defaultPerms never consults the matrix for owner — the owner
  cannot downgrade himself; saveRoleDefaults strips any owner key);
  "Reset all roles to defaults" button; store re-renders gates live
  (currentUser memo deps include roleMatrix); rules: settings/roleDefaults
  writable by OWNER ONLY. CAVEAT (stated to Caleb): matrix edits bind every
  UI instantly, but firestore.rules still enforce the shipped baseline +
  per-user overrides — server-side matrix enforcement is the deliberate
  follow-up (expression-budget-sensitive layer). Suite 29/29. Demo hub is
  empty this week (seed ends 07/12) so hub toggles verified by build only.
- **v2.31.0 (2026-07-17)** — GH Logistics royal-blue pill in Matrix cells (Caleb):
  ghCarrier() renderer in MatrixView pills the literal "GH Logistics" (.gh-pill
  #1e3a8a/white) wherever it shows — plain covered, "CB: GH Logistics", both
  shuttle legs; all other carrier text keeps the search-highlight <Hi>. Only GH
  gets name styling. Verified 11 cells, non-GH untouched.
- **v2.30.0 (2026-07-17)** — ops batch (Caleb, 7 items).
  1) BOARD DARK-ON-DARK: .board-detail-row td + .board-detail now pin BOTH bg
  (--panel-2) AND text (--text) from the same theme context — a forced-dark
  browser can't leave mismatched colors (was: bg set, text inherited).
  2) PERMISSION DELEGATION: the Permissions editor button opens for anyone who
  can PROVISION the target (mayProvision), not just owner; PermissionsEditor
  gates each Allow option by grantablePerms(currentUser) — non-owners can only
  grant capabilities THEY hold ("Allow (above your level)" disabled otherwise);
  rules widened so FedCom + pricing_mgr/admin/asset_admin provisioning branches
  may write permAllow/permDeny alongside role (subset-of-own enforced UI+store;
  kept rules lean per the v2.18 expression-budget outage lesson).
  3) ROLE SCOPES reference: 📖 button on Users tab → RoleScopes modal, live
  matrix of defaultPerms × all 12 roles (FedCom toggle) — read-only, computed so
  it can't drift. 4) ANALYTICS LOCKDOWN: pulled analytics/analytics.settings out
  of the generic canAdmin block → now owner + pricing_manager + FedCom admins
  ONLY (plain/asset admins lost it; unvetted $$$). 5) IMPORT → ☰ menu (dropped
  the nav tab; route kept; SettingsMenu 'Import loads' navigates, gated can
  import). 6/7) COMPACT ROWS: .list-table.track-table + .list-table.admin-users
  padded 3px 8px / 12px (compound selector beats the !important group-subhead
  pad); admin-users max-width removed. Version 2.26→2.30 (jumped past the other
  machine's 2.27/2.28 Rate Check + trailer-billing releases, all merged).
- **v2.29.0 (2026-07-17)** — RATE CONFIRMATION MODULE (Caleb's rate-con idea;
  template = LoadConfirmationPdfV2, rendered verbatim incl. all 11 USPS
  requirement sections + trailer fine schedule). Mirrors the carrier-verify
  architecture. functions/src/ratecon.ts: **sendRateCon** (onCall — server
  perm check: owner/pricing_manager/FedCom/permAllow matrix.ratecon; snapshots
  the load incl. carrier MC/DOT from the DB + facility addresses from the
  directory; voids prior active RC; emails a single-use hashed-token link from
  freight@ via Gmail SMTP, reply-to the booking rep); **rateConPage** (onRequest
  GET renders the full doc + sign form — driver1/phone1 always, driver2/phone2
  REQUIRED when teamSolo=TEAM, print name, typed-signature, E-SIGN consent;
  POST transaction-signs, flows back onto the load: status→rc_signed, driver
  fields recorded, executed copies emailed to carrier + cc rep); **rateConCancelWatch**
  (onDocumentUpdated — carrier REMOVED while an RC was sent/signed → auto-cancel
  the rateCons + email the carrier a cancellation). Load mirror fields rcStatus/
  rcSentAt/rcSignedAt/rcEmail/rcDriver1-2/rcPhone1-2. LoadEditor RC panel (booked
  loads, matrix.ratecon only): status line + Send/Resend; save() prompts a resend
  when rate/load# change on a load with an active RC. Carrier.email column
  (Integrity→Carriers) + Facility.address column (T&T→Facilities) feed the RC.
  Rules: rateCons read=company/write=false (functions only); matrix.ratecon perm
  key. Trailer fines UPGRADED to the real schedule (trailers.ts trailerFine):
  days 1-3 late $50/day then $300/day — note this LANDED IN v2.27/2.28 on the
  other machine (fineFor/tiered) which I built ON TOP of after rebase; kept
  theirs. CAPACITY ANSWER for Caleb: DB/storage trivial (~$0.20/mo even storing
  PDFs); email deliverability is the weak link → recommended Resend/SendGrid +
  SPF/DKIM as Phase 2; the real scaling item is date-windowing the loads
  subscription (~50-70k docs at a year) — backlog. TEST-DAY: HashRouter hangs
  the browser-eval harness on in-eval location.hash writes — navigate() instead.
- **v2.28.0 (2026-07-17)** — Loadout batch two (Caleb's answers + formatting).
  WEEKLY BILL & RESET (the billing concept): "⚖ Bill fines & reset" on
  /trailers (trailers.approve) stamps trailerBilledDays/trailerBilledAt on
  every open trailer with an outstanding fine and downloads a CSV of the run
  for accounting (charge against carrier payables). OUTSTANDING fine =
  fineFor(lateDays) − fineFor(billedDays) — the sheet's exact P-column credit
  math; accrual restarts from the billed watermark so fines never stack to
  $20k. Dash card + header now read "outstanding". CLOCK ANCHOR: left at
  UNLOAD per Caleb ("leave my version be"). EXEMPTION LIST: live in
  settings/trailers.exemptions ({carrier, dest} pairs; seeded with the
  sheet's 12: Ocean Freight/Star, ABA, Dinkins, Coach Freight, First Geer,
  WRNR, MMH pairs); token-AND destination match + normalized-carrier
  substring; exempt trailers track but fine $0 ("exempt" in the Fine col);
  manager UI (add/🗑, approve tier); PER-TRAILER OVERRIDE
  Load.trailerFineOverride via "Charge fines anyway" in the detail modal.
  FORMATTING: narrower Trailer#/LS#/PU/Days-left/Fine cols (t-num/t-sm);
  NEW NOTES COLUMN at the end (Load.trailerNotes, inline edit for
  trailers.mark, searchable); ROW CLICK → DETAIL MODAL (.trailer-detail:
  dates, free days, fine accrued/billed/outstanding, exemption + override,
  journey chain, notes textarea, Matrix link — action cells stopPropagation);
  "✓ Returned" → "Mark returned?"; .pencil-gap 7px between value and ✎;
  RETURN-SITE ✎ = DROPDOWN (San Antonio TX / Dallas TX / Memphis TN /
  Columbia SC / Other→prompt / ↩ origin default); RETURN-SITE FILTER select;
  sort = open first, HIGHEST OUTSTANDING FINE desc, then most-late.
  Rules: bookerKeys + mark branch += trailerNotes; approve branch +=
  trailerBilledDays/At + trailerFineOverride (+notes). Suite 29/29.
  Verified in demo end-to-end incl. a full billing run ($1,050 → $0
  outstanding, watermark stamped).
- **v2.27.0 (2026-07-17)** — Loadout batch (Caleb, from Loadout Trailer
  Dashboard V3.xlsx). TIERED FINES replace the flat $100/day placeholder:
  fine(late) = min(tierDays, late)×tier1 + max(0, late−tierDays)×tier2,
  defaults 3d @ $50 then $300/day — the sheet's L-column formula verbatim
  (settings/trailers now {tierDays, tier1PerDay, tier2PerDay}; legacy
  finePerDay docs merge harmlessly; the /trailers fine editor is three
  inline inputs, trailers.approve). Days O/D was ALREADY the sheet's
  K-formula (returned → max(0, return−deadline), open → today−deadline) —
  no change needed. L.O.T CELL TAG: Matrix cells with a trailerNumber wear
  a small "L.O.T Trailer #xyz" chip (.lot-tag, steel blue, both cell
  branches, above the CB strip). LOADEDITOR FREE-DAYS: the trailer fieldset
  gains a 3/5/7 select — default option reads "Default — N days (from
  Loading/TRM)" via baseFreeDays/effectiveEquipment; picking 3/5/7 writes
  trailerFreeDays (now number|null — null clears the override back to
  default; trailerFreeDays was already in bookerKeys, no rules change).
  TRAILERS TABLE DENSITY: 2px/6px padding, 11.5px, nowrap everywhere incl.
  .wrap cells (ellipsis at 260px; page scrolls sideways — rule 8).
  VERIFIED in demo: tag renders, select defaults to 5 (PO 5-day lane),
  6-late trailer shows $1,050 = 3×50+3×300 exact. OPEN QUESTIONS for Caleb
  (sheet features NOT ported yet): Days Billed credit (sheet col P nets
  invoiced days out of the fine — needs a billing field + flow in Bravo),
  clock anchor (sheet starts at PICKUP+LOT days; Bravo starts at UNLOAD per
  Caleb's v2.25 call — kept UNLOAD), NTR status / Exemption List / One-Way
  column (sheet concepts with no Bravo equivalent yet).
- **v2.26.1 (2026-07-16)** — Rate Check follow-ups after Caleb's smoke test.
  BENCHMARK CONFIRMED: the $2,184.63 Memphis→Mobile flip point is CORRECT —
  mean all_in across ALL live trips on the pair (309/353 @ $2,338.30 + cheap
  585 @ $1,877.30); Caleb: keep the average, "that's the way it's supposed to
  work with the billing side". UPLOAD PERMS: ratecheck.upload default widened
  owner → owner + pricing_manager (Caleb; UI hides the card for everyone
  else AND the callable's uploadTier enforces it server-side).
  BOM HOTFIX (same day): Branch B (no-lane Google-miles fallback) returned
  "couldn't price" for every unknown lane — the GOOGLE_MAPS_KEY secret copy
  via a PowerShell pipe prepended a UTF-8 BOM (﻿), and fetch() rejects
  header values > 0xFF ("Cannot convert argument to a ByteString"). FIX:
  clean secret version 2 written byte-exact via python (BOM'd v1 destroyed),
  rateCheck redeployed (v2 functions PIN the secret version at deploy — a new
  secret version ALWAYS needs a redeploy), + routeMiles now strips BOM/
  whitespace defensively. Key validated live: LA→Dallas 1,435.6 mi → $5/mi
  flip at ~$7,178. LESSON: never pipe secret material through PowerShell —
  write bytes from python or use temp files with explicit encoding.
- **v2.26.0 (2026-07-16)** — RATE CHECK TAB (full port of the standalone
  ghl-ratecheck tool; Caleb: "they need to be in Bravo going forward").
  The GHL Rate Check dispatcher tool (https://ghl-ratecheck.web.app, separate
  Firebase project `ghl-ratecheck`) is now a Bravo tab at /ratecheck:
  origin/dest city+state + all-in buy rate → ONLY a green ✓ / red ✗ — the
  contract rate table NEVER reaches the client. functions/src/ratecheck.ts:
  callable `rateCheck` (Branch A = lane match in `rateCheckLanes`, benchmark =
  mean all_in [linehaul + $0.70/mi FSC] over live matches, strict-under;
  Branch B = Google Routes miles vs $5.00/mi cap, 30-day cache in
  `rateCheckRouteCache`; every check logged to `rateCheckLogs`) + callable
  `rateCheckUpdateMaster` (master-file .xlsx upload → rebuild, NASS aliases
  hard-fail on unknown codes — the ALIASES map lives IN ratecheck.ts, adding
  one requires a functions deploy). RateCheckView = check form + (upload perm)
  master-file upload card. PERMS: new keys `ratecheck` (default: EVERY role
  above base, GH + AJG both — enforced server-side in the callable via user
  doc role + permAllow/permDeny, deny-wins-except-owner) and
  `ratecheck.upload` (default: owner only; grantable). rateCheck* collections
  deliberately have NO firestore.rules match blocks (functions-only; comment
  added — rules functionally unchanged, 27-case suite passes). KEY SYNONYMS:
  dispatchers can type "Missouri City TX" OR "Houston TX" for 774LP (trip 51)
  — normKey folds synonyms server-side. NEEDS BEFORE FIRST USE (deploy was
  classifier-blocked in session): copy secret GOOGLE_MAPS_KEY from
  ghl-ratecheck to bravo-matrix-gh, deploy functions + hosting. SAME-DAY DATA
  WORK: ghl-ratecheck lanes DB updated to v9 master (159 lanes, TRM pulls
  07.12.26): trips 309/353 $1,640→$2,038, new trips 6 (Coppell→McAllen —
  NASS 785 alias added)/29/51, retired 575/597/600/7502, 7504/7505 premium
  60-day-notice rates $2,699.18/$3,190.43 live 07/13–07/20 (lanes auto-drop
  after). Trip 606 (Coppell→Olathe KS $1,850) goes live 08/31 — RE-UPLOAD THE
  MASTER AFTER 08/31 (build drops future-eff trips). Master file:
  GHL_USPS_Master_Rate_File_v9_2026-07-12.xlsx (Downloads\01-USPS-FA2D3\
  Rates-&-Underpayment). ghl-ratecheck source restored from GCS to
  Desktop\ghl-ratecheck (git repo; it had no local copy). Old site retires
  once the Bravo tab is deployed + validated. NOTE: built on the desktop as
  "v2.22.0" against a stale v2.21.1 tree, caught pre-deploy (Caleb) and
  REBASED onto the laptop's v2.22–v2.25 line — version number collision
  with laptop v2.22.0 T&T Phase 1 resolved by renumbering to v2.26.0.
  Server-side role check includes the v2.23/v2.25 roles (qa_rep,
  trailer_manager, trailer_rep) — all above base, all get the tool.
- **v2.25.0 (2026-07-15)** — LOADOUT TRAILER MODULE (Caleb's "massive idea", spec
  from the recorded convo; this was Zack's parked Trailer Return tab).
  PHILOSOPHY: fully DERIVED from loads (like Capacity/Action Center) — the ONLY
  new datum is Load.trailerNumber (+ overrides trailerReturnSite / trailerFreeDays
  / trailerReturnedAt). trailers.ts: a JOURNEY = chain of PO loads sharing
  trailer#+carrier ordered by date; last link = the open obligation; earlier
  links are 'rolled' (clock closed by relink, fine frozen). CLOCK STARTS AT
  UNLOAD (Caleb): deliveredAt (T&T mark, Central date) else scheduled del day
  (next-day shift like capacity). Free days: 3/5 CALENDAR from PO equipment via
  effectiveEquipment (so crew-based lot-back feeds it), trailerFreeDays override
  for approved extensions. Fine = late days × settings/trailers.finePerDay
  (DEFAULT $100 — Caleb checking the rate-con; adjustable inline for
  trailers.approve). LIVE loads NEVER count (isPoLoad — a PO that rebooks live
  drops off by definition). NET DRIFT per site (trend-watch, NOT inventory —
  absolute counts later after Caleb's meeting): each link whose returnSite ≠
  origin books origin −1 / returnSite +1; self-heals on reverse approvals.
  /trailers page (own nav tab — separate team): dash cards (out/overdue/accruing
  + drift), Zack's columns, actions ✓Returned (trailers.mark) + alt-site/extension
  ✎ prompts (trailers.approve). LoadEditor: PO+carrier loads get the trailer
  fieldset — open-trailer chips/datalist for the carrier ("4567, due …") chain
  the next load and restart the clock. NEW ROLES trailer_manager (mark+approve)
  / trailer_rep (mark) + perms trailers/trailers.mark/trailers.approve (bookers
  get mark; admins all). Rules: trailer keys in bookerKeys + narrow trailer-team
  branches (mark: number/returnedAt; approve: +site/days); settings/trailers.
  GOTCHA (test-day find): v2.17 rate-required-covered-saves silently blocks
  Save — always fill Rate when driving the editor in tests.
- **v2.24.0 (2026-07-15)** — Think Tank sheet batch + the booked-notes bug.
  BUGFIX (Caleb+Zack): booked hub rows REPLACED the note cell with the Approve
  button — notes vanished on booking and couldn't be added. Now the approve
  button AND NoteCell both render (notes persist through booking).
  MATRIX: "⛟ Assets" pseudo-chip (statusFilter '__assets' — lanes/cells with GH
  carriers; others dim); dedicated TRK# search box (.trk-search — matches either
  shuttle leg's truck, normalized); origin/destination/via added to the main
  search text; Alpha-style highlight (<Hi> wraps the first match in
  mark.search-hit — lane names + cell load#/carrier).
  HUB: trip LETTER pill next to trip # (lane.tripLabel); PO lot-back days follow
  the crew — effectiveEquipment(load, lane): explicit pick wins; PO lane default
  → TEAM=5 DAYS / SOLO=3 DAYS (also feeds the board doc).
  T&T: mass selection — far-right checkbox column + header select-all (carrier
  rows only) + one-confirm "Mark N selected Loaded/Departed".
  KPI: dedicated PLUG-INS split from covers (isDedicatedPlugIn in types:
  dedicated lane + its own dedicated carrier + dedication live for the date →
  plug-in, NO cover credit; replacement carrier after fall-off = real cover);
  Plug-ins column in the per-rep table + CSV; margin math still counts the
  freight. Admin CB load# search already existed (v2.18 cbQuery) — no change.
  SHEET STALE flags for Caleb: LC column, No-Load Drivers, DNU, CB decision
  perms, Waive CB, Soft Book are all DONE in the app but ❌ on the sheet.
- **v2.23.0 (2026-07-14)** — Caleb's "Bravo Notes" batch (8 items, all confirmed).
  1) DRAG-REORDER: matrix.reorder permission (default OWNER-ONLY — grant per person;
  global order, cross-section allowed incl. group headers; drop adopts the target's
  section; sortOrder midpoint math; Matrix render NOW SORTS by sortOrder w/ array-
  index fallback; dragIdRef is a REF — drop can fire same-tick). patchLane() =
  field-level narrow writes (rules allow hasOnly(sortOrder,section) w/ matrix.reorder
  and hasOnly(serviceNotes) w/ matrix.serviceNotes — whole-doc updateLane would 403).
  2) FA2D3 MISC: prod 'UMT Global' section (10 lanes incl. SF→Spokane, Louisville→
  Dallas — Caleb's exact examples) RENAMED to 'FA2D3 MISC' via REST.
  3) SOFT BOOK: hub sink order open→🌙night→🟡soft→✓covered (sinkBand 0/1/2/3, band
  headers for soft + covered); soft-booked loads STAY on the carrier BOARD as normal
  loads (boardVisible exception; BoardDoc.sortLast sinks them to the bottom so board
  snippets can crop them; NO soft-book hint leaks to carriers — verified).
  4) SERVICE NOTES: Lane.serviceNotes; ⓘ popover .svc-card (edit for
  matrix.serviceNotes = admins/pricing/FedCom/QA-manager; view for all); Matrix ⓘ
  gets a ⚠ superscript when noted. 5) qa_rep ROLE: like qa_manager MINUS import
  (qa_manager defaults now incl. matrix.book+import — import writes loads; qa_rep =
  qa+qa.verify only); rules isQa + provisioning lists updated.
  6) DEDICATED START DATE (Lane.dedicatedStart, date input) — before it the lane is
  FULLY open (dedicatedCoversDate returns false pre-start → no SEND TO, no banner);
  no end date (Caleb). Dedicated carrier = DROPDOWN from the carrier DB (DNU options
  disabled; free-text legacy value shown as "(not in DB)").
  7) Dedicated tab search (trip#/carrier/origin/LC). 8) DEDICATED FLOWS FROM BRAVO:
  marking a lane dedicated in Integrity AUTO-CREATES the dedicated row (id
  trip_slug(carrier); day grid = lane frequency days else every-day; LC auto-stamped
  = whoever dedicated); clearing/switching carrier removes the old row; XLSX import
  UI + parseDedicatedSheet RETIRED (TRM upload stays verification-only, untouched).
  GOTCHA: '＋ Add lane / trip' shares .lane-edit-visible with row pencils — select
  by text when automating.
- **v2.22.0 (2026-07-14)** — T&T PHASE 1 (built as local v2.16.0, rebased onto
  v2.21.1 — same-day cross-machine collision; permissions adapted to can()).
  TrackView = tabbed workstation: TRACK (site/date/OTR filters, show-uncovered
  toggle, facility-code column, on-site mark onSiteAt 🏭, email timer nextEmailAt
  ✉ + 📧 auto-flag >1h past scheduled PU, DEFCON pin Load.defcon 🚨 + header
  badge), EN ROUTE (departed && !deliveredAt, today-3 window; ETA = departedAt +
  miles ÷ 55mph — departedAt AUTO-STAMPS in store.updateLoad on first transition
  into 'departed'; PPWK mark ppwkAt; ✓ Delivered stamps deliveredAt — NOT a
  status), FACILITIES (facilities collection, id=facilityId(site) slug,
  pre-seeded from active lane origins, inline edits; retires the CT spreadsheet).
  Marks gated by can(user,'track.mark'). Rules: bookerKeys += the six T&T marks;
  facilities read=company/write=isBooker/delete=adminTier. Demo caveat: seed
  loads end 7/12 — Current bucket legitimately empty in demo after that.
  INCIDENT NOTE: the local machine briefly deployed a v2.15.1-based build +
  rules over prod (v2.21.1) before rebasing — redeployed merged build within
  minutes. LESSON: git pull --rebase BEFORE firebase deploy, always.
- **v2.21.1 (2026-07-13)** — AJG SIGN-IN RESTORED (Caleb caught it). The
  desktop's gitignored app/.env.local still had the pre-v2.15.1 single-domain
  VITE_ALLOWED_DOMAIN — every desktop build (v2.16.0→v2.21.0) shipped a bundle
  with NO ajgtransport.com, locking AJG partners out at the client sign-in
  gate (rules were fine). FIXED: .env.local now the comma list, AND
  firebase.ts hard-codes REQUIRED_DOMAINS=['ghlogisticsllc.com',
  'ajgtransport.com'] as a floor the env can only ADD to — a stale env file
  can never drop a domain again. STANDING RULE 9c + memory file: removing
  ajgtransport access requires Caleb's EXPRESS WRITTEN CONSENT.
- **v2.21.0 (2026-07-13)** — Zack's sheet triage (Caleb: skip AJG Hedge).
  MOST ROWS WERE ALREADY SHIPPED (his sheet predates v2.14–v2.20): soft-book
  yellow, color-dot status dropdown, need_flyer, waive-chargeback decision,
  CB decision permissions, DNU carriers, restrictedDrivers, Dedicated LC col,
  Analytics LC col, Capacity LS#, Admin CB search, freq-change answer. Caleb
  previously DECLINED: Zack's asset color palette, LC Cover Report restore,
  Trailer Return tab (separate project later). NEW IN THIS RELEASE —
  HUB COUNTS (Zack): day-section headers now read "(N open · M total)" where
  open = exposed or shuttle-leg-exposed; covered-awaiting-approval no longer
  inflates the count (topbar badge unchanged — it counts everything actionable
  on the hub). REPOWERS (Zack): shuttleType gains 'repower' (checkbox label
  now "Shuttle / Repower") — reuses the split-cell + leg-2 machinery verbatim;
  hub rows tag "⚠ REPOWER — NEEDS REPOWER CARRIER" when the takeover leg is
  exposed (posts to carrier board from the swap point like any leg-2); Matrix
  split cell reads "REPOWER — NEEDS CARRIER"; board context string says
  "repower — take over mid-route". No new status: a fallout chargeback is
  logged on the SAME load alongside the repower split (fields coexist).
  PO ONE-WAY: EQUIPMENT_OPTIONS += 'POWER ONLY - ONE WAY' (#7d97b8, blue
  family) for trip 2000 — Caleb sets it on Integrity→Loading (v2.20 cascade
  pushes into future loads automatically). EXPIRED TRIPS: FA2D3-597
  Coppell→Aurora IL has zero current/future loads → Caleb retires it via the
  v2.20 Retire button (data write left to him); Zack's Hazelwood + Irving→
  Denver examples are ACTIVE (loads through 07/19) — not expired.
- **v2.20.0 (2026-07-12)** — Caleb's cleanup batch. EXTRAS AUTO-SCOPE:
  one-off rows (sections matching overflow/extra/auction — types.isExtraLane)
  render ONLY on weeks that hold one of their loads (Sat/Sun overlap works
  naturally — both 9-day windows contain the day); a brand-new extra with no
  loads anywhere stays visible so it can be filled. RETIRE ≠ DELETE (Caleb's
  rule: never delete across the full board): Lane.retiredOn (YYYY-MM-DD,
  '' = active) — the row disappears from windows STARTING on/after that date;
  past weeks keep the row and every load; expected/WAITING flags stop at
  retiredOn. LaneEditor: "Remove lane" is now "Retire lane… (next week
  forward)" whenever the lane has ANY loads (sets retiredOn = today); only a
  never-used lane can be truly removed; retired lanes show "↩ Restore".
  LOADEDITOR: clicking outside the modal NO LONGER closes it (Cancel/✕ only)
  — mid-edit misclicks were nuking work. LEGEND: stale "Asset Truck" chip
  removed from the Matrix status filter (status still renders on legacy
  loads). LOADING-DEFAULT CASCADE: updateLane with defaultEquipment now
  pushes the new equipment into EVERY future load on the lane
  (date >= todayCentral, covered or not) via updateLoad — flows to Sales Hub
  + board automatically; rules gained a keys-only branch
  (integrity.lanes ⇒ equipment+history) so pricing reps' cascades pass;
  test suite now 27 cases.
- **v2.19.0 (2026-07-12)** — LONG-PRESS LOAD MOVE + departure-day frequency
  anchor (Caleb's trip-580 conundrum). MOVE: hold a load cell ~500ms to arm
  move mode (dashed source, highlighted open days, floating hint pill, Esc
  cancels) — then click OR drag-release onto an OPEN day in the SAME row
  (cross-lane is structurally impossible: targets filter on lane id, and the
  confirm names both dates). Mechanics: load id embeds the date, so a move =
  setDoc(new id) + deleteDoc(old id) (store.moveLoad); history TRAVELS with a
  "moved from X to Y" entry; the old loadboard-mirror doc is deleted; PENDING
  OFFERS BLOCK the move (they reference the old id — respond first). rules:
  loads delete widened isAdminTier→hasPerm('matrix.book', isBooker()) (bookers
  could already blank every field; asset reps still excluded) — suite now 25
  cases, all pass. Note: after a move, the old day may show WAITING/MISSING?
  again if the frequency still expects it — that's the frequency talking, not
  a bug. FREQUENCY ANCHOR: USPS freq codes count the DEPARTURE day; Matrix
  cells are dated by PICKUP — off-by-one for after-midnight departures (580:
  PU 23:31, departs 00:01). New laneDepartsNextDay(lane): auto-detected when
  the departure time token is EARLIER than the pickup token (same-day earlier
  is impossible ⇒ crossed midnight), overridable via new Lane.freqNextDay
  (LaneEditor checkbox "Departs after midnight…"; saving pins the value).
  freqDateFor(lane, date) shifts the frequency check +1 day — MatrixView's
  expected/MISSING? logic now evaluates runsOn(lane, freqDateFor(lane, d)),
  so "R1 no-Monday" correctly means no SUNDAY-night pickup while the
  Monday-night (Tuesday-departure) trip stays expected.
- **v2.18.1 (2026-07-12)** — currentUser now SPREADS the user doc (store.tsx):
  building it from scratch copied only role+fedCom, so permAllow/permDeny
  never reached can() for the signed-in user — per-user overrides showed in
  the Permissions editor but were invisible in the person's OWN nav/UI
  (Jheremie's Integrity grant; server rules honored them all along). Any new
  AppUser field must flow through currentUser — spread, don't rebuild.
- **v2.18.0 (2026-07-12)** — RULES EXPRESSION-BUDGET FIX + Caleb's second batch.
  ROOT CAUSE FOUND for "Missing or insufficient permissions" on legit broker/
  FedCom writes (Jheremie booking GH covered, Zack deciding chargebacks):
  Firestore rules evaluate AT MOST 1000 expressions per request — the v2.16
  helper nesting (every isX() re-running isCompanyUser()+normRole()+udata())
  blew the budget on complex load writes; error surfaced as a permission
  denial. Diagnosed with the firebaserules.googleapis.com :test API
  (expressionReportLevel FULL names the exact line). REWRITE: udata() lost the
  exists() ternary (missing doc errors → deny, same outcome), Map.get()
  defaults replace 'in' probes, isCompanyUser() asserted ONCE per allow
  statement (helpers assume it), loads-update branches reordered booker-first.
  tools/test_rules.py = 21-case regression suite vs the Rules test API (no
  emulator/Java needed) — RUN IT BEFORE EVERY RULES DEPLOY. All 21 pass incl.
  exact repros of both prod failures. Keller side-mystery solved: his role is
  now qa_manager (changed ~07/10) — QA can't book BY DESIGN; Caleb decides
  role vs permAllow. BATCH: permission-denial TOAST (5s bottom-right,
  "Action denied due to permissions — [action] requires [key]"; store
  writeFailed routes permission errors to toast, everything else keeps the
  alert; perm keys wired per mutation). DEDICATED REMOVE: 🗑 per row on
  Integrity→Dedicated (confirm prompt; store.removeDedicated deleteDoc);
  integrity.dedicated default now includes FedCom admins (rules + defaults) —
  Zack can manage/remove dedicated. CHARGEBACKS: register search box
  (carrier/LS#/lane/rep, token-AND match); "No Chargeback" class option
  disabled for non-admin-tier in LoadEditor AND enforced in rules
  (chargebackOk second clause); FedCom register 🗑/decisions now actually work
  (they were expression-budget casualties). CB-STRIP anchors to the BOTTOM of
  the Matrix cell (absolute + td.cell:has(.cb-strip) padding). FEDCOM
  PROVISIONING: creatableRolesFor(u) — FedCom admins grant/revoke up to
  admin/asset_admin (+broker/asset/qa/base), never pricing tier, never the
  FedCom tag, never owner; rules users-update isFedCom branch matches
  (hasOnly['role']). TRIP 6 / INTEGRITY DRIFT: Integrity rates tab surfaces
  "N Matrix lanes missing from the Integrity database" (active + tripCode +
  no record) with a ＋ Create record stub button (mayBands;
  store.createIntegrityRecord — empty bands, pricing fills in). Prod missing
  today: FA2D3-6 (Coppell→McAllen), FA2D3-51, FA2D3-29, FA2D3-606 (they
  slipped the Phase 3 Console migration — Console had no record for them);
  extras/auction lanes have no tripCode = expected, not listed. FREQUENCY
  ANSWER (Caleb): expected/MISSING? flags call runsOn(lane, date) LIVE at
  render — a frequency edit in Integrity reflects on the Matrix immediately,
  no extra wiring needed. JHEREMIE: permAllow now
  [matrix, matrix.book, integrity, integrity.lanes] (lane edits: frequency,
  times, miles, stops — set via REST per Caleb).
- **v2.17.0 (2026-07-12)** — Caleb's ops batch, all deployed.
  MATRIX WEEK DEFAULT: opens on the CURRENT week (weekStart(isoToday()) — Saturday
  midnight Central changeover comes free from the Sat-anchored weekStart + Central
  isoToday); was anchored to the EARLIEST load date in the DB (opened on stale week 27).
  Demo seed lives in past weeks, so demo opens sparse — that's the fix working.
  RATE REQUIRED (Caleb): LoadEditor blocks save when status is covered-or-better
  (RATE_REQUIRED_STATUSES: covered/booked_rc_pending/rc_signed/gtg/need_flyer/
  flyer_sent/drivers_confirmed/dispatched/departed) with a non-GH carrier and an
  empty Rate box — .carrier-blocked banner + disabled Save; GH pass-throughs exempt
  (the Rate field doesn't even render for them). Client-side only (imports/offer-accept
  already write rate). AUDIT shipped to Caleb: 81 covered-or-better loads since
  07/10 with empty rate box (missing-rate-audit.csv, repo root — gitignore-check);
  ~all have the $ amount sitting in NOTES (loadRate() still finds them for margin),
  so it's a data-hygiene sweep, not lost money; one bad row (lane-042 07/12 "0200").
  WRITE FAILURES ARE NOW LOUD (store.tsx writeFailed): updateLoad/upsertLoad/hub
  notes/note delete/offer respond no longer .catch(()=>{}) — a rules rejection
  alerts with the server's message instead of silently snapping back. This is the
  fix for "Keller/Jheremie can't change status to RC sent": prod history shows
  broker status writes DO land (incl. covered→booked_rc_pending on 07/12), both are
  provisioned broker_rep, no DNU carriers exist, no GH-regex false matches — the
  likely culprit was the 07/11–07/12 deploy-churn window (v2.15.1 rollout + the
  desktop's stale v2.11 rules that were live for part of 07/12 before the v2.16.0
  rebase fixed them). If it recurs, the alert now names the exact rejection.
  BROKER "+ ADD LANE" (extras): new perm key matrix.addLane (default: all bookers)
  — Matrix section "+ Add lane" renders for laneEditor OR matrix.addLane; rules
  split /lanes into create (integrity.lanes OR matrix.addLane-with-section-!=
  'FA2D3 Schedule' — bookers can never add to the main schedule) vs update/delete
  (integrity.lanes only). INTEGRITY ✎ Edit lane button now sits on its OWN LINE
  under the lane text (.lane-edit-under display:block — it was overlapping the O/D
  label inline). Verified in preview: week 28 default, guard blocks/unblocks/GH-
  exempt, broker sees 3 Add-lane buttons, button placement via computed styles.
- **v2.16.0 (2026-07-12)** — GRANULAR PER-USER PERMISSIONS (Caleb's spec, built on the
  desktop as "v2.11.0" and REBASED onto the laptop's v2.11–v2.15.1 line — the two
  machines had diverged; version numbers up to 2.15.1 on the laptop are UNRELATED
  releases). app/src/permissions.ts = the catalog: 30 keys, tab-rooted tree (matrix/
  hub/integrity/capacity/track/analytics/qa/import/admin + branches), `requires`
  cross-links (offers/import/track.mark/create/chargebackLog => matrix.book; autoset
  child of hub.fields; admin.chargebacks.decide child of admin.chargebacks).
  defaultPerms(user) reproduces the v2.15.1 role matrix EXACTLY: Integrity view =
  admin+pricing only (bookers keep the Carriers-tab-only link via matrix.book, asset
  reps excluded); TRM+lane edits default to pricing tier + FedCom admins (v2.13
  parity); chargeback DECISIONS default to owner/PM/FedCom (v2.15.0, incl. the
  waive-with-reason flow — kept verbatim); Cover Report key REMOVED (feature deleted
  in laptop v2.11.0); night pin = hub.fields OR matrix.book (v2.11.5). Per-user
  users.permAllow/permDeny (owner-set via Permissions button on Admin->Users, modal =
  components/PermissionsEditor.tsx, tri-state Inherit/Allow/Deny + live effective
  check/cross). Closures: grant pulls ancestors+requires automatically; deny knocks
  out subtree+dependents — no broken half-capabilities. ALL view gates now call
  can(user, key) (capability helpers in types.ts remain ONLY as default-matrix
  inputs — never gate UI with them directly again). firestore.rules: hasPerm(p,
  roleDefault) on every write gate (deny wins except owner-never-denied; allow grants
  above role); loads update = branch per capability incl. standalone grants
  (hub.fields/hub.approve/admin.chargebacks.decide keys-only writes); integrity split
  bands vs trm by affectedKeys (trm default incl. FedCom); cbDecisionOk routes through
  hasPerm('admin.chargebacks.decide', isCbDecider()). Perm fields writable ONLY via
  the owner branch. Role provisioning + permission editing deliberately NOT in the
  tree (not overridable). View perms on the base tabs are nav/UX-level (Firestore
  reads stay company-wide — do not promise read isolation). Demo user 'Demo Broker'
  exists so the editor is testable in demo.
- **v2.15.1 (2026-07-11)** — ajgtransport.com back-office logins ACTIVATED (Caleb).
  firebase.ts: ALLOWED_DOMAINS list (env comma-separated; default ghlogisticsllc.com,
  ajgtransport.com; first = primary brand) + isCompanyEmail(); `hd` picker hint
  REMOVED (single-domain only feature). App gate + sign-in/denied copy multi-domain.
  firestore.rules isCompanyUser: matches @(ghlogisticsllc|ajgtransport).com —
  server-side. AJG users self-register at BASE (read-only) until provisioned.
  Admin Users: purple PARTNER pill inferred from non-GH sign-in domain (no data
  field needed). .env.local + .env.example updated to the comma list (IMPORTANT:
  a single-domain env value would silently exclude AJG). REQUIREMENT: AJG must be
  Google Workspace on that domain — Google-only sign-in. Board unaffected
  (signInAnyGoogle was always any-Google).
- **v2.15.0 (2026-07-10)** — Zack Cohen batch (Caleb-scoped; sheet triaged in chat).
  CHARGEBACK CORRECTIONS: register rows get ✎ (fix carrier/amount via prompts) +
  🗑 "logged in error" (voids ALL cb fields + resets load status carrier?covered:
  exposed — audited via history); WAIVE now FALLS OFF the Matrix completely (also
  resets status; modal cb-box renders ONLY while activeChargeback — closed CBs
  leave no notes anywhere but register/history). CB DECISION PERMISSIONS:
  canDecideChargeback (owner + pricing_manager[Tucker] + FedCom admins) gates the
  decision select/✎/🗑 in UI AND rules (isCbDecider/cbDecisionOk — status→pending
  logging stays open to admin-tier; bookers were already pinned). DNU CARRIERS:
  Carrier.dnu — Carriers tab 🚫 chip (confirm prompt), red name; HARD BLOCK:
  editor save disabled + banner (leg 1 AND leg 2 via normalized match), datalist
  options labeled "— 🚫 DNU", hub offer-accept refuses (client-side only; rules
  don't do carrier lookups). ⚑ stays warn-only. Carrier.restrictedDrivers ("No-
  load drivers" col, free text). DEDICATED: DedicatedLane.lc — LC column (pricing-
  editable inline; assigned in Integrity per Caleb). SOFT BOOK: Load.softBook
  (bookerKeys; canPin roles) — hub checkbox next to 🌙, yellow row (.hub-soft) +
  "SOFT BOOK — shopping cheaper" tag; means booked-but-pricey, still shopping.
  CAPACITY: LS# column (CapacityEntry.loadNumber; app inference + FUNCTIONS PORT
  both updated — snapshot function redeployed). ANALYTICS: LC column on Top/
  Bottom-5. DECLINED by Caleb: LC Cover Count restore (KPI section suffices —
  he'll talk to Zack), Trailer Return tab (separate project later), Zack's asset
  color scheme (Caleb's palette stands), expired-trips examples (already handled),
  AJG Hedge (needs detail from Zack). Freq-change answer for Jheremeie: Integrity
  → ✎ Edit lane (frequencies/TRM/miles all live there).
- **v2.14.2 (2026-07-10)** — Capacity 12-hour freshness rule (Caleb): entries with
  emptyAt older than now−12h (Central-clock string math, same format as emptyAt)
  are dropped from the empties LIST and the PAIRING pool — display-side filter in
  CapacityView (the 08:00 snapshot doc is untouched; the rule applies live all day).
- **v2.14.1 (2026-07-10)** — ☰ SETTINGS MENU (Caleb): topbar-right is now just
  ActionCenter + DEMO badge + ☰. SettingsMenu.tsx holds: identity line (name +
  roleLabel), theme toggle, palette select, TEAM PICKER (renders only when
  moraleEnabled && moraleOk; search + pick + ✕ clear), Sign out (non-demo),
  version footer. TeamBadge is DISPLAY-ONLY now (span, no picker, renders only
  when a team is picked — the "Pick your team" hint chip is gone; selection
  lives under ☰). Future settings candidates noted for Caleb: default landing
  page, notification prefs (pairs with the someday email digest).
- **v2.14.0 (2026-07-09)** — ACTION CENTER + need_flyer + status-dot dropdowns.
  actions.ts: buildActions(ctx) derives role-scoped data-health items LIVE (no
  collection — items vanish when data is fixed). Scope (Caleb): pricing = bands/
  miles/times/TRM-stale; laneData(pricing+FedCom) = TRM-missing/loading-default;
  BROKERS = missing rates, fallout recovery, carrier MC/DOT hygiene, T&T overdue
  (parked until a Track-and-Trace ROLE exists — Caleb will create it; same for QA
  role → BOL queue); ASSET (rep+asset_admin+owner) = GH truck-# gaps + need_flyer.
  Red = money/booking-safety, amber = hygiene; red-first sort; active lanes only.
  ActionCenter.tsx = "✓ Actions" topbar button + badge + panel (Fix→ deep links).
  BROKERS get a "Carriers" nav link → /integrity?tab=carriers (IntegrityView
  carriersOnly mode: effTab forced, other tabs hidden — client gating only; the
  carriers collection was already booker-writable). NEW STATUS 'need_flyer'
  ("Need to Send Flyer", #e8590c, Assets group before flyer_sent; in T&T/badge
  confirmed sets) — flags the asset Action Center. StatusSelect.tsx replaces BOTH
  native status selects in LoadEditor: custom listbox w/ 13px color dots per row
  (native <option> can't render shapes), grouped sections, leg-2 relabel/auto row/
  dedicated_pending exclusion preserved; current value always selectable when
  dept-filtered out. NOTE: demo counts are noisy (291 missing rates etc. — seed
  data predates the rate field); prod counts will be real.
- **v2.13.0 (2026-07-09)** — FedCom-audit fixes (Caleb approved all; bands stay pricing).
  TRM inline edit opened to canEditLaneData (pricing + FedCom admins) — rules:
  integrity update for isFedCom hasOnly(trm, updatedBy, updatedAt), NEVER bands;
  bandHistory + full writes stay isPricing. Integrity rates tab gets "＋ Add lane /
  trip" (laneData-gated; LaneEditor with lane=null — lanes create rule already
  covered FedCom since v2.11.3). Rates-tab header now EXPLAINS read-only bands to
  non-pricing lane editors. KPI: name-only reps (no user doc) show "goal*" with a
  tooltip — goals attach to ACCOUNTS; default applies. Stale 🏈 tooltip fixed
  (master switch is in the Users tab since v2.10.5). Audit item 3 was a FALSE
  ALARM: the Dedicated ⚑ gate is already canAdmin — demo just has NO dedicated
  seed rows, so the tab renders empty in demo (remember this when demo-testing).
- **v2.12.3 (2026-07-09)** — hub covered sink gets ONE "✓ Covered / Booked — awaiting
  admin clear" block header (green, .site-row-covered) instead of per-site headers;
  open/pinned bands keep site headers (pinned prefixed 🌙). Demo ?role= param now
  accepts &fedcom=1 (FedCom-tagged admin POV). FedCom audit findings parked: TRM
  inline edit + bands stay pricing-only (FedCom admin can ✎ lanes but not TRM —
  ask Caleb); no lane-CREATE entry in Integrity (Matrix +Add lane is pricing-only);
  ⚑ carrier flag editable on Integrity→Carriers for admins but the Dedicated tab's
  flag didn't render for fedcom admin (inconsistent gating); KPI goal inputs need
  rep USER DOCS (bookedBy strings without user docs can't attach goals).
- **v2.12.2 (2026-07-09)** — hub site subheaders resolve to the CITY via the
  carrier-board mapper (publicCity + buildCityStateMap): "Memphis RPDC" /
  "Memphis TN RPDC" / "Memphis, TN" are ONE "Memphis, TN" block (Caleb);
  same for North Texas → Coppell, TX etc. Grouping key = publicCity lowercase.
- **v2.12.1 (2026-07-09)** — two follow-ups. cityDisplay NO LONGER strips digit
  suffixes: "Palmetto GA 303Cx" is INTENTIONAL (differentiates from Palmetto 302RP —
  Caleb; it was the only such value in the data, so the strip rule fixed nothing).
  Audit item #15 shipped: hub Rate column ghosts the band TARGET (low end,
  weekday/weekend-matched via bandFor incl. the Live rule) when no posted rate —
  muted italic .rate-ghost for non-editors, input placeholder "target $X" for
  admin editors; read-only guidance, never written anywhere.
- **v2.12.0 (2026-07-09)** — broker-POV audit fixes (Caleb approved 1-7, 9-14, 16, 17;
  skipped 8 legend-collapse; 15 rate-ghost pending his answer).
  FIXED: "(legacy)" suffix removed from the status fallback option (dept-filtering made
  normal cross-dept statuses read as legacy); Notes hint no longer says "keep rates in
  the Rate field" on pass-through GH loads; NEW dates.fmtStamp() = app-standard 24h
  "7/9 22:41" replacing ~10 scattered AM/PM toLocaleString calls (offers, capacity
  builtAt, hub note log, editor history, admin regs/access log, QA, TRM meta, cleared-
  today); T&T status column uses real labels; offer cards fmtRateStr ($2,450);
  editor band footer prefers the INTEGRITY record (WD-first, en dash, fmtMoney —
  legacy lane strings only as fallback); NEW types.cityDisplay() display-normalizer
  ("Coppell TX"→"Coppell, TX", strips digit-bearing trailing tokens like "303Cx") used
  by laneShortName/laneCompactName + hub puSite grouping (data untouched); 'Thur'→'Thu';
  hub search placeholder shortened; "N pending offers" pluralized; Capacity Unit column
  shows — instead of duplicating the carrier; hub trip # nowrap; mobile shuttle-toggle
  left-aligned. HUB site subheaders (.site-row) name each pickup-site group (only
  sites with loads render — headers derive from rows). T&T BUCKETS: Current (last 24h
  + upcoming, default) vs "Older than 24h" chips; ⏰/red only in Current; owner-only
  "✓ Clear all — mark Loaded/Departed" mass-clears the stale bucket (confirm first).
  Also: demo-only ?role=broker_rep URL param (store.tsx) walks the app as any role.
- **v2.11.5 (2026-07-09)** — night-shift pin opened to broker reps (Caleb): hub 🌙
  checkbox enabled for canBook (canPin = canHub || canBook); 'pinnedNight' added to
  bookerKeysOnly in firestore.rules. The 👁 board-visibility toggle and the other hub
  fields (posted rate, equipment, solo/team, hub notes) STAY admin-tier.
- **v2.11.4 (2026-07-09)** — the Integrity lane pencil was INVISIBLE (root cause:
  it reused Matrix's .lane-edit class, which is opacity:0 and only revealed by
  .lane-col:hover — Integrity has no .lane-col, so it never showed; DOM-count
  "verification" missed it. LESSON: verify visibility with computed styles, not
  element counts). Now a real bordered button "✎ Edit lane" (.lane-edit-visible,
  always on). Hub equipment select unclipped (min-width 225 / col 290 — rule 8).
  'LIVE/LIVE' RETIRED from EQUIPMENT_OPTIONS (redundant; LIVE LOAD keeps Caleb's
  copper #a65f21); prod migrated via REST (33 lanes.defaultEquipment, 0 loads) +
  "(legacy)" option fallback renders any straggler value.
- **v2.11.3 (2026-07-09)** — Integrity owns lane editing + brand-as-home (Caleb).
  The per-lane ✎ (LaneEditor) is REMOVED from Matrix lane cells — Integrity's
  Rates & TRM per-row ✎ is now the ONLY lane-edit entry point (Caleb: "Integrity
  is the source of truth for the lane"). Matrix keeps ⓘ details + section-level
  "+ Add lane" (creation only). NEW canEditLaneData(u) = pricing tier OR
  FedCom-tagged admin — gates the Integrity ✎ AND the Loading-default select;
  band/TRM edits stay canEditLanes (pricing). firestore.rules /lanes write:
  isPricing() || isFedCom(). Integrity page ACCESS widened back to
  canAdmin || canEditLanes (pricing_rep needs the pencil; v2.11.0 had cut them).
  TOPBAR: the Matrix tab is GONE — the GH/BRAVO MATRIX brand block is now a
  NavLink home button (a.brand-block, hover fade); saves a tab slot on desktop
  AND the mobile bottom bar.
- **v2.11.2 (2026-07-09)** — chargeback persistence + waive (Caleb's "chargeback logic" talk).
  Clarified: CB data was never lost on re-cover (fields live on the load; register reads
  them) — it just stopped DISPLAYING once status left 'chargeback'. New
  activeChargeback(load) helper (class once_recovered && status not recovered/waived).
  Matrix cells show a slim .cb-strip in the chargeback color ("CB {carrier} · ${amt}")
  under the cell content while a CB is active on a covered load (normal + shuttle split
  cells; hidden when the whole cell is already chargeback-colored). Load modal keeps a
  read-only cb-box after re-cover: "⚠ Active chargeback — carrier · $amt · status"
  (or "Chargeback (closed)" + waive note). WAIVE: chargebackStatus += 'waived' with
  REQUIRED note — Admin register option "waived — reason required" window.prompts;
  empty note reverts the select; stamps chargebackWaiveNote/WaivedBy/WaivedAt (audited
  in history via summarize); note renders under the decision + exported in CSV
  (waiveNote/waivedBy cols). Margin: waived keeps SUBTRACTING (loss we ate — only
  'recovered' neutralizes; margin.ts untouched on purpose). Waive is admin-tier via
  existing rules (non-admins still pinned to status 'pending').
  Verified full lifecycle in demo: fall-off → CB $450 → re-cover US SAFE → strip +
  modal box persist → waive w/ note → strip clears.
- **v2.11.1 (2026-07-09)** — loading-option colors + per-route default (Caleb).
  The "loading option" = the Equipment dropdown (EQUIPMENT_OPTIONS). New
  EQUIPMENT_COLORS/equipmentColor() in types.ts: LIVE/LIVE = Caleb's copper
  #a65f21 (rgb 166,95,33 — exact ask), LIVE LOAD #c07a3d, 3-day lot-back
  #5b7c99 vs 5-day #31536e (same blue family, a shade apart on purpose).
  Sales Hub equipment select + its options render on those colors (white
  text, .equip-select). Integrity → Rates & TRM has a new "Loading" column:
  inline select bound to the LANE's defaultEquipment via updateLane (pricing
  tier edits; hub/board inherit unless a load overrides — mechanism unchanged).
- **v2.11.0 (2026-07-09)** — access cleanup + responsive/mobile pass (Caleb's rollout).
  Cover Report REMOVED entirely (view file, route, nav, canViewCoverReport helper) —
  what Caleb wanted from it lives in Analytics/KPIs. Integrity + Analytics are now
  ADMIN-TIER ONLY: nav links hidden AND routes redirect to /matrix for lower roles
  (broker reps see no Admin/Integrity/Analytics tabs; note pricing_rep also loses
  Integrity by this rule — Caleb's call "admins and higher"). Band editing already
  existed (click Target/Ceiling cell, reason required) but was invisible — cells now
  show a ✎ hint + accent dashed border + header line "click any Target/Ceiling or
  TRM value to edit"; verified round-trip. TOPBAR: nav strip scrolls horizontally
  (hidden scrollbar) instead of squishing; under 1280px the team badge collapses to
  logo-only. MOBILE (≤760px, Safari-first): the SAME nav element becomes a fixed
  bottom tab bar (app-style, thumb targets, env(safe-area-inset-bottom) for the home
  indicator; viewport-fit=cover added to index.html); topbar compacts + sticky;
  shell gets bottom padding; editor modal becomes a 94vw sheet; shuttle legs-grid
  stacks single-column with the ⇄ rotated. Tables still scroll sideways (rule 8).
- **v2.10.5 (2026-07-09)** — Admin module = FOUR REAL TABS (Caleb's spec): Users &
  Permissions (grouped list + morale master switch) / Registrations — Loadboard Access
  (share link + Rebuild + verification flow) / Chargebacks / Access Log. Tab chips are
  stateful BUTTONS with count badges — v2.10.4's `#anchor` chips were parsed as routes
  by HashRouter and bounced users to the Matrix (never use bare hash anchors in this
  app). Pending Approvals section REMOVED (nav bubble unchanged: regs + Base + CB
  decisions); Lane Audit section REMOVED from Admin (seed/audit.json still exists).
  GOTCHA: a python script that truncate-opens a file then hits a unicode encode error
  DESTROYS it — encode to bytes first, then write (AdminView was briefly zeroed;
  recovered from git).

- **v2.10.4 (2026-07-09)** — booking approvals live on the SALES HUB ONLY (Caleb's call):
  Admin's Pending Approvals no longer renders the bookings table (muted pointer line
  instead; store.approveBooking still exists — hub rows use it), and the Admin nav
  bubble EXCLUDES pending bookings (counts registrations + Base sign-ins + chargeback
  decisions only). Admin page: anchor jump chips (.admin-jump → #approvals/#team/
  #loadboard/#registrations/#chargebacks/#accesslog/#audit) + Team & Roles grouped
  into subsections (GH Leadership & Admins / Reps & Specialists / Awaiting Clearance,
  seniority-sorted, empty groups hidden). NOTE: Caleb mentioned "partner dispatch
  users" as a desired grouping — no data field distinguishes partners from GH staff
  yet; would need a tag on users (ask before inventing).
- **v2.10.1–2.10.3 + rules fix (2026-07-09)** — same-day follow-ups, all deployed.
  Dispatched recolored twice: #8250df purple → #2596be → FINAL #00ffff cyan
  ("Tropical Mirage"), dark text (Caleb corrected himself — cyan is current).
  Matrix lane filter now matches EVERY load detail (laneSearchText): rateNotes
  (driver names like "Juan"), truckNumber, shuttle carrier/truck/LS#/leg notes/
  location/swap city, cancelReason, hubNotes — verified "johnny" and "3572" find
  their loads. Team-spirit badge is PER-USER (v2.10.3): master switch stays on
  Admin (settings/morale.enabled), but the badge only renders for users with
  users.moraleOk=true — owner-set 🏈 checkbox column on Team & Roles (non-owners
  see read-only ✓/—; store.setUserMorale). GOTCHA + fix (9c880e2): the owner
  provisioning rule requires auth.uid != uid (anti-self-promotion), so the
  owner checking their OWN 🏈 box was rejected server-side and snapped back —
  users self-update rule now allows hasOnly(team, teamLogoUrl, moraleOk) when
  normRole()=='owner' (everyone else stays team/teamLogoUrl only). Default is
  unchecked: after v2.10.3 nobody has a badge until Caleb checks their row.
- **v2.10.0 (2026-07-09)** — Caleb's second 07/09 batch (19 answered questions → one build).
  STATUSES: 'gtg' (Q/A — GTG, lavender #aa99ec — the old Asset Truck color; new Q/A
  optgroup after Brokerage; lifecycle: after RC Signed, still pre-departure so T&T/badges
  include it) + 'omitted' (#000, Cancelled group; SITE cancelled ≠ standard cancel —
  cell renders OMITTED + reason ALL-CAPS; requires cancelReason like not_running, TONU
  checkbox available; excluded from isExposed/onSalesHub/board). not_running now soft
  black #26282b. Status dropdown is DEPT-FILTERED by the leg's carrier (statusGroupsFor):
  GH → no Brokerage section, outside carrier → no Assets, empty → both; leg 2 mirrors it.
  SHUTTLES 2.0: shuttleSplitPct UI REMOVED (GH-both-legs = straight pass-through, Caleb's
  call; field kept for legacy docs); GH loads hide the Rate field entirely (pass-through
  note; patch clears rate) for non-shuttles + both-GH shuttles; leg-2 status = FULL
  sectioned set (legStatusLabel renames 'departed' → "Swap Complete / En Route"); leg-1
  status select renders INSIDE the leg-1 column; NEW swap fields shuttleCity/shuttleState
  (own inputs)/shuttleSwapEta/shuttlePostedRate — an exposed DELIVERY leg posts to hub AND
  carrier board FROM the swap point ("Troy, TX → Indianapolis", PU = swap ETA, rate =
  shuttlePostedRate; board.ts legTwo branch, boardVisible extended). Split cells: leg-2
  half uses the full status palette; min-height/wrap so notes aren't condensed.
  BUGFIX carrier datalist now renders unconditionally (leg-2 suggestions died when leg 1
  was assigned). BUGFIX hub booked line/rate cell showed NOTES as the rate for pre-split
  loads — now parses load.rate only (fmtRateStr; no rateNotes fallback for display).
  Rates display without ".00" everywhere (fmtMoney/fmtRateStr — cents only when real).
  T&T: nav renamed "T&T"; window.confirm before Loaded/Departed; shuttles get a second
  "⇄ Swap Complete / En Route" action (sets shuttleLegStatus='departed').
  CARRIER DB: Integrity → third tab "Carriers" (name/MC/DOT(new field)/loads-count/⚑/
  notes(new); inline edit admin-tier+pricing via updateCarrier; bookers still create
  carriers while booking). Admin registrations MC cross-check chip: "✓ [Carrier]" when
  the MC matches the DB (future: link dispatcher to carrier), orange "MC not in carrier
  DB" otherwise.
  MORALE: NCAA D1 team badge (owner toggles settings/morale.enabled on Admin; users pick
  their team — users.team/teamLogoUrl, self-writable per rules hasOnly). teams.ts =
  ~250 D1 programs w/ primary colors; logo resolved ONCE from Wikipedia REST summary
  thumbnail (fetchTeamLogo — the "standardized sorter"; falls back to color monogram)
  and cached on the user doc. Badge sits centered in the topbar gap on a fixed light
  chip (any team color readable on every palette/theme).
  RULES: bookerKeys += shuttleCity/State/SwapEta/PostedRate; users self-update
  hasOnly(team, teamLogoUrl). DATA: lane-048 "MEMPHIS MPA OUTBOUND" group header
  HARD-DELETED from prod + seed (Caleb; its lanes remain active).
- **v2.9.0 (2026-07-09)** — Caleb's 07/09 batch, rolled in two phases.
  A: assigned carriers show a Remove button (picker only when empty); Matrix cell notes
  wrap FULLY (no truncation — CSS pre-line + full rateNotes, not line 1); loadboard email
  → freight@ghlogisticsllc.com; shuttle split-cells were dropping the rate/notes line
  (fixed: leg 1 shows rate/truck/notes, leg 2 shows location + legNotes); double-book
  driver-match stopwords += common ops words ('not','move','until'… — screenshot false
  positive). B: Track & Trace page (/track): confirmed-but-not-departed trips,
  yesterday→tomorrow, chronological by scheduled PU, ⏰ overdue highlighting, one-click
  '✓ Loaded/Departed' (canBook); nav badge = yesterday's still-undeparted count.
  Shuttle editor: two-column legs (LEG 1 pickup | ⇄ | LEG 2 transit/delivery) with NEW
  independent shuttleLegNotes on leg 2 (booker-writable; shows in the split cell);
  editor widens via .editor-wide class.
- **v2.8.1 (2026-07-09)** — dedupe module REMOVED (cleanup done); carriers delete rule
  re-closed. Duplicate PREVENTION now permanent: normalizeCarrierName (case/space/punct)
  — addCarrier() reuses normalized matches (backfills MC) from every path (editor, offer
  accept, registration approve, carrierVerify function — keep the function's copy in
  sync); LoadEditor warns with "similar carrier — use X" buttons on suffix-stripped near
  matches (carrierNameKey). 'Asset Truck' removed from the status PICKER (STATUS_GROUPS);
  the status still exists — editor shows a "(legacy)" option only when the open load
  already carries it. NOTE: firebase functions discovery flaked (Node 24 local OOM/
  timeout) — retry with NODE_OPTIONS=--max-old-space-size=6144 FUNCTIONS_DISCOVERY_TIMEOUT=120.
- **v2.8.0 (2026-07-09)** — sectioned status dropdown + TONU + carrier dedupe.
  Status select is grouped via STATUS_GROUPS (types.ts): Exposed/Covered/dedicated-pending
  on top (cross-dept), Brokerage (RC Pending, RC Signed, Loaded/Departed, Chargeback),
  Assets (NEW flyer_sent yellow, NEW drivers_confirmed olive, dispatched now PURPLE
  #8250df "for now", Loaded/Departed again, Asset Truck), Cancelled. Loaded/Departed is
  ONE status listed in both dept groups. Cancelled shows "Bill USPS TONU (< 4 hours)"
  checkbox → Load.tonuBill (booker-writable; Matrix cell shows 'TONU BILL').
  ONE-TIME MODULE (delete when Caleb says done): Carrier Duplicates section on Admin +
  store.mergeCarriers — fuzzy-clusters carrier names (legal/industry suffixes stripped),
  human-reviewed merge renames loads.carrier/shuttleCarrier + dedicated.carrier onto the
  canonical, carries MC over, deletes dups. carriers delete rule opened to adminTier for
  this — consider re-closing when the module is removed.
- **v2.7.0 (2026-07-09)** — rate/notes split + shuttle legs + integrity merge.
  Load.rate is now FIRST-CLASS (separate field from rateNotes; read via loadRate()
  which falls back to legacy rate-in-notes — never parse rateNotes for money directly).
  Editor has separate Rate + Notes fields; offer-accept and imports write rate.
  Shuttle legs are marked INDEPENDENTLY: shuttleLegStatus (''=auto: covered iff
  shuttleCarrier set) — Matrix cell splits into two colored halves; an exposed
  delivery leg puts the load back on the hub ("⇄ SHUTTLE — DELIVERY LEG EXPOSED").
  Dedicated lanes: orange outline on the lane name (not just the dot).
  Import: skipped-rows report with Customer column + red USPS warning — never
  silently skip; non-Matrix freight (FedEx/LA Foods) is expected there.
  Integrity page = merged workspace (Caleb-requested): "Rates & TRM" + "Dedicated"
  tabs (old /dedicated route redirects; nav item removed). TRM is inline-editable
  (saveTrm, pricing tier, updatedBy/At stamped — upload stays as bulk sync);
  per-row lane ✎ (LaneEditor) + DED day chip when the trip has dedicated rows.
  NOT DONE from Caleb's checklist (need clarification): eliminate Dedicated-
  Send-to-Carrier dropdown / LS#-recognition idea; "TRIP 2000 reflects PO-ONE
  WAY"; expired-trips rule still parked by Caleb.
- **Phases 8+9 SHIPPED (v2.6.0, 2026-07-08)** — analytics + covered-load QA.
  §8.1 margin engine (app/src/margin.ts — the Daily Margin Report workbook live):
  Revenue = TRM currentRate + FSC/mi × laneMiles; Cost = carrier rate (brokered) or
  (fuelCpm + driverCpm[solo .65|team .80]) × mi (asset, GH regex); chargeback amounts
  subtract until 'recovered'; breakeven 9.75% flags UNDER; loads w/o TRM rate are
  EXCLUDED + flagged (Caleb: no fake numbers). Settings in settings/margin doc
  (fuel daily / FSC weekly / breakeven / company name; admin+pricing edit). Analytics
  page (admin-tier): day table + Mon-anchored week rollup + top/bottom-5 + per-rep;
  PDF = print view (Drive archive deferred — folder ID unused in the sheet).
  §8.2 KPI tab: per-rep covers vs FedCom-editable dailyGoal (default 5, users.dailyGoal,
  rules allow FedCom hasOnly[dailyGoal]), avg rate, band compliance (≤target/in/&gt;ceiling),
  margin health, chargebacks-by-rep, CSV. §9 qa_manager role (owner-provisioned; QA nav
  badge, NOT admin bubble — admins can't act on BOL by design); 'departed' neon-green
  status (dispatched stays, different meaning); bolVerified/-By/-At on loads (QA/owner
  only per rules, keys-restricted). LC Cover Report (/coverreport): owner + pricing_manager
  + FedCom admins ONLY (asset_admin/plain admin excluded); rows require status='departed'
  AND bolVerified (both gates verified); LS# splits primary/asset; ceiling vs rate; LC =
  bookedBy; per-LC cover count headline. QA queue scope: date ≥ 7 days back (don't flood
  day one with history). Demo integrity now fabricates trm.currentRate (~ceiling×1.15).
- **Phase 7 SHIPPED (v2.5.0, 2026-07-08)** — dedicated integrity & chargebacks (Caleb's
  renumbered phase). §7.1 `dedicated` collection (81 rows seeded from Daily Margin Report
  "Dedicated Lanes" tab 07/08 — id `${tripNumber}_${carrier-slug}`; Mon–Sun booleans are THE
  source of truth, never CTS notes). Dedicated page: dashboard (weekly = per-day × true days —
  parser reproduces the tab's own rollups to the penny), day-grid master (pricing tier edits),
  XLSX re-import (origin variants normalized: strip `\\s{2,}S$`), reconcile REPORT (never
  auto-overwrite): carrier vs CTS, not-marked, days-vs-frequency. dedicatedCoversDate() gates
  Matrix dedicated_pending + LoadEditor banner — the "expects them on a Mon trip" fix.
  §7.2 chargeback dropdowns on the LOAD (class once_recovered|none + optional amount);
  logging = all non-Asset roles; FINAL decision (confirmed/disputed/recovered) = admin-tier,
  enforced in rules (non-admin can only write chargebackStatus 'pending') + pending-admin
  bubble. §7.3 clearing a carrier on a dedicated lane ALWAYS prompts (fall off? classify);
  carrier `issue` flag (admin, ⚑ on Dedicated page) hardens the warning. §7.4 Chargebacks
  register on Admin (chargebackCarrier stamped at log time since carrier gets cleared;
  class survives recovery) + CSV export. §7.5 board rows click-expand: stops chain w/ times,
  loaded miles, equipment, solo/team, shuttle — never load#/trip#/notes/rates.
- **Phase 6 SHIPPED (v2.4.0, 2026-07-08)** — asset & capacity ops (Caleb's renumbered phase).
  §6.1 shuttles: Load.isShuttle/shuttleType(meet_swap|yard_stage)/shuttleLocation/
  shuttleCarrier/shuttleTruckNumber/shuttleAssetLs/shuttleSplitPct; ⇄ markers on Matrix/hub,
  sanitized context string on the carrier board (never rates). Pay waterfall: carrier's
  negotiated rate (firstMoney of rateNotes) reconciles FIRST out of integrity trm.currentRate;
  remainder→asset leg, never negative (asset gets $0 on a loss). Both-legs-GH: manual split %
  (default 50/50) — leg miles don't exist so no auto mileage split. §6.2 primary LS# =
  loadNumber (immutable, EDI); Asset LS# input only renders when carrier is GH; the slash
  convention ("primary / assetLS") is unchanged storage; shuttle 2nd asset leg carries its own
  shuttleAssetLs. §6.3 conflict: soft warning when a truck's EARLIER load is scheduled to drop
  after this pickup (scheduled times only, no ETAs — Samsara layer is backlog); "next day"
  delivery blobs shift the drop date +1 (bug found in verification — keep this in sync with
  capacity inference). §6.4 empty-truck list: capacity/current doc, built by capacitySnapshot
  (scheduled 08:00 America/Chicago) + rebuildCapacity callable (admin-tier, ID-token check);
  inference = loads dated yesterday/today Central with carrier, empty at final del time at
  lane.destination; SAME logic in app/src/capacity.ts (demo) — keep the two ports in sync.
  Capacity page: empties table + pairing recs (same city via publicCity + emptyAt ≤ PU time),
  asset and external streams separate. §6.5 was already live (v2.1.1 autoTeamSolo) — only
  added the Matrix lane-box SOLO/TEAM pill; solo-approved list = lane.soloApproved checkbox.
- **Phase 5 SHIPPED (v2.3.0, 2026-07-08)** — carrier loadboard & offers (Caleb's renumbered
  phase; the plan doc's asset-ops content moved later). Guided New Carrier Setup (numbered
  steps, MC 4–8-digit validation; `?showreg` on the demo board walks it); admin registrations
  table is fixed-layout so it can't overflow the viewport. Hub offers: countered offers STAY
  VISIBLE (dashed card, "↩ Countered $X by rep · time — awaiting carrier", counter button
  removed to prevent duplicates); cards stack left→right sorted by LOWEST rate; every card
  shows "Submitted [time]". Acceptance is in-app only (NO email, Caleb's call): offer gets
  laneLabel/puDate/puTime snapshot at accept (board doc vanishes on booking) and the carrier
  sees "My Loads" + "✓ Accepted — [accepting rep] will reach out" (respondedBy = the rep).
  Board: compact right-aligned "Offer" button; total-trips counter REMOVED on purpose
  (carriers used open-load counts as rate leverage — never re-add). Carrier click-to-expand
  load details deliberately deferred to Phase 7 (integrity-gated).
- **Phase 4 SHIPPED (v2.2.0, 2026-07-08)** — board hygiene. Hub sink bands within each day:
  open → pinnedNight → covered/booked (then site → PU time). Admin approval stamps
  bookingApprovedBy/At via store.approveBooking (audited in history); "Cleared today"
  collapsible at hub bottom lists approvals stamped todayCentral (TMS imports carry no stamp
  on purpose — they'd flood it). Pending-admin bubble on the Admin nav link + Pending
  Approvals queue atop the Admin page aggregates pending bookings + carrier registrations —
  Phase 6 fallout/chargeback approvals should join this SAME counter/queue.
- **Phase 3 SHIPPED (v2.1.0, 2026-07-06)** — read docs/phase3-pricing-console-consolidation.md.
  §3.1 classifier in app/src/pricing.ts: weekday=Mon–Thu; weekend=Fri/Sat/Sun + actual-date
  holidays + day-before; PLUS Caleb-resolved Live rule — a LIVE load on a NON-natively-live
  lane prices off the weekend band (liveUpgraded); natively-live lanes use normal calendar.
  §3.2 `integrity/{CONTRACT_trip}` collection (190 docs: 185 Console trips migrated
  peak→weekend + TRM revenue blocks from Master file; 371 bandHistory rows) + Integrity page
  (pricing-tier band edits w/ required reason code; TRM upload reconciles, never touches
  bands; Monday staleness banner >7d). §3.3 per-section auto-set Target/Ceiling buttons on
  hub (open loads only). Matrix/LaneEditor rate edits removed → deep-link #/integrity?trip=.
  Legacy lane.weekendRate/weekdayRate strings = fallback display only when no integrity rec.
  tools/migrate_pricing.py = the gh-financial migration (rerunnable). NEXT: validation period
  w/ Shay before Console (Netlify) decommission; FA2D3 PDF holiday nuance (day-after excludes
  minor holidays: MLK/Presidents/Juneteenth/Columbus/Veterans) noted for frequency engine.
- **FMCSA/MC validation** (deferred from carrier-verification v1): validate MC via FMCSA
  QCMobile API (needs a free webKey from mobile.fmcsa.dot.gov/QCDevsite — Caleb to register);
  name match, authority status, out-of-service check at registration/verification time.
- Status manager UI (statuses are code-side in `app/src/types.ts` DEFAULT_STATUSES)
- Carrier admin page / per-carrier history

## Future / Backlog

- Saved quick filters on Sales Hub (deferred).
- "Expired"/inactive trips: hide trips that are no longer active from the boards — Caleb
  wants to define the rule later (it is NOT simply past-PU-time); revisit with him.
- FMCSA/MC validation in carrier verification (needs free webKey — see Pending).

## Style

Caleb wants crisp, minimal, Apple-like UI; light/dark + 5 accent palettes; GH logo at
app/public/logo.png. Version badge in topbar (`APP_VERSION` in types.ts) — bump on every release.
