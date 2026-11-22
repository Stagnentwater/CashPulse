"""Unit tests for server/engine.py. Standard library unittest only.

Run from server/:  python -m unittest discover -s tests -v
"""

import os
import sys
import unittest
from datetime import date, timedelta

# Make `import engine` work when run from server/ with discover -s tests.
SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import engine  # noqa: E402

TODAY = date(2026, 6, 10)


def _scenario(risk=False, shift=0, overrides=None, shock=None):
    return {
        "include_moving_avg_risk": risk,
        "global_late_days_shift": shift,
        "invoice_delay_overrides": overrides or {},
        "extra_expense_shock": shock,
    }


def _invoice(**kw):
    base = {
        "id": "inv1",
        "amount": 10000.0,
        "amount_paid": 0.0,
        "due_date": TODAY + timedelta(days=5),
        "moving_avg_delay_days": 10.0,
        "past_invoice_count": 3,
        "status": "SENT",
    }
    base.update(kw)
    return base


class TestBalanceDue(unittest.TestCase):
    def test_clamps_overpayment_to_zero(self):
        self.assertEqual(engine.balance_due(100, 150), 0.0)

    def test_rounds_to_two_decimals(self):
        self.assertEqual(engine.balance_due(10.10, 0.333), 9.77)

    def test_normal_balance(self):
        self.assertEqual(engine.balance_due(1000, 250), 750.0)


class TestDaysOverdue(unittest.TestCase):
    def test_counts_days_when_balance_and_past_due(self):
        self.assertEqual(engine.days_overdue(date(2026, 6, 1), TODAY, 500.0), 9)

    def test_zero_when_no_balance(self):
        self.assertEqual(engine.days_overdue(date(2026, 6, 1), TODAY, 0.0), 0)

    def test_zero_when_due_today_or_later(self):
        self.assertEqual(engine.days_overdue(TODAY, TODAY, 500.0), 0)
        self.assertEqual(engine.days_overdue(date(2026, 6, 20), TODAY, 500.0), 0)


class TestInvoiceStatus(unittest.TestCase):
    def test_paid(self):
        self.assertEqual(engine.invoice_status(100, 100, date(2026, 5, 1), TODAY), "PAID")

    def test_partial_wins_over_overdue(self):
        self.assertEqual(engine.invoice_status(100, 40, date(2026, 5, 1), TODAY), "PARTIAL")

    def test_overdue(self):
        self.assertEqual(engine.invoice_status(100, 0, date(2026, 5, 1), TODAY), "OVERDUE")

    def test_sent(self):
        self.assertEqual(engine.invoice_status(100, 0, date(2026, 6, 20), TODAY), "SENT")


class TestClientRisk(unittest.TestCase):
    def test_limited_history(self):
        r = engine.client_risk(1, 30.0)
        self.assertEqual(r, {"label": "Limited history", "risk": None})

    def test_thresholds(self):
        self.assertEqual(engine.client_risk(2, 5.0)["risk"], "Low")
        self.assertEqual(engine.client_risk(2, 5.1)["risk"], "Medium")
        self.assertEqual(engine.client_risk(2, 15.0)["risk"], "Medium")
        self.assertEqual(engine.client_risk(2, 15.1)["risk"], "High")

    def test_label_equals_risk(self):
        r = engine.client_risk(5, 3.0)
        self.assertEqual(r["label"], r["risk"])


