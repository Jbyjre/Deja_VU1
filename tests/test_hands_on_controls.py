"""
The hands-on controls on the printer page (printer_control.jog and the rest):
each value is checked before any G-code, motion waits for an idle printer,
tuning works mid-print, and the simulated and real paths agree.

    python3 -m unittest tests.test_hands_on_controls
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mock_moonraker      # noqa: E402
import moonraker_client as mc      # noqa: E402
import printer_control     # noqa: E402
from fake_moonraker import FakeMoonraker      # noqa: E402
from test_moonraker_client import fast, wait_for      # noqa: E402


class TestSimulated(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_live_state()
        self.addCleanup(mock_moonraker.reset_live_state)

    def idle(self):
        if mock_moonraker.get_printer_state()["state"] in ("printing", "paused"):
            printer_control.cancel_print()

    def test_motion_waits_for_the_print(self):
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "printing")
        for call in (lambda: printer_control.jog("X", 10), lambda: printer_control.move_to(x=10),
                     printer_control.motors_off, printer_control.bed_mesh, lambda: printer_control.pick_up("T1")):
            with self.assertRaises(ValueError):
                call()

    def test_tuning_works_mid_print(self):
        state = printer_control.set_factor("speed", 150)
        self.assertEqual(state["tuning"]["speed_factor"], 1.5)
        state = printer_control.set_factor("flow", 95)
        self.assertEqual(state["tuning"]["extrude_factor"], 0.95)
        state = printer_control.set_fan(50)
        self.assertEqual(state["tuning"]["part_fan"], 0.5)
        state = printer_control.set_pressure_advance("T2", 0.05, 0.03)
        self.assertEqual(state["toolheads"]["T2"]["pressure_advance"], 0.05)
        state = printer_control.z_nudge(-0.025)
        self.assertEqual(state["tuning"]["z_offset"], -0.025)

    def test_a_jog_moves_and_stays_inside_the_printer(self):
        self.idle()
        start = mock_moonraker.get_printer_state()["toolhead_position"]
        state = printer_control.jog("X", 10)
        self.assertEqual(state["toolhead_position"][0], start[0] + 10)
        with self.assertRaises(ValueError):
            printer_control.jog("X", 100)
            printer_control.jog("X", 100)      # 135 + 10 + 200 is past 270
        with self.assertRaises(ValueError):
            printer_control.jog("X", 7)        # not one of the step sizes
        with self.assertRaises(ValueError):
            printer_control.move_to(x=300)     # past the printer's own edge

    def test_unhomed_axes_must_be_homed_first(self):
        self.idle()
        printer_control.motors_off()
        with self.assertRaises(ValueError) as caught:
            printer_control.jog("Z", 1)
        self.assertIn("Home Z first", str(caught.exception))

    def test_values_are_checked(self):
        for call in (lambda: printer_control.set_factor("speed", 900), lambda: printer_control.set_fan(150),
                     lambda: printer_control.set_pressure_advance("T0", 3), lambda: printer_control.z_nudge(2),
                     lambda: printer_control.extrude(500), lambda: printer_control.run_macro("RM -RF"),
                     lambda: printer_control.run_macro("NOT_LISTED")):
            with self.assertRaises(ValueError):
                call()

    def test_extrude_needs_a_hot_active_head_and_no_running_print(self):
        with self.assertRaises(ValueError):
            printer_control.extrude(10)       # printing
        printer_control.pause_print()
        state = printer_control.extrude(5)    # paused, hot head: purging is fine
        self.assertTrue(state)

    def test_macros_and_estop(self):
        self.idle()
        macro = mock_moonraker.get_printer_state()["tuning"]["macros"][0]
        printer_control.run_macro(macro.lower())
        result = printer_control.emergency_stop()
        self.assertIn("Emergency stop", result["response"])
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "error")


class TestReal(unittest.TestCase):
    def setUp(self):
        fast(self)
        self.fake = FakeMoonraker()
        self.addCleanup(self.fake.close)
        self.fake.objects = sorted(set(self.fake.objects) | {"fan", "idle_timeout", "bed_mesh",
                                                              "gcode_macro AUTO_FEED", "gcode_macro _HIDDEN",
                                                              "heater_fan hotend_fan", "temperature_sensor mcu_temp"})
        self.fake.status.setdefault("fan", {"speed": 0.25, "rpm": 3000})
        self.fake.status.setdefault("idle_timeout", {"state": "Ready"})
        self.fake.status.setdefault("bed_mesh", {"profile_name": "default"})
        self.fake.status.setdefault("heater_fan hotend_fan", {"speed": 1.0})
        self.fake.status.setdefault("temperature_sensor mcu_temp", {"temperature": 41.5})
        self.printer = mc.MoonrakerPrinter("p1", "Test U1", self.fake.url)
        self.printer.start()
        self.addCleanup(self.printer.stop)
        self.assertTrue(wait_for(self.printer.is_connected), self.printer.diagnostics()["last_error"])

    def test_the_printers_own_readings_and_buttons_come_through(self):
        tuning = self.printer.snapshot()["tuning"]
        self.assertEqual(tuning["part_fan"], 0.25)
        self.assertEqual(tuning["macros"], ["AUTO_FEED"])          # underscore macros stay hidden
        self.assertTrue(tuning["bed_mesh"])
        self.assertEqual(tuning["mesh_profile"], "default")
        self.assertEqual(tuning["fans"][0]["name"], "hotend fan")
        self.assertEqual(tuning["sensors"][0], {"name": "mcu temp", "temperature": 41.5})

    def test_commands_reach_the_printer_as_klipper_gcode(self):
        self.printer.tune("speed", "M220 S120")
        self.assertEqual(self.fake.scripts[-1], "M220 S120")
        self.printer.tune("jog", "G91\nG1 X10 F6000\nG90")
        self.assertEqual(self.fake.scripts[-1], "G91\nG1 X10 F6000\nG90")


if __name__ == "__main__":
    unittest.main()
