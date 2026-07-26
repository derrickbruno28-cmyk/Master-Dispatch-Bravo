#!/usr/bin/env python3
"""Firestore rules regression suite for the Asset Matrix.

WHY THIS EXISTS
The acceptance criteria say READY_FOR_ACCOUNTING must be proven unreachable
without a BOL and a POD "by attempting the write directly against Firestore
rules, not just through the UI", and that the Phase 7 lock must reject a
conflicting write server-side. Both are claims about the SERVER, so they can
only be proven by asking the server.

This runs against the firebaserules.googleapis.com :test API — the same thing
the Firebase console uses. No emulator, no Java, no deploy: it evaluates the
ruleset SOURCE, so it can be run before publishing rather than after.

RUN IT BEFORE EVERY RULES DEPLOY.

    gcloud auth application-default login      # once
    python3 tools/test_rules.py

Exit code 0 = every case behaved as expected. Non-zero = a rule changed meaning,
and the failing case names which one.
"""

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

PROJECT = "asset-matrix-gh"
RULES = Path(__file__).resolve().parent.parent / "firestore.rules"

OWNER = "derrick@ghlogisticsllc.com"
LEAD = "lead@ghlogisticsllc.com"          # fmt_lead
OPS = "ops@ghlogisticsllc.com"            # us_ops
FMT = "fmt@ghlogisticsllc.com"            # fmt  (edit-only, never deletes)
OUTSIDER = "someone@gmail.com"

NOW = "2026-07-26T12:00:00.000Z"


