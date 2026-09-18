"""
Tests for printer_control.py and the stateful parts of mock_moonraker.py —
pause/resume/cancel, temperature, homing, and the G-code console.

    python3 -m unittest discover tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import mock_moonraker      # noqa: E402
import printer_control     # noqa: E402


class TestPauseResumeCancel(unittest.TestCase):

    def setUp(self):
        mock_moonraker.reset_live_state()

    def tearDown(self):
        mock_moonraker.reset_live_state()

    def test_starts_printing(self):
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "printing")

    def test_pause_stops_the_print(self):
        state = printer_control.pause_print()
        self.assertEqual(state["state"], "paused")

    def test_cannot_pause_twice(self):
        printer_control.pause_print()
        with self.assertRaises(ValueError):
            printer_control.pause_print()

    def test_resume_after_pause(self):
        printer_control.pause_print()
        state = printer_control.resume_print()
        self.assertEqual(state["state"], "printing")

    def test_cannot_resume_when_not_paused(self):
        with self.assertRaises(ValueError):
            printer_control.resume_print()

    def test_cancel_clears_the_job(self):
        state = printer_control.cancel_print()
        self.assertEqual(state["state"], "ready")
        self.assertIsNone(state["current_file"])
        self.assertEqual(state["progress"], 0.0)

    def test_cannot_cancel_when_idle(self):
        printer_control.cancel_print()
        with self.assertRaises(ValueError):
            printer_control.cancel_print()

    def test_get_printer_state_returns_a_copy(self):
        # Mutating the returned dict must never leak back into live state.
        state = mock_moonraker.get_printer_state()
        state["state"] = "corrupted"
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "printing")


class TestTemperature(unittest.TestCase):

    def setUp(self):
        mock_moonraker.reset_live_state()

    def tearDown(self):
        mock_moonraker.reset_live_state()

    def test_sets_the_target(self):
        state = printer_control.set_temperature("T0", 215)
        self.assertEqual(state["toolheads"]["T0"]["target_temperature"], 215.0)

    def test_rejects_unknown_toolhead(self):
        with self.assertRaises(ValueError):
            printer_control.set_temperature("T9", 200)

    def test_rejects_out_of_range(self):
        with self.assertRaises(ValueError):
            printer_control.set_temperature("T0", 999)
        with self.assertRaises(ValueError):
            printer_control.set_temperature("T0", -5)

    def test_rejects_non_numeric(self):
        with self.assertRaises(ValueError):
            printer_control.set_temperature("T0", "hot")


class TestHomeAndGcode(unittest.TestCase):

    def setUp(self):
        mock_moonraker.reset_live_state()

    def tearDown(self):
        mock_moonraker.reset_live_state()

    def test_home_default_axes(self):
        result = printer_control.home(None)
        self.assertEqual(set(result["homed"]), {"X", "Y", "Z"})

    def test_home_rejects_unknown_axis(self):
        with self.assertRaises(ValueError):
            printer_control.home(["Q"])

    def test_gcode_round_trips(self):
        result = printer_control.send_gcode("G28")
        self.assertEqual(result["command"], "G28")

    def test_gcode_rejects_empty(self):
        with self.assertRaises(ValueError):
            printer_control.send_gcode("   ")

    def test_gcode_rejects_too_long(self):
        with self.assertRaises(ValueError):
            printer_control.send_gcode("G1 " * 100)

    def test_console_log_records_commands(self):
        printer_control.send_gcode("G28")
        printer_control.pause_print()
        log = printer_control.get_console_log()
        kinds = [entry["kind"] for entry in log]
        self.assertIn("gcode", kinds)
        self.assertIn("pause", kinds)

    def test_console_log_newest_first(self):
        printer_control.send_gcode("G1 X10")
        printer_control.send_gcode("G1 X20")
        log = printer_control.get_console_log()
        self.assertEqual(log[0]["detail"], "G1 X20")


class TestCapabilities(unittest.TestCase):

    def test_lists_all_toolheads(self):
        caps = printer_control.get_capabilities()
        self.assertEqual(caps["toolheads"], list(mock_moonraker.TOOLHEADS))

    def test_lists_actions(self):
        caps = printer_control.get_capabilities()
        for action in ("pause", "resume", "cancel", "set_temperature", "home", "gcode"):
            self.assertIn(action, caps["actions"])


if __name__ == "__main__":
    unittest.main()
