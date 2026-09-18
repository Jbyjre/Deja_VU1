"""
Tests for cost_calculator.py — filament + electricity pricing.

    python3 -m unittest discover tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import cost_calculator   # noqa: E402
import mock_moonraker    # noqa: E402


class TestSettings(unittest.TestCase):

    def setUp(self):
        cost_calculator.reset()

    def tearDown(self):
        cost_calculator.reset()

    def test_defaults(self):
        settings = cost_calculator.get_settings()
        self.assertIn("PLA", settings["filament_price_per_kg"])
        self.assertEqual(settings["printer_watts"], 250)

    def test_saving_merges_material_prices(self):
        cost_calculator.save_settings({"filament_price_per_kg": {"PLA": 30.0}})
        settings = cost_calculator.get_settings()
        self.assertEqual(settings["filament_price_per_kg"]["PLA"], 30.0)
        # Other materials are untouched, not wiped out.
        self.assertIn("PETG", settings["filament_price_per_kg"])

    def test_saving_electricity_rate_and_wattage(self):
        cost_calculator.save_settings({"electricity_rate_per_kwh": 0.22, "printer_watts": 300})
        settings = cost_calculator.get_settings()
        self.assertEqual(settings["electricity_rate_per_kwh"], 0.22)
        self.assertEqual(settings["printer_watts"], 300)


class TestComputeJobCost(unittest.TestCase):

    def setUp(self):
        cost_calculator.reset()

    def tearDown(self):
        cost_calculator.reset()

    def test_known_material(self):
        result = cost_calculator.compute_job_cost("PLA", 1000, 10)
        # 1kg PLA at $20/kg = $20 material. 250W * 10h = 2.5kWh * $0.15 = $0.375.
        self.assertEqual(result["material_cost"], 20.0)
        self.assertEqual(result["energy_cost"], round(0.375, 2))
        self.assertEqual(result["total_cost"], round(20.0 + 0.375, 2))

    def test_unknown_material_falls_back(self):
        result = cost_calculator.compute_job_cost("Nylon", 500, 1)
        self.assertGreater(result["total_cost"], 0)


class TestHistoryAndCurrent(unittest.TestCase):

    def setUp(self):
        cost_calculator.reset()
        mock_moonraker.reset_live_state()

    def tearDown(self):
        cost_calculator.reset()
        mock_moonraker.reset_live_state()

    def test_cost_history_returns_priced_jobs(self):
        jobs = cost_calculator.cost_history(limit=5)
        self.assertEqual(len(jobs), 5)
        for job in jobs:
            self.assertIn("total_cost", job)
            self.assertGreaterEqual(job["total_cost"], 0)

    def test_cost_history_can_filter_by_filename(self):
        all_jobs = mock_moonraker.get_print_history()
        target = all_jobs[0]["filename"]
        jobs = cost_calculator.cost_history(filename=target, limit=50)
        self.assertTrue(all(j["filename"] == target for j in jobs))

    def test_estimate_current_job_while_printing(self):
        # The default live state is mid-print.
        result = cost_calculator.estimate_current_job()
        self.assertTrue(result["is_estimate"])
        self.assertGreater(result["total_cost"], 0)
        self.assertGreaterEqual(result["cost_so_far"], 0)

    def test_estimate_current_job_raises_when_idle(self):
        mock_moonraker.cancel_print()
        with self.assertRaises(ValueError):
            cost_calculator.estimate_current_job()


if __name__ == "__main__":
    unittest.main()
