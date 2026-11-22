import sqlite3
import unittest
from datetime import date

import ai_executor
import db
import main
from permissions import default_permissions


class TestBankAndBills(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(db.SCHEMA)

        self.user_id = "usr_test123"
        self.conn.execute(
            """INSERT INTO users (id, name, clinic_name, email, password_hash, bank_balance, upi_id, created_at)
               VALUES (?, 'Dr. Test', 'Test Clinic', 'test@example.com', 'hash', 50000.0, 'test@upi', '2026-01-01')""",
            (self.user_id,),
        )
        self.cust_id = "cust_test123"
        self.conn.execute(
            """INSERT INTO customers (id, user_id, name, phone, email, relationship_tier, created_at)
               VALUES (?, ?, 'Rajesh Patient', '9999988888', 'rajesh@example.com', 'GOOD', '2026-01-01')""",
            (self.cust_id, self.user_id),
        )
        self.inv_id = "inv_test123"
        self.conn.execute(
            """INSERT INTO invoices (id, user_id, invoice_number, customer_id, service_description, amount, amount_paid, due_date)
               VALUES (?, ?, 'INV-001', ?, 'Physiotherapy', 10000.0, 0.0, '2026-06-01')""",
            (self.inv_id, self.user_id, self.cust_id),
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def test_record_payment_increments_bank_balance(self):
        # Initial bank balance is 50,000
        snap = ai_executor._snapshot(self.conn, self.user_id, "record_payment", {"invoiceId": self.inv_id, "amount": 4000.0})
        self.assertEqual(snap["bankBalance"], 50000.0)

        # Apply payment of 4,000
        summary, impact = ai_executor._write_record_payment(
            self.conn, self.user_id, {"invoiceId": self.inv_id, "amount": 4000.0}, snap
        )
        self.assertEqual(impact, 4000.0)

        # Check bank balance is now 54,000
        bank = self.conn.execute("SELECT bank_balance FROM users WHERE id = ?", (self.user_id,)).fetchone()["bank_balance"]
        self.assertEqual(bank, 54000.0)

        # Check invoice amount_paid is 4,000
        inv_paid = self.conn.execute("SELECT amount_paid FROM invoices WHERE id = ?", (self.inv_id,)).fetchone()["amount_paid"]
        self.assertEqual(inv_paid, 4000.0)

        # Test undo restores bank balance to 50,000
        import json
        audit_mock = {
            "tool_name": "record_payment",
            "snapshot_json": json.dumps(snap),
        }
        ai_executor.undo(self.conn, self.user_id, audit_mock)
        restored_bank = self.conn.execute("SELECT bank_balance FROM users WHERE id = ?", (self.user_id,)).fetchone()["bank_balance"]
        self.assertEqual(restored_bank, 50000.0)

    def test_settle_non_recurring_bill_deducts_bank_and_deletes_bill(self):
        # Create non-recurring bill
        bill_id = "bill_once"
        self.conn.execute(
            """INSERT INTO bills (id, user_id, title, category, amount, due_date, is_recurring_monthly, is_deferrable, is_paid)
               VALUES (?, ?, 'Ultrasound Repair', 'SHOCK', 8000.0, '2026-06-10', 0, 1, 0)""",
            (bill_id, self.user_id),
        )
        self.conn.commit()

        user_dict = {"id": self.user_id}
        res = main.mark_bill_paid(bill_id=bill_id, deduct_from_bank=True, conn=self.conn, user=user_dict)

        self.assertTrue(res["deleted"])
        self.assertEqual(res["amountDeducted"], 8000.0)

        # Bank balance reduced: 50,000 - 8,000 = 42,000
        bank = self.conn.execute("SELECT bank_balance FROM users WHERE id = ?", (self.user_id,)).fetchone()["bank_balance"]
        self.assertEqual(bank, 42000.0)

        # Bill is deleted from DB
        row = self.conn.execute("SELECT * FROM bills WHERE id = ?", (bill_id,)).fetchone()
        self.assertIsNone(row)

    def test_settle_recurring_bill_deducts_bank_and_rolls_forward_one_month(self):
        # Create recurring monthly bill
        bill_id = "bill_monthly"
        self.conn.execute(
            """INSERT INTO bills (id, user_id, title, category, amount, due_date, is_recurring_monthly, is_deferrable, is_paid)
               VALUES (?, ?, 'Clinic Rent', 'RENT', 20000.0, '2026-06-15', 1, 1, 0)""",
            (bill_id, self.user_id),
        )
        self.conn.commit()

        user_dict = {"id": self.user_id}
        res = main.mark_bill_paid(bill_id=bill_id, deduct_from_bank=True, conn=self.conn, user=user_dict)

        self.assertFalse(res["deleted"])
        self.assertEqual(res["amountDeducted"], 20000.0)
        self.assertEqual(res["nextDue"], "2026-07-15")

        # Bank balance reduced: 50,000 - 20,000 = 30,000
        bank = self.conn.execute("SELECT bank_balance FROM users WHERE id = ?", (self.user_id,)).fetchone()["bank_balance"]
        self.assertEqual(bank, 30000.0)

        # Bill still exists, unpaid, due next month
        row = self.conn.execute("SELECT * FROM bills WHERE id = ?", (bill_id,)).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row["due_date"], "2026-07-15")
        self.assertEqual(row["is_paid"], 0)
        self.assertEqual(row["deferred_days"], 0)


if __name__ == "__main__":
    unittest.main()
