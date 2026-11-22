"""AI tool executor for CashPulse. Functions take a sqlite3 connection and a user_id.

Each mutation writes the same rows as the matching Stage 1 route in main.py. This module does not
decide whether a call may run (permission_gate in permissions.py does that) and does not write
ai_audit rows (main.py does that).
"""

import json
import math
import re
import sqlite3
import urllib.parse
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import engine
from db import new_id
from permissions import default_permissions

TIERS = ("VIP_LOYAL", "REGULAR", "NEW", "CHRONIC_LATE")
CATEGORIES = ("RENT", "SALARY", "UTILITY", "SUPPLIER", "EMI", "SHOCK")
CHANNELS = ("WHATSAPP", "SMS", "EMAIL")
TONES = ("GENTLE", "WARM", "FIRM")
HORIZONS = (30, 60, 90)
UNDOABLE = frozenset({
    "create_invoice", "record_payment", "add_customer",
    "add_or_update_bill", "defer_bill", "update_opening_cash",
})
_DATE_RE = r"\d{4}-\d{2}-\d{2}"
_INVOICE_SQL = """
    SELECT i.*, c.name AS customer_name, c.past_invoice_count, c.past_late_count,
           c.moving_avg_delay_days
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    WHERE i.user_id = ?
"""


class NotFound(LookupError):
    """A referenced row is missing or belongs to another user. Routes map it to 404."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _money(amount: float) -> str:
    return f"{float(amount):,.2f}"


# ---------- argument checks ----------

def _text(args: Dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} is required")
    return value.strip()


def _amount(args: Dict[str, Any], key: str = "amount", allow_zero: bool = False) -> float:
    value = args.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{key} must be a number")
    if value < 0 or (value == 0 and not allow_zero):
        raise ValueError(f"{key} must be greater than zero" if not allow_zero else f"{key} cannot be negative")
    return float(value)


def _date(args: Dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not re.fullmatch(_DATE_RE, value):
        raise ValueError(f"{key} must be a date in YYYY-MM-DD format")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{key} must be a real date")
    return value


def _choice(args: Dict[str, Any], key: str, options: Tuple[str, ...], default: str) -> str:
    value = args.get(key) or default
    if value not in options:
        raise ValueError(f"{key} must be one of {', '.join(options)}")
    return value


def check_args(tool_name: str, args: Any) -> Dict[str, Any]:
    """Validates args for one tool (camelCase keys) and returns the normalized dict. Raises ValueError.

    Calling it again on its own output returns the same dict.
    """
    if not isinstance(args, dict):
        raise ValueError("args must be an object")
    if tool_name == "create_invoice":
        return {
            "customerId": _text(args, "customerId"),
            "amount": _amount(args),
            "dueDate": _date(args, "dueDate"),
            "serviceDescription": str(args.get("serviceDescription") or ""),
        }
    if tool_name == "record_payment":
        return {"invoiceId": _text(args, "invoiceId"), "amount": _amount(args)}
    if tool_name == "add_customer":
        phone = _text(args, "phone")
        if len(phone) < 10:
            raise ValueError("phone must be at least 10 characters")
        return {
            "name": _text(args, "name"),
            "phone": phone,
            "relationshipTier": _choice(args, "relationshipTier", TIERS, "NEW"),
        }
    if tool_name == "add_or_update_bill":
        return {
            "billId": _text(args, "billId") if args.get("billId") else None,
            "title": _text(args, "title"),
            "category": _choice(args, "category", CATEGORIES, ""),
            "amount": _amount(args),
            "dueDate": _date(args, "dueDate"),
            "isRecurringMonthly": bool(args.get("isRecurringMonthly", False)),
            "isDeferrable": bool(args.get("isDeferrable", False)),
        }
    if tool_name == "defer_bill":
        days = args.get("days", 7)
        if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 60:
            raise ValueError("days must be a whole number from 1 to 60")
        return {"billId": _text(args, "billId"), "days": days}
    if tool_name == "send_payment_reminder":
        return {
            "invoiceId": _text(args, "invoiceId"),
            "channel": _choice(args, "channel", CHANNELS, "WHATSAPP"),
            "tone": _choice(args, "tone", TONES, "GENTLE"),
        }
    if tool_name == "run_what_if_simulation":
        horizon = args.get("horizon", 90)
        if not isinstance(horizon, int) or isinstance(horizon, bool) or horizon not in HORIZONS:
            raise ValueError("horizon must be 30, 60 or 90")
        return {"horizon": horizon}
    if tool_name == "update_opening_cash":
        return {"amount": _amount(args, allow_zero=True)}
    raise ValueError(f"unknown tool: {tool_name}")


def human_summary(tool_name: str, c: Dict[str, Any]) -> str:
    """One plain sentence describing a checked call, for approval cards and the audit list."""
    if tool_name == "create_invoice":
        return f"Create an invoice for ₹{_money(c['amount'])} due {c['dueDate']}."
    if tool_name == "record_payment":
        return f"Record a ₹{_money(c['amount'])} payment on invoice {c['invoiceId']}."
    if tool_name == "add_customer":
        return f"Add customer {c['name']} ({c['relationshipTier']})."
    if tool_name == "add_or_update_bill":
        verb = "Update" if c["billId"] else "Add"
        return f"{verb} bill {c['title']} for ₹{_money(c['amount'])} due {c['dueDate']}."
    if tool_name == "defer_bill":
        return f"Defer bill {c['billId']} by {c['days']} days."
    if tool_name == "send_payment_reminder":
        return f"Send a {c['tone'].lower()} {c['channel'].lower()} reminder for invoice {c['invoiceId']}."
    if tool_name == "run_what_if_simulation":
        return f"Run a {c['horizon']}-day cash simulation."
    return f"Set opening cash to ₹{_money(c['amount'])}."


# ---------- row loading ----------

def _owned(conn: sqlite3.Connection, table: str, row_id: str, user_id: str) -> sqlite3.Row:
    """`table` is always a fixed name in this module."""
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ? AND user_id = ?", (row_id, user_id)).fetchone()
    if row is None:
        raise NotFound(f"{table} {row_id} not found")
    return row


def _invoice_records(conn: sqlite3.Connection, user_id: str, invoice_id: Optional[str] = None) -> List[Dict]:
    sql, params = _INVOICE_SQL, (user_id,)
    if invoice_id is not None:
        sql += " AND i.id = ?"
        params = (user_id, invoice_id)
    records = []
    for row in conn.execute(sql + " ORDER BY i.due_date, i.id", params).fetchall():
        rec = dict(row)
        rec["due_date"] = date.fromisoformat(rec["due_date"])
        records.append(rec)
    return records


def _invoice_record(conn: sqlite3.Connection, user_id: str, invoice_id: str) -> Dict[str, Any]:
    found = _invoice_records(conn, user_id, invoice_id)
    if not found:
        raise NotFound(f"invoice {invoice_id} not found")
    return found[0]


def _bill_records(conn: sqlite3.Connection, user_id: str) -> List[Dict]:
    records = []
    for row in conn.execute("SELECT * FROM bills WHERE user_id = ? ORDER BY due_date, id", (user_id,)).fetchall():
        rec = dict(row)
        rec["due_date"] = date.fromisoformat(rec["due_date"])
        rec["is_recurring_monthly"] = bool(rec["is_recurring_monthly"])
        rec["is_deferrable"] = bool(rec["is_deferrable"])
        rec["is_paid"] = bool(rec["is_paid"])
        records.append(rec)
    return records


def _load_scenario(conn: sqlite3.Connection, user_id: str) -> Dict[str, Any]:
    row = conn.execute("SELECT * FROM scenarios WHERE user_id = ?", (user_id,)).fetchone()
    if row is None:
        return {
            "horizon_days": 90, "invoice_delay_overrides": {}, "global_late_days_shift": 0,
            "extra_expense_shock": None, "include_moving_avg_risk": True,
        }
    shock = row["extra_expense_shock"]
    return {
        "horizon_days": row["horizon_days"],
        "invoice_delay_overrides": json.loads(row["invoice_delay_overrides"] or "{}"),
        "global_late_days_shift": row["global_late_days_shift"],
        "extra_expense_shock": json.loads(shock) if shock else None,
        "include_moving_avg_risk": bool(row["include_moving_avg_risk"]),
    }


# ---------- permissions storage ----------

def load_permissions(conn: sqlite3.Connection, user_id: str) -> Dict[str, Any]:
    """Stored settings, or the defaults saved on first read."""
    row = conn.execute("SELECT settings_json FROM ai_permissions WHERE user_id = ?", (user_id,)).fetchone()
    if row is None:
        perms = default_permissions()
        save_permissions(conn, user_id, perms)
        return perms
    return json.loads(row["settings_json"])


def save_permissions(conn: sqlite3.Connection, user_id: str, perms: Dict[str, Any]) -> None:
    with conn:
        conn.execute(
            """INSERT INTO ai_permissions (user_id, settings_json) VALUES (?, ?)
               ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json""",
            (user_id, json.dumps(perms)),
        )


def insert_audit(
    conn: sqlite3.Connection,
    user_id: str,
    tool_name: str,
    args: Dict[str, Any],
    summary: str,
    impact: Optional[float],
    status: str,
    snapshot: Optional[str] = None,
    undoable: bool = False,
) -> str:
    audit_id = new_id("aud")
    with conn:
        conn.execute(
            """INSERT INTO ai_audit (id, user_id, tool_name, args_json, human_summary, impact_inr,
                   status, snapshot_json, undoable, created_at, undone_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)""",
            (audit_id, user_id, tool_name, json.dumps(args), summary, impact, status,
             snapshot, int(undoable), _now()),
        )
    return audit_id


# ---------- gate amount, snapshot ----------

def impact_amount(conn: sqlite3.Connection, user_id: str, tool_name: str, c: Dict[str, Any]) -> Optional[float]:
    """Rupee amount the permission gate compares with maxAutoApproveAmountINR. None for non-financial tools."""
    if tool_name == "defer_bill":
        return float(_owned(conn, "bills", c["billId"], user_id)["amount"])
    if tool_name in ("create_invoice", "record_payment", "add_or_update_bill", "update_opening_cash"):
        return c["amount"]
    return None


def _snapshot(conn: sqlite3.Connection, user_id: str, tool_name: str, c: Dict[str, Any]) -> Dict[str, Any]:
    """Pre-write state needed for undo. Also checks that referenced rows belong to the user."""
    if tool_name == "create_invoice":
        _owned(conn, "customers", c["customerId"], user_id)
        return {"createdId": None}
    if tool_name == "record_payment":
        rec = _invoice_record(conn, user_id, c["invoiceId"])
        return {
            "invoiceId": rec["id"],
            "amountPaid": rec["amount_paid"],
            "customerId": rec["customer_id"],
            "customer": {
                "past_invoice_count": rec["past_invoice_count"],
                "past_late_count": rec["past_late_count"],
                "moving_avg_delay_days": rec["moving_avg_delay_days"],
            },
            "paymentId": None,
        }
    if tool_name == "add_customer":
        return {"createdId": None}
    if tool_name == "add_or_update_bill":
        if c["billId"] is None:
            return {"bill": None, "createdId": None}
        return {"bill": dict(_owned(conn, "bills", c["billId"], user_id)), "createdId": None}
    if tool_name == "defer_bill":
        return {"bill": dict(_owned(conn, "bills", c["billId"], user_id))}
    if tool_name == "update_opening_cash":
        row = conn.execute("SELECT bank_balance FROM users WHERE id = ?", (user_id,)).fetchone()
        return {"bankBalance": float(row["bank_balance"])}
    return {}


def snapshot(conn: sqlite3.Connection, user_id: str, tool_name: str, args: Any) -> str:
    """JSON of the rows the tool will change, taken before the write. "{}" for non-undoable tools."""
    return json.dumps(_snapshot(conn, user_id, tool_name, check_args(tool_name, args)))


# ---------- writers (same SQL as the Stage 1 routes) ----------

def _write_create_invoice(conn, user_id, c, snap):
    today = date.today()
    user = conn.execute("SELECT upi_id, clinic_name FROM users WHERE id = ?", (user_id,)).fetchone()
    count = conn.execute("SELECT COUNT(*) FROM invoices WHERE user_id = ?", (user_id,)).fetchone()[0]
    number = f"INV-{today.year}-{count + 101:03d}"
    pn = urllib.parse.quote(user["clinic_name"] or "Clinic")
    upi_link = (f"upi://pay?pa={user['upi_id']}&pn={pn}"
                f"&am={c['amount']:.2f}&cu=INR&tn={number}")
    invoice_id = new_id("inv")
    snap["createdId"] = invoice_id
    with conn:
        conn.execute(
            """INSERT INTO invoices (id, user_id, invoice_number, customer_id, service_description,
                   amount, amount_paid, issue_date, due_date, upi_link, last_reminded_at, created_by)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, 'AI')""",
            (invoice_id, user_id, number, c["customerId"], c["serviceDescription"], c["amount"],
             today.isoformat(), c["dueDate"], upi_link),
        )
    return f"Created invoice {number} for ₹{_money(c['amount'])}.", c["amount"]


def _write_record_payment(conn, user_id, c, snap):
    rec = _invoice_record(conn, user_id, c["invoiceId"])
    today = date.today()
    result = engine.apply_payment(
        amount=rec["amount"], amount_paid=rec["amount_paid"], amount_total=rec["amount"],
        due=rec["due_date"], paid_on=today,
        past_invoice_count=rec["past_invoice_count"], past_late_count=rec["past_late_count"],
        moving_avg_delay_days=rec["moving_avg_delay_days"], pay=c["amount"],
    )
    payment_id = new_id("pay")
    snap["paymentId"] = payment_id
    with conn:
        conn.execute("UPDATE invoices SET amount_paid = ? WHERE id = ? AND user_id = ?",
                     (result["amount_paid"], rec["id"], user_id))
        conn.execute(
            """UPDATE customers SET past_invoice_count = ?, past_late_count = ?,
                   moving_avg_delay_days = ? WHERE id = ? AND user_id = ?""",
            (result["past_invoice_count"], result["past_late_count"], result["moving_avg_delay_days"],
             rec["customer_id"], user_id),
        )
        conn.execute(
            """INSERT INTO payments (id, invoice_id, user_id, amount, paid_on, method)
               VALUES (?, ?, ?, ?, ?, NULL)""",
            (payment_id, rec["id"], user_id, result["applied"], today.isoformat()),
        )
    return f"Recorded ₹{_money(result['applied'])} against invoice {rec['invoice_number']}.", result["applied"]


def _write_add_customer(conn, user_id, c, snap):
    customer_id = new_id("cust")
    snap["createdId"] = customer_id
    with conn:
        conn.execute(
            """INSERT INTO customers (id, user_id, name, phone, email, relationship_tier,
                   past_invoice_count, past_late_count, moving_avg_delay_days, notes, created_at)
               VALUES (?, ?, ?, ?, NULL, ?, 0, 0, 0, NULL, ?)""",
            (customer_id, user_id, c["name"], c["phone"], c["relationshipTier"], _now()),
        )
    return f"Added customer {c['name']}.", None


def _write_bill(conn, user_id, c, snap):
    fields = (c["title"], c["category"], c["amount"], c["dueDate"],
              int(c["isRecurringMonthly"]), int(c["isDeferrable"]))
    if c["billId"] is None:
        bill_id = new_id("bill")
        snap["createdId"] = bill_id
        with conn:
            conn.execute(
                """INSERT INTO bills (id, user_id, title, category, amount, due_date,
                       is_recurring_monthly, is_deferrable, deferred_days, is_paid)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)""",
                (bill_id, user_id, *fields),
            )
        verb = "Added"
    else:
        with conn:
            conn.execute(
                """UPDATE bills SET title = ?, category = ?, amount = ?, due_date = ?,
                       is_recurring_monthly = ?, is_deferrable = ? WHERE id = ? AND user_id = ?""",
                (*fields, c["billId"], user_id),
            )
        verb = "Updated"
    return f"{verb} bill {c['title']} for ₹{_money(c['amount'])}.", c["amount"]


def _write_defer_bill(conn, user_id, c, snap):
    row = _owned(conn, "bills", c["billId"], user_id)
    if not row["is_deferrable"]:
        raise ValueError("This bill cannot be deferred.")
    with conn:
        conn.execute("UPDATE bills SET deferred_days = deferred_days + ? WHERE id = ? AND user_id = ?",
                     (c["days"], c["billId"], user_id))
    return f"Deferred {row['title']} by {c['days']} days.", float(row["amount"])


def _write_reminder(conn, user_id, c, snap):
    rec = _invoice_record(conn, user_id, c["invoiceId"])
    balance = engine.balance_due(rec["amount"], rec["amount_paid"])
    body = (f"Reminder: invoice {rec['invoice_number']} for ₹{_money(balance)} was due "
            f"{rec['due_date'].isoformat()}. Pay by UPI: {rec['upi_link']}")
    now = _now()
    with conn:
        conn.execute("UPDATE invoices SET last_reminded_at = ? WHERE id = ? AND user_id = ?",
                     (now, rec["id"], user_id))
        conn.execute(
            """INSERT INTO messages (id, user_id, invoice_id, customer_id, customer_name, channel,
                   tone, included_partial_option, body, status, sent_at, triggered_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'QUEUED', ?, 'AI')""",
            (new_id("msg"), user_id, rec["id"], rec["customer_id"], rec["customer_name"],
             c["channel"], c["tone"], body, now),
        )
    return f"Queued a {c['tone'].lower()} {c['channel'].lower()} reminder for {rec['customer_name']}.", None


def _write_what_if(conn, user_id, c, snap):
    bank = float(conn.execute("SELECT bank_balance FROM users WHERE id = ?", (user_id,)).fetchone()["bank_balance"])
    projection = engine.project(date.today(), c["horizon"], bank, _invoice_records(conn, user_id),
                                _bill_records(conn, user_id), _load_scenario(conn, user_id))
    received_after = projection["received_after_horizon"]
    crunch = engine.detect_crunch(projection["simulated"], received_after["simulated"])
    inflows = crunch["cash_received_in_horizon"]
    outflows = round(sum(d["outflow"] for d in projection["simulated"]), 2)
    ending = crunch["ending_balance"]
    if crunch["first_crunch_date"] is None:
        return (
            f"Projected inflows of ₹{_money(inflows)} (expenses: ₹{_money(outflows)}, ending cash: ₹{_money(ending)}, safe for {c['horizon']} days).",
            inflows,
        )
    return (
        f"Projected inflows of ₹{_money(inflows)}, but shortfall of ₹{_money(crunch['shortfall'])} on {crunch['first_crunch_date']}.",
        inflows,
    )


def _write_opening_cash(conn, user_id, c, snap):
    with conn:
        conn.execute("UPDATE users SET bank_balance = ? WHERE id = ?", (c["amount"], user_id))
    return f"Set opening cash to ₹{_money(c['amount'])}.", c["amount"]


_WRITERS = {
    "create_invoice": _write_create_invoice,
    "record_payment": _write_record_payment,
    "add_customer": _write_add_customer,
    "add_or_update_bill": _write_bill,
    "defer_bill": _write_defer_bill,
    "send_payment_reminder": _write_reminder,
    "run_what_if_simulation": _write_what_if,
    "update_opening_cash": _write_opening_cash,
}


def _row_fields(conn: sqlite3.Connection, table: str, row_id: str, user_id: str,
                names: Optional[List[str]]) -> Optional[Dict[str, Any]]:
    """Current values of the named columns (all columns but id/user_id when names is None).
    Returns None when the row is missing. Column names that the table lacks are skipped.
    `table` is always a fixed name in this module; users is keyed by id only."""
    if table == "users":
        row = conn.execute("SELECT * FROM users WHERE id = ?", (row_id,)).fetchone()
    else:
        row = conn.execute(f"SELECT * FROM {table} WHERE id = ? AND user_id = ?", (row_id, user_id)).fetchone()
    if row is None:
        return None
    keys = row.keys()
    if names is None:
        names = [k for k in keys if k not in ("id", "user_id")]
    return {n: row[n] for n in names if n in keys}


def _after_state(conn: sqlite3.Connection, user_id: str, tool_name: str,
                 c: Dict[str, Any], snap: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Post-write state of the rows the tool changed. undo() refuses if the current rows differ."""
    if tool_name == "create_invoice":
        targets = [("invoices", snap["createdId"], [])]
    elif tool_name == "record_payment":
        targets = [("invoices", snap["invoiceId"], ["amount_paid", "status"])]
    elif tool_name == "add_customer":
        targets = [("customers", snap["createdId"], [])]
    elif tool_name == "add_or_update_bill":
        if c["billId"] is None:
            targets = [("bills", snap["createdId"], [])]
        else:
            targets = [("bills", c["billId"], None)]
    elif tool_name == "defer_bill":
        targets = [("bills", c["billId"], None)]
    elif tool_name == "update_opening_cash":
        targets = [("users", user_id, ["bank_balance"])]
    else:
        return []
    entries = []
    for table, row_id, names in targets:
        fields = _row_fields(conn, table, row_id, user_id, names)
        entries.append({"table": table, "id": row_id, "fields": fields or {}})
    return entries


