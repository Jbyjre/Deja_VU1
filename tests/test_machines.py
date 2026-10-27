"""
Other Klipper printers (backend/machines.py): the U1 stays the reference and
the default; any other printer is described only from what it reports about
itself, and the pre-flight checks it against its own size and heads.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import file_library                # noqa: E402
import gcode_tools                 # noqa: E402
import machines                    # noqa: E402
import mock_moonraker              # noqa: E402
import print_gate                  # noqa: E402
import moonraker_client as mc      # noqa: E402
from fake_moonraker import FakeMoonraker            # noqa: E402
from test_moonraker_client import fast, wait_for    # noqa: E402


def gcode(*moves, tool=None):
    lines = ["M104 S210", "M140 S60", "PRINT_START", "G28", "G90", "M83"] + ([f"T{tool}"] if tool is not None else [])
    return "\n".join(lines + list(moves)) + "\n"


class TestProfiles(unittest.TestCase):
    def test_a_klipper_printer_is_described_from_its_axis_limits(self):
        m = machines.from_klipper([-5, 0, 0, 0], [230, 235, 250, 0], 1, "cartesian", 0.4)
        self.assertEqual(machines.size_mm(m), [235, 235, 250])
        self.assertEqual((m["heads"], m["kinematics"], m["nozzle_mm"], m["reference"]), (1, "cartesian", 0.4, False))
        self.assertEqual(machines.label(m), "Klipper printer (cartesian) · 235 × 235 × 250 mm")
        self.assertIn("made for the Snapmaker U1", m["note"])

    def test_nonsense_limits_and_missing_facts_stay_unknown(self):
        for lo, hi in (([0, 0, 0], [5, 5, 5]), ([0, 0, 0], [9999, 200, 200]), (None, None), ([0, "x", 0], [1, 2, 3])):
            m = machines.from_klipper(lo, hi, 2)
            self.assertIsNone(machines.size_mm(m))
            self.assertEqual(machines.label(m), "Klipper printer · size not reported")
        self.assertIsNone(machines.from_klipper(None, None, 1, nozzle_mm=40)["nozzle_mm"])

    def test_the_u1_is_the_default_everywhere(self):
        self.assertEqual(machines.label(None), "Snapmaker U1")
        self.assertEqual(machines.size_mm(None), [270, 270, 270])
        self.assertEqual(gcode_tools.analyze(gcode("G1 X10 Y10 Z0.2 E1"))["preflight"]["checked_against"], "Snapmaker U1")


class TestPreflightPerMachine(unittest.TestCase):
    SMALL = machines.from_klipper([0, 0, 0], [235, 235, 250], 1, "cartesian")

    def test_a_file_that_fits_the_u1_can_be_too_big_for_a_smaller_printer(self):
        text = gcode("G1 X10 Y10 Z0.2 F3000", "G1 X250 Y100 E5")
        self.assertEqual(gcode_tools.analyze(text)["preflight"]["verdict"], "clear")
        pre = gcode_tools.analyze(text, machine=self.SMALL)["preflight"]
        self.assertEqual(pre["verdict"], "blocked")
        self.assertIn("outside the printer's 235 x 235 x 250 mm build volume", pre["errors"][0]["message"])
        self.assertEqual(pre["checked_against"], "Klipper printer (cartesian) · 235 × 235 × 250 mm")

    def test_a_second_head_on_a_single_head_printer_is_refused(self):
        text = gcode("G1 X10 Y10 Z0.2 E1", tool=1)
        self.assertEqual(gcode_tools.analyze(text)["preflight"]["verdict"], "clear")
        pre = gcode_tools.analyze(text, machine=self.SMALL)["preflight"]
        self.assertIn("Asks for toolhead T1; the printer has only T0", pre["errors"][0]["message"])
        self.assertNotIn("multiACE", pre["errors"][0]["message"])

    def test_an_unknown_size_is_said_not_guessed(self):
        pre = gcode_tools.analyze(gcode("G1 X900 Y10 Z0.2 E1"), machine=machines.from_klipper(None, None, 1))["preflight"]
        self.assertEqual([w["code"] for w in pre["warnings"]], ["volume_unknown"])
        self.assertEqual(pre["errors"], [])

    def test_a_negative_axis_minimum_is_inside_the_volume(self):
        m = machines.from_klipper([-10, -4, 0], [225, 231, 250], 1)
        pre = gcode_tools.analyze(gcode("G1 X-8 Y-2 Z0.2 E1"), machine=m)["preflight"]
        self.assertEqual(pre["verdict"], "clear")


class TestConfirmPrint(unittest.TestCase):
    def setUp(self):
        file_library.reset()
        mock_moonraker.reset_all()
        self.addCleanup(file_library.reset)
        file_library.save("wide.gcode", gcode("G1 X10 Y10 Z0.2 F3000", "G1 X250 Y100 E5").encode(), origin="upload")

    def test_the_gate_checks_against_the_printer_it_is_for(self):
        state = mock_moonraker.get_printer_state()
        self.assertEqual(state["machine"]["label"], "Snapmaker U1")
        self.assertFalse(any("build volume" in b for b in print_gate.summary("wide.gcode", state)["blocking"]))
        state["machine"] = machines.public(machines.from_klipper([0, 0, 0], [235, 235, 250], 4))
        blocking = print_gate.summary("wide.gcode", state)["blocking"]
        self.assertTrue(any("outside the printer's 235 x 235 x 250 mm build volume" in b for b in blocking), blocking)


class TestOverTheWire(unittest.TestCase):
    def connect(self, **fake):
        fast(self)
        self.fake = FakeMoonraker(**fake)
        self.addCleanup(self.fake.close)
        printer = mc.MoonrakerPrinter("p1", "Bench", self.fake.url)
        printer.start()
        self.addCleanup(printer.stop)
        self.assertTrue(wait_for(printer.is_connected), printer.diagnostics()["last_error"])
        return printer

    def test_a_stock_klipper_printer_reports_its_own_size_heads_and_config(self):
        printer = self.connect(u1=False, extruders=1, chamber=None, axis_maximum=(235.0, 235.0, 250.0),
                               kinematics="cartesian", nozzle_diameter=0.6)
        m = printer.snapshot()["machine"]
        self.assertEqual((m["model"], m["size_mm"], m["heads"]), ("klipper", [235.0, 235.0, 250.0], 1))
        self.assertEqual((m["kinematics"], m["nozzle_mm"], m["reference"]), ("cartesian", 0.6, False))
        self.assertEqual(sorted(printer.snapshot()["toolheads"]), ["T0"])

    def test_a_u1_stays_the_u1(self):
        m = self.connect().snapshot()["machine"]
        self.assertEqual((m["model"], m["label"], m["reference"]), ("snapmaker-u1", "Snapmaker U1", True))


if __name__ == "__main__":
    unittest.main()
