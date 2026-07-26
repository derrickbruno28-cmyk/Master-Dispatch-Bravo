# Asset Matrix — what to test, and everything I flagged

Built through Phases 0–10, shipped as v0.33.1 → v0.43.0 on
**https://asset-matrix-gh.web.app**.

This is the document to work through with the site open. It has three parts:

1. **Test it** — a walkthrough per phase, in the order the work actually happens.
2. **Things I flagged** — decisions I made on your behalf, and the places where
   the app is honest about not knowing something.
3. **Things only you can check** — items that need real data, real Google
   accounts, or a second person, which I could not verify from here.

Every phase was verified headless in demo mode before it shipped. That proves the
mechanism works. It does **not** prove it matches how your office runs, which is
what this document is for.

---

## Before you start

**Two browser profiles.** Several tests need two people at once (locking, in
particular). Use a normal window and an incognito window signed in as two
different work accounts.

**Know which mode you are in.** The live site talks to Firestore and everyone
sees your changes. If you want to break things safely, tell me and I will give
you a demo build that keeps everything in your own browser.

**Roles matter.** Some tests are about what a role *cannot* do. You will need at
least one non-owner account (an FMT user) to check the delete and force-unlock
restrictions honestly.

---

# PART 1 — Test it, phase by phase

## Phase 0 · The data model + the migration

**What changed.** Every load now has a schema underneath it: load number, route
number, trip numbers, booking authority, booking terminal, billing status, and
stamps saying who created and last touched it. Legacy loads still work — the new
fields sit alongside the old ones rather than replacing them.

**Test it**

1. Go to **Integrations**. Find the **Migration** card (owner only).
2. Press **Preview**. It shows every legacy load and what it would set, with
   conflicts called out. **Nothing is written yet.**
3. Anything marked as a conflict needs you to pick a booking authority and
   terminal — the migration will not guess.
4. Apply it. Then open any migrated load and confirm the route, customer and
   rate are unchanged.

**What tells you it worked:** the load opens without errors and the values are
what they were before. The migration only *adds*.

---

## Phase 1 · Multi-leg assignments

**What changed.** A load is no longer one truck. It is a list of legs, each with
its own truck, trailer, up to two drivers, carrier authority and leg type. The
board draws the load on **every** truck row it touches, with a "leg 1 of 2" chip
so those rows do not read as separate loads.

**Test it**

1. Open a load → **Load Info**. The Assignments block is the first thing under
   the rate-con drop zone.
2. Add a second leg. Give it a different truck and driver. Set the stop range
   (e.g. leg 1 covers stops 1–2, leg 2 covers 2–3).
3. Save. Go back to the board: the load now appears on **both** truck rows, each
   tagged with its leg number.
4. Put an **out-of-service** truck on a leg. It should **block** you.
5. Put a driver with an availability problem on a leg. It should **warn** you and
   still let you save.

**The distinction is deliberate:** equipment that cannot legally move is a block;
a person issue is a judgement call and stays yours.

---

## Phase 2 · The milestone ladder

**What changed.** Board status is no longer typed. It is derived from the
milestones you log, and logging is the only way to move a truck along.

**Test it**

1. Open a load → **Milestones**. Every stop has its ladder: En Route → At Pickup
   → Loading Started → Loading Completed → Detention Begin/Ended → Pickup
   Completed (deliveries mirror it).
2. Try to log **Loading Completed** before **At Pickup**. It refuses and tells
   you which rung is missing. Ladder order is enforced.
3. Log through the ladder. Every rung asks for a source — 🚚 driver, 🖥 dispatch,
   📡 Samsara. There is no unsourced option, on purpose.
4. **Watch the board.** As you log, the cell colour and status change on their
   own. You should never type a status again.
5. Log a completion **after** the appointment window. It refuses to save without
   a structured late reason.
6. Back on the board, press the **⚡** on a cell. It logs the next required
   milestone in one tap, with the late-reason picker inline if it is late.

**Detention:** log Detention Begin and Ended and the minutes compute from them.
If you do not log them, it falls back to arrival/departure and says it inferred
the number rather than presenting it as measured.

---

## Phase 3 · Stops, appointments, and the Load Repository

**Test it**

1. Open a load → **Stops**. Every stop has appointment date, window open, window
   close, and a Confirmed checkbox.
2. Type a trip number in the **trip search** (try `FA2D3-10`). Pick a match.
3. You get a **diff table**: what the repository holds vs what the load has now.
   Rows that would overwrite something you already typed are marked as conflicts
   and start switched **off**.
