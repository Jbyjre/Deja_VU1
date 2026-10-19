"""
Tests for printer_control.py and the stateful parts of mock_moonraker.py -
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
        printer_control.cancel_print()
        result = printer_control.home(None)
        self.assertEqual(set(result["homed"]), {"X", "Y", "Z"})

    def test_home_is_refused_mid_print(self):
        # The default printer is printing; a real G28 now would crash the head into the print.
        with self.assertRaisesRegex(ValueError, "Homing is refused"):
            printer_control.home(["X"])

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


class TestSkipOneObject(unittest.TestCase):
    """Klipper's EXCLUDE_OBJECT, with the checks Klipper itself doesn't make."""

    def setUp(self):
        mock_moonraker.reset_live_state()
        self.addCleanup(mock_moonraker.reset_live_state)
        self.names = [o["name"] for o in mock_moonraker.get_printer_state()["objects"]["list"]]

    def test_one_object_is_skipped_and_the_rest_carry_on(self):
        state = printer_control.exclude_object(self.names[0].lower())
        self.assertEqual(state["objects"]["excluded"], [self.names[0]])
        self.assertEqual(state["state"], "printing")
        mock_moonraker.advance(120)
        self.assertNotEqual(mock_moonraker.get_printer_state()["objects"]["current"], self.names[0])

    def test_refusals_are_in_words(self):
        for bad, words in (("", "Choose an object"), ("two words", "Choose an object"),
                           ('x"; M112', "Choose an object"), ("NOT_ON_THE_PLATE", "no object called")):
            with self.assertRaisesRegex(ValueError, words):
                printer_control.exclude_object(bad)
        for name in self.names[:-1]:
            printer_control.exclude_object(name)
        with self.assertRaisesRegex(ValueError, "last object"):
            printer_control.exclude_object(self.names[-1])

    def test_a_refused_command_is_reported_as_failed(self):
        mock_moonraker.fail_next("exclude")
        with self.assertRaises(mock_moonraker.PrinterCommandError):
            printer_control.exclude_object(self.names[0])
        self.assertEqual(mock_moonraker.get_printer_state()["objects"]["excluded"], [])

    def test_objects_go_when_the_print_does(self):
        printer_control.cancel_print()
        self.assertNotIn("objects", mock_moonraker.get_printer_state())
        with self.assertRaisesRegex(ValueError, "Nothing is printing"):
            printer_control.exclude_object(self.names[0])

    def test_a_started_file_brings_its_own_objects(self):
        printer_control.cancel_print()
        import gcode_tools
        text = ("EXCLUDE_OBJECT_DEFINE NAME=left CENTER=100,135 POLYGON=[[90,125],[110,125],[110,145]]\n"
                "EXCLUDE_OBJECT_DEFINE NAME=right CENTER=170,135\n")
        objects = gcode_tools.analyze(text, want_toolpath=False)["objects"]
        mock_moonraker.upload_file("two.gcode")
        state = mock_moonraker.start_print("two.gcode", {"objects": objects})
        self.assertEqual([o["name"] for o in state["objects"]["list"]], ["LEFT", "RIGHT"])