class TestApplyPayment(unittest.TestCase):
    def test_partial_payment_leaves_counts_unchanged(self):
        r = engine.apply_payment(
            amount=1000.0, amount_paid=0.0, amount_total=1000.0,
            due=date(2026, 6, 10), paid_on=date(2026, 6, 9),
            past_invoice_count=0, past_late_count=0, moving_avg_delay_days=0.0,
            pay=400.0,
        )
        self.assertEqual(r["applied"], 400.0)
        self.assertEqual(r["amount_paid"], 400.0)
        self.assertEqual(r["status"], "PARTIAL")
        self.assertEqual(r["past_invoice_count"], 0)
        self.assertEqual(r["past_late_count"], 0)
        self.assertEqual(r["moving_avg_delay_days"], 0.0)

    def test_full_late_payment_updates_counts_and_average(self):
        due = date(2026, 6, 10)
        r = engine.apply_payment(
            amount=1000.0, amount_paid=400.0, amount_total=1000.0,
            due=due, paid_on=due + timedelta(days=4),
            past_invoice_count=0, past_late_count=0, moving_avg_delay_days=0.0,
            pay=600.0,
        )
        self.assertEqual(r["applied"], 600.0)
        self.assertEqual(r["amount_paid"], 1000.0)
        self.assertEqual(r["status"], "PAID")
        self.assertEqual(r["past_invoice_count"], 1)
        self.assertEqual(r["past_late_count"], 1)
        self.assertEqual(r["moving_avg_delay_days"], 4.0)

    def test_payment_is_clamped_to_balance(self):
        r = engine.apply_payment(
            amount=1000.0, amount_paid=400.0, amount_total=1000.0,
            due=date(2026, 6, 10), paid_on=date(2026, 6, 10),
            past_invoice_count=0, past_late_count=0, moving_avg_delay_days=0.0,
            pay=5000.0,
        )
        self.assertEqual(r["applied"], 600.0)
        self.assertEqual(r["status"], "PAID")

    def test_on_time_payment_is_not_late(self):
        due = date(2026, 6, 10)
        r = engine.apply_payment(
            amount=500.0, amount_paid=0.0, amount_total=500.0,
            due=due, paid_on=due,
            past_invoice_count=2, past_late_count=1, moving_avg_delay_days=4.0,
            pay=500.0,
        )
        self.assertEqual(r["past_invoice_count"], 3)
        self.assertEqual(r["past_late_count"], 1)
        self.assertEqual(r["moving_avg_delay_days"], round((4.0 * 2 + 0) / 3, 1))

    def test_rejects_zero_pay(self):
        with self.assertRaises(ValueError):
            engine.apply_payment(
                amount=1000.0, amount_paid=0.0, amount_total=1000.0,
                due=date(2026, 6, 10), paid_on=date(2026, 6, 10),
                past_invoice_count=0, past_late_count=0, moving_avg_delay_days=0.0,
                pay=0.0,
            )

    def test_rejects_already_paid(self):
        with self.assertRaises(ValueError):
            engine.apply_payment(
                amount=1000.0, amount_paid=1000.0, amount_total=1000.0,
                due=date(2026, 6, 10), paid_on=date(2026, 6, 10),
                past_invoice_count=0, past_late_count=0, moving_avg_delay_days=0.0,
                pay=10.0,
            )


class TestBillingOccurrences(unittest.TestCase):
    def test_monthly_recurrence_clamps_to_month_end(self):
        occ = engine.billing_occurrences(
            date(2026, 1, 31), True, 0, False, date(2026, 1, 1), date(2026, 4, 30)
        )
        self.assertEqual(occ, [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)])

    def test_deferred_shift_applies_to_every_occurrence(self):
        occ = engine.billing_occurrences(
            date(2026, 1, 5), True, 7, False, date(2026, 2, 1), date(2026, 3, 31)
        )
        self.assertEqual(occ, [date(2026, 2, 12), date(2026, 3, 12)])

    def test_paid_bill_has_no_occurrences(self):
        occ = engine.billing_occurrences(
            date(2026, 1, 5), True, 0, True, date(2026, 1, 1), date(2026, 12, 31)
        )
        self.assertEqual(occ, [])

    def test_non_recurring_single_date_with_deferral(self):
        occ = engine.billing_occurrences(
            date(2026, 3, 3), False, 10, False, date(2026, 3, 1), date(2026, 3, 31)
        )
        self.assertEqual(occ, [date(2026, 3, 13)])


