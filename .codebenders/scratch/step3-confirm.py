import json, urllib.request, http.cookiejar, sys
B = "http://127.0.0.1:8000"
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with op.open(req, timeout=60) as r:
        return r.status, json.loads(r.read() or b"null")
st, _ = call("POST", "/api/auth/login", {"email": "ananya@physiocare.demo", "password": "demo1234"})
print("LOGIN_STATUS", st)
st, saved = call("GET", "/api/forecast/scenario")
print("SAVED_STATUS", st)
json.dump(saved, open(".codebenders/scratch/step3-saved-scenario.json", "w"), indent=2)
print("SAVED_SCENARIO", json.dumps(saved))
body = dict(saved)
body["invoiceDelayOverrides"] = {"inv_7426dfd29110a22c": 95}
st, put = call("PUT", "/api/forecast/scenario", body)
print("PUT95_STATUS", st)
st, fc = call("GET", "/api/forecast?horizon=90")
print("FORECAST_STATUS", st)
c = fc["crunch"]
print("BASELINE_KEYS", sorted(c["baseline"].keys()))
print("SIMULATED_KEYS", sorted(c["simulated"].keys()))
for k in ["ending_balance", "received_after_horizon", "cash_received_in_horizon", "lowest_balance"]:
    print("BASELINE", k, c["baseline"].get(k, "MISSING"))
    print("SIMULATED", k, c["simulated"].get(k, "MISSING"))
b_end = c["baseline"]["ending_balance"]; s_end = c["simulated"]["ending_balance"]
print("ENDING_DIFF", round(b_end - s_end, 2))
st, rest = call("PUT", "/api/forecast/scenario", saved)
print("RESTORE_STATUS", st)
st, back = call("GET", "/api/forecast/scenario")
print("READBACK_STATUS", st)
print("READBACK_MATCHES_SAVED", back == saved)
print("READBACK", json.dumps(back))