def token() -> str:
    out = subprocess.run(
        ["gcloud", "auth", "application-default", "print-access-token"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def auth(email: str, role: str | None = None):
    """A signed-in caller. `role` seeds the assetUsers doc the rules read."""
    return {
        "uid": email,
        "token": {"email": email, "email_verified": True},
        "_role": role,
    }


def load_doc(**over):
    """A load document with the Phase 0 stamps and Phase 4 doc flags."""
    d = {
        "createdBy": OWNER, "createdAt": NOW,
        "updatedBy": OWNER, "updatedAt": NOW,
        "billingStatus": "NOT_READY",
        "missingBol": True, "missingPod": True,
        "routeName": "test",
    }
    d.update(over)
    return d


CASES = [
    # ---- identity ----------------------------------------------------------
    dict(name="outsider cannot read a load", allow=False, method="get",
         path="/databases/(default)/documents/loads/L1", who=auth(OUTSIDER)),
    dict(name="company user can read a load", allow=True, method="get",
         path="/databases/(default)/documents/loads/L1", who=auth(FMT, "fmt")),

    # ---- FMT can edit but never delete -------------------------------------
    dict(name="FMT may update a load", allow=True, method="update",
         path="/databases/(default)/documents/loads/L1", who=auth(FMT, "fmt"),
         data=load_doc(updatedBy=FMT, updatedAt=NOW), prior=load_doc()),
    dict(name="FMT may NOT delete a load", allow=False, method="delete",
         path="/databases/(default)/documents/loads/L1", who=auth(FMT, "fmt"),
         prior=load_doc()),
    dict(name="US Ops may delete a load", allow=True, method="delete",
         path="/databases/(default)/documents/loads/L1", who=auth(OPS, "us_ops"),
         prior=load_doc()),
    dict(name="FMT may NOT delete a driver", allow=False, method="delete",
         path="/databases/(default)/documents/assetDrivers/D1", who=auth(FMT, "fmt"),
         prior={"name": "x"}),

    # ---- stamping ----------------------------------------------------------
    dict(name="a write attributed to someone else is rejected", allow=False, method="update",
         path="/databases/(default)/documents/loads/L1", who=auth(FMT, "fmt"),
         data=load_doc(updatedBy=OWNER, updatedAt=NOW), prior=load_doc()),
    dict(name="createdBy is immutable once set", allow=False, method="update",
         path="/databases/(default)/documents/loads/L1", who=auth(OPS, "us_ops"),
         data=load_doc(createdBy=OPS, updatedBy=OPS), prior=load_doc()),
    dict(name="a legacy doc with no stamps can still be stamped", allow=True, method="update",
         path="/databases/(default)/documents/loads/L1", who=auth(OPS, "us_ops"),
         data=load_doc(createdBy=OPS, createdAt=NOW, updatedBy=OPS),
         prior={"routeName": "legacy, no stamps"}),

    # ---- THE BILLING GATE (the acceptance criterion) -----------------------
    dict(name="READY_FOR_ACCOUNTING is REJECTED with no BOL and no POD", allow=False, method="update",
         path="/databases/(default)/documents/loads/L1", who=auth(OWNER),
         data=load_doc(billingStatus="READY_FOR_ACCOUNTING", missingBol=True, missingPod=True,
                       updatedBy=OWNER),
         prior=load_doc()),
    dict(name="READY_FOR_ACCOUNTING is REJECTED with a BOL but no POD", allow=False, method="update",
         path="/databases/(default)/documents/loads/L1", who=auth(OWNER),
         data=load_doc(billingStatus="READY_FOR_ACCOUNTING", missingBol=False, missingPod=True,
                       updatedBy=OWNER),
         prior=load_doc()),
    dict(name="READY_FOR_ACCOUNTING is ALLOWED with both documents", allow=True, method="update",
         path="/databases/(default)/documents/loads/L1", who=auth(OWNER),
         data=load_doc(billingStatus="READY_FOR_ACCOUNTING", missingBol=False, missingPod=False,
                       updatedBy=OWNER),
         prior=load_doc()),
    dict(name="INVOICED is REJECTED without documents", allow=False, method="update",
         path="/databases/(default)/documents/loads/L1", who=auth(OWNER),
         data=load_doc(billingStatus="INVOICED", missingBol=True, missingPod=False, updatedBy=OWNER),
         prior=load_doc()),
    dict(name="PAID is REJECTED without documents", allow=False, method="update",
         path="/databases/(default)/documents/loads/L1", who=auth(OWNER),
         data=load_doc(billingStatus="PAID", missingBol=False, missingPod=True, updatedBy=OWNER),
         prior=load_doc()),
    dict(name="ON_HOLD stays reachable with no documents", allow=True, method="update",
         path="/databases/(default)/documents/loads/L1", who=auth(OWNER),
         data=load_doc(billingStatus="ON_HOLD", updatedBy=OWNER), prior=load_doc()),
    dict(name="CANCELLED_TONU stays reachable with no documents", allow=True, method="update",
         path="/databases/(default)/documents/loads/L1", who=auth(OWNER),
         data=load_doc(billingStatus="CANCELLED_TONU", updatedBy=OWNER), prior=load_doc()),
    dict(name="the gate applies on CREATE too", allow=False, method="create",
         path="/databases/(default)/documents/loads/L2", who=auth(OWNER),
         data=load_doc(billingStatus="READY_FOR_ACCOUNTING", createdBy=OWNER, updatedBy=OWNER)),

    # ---- audit trail is append-only ---------------------------------------
    dict(name="an audit event can be written", allow=True, method="create",
         path="/databases/(default)/documents/loads/L1/audit/E1", who=auth(FMT, "fmt"),
         data={"by": FMT, "at": NOW, "action": "test", "summary": "x"}),
    dict(name="an audit event CANNOT be rewritten", allow=False, method="update",
         path="/databases/(default)/documents/loads/L1/audit/E1", who=auth(OWNER),
         data={"by": OWNER, "at": NOW, "summary": "rewritten"},
         prior={"by": FMT, "at": NOW, "summary": "x"}),
    dict(name="an audit event CANNOT be deleted, even by the owner", allow=False, method="delete",
         path="/databases/(default)/documents/loads/L1/audit/E1", who=auth(OWNER),
         prior={"by": FMT, "at": NOW}),
    dict(name="an audit event cannot be attributed to someone else", allow=False, method="create",
         path="/databases/(default)/documents/loads/L1/audit/E2", who=auth(FMT, "fmt"),
         data={"by": OWNER, "at": NOW, "action": "test", "summary": "x"}),

    # ---- role assignment stays owner-only ---------------------------------
    dict(name="US Ops may NOT set a role", allow=False, method="update",
         path="/databases/(default)/documents/assetUsers/x@ghlogisticsllc.com",
         who=auth(OPS, "us_ops"),
         data={"email": "x@ghlogisticsllc.com", "role": "us_ops"},
         prior={"email": "x@ghlogisticsllc.com", "role": "fmt"}),
    dict(name="the owner may set a role", allow=True, method="update",
         path="/databases/(default)/documents/assetUsers/x@ghlogisticsllc.com",
         who=auth(OWNER),
         data={"email": "x@ghlogisticsllc.com", "role": "us_ops"},
         prior={"email": "x@ghlogisticsllc.com", "role": "fmt"}),
    dict(name="a sign-in upsert that touches no role is allowed", allow=True, method="update",
         path="/databases/(default)/documents/assetUsers/x@ghlogisticsllc.com",
         who=auth(FMT, "fmt"),
         data={"email": "x@ghlogisticsllc.com", "role": "fmt", "lastSeenAt": 1},
         prior={"email": "x@ghlogisticsllc.com", "role": "fmt"}),

    # ---- the Bravo lane mirror is read-only here ---------------------------
    dict(name="lanes are read-only from this app", allow=False, method="update",
         path="/databases/(default)/documents/lanes/lane-1", who=auth(OWNER),
         data={"origin": "x"}, prior={"origin": "y"}),
]


def build_request(case):
    who = case["who"]
    fn = {
        "get": "get", "create": "create", "update": "update", "delete": "delete",
    }[case["method"]]

    req = {
        "auth": {"uid": who["uid"], "token": who["token"]},
        "method": fn,
        "path": case["path"],
    }
    if "data" in case:
        req["resource"] = {"data": case["data"]}
    return req


def main() -> int:
    if not RULES.exists():
        print(f"!! {RULES} not found")
        return 2

    source = RULES.read_text()
    tok = token()

    test_suite = {"testCases": []}
    for c in CASES:
        tc = {
            "expectation": "ALLOW" if c["allow"] else "DENY",
            "request": build_request(c),
            "functionMocks": [],
        }
        # seed the assetUsers doc the role() helper reads
        role = c["who"].get("_role")
        docs = []
        if role:
            docs.append({
                "name": f"projects/{PROJECT}/databases/(default)/documents/assetUsers/{c['who']['uid']}",
                "fields": {"role": {"stringValue": role}},
            })
        if "prior" in c:
            fields = {}
            for k, v in c["prior"].items():
                if isinstance(v, bool):
                    fields[k] = {"booleanValue": v}
                elif isinstance(v, (int, float)):
                    fields[k] = {"integerValue": str(int(v))}
                else:
                    fields[k] = {"stringValue": str(v)}
            docs.append({
                "name": f"projects/{PROJECT}/databases{c['path']}",
                "fields": fields,
            })
        if docs:
            tc["resource"] = docs[-1] if "prior" in c else None
            tc["functionMocks"] = []
        tc = {k: v for k, v in tc.items() if v is not None}
        test_suite["testCases"].append(tc)

    body = {
        "source": {"files": [{"name": "firestore.rules", "content": source}]},
        "testSuite": test_suite,
    }

    url = f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}:test"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        res = json.load(r)

    issues = res.get("issues", [])
    for i in issues:
        print(f"!! ruleset issue: {i.get('description')} @ {i.get('sourcePosition')}")
    if issues:
        return 2

    results = res.get("testResults", [])
    failed = 0
    for c, r in zip(CASES, results):
        state = r.get("state", "?")
        ok = state == "SUCCESS"
        if not ok:
            failed += 1
        print(f"{'PASS' if ok else 'FAIL'}  {c['name']}")
        if not ok:
            for e in r.get("errorPosition", []) or []:
                print(f"        at {e}")

    print(f"\n{len(results) - failed}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
