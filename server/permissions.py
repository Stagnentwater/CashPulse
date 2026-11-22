"""AI permission model for CashPulse. Pure Python, standard library only, no database.

Each tool has a policy mode. permission_gate() decides whether a proposed tool call
is auto-allowed, needs approval, or is denied. Financial tools are additionally
capped by maxAutoApproveAmountINR when their policy is AUTO_ALLOW.
"""

from typing import Any, Optional

TOOLS = (
    "create_invoice",
    "record_payment",
    "add_customer",
    "add_or_update_bill",
    "defer_bill",
    "send_payment_reminder",
    "run_what_if_simulation",
    "update_opening_cash",
)

FINANCIAL_TOOLS = frozenset(
    {
        "create_invoice",
        "record_payment",
        "add_or_update_bill",
        "defer_bill",
        "update_opening_cash",
    }
)

MODES = ("AUTO_ALLOW", "ASK_APPROVAL", "DENY")

MAX_CAP_INR = 25000
DEFAULT_CAP_INR = 5000

DEFAULT_POLICIES = {
    "create_invoice": "ASK_APPROVAL",
    "record_payment": "ASK_APPROVAL",
    "add_customer": "AUTO_ALLOW",
    "add_or_update_bill": "ASK_APPROVAL",
    "defer_bill": "ASK_APPROVAL",
    "send_payment_reminder": "ASK_APPROVAL",
    "run_what_if_simulation": "AUTO_ALLOW",
    "update_opening_cash": "DENY",
}

PRESETS = {
    "strict_accountant": {
        "globalEnabled": True,
        "maxAutoApproveAmountINR": DEFAULT_CAP_INR,
        "toolPolicies": {
            tool: ("DENY" if tool == "update_opening_cash" else "ASK_APPROVAL")
            for tool in TOOLS
        },
    },
    "smart_copilot": {
        "globalEnabled": True,
        "maxAutoApproveAmountINR": DEFAULT_CAP_INR,
        "toolPolicies": dict(DEFAULT_POLICIES),
    },
    "full_autopilot": {
        "globalEnabled": True,
        "maxAutoApproveAmountINR": DEFAULT_CAP_INR,
        "toolPolicies": {
            tool: (
                "DENY"
                if tool == "update_opening_cash"
                else "ASK_APPROVAL"
                if tool == "send_payment_reminder"
                else "AUTO_ALLOW"
            )
            for tool in TOOLS
        },
    },
}


def default_permissions() -> dict:
    """Fresh copy of the default permission settings."""
    return {
        "globalEnabled": True,
        "maxAutoApproveAmountINR": DEFAULT_CAP_INR,
        "toolPolicies": dict(DEFAULT_POLICIES),
    }


def preset(name: str) -> dict:
    """Fresh copy of the named preset. Raises KeyError for an unknown name."""
    if name not in PRESETS:
        raise KeyError(name)
    p = PRESETS[name]
    return {
        "globalEnabled": p["globalEnabled"],
        "maxAutoApproveAmountINR": p["maxAutoApproveAmountINR"],
        "toolPolicies": dict(p["toolPolicies"]),
    }


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_permissions(data: Any) -> dict:
    """Checks and normalizes a permissions dict. Raises ValueError when invalid.

    Extra unknown top-level keys are dropped. Returns a new dict.
    """
    if not isinstance(data, dict):
        raise ValueError("permissions must be an object")

    global_enabled = data.get("globalEnabled")
    if not isinstance(global_enabled, bool):
        raise ValueError("globalEnabled must be a bool")

    cap = data.get("maxAutoApproveAmountINR")
    if not _is_number(cap):
        raise ValueError("maxAutoApproveAmountINR must be a number")
    if cap < 0 or cap > MAX_CAP_INR:
        raise ValueError(f"maxAutoApproveAmountINR must be between 0 and {MAX_CAP_INR}")

    policies = data.get("toolPolicies")
    if not isinstance(policies, dict):
        raise ValueError("toolPolicies must be an object")

    for tool in policies:
        if tool not in TOOLS:
            raise ValueError(f"unknown tool: {tool}")

    normalized_policies = {}
    for tool in TOOLS:
        if tool not in policies:
            raise ValueError(f"missing tool policy: {tool}")
        mode = policies[tool]
        if mode not in MODES:
            raise ValueError(f"invalid mode for {tool}: {mode}")
        normalized_policies[tool] = mode

    return {
        "globalEnabled": global_enabled,
        "maxAutoApproveAmountINR": cap,
        "toolPolicies": normalized_policies,
    }


def permission_gate(perms: dict, tool_name: str, amount_inr: Optional[float] = None) -> str:
    """Returns "AUTO_ALLOW", "ASK_APPROVAL" or "DENY" for a proposed tool call."""
    if tool_name not in TOOLS:
        raise ValueError(f"unknown tool: {tool_name}")

    if perms["globalEnabled"] is False:
        return "DENY"

    policy = perms["toolPolicies"][tool_name]
    if policy == "DENY":
        return "DENY"

    if (
        policy == "AUTO_ALLOW"
        and tool_name in FINANCIAL_TOOLS
        and amount_inr is not None
        and amount_inr > perms["maxAutoApproveAmountINR"]
    ):
        return "ASK_APPROVAL"

    return policy
