# Bravo Matrix

Web-app replacement for the Alpha Matrix spreadsheet: a freight coverage board for GH Logistics.

## What's here

- `app/` — Vite + React + TypeScript front end (Firebase Auth + Firestore when configured)
- `tools/extract_seed.py` — one-time extractor that pulls lanes/loads/carriers out of `ALPHA MATRIX 2026.xlsx`
- `seed/` — the extracted data (198 lanes, 1,261 loads for week 07/04–07/12, 337 carriers)
- `firebase.json`, `firestore.rules` — hosting + Firestore config; rules restrict all access to verified `@ghlogisticsllc.com` accounts

## Core concepts

- **Loads are keyed by lane + date** (`laneId_YYYY-MM-DD`), not by weekly tabs. A "week" is just a 9-day
  (Sat → following Sun) view over the data, so the old 3-day tab overlap and DNU archive tabs are unnecessary —
  history is simply older dates.
- **Sales Hub is derived, never entered.** Every load with no carrier appears automatically, grouped by
  day and morning/afternoon; assigning a carrier in the Matrix removes it instantly. Only posted rate,
  equipment (Power Only Lot Back 3/5 Days, Live/Live, Live Load), and Solo/Team are editable there.
- **Statuses drive cell colors** and are defined in `app/src/types.ts` (`DEFAULT_STATUSES`):
  exposed (red, auto), covered (green, auto), booked–RC pending, RC signed, dispatched, asset, not running.
  The chips above the Matrix filter by status.

## Load import — what the file reader needs (TMS export mapping)

The Import page (`app/src/views/ImportView.tsx`) accepts .xlsx/.xls/.csv and needs
four things per row. Matching is **trip reference + pickup date → lane + day cell**;
the row fills that cell's load #, carrier, and pay.

| What | How the reader finds it | Required? |
|---|---|---|
| **Trip reference** | Scans EVERY cell in the row for `FA2D3`/`FA28D`/`7523D` + number (any of `FA2D3_544`, `FA2D3-544`, `FA2D3 544`; underscore suffixes like `FA2D3_346_0704_1` are fine) | Yes — no trip ref, no match |
| **Load number** | Column headed exactly `Load` | Yes — blank rows are skipped |
| **Pickup date** | Column headed exactly `Pickup`, containing a zero-padded `MM/DD/YYYY` anywhere in the cell | Yes — picks the day column |
| **Carrier / pay** | Columns headed exactly `Carrier Name` / `Carrier Pay` | Optional — with carrier ⇒ imported as covered + booking pre-approved; without ⇒ exposed |

Rows whose trip # has no matching lane are reported as unmatched (never guessed).
Loads with no trip reference at all (non-Matrix freight: FedEx, LA Foods…) are skipped.

### LoadStop profile (current)

LoadStop exports satisfy all of the above natively — trip refs live in the
PO Number / Pickup-ref columns, headers are `Load` / `Pickup` / `Carrier Name` /
`Carrier Pay`. Tested 07/05: 1,204 of 1,220 rows matched.

### Monarc profile (BUILT — v2.5.1, validated on the real 07/11–07/18 export: 452/452 rows)

Analyzed sample: `monarc-loads-completed-2026-06-01_to_2026-06-30.csv`. The good news:
**trip references import cleanly** — the `Pickup #` column carries `FA2D3_544`-style refs
the row-scan already finds. But four things differ, so the current reader would
match zero rows as-is:

| Field | LoadStop | Monarc | Impact |
|---|---|---|---|
| Load number | `Load` | `Load #` | header miss → every row skipped |
| Pickup date | `Pickup`, `07/04/2026 12:30 AM` | `Pickup Date/Time`, `6/19/2026 18:45` | header miss AND non-zero-padded date fails the `MM/DD/YYYY` regex |
| Carrier | `Carrier Name` | `Carrier` | header miss → everything imports exposed |
| Carrier pay | `Carrier Pay` | `Carrier Pay` (plain number) | ✓ works |

The fix is a small importer "profile", **validated 07/06 against the sample — 8/8 rows
matched** (loads 65764…63121, six trips incl. 7523D-7502, all carriers + pay extracted):

1. Header aliases: `Load #`→`Load`, `Pickup Date/Time`→`Pickup`, `Carrier`→`Carrier Name`.
2. Date handling: SheetJS silently reformats Monarc's date cells to `6/19/26` (2-digit
   year, time dropped) — a date regex tweak is NOT enough. Read the workbook with
   `{ cellDates: true }` + `sheet_to_json({ raw: true })` and take the date from the
   resulting `Date` object's local getters.

