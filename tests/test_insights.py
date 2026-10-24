"""Findings from a printer's history speak only with enough evidence behind them."""

import os
import sys
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import insights        # noqa: E402
import mock_moonraker  # noqa: E402

NOW = datetime(2026, 10, 24, 12, 0)


def job(days_ago, status="completed", hours=2.0, name="part.gcode", material="PLA", grams=20.0, heads=("T0",)):
    start = NOW - timedelta(days=days_ago)
    return {"filename": name, "status": status, "start_time": start.isoformat(timespec="seconds"),
            "end_time": (start + timedelta(hours=hours)).isoformat(timespec="seconds"),
            "print_duration_hours": hours, "filament_used_grams": grams, "filament_type": material,
            "toolheads_used": list(heads)}


def ids(found):
    return {f["id"] for f in found}


class TestFindings(unittest.TestCase):
    def test_too_little_history_says_nothing(self):
        self.assertEqual(insights.findings([job(1), job(2, "error"), job(3)], now=NOW), [])

    def test_long_prints_failing_more_needs_enough_of_each(self):
        jobs = [job(i, hours=1) for i in range(1, 9)] + [job(10 + i, "error" if i < 3 else "completed", hours=8) for i in range(5)]
        found = insights.findings(jobs, now=NOW)
        self.assertIn("long", ids(found))
        # One long failure among three long prints is not a pattern.
        few = [job(i, hours=1) for i in range(1, 9)] + [job(20, "error", hours=8), job(21, hours=8), job(22, hours=8)]
        self.assertNotIn("long", ids(insights.findings(few, now=NOW)))

    def test_a_file_that_keeps_failing_is_named(self):
        jobs = [job(i) for i in range(1, 7)] + [job(8, "error", name="bracket.gcode"), job(9, "error", name="bracket.gcode"),
                                                 job(10, name="bracket.gcode")]
        f = next(x for x in insights.findings(jobs, now=NOW) if x["id"] == "file")
        self.assertEqual(f["title"], "bracket.gcode failed 2 of 3 times")
        self.assertEqual(f["evidence"], "3 attempts")

    def test_every_finding_states_its_evidence(self):
        jobs = [job(i, material="PETG" if i % 2 else "PLA", status="error" if i % 4 == 1 else "completed") for i in range(1, 40)]
        for f in insights.findings(jobs, now=NOW):
            self.assertTrue(f["evidence"], f)
            self.assertIn(f["tone"], ("good", "watch", "info"))

    def test_a_streak_and_the_overall_rate(self):
        jobs = [job(30, "error")] + [job(i) for i in range(1, 8)]
        found = insights.findings(jobs, now=NOW)
        self.assertIn("streak", ids(found))
        self.assertEqual(found[0]["id"], "rate")

    def test_summary_counts(self):
        s = insights.summary([job(1), job(2, "error"), job(3, "cancelled", grams=5)])
        self.assertEqual((s["prints"], s["completed"], s["failed"], s["cancelled"], s["grams"]), (3, 1, 1, 1, 45.0))


class TestDemoPrinter(unittest.TestCase):
    def test_the_demo_history_reads_as_findings(self):
        mock_moonraker.reset_all()
        out = insights.current()
        self.assertEqual(out["summary"]["prints"], 38)
        self.assertTrue(out["findings"])


if __name__ == "__main__":
    unittest.main()