4. Apply. Only the rows you left on are written.
5. Go to **Load Repository** and click any row — it opens a new load pre-seeded
   from that trip, without writing anything until you save.

---

## Phase 4 · Documents + the billing gate

**What changed.** A load cannot reach Ready For Accounting without a BOL and a
POD. That is enforced in the app **and** in the database rules.

**Test it**

1. Open a delivered load → **Documents**. The banner at the top says exactly
   what is missing: "still waiting on BOL + POD".
2. Try to set billing status to **Ready for accounting**. It refuses and names
   the missing document.
3. Upload a BOL (any PDF or photo). The banner updates to "waiting on POD".
4. Upload a POD. The banner turns green and — if the load was on Missing docs —
   the status **lifts itself** to Ready for accounting.
5. Check the file name: `{load#}-BOL-MM-DD-YYYY.pdf`. A second BOL becomes `-2`.
6. Check the Invoice column: BOL and POD default to **Withhold**, everything else
   to **Deliverable**. Change one and it stays changed — the default exists
   because the exception exists.
7. On the board, the chip row now reads **Missing BOL · Missing POD · Ready for
   accounting · On hold · Cancelled/TONU**. Click one — the board fades
   everything that does not match instead of hiding it.

**⚠ Proving the server-side gate.** The UI refusing is not proof. The proof is
in `tools/test_rules.py` — see Part 3.

---

## Phase 5 · Exceptions + replacement loads

**Test it**

1. Open a load mid-route → **Exceptions** → **Log an exception**.
2. Pick a type (Driver HOS), a leg, and the stop the replacement would start
   from. Write a reason — it is required, because that is what the customer gets
   told.
3. Press **Log it + preview replacement load**.
4. **Read the preview.** It lists what carries forward (customer, authority,
   terminal, equipment, commodity, weight, references, trip numbers, rate, and
   the remaining stops **with their appointment windows**) and what does not
   (actuals, milestones, truck, drivers, trailer, documents).
5. Nothing is written yet. Cancel here and confirm the load count has not changed.
6. Do it again and press **Create this replacement load**. Then check:
   - the new load is in the **Unassigned tray** on the board;
   - the original leg is marked cancelled with your reason;
   - both loads carry a banner pointing at the other;
   - the board cell shows a **⚠** and the Exception chip counts 1.

**Flagged:** if the copied stops contain no pickup, the preview warns you and
does **not** invent a recovery pickup at the breakdown location. See Part 2.

---

## Phase 6 · OTP / OTD

**What changed.** The "+ Log Shipment" form is gone. Every row is derived from
the loads and their milestones.

**Test it**

1. Open **OTP / OTD**. Every load with a date is listed. Loads with no logged
   milestones read **PENDING** in both columns.
2. Look at the KPI strip: "0/1 scored" next to the percentage, plus an
   **UNLOGGED** count. Unlogged stops are excluded from the percentage — they are
   never counted as on-time.
3. Log a late pickup and a late delivery on one load, with **two different**
   reasons.
4. Come back: the row shows `PU: <reason>` and `DEL: <reason>` separately, and
   the top-fail strip counts them as two failures with two causes.
5. Open **Late Reasons report** and switch between by reason / driver / terminal
   / customer.
6. **Export CSV** and confirm it matches what is on screen.

---

## Phase 7 · Notes + record locking

**Notes**

1. Open a load → **Notes**. Post one as Customer Comms and one as Late Reason.
2. The Late Reason note renders in the warning colour.
3. Pin a note — it moves to the top.
4. Hide a note (🗑). It leaves the thread. Tick **Show hidden notes** and it comes
   back, marked hidden with a timestamp. **Notes are never deleted.**
5. As an **FMT** user, the hide button is a 🔒.
6. On the board, the cell now shows the most recent note inline with a 💬 count.

**Locking — this needs two browsers**

1. Open a load in window A.
2. Open the **same** load in window B (different account).
3. Window B should show an amber banner: "*<name>* has this load open", Save
   disabled, and the notes composer replaced with a read-only message.
4. Press **Ask them to close it** in B → a note appears in the thread A is
   already looking at.
5. As Owner or FMT Lead in B, press **Force unlock**. It works and is logged with
   the name of the person whose claim was broken. As plain **FMT**, it is not
   offered.
6. Close window A's card. Window B can now save.
7. **The timeout:** open a load, then close the laptop / kill the tab without
   closing the card. After five minutes the lock frees itself. Nothing to clean
   up manually.

