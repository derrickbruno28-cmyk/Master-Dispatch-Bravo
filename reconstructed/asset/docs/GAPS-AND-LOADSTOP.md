# What doesn't map, what could go, and what to bring back from LoadStop

Written for the next round: take this into Claude-in-Chrome with LoadStop open,
work down Part 3, and come back with what you find. The items are phrased as
questions I need answered, not as features to admire.

---

# PART 1 — Things in the site that don't map to how you run

These are candidates to remove. Nothing here is broken; each one is either a
leftover, a duplicate, or something built on an assumption that turned out to be
wrong. **My recommendation is in the last column. None of it is done — say the
word and it goes.**

| # | What | Why it doesn't map | Recommendation |
|---|---|---|---|
| 1 | **Route Optimizer** | Ranks next routes from a truck's radius, "ends at" city, and manually typed HOS. Real dispatch decides from the contract schedule and who is sitting where — and the HOS number is typed by hand, so the ranking is only as good as a guess somebody entered. | **Keep, but demote.** Fold it into the board's next-route suggestions (which already exist on the cell) and drop the standalone page. It becomes useful the moment Samsara HOS is live; until then it is a page nobody opens. |
| 2 | **Routes Covered** | A coverage view over the USPS route list. Overlaps heavily with the board itself and with the Loads ledger. | **Ask first.** If somebody uses it daily it stays. If it is a leftover from the Bravo import, delete it. |
| 3 | **Fleet Map** | Beautiful, and running on mock GPS. Zero Samsara orgs are connected, so every truck on it is a simulation. | **Keep, gate it.** It should say "simulated positions" in the header until a real org is connected — the same honesty fix as the geofence button in Phase 10. |
| 4 | **Driver Miles report** | Miles per driver, computed from load attribution. It is a settlement input, and there is no settlement. | **Keep.** It costs nothing and it is the first thing you will need if driver pay ever moves in here. |
| 5 | **The `loadType` field (TL / LTL)** | Never shown, never required, never used in a decision. The real "load type" question you ask is Live Load vs Drop vs Hook — which now lives on the stop as `stopAction`. | **Remove the field**, keep the stop action. |
| 6 | **`segments[]` (the old split-load model)** | Superseded by Phase 1 legs. It still exists because live loads carry it and the read-through synthesizes legs from it. | **Keep until the data is migrated**, then delete both the field and the synthesizer. This is real cleanup with a real prerequisite. |
| 7 | **Rating (A/B/C/D) on trucks** | Ported from the odometer-based Fleetio import that no longer runs. Nothing reads it. | **Ask.** If you rate trucks for real, it should drive something (assignment preference, at minimum). If not, delete the column. |
| 8 | **Customers as free text** | `customerName` is typed, with a datalist. Booking Authority is now an enum and Booking Terminal is now an enum; customer is the last free-text field that ends up in reports, which means "USPS", "U.S.P.S." and "usps" are three customers. | **Make it a real list**, the way authority went. This is the single highest-value cleanup left on the load form. |
| 9 | **The demo role switcher** | `asset-demo-role-v1` in localStorage lets you walk the app as any role. Useful for me, invisible to you, and it does nothing on the live site (real roles come from Firestore). | **Keep.** It is how role-gated behaviour gets tested without provisioning four accounts. |
| 10 | **`docs/` vs the playbook** | Documentation now lives in two places: `reconstructed/ASSET_MATRIX_PLAYBOOK.md` and `reconstructed/asset/docs/`. | **Keep both, deliberately.** The playbook is the map; `docs/` is the working material (testing guide, this file, reports). |

---

# PART 2 — Where the site is thinner than the spec

Honest gaps in what I built, as opposed to things to remove.

### No OCR
Scanned rate cons cannot be read. The screen says so rather than proposing
nothing and letting you assume it tried. Needs a vision model behind
`RateConParser` — the interface is already the right shape, so this is a
contained job once there is a key and a budget.

### No invoicing
Phase 9 stops at the Billing queue and its CSV. Generating an invoice, sending
it, and tracking payment against it are not built. Deliberate — the spec said
build the handoff and stop.

