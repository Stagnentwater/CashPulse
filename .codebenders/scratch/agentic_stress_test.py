"""Comprehensive Agentic Capabilities Test for CashPulse.

Validates the end-to-end agentic nature of Pulse AI:
1. Multi-tool batching: customer creation + invoicing in a single prompt
2. Human-in-the-loop approval: proposal creation and approval
3. Entity resolution & state mutation: partial payment by customer name
4. Audit trail & 1-click Undo: state rollback verification
5. Expense management & bill deferral
6. Cash flow stress-testing (What-if simulation)
7. Permission gate & autonomy kill-switch enforcement
"""

import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SERVER = os.path.join(ROOT, "server")
sys.path.insert(0, SERVER)

# Run against a clean isolated temporary copy of the database
TEMP_DB = os.path.join(HERE, "tmp_agentic_test.db")
REAL_DB = os.path.join(SERVER, "data", "cashpulse.db")
shutil.copyfile(REAL_DB, TEMP_DB)

import db
db.DB_PATH = TEMP_DB

from fastapi.testclient import TestClient
import main

results = []

def record(test_num: str, title: str, passed: bool, detail: str = ""):
    status = "PASS" if passed else "FAIL"
    results.append((test_num, title, status, detail))
    print(f"[{status}] Test {test_num}: {title} -> {detail}")

