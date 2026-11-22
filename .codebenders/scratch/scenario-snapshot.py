"""Login with the demo account and GET/PUT the forecast scenario on port 8000.

Usage:
  python scenario-snapshot.py get <outfile>     # save current scenario JSON
  python scenario-snapshot.py restore <infile>  # PUT saved scenario JSON back
"""
import json
import sys
import urllib.request
from http.cookiejar import CookieJar

BASE = "http://localhost:8000"
DEMO = {"email": "ananya@physiocare.demo", "password": "demo1234"}


def opener():
    jar = CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(op, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with op.open(req, timeout=15) as resp:
        return resp.status, json.loads(resp.read().decode() or "null")


def main():
    mode, path = sys.argv[1], sys.argv[2]
    op = opener()
    status, _ = call(op, "POST", "/api/auth/login", DEMO)
    print(f"login status={status}")
    if mode == "get":
        status, scenario = call(op, "GET", "/api/forecast/scenario")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(scenario, f, indent=2)
        print(f"GET status={status} saved to {path}")
        print(json.dumps(scenario, indent=2))
    elif mode == "restore":
        with open(path, encoding="utf-8") as f:
            scenario = json.load(f)
        status, out = call(op, "PUT", "/api/forecast/scenario", scenario)
        print(f"PUT status={status}")
        print(json.dumps(out, indent=2)[:800])
    else:
        raise SystemExit("mode must be get or restore")


if __name__ == "__main__":
    main()
