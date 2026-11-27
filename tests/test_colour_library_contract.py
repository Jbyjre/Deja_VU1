"""The firmware's calls into the Adafruit AS7341 library, checked against the library's own source.

The firmware uses the library's gain names and a few of its private helpers (the chip's saturation bit and the clear
and NIR counts come from them). A stand-in sensor can only repeat what its author remembers of the library, so this
reads the real source (version 1.2.27, 27 November 2026) and compares. It reads the file as text and never imports it.

Where the source comes from: DEJAVU_AS7341_SOURCE (the path of adafruit_as7341.py), else an installed copy of the
library. Without either the tests skip. To get it: `pip download adafruit-circuitpython-as7341 --no-deps --no-binary :all:`
and unpack the archive. The copy on a Pico is a compiled .mpy of the same file and cannot be read here.
"""

import ast
import importlib.util
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import colour_pico_sim as sim  # noqa: E402


def library_source():
    path = os.environ.get("DEJAVU_AS7341_SOURCE")
    if not path:
        try:
            spec = importlib.util.find_spec("adafruit_as7341")
        except (ImportError, ValueError):
            spec = None
        path = spec.origin if spec and spec.origin and spec.origin.endswith(".py") else None
    if path and os.path.isfile(path):
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    return None


SOURCE = library_source()


@unittest.skipUnless(SOURCE, "the AS7341 library's source is not available (see this file's docstring)")
class FirmwareMatchesTheLibrary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tree = ast.parse(SOURCE)
        cls.cls = next(n for n in cls.tree.body if isinstance(n, ast.ClassDef) and n.name == "AS7341")
        cls.members = set()
        cls.values = {}
        for node in cls.cls.body:
            if isinstance(node, ast.FunctionDef):
                cls.members.add(node.name)
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                cls.members.add(node.target.id)
                cls.values[node.target.id] = node.value
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        cls.members.add(target.id)
                        cls.values[target.id] = node.value

    def test_everything_the_firmware_touches_exists(self):
        used = ("_configure_f1_f4", "_configure_f5_f8", "_all_channels", "all_channels", "channel_clear", "channel_nir",
                "atime", "astep", "gain", "led_current", "led")
        missing = [name for name in used if name not in self.members]
        self.assertEqual(missing, [])

    def test_one_read_of_the_status_register_gives_status_then_six_counts(self):
        value = self.values["_all_channels"]
        self.assertEqual(value.func.id, "Struct")
        self.assertEqual(value.args[1].value, "<BHHHHHH")  # status, then F-channels 0 to 3, clear, NIR as 16 bits each

    def test_the_gain_names_and_register_values_are_the_ones_the_firmware_builds(self):
        rig = sim.Rig()
        self.addCleanup(rig.close)
        listed = None
        for node in ast.walk(self.tree):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "add_values"
                    and isinstance(node.func.value, ast.Name) and node.func.value.id == "Gain"):
                listed = [(item.elts[0].value, item.elts[1].value) for item in node.args[0].elts]
        self.assertIsNotNone(listed)
        wanted = [(("GAIN_%sX" % gain).replace(".", "_"), code) for code, gain in enumerate(rig.firmware.GAINS)]
        self.assertEqual(listed, wanted)

    def test_the_chip_is_opened_by_its_bus_alone_at_the_address_the_firmware_scans_for(self):
        init = next(n for n in self.cls.body if isinstance(n, ast.FunctionDef) and n.name == "__init__")
        names = [a.arg for a in init.args.args]
        self.assertEqual(names[:2], ["self", "i2c_bus"])
        self.assertIn("0x39", SOURCE.split("_AS7341_I2CADDR_DEFAULT", 1)[1].split("\n", 1)[0].lower())
        rig = sim.Rig()
        self.addCleanup(rig.close)
        self.assertEqual(rig.firmware.SENSOR_ADDRESS, 0x39)

    def test_the_two_helpers_that_read_a_bank_wait_for_fresh_data_when_they_switch_banks(self):
        # The firmware alternates the banks, so each helper must take the path that waits for the chip. In the library
        # that path calls _wait_for_data after enabling the measurement.
        for name in ("_configure_f1_f4", "_configure_f5_f8"):
            func = next(n for n in self.cls.body if isinstance(n, ast.FunctionDef) and n.name == name)
            calls = [c.func.attr for c in ast.walk(func) if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)]
            self.assertIn("_wait_for_data", calls, name)


if __name__ == "__main__":
    unittest.main()
