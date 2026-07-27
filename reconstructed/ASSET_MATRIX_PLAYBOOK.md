# GH Asset Matrix — Master Playbook

**The single source of truth for the Asset Matrix app.** This document is the
map of what exists, what version is live, how to roll back, and what each
section does — so you can always point to a known-good state and say "revert to
this," and so you (or anyone helping) can see exactly what each part is supposed
to do before changing it.

> Keep this doc updated on every version. When you push a change you like, the
> version table below becomes your safety net: if a later change breaks
> something, tell me **"revert to v0.X.0"** and I'll bring the live site back to
> that exact commit.

---

## 1. What this is

The **Asset Matrix** is an **asset-side TMS** — a dispatch + operations system
for **GH Logistics' own trucks** (the asset fleet). It is a **separate app** from
Caleb's **Bravo Matrix** (the brokerage coverage board).

- **Live site:** https://asset-matrix-gh.web.app  (Firebase project `asset-matrix-gh`)
- **Repo:** `derrickbruno28-cmyk/Master-Dispatch-Bravo`
- **App code lives in:** `reconstructed/asset/`
- **Working branch:** `claude/github-repo-test-shared-files-nzn5pe` (and `main`)
- **Owner:** Derrick Bruno

### How it relates to Bravo Matrix (the merge plan)
Asset Matrix and Bravo Matrix are **mostly independent**. They run OUR asset
fleet vs. the brokerage board separately. The **only real hand-off** between them
is the **USPS reps** we're assigned from the brokerage side — those routes flow
from Bravo into the Asset Matrix schedule. Everything else (our trucks, drivers,
HOS, fleet map, financials, maintenance) is asset-only and does not need to talk
to Bravo. When we merge, we keep that boundary: shared USPS rep/route data in,
asset operations kept independent.

---

## 2. How revert works (your safety net)

Every version below is a **git commit**. The live site always reflects the
latest commit pushed to `main` (auto-deploys via GitHub Actions → Firebase).

**To roll the live site back to a known-good version:** tell me
**"revert Asset Matrix to v0.X.0"** (or give the commit SHA). I will reset the
branch to that commit and redeploy — the live site returns to exactly that state.

The mechanics I run (for reference):
```
git checkout main
git reset --hard <commit-sha>      # e.g. the v0.7.0 SHA
git push --force-with-lease origin main
```
That triggers the auto-deploy and the site is back to that version in ~1 minute.
Because every version is a commit, we can always go forward again too.

---

## 3. Version history & revert points

Newest first. **Current live version is flagged.** Use the SHA to revert.

