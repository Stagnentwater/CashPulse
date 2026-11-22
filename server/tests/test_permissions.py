"""Unit tests for server/permissions.py. Standard library unittest only.

Run from server/:  python -m unittest tests.test_permissions -v
"""

import os
import sys
import unittest

# Make `import permissions` work when run from server/.
SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import permissions  # noqa: E402
from permissions import (  # noqa: E402
    DEFAULT_POLICIES,
    TOOLS,
    default_permissions,
    permission_gate,
    preset,
    validate_permissions,
)


class PermissionGateTests(unittest.TestCase):
    def setUp(self):
        self.perms = default_permissions()

    def test_global_disabled_denies(self):
        self.perms["globalEnabled"] = False
        self.assertEqual(permission_gate(self.perms, "add_customer"), "DENY")

    def test_deny_policy_denies(self):
        self.assertEqual(permission_gate(self.perms, "update_opening_cash"), "DENY")

    def test_auto_allow_under_cap_is_allowed(self):
        self.perms["toolPolicies"]["record_payment"] = "AUTO_ALLOW"
        self.assertEqual(permission_gate(self.perms, "record_payment", 1000), "AUTO_ALLOW")

    def test_auto_allow_over_cap_needs_approval(self):
        self.perms["toolPolicies"]["record_payment"] = "AUTO_ALLOW"
        self.assertEqual(permission_gate(self.perms, "record_payment", 6000), "ASK_APPROVAL")

    def test_non_financial_tool_is_not_capped(self):
        self.assertEqual(permission_gate(self.perms, "add_customer", 999999), "AUTO_ALLOW")

    def test_ask_approval_stays_ask_approval_at_any_amount(self):
        self.assertEqual(permission_gate(self.perms, "record_payment", 1), "ASK_APPROVAL")
        self.assertEqual(permission_gate(self.perms, "record_payment", 999999), "ASK_APPROVAL")

    def test_unknown_tool_raises(self):
        with self.assertRaises(ValueError):
            permission_gate(self.perms, "delete_everything")


class ValidatePermissionsTests(unittest.TestCase):
    def test_cap_above_max_raises(self):
        data = default_permissions()
        data["maxAutoApproveAmountINR"] = 30000
        with self.assertRaises(ValueError):
            validate_permissions(data)

    def test_unknown_mode_raises(self):
        data = default_permissions()
        data["toolPolicies"]["record_payment"] = "MAYBE"
        with self.assertRaises(ValueError):
            validate_permissions(data)

    def test_missing_tool_raises(self):
        data = default_permissions()
        del data["toolPolicies"]["add_customer"]
        with self.assertRaises(ValueError):
            validate_permissions(data)

    def test_default_round_trips_unchanged(self):
        data = default_permissions()
        self.assertEqual(validate_permissions(data), data)


class PresetTests(unittest.TestCase):
    def test_strict_accountant(self):
        policies = preset("strict_accountant")["toolPolicies"]
        self.assertEqual(set(policies), set(TOOLS))
        for tool in TOOLS:
            expected = "DENY" if tool == "update_opening_cash" else "ASK_APPROVAL"
            self.assertEqual(policies[tool], expected, tool)

    def test_smart_copilot_equals_defaults(self):
        self.assertEqual(preset("smart_copilot")["toolPolicies"], DEFAULT_POLICIES)

    def test_full_autopilot(self):
        policies = preset("full_autopilot")["toolPolicies"]
        self.assertEqual(policies["send_payment_reminder"], "ASK_APPROVAL")
        self.assertEqual(policies["record_payment"], "AUTO_ALLOW")

    def test_unknown_preset_raises(self):
        with self.assertRaises(KeyError):
            preset("nope")


class CopyTests(unittest.TestCase):
    def test_default_permissions_returns_copy(self):
        before = dict(DEFAULT_POLICIES)
        perms = default_permissions()
        perms["toolPolicies"]["record_payment"] = "AUTO_ALLOW"
        perms["maxAutoApproveAmountINR"] = 1
        self.assertEqual(DEFAULT_POLICIES, before)
        self.assertEqual(permissions.DEFAULT_CAP_INR, 5000)


if __name__ == "__main__":
    unittest.main()
