"""
Tests for comparison.py — "what changed?", likely-cause, and repeat-last-
settings. These build small fake print histories rather than relying on
mock_moonraker's random data, so the expected differences are exact.

    python3 -m unittest discover tests
"""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import comparison       # noqa: E402


_HISTORY = [
    {
        "job_id": "job-001", "filename": "vase.gcode", "status": "completed",
        "start_time": "2026-08-01T10:00:00", "filament_type": "PLA",
        "filament_color_name": "Black", "filament_color_hex": "#1c1c1e",
        "toolheads_used": ["T0"],
    },
    {
        "job_id": "job-002", "filename": "vase.gcode", "status": "error",
        "start_time": "2026-08-05T10:00:00", "filament_type": "PETG",
        "filament_color_name": "Sky Blue", "filament_color_hex": "#3b82f6",
        "toolheads_used": ["T1"],
    },
    {
        "job_id": "job-003", "filename": "vase.gcode", "status": "error",
        "start_time": "2026-08-08T10:00:00", "filament_type": "PETG",
        "filament_color_name": "Sky Blue", "filament_color_hex": "#3b82f6",
        "toolheads_used": ["T1"],
    },
    {
        "job_id": "job-004", "filename": "vase.gcode", "status": "completed",
        "start_time": "2026-08-10T10:00:00", "filament_type": "PLA",
        "filament_color_name": "Black", "filament_color_hex": "#1c1c1e",
        "toolheads_used": ["T0"],
    },
]

_STATE_MATCHING = {
    "current_file": "vase.gcode",
    "active_toolhead": "T0",
    "toolheads": {"T0": {"filament_color_name": "Black"}},
}

_STATE_DIFFERENT = {
    "current_file": "vase.gcode",
    "active_toolhead": "T2",
    "toolheads": {"T2": {"filament_color_name": "Signal Red"}},
}


class TestCompareCurrentJob(unittest.TestCase):

    def test_no_history_for_unknown_file(self):
        with patch("comparison.mock_moonraker.get_print_history", return_value=_HISTORY):
            result = comparison.compare_current_job(filename="never_printed.gcode")
        self.assertFalse(result["has_history"])

    def test_matching_setup_has_no_differences(self):
        with patch("comparison.mock_moonraker.get_print_history", return_value=_HISTORY), \
             patch("comparison.mock_moonraker.get_printer_state", return_value=_STATE_MATCHING):
            result = comparison.compare_current_job(filename="vase.gcode")
        self.assertEqual(result["differences"], [])

    def test_different_toolhead_and_color_are_flagged(self):
        with patch("comparison.mock_moonraker.get_print_history", return_value=_HISTORY), \
             patch("comparison.mock_moonraker.get_printer_state", return_value=_STATE_DIFFERENT):
            result = comparison.compare_current_job(filename="vase.gcode")
        self.assertEqual(len(result["differences"]), 2)

    def test_likely_cause_flags_a_shared_material_across_failures(self):
        with patch("comparison.mock_moonraker.get_print_history", return_value=_HISTORY), \
             patch("comparison.mock_moonraker.get_printer_state", return_value=_STATE_MATCHING):
            result = comparison.compare_current_job(filename="vase.gcode")
        self.assertEqual(len(result["likely_causes"]), 1)
        self.assertIn("PETG", result["likely_causes"][0])

    def test_counts_are_correct(self):
        with patch("comparison.mock_moonraker.get_print_history", return_value=_HISTORY), \
             patch("comparison.mock_moonraker.get_printer_state", return_value=_STATE_MATCHING):
            result = comparison.compare_current_job(filename="vase.gcode")
        self.assertEqual(result["past_successful_count"], 2)
        self.assertEqual(result["past_failed_count"], 2)

    def test_no_likely_cause_when_failures_used_different_materials(self):
        mixed = list(_HISTORY)
        mixed[2] = {**mixed[2], "filament_type": "ABS"}
        with patch("comparison.mock_moonraker.get_print_history", return_value=mixed), \
             patch("comparison.mock_moonraker.get_printer_state", return_value=_STATE_MATCHING):
            result = comparison.compare_current_job(filename="vase.gcode")
        self.assertEqual(result["likely_causes"], [])


class TestRepeatLastSettings(unittest.TestCase):

    def test_returns_the_most_recent_successful_job(self):
        with patch("comparison.mock_moonraker.get_print_history", return_value=_HISTORY):
            result = comparison.repeat_last_settings(filename="vase.gcode")
        self.assertEqual(result["from_job_id"], "job-004")
        self.assertEqual(result["filament_color_name"], "Black")

    def test_raises_when_never_printed_successfully(self):
        only_failures = [j for j in _HISTORY if j["status"] == "error"]
        with patch("comparison.mock_moonraker.get_print_history", return_value=only_failures):
            with self.assertRaises(ValueError):
                comparison.repeat_last_settings(filename="vase.gcode")


if __name__ == "__main__":
    unittest.main()
