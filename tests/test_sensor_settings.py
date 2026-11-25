"""A calibration belongs to the sensor settings it was recorded at (gain, light, integration time).

Synthetic counts again: these tests check the rules, not how close a physical sensor comes to a spool's colour.
"""

import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import color_check
import companion_sensor as sensor
import mock_moonraker
import sensor_calibration as cal

BANDS = [name for name, _ in cal.AS7341_BANDS]
ORANGE = [0.03, 0.03, 0.04, 0.06, 0.15, 0.55, 0.85, 0.9]
SETTINGS = {"gain": 16, "led_ma": 10, "led": True, "atime": 100, "astep": 999, "average": 3, "full_scale": 65535}


def counts(ratio):
    if isinstance(ratio, (int, float)):
        ratio = [ratio] * len(BANDS)
    return {name: 1000.0 * value for name, value in zip(BANDS, ratio)}


def binding():
    return {"toolhead": "T0", "device_id": "pico-1", "channel_id": "inlet-0",
            "sensor_id": "as7341-1", "sensor_model": "AS7341"}


class Settings(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        for patch in (mock.patch.object(sensor, "_PATH", os.path.join(folder.name, "sensors.json")),
                      mock.patch.object(cal, "_PATH", os.path.join(folder.name, "calibrations.json")),
                      mock.patch.object(sensor, "_readings", {}),
                      mock.patch.object(sensor, "time"),
                      mock.patch.object(mock_moonraker, "selected_printer_id", return_value="real-a"),
                      mock.patch.object(mock_moonraker, "is_real", side_effect=lambda pid: pid.startswith("real-"))):
            patch.start()
            self.addCleanup(patch.stop)
        self.clock(1000)
        sensor.configure({"version": 1, "simulated": False, "bindings": [binding()]})

    def clock(self, now):
        self.now = now
        sensor.time.time.return_value = now
        sensor.time.monotonic.return_value = now - 950

    def send(self, raw, settings=SETTINGS, flags=None, advance=True):
        if advance:
            self.clock(self.now + 1)
        body = {"version": 1, "simulated": False, "device_id": "pico-1", "channel_id": "inlet-0",
                "sensor_id": "as7341-1", "sensor_model": "AS7341", "captured_at": self.now, "raw": raw,
                "quality_flags": flags or [], "calibrated": None}
        if settings is not None:
            body["settings"] = settings
        return sensor.ingest(body)

    def head(self):
        return sensor.read("T0")

    def record(self, step, ratio, **extra):
        self.send(counts(ratio), **extra)
        return color_check.calibrate("T0", step)

    def test_settings_are_kept_with_the_reading_and_checked(self):
        self.send(counts(1))
        self.assertEqual(self.head()["reading"]["settings"], SETTINGS)
        self.send(counts(1), settings=None)
        self.assertIsNone(self.head()["reading"]["settings"])
        for bad in ("gain 16", ["gain"], {"gain": "16"}, {"gain": float("nan")}, {"bad name": 1},
                    {str(i): i for i in range(17)}):
            with self.assertRaises(ValueError, msg=repr(bad)):
                self.send(counts(1), settings=bad)

    def test_a_colour_needs_the_settings_the_white_reference_was_taken_at(self):
        self.assertEqual(self.record("white", 1)["state"], "ready")
        self.send(counts(ORANGE))
        self.assertEqual(self.head()["status"], "reading")
        self.send(counts(ORANGE), settings=dict(SETTINGS, gain=64))
        head = self.head()
        self.assertEqual(head["status"], "uncalibrated")
        self.assertIsNone(head["detected_hex"])
        self.assertEqual(head["calibration"]["state"], "settings_changed")
        self.assertIn("gain 16", head["message"])
        self.assertIn("gain 64", head["message"])
        self.assertIn("Record the white reference again", head["message"])
        self.send(counts(ORANGE))  # back to the old settings
        self.assertEqual(self.head()["status"], "reading")
        self.assertEqual(self.head()["calibration"]["state"], "ready")

    def test_the_light_counts_and_the_averaging_does_not(self):
        self.record("white", 1)
        self.send(counts(ORANGE), settings=dict(SETTINGS, average=1))
        self.assertEqual(self.head()["status"], "reading")
        self.send(counts(ORANGE), settings=dict(SETTINGS, led_ma=12))
        self.assertEqual(self.head()["status"], "uncalibrated")
        self.assertIn("light 12 mA", self.head()["message"])
        self.send(counts(ORANGE), settings=dict(SETTINGS, led=False))
        self.assertIn("light off", self.head()["message"])

    def test_a_companion_that_reports_no_settings_calibrates_as_before(self):
        self.assertEqual(self.record("white", 1, settings=None)["state"], "ready")
        self.send(counts(ORANGE), settings=None)
        self.assertEqual(self.head()["status"], "reading")
        self.send(counts(ORANGE))  # now it reports settings the white reference never had
        self.assertEqual(self.head()["calibration"]["state"], "settings_changed")

    def test_a_dark_reference_must_match_the_white_one(self):
        self.record("white", 1)
        with self.assertRaises(ValueError) as caught:
            self.record("dark", 0.02, settings=dict(SETTINGS, gain=32))
        self.assertIn("gain 16", str(caught.exception))
        self.assertIn("gain 32", str(caught.exception))
        self.assertFalse(self.head()["calibration"]["has_dark"])
        self.assertTrue(self.record("dark", 0.02)["has_dark"])

    def test_a_new_white_reference_at_other_settings_drops_the_old_dark_one(self):
        self.record("white", 1)
        self.record("dark", 0.02)
        state = self.record("white", 1, settings=dict(SETTINGS, gain=32))
        self.assertEqual((state["state"], state["has_dark"]), ("ready", False))

    def test_the_calibration_id_follows_the_settings(self):
        first = self.record("white", 1)["id"]
        second = self.record("white", 1, settings=dict(SETTINGS, gain=32))["id"]
        self.assertNotEqual(first, second)

    def test_an_empty_housing_is_dim_on_purpose_so_the_dark_step_accepts_low_light_only(self):
        self.record("white", 1)
        self.assertTrue(self.record("dark", 0.01, flags=["low_light"])["has_dark"])
        with self.assertRaises(ValueError):
            self.record("dark", 0.01, flags=["saturated"])
        with self.assertRaises(ValueError):
            self.record("dark", 0.01, flags=["unstable"])
        with self.assertRaises(ValueError):
            self.record("white", 1, flags=["low_light"])

    def test_the_status_names_the_computers_clock_so_a_page_can_line_up_with_it(self):
        self.assertEqual(sensor.status()["server_time"], self.now)
        sensor.time.time.return_value = 1234.9
        self.assertEqual(sensor.status()["server_time"], 1234)  # whole seconds, so a CircuitPython float is not needed


if __name__ == "__main__":
    unittest.main()