| Version | Commit | Date | What it added |
|--------|--------|------|----------------|
| **v0.44.0 ← LIVE** | `2bfa399` | 2026-07-26 | **Truck P&L** (Financials → Truck P&L): revenue per truck split BY LEG MILES so a relay doesn't credit the linehaul to the shuttle, rev per day worked, deadhead %, OTP/OTD per truck, exception count, and a click-through to every load that truck ran. Also fixed: stops and milestones now persist in demo mode |
| v0.43.0 | `c5f5462` | 2026-07-26 | **Phase 10 — trailers + cleanup.** Trailer combobox (warns, never blocks), inline "+ Add trailer", CSV import; the ten stale-UI fixes incl. the merged Fleet page, the enum Booking Authority, Booking Terminal on the load, clickable Loads ledger, and destructive tools moved to a hidden `#admin` |
| v0.42.0 | `2346633` | 2026-07-26 | **Phase 9 — financials + Ready For Accounting.** Computed rate/FSC/revenue/CPM strip, miles from stops, Billing work queue with per-row blocked reason + CSV, authority/terminal splits on every report |
| v0.41.0 | `3a5ca6f` | 2026-07-26 | **Phase 8 — rate con parsing.** USPS trip-ID engine (all 9 fixtures), labeled-field extraction, field-by-field review screen, Load Repository variance flags, source PDF auto-attached as RATE_CON |
| v0.40.0 | `6aa6e5e` | 2026-07-26 | **Phase 7 — notes + record locking.** Threaded categorised notes (soft delete only), inline note on the board cell, heartbeat lock enforced in Firestore rules with Ask-to-close and audited Force unlock |
| v0.39.0 | `db2533d` | 2026-07-26 | **Phase 6 — OTP/OTD derived.** The manual "+ Log Shipment" form deleted; every row read from milestones, Pending excluded from the percentage, Late Reasons report by reason/driver/terminal/customer |
| v0.38.0 | `9d82a53` | 2026-07-26 | **Phase 5 — exceptions + replacement loads.** Exception log, preview-then-commit spawn carrying stops and appointments forward (never actuals), leg cancelled with reason, lineage banners both ways |
| v0.37.0 | `ad87912` | 2026-07-26 | **Phase 4 — documents + billing gate.** Ready For Accounting unreachable without BOL + POD, enforced in the rules; board paperwork chips; `tools/test_rules.py` regression suite |
| v0.36.0 | `df05439` | 2026-07-26 | **Phase 3 — stops + Load Repository.** Appointment windows, trip typeahead with a diff preview, create-a-load from a repository row |
| v0.35.0 | `4eeb544` | 2026-07-26 | **Phase 2 — milestone engine.** Ordered ladder per stop, mandatory source tag, detention, Samsara variance, board status derived from milestones, one-tap ⚡ fast-log |
| v0.34.0 | `f73366b` | 2026-07-26 | **Phase 1 — multi-leg assignments.** A load carries 2+ legs, each with its own truck/trailer/drivers/authority; the board draws every leg with a "leg 1 of 2" chip |
| v0.33.1 | `edc158f` | 2026-07-26 | **Phase 0 — the TMS data model.** Schema v2, audit stamping, append-only audit log, additive migration with a review screen, enumerated Firestore rules, composite indexes |
| v0.32.0 | `af90ac0` | 2026-07-24 | Fleetio disconnected — the sync is off, the July-24 service statuses stay on the Trucks page |
| v0.10.0 | — | 2026-07-24 | **Shared user roster:** everyone who signs in auto-populates the Roles tab (first shared-Firestore data). New sign-ins appear with the FMT default (edit, no delete); the owner just assigns a role. No more typing emails by hand |
| v0.9.0 *(staged on branch — not yet live)* | `12ae216` | 2026-07-24 | Fleet Map rebuilt on **MapLibre GL**: real vector basemap (OpenFreeMap, no key), native zoom/pan, truck markers that glide as GPS updates, weather/traffic/geofence layers, base-map switcher with Satellite/Hybrid/Terrain gated on a MapTiler key |
| v0.8.0 | `1476a69` | 2026-07-24 | Samsara integration scaffold (adapter + Integrations page), HOS-gated next-route suggestions on the calendar, first Samsara-style Fleet Map (SVG), geofence import, Drivers→"Driver Availability" rename |
| v0.7.0 | `7138e96` | 2026-07-24 | Navigation overhaul: collapsible left side-panel nav, minimal top bar, universal search replaced with separate Driver / Team / Route look-up filters |
| v0.6.0 | `423ec8f` | 2026-07-23 | Loads Phase 3: first Fleet Map, Out-of-Service (Fleetio) board + matrix row-lock, rate-con PDF auto-fill |
| v0.5.x | `254437f` | 2026-07-23 | Loads Phase 2: split / relay loads, Financials analytics (Revenue/CPM, by customer, by truck, driver miles) |
| v0.5.0 | `5d3d627` | 2026-07-23 | Loads Phase 1: rich Load records, Load Detail modal, Documents tab, dispatch sheets, integration-layer scaffolding |
| — | `da5c2af` | 2026-07-22 | Fix: theme storage infinite-recursion bug |
| — | `30907e6` | 2026-07-22 | Global search, frozen table headers, Drivers CSV export, gated Roles tab |
| — | `0beb8b2` | 2026-07-21 | Role-based permissions, cross-city pickup flag, sign-in hardening |
| — | `3dd54ce` / `789dc31` | 2026-07-21 | Mobile + desktop Google sign-in fixes (popup/redirect) |
| — | `9e7af26` | 2026-07-20 | Imported all USPS routes from Bravo (79 → 187) |
| — | `6701ae5` | 2026-07-20 | Auth gate + Firebase hosting (deploy-ready base) |