def execute(conn: sqlite3.Connection, user_id: str, tool_name: str, args: Any) -> Dict[str, Any]:
    """Runs the tool. Returns {summary, impactInr, snapshot (JSON str), undoable}. Raises ValueError or NotFound."""
    c = check_args(tool_name, args)
    snap = _snapshot(conn, user_id, tool_name, c)
    summary, impact = _WRITERS[tool_name](conn, user_id, c, snap)
    if tool_name in UNDOABLE:
        snap["after"] = _after_state(conn, user_id, tool_name, c, snap)
    return {
        "summary": summary,
        "impactInr": impact,
        "snapshot": json.dumps(snap),
        "undoable": tool_name in UNDOABLE,
    }


# ---------- undo ----------

def _restore_row(conn: sqlite3.Connection, table: str, row: Dict[str, Any], user_id: str) -> None:
    cols = {k: v for k, v in row.items() if k not in ("id", "user_id")}
    assignments = ", ".join(f"{k} = ?" for k in cols)
    conn.execute(f"UPDATE {table} SET {assignments} WHERE id = ? AND user_id = ?",
                 (*cols.values(), row["id"], user_id))


def _check_unchanged(conn: sqlite3.Connection, user_id: str, snap: Dict[str, Any]) -> None:
    """Raises ValueError if a row the action changed no longer matches its stored post-action state.
    Snapshots written before the "after" key existed skip this check."""
    for entry in snap.get("after") or []:
        table, row_id, expected = entry["table"], entry["id"], entry["fields"]
        current = _row_fields(conn, table, row_id, user_id, list(expected))
        if current is None:
            raise ValueError(f"This action can't be undone because the record changed after it: {table}")
        for name, value in expected.items():
            if current.get(name) != value:
                raise ValueError(
                    f"This action can't be undone because the record changed after it: {table}/{name}")


