"""Stage 2 Full End-to-End Smoke Test for CashPulse."""

import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SERVER = os.path.join(ROOT, "server")
sys.path.insert(0, SERVER)

COPY = os.path.join(HERE, "tmp_stage2_smoke.db")
REAL_DB = os.path.join(SERVER, "data", "cashpulse.db")
shutil.copyfile(REAL_DB, COPY)

import db
db.DB_PATH = COPY

from fastapi.testclient import TestClient
import main

results = []

def record(step: str, ok: bool, detail: str):
    status = "PASS" if ok else "FAIL"
    results.append((step, status, detail))
    print(f"[{status}] {step}: {detail}")

with TestClient(main.app) as c:
    # 1. Login
    r = c.post("/api/auth/login", json={"email": "ananya@physiocare.demo", "password": "demo1234"})
    record("1. Login", r.status_code == 200, f"HTTP {r.status_code}")

    # Reset to clean RENT_CRUNCH preset so Rajesh & Meera have open unpaid invoices
    r = c.post("/api/presets/RENT_CRUNCH")
    record("1b. Reset to RENT_CRUNCH preset", r.status_code == 200, f"HTTP {r.status_code}")

    # 2. Permissions endpoints
    r = c.get("/api/ai/permissions")
    record("2. GET /api/ai/permissions", r.status_code == 200 and "toolPolicies" in r.json(), f"HTTP {r.status_code}")

    r = c.post("/api/ai/permissions/preset/smart_copilot")
    record("2. POST preset smart_copilot", r.status_code == 200, f"HTTP {r.status_code}")

    # 3. Agent Chat - Demo Prompt 1 (Multi-tool: Kavita invoice + Electricity bill)
    p1 = "Finished Kavita's 6 knee sessions today, bill her ₹9,000 due next Tuesday, and add clinic electricity bill ₹4,200 due in 8 days."
    r = c.post("/api/agent/chat", json={"message": p1, "history": []})
    body1 = r.json()
    p1_ok = (
        r.status_code == 200
        and body1.get("providerMode") in ("live", "local_fallback")
        and (len(body1.get("proposals", [])) > 0 or len(body1.get("executedActions", [])) > 0)
    )
    record("3. Demo Prompt 1 (Multi-tool Batch)", p1_ok, f"HTTP {r.status_code} mode={body1.get('providerMode')} proposals={len(body1.get('proposals', []))} executed={len(body1.get('executedActions', []))}")

    # 4. Agent Chat - Demo Prompt 2 (Payment 9000 UPI + check rent)
    p2 = "Rajesh just paid ₹9,000 via UPI as partial payment—update his invoice and check if rent is safe now."
    r = c.post("/api/agent/chat", json={"message": p2, "history": []})
    body2 = r.json()
    p2_ok = r.status_code == 200 and len(body2.get("proposals", [])) > 0
    record("4. Demo Prompt 2 (Payment Proposal)", p2_ok, f"HTTP {r.status_code} proposals={len(body2.get('proposals', []))}")

    # 5. Approve proposal from Prompt 2
    if body2.get("proposals"):
        prop = body2["proposals"][0]
        prop_id = prop["id"]
        r = c.post(f"/api/ai/proposals/{prop_id}/approve")
        record("5. Approve Proposal", r.status_code == 200 and r.json().get("status") == "EXECUTED", f"HTTP {r.status_code} status={r.json().get('status')}")

        # 6. Undo approved proposal
        r = c.post(f"/api/ai/audit/{prop_id}/undo")
        record("6. 1-Click Undo", r.status_code == 200 and r.json().get("status") == "UNDONE", f"HTTP {r.status_code} status={r.json().get('status')}")

    # 7. Agent Chat - Demo Prompt 3 (Warm WhatsApp reminder to Meera)
    p3 = "Send a warm WhatsApp reminder to Meera Krishnan with a 50% partial payment option."
    r = c.post("/api/agent/chat", json={"message": p3, "history": []})
    body3 = r.json()
    p3_ok = r.status_code == 200 and (len(body3.get("proposals", [])) > 0 or len(body3.get("executedActions", [])) > 0)
    record("7. Demo Prompt 3 (Reminder)", p3_ok, f"HTTP {r.status_code} proposals={len(body3.get('proposals', []))} executed={len(body3.get('executedActions', []))}")

    # 8. Agent Chat - Demo Prompt 4 (What-If simulation)
    p4 = "What happens to my cash if Rajesh pays 15 days late and my ultrasound machine needs a ₹12,000 repair?"
    r = c.post("/api/agent/chat", json={"message": p4, "history": []})
    body4 = r.json()
    p4_ok = r.status_code == 200 and len(body4.get("message", "")) > 0
    record("8. Demo Prompt 4 (Simulation)", p4_ok, f"HTTP {r.status_code} message_len={len(body4.get('message', ''))}")

    # 9. Audit Log
    r = c.get("/api/ai/audit")
    record("9. GET /api/ai/audit", r.status_code == 200 and len(r.json()) > 0, f"HTTP {r.status_code} entries={len(r.json())}")

    # 10. Master Kill Switch (globalEnabled = false)
    perms = c.get("/api/ai/permissions").json()
    perms["globalEnabled"] = False
    r = c.put("/api/ai/permissions", json=perms)
    record("10. Disable Master Switch", r.status_code == 200, f"HTTP {r.status_code}")

    r = c.post("/api/agent/chat", json={"message": "Bill Kavita 9000", "history": []})
    body10 = r.json()
    blocked_ok = r.status_code == 200 and "disabled" in body10.get("message", "") and len(body10.get("deniedTools", [])) > 0
    record("10. Block Mutations When Master Switch Disabled", blocked_ok, f"HTTP {r.status_code} denied={len(body10.get('deniedTools', []))}")

print("\n--- STAGE 2 SMOKE TEST SUMMARY ---")
all_passed = all(status == "PASS" for _, status, _ in results)
for step, status, detail in results:
    print(f"[{status}] {step}: {detail}")

print(f"\nOVERALL RESULT: {'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}")

# Clean up temp db
try:
    os.remove(COPY)
except Exception:
    pass

