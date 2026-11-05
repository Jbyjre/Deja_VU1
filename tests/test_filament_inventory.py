"""
Tests for filament_inventory.py - spool tracking, job-coverage checks, and
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

    def test_default_inventory_does_not_invent_owned_spools(self):
        self.assertEqual(filament_inventory.get_inventory(), [])

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
        filament_inventory.add_spool('PLA','Test orange','#ff7700',500)

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
        filament_inventory.add_spool('PLA','Test orange','#ff7700',500)

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



class TestUnknownWeights(unittest.TestCase):
    """An unknown weight is never an empty roll (research reproduction "unknown-weight")."""

    def setUp(self):
        filament_inventory.reset()
        self.addCleanup(filament_inventory.reset)

    def test_a_spool_added_without_grams_is_unknown(self):
        spool = filament_inventory.add_spool("PLA", "Red", "#ff0000", None)
        self.assertIsNone(spool["grams_remaining"])
        self.assertEqual(spool["weight_source"], "unknown")
        blank = filament_inventory.add_spool("PLA", "Blue", "#0000ff", "  ")
        self.assertIsNone(blank["grams_remaining"])

    def test_typed_figures_are_estimates_unless_weighed(self):
        typed = filament_inventory.add_spool("PLA", "Red", "#ff0000", 1000)
        weighed = filament_inventory.add_spool("PLA", "Green", "#00ff00", 812, "weighed")
        self.assertEqual(typed["weight_source"], "estimated")
        self.assertEqual(weighed["weight_source"], "weighed")
        self.assertEqual(weighed["used_since_weighed"], 0.0)
        with self.assertRaises(ValueError):
            filament_inventory.add_spool("PLA", "Odd", "#123456", 10, "guessed")

    def test_weighing_and_clearing(self):
        spool = filament_inventory.add_spool("PLA", "Red", "#ff0000", None)
        weighed = filament_inventory.update_grams(spool["id"], 640)
        self.assertEqual((weighed["grams_remaining"], weighed["weight_source"]), (640.0, "weighed"))
        cleared = filament_inventory.update_grams(spool["id"], None)
        self.assertEqual((cleared["grams_remaining"], cleared["weight_source"]), (None, "unknown"))

    def test_unknown_still_covers_a_colour(self):
        filament_inventory.add_spool("PLA", "Red", "#ff0000", None)
        result = filament_inventory.check_job_requirements(
            [{"toolhead": "T0", "expected_color_name": "Red", "expected_material": "PLA"}])
        self.assertTrue(result["all_covered"])

    def test_estimate_for_job_says_unknown_instead_of_short(self):
        filament_inventory.add_spool("PLA", "Red", "#ff0000", None)
        rows = filament_inventory.estimate_for_job(
            [{"toolhead": "T0", "expected_material": "PLA", "expected_color_hex": "#ff0000", "grams": 20}])
        self.assertEqual(rows[0]["status"], "unknown_weight")
        self.assertIsNone(rows[0]["grams_remaining"])
        self.assertIsNone(rows[0]["grams_after"])

    def test_a_print_on_an_unknown_spool_keeps_it_unknown_but_counts_the_use(self):
        filament_inventory.add_spool("PLA", "Red", "#ff0000", None)
        result = filament_inventory.deduct_after_print(
            {"toolheads_used": ["T0"], "filament_type": "PLA", "filament_color_hex": "#ff0000",
             "filament_used_grams": 20.0})
        self.assertIsNone(result["grams_remaining"])
        spool = filament_inventory.get_inventory()[0]
        self.assertIsNone(spool["grams_remaining"])
        self.assertEqual(spool["used_since_weighed"], 20.0)

    def test_a_print_turns_a_weighed_figure_into_an_estimate(self):
        filament_inventory.add_spool("PLA", "Red", "#ff0000", 500, "weighed")
        filament_inventory.deduct_after_print(
            {"toolheads_used": ["T0"], "filament_type": "PLA", "filament_color_hex": "#ff0000",
             "filament_used_grams": 20.0})
        spool = filament_inventory.get_inventory()[0]
        self.assertEqual((spool["grams_remaining"], spool["weight_source"]), (480.0, "estimated"))

    def test_forecast_has_no_prints_left_for_an_unknown_weight(self):
        filament_inventory.add_spool("PLA", "Red", "#ff0000", None)
        history = [{"status": "completed", "filament_type": "PLA", "filament_color_name": "Red",
                    "filament_used_grams": 20.0}]
        row = filament_inventory.forecast(history)[0]
        self.assertIsNone(row["prints_left"])
        self.assertEqual(row["avg_grams_per_print"], 20.0)

    def test_records_saved_before_sources_are_labelled_from_what_they_say(self):
        filament_inventory._save([
            {"id": "spool-1", "material": "PLA", "color_name": "A", "color_hex": "#ff0000",
             "grams_remaining": 300.0, "loaded_since": "2026-10-01T10:00:00"},
            {"id": "spool-2", "material": "PLA", "color_name": "B", "color_hex": "#00ff00",
             "grams_remaining": 250.0, "loaded_since": "2026-10-01T10:00:00",
             "last_weighed_at": "2026-10-02T10:00:00", "used_since_weighed": 0.0},
        ])
        a, b = filament_inventory.get_inventory()
        self.assertEqual((a["grams_remaining"], a["weight_source"]), (300.0, "estimated"))
        self.assertEqual(b["weight_source"], "weighed")


class TestRollFixedAtPrintStart(unittest.TestCase):
    """Research reproduction "completion-current-assignment": the end of a print read the
    assignment as it was then, so a roll assigned mid-print was charged for it."""

    def setUp(self):
        import tempfile
        from unittest import mock as umock
        import tool_setup
        filament_inventory.reset()
        self.addCleanup(filament_inventory.reset)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        patcher = umock.patch.object(tool_setup, "_PATH", os.path.join(folder.name, "tools.json"))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.tool_setup = tool_setup
        self.a = filament_inventory.add_spool("PLA", "Red A", "#ff0000", 500, "weighed")
        self.b = filament_inventory.add_spool("PLA", "Red B", "#ff0000", 500, "weighed")
        self.pid = "u1-workshop"

    def assign(self, spool):
        heads = [{"toolhead": f"T{i}", "color_hex": "#ff0000", "material": "PLA", "nozzle": .4, "height": .2,
                  "spool_id": spool["id"] if i == 0 else ""} for i in range(4)]
        with mock_moonraker.use_printer(self.pid):
            return self.tool_setup.save({"heads": heads})

    def job(self):
        return {"toolheads_used": ["T0"], "filament_type": "PLA", "filament_color_hex": "#ff0000",
                "filament_used_grams": 20.0, "filename": "benchy.gcode"}

    def grams(self):
        return {s["id"]: s["grams_remaining"] for s in filament_inventory.get_inventory()}

    def test_a_roll_assigned_mid_print_is_not_charged(self):
        self.assign(self.a)
        filament_inventory.record_print_start(self.pid, {"current_file": "benchy.gcode", "extruder_map": {}})
        saved = self.assign(self.b)                      # someone picks the other roll before the end
        self.assertEqual(saved["mid_print_changes"][0]["to"], self.b["id"])
        result = filament_inventory.deduct_after_print(self.job(), printer_id=self.pid)
        self.assertEqual(result["spool_id"], self.a["id"])
        self.assertEqual(result["basis"], "assigned at start")
        self.assertEqual(result["assignment_changed"][0]["from"], self.a["id"])
        self.assertEqual(self.grams(), {self.a["id"]: 480.0, self.b["id"]: 500.0})
        self.assertIsNone(filament_inventory.print_start_record(self.pid))   # used once
        charge = filament_inventory.recent_charges(self.pid)[0]
        self.assertEqual((charge["spool_id"], charge["grams"]), (self.a["id"], 20.0))

    def test_the_explicit_correction_moves_the_charge(self):
        self.assign(self.a)
        filament_inventory.record_print_start(self.pid, {"current_file": "benchy.gcode"})
        result = filament_inventory.deduct_after_print(self.job(), printer_id=self.pid)
        moved = filament_inventory.move_charge(result["charge_id"], self.b["id"])
        self.assertEqual(moved["moved_to"], self.b["id"])
        self.assertEqual(self.grams(), {self.a["id"]: 500.0, self.b["id"]: 480.0})
        with self.assertRaises(ValueError):
            filament_inventory.move_charge(result["charge_id"], self.a["id"])   # never twice
        with self.assertRaises(ValueError):
            filament_inventory.move_charge("nope", self.a["id"])

    def test_the_start_record_follows_the_printers_filament_mapping(self):
        heads = [{"toolhead": f"T{i}", "color_hex": "#ff0000", "material": "PLA", "nozzle": .4, "height": .2,
                  "spool_id": self.b["id"] if i == 2 else ""} for i in range(4)]
        with mock_moonraker.use_printer(self.pid):
            self.tool_setup.save({"heads": heads})
        filament_inventory.record_print_start(self.pid, {"current_file": "x.gcode", "extruder_map": {"T0": "T2"}})
        result = filament_inventory.deduct_after_print(self.job(), printer_id=self.pid)
        self.assertEqual((result["spool_id"], result["basis"]), (self.b["id"], "assigned at start"))

    def test_without_a_start_record_an_assigned_roll_is_not_guessed(self):
        self.assign(self.b)
        result = filament_inventory.deduct_after_print(self.job(), printer_id=self.pid)
        self.assertFalse(result["charged"])
        self.assertIn("didn't see this print start", result["reason"])
        self.assertEqual(self.grams(), {self.a["id"]: 500.0, self.b["id"]: 500.0})

    def test_a_cancelled_print_forgets_its_record(self):
        self.assign(self.a)
        filament_inventory.record_print_start(self.pid, {"current_file": "x.gcode"})
        filament_inventory.forget_print_start(self.pid)
        self.assertIsNone(filament_inventory.print_start_record(self.pid))

    def test_the_start_record_survives_a_restart(self):
        self.assign(self.a)
        filament_inventory.record_print_start(self.pid, {"current_file": "x.gcode"})
        on_disk = json.load(open(filament_inventory._STARTS_PATH))
        self.assertEqual(on_disk["printing"][self.pid]["heads"]["T0"], self.a["id"])

    def test_the_live_feed_records_a_real_printers_start(self):
        from unittest import mock as umock
        import live_feed
        import modules
        live_feed.reset()
        self.addCleanup(live_feed.reset)
        live_feed._prev_state[self.pid] = "ready"
        with umock.patch.object(live_feed.mock_moonraker, "is_connected", return_value=True), \
             umock.patch.object(modules, "is_enabled", side_effect=lambda m: m == "filament_inventory"), \
             umock.patch.object(live_feed, "publish_event"):
            self.assign(self.a)
            live_feed._detect(self.pid, {"state": "printing", "current_file": "x.gcode"})
        self.assertEqual(filament_inventory.print_start_record(self.pid)["heads"]["T0"], self.a["id"])

if __name__ == "__main__":
    unittest.main()
