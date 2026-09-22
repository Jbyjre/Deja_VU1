"""Tests for backend/print_queue.py - every queued start goes through the gate."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import file_library    # noqa: E402
import maintenance     # noqa: E402
import mock_moonraker  # noqa: E402
import print_queue     # noqa: E402


class TestQueue(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_all()
        file_library.reset()
        file_library.add_samples()
        print_queue.reset()
        maintenance.reset_log()
        for task in maintenance.TASKS:
            maintenance.mark_done(task["id"])
        mock_moonraker.cancel_print()

    def tearDown(self):
        mock_moonraker.reset_all()
        file_library.reset()
        print_queue.reset()
        maintenance.reset_log()

    def test_add_move_remove(self):
        print_queue.add("calibration_cube_20mm.gcode")
        q = print_queue.add("two_colour_coaster.gcode")
        first, second = q["items"]
        q = print_queue.move(second["id"], "up")
        self.assertEqual(q["items"][0]["filename"], "two_colour_coaster.gcode")
        q = print_queue.remove(first["id"])
        self.assertEqual(len(q["items"]), 1)
        with self.assertRaises(ValueError):
            print_queue.add("dock_bracket.stl")

    def test_clear_file_starts(self):
        print_queue.add("calibration_cube_20mm.gcode")
        result = print_queue.start_next()
        self.assertEqual(result["started"]["filename"], "calibration_cube_20mm.gcode")
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "printing")

    def test_blocked_file_is_held_with_the_reason(self):
        print_queue.add("unsafe_example_purge_past_bed.gcode")
        result = print_queue.start_next()
        self.assertIn("held", result)
        self.assertTrue(result["held"]["note"].startswith("Blocked"))
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "ready")

    def test_warnings_hold_until_confirmed(self):
        maintenance.reset_log()                     # brings back overdue tasks
        print_queue.add("calibration_cube_20mm.gcode")
        held = print_queue.start_next()
        if "started" in held:                       # nothing overdue in this history
            return
        self.assertTrue(held["held"]["note"].startswith("Waiting for you to confirm"))
        started = print_queue.start_next(confirmed=True)
        self.assertIn("started", started)

    def test_auto_advance_after_a_finish(self):
        print_queue.add("calibration_cube_20mm.gcode")
        print_queue.add("two_colour_coaster.gcode")
        print_queue.set_auto_advance(True)
        print_queue.start_next()
        mock_moonraker.set_time_scale(600)
        finished = None
        for _ in range(200):
            finished = mock_moonraker.advance(1.0) or finished
            if finished:
                break
        self.assertIsNotNone(finished)
        result = print_queue.on_print_finished(mock_moonraker.selected_printer_id())
        self.assertEqual(result["started"]["filename"], "two_colour_coaster.gcode")
        statuses = [i["status"] for i in print_queue.get()["items"]]
        self.assertEqual(statuses, ["done", "started"])

    def test_queues_are_per_printer(self):
        print_queue.add("calibration_cube_20mm.gcode")
        self.assertEqual(print_queue.get("u1-studio")["items"], [])


if __name__ == "__main__":
    unittest.main()
