"""
The Printer page's extra readings and controls (printer_extras.py and the
printer_control functions that use it): macro settings, bed mesh, endstops,
the printer's own command list, temperature history, other fans, lights,
runout sensors and Snapmaker's automatic feeding. Real-printer answers are
checked against tests/fake_moonraker.py, shaped like Moonraker and Klipper.

    python3 -m unittest tests.test_printer_extras
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mock_moonraker      # noqa: E402
import printer_control     # noqa: E402
import printer_extras as px      # noqa: E402
from fake_moonraker import FakeMoonraker      # noqa: E402
from test_moonraker_client import fast, wait_for      # noqa: E402


class TestReadingMacros(unittest.TestCase):
    def test_settings_and_defaults_come_from_the_macro_text(self):
        text = ("{% set t = params.TEMP|default(250)|int %}\n{% if params.SOFT is defined %}\n"
                "M104 S{params['NOZZLE'] | default('0.4')}\n{rawparams}\n{params.temp}")
        self.assertEqual(px.macro_params(text), [{"name": "TEMP", "default": "250"},
                                                 {"name": "SOFT", "default": None},
                                                 {"name": "NOZZLE", "default": "0.4"}])

    def test_listed_macros_get_their_description(self):
        config = {"gcode_macro auto_feeding": {"description": "Feed", "gcode": "{params.EXTRUDER|default(999)}"},
                  "gcode_macro _HIDDEN": {"gcode": "{params.X}"}, "extruder": {"gcode": "params.Y"}}
        self.assertEqual(px.macros_from_config(config, ["AUTO_FEEDING", "MISSING"]),
                         [{"name": "AUTO_FEEDING", "description": "Feed",
                           "params": [{"name": "EXTRUDER", "default": "999"}]},
                          {"name": "MISSING", "description": None, "params": []}])

    def test_a_value_cannot_carry_a_second_command(self):
        for bad in ("1\nM112", "a b", "x;y", "", "'q'"):
            self.assertIsNone(px.PARAM_VALUE.match(bad), bad)
        for good in ("210", "-0.05", "left", "#ff0000", "1:2"):
            self.assertIsNotNone(px.PARAM_VALUE.match(good), good)


class TestShapes(unittest.TestCase):
    def test_mesh(self):
        mesh = px.mesh_from_status({"profile_name": "default", "probed_matrix": [[0.1, -0.05], [0.0, 0.02]],
                                    "mesh_min": [3, 3], "mesh_max": [267, 267], "profiles": {"default": {}, "hot": {}}})
        self.assertEqual(mesh["profiles"], ["default", "hot"])
        self.assertEqual((mesh["lowest"], mesh["highest"], mesh["range"]), (-0.05, 0.1, 0.15))
        self.assertIsNone(px.mesh_from_status({"probed_matrix": [[1, 2], [3]]})["probed"])     # ragged
        self.assertIsNone(px.mesh_from_status({"probed_matrix": [[]]})["probed"])

    def test_temperatures_endstops_help_feeding(self):
        store = {"heater_bed": {"temperatures": [20, 21], "targets": [60, 60], "powers": [1, 1]},
                 "extruder1": {"temperatures": [25.04, None], "targets": [0, 0]},
                 "temperature_sensor cavity": {"temperatures": [30.0]}}
        series = px.temperatures_from_store(store)["series"]
        self.assertEqual([s["label"] for s in series], ["T1", "Bed", "cavity"])
        self.assertEqual(series[0]["temperatures"], [25.0, None])
        self.assertIsNone(series[2]["targets"])
        self.assertEqual(px.endstops_from({"y": "open", "x": "TRIGGERED"}),
                         [{"name": "x", "triggered": True}, {"name": "y", "triggered": False}])
        self.assertEqual(px.help_from({"g28": "Home", "bad name": "x"}), {"G28": "Home"})
        self.assertEqual(px.feeding_from({"module_sequence": ["left", "right"], "channel_sequence": [1, 0]},
                                         ["T0", "T1", "T2"]),
                         [{"head": "T0", "index": 0, "module": "left", "channel": 1},
                          {"head": "T1", "index": 1, "module": "right", "channel": 0}])
        self.assertEqual(px.feeding_from({}, ["T0"]), [])


class TestSimulated(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_live_state()
        self.addCleanup(mock_moonraker.reset_live_state)
        if mock_moonraker.get_printer_state()["state"] in ("printing", "paused"):
            printer_control.cancel_print()

    def test_readings_are_labelled_demo(self):
        for kind in ("macros", "mesh", "endstops", "help", "temperatures", "feeding"):
            self.assertTrue(mock_moonraker.printer_reading(kind)["demo"], kind)

    def test_macro_settings_are_checked(self):
        printer_control.run_macro("preheat_pla", {"NOZZLE": "215", "BED": ""})
        self.assertIn("PREHEAT_PLA NOZZLE=215", printer_control.get_console_log()[0]["detail"])
        with self.assertRaisesRegex(ValueError, "doesn't read a setting called COLOUR"):
            printer_control.run_macro("PREHEAT_PLA", {"COLOUR": "red"})
        with self.assertRaisesRegex(ValueError, "one word"):
            printer_control.run_macro("PREHEAT_PLA", {"NOZZLE": "215\nM112"})

    def test_fans_lights_sensors_mesh_and_feeding(self):
        state = printer_control.set_fan_generic("cavity_fan", 40)
        self.assertEqual(state["tuning"]["fans"][0]["speed"], 0.4)
        state = printer_control.set_led("cavity_led", white=0.5)
        self.assertEqual(state["tuning"]["leds"][0]["color"], [0, 0, 0, 0.5])
        state = printer_control.set_runout("e2_filament", False)
        self.assertFalse(state["tuning"]["runout"][2]["enabled"])
        with self.assertRaisesRegex(ValueError, "doesn't list a fan"):
            printer_control.set_fan_generic("nope", 10)
        with self.assertRaisesRegex(ValueError, "on or off"):
            printer_control.set_runout("e0_filament", "yes")
        state = printer_control.mesh_profile("load", "default")
        self.assertEqual(state["tuning"]["mesh_profile"], "default")
        self.assertTrue(mock_moonraker.printer_reading("mesh")["probed"])
        with self.assertRaisesRegex(ValueError, "no saved bed mesh"):
            printer_control.mesh_profile("load", "other")
        printer_control.mesh_profile("clear")
        printer_control.feed("T2")
        self.assertIn("AUTO_FEEDING EXTRUDER=2", printer_control.get_console_log()[0]["detail"])


class TestReal(unittest.TestCase):
    def setUp(self):
        fast(self)
        self.fake = FakeMoonraker()
        self.addCleanup(self.fake.close)
        extra = {
            "bed_mesh": {"profile_name": "default", "probed_matrix": [[0.0, 0.1], [-0.1, 0.05]],
                         "mesh_min": [3.0, 3.0], "mesh_max": [267.0, 267.0], "profiles": {"default": {}}},
            # Names and kinds from Snapmaker's published U1 config (u1-klipper lava/printer.cfg)
            "fan_generic cavity_fan": {"speed": 0.0, "rpm": 0},
            "heater_fan e1_nozzle_fan": {"speed": 1.0},
            "led cavity_led": {"color_data": [[0.0, 0.0, 0.0, 1.0]]},
            "output_pin e0_heat_sw": {"value": 1.0},
            "filament_motion_sensor e0_filament": {"filament_detected": True, "enabled": True},
            "gcode_macro AUTO_FEEDING": {},
            "gcode_macro _FILAMENT_FEED_VARIABLE": {"module_sequence": ["left", "left", "right", "right"],
                                                    "channel_sequence": [1, 0, 0, 1]},
            "configfile": {"config": {"gcode_macro AUTO_FEEDING": {
                "gcode": "{% set extruder = params.EXTRUDER | default(999) | int %}"}}},
        }
        self.fake.status.update(extra)
        self.fake.objects = sorted(set(self.fake.objects) | set(extra))
        self.fake.temperature_store = {"extruder": {"temperatures": [24.9, 25.1], "targets": [0, 0]}}
        self.printer = mock_moonraker.attach_real_printer("real-x", "Test U1", self.fake.url)
        self.addCleanup(mock_moonraker.detach_real_printer, "real-x")
        self.assertTrue(wait_for(self.printer.is_connected), self.printer.diagnostics()["last_error"])
        selection = mock_moonraker.selection_only("real-x")
        selection.__enter__()
        self.addCleanup(selection.__exit__, None, None, None)

    def test_the_live_state_lists_fans_lights_pins_and_sensors(self):
        t = self.printer.snapshot()["tuning"]
        self.assertEqual([(f["id"], f["settable"]) for f in t["fans"]], [("cavity_fan", True),
                                                                          ("e1_nozzle_fan", False)])
        self.assertEqual(t["leds"], [{"id": "cavity_led", "name": "cavity led", "color": [0.0, 0.0, 0.0, 1.0]}])
        self.assertEqual(t["pins"], [{"id": "e0_heat_sw", "name": "e0 heat sw", "value": 1.0}])
        self.assertEqual(t["runout"][0]["detected"], True)
        self.assertTrue(t["feeder"])
        self.assertEqual(t["macros"], ["AUTO_FEEDING"])

    def test_readings_come_from_moonrakers_own_endpoints(self):
        self.assertEqual(mock_moonraker.printer_reading("macros")["macros"][0]["params"],
                         [{"name": "EXTRUDER", "default": "999"}])
        mesh = mock_moonraker.printer_reading("mesh")
        self.assertEqual((mesh["profile"], mesh["range"], mesh["profiles"]), ("default", 0.2, ["default"]))
        self.assertEqual(mock_moonraker.printer_reading("endstops")["endstops"][2], {"name": "z", "triggered": True})
        self.assertIn("QUERY_ENDSTOPS", mock_moonraker.printer_reading("help")["commands"])
        self.assertEqual(mock_moonraker.printer_reading("temperatures")["series"][0]["label"], "T0")
        self.assertEqual(mock_moonraker.printer_reading("feeding")["heads"][3],
                         {"head": "T3", "index": 3, "module": "right", "channel": 1})
        self.assertNotIn("demo", mesh)

    def test_commands_reach_the_printer_as_klipper_gcode(self):
        printer_control.set_fan_generic("cavity_fan", 55)
        self.assertEqual(self.fake.scripts[-1], "SET_FAN_SPEED FAN=cavity_fan SPEED=0.55")
        with self.assertRaisesRegex(ValueError, "runs by itself"):
            printer_control.set_fan_generic("e1_nozzle_fan", 55)
        printer_control.set_led("cavity_led", white=0.3)
        self.assertEqual(self.fake.scripts[-1], "SET_LED LED=cavity_led RED=0.00 GREEN=0.00 BLUE=0.00 WHITE=0.30")
        printer_control.set_runout("e0_filament", False)
        self.assertEqual(self.fake.scripts[-1], "SET_FILAMENT_SENSOR SENSOR=e0_filament ENABLE=0")
        printer_control.mesh_profile("load", "default")
        self.assertEqual(self.fake.scripts[-1], "BED_MESH_PROFILE LOAD=default")
        printer_control.feed("T1")
        self.assertEqual(self.fake.scripts[-1], "AUTO_FEEDING EXTRUDER=1")
        printer_control.run_macro("auto_feeding", {"extruder": "2"})
        self.assertEqual(self.fake.scripts[-1], "AUTO_FEEDING EXTRUDER=2")

    def test_no_store_and_no_feeder_are_said_in_words(self):
        self.fake.temperature_store = None
        with self.assertRaises(Exception):
            mock_moonraker.printer_reading("temperatures")
        with self.printer.lock:
            self.printer._extras["feeder"] = False
        self.assertIn("doesn't list", mock_moonraker.printer_reading("feeding")["none"])


if __name__ == "__main__":
    unittest.main()
