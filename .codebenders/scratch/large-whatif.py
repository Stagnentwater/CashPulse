import json, urllib.request, http.cookiejar
B = "http://localhost:8000"
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with op.open(req, timeout=60) as r:
        return json.loads(r.read() or b"null")
call("POST", "/api/auth/login", {"email": "ananya@physiocare.demo", "password": "demo1234"})
orig = call("GET", "/api/forecast/scenario")
print("ORIGINAL_SCENARIO", json.dumps(orig))
f0 = call("GET", "/api/forecast?horizon=90")
print("BASELINE_CRUNCH", json.dumps(f0["crunch"]))
invs = call("GET", "/api/invoices")
rows = invs if isinstance(invs, list) else invs.get("invoices", [])
print("INVOICE_KEYS", sorted(rows[0].keys()) if rows else None)
open_rows = [i for i in rows if (i.get("balance") or 0) > 0]
big = max(open_rows, key=lambda i: i["balance"])
print("TARGET", json.dumps({k: big.get(k) for k in ("id", "balance", "dueDate")}))
large = {"horizonDays": 90, "invoiceDelayOverrides": {big["id"]: 90}, "globalLateDaysShift": 0,
         "extraExpenseShock": None, "includeMovingAvgRisk": True}
put = call("PUT", "/api/forecast/scenario", large)
print("PUT_LARGE", json.dumps(large))
f1 = call("GET", "/api/forecast?horizon=90")
print("SIMULATED_CRUNCH_LARGE_DELAY", json.dumps(f1["crunch"]))
call("PUT", "/api/forecast/scenario", orig)
f2 = call("GET", "/api/forecast?horizon=90")
print("RESTORED_SCENARIO", json.dumps(call("GET", "/api/forecast/scenario")))
print("RESTORED_CRUNCH", json.dumps(f2["crunch"]))
