"""FastAPI routes for the CashPulse API.

Run from the server/ directory so the sibling modules (db, auth, engine, seed, schemas) import directly.
Every protected route filters by the signed-in user's id; another user's row returns 404.
"""

import calendar
import json
import sqlite3
import urllib.parse
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response

import ai_executor
import agent_chat
import auth
import engine
import seed
from auth import get_current_user
from db import get_conn, get_db, init_db, new_id
from permissions import TOOLS, permission_gate, preset, validate_permissions
from schemas import (
    AIPermissionsIn,
    AIToolRunIn,
    AgentChatIn,
    BankBalanceIn,
    BillIn,
    BillPatch,
    CustomerIn,
    CustomerPatch,
    DeferIn,
    InvoiceIn,
    InvoicePatch,
    LoginIn,
    MessageIn,
    MessageStatusIn,
    PaymentIn,
    ScenarioIn,
    SignupIn,
)

HORIZONS = (30, 60, 90)
UPI_ID_NEW_USER = "physiocare@okaxis"
DEFER_ALERT_WINDOW_DAYS = 14
SEVERITY_RANK = {"critical": 0, "warning": 1, "info": 2}
MESSAGE_TRANSITIONS = {"QUEUED": {"SENT", "FAILED"}, "SENT": {"DELIVERED", "FAILED"}}

# Columns that may be sent from the PATCH models. Names match the table columns.
CUSTOMER_FIELDS = {"name", "phone", "email", "relationship_tier", "notes"}
INVOICE_FIELDS = {"amount", "due_date", "issue_date", "service_description"}
BILL_FIELDS = {"title", "category", "amount", "due_date", "is_recurring_monthly", "is_deferrable", "is_paid"}
# NOT NULL columns: an explicit null in a PATCH is ignored instead of hitting the database.
NOT_NULL_COLUMNS = {
    "name", "relationship_tier", "amount", "due_date", "service_description",
    "title", "category", "is_recurring_monthly", "is_deferrable", "is_paid",
}

_INVOICE_SQL = """
    SELECT i.*, c.name AS customer_name, c.past_invoice_count, c.past_late_count,
           c.moving_avg_delay_days
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id
    WHERE i.user_id = ?
"""


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    conn = get_conn()
    try:
        seed.seed_demo_user(conn)
    finally:
        conn.close()
    yield


app = FastAPI(title="CashPulse API", lifespan=lifespan)


# ---------- small helpers ----------

def _today() -> date:
    return date.today()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _money(amount: float) -> str:
    """Comma-free rupee text: 1234 -> '1234', 1234.5 -> '1234.50'."""
    value = round(float(amount), 2)
    if value == int(value):
        return str(int(value))
    return f"{value:.2f}"


def _check_horizon(horizon: int) -> None:
    if horizon not in HORIZONS:
        raise HTTPException(status_code=422, detail="horizon must be 30, 60 or 90.")


