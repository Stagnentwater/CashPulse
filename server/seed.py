"""Demo account and preset data for CashPulse.

seed_demo_user() creates the demo doctor once. seed_preset() replaces one user's business data
with a named preset, with all dates relative to `today`.
"""

import sqlite3
from datetime import date, datetime, timedelta, timezone
from typing import Callable

import auth
from db import new_id

DEMO_EMAIL = "ananya@physiocare.demo"
DEMO_PASSWORD = "demo1234"
DEMO_NAME = "Dr. Ananya"
DEMO_CLINIC = "PhysioCare Studio"
DEMO_UPI = "physiocare@okaxis"

# Business tables cleared before a preset is written. The users row is kept.
_USER_DATA_TABLES = ("messages", "payments", "invoices", "customers", "bills", "scenarios")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _phone(n: int) -> str:
    return f"+91-98765-000{n:02d}"


def _set_bank(conn: sqlite3.Connection, user_id: str, amount: float) -> None:
    conn.execute("UPDATE users SET bank_balance = ? WHERE id = ?", (amount, user_id))


def _add_customer(
    conn: sqlite3.Connection,
    user_id: str,
    now: str,
    name: str,
    phone_no: int,
    tier: str,
    past_invoice_count: int,
    past_late_count: int,
    moving_avg_delay_days: float,
) -> str:
    customer_id = new_id("cust")
    conn.execute(
        """INSERT INTO customers (id, user_id, name, phone, email, relationship_tier,
               past_invoice_count, past_late_count, moving_avg_delay_days, notes, created_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?)""",
        (
            customer_id,
            user_id,
            name,
            _phone(phone_no),
            tier,
            past_invoice_count,
            past_late_count,
            moving_avg_delay_days,
            now,
        ),
    )
    return customer_id


def _add_invoice(
    conn: sqlite3.Connection,
    user_id: str,
    customer_id: str,
    invoice_number: str,
    amount: float,
    amount_paid: float,
    due: date,
    service: str,
) -> str:
    invoice_id = new_id("inv")
    issue = due - timedelta(days=30)
    conn.execute(
        """INSERT INTO invoices (id, user_id, invoice_number, customer_id, service_description,
               amount, amount_paid, issue_date, due_date, upi_link, last_reminded_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'seed')""",
        (
            invoice_id,
            user_id,
            invoice_number,
            customer_id,
            service,
            amount,
            amount_paid,
            issue.isoformat(),
            due.isoformat(),
        ),
    )
    return invoice_id


