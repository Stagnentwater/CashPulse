import json, urllib.request, http.cookiejar, sys
B = "http://localhost:8000"
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with op.open(req, timeout=60) as r:
        return json.loads(r.read() or b"null")
print("HEALTH", call("GET", "/api/health"))
call("POST", "/api/auth/login", {"email": "ananya@physiocare.demo", "password": "demo1234"})
orig = call("GET", "/api/forecast/scenario")
json.dump(orig, open(".codebenders/scratch/orig-scenario.json", "w"))
print("ORIGINAL_SCENARIO", json.dumps(orig))
f0 = call("GET", "/api/forecast?horizon=90")
print("BASELINE_CRUNCH", json.dumps(f0["crunch"]))
invs = call("GET", "/api/invoices")
rows = invs if isinstance(invs, list) else invs.get("invoices", [])
TID = "inv_7426dfd29110a22c"
t = [i for i in rows if i["id"] == TID]
print("TARGET_PRESENT", bool(t), json.dumps({k: t[0].get(k) for k in ("id","balance","dueDate")}) if t else None)
s60 = {"horizonDays": 90, "invoiceDelayOverrides": {TID: 60}, "globalLateDaysShift": 0, "extraExpenseShock": None, "includeMovingAvgRisk": True}
call("PUT", "/api/forecast/scenario", s60)
f1 = call("GET", "/api/forecast?horizon=90")
print("SIMULATED_CRUNCH_60", json.dumps(f1["crunch"]))
need = ["ending_balance", "cash_received_in_horizon", "received_after_horizon"]
print("KEYS_BASELINE", all(k in f0["crunch"] for k in need), [k for k in need if k not in f0["crunch"]])
print("KEYS_SIMULATED", all(k in f1["crunch"] for k in need), [k for k in need if k not in f1["crunch"]])
call("PUT", "/api/forecast/scenario", orig)
print("RESTORED_NOW", json.dumps(call("GET", "/api/forecast/scenario")))
