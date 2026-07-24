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
| **v0.8.0 ← LIVE** | `1476a69` | 2026-07-24 | Samsara integration scaffold (adapter + Integrations page), HOS-gated next-route suggestions on the calendar, Samsara-style Fleet Map (satellite/terrain/weather/traffic/zoom), geofence import, Drivers→"Driver Availability" rename |
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

> **Known-good checkpoints to remember:** v0.6.0 (features complete, classic top-tab nav), v0.7.0 (new side-panel nav), v0.8.0 (Samsara scaffold — current).

---

## 4. Architecture (how it's built)

- **Stack:** React 19 + TypeScript + Vite. Single-page app.
- **Data today:** browser **localStorage** per device (demo-safe). Designed to
  move to **Firestore** (shared, multi-user) — the write paths already exist.
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
  - `integrations/ratecon.ts` — rate-con PDF parsing

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
  switcher, per-user assignment, owner-only "who can manage roles."

### Fleet Status
- **Purpose:** the live status of every truck/team (NTB, deadhead, reset,
  dispatched, shutdown), flyer/confirmation tracking, cross-city pickup flags.
- **Now:** editable fleet cards; sets the team status that shows on the matrix.

### Fleet Map  ⚠ redesign planned — see §7
- **Purpose:** live GPS map of the whole fleet.
- **Now:** a hand-drawn US map (SVG) with truck pins by status, satellite/terrain
  toggle, national weather overlay, traffic congestion coloring, interstate
  shields, zoom-dependent state/city labels, geofence import. **This is the piece
  being upgraded** — see the redesign options in §7. Positions come from the
  Samsara adapter (mock until backend).
- **Planned:** real map engine, real zoom, and **trucks that move** as GPS
  updates come through the Samsara API.

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

## 7. Fleet Map redesign — design options (pick one)

The current map is a hand-drawn SVG. It works for a demo but looks plain and
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

- **Fleet Map redesign** — pick Option A / B / C above; I'll build it.
- **Dispatch deep-dive** — you want to revisit the dispatch piece (driver sheets,
  send flow). Parked for the next session.
- **Samsara backend** — wire the real HOS + GPS + geofence API behind the adapter
  (you're doing the backend; front-end is ready).
- **Equipment + customer lists** — provide the LoadStop van/equipment types and
  the starting customer list to replace the placeholders.
- **Shared Firestore** — move data off per-browser localStorage to shared,
  multi-user Firestore.
- **Bravo merge** — bring the assigned USPS rep/route data across from Bravo;
  keep asset operations independent otherwise.

---

*Last updated: 2026-07-24 · reflects v0.8.0 (`1476a69`). Ask me to update this
doc whenever we ship a new version.*
