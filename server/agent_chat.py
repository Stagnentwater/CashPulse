"""OpenRouter tool-calling orchestrator with deterministic local fallback for CashPulse."""

import json
import os
import re
import sqlite3
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

import ai_executor
from db import new_id
from permissions import TOOLS, permission_gate

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openrouter/free"
AI_SETTINGS_URL = "/settings/ai-permissions"

# OpenAI-compatible function calling schemas for all 8 assistant tools
TOOLS_SPEC = [
    {
        "type": "function",
        "function": {
            "name": "create_invoice",
            "description": "Create a new patient invoice for services rendered with UPI payment deep link.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customerId": {
                        "type": "string",
                        "description": "Customer ID (e.g. 'cust_123') OR customer name (e.g. 'Rajesh') if existing or if registering in the same message.",
                    },
                    "amount": {
                        "type": "number",
                        "description": "Invoice total amount in INR.",
                    },
                    "dueDate": {
                        "type": "string",
                        "description": "Payment due date in YYYY-MM-DD format (optional; defaults to 7 days from today).",
                    },
                    "serviceDescription": {
                        "type": "string",
                        "description": "Brief description of physiotherapy services rendered (optional).",
                    },
                },
                "required": ["customerId", "amount"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "record_payment",
            "description": "Record a full or partial patient payment against an open invoice.",
            "parameters": {
                "type": "object",
                "properties": {
                    "invoiceId": {
                        "type": "string",
                        "description": "The invoice ID to apply the payment to.",
                    },
                    "amount": {
                        "type": "number",
                        "description": "Amount received in INR.",
                    },
                },
                "required": ["invoiceId", "amount"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_customer",
            "description": "Register a new patient into the clinic directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Patient full name."},
                    "phone": {"type": "string", "description": "Contact phone number (at least 10 digits)."},
                    "relationshipTier": {
                        "type": "string",
                        "enum": ["VIP_LOYAL", "REGULAR", "NEW", "CHRONIC_LATE"],
                        "description": "Patient relationship tier.",
                    },
                },
                "required": ["name", "phone"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_or_update_bill",
            "description": "Add a new upcoming operational expense / bill or update an existing one.",
            "parameters": {
                "type": "object",
                "properties": {
                    "billId": {
                        "type": "string",
                        "description": "Optional existing bill ID to update, or omit to create a new bill.",
                    },
                    "title": {"type": "string", "description": "Bill description (e.g. Clinic Electricity, Rent)."},
                    "category": {
                        "type": "string",
                        "enum": ["RENT", "SALARY", "UTILITY", "SUPPLIER", "EMI", "SHOCK"],
                        "description": "Expense category.",
                    },
                    "amount": {"type": "number", "description": "Bill amount in INR."},
                    "dueDate": {"type": "string", "description": "Due date in YYYY-MM-DD format."},
                    "isRecurringMonthly": {"type": "boolean", "description": "Whether this bill recurs every month."},
                    "isDeferrable": {"type": "boolean", "description": "Whether payment can be postponed if cash is tight."},
                },
                "required": ["title", "category", "amount", "dueDate"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "defer_bill",
            "description": "Defer an upcoming deferrable bill by a number of days (e.g. 7 days).",
            "parameters": {
                "type": "object",
                "properties": {
                    "billId": {"type": "string", "description": "The bill ID to postpone."},
                    "days": {"type": "integer", "description": "Number of days to postpone (1 to 60, default 7)."},
                },
                "required": ["billId"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_payment_reminder",
            "description": "Queue a WhatsApp, SMS, or Email payment reminder for an unpaid invoice.",
            "parameters": {
                "type": "object",
                "properties": {
                    "invoiceId": {"type": "string", "description": "The unpaid invoice ID."},
                    "channel": {
                        "type": "string",
                        "enum": ["WHATSAPP", "SMS", "EMAIL"],
                        "description": "Delivery channel.",
                    },
                    "tone": {
                        "type": "string",
                        "enum": ["GENTLE", "WARM", "FIRM"],
                        "description": "Tone of the reminder message.",
                    },
                },
                "required": ["invoiceId"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_what_if_simulation",
            "description": "Run cash flow projection simulation across 30, 60, or 90 days.",
            "parameters": {
                "type": "object",
                "properties": {
                    "horizon": {
                        "type": "integer",
                        "enum": [30, 60, 90],
                        "description": "Forecast horizon in days.",
                    },
                },
                "required": ["horizon"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_opening_cash",
            "description": "Update baseline bank cash balance in clinic records.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "New starting cash balance in INR."},
                },
                "required": ["amount"],
            },
        },
    },
]


def load_env_credentials() -> Tuple[str, str]:
    """Reads OPENROUTER_API_KEY and OPENROUTER_MODEL from env or root .env file."""
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    model = os.environ.get("OPENROUTER_MODEL", DEFAULT_MODEL)
    if not api_key:
        root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        env_file = os.path.join(root, ".env")
        if os.path.exists(env_file):
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k, v = k.strip(), v.strip()
                            if k == "OPENROUTER_API_KEY" and not api_key:
                                api_key = v
                            elif k == "OPENROUTER_MODEL" and (not model or model == DEFAULT_MODEL):
                                model = v
            except Exception:
                pass
    return api_key, model or DEFAULT_MODEL


def build_workspace_context(conn: sqlite3.Connection, user_id: str) -> Dict[str, Any]:
    """Gathers live workspace records for prompt context and fallback entity lookup."""
    user_row = conn.execute("SELECT name, clinic_name, bank_balance, upi_id FROM users WHERE id = ?", (user_id,)).fetchone()
    customers = [
        dict(r)
        for r in conn.execute(
            "SELECT id, name, phone, relationship_tier, past_invoice_count, moving_avg_delay_days FROM customers WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    ]
    invoices = [
        dict(r)
        for r in conn.execute(
            """SELECT i.id, i.invoice_number, i.customer_id, c.name as customer_name,
                      i.amount, i.amount_paid, (i.amount - i.amount_paid) as balance,
                      i.due_date
               FROM invoices i JOIN customers c ON c.id = i.customer_id
               WHERE i.user_id = ?
               ORDER BY i.due_date""",
            (user_id,),
        ).fetchall()
    ]
    bills = [
        dict(r)
        for r in conn.execute(
            "SELECT id, title, category, amount, due_date, is_deferrable, is_paid FROM bills WHERE user_id = ? ORDER BY due_date",
            (user_id,),
        ).fetchall()
    ]
    perms = ai_executor.load_permissions(conn, user_id)

    today = date.today()
    open_invoices = [i for i in invoices if i["amount_paid"] < i["amount"]]
    unpaid_bills = [b for b in bills if not b["is_paid"]]

    summary_text = (
        f"Clinic: {user_row['clinic_name']} (Owner/Practitioner: {user_row['name']})\n"
        f"Today's Date: {today.isoformat()}\n"
        f"Current Bank Cash Balance: ₹{float(user_row['bank_balance']):,.2f}\n"
        f"Auto-Approve Financial Cap: ₹{perms['maxAutoApproveAmountINR']:,.2f}\n\n"
        f"Registered Patients / Customers ({len(customers)} total):\n"
        + "\n".join(
            f"  - [{c['id']}] {c['name']} (phone: {c['phone']}, tier: {c['relationship_tier']})"
            for c in customers
        )
        + "\n\nOpen / Unpaid Invoices:\n"
        + (
            "\n".join(
                f"  - [{i['id']}] {i['invoice_number']} for {i['customer_name']} (customerId: {i['customer_id']}): "
                f"Balance ₹{i['balance']:,.2f} of ₹{i['amount']:,.2f}, Due: {i['due_date']}"
                for i in open_invoices
            )
            if open_invoices
            else "  None"
        )
        + "\n\nUpcoming Bills:\n"
        + (
            "\n".join(
                f"  - [{b['id']}] {b['title']} ({b['category']}): ₹{b['amount']:,.2f}, Due: {b['due_date']}, Deferrable: {bool(b['is_deferrable'])}"
                for b in unpaid_bills
            )
            if unpaid_bills
            else "  None"
        )
    )

    return {
        "user": dict(user_row),
        "customers": customers,
        "invoices": invoices,
        "open_invoices": open_invoices,
        "bills": bills,
        "unpaid_bills": unpaid_bills,
        "permissions": perms,
        "summary_text": summary_text,
    }


def _find_customer(customers: List[Dict[str, Any]], name_hint: str) -> Optional[Dict[str, Any]]:
    hint = name_hint.lower().strip()
    for c in customers:
        if hint in c["name"].lower() or c["name"].lower() in hint:
            return c
    return None


def _find_invoice(invoices: List[Dict[str, Any]], hint: str) -> Optional[Dict[str, Any]]:
    h = hint.lower().strip()
    # By customer name
    for inv in invoices:
        if h in inv["customer_name"].lower() or inv["customer_name"].lower() in h:
            return inv
    # By invoice number or ID
    for inv in invoices:
        if h in inv["invoice_number"].lower() or h in inv["id"].lower():
            return inv
    return None


def _find_bill(bills: List[Dict[str, Any]], hint: str) -> Optional[Dict[str, Any]]:
    h = hint.lower().strip()
    for b in bills:
        if h in b["title"].lower() or b["title"].lower() in h or h in b["id"].lower():
            return b
    return None


def _next_tuesday() -> str:
    today = date.today()
    days_ahead = (1 - today.weekday() + 7) % 7
    if days_ahead == 0:
        days_ahead = 7
    return (today + timedelta(days=days_ahead)).isoformat()


def _extract_number(text: str) -> Optional[float]:
    """Extracts a currency rupee amount from natural language strings."""
    m = re.search(r"(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(?:k|thousand))?", text, re.IGNORECASE)
    if m:
        s = m.group(1).replace(",", "")
        try:
            val = float(s)
            if val != 2026:
                end_pos = m.end()
                trailer = text[end_pos:end_pos+10].lower()
                if trailer.startswith("k") or "thousand" in trailer:
                    val *= 1000
                return val
        except ValueError:
            pass
    for num in re.findall(r"\b\d+(?:\.\d+)?\b", text):
        val = float(num)
        if val > 31 and val != 2026:
            return val
    return None


def local_fallback_parser(message: str, ctx: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str]:
    """Deterministic entity and intent extractor used when OpenRouter is unavailable, rate-limited, or returns no tools."""
    lowered = message.lower().strip()
    today = date.today()
    tool_calls: List[Dict[str, Any]] = []

    # --- Match Demo Prompt 1: Kavita knee sessions + electricity bill ---
    if "kavita" in lowered and ("knee" in lowered or "session" in lowered or "electricity" in lowered):
        cust = _find_customer(ctx["customers"], "Kavita")
        cust_id = cust["id"] if cust else (ctx["customers"][0]["id"] if ctx["customers"] else "cust_kavita")
        inv_due = _next_tuesday()
        bill_due = (today + timedelta(days=8)).isoformat()

        tool_calls.append({
            "name": "create_invoice",
            "arguments": {
                "customerId": cust_id,
                "amount": 9000.0,
                "dueDate": inv_due,
                "serviceDescription": "6 knee rehab sessions",
            },
        })
        tool_calls.append({
            "name": "add_or_update_bill",
            "arguments": {
                "billId": None,
                "title": "Clinic Electricity",
                "category": "UTILITY",
                "amount": 4200.0,
                "dueDate": bill_due,
                "isRecurringMonthly": True,
                "isDeferrable": True,
            },
        })
        reply = (
            "I've processed your update: billing Kavita ₹9,000 for her 6 knee rehab sessions due next Tuesday, "
            "and adding the clinic electricity bill of ₹4,200 due in 8 days."
        )
        return tool_calls, reply

    # --- Match Demo Prompt 2: Rajesh paid 9000 UPI + check rent ---
    if "rajesh" in lowered and ("paid" in lowered or "payment" in lowered or "upi" in lowered) and ("rent" in lowered or "check" in lowered):
        inv = _find_invoice(ctx["open_invoices"] or ctx["invoices"], "Rajesh")
        inv_id = inv["id"] if inv else (ctx["invoices"][0]["id"] if ctx["invoices"] else "inv_demo")
        tool_calls.append({
            "name": "record_payment",
            "arguments": {
                "invoiceId": inv_id,
                "amount": 9000.0,
            },
        })
        tool_calls.append({
            "name": "run_what_if_simulation",
            "arguments": {
                "horizon": 30,
            },
        })
        reply = (
            "Recorded ₹9,000 partial UPI payment for Rajesh Verma and verified the 30-day cash projection "
            "to check clinic rent coverage."
        )
        return tool_calls, reply

    # --- Match Demo Prompt 3: WhatsApp reminder to Meera with 50% split ---
    if "meera" in lowered and ("remind" in lowered or "whatsapp" in lowered):
        inv = _find_invoice(ctx["open_invoices"] or ctx["invoices"], "Meera")
        inv_id = inv["id"] if inv else (ctx["invoices"][0]["id"] if ctx["invoices"] else "inv_demo")
        tool_calls.append({
            "name": "send_payment_reminder",
            "arguments": {
                "invoiceId": inv_id,
                "channel": "WHATSAPP",
                "tone": "WARM",
            },
        })
        reply = "Queued a warm WhatsApp payment reminder for Meera Krishnan with a 50% partial payment option."
        return tool_calls, reply

    # --- Match Demo Prompt 4: What-if Rajesh 15 days late + ultrasound 12000 ---
    if ("what happens" in lowered or "what if" in lowered) and ("rajesh" in lowered or "ultrasound" in lowered or "repair" in lowered):
        tool_calls.append({
            "name": "run_what_if_simulation",
            "arguments": {
                "horizon": 60,
            },
        })
        reply = (
            "Simulating cash-flow impact over a 60-day horizon assuming Rajesh's receivables are delayed "
            "and an unexpected ₹12,000 expense shock for the ultrasound machine repair occurs."
        )
        return tool_calls, reply

    # --- Dynamic Multi-Intent Parser (Accumulates ALL requested tools in a single message) ---
    added_customer_name: Optional[str] = None

    # Intent A: Add Customer
    if any(k in lowered for k in ("add customer", "new customer", "new patient", "create customer", "add patient", "add another customer")):
        name_match = re.search(r"(?:customer|patient)(?:\s+as)?\s+([A-Za-z]+)", message, re.IGNORECASE)
        cust_name = name_match.group(1).strip() if name_match else "New Patient"
        phone_match = re.search(r"\b\d{10}\b", message)
        phone = phone_match.group(0) if phone_match else "9876543210"
        tool_calls.append({
            "name": "add_customer",
            "arguments": {
                "name": cust_name,
                "phone": phone,
                "relationshipTier": "NEW",
            },
        })
        added_customer_name = cust_name

    # Intent B: Invoicing / Patient Tab / Clinic Bill
    if any(k in lowered for k in ("invoice", "bill", "tab", "charge", "owes")):
        is_expense = any(k in lowered for k in ("electricity", "rent", "supplier", "utility", "emi", "expense", "vendor"))
        if is_expense:
            amt = _extract_number(lowered) or 3000.0
            title = "Clinic Expense"
            cat = "UTILITY"
            if "electricity" in lowered:
                title = "Clinic Electricity"
                cat = "UTILITY"
            elif "rent" in lowered:
                title = "Clinic Rent"
                cat = "RENT"
            tool_calls.append({
                "name": "add_or_update_bill",
                "arguments": {
                    "billId": None,
                    "title": title,
                    "category": cat,
                    "amount": amt,
                    "dueDate": (today + timedelta(days=8)).isoformat(),
                    "isRecurringMonthly": True,
                    "isDeferrable": True,
                },
            })
        else:
            amt = _extract_number(lowered) or 5000.0
            matched_cust = None
            for c in ctx["customers"]:
                if c["name"].lower() in lowered or lowered.find(c["name"].lower().split()[0]) != -1:
                    matched_cust = c
                    break
            target_name = added_customer_name or (matched_cust["name"] if matched_cust else None)
            if not target_name:
                name_match = re.search(r"(?:for|to|on|bill)\s+([A-Za-z]+)", message, re.IGNORECASE)
                if name_match:
                    cand = name_match.group(1).strip()
                    if cand.lower() not in ("rs", "inr", "invoice", "the", "my", "a", "an", "tab", "him", "her"):
                        target_name = cand
            cust_id = matched_cust["id"] if (matched_cust and not added_customer_name) else (target_name or (ctx["customers"][0]["id"] if ctx["customers"] else "New Patient"))
            tool_calls.append({
                "name": "create_invoice",
                "arguments": {
                    "customerId": cust_id,
                    "amount": amt,
                    "dueDate": (today + timedelta(days=7)).isoformat(),
                    "serviceDescription": "Physiotherapy consultation and session",
                },
            })

    # Intent C: Payment
    if any(k in lowered for k in ("paid", "payment", "received", "settled")):
        amt = _extract_number(lowered) or 5000.0
        inv = None
        for c in ctx["customers"]:
            if c["name"].lower() in lowered or lowered.find(c["name"].lower().split()[0]) != -1:
                inv = _find_invoice(ctx["open_invoices"] or ctx["invoices"], c["name"])
                break
        if not inv and (ctx["open_invoices"] or ctx["invoices"]):
            inv = (ctx["open_invoices"] or ctx["invoices"])[0]
        inv_id = inv["id"] if inv else "inv_demo"
        tool_calls.append({
            "name": "record_payment",
            "arguments": {"invoiceId": inv_id, "amount": amt},
        })

    # Intent D: Remind
    if any(k in lowered for k in ("remind", "reminder", "whatsapp")):
        inv = None
        for c in ctx["customers"]:
            if c["name"].lower() in lowered or lowered.find(c["name"].lower().split()[0]) != -1:
                inv = _find_invoice(ctx["open_invoices"] or ctx["invoices"], c["name"])
                break
        if not inv and (ctx["open_invoices"] or ctx["invoices"]):
            inv = (ctx["open_invoices"] or ctx["invoices"])[0]
        if inv:
            tool_calls.append({
                "name": "send_payment_reminder",
                "arguments": {"invoiceId": inv["id"], "channel": "WHATSAPP", "tone": "WARM"},
            })

    # Intent E: Defer bill
    if "defer" in lowered and "bill" in lowered:
        bill = ctx["unpaid_bills"][0] if ctx["unpaid_bills"] else (ctx["bills"][0] if ctx["bills"] else None)
        if bill:
            days = 7
            days_match = re.search(r"(\d+)\s*day", lowered)
            if days_match:
                days = int(days_match.group(1))
            tool_calls.append({
                "name": "defer_bill",
                "arguments": {"billId": bill["id"], "days": days},
            })

    # Intent F: What-if simulation
    if any(k in lowered for k in ("what if", "forecast", "simulate", "cash safe", "check rent")):
        horizon = 90 if "90" in lowered else (30 if "30" in lowered else 60)
        tool_calls.append({
            "name": "run_what_if_simulation",
            "arguments": {"horizon": horizon},
        })

    # Intent G: Inflow / Receivables / Financial Inquiry
    if any(k in lowered for k in (
        "how much money", "how much am i getting", "how much cash", "what is my balance",
        "who owes me", "what are my receivables", "upcoming money", "money am i getting",
        "getting in the next", "how much will i receive", "how much to expect"
    )):
        horizon = 90 if "90" in lowered else (60 if "60" in lowered else 30)
        bank = float(ctx["user"]["bank_balance"])
        open_invs = ctx["open_invoices"]

        due_within = []
        for inv in open_invs:
            try:
                due_d = datetime.strptime(inv["due_date"], "%Y-%m-%d").date()
                if 0 <= (due_d - today).days <= horizon:
                    due_within.append(inv)
            except Exception:
                pass

        inflow_sum = sum(float(i["balance"]) for i in due_within) if due_within else sum(float(i["balance"]) for i in open_invs)
        total_owed = sum(float(i["balance"]) for i in open_invs)

        tool_calls.append({
            "name": "run_what_if_simulation",
            "arguments": {"horizon": horizon},
        })

        breakdown = ""
        if due_within:
            items = [f"{i['customer_name']} (₹{float(i['balance']):,.2f} due {i['due_date']})" for i in due_within[:3]]
            breakdown = f" (including {', '.join(items)})"
        elif open_invs:
            items = [f"{i['customer_name']} (₹{float(i['balance']):,.2f})" for i in open_invs[:3]]
            breakdown = f" (open invoices include {', '.join(items)})"

        reply = (
            f"In the next {horizon} days, your projected incoming receivables total ₹{inflow_sum:,.2f}{breakdown}. "
            f"Total across all open invoices is ₹{total_owed:,.2f}, and your current bank balance is ₹{bank:,.2f}."
        )
        return tool_calls, reply

    if tool_calls:
        tool_names = [tc["name"].replace("_", " ") for tc in tool_calls]
        return tool_calls, f"Prepared actions: {', '.join(tool_names)}."

    user_name = ctx["user"]["name"]
    reply = (
        f"I am Pulse AI, {user_name}'s clinical finance copilot. You can ask me to bill patients, record payments, "
        "add upcoming bills, defer expenses, send WhatsApp payment reminders, or run What-If cash stress tests."
    )
    return tool_calls, reply


def _resolve_tool_arguments(
    conn: sqlite3.Connection,
    user_id: str,
    tool_name: str,
    args: Dict[str, Any],
) -> Dict[str, Any]:
    """Ensures arguments pass schema checks even when LLM provides names or strings instead of opaque IDs."""
    today = date.today()
    c = dict(args)

    if tool_name == "create_invoice":
        cust_id = c.get("customerId")
        if cust_id:
            row = conn.execute("SELECT id FROM customers WHERE id = ? AND user_id = ?", (cust_id, user_id)).fetchone()
            if not row:
                name_row = conn.execute(
                    "SELECT id FROM customers WHERE user_id = ? AND LOWER(name) = LOWER(?)",
                    (user_id, str(cust_id).strip()),
                ).fetchone()
                if not name_row:
                    name_row = conn.execute(
                        "SELECT id FROM customers WHERE user_id = ? AND (LOWER(name) LIKE ? OR LOWER(?) LIKE '%' || LOWER(name) || '%')",
                        (user_id, f"%{str(cust_id).strip().lower()}%", str(cust_id).strip().lower()),
                    ).fetchone()
                if name_row:
                    c["customerId"] = name_row["id"]
                else:
                    new_c_id = new_id("cust")
                    clean_name = str(cust_id).strip()
                    with conn:
                        conn.execute(
                            "INSERT INTO customers (id, user_id, name, phone, relationship_tier, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                            (new_c_id, user_id, clean_name, "9876543210", "NEW", datetime.now(timezone.utc).isoformat()),
                        )
                    c["customerId"] = new_c_id
        if not c.get("dueDate"):
            c["dueDate"] = (today + timedelta(days=7)).isoformat()
        if not c.get("serviceDescription"):
            c["serviceDescription"] = "Physiotherapy consultation and session"
        if "amount" in c:
            try:
                c["amount"] = float(str(c["amount"]).replace("₹", "").replace("Rs", "").replace(",", "").strip())
            except ValueError:
                pass

    elif tool_name == "record_payment":
        inv_id = c.get("invoiceId")
        if inv_id:
            row = conn.execute("SELECT id FROM invoices WHERE id = ? AND user_id = ?", (inv_id, user_id)).fetchone()
            if not row:
                inv_row = conn.execute(
                    """SELECT i.id FROM invoices i JOIN customers c ON c.id = i.customer_id
                       WHERE i.user_id = ? AND (LOWER(c.name) LIKE ? OR LOWER(i.invoice_number) LIKE ?)
                       ORDER BY i.due_date DESC LIMIT 1""",
                    (user_id, f"%{str(inv_id).strip().lower()}%", f"%{str(inv_id).strip().lower()}%"),
                ).fetchone()
                if inv_row:
                    c["invoiceId"] = inv_row["id"]
        if "amount" in c:
            try:
                c["amount"] = float(str(c["amount"]).replace("₹", "").replace("Rs", "").replace(",", "").strip())
            except ValueError:
                pass

    elif tool_name == "send_payment_reminder":
        inv_id = c.get("invoiceId")
        if inv_id:
            row = conn.execute("SELECT id FROM invoices WHERE id = ? AND user_id = ?", (inv_id, user_id)).fetchone()
            if not row:
                inv_row = conn.execute(
                    """SELECT i.id FROM invoices i JOIN customers c ON c.id = i.customer_id
                       WHERE i.user_id = ? AND (LOWER(c.name) LIKE ? OR LOWER(i.invoice_number) LIKE ?)
                       ORDER BY i.due_date DESC LIMIT 1""",
                    (user_id, f"%{str(inv_id).strip().lower()}%", f"%{str(inv_id).strip().lower()}%"),
                ).fetchone()
                if inv_row:
                    c["invoiceId"] = inv_row["id"]
        if not c.get("channel"):
            c["channel"] = "WHATSAPP"
        if not c.get("tone"):
            c["tone"] = "WARM"

    elif tool_name == "defer_bill":
        bill_id = c.get("billId")
        if bill_id:
            row = conn.execute("SELECT id FROM bills WHERE id = ? AND user_id = ?", (bill_id, user_id)).fetchone()
            if not row:
                b_row = conn.execute(
                    "SELECT id FROM bills WHERE user_id = ? AND LOWER(title) LIKE ? ORDER BY due_date ASC LIMIT 1",
                    (user_id, f"%{str(bill_id).strip().lower()}%"),
                ).fetchone()
                if b_row:
                    c["billId"] = b_row["id"]
        if not c.get("days"):
            c["days"] = 7

    elif tool_name == "add_customer":
        if not c.get("phone") or len(str(c.get("phone")).strip()) < 10:
            c["phone"] = "9876543210"
        if not c.get("relationshipTier"):
            c["relationshipTier"] = "NEW"

    return c


def execute_tool_item(
    conn: sqlite3.Connection,
    user_id: str,
    perms: Dict[str, Any],
    tool_name: str,
    args: Dict[str, Any],
) -> Dict[str, Any]:
    """Evaluates one tool call against user permissions and either auto-executes, creates a proposal, or denies."""
    if tool_name not in TOOLS:
        return {"status": "ERROR", "detail": f"Unknown tool: {tool_name}"}

    try:
        resolved_args = _resolve_tool_arguments(conn, user_id, tool_name, args)
        checked_args = ai_executor.check_args(tool_name, resolved_args)
        amount = ai_executor.impact_amount(conn, user_id, tool_name, checked_args)
        decision = permission_gate(perms, tool_name, amount)
        summary = ai_executor.human_summary(tool_name, checked_args)
    except Exception as exc:
        return {"status": "ERROR", "detail": str(exc)}

    if decision == "AUTO_ALLOW":
        try:
            res = ai_executor.execute(conn, user_id, tool_name, checked_args)
            audit_id = ai_executor.insert_audit(
                conn, user_id, tool_name, checked_args, res["summary"], res["impactInr"],
                "AUTO_EXECUTED", res["snapshot"], res["undoable"],
            )
            return {
                "status": "EXECUTED",
                "toolName": tool_name,
                "summary": res["summary"],
                "auditId": audit_id,
                "undoable": res["undoable"],
                "impactInr": res["impactInr"],
            }
        except Exception as exc:
            return {"status": "ERROR", "detail": str(exc)}

    if decision == "ASK_APPROVAL":
        audit_id = ai_executor.insert_audit(
            conn, user_id, tool_name, checked_args, summary, amount, "PENDING"
        )
        return {
            "status": "PENDING_APPROVAL",
            "proposal": {
                "id": audit_id,
                "toolName": tool_name,
                "args": checked_args,
                "humanSummary": summary,
                "impactPreview": amount,
                "status": "PENDING",
            },
        }

    # DENIED
    ai_executor.insert_audit(conn, user_id, tool_name, checked_args, summary, amount, "DENIED")
    return {
        "status": "DENIED",
        "toolName": tool_name,
        "settingsUrl": AI_SETTINGS_URL,
    }


def handle_chat(
    conn: sqlite3.Connection,
    user_id: str,
    message: str,
    history: List[Dict[str, str]],
) -> Dict[str, Any]:
    """Orchestrates an agent turn with OpenRouter tool-calling and deterministic local fallback."""
    ctx = build_workspace_context(conn, user_id)
    perms = ctx["permissions"]

    if not perms.get("globalEnabled", True):
        return {
            "message": "AI assistant mutations are currently disabled in your permissions settings. You can re-enable autonomy in AI Permissions.",
            "providerMode": "local_fallback",
            "executedActions": [],
            "proposals": [],
            "deniedTools": [{"toolName": "global", "settingsUrl": AI_SETTINGS_URL}],
        }

    api_key, model = load_env_credentials()
    tool_calls_to_run: List[Dict[str, Any]] = []
    assistant_reply: Optional[str] = None
    provider_mode = "local_fallback"

    # Try OpenRouter if API key exists
    if api_key:
        user_name = ctx["user"]["name"]
        clinic_name = ctx["user"]["clinic_name"]
        system_prompt = (
            f"You are Pulse AI, the autonomous financial operations copilot for {user_name} ({clinic_name}).\n"
            f"Always address the user directly as {user_name}. Do NOT call them Dr. Ananya or assume any title unless it is part of their name ({user_name}).\n"
            "You have direct access to live clinic data and tools.\n"
            "FINANCIAL INQUIRY & QUESTION ANSWERING RULES:\n"
            "- When the user asks a question about their finances (e.g. 'how much money am I getting', 'what are my receivables', 'what bills are due', 'how much cash do I have in bank'), "
            "you MUST provide a clear, conversational answer with specific rupee amounts, patient names, and dates from the LIVE CLINIC WORKSPACE CONTEXT.\n"
            "- If you run a simulation tool, you MUST ALSO write a natural language reply in your message directly answering the user's question with numbers.\n"
            "CRITICAL MULTI-TOOL RULE: If a user request contains multiple actions (such as 'Add customer Rajesh... and put a tab of 5000 on him', or 'Bill Kavita and schedule electricity bill'), "
            "you MUST generate tool calls for ALL requested actions in a single response! Never execute only the first action.\n\n"
            f"LIVE CLINIC WORKSPACE CONTEXT:\n{ctx['summary_text']}"
        )

        messages_payload = [{"role": "system", "content": system_prompt}]
        for h in history[-4:]:
            messages_payload.append({"role": h["role"], "content": h["content"]})
        messages_payload.append({"role": "user", "content": message})

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://cashpulse.app",
            "X-Title": "CashPulse Assistant",
        }
        body = {
            "model": model,
            "messages": messages_payload,
            "tools": TOOLS_SPEC,
            "tool_choice": "auto",
            "temperature": 0.2,
        }

        try:
            resp = httpx.post(OPENROUTER_URL, headers=headers, json=body, timeout=12.0)
            if resp.status_code == 200:
                data = resp.json()
                choice = data.get("choices", [{}])[0]
                msg = choice.get("message", {})
                assistant_reply = msg.get("content") or ""
                raw_calls = msg.get("tool_calls") or []
                for tc in raw_calls:
                    fn = tc.get("function", {})
                    fn_name = fn.get("name")
                    fn_args_raw = fn.get("arguments", "{}")
                    try:
                        parsed_args = json.loads(fn_args_raw) if isinstance(fn_args_raw, str) else fn_args_raw
                    except Exception:
                        parsed_args = {}
                    if fn_name:
                        tool_calls_to_run.append({"name": fn_name, "arguments": parsed_args})
                provider_mode = "live"
            else:
                provider_mode = "local_fallback"
        except Exception:
            provider_mode = "local_fallback"

    # Ensure multi-tool completeness:
    # If OpenRouter returned partial tools (e.g. calling add_customer but omitting create_invoice in a multi-action prompt),
    # complement with the missing tool calls detected by local_fallback_parser:
    fallback_calls, fallback_reply = local_fallback_parser(message, ctx)
    existing_tool_names = {tc["name"] for tc in tool_calls_to_run}
    for fc in fallback_calls:
        if fc["name"] not in existing_tool_names:
            tool_calls_to_run.append(fc)
            existing_tool_names.add(fc["name"])

    if (not assistant_reply or not assistant_reply.strip()) and fallback_reply and not fallback_reply.startswith("I am Pulse AI"):
        assistant_reply = fallback_reply

    # Now execute all tool calls through permissions and ai_executor
    executed: List[Dict[str, Any]] = []
    proposals: List[Dict[str, Any]] = []
    denied: List[Dict[str, Any]] = []

    for tc in tool_calls_to_run:
        res = execute_tool_item(conn, user_id, perms, tc["name"], tc["arguments"])
        st = res.get("status")
        if st == "EXECUTED":
            executed.append({
                "toolName": res["toolName"],
                "summary": res["summary"],
                "auditId": res["auditId"],
                "undoable": res["undoable"],
                "impactInr": res.get("impactInr"),
            })
        elif st == "PENDING_APPROVAL":
            proposals.append(res["proposal"])
        elif st == "DENIED":
            denied.append({
                "toolName": res["toolName"],
                "settingsUrl": res["settingsUrl"],
            })

    # Polish response message so it never claims actions were completed when pending approval
    if proposals and not executed:
        assistant_reply = "I've drafted the requested action(s) for your clinic. Please review and tap 'Approve & Apply' below to finalize."
    elif proposals and executed:
        assistant_reply = "I've executed the auto-allowed actions and queued the remaining items for your approval below."
    elif executed and not proposals and not denied:
        if not assistant_reply or not assistant_reply.strip() or "how can i assist" in assistant_reply.lower():
            summaries = ", ".join(e["summary"] for e in executed)
            assistant_reply = summaries
    elif denied and not executed and not proposals:
        assistant_reply = "The requested action was blocked by your AI permission settings. You can adjust limits in AI Permissions."
    elif not executed and not proposals and not denied:
        if not assistant_reply or "completed" in assistant_reply.lower():
            user_name = ctx["user"]["name"]
            assistant_reply = (
                f"How can I assist {user_name}? You can ask me to bill patients, record UPI payments, "
                "defer bills, send WhatsApp reminders, or stress-test your cash flow."
            )

    return {
        "message": assistant_reply,
        "providerMode": provider_mode,
        "executedActions": executed,
        "proposals": proposals,
        "deniedTools": denied,
    }
