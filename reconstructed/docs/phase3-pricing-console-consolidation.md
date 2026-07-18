# Phase 3 §3.4 — Pricing Console analysis & consolidation recommendation

*Produced 2026-07-06 from an in-place review of `Desktop\Pricing Analyst` (the
"GH Pricing Console") and its live Firestore data in the `gh-financial` project.
This document is the input the §3.2 integrity-DB schema must incorporate.*

---

## 1. What the Console is

React + Vite + Firebase (`gh-financial`) web app on Netlify, used by the pricing
team (editors: Caleb, Shay, Tucker — hardcoded allowlist, mirrored in that
project's Firestore rules). Workflow: drop a LoadStop "Loads" export every ~2
days → margin-leak analysis over a 120-day rolling dataset → set per-trip
**target/ceiling bands** with a **reason code** → follow a cadence checklist →
Loom training embeds. A DAT RateView API hook was planned but not built.

## 2. Data model (live counts as of 2026-07-06)

| Collection | Count | Shape |
|---|---|---|
| `trips` | **185** | id = bare trip number (`1`, `325`, `1003`) ⇒ joins to Bravo `tripCode` `FA2D3-{id}`. Fields: `od_label`, `segment_type` (+`segment_override`), `load_type` (+`load_type_override`), **`target_weekday`, `ceiling_weekday`, `target_peak`, `ceiling_peak`**, `updated_at/by` |
| `rate_history` | **371** | per change: `trip_id`, `day_type` (weekday\|peak), target, ceiling, **`reason_code`**, `set_by`, `effective_date` — the audit trail §3.2 wants, already in production use |
| `dedicated_lanes` | **83** | dedicated book (from the Executive Margin report) + `config/dedicated`: **`fsc_rate` (0.75)** and **`benchmark` (0.11)** — first live FSC number in the ecosystem (Phase 8 needs it) |
| `imports` | 17 | import log (added/updated/pruned counts) |
| `checklist_runs` + `config/cadences` | 2 | cadence tracking ("pricing review run" every 48 h) |
| `config/learning` | — | Loom links (Phase 9 material) |
| `datasets/current/chunks` | — | the shared 120-day LoadStop dataset (analysis working set) |

## 3. Logic worth preserving exactly

- **Reason codes** (`CHOP-SOFT/LIVE/MKT`, `HOLD-OK/TIGHT`, `RAISE-CAP`, `WKND-TEST`) —
  adopt verbatim; they're embedded in 371 history rows.
- **Recommendation rules engine** (`rules.js`) — deterministic, no AI:
  extras → track cost only; dedicated + negative margin → **RECOVER (check FSC
  first), never chop**; ≥25 % booked over ceiling → HOLD/RAISE; peak covering
  easily (≥55 % ≤ target) → chop peak; ≥70 % booked ≤ target → CHOP toward
  `round(avg_cost × 0.97 / 5) × 5`; negative auction margin → REPRICE.
- **Status normalization**: exclude `Cancelled`/`Open` from baselines; keep
  `CompleteTONU` separate, never averaged into lane cost.
- **Extras**: trip prefixes `FEV/FOR/FOO` have unreliable USPS revenue —
  exclude revenue from margin, keep carrier pay in cost averages.
- **Preload origins**: Memphis, San Antonio, North-Texas metro list (editable),
  with per-trip override.
- **Margin verify**: recompute `rev − cost` and flag >$1 drift vs the export's
  Broker Profit column.
- **Segment classification** from trip-token shape: 2–4 digits = Dedicated,
  5 chars w/ letter = Auction, else Edge/non-postal.
- **Low-confidence threshold**: < 3 loads in 7 days ⇒ recommendations marked
  low-confidence.

## 4. ⚠️ The one conflict a human must decide: the band classifier

The Console and the Phase 3 plan **disagree** about which loads use which band:

| Question | Console (live today) | Phase 3 plan §3.1 (resolved w/ Caleb) |
|---|---|---|
| Band names | weekday / **peak** | weekday / weekend |
| Friday | **weekday** | weekend |
| Holidays | actual + **observed** dates (hardcoded 2026 list incl. Jul 3 observed) | **actual dates only**, computed, + FA2D3 extras |
| Day before holiday | not included | **included** in weekend band |
| **Live loads** | **always peak, any day** — "easy unload, carriers accept less" | not part of the definition |

**Recommendation:** adopt the plan's calendar (Mon–Thu vs Fri–Sun + actual-date
holidays + day-before) as the *date* classifier — it's the newer, deliberate
decision — **but keep the Console's Live-load insight as an explicit flag**
rather than silently dropping it: surface "Live" on the pricing screen so a rep
prices it aggressively, and revisit a formal live-band in Phase 8 with data.
**Needs Caleb's sign-off before §3.2 builds** — it changes which band each of
the 185 × 2 tuned bands maps to (Console "peak" ≈ plan "weekend" minus Fridays
minus day-befores, plus Live loads).

