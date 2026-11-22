"""Unit tests for the Pulse AI Agent Orchestrator & Fallback Parser."""

import os
import shutil
import sqlite3
import sys
import tempfile
import unittest
from datetime import date

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import agent_chat
import ai_executor
import db
import seed
from permissions import default_permissions, preset


class TestAgentChat(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmp_dir, "test_agent.db")
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(db.SCHEMA)
        self.user_id = "test_user_ananya"
        with self.conn:
            self.conn.execute(
                """INSERT INTO users (id, name, clinic_name, email, password_hash, bank_balance, upi_id, created_at)
                   VALUES (?, 'Dr. Ananya', 'PhysioCare Studio', 'ananya@test.demo', 'hash', 100000.0, 'physio@okaxis', '2026-01-01T00:00:00Z')""",
                (self.user_id,),
            )
        seed.seed_preset(self.conn, self.user_id, "RENT_CRUNCH", date.today())
        # Set smart_copilot permissions
        ai_executor.save_permissions(self.conn, self.user_id, default_permissions())

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_build_workspace_context(self):
        ctx = agent_chat.build_workspace_context(self.conn, self.user_id)
        self.assertEqual(ctx["user"]["clinic_name"], "PhysioCare Studio")
        self.assertGreater(len(ctx["customers"]), 0)
        self.assertIn("summary_text", ctx)
        self.assertIn("Registered Patients", ctx["summary_text"])

    def test_local_fallback_demo_prompt_1_multitool(self):
        ctx = agent_chat.build_workspace_context(self.conn, self.user_id)
        msg = "Finished Kavita's 6 knee sessions today, bill her ₹9,000 due next Tuesday, and add clinic electricity bill ₹4,200 due in 8 days."
        tools, reply = agent_chat.local_fallback_parser(msg, ctx)
        self.assertEqual(len(tools), 2)
        tool_names = [t["name"] for t in tools]
        self.assertIn("create_invoice", tool_names)
        self.assertIn("add_or_update_bill", tool_names)
        inv = next(t for t in tools if t["name"] == "create_invoice")
        self.assertEqual(inv["arguments"]["amount"], 9000.0)
        bill = next(t for t in tools if t["name"] == "add_or_update_bill")
        self.assertEqual(bill["arguments"]["amount"], 4200.0)
        self.assertEqual(bill["arguments"]["category"], "UTILITY")

    def test_local_fallback_demo_prompt_2_payment(self):
        ctx = agent_chat.build_workspace_context(self.conn, self.user_id)
        msg = "Rajesh just paid ₹9,000 via UPI as partial payment—update his invoice and check if rent is safe now."
        tools, reply = agent_chat.local_fallback_parser(msg, ctx)
        tool_names = [t["name"] for t in tools]
        self.assertIn("record_payment", tool_names)
        self.assertIn("run_what_if_simulation", tool_names)
        pmt = next(t for t in tools if t["name"] == "record_payment")
        self.assertEqual(pmt["arguments"]["amount"], 9000.0)

    def test_local_fallback_demo_prompt_3_reminder(self):
        ctx = agent_chat.build_workspace_context(self.conn, self.user_id)
        msg = "Send a warm WhatsApp reminder to Meera Krishnan with a 50% partial payment option."
        tools, reply = agent_chat.local_fallback_parser(msg, ctx)
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["name"], "send_payment_reminder")
        self.assertEqual(tools[0]["arguments"]["channel"], "WHATSAPP")
        self.assertEqual(tools[0]["arguments"]["tone"], "WARM")

    def test_local_fallback_demo_prompt_4_simulation(self):
        ctx = agent_chat.build_workspace_context(self.conn, self.user_id)
        msg = "What happens to my cash if Rajesh pays 15 days late and my ultrasound machine needs a ₹12,000 repair?"
        tools, reply = agent_chat.local_fallback_parser(msg, ctx)
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["name"], "run_what_if_simulation")
        self.assertEqual(tools[0]["arguments"]["horizon"], 60)

    def test_handle_chat_permission_gated_proposal(self):
        # Under smart_copilot, record_payment is ASK_APPROVAL
        msg = "Rajesh just paid ₹9,000 via UPI as partial payment—update his invoice and check if rent is safe now."
        res = agent_chat.handle_chat(self.conn, self.user_id, msg, [])
        self.assertIn("providerMode", res)
        # record_payment needs approval under smart_copilot
        proposal_tools = [p["toolName"] for p in res["proposals"]]
        self.assertIn("record_payment", proposal_tools)

    def test_handle_chat_global_disabled(self):
        perms = default_permissions()
        perms["globalEnabled"] = False
        ai_executor.save_permissions(self.conn, self.user_id, perms)

        res = agent_chat.handle_chat(self.conn, self.user_id, "Bill Kavita 9000", [])
        self.assertIn("currently disabled", res["message"])
        self.assertEqual(len(res["deniedTools"]), 1)


if __name__ == "__main__":
    unittest.main()