def _owned_row(conn: sqlite3.Connection, table: str, row_id: str, user_id: str) -> sqlite3.Row:
    """Returns the row when it belongs to this user, otherwise 404. `table` is always a fixed name here."""
    row = conn.execute(
        f"SELECT * FROM {table} WHERE id = ? AND user_id = ?", (row_id, user_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return row


def _update_owned(
    conn: sqlite3.Connection, table: str, row_id: str, user_id: str, changes: Dict[str, Any]
) -> None:
    _owned_row(conn, table, row_id, user_id)
    changes = {k: v for k, v in changes.items() if not (v is None and k in NOT_NULL_COLUMNS)}
    if not changes:
        return
    assignments = ", ".join(f"{column} = ?" for column in changes)
    with conn:
        conn.execute(
            f"UPDATE {table} SET {assignments} WHERE id = ? AND user_id = ?",
            (*changes.values(), row_id, user_id),
        )


# ---------- JSON shapes ----------

def _user_json(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": user["id"],
        "name": user["name"],
        "clinicName": user["clinic_name"],
        "email": user["email"],
        "upiId": user["upi_id"],
        "bankBalance": float(user["bank_balance"]),
    }


def _customer_json(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "phone": row["phone"],
        "email": row["email"],
        "relationshipTier": row["relationship_tier"],
        "notes": row["notes"],
        "pastInvoiceCount": row["past_invoice_count"],
        "pastLateCount": row["past_late_count"],
        "movingAvgDelayDays": float(row["moving_avg_delay_days"]),
        "createdAt": row["created_at"],
        "risk": engine.client_risk(row["past_invoice_count"], row["moving_avg_delay_days"]),
    }


def _invoice_dicts(
    conn: sqlite3.Connection, user_id: str, invoice_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Invoices joined with their customer's history. due_date is a datetime.date for the engine."""
    sql = _INVOICE_SQL
    params: tuple = (user_id,)
    if invoice_id is not None:
        sql += " AND i.id = ?"
        params = (user_id, invoice_id)
    sql += " ORDER BY i.due_date, i.id"
    records = []
    for row in conn.execute(sql, params).fetchall():
        rec = dict(row)
        rec["due_date"] = date.fromisoformat(rec["due_date"])
        records.append(rec)
    return records


def _load_invoice(conn: sqlite3.Connection, user_id: str, invoice_id: str) -> Dict[str, Any]:
    found = _invoice_dicts(conn, user_id, invoice_id)
    if not found:
        raise HTTPException(status_code=404, detail="Not found.")
    return found[0]


def _invoice_json(rec: Dict[str, Any], today: date) -> Dict[str, Any]:
    balance = engine.balance_due(rec["amount"], rec["amount_paid"])
    return {
        "id": rec["id"],
        "invoiceNumber": rec["invoice_number"],
        "customerId": rec["customer_id"],
        "customerName": rec["customer_name"],
        "serviceDescription": rec["service_description"],
        "amount": rec["amount"],
        "amountPaid": rec["amount_paid"],
        "balance": balance,
        "issueDate": rec["issue_date"],
        "dueDate": rec["due_date"].isoformat(),
        "daysOverdue": engine.days_overdue(rec["due_date"], today, balance),
        "status": engine.invoice_status(rec["amount"], rec["amount_paid"], rec["due_date"], today),
        "upiLink": rec["upi_link"],
        "lastRemindedAt": rec["last_reminded_at"],
    }


def _bill_from_row(row: sqlite3.Row) -> Dict[str, Any]:
    rec = dict(row)
    rec["due_date"] = date.fromisoformat(rec["due_date"])
    rec["is_recurring_monthly"] = bool(rec["is_recurring_monthly"])
    rec["is_deferrable"] = bool(rec["is_deferrable"])
    rec["is_paid"] = bool(rec["is_paid"])
    return rec


def _bill_dicts(conn: sqlite3.Connection, user_id: str) -> List[Dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM bills WHERE user_id = ? ORDER BY due_date, id", (user_id,)
    ).fetchall()
    return [_bill_from_row(row) for row in rows]


def _bill_json(rec: Dict[str, Any]) -> Dict[str, Any]:
    effective = rec["due_date"] + timedelta(days=rec["deferred_days"])
    return {
        "id": rec["id"],
        "title": rec["title"],
        "category": rec["category"],
        "amount": float(rec["amount"]),
        "dueDate": effective.isoformat(),
        "isPaid": rec["is_paid"],
        "deferredDays": rec["deferred_days"],
        "isRecurringMonthly": rec["is_recurring_monthly"],
        "isDeferrable": rec["is_deferrable"],
    }


def _bill_response(conn: sqlite3.Connection, user_id: str, bill_id: str) -> Dict[str, Any]:
    return _bill_json(_bill_from_row(_owned_row(conn, "bills", bill_id, user_id)))


def _message_json(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "invoiceId": row["invoice_id"],
        "customerId": row["customer_id"],
        "customerName": row["customer_name"],
        "channel": row["channel"],
        "tone": row["tone"],
        "includedPartialOption": bool(row["included_partial_option"]),
        "body": row["body"],
        "status": row["status"],
        "sentAt": row["sent_at"],
        "triggeredBy": row["triggered_by"],
    }


# ---------- scenario ----------

def _default_scenario() -> Dict[str, Any]:
    return {
        "horizon_days": 90,
        "invoice_delay_overrides": {},
        "global_late_days_shift": 0,
        "extra_expense_shock": None,
        "include_moving_avg_risk": True,
    }


def _load_scenario(conn: sqlite3.Connection, user_id: str) -> Dict[str, Any]:
    """Saved scenario in engine key format, or the defaults when no row exists."""
    row = conn.execute("SELECT * FROM scenarios WHERE user_id = ?", (user_id,)).fetchone()
    if row is None:
        return _default_scenario()
    shock = row["extra_expense_shock"]
    return {
        "horizon_days": row["horizon_days"],
        "invoice_delay_overrides": json.loads(row["invoice_delay_overrides"] or "{}"),
        "global_late_days_shift": row["global_late_days_shift"],
        "extra_expense_shock": json.loads(shock) if shock else None,
        "include_moving_avg_risk": bool(row["include_moving_avg_risk"]),
    }


def _scenario_json(scenario: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "horizonDays": scenario["horizon_days"],
        "invoiceDelayOverrides": scenario["invoice_delay_overrides"],
        "globalLateDaysShift": scenario["global_late_days_shift"],
        "extraExpenseShock": scenario["extra_expense_shock"],
        "includeMovingAvgRisk": scenario["include_moving_avg_risk"],
    }


def _check_shock(shock: Dict[str, Any]) -> None:
    if {"title", "amount", "day_offset"} - set(shock):
        raise HTTPException(status_code=422, detail="extra_expense_shock needs title, amount and day_offset.")
    try:
        float(shock["amount"])
        int(shock["day_offset"])
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="extra_expense_shock amount and day_offset must be numbers.")


# ---------- snapshot and dashboard ----------

def _alerts(
    today: date, invoices: List[Dict[str, Any]], bills: List[Dict[str, Any]], crunch: Dict[str, Any]
) -> List[Dict[str, Any]]:
    alerts: List[Dict[str, Any]] = []

    overdue = []
    for inv in invoices:
        balance = engine.balance_due(inv["amount"], inv["amount_paid"])
        if engine.days_overdue(inv["due_date"], today, balance) > 0:
            overdue.append((balance, inv))

    top_overdue = max(overdue, key=lambda pair: pair[0]) if overdue else None

    if crunch["first_crunch_date"] is not None:
        body = None
        cust_id = None
        inv_id = None
        action_label = None
        if top_overdue:
            bal, inv = top_overdue
            body = f"Chase {inv['customer_name']} (₹{_money(bal)} overdue) today to cover this gap."
            cust_id = inv["customer_id"]
            inv_id = inv["id"]
            action_label = f"Chase {inv['customer_name']}"
        alerts.append({
            "id": "crunch",
            "severity": "critical",
            "title": f"Cash short by ₹{_money(crunch['shortfall'])} on {crunch['first_crunch_date']}",
            "body": body,
            "amount": crunch["shortfall"],
            "customerId": cust_id,
            "invoiceId": inv_id,
            "actionLabel": action_label,
        })
    elif top_overdue:
        balance, inv = top_overdue
        alerts.append({
            "id": f"overdue-{inv['id']}",
            "severity": "warning",
            "title": f"Chase {inv['customer_name']}: ₹{_money(balance)} overdue",
            "body": f"Invoice {inv['invoice_number']} is {engine.days_overdue(inv['due_date'], today, balance)} days overdue.",
            "amount": balance,
            "customerId": inv["customer_id"],
            "invoiceId": inv["id"],
            "actionLabel": f"Chase {inv['customer_name']}",
        })

    limit = today + timedelta(days=DEFER_ALERT_WINDOW_DAYS)
    for bill in bills:
        if bill["is_paid"]:
            continue
        effective = bill["due_date"] + timedelta(days=bill["deferred_days"])
        if effective <= today:
            alerts.append({
                "id": f"bill-due-{bill['id']}",
                "severity": "warning",
                "title": f"Billing date reached: {bill['title']} (₹{_money(bill['amount'])})",
                "body": f"Would you like to reduce ₹{_money(bill['amount'])} from your bank balance and settle this bill?" + (" (Non-recurring: bill will be deleted)" if not bill.get("is_recurring_monthly") else " (Monthly recurring: will schedule next billing for next month)"),
                "amount": round(float(bill["amount"]), 2),
                "billId": bill["id"],
                "isRecurringMonthly": bool(bill.get("is_recurring_monthly")),
                "actionLabel": "Settle from Bank",
            })
        elif effective <= limit and bill.get("is_deferrable"):
            alerts.append({
                "id": f"bill-{bill['id']}",
                "severity": "info",
                "title": f"{bill['title']} due {effective.isoformat()} can be deferred",
                "amount": round(float(bill["amount"]), 2),
            })

    alerts.sort(key=lambda a: (SEVERITY_RANK[a["severity"]], -a["amount"]))
    return alerts


def _kpis(today: date, invoices: List[Dict[str, Any]], crunch: Dict[str, Any]) -> Dict[str, Any]:
    owed = 0.0
    open_count = 0
    overdue_total = 0.0
    for inv in invoices:
        balance = engine.balance_due(inv["amount"], inv["amount_paid"])
        if balance <= 0:
            continue
        open_count += 1
        owed += balance
        if engine.days_overdue(inv["due_date"], today, balance) > 0:
            overdue_total += balance
    return {
        "owed": round(owed, 2),
        "openCount": open_count,
        "overdue": round(overdue_total, 2),
        "cashSafeUntil": crunch["cash_safe_until"],
        "firstCrunchDate": crunch["first_crunch_date"],
        "shortfall": crunch["shortfall"],
        "lowestBalance": crunch["lowest_balance"],
    }


def build_snapshot(
    conn: sqlite3.Connection,
    user: Dict[str, Any],
    today: date,
    horizon: int,
    scenario: Dict[str, Any],
) -> Dict[str, Any]:
    """Loads the user's data and computes the projection, crunch, aging, monthly summary, alerts and KPIs."""
    bank_balance = float(
        conn.execute("SELECT bank_balance FROM users WHERE id = ?", (user["id"],)).fetchone()["bank_balance"]
    )
    invoices = _invoice_dicts(conn, user["id"])
    bills = _bill_dicts(conn, user["id"])
    projection = engine.project(today, horizon, bank_balance, invoices, bills, scenario)
    received_after = projection["received_after_horizon"]
    crunch = {
        "baseline": engine.detect_crunch(projection["baseline"], received_after["baseline"]),
        "simulated": engine.detect_crunch(projection["simulated"], received_after["simulated"]),
    }
    return {
        "bankBalance": bank_balance,
        "projection": projection,
        "crunch": crunch,
        "aging": engine.receivables_aging(today, invoices),
        "monthly": engine.three_month_summary(projection["simulated"]),
        "alerts": _alerts(today, invoices, bills, crunch["simulated"]),
        "kpis": _kpis(today, invoices, crunch["simulated"]),
    }


# ---------- health and auth ----------

@app.get("/api/health")
def health() -> Dict[str, bool]:
    return {"ok": True}


@app.post("/api/auth/signup", status_code=201)
def signup(
    body: SignupIn, response: Response, conn: sqlite3.Connection = Depends(get_db)
) -> Dict[str, Any]:
    email = _normalize_email(body.email)
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone() is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user_id = new_id("user")
    with conn:
        conn.execute(
            """INSERT INTO users (id, name, clinic_name, email, password_hash, upi_id,
                   bank_balance, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?)""",
            (user_id, body.name, body.clinic_name, email, auth.hash_password(body.password),
             UPI_ID_NEW_USER, _now_iso()),
        )
    token = auth.create_session(conn, user_id)
    auth.set_session_cookie(response, token)
    return {"user": _user_json({
        "id": user_id,
        "name": body.name,
        "clinic_name": body.clinic_name,
        "email": email,
        "upi_id": UPI_ID_NEW_USER,
        "bank_balance": 0,
    })}


@app.post("/api/auth/login")
def login(
    body: LoginIn, response: Response, conn: sqlite3.Connection = Depends(get_db)
) -> Dict[str, Any]:
    row = conn.execute(
        "SELECT * FROM users WHERE email = ?", (_normalize_email(body.email),)
    ).fetchone()
    if row is None or not auth.verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    token = auth.create_session(conn, row["id"])
    auth.set_session_cookie(response, token)
    return {"user": _user_json(dict(row))}


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, conn: sqlite3.Connection = Depends(get_db)) -> Response:
    auth.delete_session(conn, request.cookies.get(auth.SESSION_COOKIE))
    response = Response(status_code=204)
    auth.clear_session_cookie(response)
    return response


@app.get("/api/auth/me")
def me(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    return {"user": _user_json(user)}


# ---------- dashboard and forecast ----------

@app.get("/api/dashboard")
def dashboard(
    horizon: int = Query(default=90),
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _check_horizon(horizon)
    today = _today()
    snap = build_snapshot(conn, user, today, horizon, _load_scenario(conn, user["id"]))
    return {
        "today": today.isoformat(),
        "bankBalance": snap["bankBalance"],
        "kpis": snap["kpis"],
        "alerts": snap["alerts"],
        "charts": {
            "projection": {
                "horizon": horizon,
                "baseline": snap["projection"]["baseline"],
                "simulated": snap["projection"]["simulated"],
            },
            "aging": snap["aging"],
            "monthly": snap["monthly"],
        },
    }


@app.get("/api/forecast")
def forecast(
    horizon: int = Query(default=90),
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    _check_horizon(horizon)
    scenario = _load_scenario(conn, user["id"])
    snap = build_snapshot(conn, user, _today(), horizon, scenario)
    return {
        "horizon": horizon,
        "baseline": snap["projection"]["baseline"],
        "simulated": snap["projection"]["simulated"],
        "crunch": snap["crunch"],
        "scenario": _scenario_json(scenario),
    }


@app.get("/api/forecast/scenario")
def get_scenario(
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    return _scenario_json(_load_scenario(conn, user["id"]))


@app.put("/api/forecast/scenario")
def put_scenario(
    body: ScenarioIn,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    if body.extra_expense_shock is not None:
        _check_shock(body.extra_expense_shock)
    with conn:
        conn.execute(
            """INSERT INTO scenarios (user_id, horizon_days, invoice_delay_overrides,
                   global_late_days_shift, extra_expense_shock, include_moving_avg_risk)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                   horizon_days = excluded.horizon_days,
                   invoice_delay_overrides = excluded.invoice_delay_overrides,
                   global_late_days_shift = excluded.global_late_days_shift,
                   extra_expense_shock = excluded.extra_expense_shock,
                   include_moving_avg_risk = excluded.include_moving_avg_risk""",
            (
                user["id"],
                body.horizon_days,
                json.dumps(body.invoice_delay_overrides),
                body.global_late_days_shift,
                json.dumps(body.extra_expense_shock) if body.extra_expense_shock is not None else None,
                int(body.include_moving_avg_risk),
            ),
        )
    return _scenario_json(_load_scenario(conn, user["id"]))


@app.put("/api/bank-balance")
def put_bank_balance(
    body: BankBalanceIn,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, float]:
    with conn:
        conn.execute("UPDATE users SET bank_balance = ? WHERE id = ?", (body.amount, user["id"]))
    return {"bankBalance": body.amount}


# ---------- customers ----------

@app.get("/api/customers")
def list_customers(
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM customers WHERE user_id = ? ORDER BY created_at, name", (user["id"],)
    ).fetchall()
    return [_customer_json(row) for row in rows]


@app.post("/api/customers", status_code=201)
def create_customer(
    body: CustomerIn,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    customer_id = new_id("cust")
    with conn:
        conn.execute(
            """INSERT INTO customers (id, user_id, name, phone, email, relationship_tier,
                   past_invoice_count, past_late_count, moving_avg_delay_days, notes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)""",
            (customer_id, user["id"], body.name, body.phone, body.email,
             body.relationship_tier, body.notes, _now_iso()),
        )
    return _customer_json(_owned_row(conn, "customers", customer_id, user["id"]))


@app.patch("/api/customers/{customer_id}", status_code=204)
def update_customer(
    customer_id: str,
    body: CustomerPatch,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Response:
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in CUSTOMER_FIELDS}
    _update_owned(conn, "customers", customer_id, user["id"], changes)
    return Response(status_code=204)


@app.delete("/api/customers/{customer_id}", status_code=204)
def delete_customer(
    customer_id: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Response:
    _owned_row(conn, "customers", customer_id, user["id"])
    with conn:
        conn.execute("DELETE FROM messages WHERE customer_id = ? AND user_id = ?", (customer_id, user["id"]))
        conn.execute("DELETE FROM customers WHERE id = ? AND user_id = ?", (customer_id, user["id"]))
    return Response(status_code=204)


# ---------- invoices and payments ----------

@app.get("/api/invoices")
def list_invoices(
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    today = _today()
    return [_invoice_json(rec, today) for rec in _invoice_dicts(conn, user["id"])]


@app.post("/api/invoices", status_code=201)
def create_invoice(
    body: InvoiceIn,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = user["id"]
    _owned_row(conn, "customers", body.customer_id, user_id)
    today = _today()
    count = conn.execute("SELECT COUNT(*) FROM invoices WHERE user_id = ?", (user_id,)).fetchone()[0]
    invoice_number = f"INV-{today.year}-{count + 101:03d}"
    pn = urllib.parse.quote(user.get("clinic_name") or "Clinic")
    upi_link = (
        f"upi://pay?pa={user['upi_id']}&pn={pn}"
        f"&am={body.amount:.2f}&cu=INR&tn={invoice_number}"
    )
    invoice_id = new_id("inv")
    with conn:
        conn.execute(
            """INSERT INTO invoices (id, user_id, invoice_number, customer_id, service_description,
                   amount, amount_paid, issue_date, due_date, upi_link, last_reminded_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 'USER')""",
            (invoice_id, user_id, invoice_number, body.customer_id, body.service_description,
             body.amount, body.issue_date or today.isoformat(), body.due_date, upi_link),
        )
    return _invoice_json(_load_invoice(conn, user_id, invoice_id), today)


@app.patch("/api/invoices/{invoice_id}")
def update_invoice(
    invoice_id: str,
    body: InvoicePatch,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = user["id"]
    current = _load_invoice(conn, user_id, invoice_id)
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in INVOICE_FIELDS}
    new_amount = changes.get("amount")
    if new_amount is not None and new_amount < current["amount_paid"]:
        raise HTTPException(status_code=422, detail="Amount cannot be below the amount already paid.")
    _update_owned(conn, "invoices", invoice_id, user_id, changes)
    return _invoice_json(_load_invoice(conn, user_id, invoice_id), _today())


@app.delete("/api/invoices/{invoice_id}", status_code=204)
def delete_invoice(
    invoice_id: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Response:
    _owned_row(conn, "invoices", invoice_id, user["id"])
    with conn:
        conn.execute("DELETE FROM invoices WHERE id = ? AND user_id = ?", (invoice_id, user["id"]))
    return Response(status_code=204)


@app.post("/api/invoices/{invoice_id}/payments", status_code=201)
def record_payment(
    invoice_id: str,
    body: PaymentIn,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = user["id"]
    rec = _load_invoice(conn, user_id, invoice_id)
    today = _today()
    paid_on = date.fromisoformat(body.paid_on) if body.paid_on else today
    try:
        result = engine.apply_payment(
            amount=rec["amount"],
            amount_paid=rec["amount_paid"],
            amount_total=rec["amount"],
            due=rec["due_date"],
            paid_on=paid_on,
            past_invoice_count=rec["past_invoice_count"],
            past_late_count=rec["past_late_count"],
            moving_avg_delay_days=rec["moving_avg_delay_days"],
            pay=body.amount,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    with conn:
        conn.execute(
            "UPDATE invoices SET amount_paid = ? WHERE id = ? AND user_id = ?",
            (result["amount_paid"], invoice_id, user_id),
        )
        conn.execute(
            """UPDATE customers SET past_invoice_count = ?, past_late_count = ?,
                   moving_avg_delay_days = ? WHERE id = ? AND user_id = ?""",
            (result["past_invoice_count"], result["past_late_count"],
             result["moving_avg_delay_days"], rec["customer_id"], user_id),
        )
        conn.execute(
            """INSERT INTO payments (id, invoice_id, user_id, amount, paid_on, method)
               VALUES (?, ?, ?, ?, ?, NULL)""",
            (new_id("pay"), invoice_id, user_id, result["applied"], paid_on.isoformat()),
        )
        conn.execute(
            "UPDATE users SET bank_balance = bank_balance + ? WHERE id = ?",
            (result["applied"], user_id),
        )
    return _invoice_json(_load_invoice(conn, user_id, invoice_id), today)


@app.post("/api/invoices/{invoice_id}/reminded")
def mark_reminded(
    invoice_id: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = user["id"]
    _owned_row(conn, "invoices", invoice_id, user_id)
    with conn:
        conn.execute(
            "UPDATE invoices SET last_reminded_at = ? WHERE id = ? AND user_id = ?",
            (_now_iso(), invoice_id, user_id),
        )
    return _invoice_json(_load_invoice(conn, user_id, invoice_id), _today())


# ---------- bills ----------

@app.get("/api/bills")
def list_bills(
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    return [_bill_json(rec) for rec in _bill_dicts(conn, user["id"])]


@app.post("/api/bills", status_code=201)
def create_bill(
    body: BillIn,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    bill_id = new_id("bill")
    with conn:
        conn.execute(
            """INSERT INTO bills (id, user_id, title, category, amount, due_date,
                   is_recurring_monthly, is_deferrable, deferred_days, is_paid)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)""",
            (bill_id, user["id"], body.title, body.category, body.amount, body.due_date,
             int(body.is_recurring_monthly), int(body.is_deferrable)),
        )
    return _bill_response(conn, user["id"], bill_id)


@app.patch("/api/bills/{bill_id}")
def update_bill(
    bill_id: str,
    body: BillPatch,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    changes = {
        k: (int(v) if isinstance(v, bool) else v)
        for k, v in body.model_dump(exclude_unset=True).items()
        if k in BILL_FIELDS
    }
    _update_owned(conn, "bills", bill_id, user["id"], changes)
    return _bill_response(conn, user["id"], bill_id)


@app.delete("/api/bills/{bill_id}", status_code=204)
def delete_bill(
    bill_id: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Response:
    _owned_row(conn, "bills", bill_id, user["id"])
    with conn:
        conn.execute("DELETE FROM bills WHERE id = ? AND user_id = ?", (bill_id, user["id"]))
    return Response(status_code=204)


@app.post("/api/bills/{bill_id}/paid")
def mark_bill_paid(
    bill_id: str,
    deduct_from_bank: bool = Query(True),
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = user["id"]
    row = _owned_row(conn, "bills", bill_id, user_id)
    amount = float(row["amount"])
    is_recurring = bool(row["is_recurring_monthly"])
    title = row["title"]

    with conn:
        if deduct_from_bank:
            conn.execute(
                "UPDATE users SET bank_balance = bank_balance - ? WHERE id = ?",
                (amount, user_id),
            )

        if is_recurring:
            # Advance due_date by 1 calendar month, reset deferred_days to 0, keep is_paid = 0
            current_due = date.fromisoformat(row["due_date"])
            new_year = current_due.year + (1 if current_due.month == 12 else 0)
            new_month = 1 if current_due.month == 12 else current_due.month + 1
            max_days = calendar.monthrange(new_year, new_month)[1]
            new_day = min(current_due.day, max_days)
            next_due = date(new_year, new_month, new_day)

            conn.execute(
                "UPDATE bills SET due_date = ?, deferred_days = 0, is_paid = 0 WHERE id = ? AND user_id = ?",
                (next_due.isoformat(), bill_id, user_id),
            )
            updated_row = conn.execute("SELECT * FROM bills WHERE id = ? AND user_id = ?", (bill_id, user_id)).fetchone()
            res = _bill_json(_bill_from_row(updated_row))
            res["deleted"] = False
            res["amountDeducted"] = amount if deduct_from_bank else 0.0
            res["nextDue"] = next_due.isoformat()
            res["message"] = f"Bill '{title}' settled. ₹{_money(amount)} deducted from bank. Next billing date scheduled for {next_due.isoformat()}."
            return res
        else:
            # Non-recurring bill: delete the bill!
            conn.execute("DELETE FROM bills WHERE id = ? AND user_id = ?", (bill_id, user_id))
            return {
                "id": bill_id,
                "title": title,
                "deleted": True,
                "isRecurringMonthly": False,
                "amountDeducted": amount if deduct_from_bank else 0.0,
                "message": f"Bill '{title}' settled. ₹{_money(amount)} deducted from bank. Bill deleted.",
            }


@app.post("/api/bills/{bill_id}/defer")
def defer_bill(
    bill_id: str,
    body: Optional[DeferIn] = None,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    row = _owned_row(conn, "bills", bill_id, user["id"])
    if not row["is_deferrable"]:
        raise HTTPException(status_code=422, detail="This bill cannot be deferred.")
    days = body.days if body is not None else 7
    with conn:
        conn.execute(
            "UPDATE bills SET deferred_days = deferred_days + ? WHERE id = ? AND user_id = ?",
            (days, bill_id, user["id"]),
        )
    return _bill_response(conn, user["id"], bill_id)


# ---------- messages ----------

@app.get("/api/messages")
def list_messages(
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM messages WHERE user_id = ? ORDER BY sent_at DESC", (user["id"],)
    ).fetchall()
    return [_message_json(row) for row in rows]


@app.post("/api/messages", status_code=201)
def create_message(
    body: MessageIn,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = user["id"]
    customer = _owned_row(conn, "customers", body.customer_id, user_id)
    if body.invoice_id is not None:
        _owned_row(conn, "invoices", body.invoice_id, user_id)
    message_id = new_id("msg")
    with conn:
        conn.execute(
            """INSERT INTO messages (id, user_id, invoice_id, customer_id, customer_name, channel,
                   tone, included_partial_option, body, status, sent_at, triggered_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, 'USER')""",
            (message_id, user_id, body.invoice_id, body.customer_id, customer["name"],
             body.channel, body.tone, int(body.included_partial_option), body.body, _now_iso()),
        )
    return _message_json(_owned_row(conn, "messages", message_id, user_id))


@app.patch("/api/messages/{message_id}")
def update_message_status(
    message_id: str,
    body: MessageStatusIn,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = user["id"]
    row = _owned_row(conn, "messages", message_id, user_id)
    if body.status not in MESSAGE_TRANSITIONS.get(row["status"], set()):
        raise HTTPException(status_code=422, detail="Invalid status transition.")
    with conn:
        conn.execute(
            "UPDATE messages SET status = ? WHERE id = ? AND user_id = ?",
            (body.status, message_id, user_id),
        )
    return _message_json(_owned_row(conn, "messages", message_id, user_id))


# ---------- AI permissions, tool runs, approvals and audit ----------

AI_SETTINGS_URL = "/settings/ai-permissions"


@contextmanager
def _ai_errors():
    """Executor errors to HTTP: unknown row -> 404, bad args or a rule failure -> 422."""
    try:
        yield
    except ai_executor.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _insert_audit(
    conn: sqlite3.Connection, user_id: str, tool_name: str, args: Dict[str, Any], summary: str,
    impact: Optional[float], status: str, snapshot: Optional[str] = None, undoable: bool = False,
) -> str:
    audit_id = new_id("aud")
    with conn:
        conn.execute(
            """INSERT INTO ai_audit (id, user_id, tool_name, args_json, human_summary, impact_inr,
                   status, snapshot_json, undoable, created_at, undone_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)""",
            (audit_id, user_id, tool_name, json.dumps(args), summary, impact, status,
             snapshot, int(undoable), _now_iso()),
        )
    return audit_id


def _audit_json(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "toolName": row["tool_name"],
        "humanSummary": row["human_summary"],
        "impactInr": row["impact_inr"],
        "status": row["status"],
        "undoable": bool(row["undoable"]),
        "createdAt": row["created_at"],
        "undoneAt": row["undone_at"],
    }


def _pending_row(conn: sqlite3.Connection, user_id: str, audit_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM ai_audit WHERE id = ? AND user_id = ?", (audit_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found.")
    if row["status"] != "PENDING":
        raise HTTPException(status_code=409, detail="This proposal is no longer pending.")
    return row


@app.get("/api/ai/permissions")
def get_ai_permissions(
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    return ai_executor.load_permissions(conn, user["id"])


@app.put("/api/ai/permissions")
def put_ai_permissions(
    body: AIPermissionsIn,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        perms = validate_permissions(body.model_dump(by_alias=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    ai_executor.save_permissions(conn, user["id"], perms)
    return perms


@app.post("/api/ai/permissions/preset/{name}")
def apply_ai_preset(
    name: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    try:
        perms = preset(name)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown preset.")
    ai_executor.save_permissions(conn, user["id"], perms)
    return perms


@app.post("/api/ai/tools/{tool_name}/run")
def run_ai_tool(
    tool_name: str,
    body: AIToolRunIn,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    if tool_name not in TOOLS:
        raise HTTPException(status_code=404, detail="Unknown tool.")
    user_id = user["id"]
    perms = ai_executor.load_permissions(conn, user_id)
    with _ai_errors():
        args = ai_executor.check_args(tool_name, body.args)
        amount = ai_executor.impact_amount(conn, user_id, tool_name, args)
    decision = permission_gate(perms, tool_name, amount)
    summary = ai_executor.human_summary(tool_name, args)
    if decision == "AUTO_ALLOW":
        with _ai_errors():
            result = ai_executor.execute(conn, user_id, tool_name, args)
        audit_id = _insert_audit(conn, user_id, tool_name, args, result["summary"], result["impactInr"],
                                 "AUTO_EXECUTED", result["snapshot"], result["undoable"])
        return {"status": "EXECUTED", "auditId": audit_id, "summary": result["summary"],
                "undoable": result["undoable"]}
    if decision == "ASK_APPROVAL":
        audit_id = _insert_audit(conn, user_id, tool_name, args, summary, amount, "PENDING")
        return {"status": "PENDING_APPROVAL", "proposal": {
            "id": audit_id, "toolName": tool_name, "args": args, "humanSummary": summary,
            "impactPreview": amount, "status": "PENDING",
        }}
    _insert_audit(conn, user_id, tool_name, args, summary, amount, "DENIED")
    return {"status": "DENIED", "settingsUrl": AI_SETTINGS_URL}


@app.post("/api/ai/proposals/{audit_id}/approve")
def approve_ai_proposal(
    audit_id: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = user["id"]
    row = _pending_row(conn, user_id, audit_id)
    with _ai_errors():
        result = ai_executor.execute(conn, user_id, row["tool_name"], json.loads(row["args_json"]))
    with conn:
        conn.execute(
            """UPDATE ai_audit SET status = 'APPROVED', snapshot_json = ?, undoable = ?
               WHERE id = ? AND user_id = ?""",
            (result["snapshot"], int(result["undoable"]), audit_id, user_id),
        )
    return {"status": "EXECUTED", "auditId": audit_id, "summary": result["summary"],
            "undoable": result["undoable"]}


@app.post("/api/ai/proposals/{audit_id}/reject")
def reject_ai_proposal(
    audit_id: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = user["id"]
    _pending_row(conn, user_id, audit_id)
    with conn:
        conn.execute("UPDATE ai_audit SET status = 'REJECTED' WHERE id = ? AND user_id = ?", (audit_id, user_id))
    return {"status": "REJECTED", "auditId": audit_id}


@app.get("/api/ai/audit")
def list_ai_audit(
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM ai_audit WHERE user_id = ? ORDER BY created_at DESC, rowid DESC", (user["id"],)
    ).fetchall()
    return [_audit_json(row) for row in rows]


@app.post("/api/ai/audit/{audit_id}/undo")
def undo_ai_action(
    audit_id: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    user_id = user["id"]
    row = conn.execute("SELECT * FROM ai_audit WHERE id = ? AND user_id = ?", (audit_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found.")
    if not row["undoable"] or row["status"] not in ("AUTO_EXECUTED", "APPROVED"):
        raise HTTPException(status_code=409, detail="This action cannot be undone.")
    try:
        ai_executor.undo(conn, user_id, row)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    with conn:
        conn.execute(
            "UPDATE ai_audit SET status = 'UNDONE', undone_at = ? WHERE id = ? AND user_id = ?",
            (_now_iso(), audit_id, user_id),
        )
    return {"status": "UNDONE", "auditId": audit_id}


@app.post("/api/agent/chat")
def agent_chat_endpoint(
    body: AgentChatIn,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    history = [{"role": m.role, "content": m.content} for m in body.history]
    return agent_chat.handle_chat(conn, user["id"], body.message, history)


# ---------- presets ----------

@app.post("/api/presets/{preset_id}")
def apply_preset(
    preset_id: str,
    conn: sqlite3.Connection = Depends(get_db),
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    if user["email"] != seed.DEMO_EMAIL:
        raise HTTPException(
            status_code=403,
            detail="Evaluation presets can only be applied to Dr. Ananya's demo account. Your clinic account uses your own live database records.",
        )
    try:
        seed.seed_preset(conn, user["id"], preset_id, _today())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"ok": True, "preset": preset_id}
