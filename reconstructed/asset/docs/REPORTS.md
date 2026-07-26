# Reports — what the data can already answer, and what I'd build next

You asked which trucks bring in the most and least revenue, which drivers are in
those trucks, what loads they ran, and "everything for invoicing — the whole nine
yards."

Good news on the first part: **the data to answer all of that is already there.**
Phases 1, 2, 9 and 10 put revenue on the load, drivers on the leg, miles on the
stop, and authority and terminal on both. What is missing is the screens.

This document is in three parts:

1. **What you can answer today**, and where.
2. **Twelve reports I would build**, in the order I would build them, each with
   the exact question it answers and whether the data exists yet.
3. **The two data gaps** that hold three of them back.

---

# PART 1 — What the site answers today

| Question | Where |
|---|---|
| What did we bill this month, and at what CPM? | **Financials → Revenue / CPM** |
| Which customers are the revenue? | **Financials → By Customer** |
| Which trucks are the revenue? | **Financials → By Truck / Team** |
| How many miles did each driver run? | **Financials → Driver Miles** |
| Whose revenue is it — which entity, which terminal? | The **By booking authority** and **By terminal** split on every one of those four |
| What is stuck between delivered and invoiced, and why? | **Financials → Billing** — grouped by status, with the blocking reason per row |
| What is our OTP and OTD, and what is the excuse? | **OTP / OTD**, plus the **Late Reasons** report by reason / driver / terminal / customer |
| What paperwork is missing right now? | The board's **Missing BOL / Missing POD** chips, and the Billing queue |
| Who touched this load and when? | The **audit** log on the Milestones tab |

Everything above exports to CSV except the audit log.

---

# PART 2 — Twelve reports I'd build

Ordered by value to you, not by effort. **"Data ready"** means I can build it
from what the app already stores; **"needs X"** means it is blocked on a gap
listed in Part 3.

---

### 1. Truck P&L — best and worst earners  ⭐ the one you asked for
**Answers:** which trucks bring in the most and the least, and who is in them.

One row per truck, sorted by revenue, for any date range:

> Truck # · Terminal · Current crew · Loads run · Revenue · Loaded miles ·
> Deadhead miles · **Revenue per loaded mile** · Revenue per day in service ·
> OTP % · OTD % · Exceptions

**Click a row → the loads that truck ran**, with date, route, customer, revenue
and CPM. That is your "what loads did they run" in one click.

**Why revenue-per-day-in-service matters:** raw revenue rewards whoever got the
long lanes. A truck that ran $80k over 22 days and one that ran $80k over 30 days
are not the same truck. Sorting by raw revenue alone will mislead you, so this
report shows both.

**Data ready.** Revenue and miles are on the load, the crew is on the leg, the
terminal is on the load, OTP/OTD comes off the milestones.

---

### 2. Driver scorecard
**Answers:** which drivers are actually producing, and which are costing you.

> Driver · Home terminal · Current truck · Loads · Miles · Revenue attributed ·
> Revenue per mile · **OTP % · OTD %** · Late reasons (their top three) ·
> Exceptions caused · Detention hours

**The late-reason column is the point.** A driver at 88% OTD whose reasons are all
"Receiver / Dock Congestion" has a customer problem. One whose reasons are all
"Driver — Overslept" has a driver problem. The same number, two different
conversations — and the Phase 2 late-reason gate is what makes the distinction
possible.

**Data ready.**

---

### 3. Lane profitability
**Answers:** which lanes to keep, which to renegotiate, which to walk away from.

> Lane (origin → destination) · Trip # · Loads · Avg revenue · Avg loaded miles ·
> **Avg CPM** · Avg deadhead in · OTP/OTD · Rate vs the Load Repository band

**The last column is the money column.** The repository holds the contract band;
the loads hold what you actually got. A lane consistently at the bottom of its
band is a renegotiation with evidence attached.

**Data ready** — Phase 8 already computes the band comparison for rate cons.

---

### 4. Deadhead report
**Answers:** how much you are paying to move empty, and which terminal is worst.

> Truck · Loaded miles · Empty miles · **Deadhead %** · Empty miles by terminal ·
> The specific load pairs that created the deadhead

