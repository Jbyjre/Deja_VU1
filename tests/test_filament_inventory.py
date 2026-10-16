"""
Tests for filament_inventory.py — spool tracking, job-coverage checks, and
the idle-spool reminder.

    python3 -m unittest discover tests
"""

import json
import os
import sys
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import filament_inventory      # noqa: E402
import mock_moonraker          # noqa: E402


class TestInventoryBasics(unittest.TestCase):

    def setUp(self):
        filament_inventory.reset()

    def tearDown(self):
        filament_inventory.reset()

    def test_default_inventory_is_not_empty(self):
        self.assertGreater(len(filament_inventory.get_inventory()), 0)

    def test_add_spool(self):
        spool = filament_inventory.add_spool("PLA", "Grass Green", "#2f9e44", 1000)
        self.assertEqual(spool["material"], "PLA")
        self.assertIn(spool, filament_inventory.get_inventory())

    def test_remove_spool(self):
        spool = filament_inventory.add_spool("PLA", "Grass Green", "#2f9e44", 1000)
        remaining = filament_inventory.remove_spool(spool["id"])
        self.assertNotIn(spool["id"], [s["id"] for s in remaining])

    def test_remove_unknown_spool_is_rejected(self):
        with self.assertRaises(ValueError):
            filament_inventory.remove_spool("not-a-real-spool")

    def test_update_grams(self):
        spool = filament_inventory.add_spool("PLA", "Grass Green", "#2f9e44", 1000)
        updated = filament_inventory.update_grams(spool["id"], 250)
        self.assertEqual(updated["grams_remaining"], 250.0)


class TestJobCoverage(unittest.TestCase):

    def setUp(self):
        filament_inventory.reset()

    def tearDown(self):
        filament_inventory.reset()

    def test_flags_missing_color(self):
        required = [
            {"toolhead": "T0", "expected_color_name": "Hot Pink", "expected_material": "PLA"},
        ]
        result = filament_inventory.check_job_requirements(required)
        self.assertFalse(result["all_covered"])
        self.assertEqual(len(result["missing"]), 1)

    def test_covered_when_color_in_stock(self):
        inventory = filament_inventory.get_inventory()
        have_color = inventory[0]["color_name"]
        required = [
            {"toolhead": "T0", "expected_color_name": have_color, "expected_material": "PLA"},
        ]
        result = filament_inventory.check_job_requirements(required)
        self.assertTrue(result["all_covered"])

    def test_a_spool_with_zero_grams_does_not_count_as_covered(self):
        inventory = filament_inventory.get_inventory()
        target = inventory[0]
        filament_inventory.update_grams(target["id"], 0)
        required = [
            {"toolhead": "T0", "expected_color_name": target["color_name"], "expected_material": target["material"]},
        ]
        result = filament_inventory.check_job_requirements(required)
        self.assertFalse(result["all_covered"])

    def test_defaults_to_current_job_requirements(self):
        # Should not raise, and should reflect mock_moonraker's own data.
        result = filament_inventory.check_job_requirements()
        self.assertIn("all_covered", result)


class TestIdleSpools(unittest.TestCase):

    def setUp(self):
        filament_inventory.reset()

    def tearDown(self):
        filament_inventory.reset()

    def _set_loaded_since(self, spool_id, when):
        inventory = filament_inventory.get_inventory()
        for spool in inventory:
            if spool["id"] == spool_id:
                spool["loaded_since"] = when.isoformat(timespec="seconds")
        path = filament_inventory._INVENTORY_PATH
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(inventory, fh)

    def test_freshly_loaded_spool_is_not_flagged(self):
        self.assertEqual(filament_inventory.idle_spools(), [])

    def test_old_spool_is_flagged(self):
        spool = filament_inventory.get_inventory()[0]
        self._set_loaded_since(spool["id"], datetime.now() - timedelta(days=30))
        flagged = filament_inventory.idle_spools()
        self.assertEqual(len(flagged), 1)
        self.assertEqual(flagged[0]["id"], spool["id"])

    def test_threshold_is_configurable(self):
        spool = filament_inventory.get_inventory()[0]
        self._set_loaded_since(spool["id"], datetime.now() - timedelta(days=5))
        self.assertGreaterEqual(len(filament_inventory.idle_spools(threshold_days=3)), 1)
        self.assertEqual(filament_inventory.idle_spools(threshold_days=10), [])


if __name__ == "__main__":
    unittest.main()