> **Known-good checkpoints to remember:** v0.32.0 (everything before the TMS
> execution layer), v0.37.0 (the billing gate lands — the first version where
> money depends on a rule), v0.43.0 (current).

---

## 4. Architecture (how it's built)

- **Stack:** React 19 + TypeScript + Vite. Single-page app.
- **Data today:** **Firestore**, shared across the team, with localStorage as the
  demo fallback (`window.__ASSET_FB__ = {}` forces demo mode). The board still
  renders from the `assetSchedule` cell index; the TMS record hangs off
  `loads/{id}` with subcollections for `assignments`, `stops`, `milestones`,
  `documents`, `exceptions`, `notes` and an append-only `audit`.
- **Migration posture — additive, always.** New schema is added ALONGSIDE the
  legacy fields, never in place of them, and legacy `stops[]`/`segments[]` are
  MIRRORED into subcollections rather than moved. Subcollection reads are
  read-through: a real doc when one exists, otherwise synthesized from the legacy
  array. That is why no phase ever required a migration to be usable.
- **Every write is stamped** with `createdBy` / `createdAt` / `updatedBy` /
  `updatedAt` (the signed-in email, ISO-8601 strings). `createdBy` is immutable
  once set, enforced in the rules.
- **Derived flags live on the load** (`missingBol`, `missingPod`,
  `hasOpenException`, `noteCount`, `latestNote`) because a board cell cannot open
  a subcollection per truck-day — and because Firestore rules cannot query one
  either, which is what makes the billing gate enforceable.
- **Auth:** Google sign-in, restricted to company domains. In demo/preview mode
  it runs without auth so the UI can be reviewed.
- **Deploy pipeline:** push to `main` (or the working branch) → **GitHub Actions**
  builds and deploys to Firebase Hosting. **No API keys or tokens ever go in
  chat** — the only secret is the Firebase deploy token stored in the repo's
  encrypted Actions secrets.
- **Integration-adapter layer (the important pattern):** every external service
  (Samsara, Fleetio, mapping, routing, documents, rate-con parsing) sits behind
  a **clean interface with a mock implementation now**. The app is fully
  functional on realistic placeholder data today; when a real backend/key is
  added behind the adapter, the same UI goes live with **zero front-end changes**.
  - `integrations/samsara.ts` — Driver HOS, truck GPS, geofences (ONE adapter)
  - `integrations/telematics.ts` — Fleetio (maintenance / out-of-service)
  - `integrations/mapdata.ts` — weather + traffic (Fleet Map overlays)
  - `integrations/routing.ts` — lane miles / CPM
  - `integrations/documents.ts` — load documents (local now, Firebase-ready)
  - `integrations/ratecon.ts` — rate-con PDF text extraction (pdf.js, no key)
- **The TMS layer** (`src/data/tms/`): `types` (schema + enums), `stamp` (audit),
  `migrate`, `assignmentsStore`, `stopsStore`, `milestonesStore`, `documentsStore`,
  `exceptionsStore`, `notesStore` (+ locking), `rateconParse`, `performance`
  (OTP/OTD), `financials`, `billing`.
- **Two test harnesses:** `tools/test_rules.py` (33 Firestore-rules cases against
  Google's rules-test API — no emulator needed) and `npm run test:tripids` (the
  nine USPS trip-identifier fixtures, run against the shipped module so the test
  cannot drift from the regex).

---

## 5. Section-by-section reference

For each section: **what it's for**, **what it does now**, and **what's stubbed /
planned**. This is the map for deciding what to change.

