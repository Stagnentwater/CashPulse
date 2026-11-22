import json, urllib.request, http.cookiejar
from datetime import date

B = "http://localhost:8000"
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with op.open(req, timeout=60) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


call("POST", "/api/auth/login", {"email": "ananya@physiocare.demo", "password": "demo1234"})
orig = call("GET", "/api/forecast/scenario")
print("ORIGINAL_SCENARIO", json.dumps(orig))

f0 = call("GET", "/api/forecast?horizon=90")
print("BASELINE_CRUNCH", json.dumps(f0["crunch"]["simulated"]))

invs = call("GET", "/api/invoices")
rows = invs if isinstance(invs, list) else invs.get("invoices", [])
print("INVOICE_KEYS", sorted(rows[0].keys()) if rows else None)

# Open invoices: whatever the forecast itself counts as having a balance.
# Use the inflow ids that appear in the baseline curve.
open_ids = []
for d in f0["baseline"]:
    for f in d["inflows"]:
        if f["ref"] not in open_ids:
            open_ids.append(f["ref"])
print("OPEN_INVOICES_IN_HORIZON", json.dumps(open_ids))


def diff_report(label, f):
    base = [d["balance"] for d in f0["baseline"]]
    sim = [d["balance"] for d in f["simulated"]]
    differing = [i for i, (a, b) in enumerate(zip(base, sim)) if a != b]
    print(label, "DAYS_DIFFER", len(differing),
          "RANGE", (differing[0], differing[-1]) if differing else None)
    print(label, "CRUNCH_SIM", json.dumps(f["crunch"]["simulated"]))
    print(label, "CRUNCH_BASE", json.dumps(f["crunch"]["baseline"]))


# Case A: 60-day delay on each open invoice, one at a time.
for inv_id in open_ids:
    body = {"horizonDays": 90, "invoiceDelayOverrides": {inv_id: 60},
            "globalLateDaysShift": 0, "extraExpenseShock": None,
            "includeMovingAvgRisk": True}
    call("PUT", "/api/forecast/scenario", body)
    print("REQUEST_DELAY60", json.dumps(body))
    diff_report("DELAY60 " + inv_id, call("GET", "/api/forecast?horizon=90"))

# Case B: late-days shift +30, overrides cleared.
body = {"horizonDays": 90, "invoiceDelayOverrides": {},
        "globalLateDaysShift": 30, "extraExpenseShock": None,
        "includeMovingAvgRisk": True}
call("PUT", "/api/forecast/scenario", body)
print("REQUEST_SHIFT30", json.dumps(body))
diff_report("SHIFT30", call("GET", "/api/forecast?horizon=90"))

# Restore the original scenario exactly as read.
call("PUT", "/api/forecast/scenario", orig)
print("RESTORED_SCENARIO", json.dumps(call("GET", "/api/forecast/scenario")))