def undo(conn: sqlite3.Connection, user_id: str, audit_row: sqlite3.Row) -> None:
    """Restores the rows recorded in the audit row's snapshot. Raises ValueError when undo is unsafe."""
    tool = audit_row["tool_name"]
    if tool not in UNDOABLE:
        raise ValueError("This action cannot be undone.")
    snap = json.loads(audit_row["snapshot_json"] or "{}")
    _check_unchanged(conn, user_id, snap)
    if tool == "add_customer":
        count = conn.execute("SELECT COUNT(*) FROM invoices WHERE customer_id = ? AND user_id = ?",
                             (snap["createdId"], user_id)).fetchone()[0]
        if count:
            raise ValueError("This customer already has invoices. Undo those first.")
    with conn:
        if tool == "create_invoice":
            conn.execute("DELETE FROM invoices WHERE id = ? AND user_id = ?", (snap["createdId"], user_id))
        elif tool == "add_customer":
            conn.execute("DELETE FROM customers WHERE id = ? AND user_id = ?", (snap["createdId"], user_id))
        elif tool == "record_payment":
            conn.execute("DELETE FROM payments WHERE id = ? AND user_id = ?", (snap["paymentId"], user_id))
            conn.execute("UPDATE invoices SET amount_paid = ? WHERE id = ? AND user_id = ?",
                         (snap["amountPaid"], snap["invoiceId"], user_id))
            cust = snap["customer"]
            conn.execute(
                """UPDATE customers SET past_invoice_count = ?, past_late_count = ?,
                       moving_avg_delay_days = ? WHERE id = ? AND user_id = ?""",
                (cust["past_invoice_count"], cust["past_late_count"], cust["moving_avg_delay_days"],
                 snap["customerId"], user_id),
            )
        elif tool == "add_or_update_bill":
            if snap["bill"] is None:
                conn.execute("DELETE FROM bills WHERE id = ? AND user_id = ?", (snap["createdId"], user_id))
            else:
                _restore_row(conn, "bills", snap["bill"], user_id)
        elif tool == "defer_bill":
            _restore_row(conn, "bills", snap["bill"], user_id)
        else:
            conn.execute("UPDATE users SET bank_balance = ? WHERE id = ?", (snap["bankBalance"], user_id))
