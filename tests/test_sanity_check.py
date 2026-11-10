"""
Tests for sanity_check.py - the combined "is it safe to print?" verdict.

    python3 -m unittest discover tests
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import maintenance      # noqa: E402
import sanity_check     # noqa: E402


class TestSanityCheck(unittest.TestCase):

    def setUp(self):
        maintenance.reset_log()

    def tearDown(self):
        maintenance.reset_log()

    def test_returns_a_verdict_and_reasons(self):
        result = sanity_check.check()
        self.assertIn("safe_to_print", result)
        self.assertIn("reasons", result)
        self.assertIsInstance(result["reasons"], list)

    def test_unsafe_when_there_are_reasons(self):
        result = sanity_check.check()
        self.assertEqual(result["safe_to_print"], len(result["reasons"]) == 0)

    def test_demo_history_produces_at_least_one_reason(self):
        # The simulated history has overdue tasks and a colour mismatch by
        # design (see maintenance and color_check tests) - sanity_check
        # should surface at least one of them, not report a false all-clear.
        result = sanity_check.check()
        self.assertFalse(result["safe_to_print"])
        self.assertGreater(len(result["reasons"]), 0)

    def test_optical_observation_does_not_claim_a_file_comparison_or_block_a_print(self):
        with mock.patch.object(sanity_check.color_check, "check_current_job", return_value={
                "overall": "sensor_readings", "sensors": [{"status": "reading"}]}), \
                mock.patch.object(sanity_check.maintenance, "get_status", return_value={"tasks": []}), \
                mock.patch.object(sanity_check.led_status, "get_all_ring_states", return_value={"rings": []}):
            result = sanity_check.check()
        self.assertTrue(result["colour_measured"])
        self.assertFalse(result["colour_compared"])
        self.assertTrue(result["can_start"])
        self.assertEqual(result["blocking"], [])

    def test_old_or_low_quality_samples_do_not_count_as_measured_colour(self):
        for status in ("no_reading", "stale", "unreadable", "uncalibrated", "low_confidence"):
            with self.subTest(status=status), \
                    mock.patch.object(sanity_check.color_check, "check_current_job", return_value={
                        "overall": "sensor_readings", "sensors": [{"status": status}]}):
                result = sanity_check.check()
            self.assertFalse(result["colour_measured"])
            self.assertFalse(result["colour_compared"])


if __name__ == "__main__":
    unittest.main()