class TestProjection(unittest.TestCase):
    def test_risk_on_shifts_receipt_by_average_delay(self):
        inv = _invoice()  # due in 5 days, avg 10, count 3
        p = engine.project(TODAY, 30, 0.0, [inv], [], _scenario(risk=True))
        self.assertEqual(p["baseline"][15]["inflow"], 10000.0)
        self.assertEqual(p["baseline"][5]["inflow"], 0.0)
        self.assertEqual(p["simulated"][15]["inflow"], 10000.0)

    def test_risk_off_lands_on_due_date(self):
        inv = _invoice()
        p = engine.project(TODAY, 30, 0.0, [inv], [], _scenario(risk=False))
        self.assertEqual(p["baseline"][5]["inflow"], 10000.0)
        self.assertEqual(p["baseline"][15]["inflow"], 0.0)

    def test_client_with_one_invoice_is_not_shifted(self):
        inv = _invoice(past_invoice_count=1)
        p = engine.project(TODAY, 30, 0.0, [inv], [], _scenario(risk=True))
        self.assertEqual(p["baseline"][5]["inflow"], 10000.0)
        self.assertEqual(p["baseline"][15]["inflow"], 0.0)

    def test_simulated_adds_global_shift_on_top(self):
        inv = _invoice()
        p = engine.project(TODAY, 30, 0.0, [inv], [], _scenario(risk=True, shift=2))
        self.assertEqual(p["baseline"][15]["inflow"], 10000.0)
        self.assertEqual(p["simulated"][17]["inflow"], 10000.0)

    def test_past_expected_receipt_moves_to_today_plus_seven(self):
        inv = _invoice(due_date=TODAY - timedelta(days=3))
        p = engine.project(TODAY, 30, 0.0, [inv], [], _scenario(risk=False))
        self.assertEqual(p["baseline"][7]["inflow"], 10000.0)

    def test_balance_rolls_forward_from_bank(self):
        inv = _invoice()
        p = engine.project(TODAY, 30, 1000.0, [inv], [], _scenario(risk=False))
        self.assertEqual(p["baseline"][4]["balance"], 1000.0)
        self.assertEqual(p["baseline"][5]["balance"], 11000.0)

    def test_bill_and_shock_outflows(self):
        bill = {
            "id": "rent", "title": "Rent", "amount": 5000.0,
            "due_date": TODAY + timedelta(days=3), "is_recurring_monthly": False,
            "is_deferrable": True, "deferred_days": 0, "is_paid": False,
        }
        shock = {"title": "Generator", "amount": 800.0, "day_offset": 2}
        p = engine.project(TODAY, 30, 10000.0, [], [bill], _scenario(shock=shock))
        self.assertEqual(p["baseline"][3]["outflow"], 5000.0)
        self.assertEqual(p["baseline"][2]["outflow"], 0.0)
        self.assertEqual(p["simulated"][2]["outflow"], 800.0)
        self.assertEqual(p["simulated"][3]["outflow"], 5000.0)


class TestDetectCrunch(unittest.TestCase):
    @staticmethod
    def _days(balances):
        return [
            {"date": (TODAY + timedelta(days=i)).isoformat(), "balance": b, "inflow": 0.0}
            for i, b in enumerate(balances)
        ]

    def test_crunch_in_middle(self):
        days = self._days([100, 50, -20, -30, 10])
        c = engine.detect_crunch(days)
        self.assertEqual(c["first_crunch_date"], days[2]["date"])
        self.assertEqual(c["lowest_balance"], -30)
        self.assertEqual(c["lowest_balance_date"], days[3]["date"])
        self.assertEqual(c["shortfall"], 30.0)
        self.assertEqual(c["cash_safe_until"], days[1]["date"])

    def test_crunch_on_first_day_has_no_safe_date(self):
        days = self._days([-5, 10])
        c = engine.detect_crunch(days)
        self.assertEqual(c["first_crunch_date"], days[0]["date"])
        self.assertIsNone(c["cash_safe_until"])

    def test_no_crunch_safe_until_last_day(self):
        days = self._days([10, 20])
        c = engine.detect_crunch(days)
        self.assertIsNone(c["first_crunch_date"])
        self.assertEqual(c["shortfall"], 0.0)
        self.assertEqual(c["cash_safe_until"], days[-1]["date"])

    def test_empty(self):
        c = engine.detect_crunch([])
        self.assertIsNone(c["first_crunch_date"])
        self.assertIsNone(c["cash_safe_until"])
        self.assertEqual(c["days_below_zero"], 0)

    def test_days_below_zero_counts_negative_balances(self):
        days = self._days([100, -50, -20])
        c = engine.detect_crunch(days)
        self.assertEqual(c["days_below_zero"], 2)


