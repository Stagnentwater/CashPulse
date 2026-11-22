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
orig = json.load(open(".codebenders/scratch/orig-scenario.json"))
call("PUT", "/api/forecast/scenario", {"horizonDays": 90, "invoiceDelayOverrides": {"inv_7426dfd29110a22c": 95}, "globalLateDaysShift": 0, "extraExpenseShock": None, "includeMovingAvgRisk": True})
c = call("GET", "/api/forecast?horizon=90")["crunch"]
print("SIM_95", json.dumps(c["simulated"]))
call("PUT", "/api/forecast/scenario", orig)
print("READBACK", json.dumps(call("GET", "/api/forecast/scenario")))
