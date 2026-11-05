"""Tests for backend/watch_only.py: the switch, what it lets through, and that demo printers stay playable."""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import mock_moonraker    # noqa: E402
import printer_control   # noqa: E402
import watch_only        # noqa: E402


class TestSwitch(unittest.TestCase):
    def setUp(self):
        watch_only.reset()
        self.addCleanup(watch_only.reset)

    def test_off_until_switched_on_and_remembered(self):
        self.assertFalse(watch_only.is_on())
        on = watch_only.set_on(True)
        self.assertTrue(on["on"])
        self.assertTrue(on["since"])
        self.assertTrue(watch_only.is_on())          # read back from the saved file
        self.assertFalse(watch_only.set_on(False)["on"])

    def test_the_start_up_setting_keeps_it_on(self):
        with mock.patch.dict(os.environ, {"DEJAVU_WATCH_ONLY": "1"}):
            self.assertTrue(watch_only.is_on())
            self.assertTrue(watch_only.status()["forced"])
            with self.assertRaises(ValueError):
                watch_only.set_on(False)

    def test_reads_pass_and_writes_are_refused(self):
        watch_only.set_on(True)
        for method, path in (("GET", "/printer/objects/list"), ("POST", "/printer/objects/query"),
                             ("POST", "/printer/emergency_stop"), ("GET", "/server/files/list?root=gcodes")):
            watch_only.check_request(method, path)
        for method, path in (("POST", "/printer/gcode/script"), ("POST", "/printer/print/start"),
                             ("POST", "/server/files/upload"), ("POST", "/printer/firmware_restart"),
                             ("DELETE", "/server/files/gcodes/a.gcode"), ("POST", "/machine/reboot")):
            with self.assertRaises(watch_only.WatchOnly):
                watch_only.check_request(method, path)
        watch_only.check_call("printer.objects.subscribe")
        watch_only.check_call("printer.emergency_stop")
        for method in ("printer.gcode.script", "printer.print.start", "machine.shutdown"):
            with self.assertRaises(watch_only.WatchOnly):
                watch_only.check_call(method)

    def test_nothing_is_refused_while_off(self):
        watch_only.check_request("POST", "/printer/gcode/script")
        watch_only.check_call("printer.gcode.script")

    def test_it_is_a_refusal_the_server_can_tell_from_a_printer_failure(self):
        self.assertTrue(issubclass(watch_only.WatchOnly, mock_moonraker.PrinterCommandError))

    def test_demo_printers_stay_playable(self):
        watch_only.set_on(True)
        mock_moonraker.reset_all()
        self.addCleanup(mock_moonraker.reset_all)
        with mock_moonraker.use_printer("u1-workshop"):
            self.assertEqual(printer_control.pause_print()["state"], "paused")


if __name__ == "__main__":
    unittest.main()