The profile is auto-detected from headers — reps just upload either file. Monarc's
`Driver Name`/`Driver Phone` ride into rate/notes on booked rows, and `Power Unit`
fills the GH truck # when the carrier is GH. Note Monarc "all loads" exports carry
OPEN tenders too (no carrier) — those import as exposed, and their `Carrier Pay`
column is ignored (it's a planning figure, not an agreed rate).

Monarc also carries fields the importer could optionally use later: `Driver Name`/
`Driver Phone` (→ rate/notes), `Power Unit` (→ GH truck #), and `RateCon Status`
(`signed` → RC Signed status automatically).

## Set up on a new machine (e.g. laptop)

```
git clone https://github.com/cdpmoney23/bravo-matrix.git
cd bravo-matrix/app
npm install
```

Recreate the two env files (gitignored):

1. `app/.env.local` — production Firebase config. Get the values with
   `firebase apps:sdkconfig web --project bravo-matrix-gh` (sign in first with `firebase login`),
   using the variable names in `app/.env.example`, plus:
   `VITE_ALLOWED_DOMAIN=ghlogisticsllc.com` and `VITE_OWNER_EMAIL=caleb@ghlogisticsllc.com`.
2. `app/.env.development.local` — keeps local dev in demo mode:
   ```
   VITE_FIREBASE_API_KEY=
   VITE_FIREBASE_PROJECT_ID=
   ```

Then `npm run dev` for demo mode, or `npm run build && firebase deploy --only hosting`
(from the repo root) to ship.

## Run locally (demo mode)

```
cd app
npm install
npm run dev
```

With no Firebase env vars the app runs in **DEMO MODE** on the bundled seed data — full UI, edits are
in-memory only.

## Go live on Firebase

1. Create a Firebase project (console.firebase.google.com), enable **Authentication → Google** and **Firestore**.
2. Add a web app in Project settings, copy the config into `app/.env.local` (see `app/.env.example`).
3. In Google Cloud Console → OAuth consent screen, set user type **Internal** (Workspace) so only
   ghlogisticsllc.com accounts can ever sign in. The app additionally passes `hd=ghlogisticsllc.com` and
   Firestore rules re-check the email domain server-side.
4. Deploy:
   ```
   cd app && npm run build
   firebase deploy --only hosting,firestore
   ```
5. Seed Firestore once: sign in to the deployed app, open the browser console and run the exported
   `seedFirestore()` helper (or ask Claude to wire a temporary "Seed" admin button).

## v1.8.0

- **Carrier verification via Cloud Functions** (`functions/`, Node 22, us-central1): on the Admin
  page, paste the carrier's Highway-listed contact email and Send verification — the contact gets
  an email (Gmail SMTP from caleb@ghlogisticsllc.com; app password in Secret Manager as
  `GMAIL_APP_PASSWORD`) with a single-use, 7-day approve/deny link that resolves the registration
  server-side. Links render a confirm page on GET and act only on POST (mail-scanner safe), and
  can never override a manual admin decision. Manual Approve/Reject remains as fallback.
  Deploy with `firebase deploy --only functions`.

## v1.1.0

- **Import**: upload a LoadStop export (.xlsx); rows match lanes by FA2D3/FA28D/7523D trip reference +
  pickup date and fill load #, carrier, and pay automatically.
- **Roles**: owner assigns admins (Admin page); admins edit/add/remove lanes (✎ on lane, + Add lane on
  section headers). `tools/parse_schedule.py` parses the official HCR schedule PDF; the audit vs the
  Matrix is shown on the Admin page.
- **History**: every load change records who/when/what; collapsible History inside the load modal.
- **Sales Hub / Exposed**: rolling 72-hour window (Central), symmetric fixed columns, empty AM/PM
  blocks render as "CLEAR", posted rate sits next to Lane. Nav order: Matrix · Sales Hub · Exposed.
- **UI**: light/dark mode, GH Logistics logo (drop the real file at `app/public/logo.png` — falls back
  to a wordmark), version badge, full-width matrix with section dividers, proper-cased city names,
  Weekend/Weekday rates spelled out, lane times backfilled from the official schedule.

## Still to build

- Status manager UI (add/rename statuses, pick colors) — capability exists, config is code-side for now.
- Carrier admin page and per-carrier history.
- Monarch TMS import profile (current importer targets the LoadStop export format).
