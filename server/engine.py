"""Pure money rules for CashPulse, ported from src/lib/financeEngine.ts.

Standard library only. No I/O, no database, no HTTP.
Dates are datetime.date. Money is float rounded to 2 decimals.
"""

import math
from datetime import date, timedelta

MAX_RECURRING_OCCURRENCES = 240


def _round_half_up(x: float) -> int:
    """Same as JavaScript Math.round for positive values (Python's round() is banker's rounding)."""
    return int(math.floor(x + 0.5))


def _add_months_clamped(d: date, k: int) -> date:
    """Adds k months to d, keeping the day of month and clamping to the target month's length."""
    total = d.year * 12 + (d.month - 1) + k
    year, month0 = divmod(total, 12)
    month = month0 + 1
    if month == 12:
        first_of_next = date(year + 1, 1, 1)
    else:
        first_of_next = date(year, month + 1, 1)
    last_day = (first_of_next - timedelta(days=1)).day
    return date(year, month, min(d.day, last_day))


def balance_due(amount: float, amount_paid: float) -> float:
    """Unpaid amount, never negative."""
    return float(max(0.0, round(amount - amount_paid, 2)))


def days_overdue(due: date, today: date, balance: float) -> int:
    """Days past due while a balance remains; 0 otherwise."""
    if balance > 0 and due < today:
        return (today - due).days
    return 0


def invoice_status(amount: float, amount_paid: float, due: date, today: date) -> str:
    """PAID, PARTIAL, OVERDUE or SENT, checked in that order."""
    if amount_paid >= amount:
        return "PAID"
    if amount_paid > 0:
        return "PARTIAL"
    if due < today:
        return "OVERDUE"
    return "SENT"


def client_risk(past_invoice_count: int, moving_avg_delay_days: float) -> dict:
    """Client payment habit. Needs at least 2 past invoices to be meaningful."""
    if past_invoice_count < 2:
        return {"label": "Limited history", "risk": None}
    avg = moving_avg_delay_days
    risk = "Low" if avg <= 5 else "Medium" if avg <= 15 else "High"
    return {"label": risk, "risk": risk}


def apply_payment(
    amount: float,
    amount_paid: float,
    amount_total: float,
    due: date,
    paid_on: date,
    past_invoice_count: int,
    past_late_count: int,
    moving_avg_delay_days: float,
    pay: float,
) -> dict:
    """Applies a payment without mutating inputs. The payment is clamped to the balance.

    `amount` and `amount_total` are both the invoice total; they must match or ValueError is raised.
    Customer history changes only when the invoice becomes PAID in this call.
    """
    if amount != amount_total:
        raise ValueError("amount and amount_total must be the same invoice total")
    if pay <= 0:
        raise ValueError("payment must be positive")
    balance = balance_due(amount, amount_paid)
    if balance <= 0:
        raise ValueError("invoice is already PAID")

    applied = min(pay, balance)
    new_paid = round(amount_paid + applied, 2)
    new_balance = balance_due(amount, new_paid)

    count = past_invoice_count
    late = past_late_count
    avg = moving_avg_delay_days

    if new_balance == 0:
        status = "PAID"
        days_late = max(0, (paid_on - due).days)
        avg = round(
            (moving_avg_delay_days * past_invoice_count + days_late) / (past_invoice_count + 1),
            1,
        )
        count = past_invoice_count + 1
        if paid_on > due:
            late = past_late_count + 1
    elif new_paid > 0:
        status = "PARTIAL"
    else:
        status = invoice_status(amount, new_paid, due, paid_on)

    return {
        "applied": round(applied, 2),
        "amount_paid": new_paid,
        "status": status,
        "past_invoice_count": count,
        "past_late_count": late,
        "moving_avg_delay_days": avg,
    }