---

## Phase 8 · Rate confirmation parsing

**Test it**

1. Open a load → **Load Info** → drop a rate con PDF on the drop zone.
2. You get a **review screen**, not a filled form. Every row: value, target
   field, confidence, and a **Take / Skip** toggle.
3. If it is a USPS document, check the trip identifier split at the top — e.g.
   `FA2D3_1019_071426_1` should read route **FA2D3**, trips **1019 · 071426 · 1**.
4. If the trip exists in the Load Repository, any disagreement (miles, rate band,
   pickup time) is listed **first** and starts switched **off**.
5. Switch a row off and watch the "Apply N fields" count drop.
6. Apply. The form fills in. **Nothing is saved until you press Save.**
7. Open **Documents** — the source file is attached as **RATE CON /
   Deliverable**, whether or not you accepted any field.

**Try a scanned rate con** (a photo, or a PDF made from a scanner). The screen
should say plainly that there is nothing readable in it and that it will not
guess. See Part 2 — there is no OCR.

**The nine trip fixtures** run as a test: `npm run test:tripids` in
`reconstructed/asset`. All ten checks should pass.

---

## Phase 9 · Financials + Billing

**Test it**

1. Open a load → **Load Info**. Set a rate, pick an **FSC type** (Flat / Per Mile
   / Invoice %) and an FSC rate, and an empty-miles figure.
2. Look at the strip across the top of the card: Rate $/mi · Flat Rate · FSC ·
   Revenue · Loaded Miles · Empty Miles · Total Distance · CPM. Change the rate
   and watch every derived number move. **None of them are stored.**
3. Go to **Financials → Billing**. Loads are grouped by billing status with
   counts and revenue.
4. Every row states what is holding it up — "waiting on POD", "ready — waiting to
   be invoiced", "waiting on payment".
5. Filter by authority, terminal, customer and date range.
6. Click a row — it opens that load on the Documents tab, where you can fix it.
7. **Export CSV** — that is the handoff artifact for whoever invoices.
8. On **Revenue / CPM**, **By Customer**, **By Truck** and **Driver Miles**, each
   now carries a **By booking authority** and **By terminal** split.

**The state machine:** complete the final delivery on a load and watch it move
from Not ready → **Missing docs** on its own. Attach both documents and it moves
to Ready for accounting on its own. Invoiced and Paid are yours to set.

---

## Phase 10 · Trailers + cleanup

**Trailers**

1. Open a load → a leg's **Trailer #** field. Start typing — it matches the
   trailer list.
2. Type a trailer marked **In Shop**. You get a warning and you can **still
   save**. Free text always wins.
3. Type a trailer already on another unfinished load — same: warned, not blocked.
4. Type a number that does not exist. An inline **+ Add trailer #99001** appears;
   press it, set type and location, and it becomes a real record.
5. Go to **Trailers → Import trailers (CSV)**. Paste or choose a file with
   `trailer #, type, status, location, notes`. Re-import an updated list and
   confirm it **updates** rather than duplicating.

**The cleanup — confirm each one**

| # | What to check |
|---|---|
| 1 | **Trucks**: no Fleetio chip, no Fleetio import, and the copy no longer claims anything refreshes from Fleetio |
| 2 | **Integrations**: the reset/restore tools are gone; a card points you to `#admin` |
| 3 | **OTP/OTD**: no "Samsara auto-fill — planned" chip |
| 4 | **OTP/OTD**: no "+ Log Shipment" |
| 5 | **Fleet Map**: geofence import is disabled with a tooltip while no Samsara org is connected |
| 6 | **Team**: no duplicate "Add Team" |
| 7 | One **Fleet** nav item with a Trucks / Team toggle |
| 8 | **Loads** ledger rows open the load |
| 9 | **Booking authority** is a picker with your five entities |
| 10 | **Booking terminal** is on the load |

**The hidden admin page:** put `#admin` in the address bar. You should get the
reset and restore tools, each refusing to run until you type its phrase
(`RESET THE BOARD`). Signed in as anyone but the owner, the page refuses.

---

# PART 2 — Things I flagged

These are decisions I made, or limits the app states out loud. Read them; some
you may want changed.

### 1. There is no OCR for scanned rate cons
The parser reads text out of a PDF. A photo or a scanner output has no text
layer. Rather than guess, the review screen says so and asks you to type the load
in. **If a meaningful share of your rate cons arrive as scans, say so** — that is
a vision-model call behind the same interface, and it needs a key and a budget.

