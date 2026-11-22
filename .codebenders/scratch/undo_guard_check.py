import json, os, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SERVER = os.path.join(ROOT, "server")
sys.path.insert(0, SERVER)
COPY = os.path.join(HERE, "tmp_undo_guard.db")
shutil.copyfile(os.path.join(SERVER, "data", "cashpulse.db"), COPY)

import db
db.DB_PATH = COPY  # must be set BEFORE main is imported
from fastapi.testclient import TestClient
import main

def amount_paid(c, inv_id):
    return next(i for i in c.get("/api/invoices").json() if i["id"] == inv_id)["amountPaid"]

with TestClient(main.app) as c:
    r = c.post("/api/auth/login", json={"email": "ananya@physiocare.demo", "password": "demo1234"})
    print("login", r.status_code)
    invs = c.get("/api/invoices").json()
    inv = next(i for i in invs if i["balance"] >= 500)
    inv_id = inv["id"]
    prior = inv["amountPaid"]
    print("invoice", inv_id, "amountPaid(prior)=", prior, "balance=", inv["balance"])

    r = c.post("/api/ai/permissions/preset/smart_copilot")
    print("a preset smart_copilot", r.status_code)
    print("a record_payment policy", r.json()["toolPolicies"]["record_payment"])

    # b: A1 = 300
    r = c.post("/api/ai/tools/record_payment/run", json={"args": {"invoiceId": inv_id, "amount": 300}})
    print("b1 run 300", r.status_code, r.json().get("status"))
    a1 = r.json()["proposal"]["id"]
    r = c.post(f"/api/ai/proposals/{a1}/approve")
    print("b1 approve A1", r.status_code, r.json().get("status"))
    print("amountPaid after A1 =", amount_paid(c, inv_id))

    # b: A2 = 200
    r = c.post("/api/ai/tools/record_payment/run", json={"args": {"invoiceId": inv_id, "amount": 200}})
    print("b2 run 200", r.status_code, r.json().get("status"))
    a2 = r.json()["proposal"]["id"]
    r = c.post(f"/api/ai/proposals/{a2}/approve")
    print("b2 approve A2", r.status_code, r.json().get("status"))
    print("amountPaid after A2 =", amount_paid(c, inv_id))

    # c: undo A1 while A2 still applied -> expect 409
    r = c.post(f"/api/ai/audit/{a1}/undo")
    print("c undo A1 (A2 applied)", r.status_code, "detail=", r.json().get("detail"))
    print("amountPaid after refused undo A1 =", amount_paid(c, inv_id))

    # d: undo A2 -> UNDONE, then undo A1 -> UNDONE
    r = c.post(f"/api/ai/audit/{a2}/undo")
    print("d undo A2", r.status_code, r.json())
    print("amountPaid after undo A2 =", amount_paid(c, inv_id))
    r = c.post(f"/api/ai/audit/{a1}/undo")
    print("d undo A1", r.status_code, r.json())
    print("amountPaid after undo A1 =", amount_paid(c, inv_id))

print("prior was", prior, "| temp copy kept at", COPY)