def billing_occurrences(
    due: date,
    recurring: bool,
    deferred_days: int,
    is_paid: bool,
    window_start: date,
    window_end: date,
) -> list:
    """Effective bill dates inside [window_start, window_end], each shifted by deferred_days.

    Paid bills produce no occurrences. Recurring bills repeat monthly on the same day
    of month (clamped to the month's last day), up to MAX_RECURRING_OCCURRENCES.
    """
    if is_paid:
        return []

    shift = timedelta(days=deferred_days)
    out = []

    if not recurring:
        shifted = due + shift
        if window_start <= shifted <= window_end:
            out.append(shifted)
        return out

    # Start a couple of months before the window so deferral shifts are not missed.
    months_between = (window_start.year - due.year) * 12 + (window_start.month - due.month)
    start_k = max(0, months_between - 2)
    for k in range(start_k, start_k + MAX_RECURRING_OCCURRENCES):
        base = _add_months_clamped(due, k)
        shifted = base + shift
        if base > window_end and shifted > window_end:
            break
        if window_start <= shifted <= window_end:
            out.append(shifted)
    return out


def project(
    today: date,
    horizon: int,
    bank_balance: float,
    invoices: list,
    bills: list,
    scenario: dict,
) -> dict:
    """Day-by-day cash projection for `horizon` days starting at today (inclusive).

    Baseline: invoices land on due + round(moving_avg_delay_days), only when the
    moving-average risk is on and the client has at least 2 past invoices.
    Simulated: also adds global_late_days_shift, per-invoice overrides and the expense shock.
    Receipts expected before today are pushed to today + 7. Receipts expected after the last day are
    not dropped: their amounts are returned per series under "received_after_horizon".
    """
    dates = [today + timedelta(days=i) for i in range(horizon)]
    end = today + timedelta(days=horizon - 1) if horizon > 0 else today
    include_risk = bool(scenario.get("include_moving_avg_risk", False))
    global_shift = int(scenario.get("global_late_days_shift", 0))
    overrides = scenario.get("invoice_delay_overrides") or {}
    shock = scenario.get("extra_expense_shock")

    def index_of(d: date) -> int:
        idx = (d - today).days
        return idx if 0 <= idx < horizon else -1

    occurrences = []
    for bill in bills:
        for occ in billing_occurrences(
            bill["due_date"],
            bill["is_recurring_monthly"],
            bill["deferred_days"],
            bill["is_paid"],
            today,
            end,
        ):
            occurrences.append((bill, occ))

    def build(simulated: bool) -> tuple:
        inflows_by_day = [[] for _ in range(horizon)]
        outflows_by_day = [[] for _ in range(horizon)]
        after_horizon = 0.0

        for inv in invoices:
            balance = balance_due(inv["amount"], inv["amount_paid"])
            if balance <= 0:
                continue
            shift = 0
            if include_risk and inv["past_invoice_count"] >= 2:
                shift = _round_half_up(inv["moving_avg_delay_days"])
            if simulated:
                shift += global_shift + int(overrides.get(inv["id"], 0))
            expected = inv["due_date"] + timedelta(days=shift)
            receipt = today + timedelta(days=7) if expected < today else expected
            idx = index_of(receipt)
            if idx >= 0:
                inflows_by_day[idx].append(
                    {"label": f"Invoice {inv['id']}", "amount": balance, "ref": inv["id"]}
                )
            elif receipt > end:
                after_horizon += balance

        for bill, occ in occurrences:
            idx = index_of(occ)
            if idx >= 0:
                outflows_by_day[idx].append(
                    {"label": bill["title"], "amount": round(float(bill["amount"]), 2), "ref": bill["id"]}
                )

        if simulated and shock:
            offset = int(shock["day_offset"])
            if 0 <= offset < horizon:
                outflows_by_day[offset].append(
                    {"label": shock["title"], "amount": round(float(shock["amount"]), 2), "ref": "shock"}
                )

        days = []
        balance = bank_balance
        for i, d in enumerate(dates):
            inflows = inflows_by_day[i]
            outflows = outflows_by_day[i]
            inflow = round(sum(f["amount"] for f in inflows), 2)
            outflow = round(sum(f["amount"] for f in outflows), 2)
            balance = round(balance + inflow - outflow, 2)
            days.append(
                {
                    "date": d.isoformat(),
                    "inflow": inflow,
                    "outflow": outflow,
                    "balance": balance,
                    "inflows": inflows,
                    "outflows": outflows,
                }
            )
        return days, round(after_horizon, 2)

    baseline_days, baseline_after = build(False)
    simulated_days, simulated_after = build(True)
    return {
        "baseline": baseline_days,
        "simulated": simulated_days,
        "received_after_horizon": {"baseline": baseline_after, "simulated": simulated_after},
    }