**Data ready** — `emptyMiles` is on the financials and per-stop leg miles carry a
settlement-exclusion flag.

---

### 5. Aging paperwork
**Answers:** what has been sitting in Missing Docs the longest, and whose it is.

> Load · Customer · Delivered date · **Days waiting** · Missing what · Truck ·
> Driver · Revenue at risk · Last note on the load

Sort by days waiting descending. The revenue-at-risk column turns "chase the
paperwork" into "chase $47,000 of paperwork."

**Data ready** — the delivery date comes off the milestone, the missing documents
off the gate, the note off the thread.

---

### 6. Revenue by entity and terminal, over time
**Answers:** how each of the five authorities is trending.

A month-by-month grid: authority down the side, month across, revenue and load
count in the cells, with a terminal breakdown underneath.

**Data ready** — this is the existing breakdown, pivoted over time.

---

### 7. Customer scorecard
**Answers:** which customers are worth the trouble.

> Customer · Loads · Revenue · Avg CPM · **Detention hours we ate** ·
> On-time-in % (were WE late) · **Their delay rate** (were THEY late) ·
> Avg days to pay

The two on-time columns are the argument. A customer whose docks hold your trucks
four hours is costing you money that does not show up in the rate — and the late
reasons already separate "Receiver / Dock Congestion" from anything on your side.

**Data ready except days-to-pay** — see gap A.

---

### 8. Detention recovery
**Answers:** how much detention you are owed and are not billing.

> Load · Stop · Customer · Free time · Actual time on site · **Detention minutes** ·
> Whether it was logged or inferred · Billed? · $ at stake

**The logged-vs-inferred column is deliberate.** A logged detention (Detention
Begin / Ended) is billable evidence. An inferred one (computed from arrival and
departure) is a strong hint you should have logged it, and this report is what
teaches the habit.

**Data ready except the billing half** — see gap B.

---

### 9. Exception report
**Answers:** what keeps breaking, and what it costs.

> Exception type · Count · By terminal · By driver · By truck ·
> Replacement loads spawned · **Revenue on the cancelled legs**

Breakdowns and HOS failures have different fixes. This is how you find out which
one you have.

**Data ready.**

---

### 10. Weekly operations one-pager
**Answers:** the Monday-morning question, on one screen.

Loads run · revenue · CPM · OTP · OTD · loads still missing docs · revenue
waiting to be invoiced · exceptions · trucks with no load tomorrow — with each
number against last week and an arrow.

**"Trucks with no load tomorrow" is the one that pays for the report.** Everything
else is history; that one is actionable this morning.

**Data ready.**

---

### 11. Trailer utilisation
**Answers:** where the trailers are and which are not moving.

> Trailer · Type · Status · Last load · **Days since last movement** · Location ·
> Which truck has it

**Data ready** once the owned-trailer list is imported (Phase 10's CSV).

---

### 12. Invoice register
**Answers:** what was invoiced, when, against what, and what is outstanding.

**Blocked on invoicing existing** — see the LoadStop mapping list. This is the
report that makes the Billing queue a system rather than a hand-off.

---

# PART 3 — The two gaps

### Gap A — payment dates
Billing status goes as far as **PAID**, but nothing records **when** it was paid
or against which invoice. Without that there is no days-to-pay, no AR aging, and
no invoice register.

**The fix is small:** `invoicedAt`, `invoiceNumber`, `paidAt`, `amountPaid` on the
load, set when the status moves. That is one afternoon and it unblocks reports 7
and 12.

### Gap B — accessorial billing
Detention **minutes** are computed. Detention **dollars** are not, because there
are no accessorial line items — deliberately excluded from Phase 9.

**The fix:** an accessorials array on the load (type, amount, billable, note),
with detention pre-filled from the milestone timing and flagged as logged or
inferred. That unblocks report 8 and is the natural first step toward real
invoicing.

---

# What I'd do first

If you want one thing: **report 1, the truck P&L with the click-through to that
truck's loads.** It is the question you actually asked, the data is all there, and
it is the report that will change a decision — which trucks to keep running,
which crews to move, and which lanes to stop taking.

Say the word and it is the next thing I build.