class TestHorizonAndCrunchSummary(unittest.TestCase):
    def test_receipt_delayed_past_horizon_is_not_dropped(self):
        inv = _invoice()  # due in 5 days; horizon 30 ends on day 29
        p = engine.project(TODAY, 30, 0.0, [inv], [], _scenario(risk=False, overrides={"inv1": 60}))
        self.assertEqual(p["received_after_horizon"]["simulated"], 10000.0)
        self.assertEqual(p["received_after_horizon"]["baseline"], 0.0)
        self.assertEqual(sum(d["inflow"] for d in p["simulated"]), 0.0)
        c = engine.detect_crunch(p["simulated"], p["received_after_horizon"]["simulated"])
        self.assertEqual(c["received_after_horizon"], 10000.0)
        self.assertEqual(c["cash_received_in_horizon"], 0.0)
        self.assertEqual(c["ending_balance"], 0.0)

    def test_delay_past_horizon_in_deficit_account_changes_cash_received(self):
        # Deficit account: a 50,000 bill is due before the 10,000 receipt. A 40-day delay pushes
        # the receipt past the 30-day horizon, so cash received within the horizon drops.
        bill = {
            "id": "rent", "title": "Rent", "amount": 50000.0,
            "due_date": TODAY + timedelta(days=1), "is_recurring_monthly": False,
            "is_deferrable": True, "deferred_days": 0, "is_paid": False,
        }
        inv = _invoice()
        p = engine.project(TODAY, 30, 0.0, [inv], [bill], _scenario(risk=False, overrides={"inv1": 40}))
        base = engine.detect_crunch(p["baseline"], p["received_after_horizon"]["baseline"])
        sim = engine.detect_crunch(p["simulated"], p["received_after_horizon"]["simulated"])
        self.assertEqual(base["cash_received_in_horizon"], 10000.0)
        self.assertEqual(sim["cash_received_in_horizon"], 0.0)
        self.assertEqual(sim["received_after_horizon"], 10000.0)
        self.assertEqual(sim["days_below_zero"], base["days_below_zero"])

    def test_no_overrides_baseline_and_simulated_crunch_identical(self):
        inv = _invoice()
        bill = {
            "id": "rent", "title": "Rent", "amount": 5000.0,
            "due_date": TODAY + timedelta(days=3), "is_recurring_monthly": False,
            "is_deferrable": True, "deferred_days": 0, "is_paid": False,
        }
        p = engine.project(TODAY, 30, 1000.0, [inv], [bill], _scenario(risk=True))
        base = engine.detect_crunch(p["baseline"], p["received_after_horizon"]["baseline"])
        sim = engine.detect_crunch(p["simulated"], p["received_after_horizon"]["simulated"])
        self.assertEqual(base, sim)


class TestReceivablesAging(unittest.TestCase):
    def test_buckets(self):
        invoices = [
            {"id": "a", "amount": 100.0, "amount_paid": 0.0, "due_date": date(2026, 6, 12)},  # upcoming
            {"id": "b", "amount": 50.0, "amount_paid": 0.0, "due_date": date(2026, 6, 10)},   # 0 days -> upcoming
            {"id": "c", "amount": 200.0, "amount_paid": 0.0, "due_date": date(2026, 6, 7)},   # 3 days
            {"id": "d", "amount": 300.0, "amount_paid": 0.0, "due_date": date(2026, 5, 26)},  # 15 days
            {"id": "e", "amount": 400.0, "amount_paid": 0.0, "due_date": date(2026, 5, 25)},  # 16 days
            {"id": "f", "amount": 500.0, "amount_paid": 500.0, "due_date": date(2026, 5, 1)}, # paid, excluded
        ]
        buckets = engine.receivables_aging(TODAY, invoices)
        self.assertEqual([b["id"] for b in buckets], ["upcoming", "d1_7", "d8_15", "d15_plus"])
        self.assertEqual([b["label"] for b in buckets], ["Upcoming", "1-7d", "8-15d", "15+d"])
        self.assertEqual([b["total"] for b in buckets], [150.0, 200.0, 300.0, 400.0])
        self.assertEqual([b["count"] for b in buckets], [2, 1, 1, 1])


if __name__ == "__main__":
    unittest.main()
