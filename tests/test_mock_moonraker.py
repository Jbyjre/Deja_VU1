"""Tests for backend/mock_moonraker.py's fleet and live simulation."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import mock_moonraker  # noqa: E402


class TestFleetSimulation(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_all()

    def tearDown(self):
        mock_moonraker.reset_all()

    def test_default_printer_is_unchanged(self):
        state = mock_moonraker.get_printer_state()
        self.assertEqual(state["state"], "printing")
        self.assertEqual(state["current_file"], "toolhead_cover.gcode")
        self.assertEqual(len(mock_moonraker.get_print_history()), 38)

    def test_printers_are_independent(self):
        with mock_moonraker.use_printer("u1-studio"):
            self.assertEqual(mock_moonraker.get_printer_state()["state"], "paused")
            mock_moonraker.resume_print()
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "printing")
        with mock_moonraker.use_printer("u1-studio"):
            self.assertEqual(mock_moonraker.get_printer_state()["state"], "printing")
        with self.assertRaises(ValueError):
            with mock_moonraker.use_printer("nope"):
                pass

    def test_heaters_settle_toward_their_target(self):
        mock_moonraker.set_target_temperature("T0", 200)
        before = mock_moonraker.get_printer_state()["toolheads"]["T0"]["temperature"]
        self.assertEqual(before, 32.5)                     # nothing happens until time passes
        mock_moonraker.advance(10)
        mid = mock_moonraker.get_printer_state()["toolheads"]["T0"]["temperature"]
        mock_moonraker.advance(200)
        end = mock_moonraker.get_printer_state()["toolheads"]["T0"]["temperature"]
        self.assertTrue(before < mid < end <= 200)
        self.assertAlmostEqual(end, 200, delta=1)

    def test_progress_moves_and_print_finishes_into_history(self):
        mock_moonraker.set_time_scale(600)
        event = None
        for _ in range(100):
            event = mock_moonraker.advance(1.0)
            if event:
                break
        self.assertEqual(event["type"], "print_finished")
        state = mock_moonraker.get_printer_state()
        self.assertEqual(state["state"], "complete")
        self.assertEqual(len(mock_moonraker.get_print_history()), 39)

    def test_toolhead_moves_while_printing(self):
        a = mock_moonraker.get_printer_state()["toolhead_position"]
        mock_moonraker.advance(0.25)
        b = mock_moonraker.get_printer_state()["toolhead_position"]
        self.assertNotEqual(a, b)

    def test_fail_next_fails_once_and_changes_nothing(self):
        mock_moonraker.fail_next("pause", "Klippy is shutdown")
        with self.assertRaises(mock_moonraker.PrinterCommandError):
            mock_moonraker.pause_print()
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "printing")
        mock_moonraker.pause_print()
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "paused")

    def test_start_needs_an_uploaded_file_and_an_idle_printer(self):
        with self.assertRaises(ValueError):
            mock_moonraker.start_print("benchy.gcode")          # busy
        mock_moonraker.cancel_print()
        with self.assertRaises(ValueError):
            mock_moonraker.start_print("never_uploaded.gcode")
        mock_moonraker.upload_file("new.gcode", 10)
        state = mock_moonraker.start_print("new.gcode", {"estimated_hours": 0.5, "layers": 20})
        self.assertEqual(state["layer"]["total"], 20)

    def test_time_scale_bounds(self):
        with self.assertRaises(ValueError):
            mock_moonraker.set_time_scale(0)
        with self.assertRaises(ValueError):
            mock_moonraker.set_time_scale(10000)


if __name__ == "__main__":
    unittest.main()