with TestClient(main.app) as client:
    # Authenticate as demo doctor or test owner
    login_resp = client.post("/api/auth/login", json={"email": "ananya@physiocare.demo", "password": "demo1234"})
    record("1.0", "Authentication", login_resp.status_code == 200, f"HTTP {login_resp.status_code}")

    # Reset preset to clean state
    preset_resp = client.post("/api/presets/RENT_CRUNCH")
    record("1.1", "Reset to clean baseline preset", preset_resp.status_code == 200, f"HTTP {preset_resp.status_code}")

    # Ensure permissions are in Smart Co-Pilot mode
    perm_resp = client.post("/api/ai/permissions/preset/smart_copilot")
    record("1.2", "Set Smart Co-Pilot permissions", perm_resp.status_code == 200, f"HTTP {perm_resp.status_code}")

    # =========================================================================
    # TEST 1: Multi-Tool Batching (New Customer + Tab in a single prompt)
    # =========================================================================
    multi_prompt = "Add another customer as Suresh mobile no 9876543210 new customer, and put a tab of 7000 on him"
    chat1 = client.post("/api/agent/chat", json={"message": multi_prompt, "history": []})
    c1_data = chat1.json()

    # Should have auto-executed add_customer AND created proposal for create_invoice
    has_customer_added = any(a.get("toolName") == "add_customer" for a in c1_data.get("executedActions", []))
    invoice_proposals = [p for p in c1_data.get("proposals", []) if p.get("toolName") == "create_invoice"]
    has_invoice_proposed = len(invoice_proposals) > 0

    record(
        "2.1",
        "Multi-Tool Batching: add_customer + create_invoice",
        has_customer_added and has_invoice_proposed,
        f"executed={[a['toolName'] for a in c1_data.get('executedActions', [])]}, proposals={[p['toolName'] for p in c1_data.get('proposals', [])]}"
    )

    # Verify customer Suresh actually exists in database
    conn = db.get_conn()
    suresh_row = conn.execute("SELECT id, name, phone FROM customers WHERE name = 'Suresh'").fetchone()
    record("2.2", "Database Verification: Suresh inserted", suresh_row is not None, f"CustomerId: {suresh_row['id'] if suresh_row else None}")
    suresh_id = suresh_row["id"] if suresh_row else None

    # =========================================================================
    # TEST 2: Human-in-the-Loop Approval of the Pending Invoice
    # =========================================================================
    inv_proposal_id = invoice_proposals[0]["id"] if invoice_proposals else None
    if inv_proposal_id:
        approve_resp = client.post(f"/api/ai/proposals/{inv_proposal_id}/approve")
        record("3.1", "Proposal Approval: Approve Suresh's ₹7,000 Invoice", approve_resp.status_code == 200, f"HTTP {approve_resp.status_code}")

        # Verify invoice is now present in invoices table
        inv_row = conn.execute("SELECT id, invoice_number, amount, amount_paid FROM invoices WHERE customer_id = ?", (suresh_id,)).fetchone()
        record("3.2", "Database Verification: Invoice created", inv_row is not None and inv_row["amount"] == 7000.0, f"Inv: {inv_row['invoice_number'] if inv_row else None}, Amount: ₹{inv_row['amount'] if inv_row else 0}")
        suresh_inv_id = inv_row["id"] if inv_row else None
    else:
        record("3.1", "Proposal Approval", False, "Missing invoice proposal")

    # =========================================================================
    # TEST 3: Conversational Entity Resolution & Partial Payment
    # =========================================================================
    pay_prompt = "Suresh just paid 2000 towards his bill"
    chat2 = client.post("/api/agent/chat", json={"message": pay_prompt, "history": []})
    c2_data = chat2.json()

    # Smart Co-Pilot requires approval for payments
    pay_proposals = [p for p in c2_data.get("proposals", []) if p.get("toolName") == "record_payment"]
    pay_executed = [a for a in c2_data.get("executedActions", []) if a.get("toolName") == "record_payment"]

    payment_handled = len(pay_proposals) > 0 or len(pay_executed) > 0
    record("4.1", "Conversational Payment Resolution for Suresh", payment_handled, f"Proposals: {len(pay_proposals)}, Executed: {len(pay_executed)}")

    pay_audit_id = None
    if pay_proposals:
        pay_proposal_id = pay_proposals[0]["id"]
        appr_pay = client.post(f"/api/ai/proposals/{pay_proposal_id}/approve")
        record("4.2", "Approve Payment Proposal", appr_pay.status_code == 200, f"HTTP {appr_pay.status_code}")
        pay_audit_id = pay_proposal_id
    elif pay_executed:
        pay_audit_id = pay_executed[0]["auditId"]

    # Verify amount_paid is updated in DB
    inv_after_pay = conn.execute("SELECT amount_paid FROM invoices WHERE customer_id = ?", (suresh_id,)).fetchone()
    record("4.3", "Database Verification: Payment applied", inv_after_pay is not None and inv_after_pay["amount_paid"] == 2000.0, f"amount_paid = ₹{inv_after_pay['amount_paid'] if inv_after_pay else 0}")

    # =========================================================================
    # TEST 4: Audit Trail & 1-Click Rollback (Undo)
    # =========================================================================
    if pay_audit_id:
        undo_resp = client.post(f"/api/ai/audit/{pay_audit_id}/undo")
        record("5.1", "AI Action Rollback (Undo)", undo_resp.status_code == 200, f"HTTP {undo_resp.status_code}")

        # Verify amount_paid is restored back to 0
        inv_after_undo = conn.execute("SELECT amount_paid FROM invoices WHERE customer_id = ?", (suresh_id,)).fetchone()
        record("5.2", "Database Verification: Payment reverted", inv_after_undo is not None and inv_after_undo["amount_paid"] == 0.0, f"amount_paid = ₹{inv_after_undo['amount_paid'] if inv_after_undo else -1}")
    else:
        record("5.1", "AI Action Rollback (Undo)", False, "Missing payment audit ID")

    # =========================================================================
    # TEST 5: Expense Deferral
    # =========================================================================
    defer_prompt = "Defer clinic electricity bill by 10 days"
    chat3 = client.post("/api/agent/chat", json={"message": defer_prompt, "history": []})
    c3_data = chat3.json()
    defer_ok = any(p.get("toolName") == "defer_bill" for p in c3_data.get("proposals", [])) or any(a.get("toolName") == "defer_bill" for a in c3_data.get("executedActions", []))
    record("6.1", "Bill Deferral Intent", defer_ok, f"Proposals: {len(c3_data.get('proposals', []))}, Executed: {len(c3_data.get('executedActions', []))}")

    # =========================================================================
    # TEST 6: What-If Cash Stress Simulation
    # =========================================================================
    whatif_prompt = "What happens to my cash if Suresh pays 20 days late and machine needs 10000 repair?"
    chat4 = client.post("/api/agent/chat", json={"message": whatif_prompt, "history": []})
    c4_data = chat4.json()
    whatif_ok = any(a.get("toolName") == "run_what_if_simulation" for a in c4_data.get("executedActions", [])) or any(p.get("toolName") == "run_what_if_simulation" for p in c4_data.get("proposals", []))
    record("7.1", "What-If Cash Simulation", whatif_ok, f"Executed: {len(c4_data.get('executedActions', []))}")

    # =========================================================================
    # TEST 7: Autonomy Master Kill Switch
    # =========================================================================
    # Disable AI autonomy
    client.put("/api/ai/permissions", json={
        "globalEnabled": False,
        "maxAutoApproveAmountINR": 5000,
        "toolPolicies": {
            "create_invoice": "ASK_APPROVAL",
            "record_payment": "ASK_APPROVAL",
            "add_customer": "AUTO_ALLOW",
            "add_or_update_bill": "ASK_APPROVAL",
            "defer_bill": "ASK_APPROVAL",
            "send_payment_reminder": "ASK_APPROVAL",
            "run_what_if_simulation": "AUTO_ALLOW",
            "update_opening_cash": "DENY",
        }
    })
    kill_prompt = "Bill Suresh 1500"
    chat5 = client.post("/api/agent/chat", json={"message": kill_prompt, "history": []})
    c5_data = chat5.json()
    is_blocked = (
        len(c5_data.get("executedActions", [])) == 0
        and len(c5_data.get("proposals", [])) == 0
        and any(d.get("toolName") == "global" for d in c5_data.get("deniedTools", []))
    )
    record("8.1", "Master Autonomy Kill Switch Enforcement", is_blocked, f"deniedTools={c5_data.get('deniedTools', [])}")

    conn.close()

# Clean up temporary test database
if os.path.exists(TEMP_DB):
    try:
        os.remove(TEMP_DB)
    except Exception:
        pass

print("\n" + "="*70)
print("AGENTIC STRESS TEST RESULTS SUMMARY")
print("="*70)
total_tests = len(results)
passed_tests = sum(1 for _, _, s, _ in results if s == "PASS")
for num, title, status, detail in results:
    print(f"[{status}] Test {num}: {title} | {detail}")
print("="*70)
print(f"OVERALL: {passed_tests}/{total_tests} Tests Passed ({(passed_tests/total_tests)*100:.1f}%)")
print("="*70)