def _add_payment(
    conn: sqlite3.Connection,
    user_id: str,
    invoice_id: str,
    amount: float,
    paid_on: date,
    method: str = "UPI",
) -> None:
    conn.execute(
        """INSERT INTO payments (id, invoice_id, user_id, amount, paid_on, method)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (new_id("pay"), invoice_id, user_id, amount, paid_on.isoformat(), method),
    )


def _add_bill(
    conn: sqlite3.Connection,
    user_id: str,
    title: str,
    category: str,
    amount: float,
    due: date,
    recurring: bool,
    deferrable: bool,
) -> None:
    conn.execute(
        """INSERT INTO bills (id, user_id, title, category, amount, due_date,
               is_recurring_monthly, is_deferrable, deferred_days, is_paid)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)""",
        (
            new_id("bill"),
            user_id,
            title,
            category,
            amount,
            due.isoformat(),
            1 if recurring else 0,
            1 if deferrable else 0,
        ),
    )


def _preset_rent_crunch(conn: sqlite3.Connection, user_id: str, today: date, now: str) -> None:
    year = today.year
    _set_bank(conn, user_id, 40000)

    rajesh = _add_customer(conn, user_id, now, "Rajesh Verma", 1, "CHRONIC_LATE", 4, 3, 14)
    meera = _add_customer(conn, user_id, now, "Meera Krishnan", 2, "REGULAR", 3, 0, 2)
    kavita = _add_customer(conn, user_id, now, "Kavita Iyer", 3, "REGULAR", 5, 1, 4)
    arjun = _add_customer(conn, user_id, now, "Arjun Nair", 4, "NEW", 1, 0, 0)

    _add_invoice(conn, user_id, rajesh, f"INV-{year}-101", 18000, 0, today - timedelta(days=14),
                 "Physiotherapy course, 12 sessions")
    _add_invoice(conn, user_id, meera, f"INV-{year}-102", 9000, 0, today + timedelta(days=3),
                 "Post-surgery rehab package")
    _add_invoice(conn, user_id, kavita, f"INV-{year}-103", 6000, 0, today + timedelta(days=10),
                 "Sports injury assessment")
    arjun_invoice = _add_invoice(conn, user_id, arjun, f"INV-{year}-104", 4500, 4500,
                                 today - timedelta(days=5), "Back pain treatment")
    _add_payment(conn, user_id, arjun_invoice, 4500, today - timedelta(days=5))

    _add_bill(conn, user_id, "Clinic rent", "RENT", 35000, today + timedelta(days=6), True, False)
    _add_bill(conn, user_id, "Staff salaries", "SALARY", 25000, today + timedelta(days=12), True, False)
    _add_bill(conn, user_id, "Electricity", "UTILITY", 4200, today + timedelta(days=8), False, True)


def _preset_bad_day_5_late(conn: sqlite3.Connection, user_id: str, today: date, now: str) -> None:
    year = today.year
    _set_bank(conn, user_id, 18000)

    sunita = _add_customer(conn, user_id, now, "Sunita Rao", 5, "REGULAR", 3, 1, 6)
    vikram = _add_customer(conn, user_id, now, "Vikram Das", 6, "CHRONIC_LATE", 4, 3, 16)
    priya = _add_customer(conn, user_id, now, "Priya Menon", 7, "CHRONIC_LATE", 5, 4, 18)
    anil = _add_customer(conn, user_id, now, "Anil Gupta", 8, "NEW", 2, 1, 9)
    deepa = _add_customer(conn, user_id, now, "Deepa Joshi", 9, "REGULAR", 3, 2, 11)

    # Five unpaid invoices, each 10 to 20 days past due.
    overdue = [
        (sunita, 7000, 10),
        (vikram, 5500, 12),
        (priya, 8000, 14),
        (anil, 6500, 17),
        (deepa, 4800, 20),
    ]
    for index, (customer_id, amount, days_late) in enumerate(overdue, start=1):
        _add_invoice(conn, user_id, customer_id, f"INV-{year}-{100 + index}", amount, 0,
                     today - timedelta(days=days_late), "Physiotherapy sessions")

    # One paid invoice, paid on its due date.
    paid_due = today - timedelta(days=9)
    paid_invoice = _add_invoice(conn, user_id, sunita, f"INV-{year}-106", 3000, 3000,
                                paid_due, "Follow-up consultation")
    _add_payment(conn, user_id, paid_invoice, 3000, paid_due)


def _preset_healthy_clinic(conn: sqlite3.Connection, user_id: str, today: date, now: str) -> None:
    year = today.year
    _set_bank(conn, user_id, 180000)

    lakshmi = _add_customer(conn, user_id, now, "Lakshmi Pillai", 10, "VIP_LOYAL", 12, 0, 1)
    harish = _add_customer(conn, user_id, now, "Harish Kumar", 11, "REGULAR", 6, 1, 3)
    neha = _add_customer(conn, user_id, now, "Neha Sharma", 12, "REGULAR", 4, 0, 2)

    lakshmi_due = today - timedelta(days=10)
    lakshmi_invoice = _add_invoice(conn, user_id, lakshmi, f"INV-{year}-101", 20000, 20000,
                                   lakshmi_due, "Annual wellness package")
    _add_payment(conn, user_id, lakshmi_invoice, 20000, lakshmi_due)

    _add_invoice(conn, user_id, harish, f"INV-{year}-102", 15000, 0,
                 today + timedelta(days=15), "Knee rehab, 8 sessions")

    neha_due = today - timedelta(days=4)
    neha_invoice = _add_invoice(conn, user_id, neha, f"INV-{year}-103", 9000, 9000,
                                neha_due, "Posture therapy")
    _add_payment(conn, user_id, neha_invoice, 9000, neha_due)

    _add_bill(conn, user_id, "Clinic rent", "RENT", 35000, today + timedelta(days=5), True, False)


_PRESET_BUILDERS: dict[str, Callable[[sqlite3.Connection, str, date, str], None]] = {
    "RENT_CRUNCH": _preset_rent_crunch,
    "BAD_DAY_5_LATE": _preset_bad_day_5_late,
    "HEALTHY_CLINIC": _preset_healthy_clinic,
}


def seed_preset(conn: sqlite3.Connection, user_id: str, preset_id: str, today: date) -> None:
    """Replaces this user's customers, invoices, payments, bills, messages and scenarios with a preset.

    Raises ValueError for an unknown preset_id before touching the database.
    The scenarios table is left empty; the API should fall back to defaults when no row exists.
    """
    builder = _PRESET_BUILDERS.get(preset_id)
    if builder is None:
        raise ValueError(f"Unknown preset: {preset_id}")
    now = _now_iso()
    with conn:
        for table in _USER_DATA_TABLES:
            conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
        builder(conn, user_id, today, now)


def seed_demo_user(conn: sqlite3.Connection) -> str:
    """Creates the demo doctor with the RENT_CRUNCH preset if she does not exist. Returns her user id."""
    row = conn.execute("SELECT id FROM users WHERE email = ?", (DEMO_EMAIL,)).fetchone()
    if row is not None:
        return row["id"]

    user_id = new_id("user")
    with conn:
        conn.execute(
            """INSERT INTO users (id, name, clinic_name, email, password_hash, upi_id,
                   bank_balance, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 40000, ?)""",
            (
                user_id,
                DEMO_NAME,
                DEMO_CLINIC,
                DEMO_EMAIL,
                auth.hash_password(DEMO_PASSWORD),
                DEMO_UPI,
                _now_iso(),
            ),
        )
    seed_preset(conn, user_id, "RENT_CRUNCH", date.today())
    return user_id
