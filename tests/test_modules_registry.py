"""
Tests for modules.py — the feature on/off registry.

    python3 -m unittest discover tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import modules      # noqa: E402


class TestRegistry(unittest.TestCase):

    def setUp(self):
        modules.reset_state()

    def tearDown(self):
        modules.reset_state()

    def test_every_module_has_the_required_fields(self):
        for module in modules.get_all():
            for field in ("id", "name", "description", "status", "enabled"):
                self.assertIn(field, module)

    def test_default_enabled_state_matches_registry(self):
        for module in modules.get_all():
            definition = next(m for m in modules.REGISTRY if m["id"] == module["id"])
            self.assertEqual(module["enabled"], definition["default_enabled"])

    def test_toggle_off_and_on(self):
        modules.set_enabled("filament_inventory", True)
        self.assertTrue(modules.is_enabled("filament_inventory"))
        modules.set_enabled("filament_inventory", False)
        self.assertFalse(modules.is_enabled("filament_inventory"))

    def test_toggle_persists_across_get_all_calls(self):
        modules.set_enabled("maintenance", False)
        updated = next(m for m in modules.get_all() if m["id"] == "maintenance")
        self.assertFalse(updated["enabled"])

    def test_unknown_module_is_rejected(self):
        with self.assertRaises(ValueError):
            modules.set_enabled("not_a_real_module", True)

    def test_unknown_module_id_counts_as_enabled(self):
        # A route with no matching registry entry should never be blocked
        # by accident.
        self.assertTrue(modules.is_enabled("something_not_in_the_registry"))


if __name__ == "__main__":
    unittest.main()