### Navigation & shell (v0.7.0)
- **Purpose:** move around the app.
- **Now:** minimal top bar (menu · GH brand · light/dark · DEMO badge). A
  collapsible **left side panel** groups every page: **Dispatch** (Asset Matrix,
  Route Optimizer, OTP/OTD, Routes Covered), **People** (Driver Availability,
  Roles), **Fleet** (Fleet Status, Fleet Map, Out of Service), **Financials**
  (4 pages), **Setup** (Integrations). Overlay drawer on mobile, push column on
  desktop.
- **Look-ups:** three separate filters below the header — **Driver**, **Team**,
  **Route** — each with its own results dropdown; picking one jumps to that page.

### Asset Matrix (the scheduling board)
- **Purpose:** the weekly dispatch board for our trucks.
- **Now:** trucks grouped by terminal (SATX / Dallas / Memphis / Houston), days
  Mon→Sun. Each cell is an assignment with a color status
  (Open→Covered→Dispatched→At Yard→At Shipper→En Route→At Receiver→Delivered→
  Completed). Create Load, drag to move, doc badges, one-tap dispatch. Delete is
  permission-gated. Out-of-service trucks are **row-locked** (greyed, can't
  assign). **HOS next-route suggestions**: the day after a team's assignment
  shows "N optimized route suggestions" → top-5 routes from the Route Optimizer,
  ranked/gated by that team's remaining hours; click to assign.
- **Stubbed/planned:** shared Firestore data (multi-user); HOS comes from the
  Samsara adapter (mock until backend).

### Route Optimizer
- **Purpose:** plan a team's next load from where they finish, within a deadhead
  radius, ranked by deadhead miles + hours + homeward pull.
- **Now:** pick a truck, radius, "ends at" city, HOS hours → ranked route list,
  assign to a day. Feeds the matrix next-route suggestions.
- **Planned:** auto-pull HOS + "ends at" from Samsara instead of manual entry.

### OTP / OTD
- **Purpose:** on-time performance / delivery tracking.
- **Now:** metrics view. **Planned:** wire to real load status timestamps.

### Routes Covered
- **Purpose:** at-a-glance coverage of USPS routes.
- **Now:** coverage view. **Planned:** tie to the shared USPS rep data from Bravo.

### Driver Availability (renamed from "Drivers", v0.8.0)
- **Purpose:** the master driver roster + availability hub.
- **Now:** full driver list, search, availability flags/alerts (ready date,
  return date, overdue), CSV **Export** (roster comparison) + Import, add/edit,
  home-city. Delete is permission-gated.

### Roles
- **Purpose:** permissions. **Visible only to role-managers (Anna, Caleb, you).**
- **Now:** 4 roles — **Owner** (full control incl. assigning roles), **FMT Lead**
  and **US Ops** (everything except assigning roles), **FMT** (edit-only: add/
  remove info but **never** delete loads/drivers/teams). Role legend, demo role
  switcher, owner-only "who can manage roles."
- **Team roster (v0.10.0):** everyone who signs in **auto-populates** the Team
  table (shared `assetUsers` Firestore collection — the first shared data). A new
  sign-in shows up with the **FMT default (edit, no delete)**; you just pick their
  role from the dropdown. Shows name · email · last-signed-in. You can also
  pre-add someone before they sign in. ↺ resets a person to the FMT default.

### Fleet Status
- **Purpose:** the live status of every truck/team (NTB, deadhead, reset,
  dispatched, shutdown), flyer/confirmation tracking, cross-city pickup flags.
- **Now:** editable fleet cards; sets the team status that shows on the matrix.

### Fleet Map  (rebuilt on MapLibre GL in v0.9.0)
- **Purpose:** live GPS map of the whole fleet.
- **Now (v0.9.0):** a **real MapLibre GL map** — real vector street basemap
  (OpenFreeMap, no key), native scroll/pinch **zoom** + pan, and **truck markers
  that glide** toward new GPS as positions poll through the Samsara adapter
  (en-route trucks are simulated moving until the live backend is wired). Weather,
  traffic (colored interstates + shields), and geofences are real toggleable
  layers. Base-map switcher: Streets / Light (free) + **Satellite / Hybrid /
  Terrain** which unlock when a MapTiler key is added on Integrations.
