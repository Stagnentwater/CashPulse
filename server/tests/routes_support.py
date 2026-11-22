"""Shared setup for the CashPulse route tests. Standard library unittest plus fastapi.testclient only.

Each test method gets its own temporary SQLite file, so rows never leak between tests.
The app lifespan (schema init and demo seed) runs inside `with TestClient(app)`.
Offline by default: load_env_credentials is patched to return no OpenRouter key.

Run from server/:  python -m unittest discover -s tests -v
"""

import os
import sys
import tempfile
import unittest
import uuid
from unittest import mock

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import agent_chat  # noqa: E402
import db  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

DEMO_EMAIL = "ananya@physiocare.demo"
DEMO_PASSWORD = "demo1234"
NEW_PASSWORD = "secret123"
SESSION_COOKIE = "cp_session"
AI_SETTINGS_URL = "/settings/ai-permissions"


def unique_email(prefix="clinic"):
    """A fresh email address so signups never collide inside one test database."""
    return f"{prefix}-{uuid.uuid4().hex[:10]}@example.com"


class RouteTestCase(unittest.TestCase):
    """Starts the app on a fresh temp database with no OpenRouter key."""

    def setUp(self):
        fd, self.db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self._original_db_path = db.DB_PATH
        db.DB_PATH = self.db_path
        self.addCleanup(self._restore_db_path)
        self.addCleanup(self._remove_db_file)

        env_patch = mock.patch.object(
            agent_chat, "load_env_credentials", return_value=("", agent_chat.DEFAULT_MODEL)
        )
        env_patch.start()
        self.addCleanup(env_patch.stop)

        self.client = TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def _restore_db_path(self):
        db.DB_PATH = self._original_db_path

    def _remove_db_file(self):
        try:
            os.remove(self.db_path)
        except OSError:
            pass

    # ---------- client and session helpers ----------

    def unstarted_client(self):
        """A client that does not run startup; used for a second signed-in user."""
        return TestClient(app)

    def login_demo(self, client=None):
        client = client or self.client
        resp = client.post("/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()["user"]

    def signup(self, client=None, email=None, clinic="Test Clinic"):
        client = client or self.client
        email = email or unique_email()
        resp = client.post("/api/auth/signup", json={
            "name": "Test Doctor", "clinicName": clinic, "email": email, "password": NEW_PASSWORD,
        })
        self.assertEqual(resp.status_code, 201, resp.text)
        return resp.json()["user"]

    def new_user_client(self):
        client = self.unstarted_client()
        self.signup(client)
        return client

    # ---------- record helpers ----------

    def create_customer(self, client=None, name="Asha Rao", phone="9876543210", tier="REGULAR"):
        client = client or self.client
        resp = client.post("/api/customers", json={"name": name, "phone": phone, "relationshipTier": tier})
        self.assertEqual(resp.status_code, 201, resp.text)
        return resp.json()

    def create_invoice(self, customer_id, amount=5000, due="2030-01-15", client=None):
        client = client or self.client
        resp = client.post("/api/invoices", json={"customerId": customer_id, "amount": amount, "dueDate": due})
        self.assertEqual(resp.status_code, 201, resp.text)
        return resp.json()

    def create_bill(self, client=None, **overrides):
        client = client or self.client
        body = {"title": "Rent", "category": "RENT", "amount": 30000, "dueDate": "2030-02-01"}
        body.update(overrides)
        resp = client.post("/api/bills", json=body)
        self.assertEqual(resp.status_code, 201, resp.text)
        return resp.json()

    def bank_balance(self, client=None):
        client = client or self.client
        return client.get("/api/auth/me").json()["user"]["bankBalance"]