### No carrier pay, driver settlement, or accessorials
Also deliberate (spec 9A). Everything needed to add them is in place: legs carry
their own authority, stops carry per-leg miles with a settlement-exclusion flag,
and the financials object is already namespaced.

### Samsara is an adapter with mock data
HOS, GPS and geofences all run on realistic placeholders. The milestone ladder
already accepts `source: SAMSARA` and the variance engine already compares a
Samsara reading against a typed one — so the day the backend lands, geofence
crossings write milestones automatically with no front-end change.

### Notifications
`notificationSent` / `notificationSentAt` exist on every milestone and nothing
sends anything. Customer milestone emails are a natural next phase and the data
is already there.

### Appointment scheduling
Windows are recorded and used to score on-time. Nothing *books* an appointment,
tracks a request, or holds a "waiting on the receiver to confirm" state beyond
the Confirmed checkbox.

---

# PART 3 — Take this into LoadStop

The list below is what I would map next, in priority order. For each: what to
look at in LoadStop, and **the specific question I need answered** to build it.

Screenshots of the actual screens beat descriptions every time.

### 1. Invoicing and the accounting hand-off  ⭐ highest value
You said "everything for invoicing, the whole nine yards" — this is the biggest
single gap between the Asset Matrix and LoadStop today.

**Look at:** Invoice creation, the invoice template, invoice batching, the
aging/AR report, how an invoice ties back to a load, and what happens when one
invoice covers several loads.

**Tell me:**
- What is on your invoice, field by field? (What does the customer actually see?)
- Is it one invoice per load, or batched by week / by authority / by contract?
- Which documents go out attached, and which are withheld? (The
  Deliverable/Withhold flag is already on every document — I need your rule.)
- What does the AR aging view look like, and what buckets does it use?
- Does anything export to QuickBooks or similar, and in what format?

### 2. Customer / carrier records
The Asset Matrix has customers as free text. LoadStop has customer records with
contacts, terms and defaults.

**Look at:** the customer detail page, the contacts tab, default billing terms,
and where those defaults get applied to a new load.

**Tell me:** which fields you actually use, and which ones auto-fill a load.

### 3. The reports catalogue
You said LoadStop runs "a massive number" of reports. See `REPORTS.md` — I have
proposed twelve. What I need from you is the **shape** of the ones you actually
run.

**Look at:** the report list itself, then open the three or four you run most.

**Tell me:** the columns, the filters, the grouping, and whether it exports.

### 4. Driver settlement / pay
**Look at:** the settlement statement, the pay rules (per mile, percentage, flat,
detention, accessorial), and how a load's pay is calculated and approved.

**Tell me:** how your drivers are actually paid — that is the whole design.

### 5. Appointment scheduling
**Look at:** how an appointment is requested, confirmed, rescheduled; whether
there is a "waiting on receiver" state; and what the calendar view looks like.

### 6. EDI / customer integrations
**Look at:** what comes in by EDI (tenders?), what goes out (status updates?
invoices?), and which customers are wired up.

**Tell me:** whether USPS sends you anything electronically today, and in what
format. This determines whether load creation can stop being manual.

### 7. Driver mobile / driver app
**Look at:** what the driver sees, what they can log, and how a document gets
photographed and attached.

**Tell me:** do your drivers use it? A driver-facing milestone logger is a
natural phase — the ladder and the source tag are already built for it.

### 8. Maintenance
Fleetio is disconnected. If LoadStop tracks maintenance, look at PM schedules,
work orders, and how out-of-service ties to dispatch blocking.

### 9. Dashboards
**Look at:** the landing dashboard. Which tiles, which numbers, what time window.
The Asset Matrix has no dashboard at all — it opens on the board.

### 10. Anything that surprises you
The most useful thing you can bring back is a screen you look at every day that I
have not mentioned. That is almost always where the real gap is.

---

## How to run the mapping session

1. Open LoadStop and this file side by side.
2. Work down Part 3 in order. Screenshot each screen.
3. For each one, answer the "Tell me" question in your own words — how *you* use
   it, not how the vendor describes it.
4. Bring it back as "Phase 11: <name>" with the same shape as the Phase 0–10
   spec you wrote: what it is, what the data model needs, what the screen does,
   and what must be enforced rather than suggested.

That spec format is why Phases 0–10 went in cleanly. It works.