- **Planned:** wire real Samsara GPS behind the adapter → the markers move on real
  positions; add the MapTiler key → satellite imagery (the full Samsara look).

### Out of Service (Fleetio)
- **Purpose:** maintenance board; flag a truck out of service.
- **Now:** flagging a truck **row-locks it on the Asset Matrix** (can't be
  assigned) until cleared. Fleetio is the intended source of truth.
- **Planned:** sync real "Out of Service" vehicles from Fleetio (token later).

### Financials
- **Purpose:** revenue & CPM analytics off the load records.
- **Now:** four pages — Revenue/CPM by lane, by Customer, by Truck/Team, Driver
  Miles. KPI cards (revenue, loads, miles, avg CPM), week/month/all + terminal
  filters, CSV export. Split-load revenue attributes per segment.

### Integrations (Setup) — Samsara connection (v0.8.0)
- **Purpose:** connect external telematics. **This is where you'll paste the
  Samsara API key.**
- **Now:** paste-your-key field (stored in the **browser only, never in code**),
  connection status indicator, and three feature tiles — **Driver HOS**,
  **Truck GPS Tracking**, **Geofence Import** — all reading from **one shared
  Samsara adapter**. Status reads "key saved · backend pending" until the real
  backend exists (it deliberately never claims "connected" before it's true).
  A Fleetio card is shown too.
- **Planned:** wire the real backend behind the adapter → HOS, GPS, and geofences
  all go live with no UI changes.

---

## 5A. The TMS Execution Layer — how to actually use it

Phases 0–10 turned the board into an execution system. This section is the
day-to-day how-to. The order below is the order the work happens.

### The one idea that runs through all of it
**Nothing parsed or inferred is written without a review screen, and nothing
important is asserted without being enforced on the server.** The migration, the
trip picker, the exception spawn and the rate-con reader all show you a preview
first. The billing gate and the record lock are both enforced in
`firestore.rules`, not just in the UI — because a rule that lives only in the
browser is a suggestion.

---

### Booking a load

Open a cell on the board, or press **➕ Create Load**.

**Load Info** carries the shell: route name, customer, equipment, rate, FSC,
weight, references, **Booking authority** (the five-entity picker) and **Booking
terminal**. Authority and terminal are what let every report say *whose* revenue
it is — a load without them disappears from its own company's numbers.

**Assignments** is where the trucks go. One block per leg:

- Leg 1 is the truck the board draws first. Its truck, trailer and drivers are
  mirrored back onto the legacy fields, so nothing that reads the old shape
  breaks.
- Add a leg when a local shuttle hands off to an OTR team. Set each leg's stop
  range. The board then draws the load on **both** truck rows with a "leg 1 of 2"
  chip, so nobody reads them as two loads.
- **An out-of-service truck blocks.** A driver availability problem only warns.
  Equipment that cannot legally move is a hard stop; a person is a judgement call
  and stays yours.

**Trailer #** is a combobox. Type anything — free text always wins. It offers
matches from the trailer list, fills in the type, warns if the trailer is In Shop
or already on another unfinished load, and offers **+ Add trailer #53044** if the
number is new. It never blocks the save.

**Dropping a rate con** on the drop zone opens the review screen instead of
filling the form. See below.

### Running a load — the milestone ladder

**Milestones** is the tab that moves the truck. Every stop has an ordered ladder:

> En Route → At Pickup → Loading Started → Loading Completed → Detention Begin →
> Detention Ended → Pickup Completed  *(deliveries mirror it)*

Three things are enforced:

1. **Order.** You cannot log Loading Completed before At Pickup.
2. **A source on every rung** — 🚚 driver, 🖥 dispatch, 📡 Samsara. There is no
   unsourced option, because without it you cannot tell a witnessed time from a
   typed one, and every number downstream inherits that ambiguity.
3. **A structured late reason** on any completion that lands after the
   appointment. It will not save without one.

**The board status follows automatically.** You should never type a status again.
Covered → Dispatched → En Route → At Shipper/At Yard → At Receiver → Delivered →
Completed all derive from what has been logged. **Completed only becomes
available once the load is billable** — a load does not end at delivered, it ends
when accounting can invoice it.

**The ⚡ on a board cell** logs the next required milestone in one tap, with the
late-reason picker inline. That is the fast path for a dispatcher on the phone.

**Detention** computes from Detention Begin/Ended. If those were not logged it
falls back to arrival and departure and *says* it inferred the number.

### Stops and appointments

**Stops** holds the appointment date, window open, window close and a Confirmed
flag per stop. The **trip search** pulls a route out of the Load Repository and
shows you a **diff** — what the repository holds against what the load has —
with anything that would overwrite your typing marked as a conflict and switched
off by default. Apply writes only what you left on.

### When a run breaks — exceptions

**Exceptions** → **Log an exception**. Pick what happened, which leg, and the stop
a replacement would start from, and write a reason (required — it is what the
customer gets told).

**Preview replacement load** shows exactly what would be created:

- **Carries forward:** customer, authority, terminal, equipment, commodity,
  weight, references, trip numbers, rate, and every stop from the break point on
  **with its appointment window**.
- **Does not carry:** arrival/departure actuals, logged milestones and detention,
  truck/drivers/trailer, documents. The replacement truck has not been anywhere,
  and copying an arrival it never made would forge the on-time record.

Confirm and you get a new load in the **Unassigned tray** (spawning creates the
work; dispatch decides who runs it), the original leg marked cancelled with your
reason, a banner on each load pointing at the other, and a **⚠** on the board.

If no pickup carries forward, the preview says so — a recovery load usually has
to go *collect* the freight from wherever the truck stopped, and that address is
not in the plan. It will not invent one.

### Paperwork and billing

**Documents** is where the money gets unlocked. The banner at the top is the
first thing on the tab and it names the missing document rather than just
refusing.

- Files are named `{load#}-{DOCTYPE}-{MM-DD-YYYY}.{ext}` automatically.
- BOL and POD default to **Withhold** (they do not ship with the invoice);
  everything else defaults to **Deliverable**. Both are per-document editable.
- **A load cannot reach Ready For Accounting without a BOL and a POD.** Uploading
  the last missing one lifts the status by itself.
- Delete is restricted — FMT can never delete a document.

**The billing state machine**

```
NOT_READY
   ↓ final Delivery Completed logged        (automatic)
MISSING_DOCS
   ↓ BOL + POD both attached                (automatic)
READY_FOR_ACCOUNTING
   ↓ by hand
INVOICED  →  PAID
side branches, any state: ON_HOLD · CANCELLED_TONU
```

**Financials → Billing** is the queue between delivered and invoiced. Grouped by
status with counts and revenue, filterable by authority / terminal / customer /
date, and every row says what is holding it up in the words you would use on the
phone — "waiting on POD", not "missing docs". Click a row to open the load.
**Export CSV** is the handoff artifact until invoicing lives in here.

### Reading a rate con

Drop the PDF on **Load Info**. You get a review screen: every field with its
value, its target, a confidence, and a **Take / Skip** toggle.

- **USPS documents** are recognised by their trip identifier. The separator is
  `-` or `_`, one identifier can carry several trip numbers, and the prefix is
  not always FA2D3 — `FA2D3_1019_071426_1` reads as route **FA2D3** with trips
  **1019 / 071426 / 1**. Anything that does not match is listed as *unrecognized*
  rather than guessed at.
- If the trip is in the Load Repository, any **disagreement** on miles, rate band
  or pickup time is listed first and starts switched **off**. A rate con that
  contradicts the contract is a conversation, not a value to accept.
- The source PDF is attached as **RATE CON / Deliverable** either way.
- A scan with no text layer is called a scan. There is no OCR; it will not guess
  at an image.

### On-time performance

**OTP / OTD** takes no input. Every row is derived from the loads and their
milestones, so the on-time number and the board can never tell two stories.
**Unlogged is not on-time** — a stop nobody logged stays out of the percentage,
and the UNLOGGED count next to it is how you tell "we were late" from "nobody
logged it". The **Late Reasons report** groups by reason, driver, terminal or
customer, and a load that was late out AND late in counts as two failures with
two causes.

### Notes and who has the record

**Notes** is a thread, not a text box. Every note carries the author, the time and
a category; Late Reason notes render in the warning colour. **Notes are never
deleted** — hiding one keeps the document and logs who hid it. The board cell
shows the most recent note inline with a 💬 count, so nobody has to open a card
to find out the receiver called.

**Locking.** Opening a load claims it. The card beats every 60 seconds and lets
go on close, on save and on the tab closing; five minutes of silence frees it, so
a closed laptop heals itself. A second person gets a read-only card naming the
holder, an **Ask them to close it** button (which posts in the thread they are
already looking at), and — for Owner / FMT Lead / US Ops — a **Force unlock**
that is audited with the name of the person whose claim was broken. It is
enforced in the rules, so the second tab cannot save either.

### Who can do what

| | Owner | FMT Lead | US Ops | FMT |
|---|---|---|---|---|
| Edit loads, log milestones, upload docs, post notes | ✔ | ✔ | ✔ | ✔ |
| Delete a load / driver / document / exception | ✔ | ✔ | ✔ | ✘ |
| Force a record lock | ✔ | ✔ | ✔ | ✘ |
| Assign roles | ✔ | ✘ | ✘ | ✘ |
| Hidden `#admin` page | ✔ | ✘ | ✘ | ✘ |
| Delete a note or an audit entry | ✘ | ✘ | ✘ | ✘ |

The last row is not a mistake. Notes soft-delete and audit entries are
append-only for everyone, owner included.

---

## 5B. Running the safety checks

**Before every rules deploy:**

```bash
cd reconstructed/asset
python3 tools/test_rules.py     # 33 cases against Google's rules-test API
```

It evaluates the rules **source**, so it runs before publishing rather than
after. It covers the billing gate, the record lock, FMT's delete ban, the
append-only audit and owner-only role assignment.

**The trip-ID fixtures:**

```bash
npm run test:tripids            # the 9 USPS identifiers + an in-document scan
```

**Deploying rules** is a separate manual workflow (`deploy-asset-rules`,
workflow_dispatch only). Rules must never deploy as a side effect of a push.


---

## 6. Integrations roadmap (what's stubbed vs. what's needed)

| Integration | Powers | State | To go live |
|-------------|--------|-------|-----------|
| **Samsara — Driver HOS** | next-route suggestion ranking/gating | mock (from fleet hours) | API key + backend proxy behind `samsara.ts` |
| **Samsara — Truck GPS** | Fleet Map truck positions / tracking | mock (parked at last city) | same adapter; poll positions, animate markers |
| **Samsara — Geofences** | yard/customer zones on the map | mock set | same adapter; import real geofences |
| **Fleetio** | Out-of-Service board + matrix lock | mock | Fleetio token |
| **Mapping/tiles** | the Fleet Map base map | hand-drawn SVG | real map engine (see §7) |
| **Routing** | lane miles / CPM | estimate (haversine ×1.2) | Google/Maps key for exact miles |

**Golden rule:** keys are pasted into the app's Integrations panel or set as
encrypted deploy secrets — **never in chat, never hardcoded.**

---

## 7. Fleet Map redesign — design options

> **STATUS: Option A shipped in v0.9.0** (real MapLibre map, real zoom, moving
> trucks — no key). **Option B is one free key away:** add a MapTiler key on the
> Integrations page and Satellite / Hybrid / Terrain turn on. Option C remains a
> later choice.

The original map was a hand-drawn SVG. It works for a demo but looks plain and
doesn't do real geography, real zoom, or moving trucks. To look like **Samsara**
(which is built on Mapbox GL), we move to a **real map engine**. Here are the
options, honest about the key/cost trade-offs:

### Option A — Real street map, **no key** (MapLibre GL + free tiles)
- Open-source engine (same family as Samsara's Mapbox GL). Real streets, labels,
  smooth scroll/pinch zoom, pan. Truck markers glide as positions update.
- Tiles from free OpenStreetMap / open vector styles — **no API key, no cost.**
- Look: clean street map (light + dark). **No satellite** without a key.
- **Best if:** you want a real, precise, zoomable map live **today** with zero
  setup, and satellite isn't essential yet.

### Option B — **Samsara look**: satellite + hybrid + terrain (MapLibre GL + MapTiler/Esri)  ⭐ recommended
- Same engine, plus **satellite, hybrid, terrain, and streets** base layers, real
  traffic, live zoom — the true Samsara feel.
- Needs a **free-tier key** (MapTiler free tier, or Esri World Imagery). Paste it
  into the Integrations page exactly like the Samsara key. Paid tier only if we
  hit high volume.
- **Best if:** you want it to look like Samsara (satellite + roads + labels +
  traffic) with real zoom and moving trucks. Start on the free tier.

### Option C — Full commercial (Google Maps or Mapbox)
- The most polished — native live traffic, Street View, best labels.
- Needs a key **with billing enabled**; cost scales with usage.
- **Best if:** later, at scale, you want best-in-class native traffic/Street View.

### Moving trucks (applies to every option)
Truck markers update from Samsara GPS on a short interval and **animate smoothly**
between points, so once the Samsara backend is live you literally watch the fleet
move across the map, each pin tied to its Asset Matrix row.

### My recommendation
**Build Option A now** (real, zoomable, no key — an immediate, dramatic upgrade),
and structure it so flipping on **Option B satellite** is just dropping a MapTiler
key into the Integrations page — same pattern as Samsara. That gets you a real map
today and the full Samsara look the moment you add one free key.

---

## 8. Open items / next up

**From the TMS build (see `asset/docs/TESTING-GUIDE.md` for the full list):**

- **Run the migration on live data.** Preview it, read the conflicts, take a
  Firestore export first.
- **Deploy the rules.** `python3 tools/test_rules.py` → then the manual
  `deploy-asset-rules` workflow. The billing gate and the record lock are only
  enforced once those rules are published.
- **OCR for scanned rate cons** — not built. The review screen says so instead of
  guessing. Needs a vision model behind the existing interface, plus a key.
- **Real rate cons** — drop ten of yours and tell me which fields came back wrong.
  The extractor can only be tuned against documents I have seen.
- **Invoicing** — the Billing queue and its CSV are the handoff artifact. Actual
  invoice generation is not built.

**Older items still open:**

- **Fleet Map redesign** — pick Option A / B / C above; I'll build it.
- **Dispatch deep-dive** — driver sheets and the send flow.
- **Samsara backend** — wire the real HOS + GPS + geofence API behind the adapter
  (you're doing the backend; front-end is ready).
- **Equipment + customer lists** — provide the LoadStop van/equipment types and
  the starting customer list to replace the placeholders.
- **Shared Firestore** — move remaining data off per-browser localStorage to
  shared, multi-user Firestore. *(Started: the user roster `assetUsers` is the
  first shared collection, v0.10.0.)*
- **Bravo merge** — bring the assigned USPS rep/route data across from Bravo;
  keep asset operations independent otherwise.

---

*Last updated: 2026-07-26 · live = **v0.44.0** (`2bfa399`) — the TMS Execution
Layer, Phases 0–10, shipped and deployed. Ask me to update this doc whenever we
ship a new version.*
