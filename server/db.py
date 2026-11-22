"""SQLite storage for CashPulse. Standard library only.

DB_PATH is server/data/cashpulse.db. Tables are created with IF NOT EXISTS by init_db().
"""

import os
import secrets
import sqlite3
from typing import Iterator

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "cashpulse.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    clinic_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    upi_id TEXT,
    bank_balance REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    relationship_tier TEXT NOT NULL DEFAULT 'NEW',
    past_invoice_count INTEGER NOT NULL DEFAULT 0,
    past_late_count INTEGER NOT NULL DEFAULT 0,
    moving_avg_delay_days REAL NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    service_description TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL,
    amount_paid REAL NOT NULL DEFAULT 0,
    issue_date TEXT,
    due_date TEXT NOT NULL,
    upi_link TEXT,
    last_reminded_at TEXT,
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    paid_on TEXT NOT NULL,
    method TEXT
);

CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    due_date TEXT NOT NULL,
    is_recurring_monthly INTEGER NOT NULL DEFAULT 0,
    is_deferrable INTEGER NOT NULL DEFAULT 0,
    deferred_days INTEGER NOT NULL DEFAULT 0,
    is_paid INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scenarios (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    horizon_days INTEGER NOT NULL DEFAULT 90,
    invoice_delay_overrides TEXT NOT NULL DEFAULT '{}',
    global_late_days_shift INTEGER NOT NULL DEFAULT 0,
    extra_expense_shock TEXT,
    include_moving_avg_risk INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    customer_name TEXT,
    channel TEXT NOT NULL,
    tone TEXT NOT NULL,
    included_partial_option INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    sent_at TEXT,
    triggered_by TEXT
);

CREATE TABLE IF NOT EXISTS ai_permissions (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    settings_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_audit (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args_json TEXT NOT NULL,
    human_summary TEXT NOT NULL,
    impact_inr REAL,
    status TEXT NOT NULL,
    snapshot_json TEXT,
    undoable INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    undone_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_bills_user ON bills(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
"""


def new_id(prefix: str) -> str:
    """Random id such as 'cust_3f9a0c1d2e4b5a6f'."""
    return f"{prefix}_{secrets.token_hex(8)}"


def get_conn() -> sqlite3.Connection:
    """Opens a connection to DB_PATH with Row access by column name and foreign keys enforced."""
    os.makedirs(DATA_DIR, exist_ok=True)
    # check_same_thread=False: FastAPI may run sync dependencies and endpoints on different threads.
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def get_db() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: yields one connection per request and closes it afterwards."""
    conn = get_conn()
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    """Creates all tables and indexes if they do not exist yet."""
    conn = get_conn()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()
