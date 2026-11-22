import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SERVER = os.path.join(ROOT, "server")
sys.path.insert(0, SERVER)
COPY = os.path.join(HERE, "tmp_cashpulse_copy.db")

import db
db.DB_PATH = COPY  # redirect BEFORE main is imported and before any request
from fastapi.testclient import TestClient
import main

results = []
def rec(step, ok, detail):
    results.append((step, "PASS" if ok else "FAIL", detail))
    print(f"[{step}] {'PASS' if ok else 'FAIL'}  {detail}")

def show(label, r):
    try:
        body = r.json()
    except Exception:
        body = r.text
    print(f"--- {label}: HTTP {r.status_code}")
    print(json.dumps(body, indent=1, default=str)[:1500])
    return body

with TestClient(main.app) as c:
    r = c.post("/api/auth/login", json={"email": "ananya@physiocare.demo", "password": "demo1234"})
    show("login", r)
    rec("login", r.status_code == 200, f"HTTP {r.status_code}")

    # a
    r = c.get("/api/ai/permissions")
    body = show("a GET /api/ai/permissions", r)
    pol = body.get("toolPolicies", {}) if isinstance(body, dict) else {}
    cap = body.get("capInr") if isinstance(body, dict) else None
    print("   keys:", list(body.keys()) if isinstance(body, dict) else body)
    rec("a permissions", r.status_code == 200, f"HTTP {r.status_code}")

    inv_list = show("GET /api/invoices (before)", c.get("/api/invoices"))
    open_inv = [i for i in inv_list if i["balance"] >= 500]
    inv = open_inv[0]
    inv_id = inv["id"]
    prior = inv["amountPaid"]
    print(f"   chosen invoice {inv_id} amount={inv['amount']} amountPaid={prior} balance={inv['balance']} status={inv['status']}")

    # b
    r = c.post("/api/ai/tools/record_payment/run", json={"args": {"invoiceId": inv_id, "amount": 500}})
    b1 = show("b run record_payment", r)
    rec("b run -> PENDING_APPROVAL", r.status_code == 200 and b1.get("status") == "PENDING_APPROVAL", f"HTTP {r.status_code} status={b1.get('status')}")
    audit_b = b1["proposal"]["id"]
    r = c.post(f"/api/ai/proposals/{audit_b}/approve")
    show("b approve", r)
    rec("b approve -> EXECUTED", r.status_code == 200, f"HTTP {r.status_code}")
    after = next(i for i in c.get("/api/invoices").json() if i["id"] == inv_id)
    rec("b amountPaid rose by 500", after["amountPaid"] == prior + 500, f"prior={prior} after={after['amountPaid']}")

    # c
    r = c.post(f"/api/ai/audit/{audit_b}/undo")
    show("c undo record_payment", r)
    rec("c undo -> UNDONE", r.status_code == 200 and r.json().get("status") == "UNDONE", f"HTTP {r.status_code} body={r.text[:200]}")
    back = next(i for i in c.get("/api/invoices").json() if i["id"] == inv_id)
    rec("c amountPaid back to prior", back["amountPaid"] == prior, f"prior={prior} after_undo={back['amountPaid']}")

    # d
    r = c.post("/api/ai/permissions/preset/full_autopilot")
    show("d preset full_autopilot", r)
    r = c.post("/api/ai/tools/send_payment_reminder/run", json={"args": {"invoiceId": inv_id}})
    d1 = show("d run send_payment_reminder", r)
    rec("d reminder -> PENDING_APPROVAL", r.status_code == 200 and d1.get("status") == "PENDING_APPROVAL", f"HTTP {r.status_code} status={d1.get('status')}")
    if d1.get("status") == "PENDING_APPROVAL":
        audit_d = d1["proposal"]["id"]
        r = c.post(f"/api/ai/proposals/{audit_d}/approve")
        show("d approve reminder", r)
        rec("d approve -> EXECUTED", r.status_code == 200, f"HTTP {r.status_code}")
        r = c.post(f"/api/ai/audit/{audit_d}/undo")
        show("d undo reminder", r)
        rec("d undo -> 409", r.status_code == 409, f"HTTP {r.status_code} body={r.text[:200]}")

    # e
    r = c.post("/api/ai/permissions/preset/smart_copilot")
    show("e preset smart_copilot", r)
    r = c.post("/api/ai/tools/update_opening_cash/run", json={"args": {"amount": 100}})
    e1 = show("e run update_opening_cash", r)
    rec("e update_opening_cash -> DENIED", r.status_code == 200 and e1.get("status") == "DENIED", f"HTTP {r.status_code} status={e1.get('status')}")

print("\nSUMMARY")
for s, p, d in results:
    print(f"{p}\t{s}\t{d}")