### 2. Missing BOL / Missing POD only count DELIVERED loads
A load that has not run is missing its paperwork by definition. Counting those
would make the chip read "47" every morning and mean nothing. **If you want the
chip to count everything, tell me** — it is one line.

### 3. A replacement load with no pickup is warned about, not fixed
When a truck breaks down mid-route, the replacement usually has to go **collect**
the freight from wherever it stopped — and that location is not in the original
plan. The preview says so and leaves the stop for you to add. It will not invent
an address.

### 4. Pending is not a pass in OTP/OTD
An unlogged stop stays out of the percentage entirely. This means your OTP number
will look *worse* than a system that rounds unknowns up — and it will be true.
The **UNLOGGED** count next to it is how you tell the difference between "we were
late" and "nobody logged it".

### 5. The billing gate's server-side half trusts two flags
Firestore rules cannot query a subcollection, so the rule is "you may not claim a
billable state while the load says a required document is missing". The flags are
written by the same rule-checked path and every change is audited. It is not a
loophole, but it is worth knowing the shape of.

### 6. "Force unlock" is Owner / FMT Lead / US Ops only, and it is logged
FMT can never force a lock, delete a load, delete a document, or hide a note.
That is the rule-enforced boundary, not a UI preference.

### 7. Notes cannot be deleted by anyone — including you
`allow delete: if false`. A dispatch note is evidence of what somebody was told
and when. Hiding is the only removal.

### 8. Financials are rate + FSC only
No carrier pay, no driver settlement, no accessorials. That was the spec, and I
would keep it until the revenue numbers have been checked against a month of real
invoices. A settlement engine on unverified inputs produces confident wrong
answers faster.

### 9. Timestamps are ISO strings, not Firestore Timestamps
It keeps demo and live identical. The one place it bites is the record lock, so
the lock carries an epoch-millisecond twin (`heartbeatAtMs`) purely so the rules
can compare times. If you ever hand-edit a lock in the console, write both.

### 10. Fleetio is off, not removed
`FLEETIO_CONNECTED = false`. The connector code and the Cloud Function are still
there; nothing calls them, and the app no longer claims otherwise. The July-24
service statuses you exported are still on the Trucks page as you asked.

### 11. Six defects the verification caught before you saw them
Listed because they are the argument for verifying rather than asserting:
- the Documents tab showed a stale billing status over a green gate;
- the board's paperwork chips counted a stale copy of the load;
- one late field made a dock-congestion delivery get filed under the shipper's
  hold;
- "Surface Transportation" filled the PO field with "rtation";
- every parsed appointment window opened at 20:26, because `07/26/2026` ends in
  a valid military time;
- `BOL-55231` was reported as a malformed trip number.

---

# PART 3 — Things only you can check

### A. Prove the billing gate on the server
This is the acceptance criterion that cannot be tested through the UI.

```bash
cd reconstructed/asset
gcloud auth application-default login      # once
python3 tools/test_rules.py
```

33 cases. It evaluates the rules **source** against Google's rules-test API, so
you can run it before publishing. Expect `33/33 passed`. It includes:
- Ready For Accounting rejected with no BOL, with a BOL but no POD, and on create;
- Invoiced and Paid rejected the same way;
- On hold and Cancelled/TONU still reachable with no paperwork;
- the lock rejecting a second writer, allowing the holder, ignoring a stale lock,
  allowing US Ops to force it, and refusing FMT;
- FMT never deleting anything;
- audit events never being edited or deleted, by anyone.

**Run this before every rules deploy.** Then deploy them with the
`deploy-asset-rules` workflow (manual dispatch only — rules must never deploy as
a side effect of a push).

### B. Two-person locking
Needs two real accounts. See Phase 7 above.

### C. Real rate cons
Drop ten of your actual rate cons — USPS and broker — and tell me which fields
came back wrong or empty. The extractor is regex over layout, and the only way to
tune it is against documents I have never seen.

### D. The migration on live data
I verified the migration logic; I have not run it on your production `loads`
collection. Preview it first, read the conflicts, and take a Firestore export
before applying.

### E. Trip fixtures against your real trip list
`npm run test:tripids` covers the nine you gave me. If your live data has trip
identifiers in another shape, they will show up in the review screen as
**unrecognized trip format** rather than being silently mis-parsed — send me any
you see.

### F. Whether the numbers are right
Everything computes. Whether the revenue on a load matches what you actually
invoice is a question only a month of side-by-side comparison answers.
