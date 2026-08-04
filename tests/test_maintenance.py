"""
Tests for the maintenance module — the one fully working part of Deja Vu1.

These use Python's built-in unittest, so there is nothing to install:

    python3 -m unittest discover tests

Each test checks one behaviour the module promises: that it counts print
hours correctly, that it flags overdue tasks, and that marking a task done
actually resets its counter.
"""

import os
import sys
import unittest

# Let the tests import the backend modules.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import maintenance          # noqa: E402
import mock_moonraker       # noqa: E402


class TestMockData(unittest.TestCase):
    """The simulated print history should look like real printer data."""

    def setUp(self):
        self.history = mock_moonraker.get_print_history()

    def test_history_has_enough_jobs(self):
        # The brief asked for at least 30 fake print jobs.
        self.assertGreaterEqual(len(self.history), 30)

    def test_jobs_are_in_chronological_order(self):
        times = [job["start_time"] for job in self.history]
        self.assertEqual(times, sorted(times), "history should be oldest first")

    def test_every_job_has_the_expected_fields(self):
        required = {
            "job_id", "filename", "status", "start_time", "end_time",
            "print_duration_hours", "filament_used_grams", "toolheads_used",
        }
        for job in self.history:
            self.assertTrue(required.issubset(job.keys()))

    def test_durations_and_filament_are_positive(self):
        for job in self.history:
            self.assertGreater(job["print_duration_hours"], 0)
            self.assertGreater(job["filament_used_grams"], 0)

    def test_history_contains_both_successes_and_failures(self):
        statuses = {job["status"] for job in self.history}
        self.assertIn("completed", statuses)
        self.assertTrue(statuses & {"error", "cancelled"},
                        "history should include some failed prints")


class TestTotals(unittest.TestCase):
    """Usage totals should add up to the print history."""

    def test_totals_match_the_history(self):
        history = mock_moonraker.get_print_history()
        totals = maintenance.get_printer_totals()

        self.assertEqual(totals["total_prints"], len(history))
        self.assertAlmostEqual(
            totals["total_print_hours"],
            sum(j["print_duration_hours"] for j in history),
            places=1,
        )

    def test_completed_and_failed_add_up(self):
        totals = maintenance.get_printer_totals()
        self.assertEqual(
            totals["completed_prints"] + totals["failed_prints"],
            totals["total_prints"],
        )


class TestStatus(unittest.TestCase):
    """The reminder logic itself."""

    def setUp(self):
        # Start each test from a clean, predictable log.
        maintenance.reset_log()

    def tearDown(self):
        maintenance.reset_log()

    def test_every_task_is_reported(self):
        status = maintenance.get_status()
        self.assertEqual(len(status["tasks"]), len(maintenance.TASKS))

    def test_statuses_are_valid(self):
        for task in maintenance.get_status()["tasks"]:
            self.assertIn(task["status"], {"overdue", "due_soon", "ok"})

    def test_tasks_are_sorted_most_urgent_first(self):
        percents = [t["percent"] for t in maintenance.get_status()["tasks"]]
        self.assertEqual(percents, sorted(percents, reverse=True))

    def test_summary_counts_match_the_task_list(self):
        status = maintenance.get_status()
        tasks = status["tasks"]
        summary = status["summary"]

        self.assertEqual(summary["overdue"],
                         sum(1 for t in tasks if t["status"] == "overdue"))
        self.assertEqual(
            summary["overdue"] + summary["due_soon"] + summary["ok"],
            len(tasks),
        )

    def test_demo_data_produces_at_least_one_overdue_task(self):
        # With ~180 print hours logged, something should be due. If this
        # fails, the demo would show an unhelpfully empty dashboard.
        self.assertGreater(maintenance.get_status()["summary"]["overdue"], 0)


class TestMarkDone(unittest.TestCase):
    """Marking a task done should reset its countdown."""

    def setUp(self):
        maintenance.reset_log()

    def tearDown(self):
        maintenance.reset_log()

    def _find(self, status, task_id):
        return next(t for t in status["tasks"] if t["id"] == task_id)

    def test_marking_done_resets_the_task(self):
        before = self._find(maintenance.get_status(), "nozzle_check")
        self.assertEqual(before["status"], "overdue")

        after = self._find(maintenance.mark_done("nozzle_check"), "nozzle_check")

        self.assertEqual(after["status"], "ok")
        self.assertEqual(after["usage_since"]["hours_since"], 0.0)
        self.assertEqual(after["usage_since"]["prints_since"], 0)

    def test_marking_done_leaves_other_tasks_alone(self):
        before = self._find(maintenance.get_status(), "bed_level")
        maintenance.mark_done("nozzle_check")
        after = self._find(maintenance.get_status(), "bed_level")

        self.assertEqual(before["status"], after["status"])
        self.assertEqual(before["percent"], after["percent"])

    def test_completed_task_is_written_to_history(self):
        self.assertEqual(maintenance.get_history(), [])

        maintenance.mark_done("belt_tension", note="checked both belts")
        history = maintenance.get_history()

        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["task_id"], "belt_tension")
        self.assertEqual(history[0]["note"], "checked both belts")

    def test_history_is_newest_first(self):
        maintenance.mark_done("nozzle_check")
        maintenance.mark_done("bed_level")

        history = maintenance.get_history()
        self.assertEqual(history[0]["task_id"], "bed_level")

    def test_unknown_task_is_rejected(self):
        with self.assertRaises(ValueError):
            maintenance.mark_done("not_a_real_task")


if __name__ == "__main__":
    unittest.main()