## 5. Consolidation recommendation

**Fold into Bravo Matrix (integrity DB, §3.2):**
1. `trips` bands + `rate_history` → migrate as the seed and the audit trail.
   Join key: Console `trip_id` ⇒ `FA2D3-{trip_id}` ⇒ lane `tripCode`. Bands
   land on a new `integrity` collection keyed by contract+trip, NOT on `lanes`
   (lane docs stay display-oriented; integrity is the source of truth that
   propagates to Matrix + Sales Hub read-only displays).
2. Reason codes, rules engine, extras list, preload origins, status
   normalization → port as config + pure functions (they're framework-free).
3. TRM upload (per Caleb decision #3): the weekly Master TRM import becomes a
   Bravo Matrix feature (pricing tier only), reconcile-don't-overwrite, with a
   **staleness flag when the newest TRM import is > 7 days old — expected
   refresh every Monday**.
4. `dedicated_lanes` + `fsc_rate`/`benchmark` → fold into the Phase 7
   dedicated-integrity work and Phase 8 profitability (log the numbers now).
5. Margin-leak analysis + cadence + Loom module → **later phases** (8 and 9);
   don't block Phase 3 on them. The 120-day dataset store need not migrate —
   Bravo already holds booked loads natively; the analysis engine reads those.

**Retire (after Caleb decision #2's validation period):**
- The Netlify deployment and the `gh-financial` pricing collections — freeze
  writes once Bravo's integrity DB is validated, keep read-only during
  transition, then decommission. Nothing else runs on those collections.

**Explicitly rejected:** pointing Bravo Matrix at `gh-financial` (two apps
sharing a Firestore = coupled rules, coupled failures). Migrate data, not infra.

## 6. Schema mapping (Console → integrity DB)

| Console | Integrity DB (proposed) |
|---|---|
| `trips/{n}` | `integrity/{contract}_{tripNumber}` e.g. `FA2D3_325` (contract = top-level dimension per decision #3) |
| `target_weekday`/`ceiling_weekday` | `bands.weekday.target/.ceiling` |
| `target_peak`/`ceiling_peak` | `bands.weekend.target/.ceiling` (subject to §4 sign-off) |
| `load_type` (+override) | `loadType` + `loadTypeOverride` |
| `segment_type` (+override) | `segment` + `segmentOverride` |
| `rate_history` rows | `integrity/{id}/bandHistory` subcollection (same fields) |
| — (new) | `trm` block: `currentRate/Eff/Exp`, `pendingRate/Eff/Exp`, miles, hours, freqCode, NASS codes — synced from Master TRM upload, revenue side |
| — (new) | `trmMeta/latest`: file name, imported at/by → drives the Monday staleness flag |
| `config/*` | `config/pricing` doc in Bravo |

Editing: per-load/trip only (never bulk-by-lane, per plan §3.2); pricing tier
(`pricing_rep`/`pricing_manager`/owner) via Phase 2 rules; Matrix lane rates
become read-only with an "Edit in Integrity" deep-link for the pricing tier.

## 7. Locked decisions (Caleb, 2026-07-06)

1. Master TRM = lane/schedule/revenue authority; Console bands = target/ceiling seed authority. ✔
2. Console decommissions only after extensive parallel validation in Bravo. ✔
3. TRM arrives by manual upload, **as a Bravo Matrix feature**; contract is a top-level dimension. ✔
4. Weekly reconcile never overwrites tuned bands; stale-data flag if not refreshed weekly (Mondays expected). ✔
5. Matrix inline rate edits removed; pricing tier deep-links to integrity. ✔

**Open before build:** the §4 classifier decision.