def detect_crunch(days: list, received_after_horizon: float = 0.0) -> dict:
    """First day the balance goes below zero, the lowest balance, and how long cash stays safe.

    cash_safe_until is the day before the first crunch. It is None when the crunch is on day one
    or the list is empty. With no crunch it is the last day's date.

    ending_balance is the last day's balance; receipts pushed past the horizon are not included.
    cash_received_in_horizon is the sum of inflows on the days listed.
    """
    received_after = round(float(received_after_horizon), 2)
    cash_received = round(sum(d["inflow"] for d in days), 2)
    if not days:
        return {
            "first_crunch_date": None,
            "lowest_balance": 0.0,
            "lowest_balance_date": None,
            "shortfall": 0.0,
            "cash_safe_until": None,
            "days_below_zero": 0,
            "ending_balance": 0.0,
            "cash_received_in_horizon": cash_received,
            "received_after_horizon": received_after,
        }

    lowest = days[0]
    for d in days:
        if d["balance"] < lowest["balance"]:
            lowest = d

    first_neg = next((i for i, d in enumerate(days) if d["balance"] < 0), -1)
    if first_neg == -1:
        cash_safe_until = days[-1]["date"]
        first_crunch = None
    elif first_neg == 0:
        cash_safe_until = None
        first_crunch = days[0]["date"]
    else:
        cash_safe_until = days[first_neg - 1]["date"]
        first_crunch = days[first_neg]["date"]

    return {
        "first_crunch_date": first_crunch,
        "lowest_balance": lowest["balance"],
        "lowest_balance_date": lowest["date"],
        "shortfall": round(max(0.0, -lowest["balance"]), 2),
        "cash_safe_until": cash_safe_until,
        "days_below_zero": sum(1 for d in days if d["balance"] < 0),
        "ending_balance": round(days[-1]["balance"], 2),
        "cash_received_in_horizon": cash_received,
        "received_after_horizon": received_after,
    }


def receivables_aging(today: date, invoices: list) -> list:
    """Open invoices grouped into Overdue, 1-7d upcoming, 8-15d upcoming, and 15+d upcoming."""
    buckets = [
        {"id": "overdue", "label": "Overdue", "total": 0.0, "count": 0},
        {"id": "d1_7", "label": "1-7d", "total": 0.0, "count": 0},
        {"id": "d8_15", "label": "8-15d", "total": 0.0, "count": 0},
        {"id": "d15_plus", "label": "15+d", "total": 0.0, "count": 0},
    ]
    for inv in invoices:
        balance = balance_due(inv["amount"], inv["amount_paid"])
        if balance <= 0:
            continue
        due = inv["due_date"]
        diff = (due - today).days
        if diff < 0:
            idx = 0
        elif diff <= 7:
            idx = 1
        elif diff <= 15:
            idx = 2
        else:
            idx = 3
        buckets[idx]["total"] += balance
        buckets[idx]["count"] += 1
    for b in buckets:
        b["total"] = round(b["total"], 2)
    return buckets


def three_month_summary(days: list) -> list:
    """Inflow, outflow and net for the first 3 calendar months of a daily projection."""
    order = []
    sums = {}
    for d in days:
        key = d["date"][:7]
        if key not in sums:
            if len(order) == 3:
                break
            order.append(key)
            sums[key] = [0.0, 0.0]
        sums[key][0] += d["inflow"]
        sums[key][1] += d["outflow"]
    result = []
    for key in order:
        inflow = round(sums[key][0], 2)
        outflow = round(sums[key][1], 2)
        result.append(
            {"month": key, "inflow": inflow, "outflow": outflow, "net": round(inflow - outflow, 2)}
        )
    return result
