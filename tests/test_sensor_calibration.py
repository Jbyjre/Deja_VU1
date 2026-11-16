"""Calibration turns raw sensor counts into a colour from a recorded white reference.

These tests use synthetic counts. They check the arithmetic and the rules (what is refused, what is
invalidated), not how accurate a physical sensor is: that needs bench readings on known colours.
"""

import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import color_check
import companion_sensor as sensor
import mock_moonraker
import modules
import sensor_calibration as cal
from tests.test_real_printer import RealPrinterAPI

BANDS = [name for name, _ in cal.AS7341_BANDS]
ORANGE = [0.03, 0.03, 0.04, 0.06, 0.15, 0.55, 0.85, 0.9]
BLUE = [0.35, 0.6, 0.55, 0.3, 0.1, 0.05, 0.04, 0.04]


def counts(ratio, offset=0.0):
    """Raw AS7341 counts for a sample reflecting `ratio` of the light in each band (1000 = the white target)."""
    if isinstance(ratio, (int, float)):
        ratio = [ratio] * len(BANDS)
    return {name: 1000.0 * value + offset for name, value in zip(BANDS, ratio)}


def channels(rgb):
    return dict(zip(("r", "g", "b"), rgb))


def binding(head="T0", channel="inlet-0", sensor_id="as7341-1", model="AS7341"):
    return {"toolhead": head, "device_id": "pico-1", "channel_id": channel,
            "sensor_id": sensor_id, "sensor_model": model}


def sample(now, raw, flags=None, claim=None, sensor_id="as7341-1", model="AS7341"):
    return {"version": 1, "simulated": False, "device_id": "pico-1", "channel_id": "inlet-0",
            "sensor_id": sensor_id, "sensor_model": model, "captured_at": now, "raw": raw,
            "quality_flags": flags or [], "calibrated": claim}


def configuration(rows=None):
    return {"version": 1, "simulated": False, "bindings": rows if rows is not None else [binding()]}


def rgb_of(hex_value):
    return tuple(int(hex_value[i:i + 2], 16) for i in (1, 3, 5))


class ColourMaths(unittest.TestCase):
    def test_the_white_target_is_white(self):
        self.assertEqual(cal.colour_from("AS7341", counts(1), None, counts(1)), ("#ffffff", []))

    def test_flat_reflectance_gives_the_standard_srgb_greys(self):
        # Half the light back is 0.5 linear: sRGB 188 (#bc). 18 % is the photographer's grey card: 118 (#76).
        self.assertEqual(cal.colour_from("AS7341", counts(1), None, counts(0.5))[0], "#bcbcbc")
        self.assertEqual(cal.colour_from("AS7341", counts(1), None, counts(0.18))[0], "#767676")

    def test_orange_and_blue_spectra_come_out_orange_and_blue(self):
        red, green, blue = rgb_of(cal.colour_from("AS7341", counts(1), None, counts(ORANGE))[0])
        self.assertTrue(red > green > blue, (red, green, blue))
        red, green, blue = rgb_of(cal.colour_from("AS7341", counts(1), None, counts(BLUE))[0])
        self.assertTrue(blue > green > red, (red, green, blue))

    def test_a_recorded_dark_offset_is_removed(self):
        plain = cal.colour_from("AS7341", counts(1), None, counts(ORANGE))[0]
        offset = cal.colour_from("AS7341", counts(1, 50), counts(0, 50), counts(ORANGE, 50))[0]
        self.assertEqual(plain, offset)

    def test_the_three_colour_sensor_uses_its_red_green_and_blue_directly(self):
        white = channels((800, 900, 700))
        self.assertEqual(cal.colour_from("TCS34725", white, None, channels((400, 450, 350)))[0], "#bcbcbc")
        self.assertEqual(cal.colour_from("TCS34725", white, None, channels((800, 0, 0)))[0], "#ff0000")

    def test_a_sample_far_brighter_than_white_is_flagged_not_trusted(self):
        colour, flags = cal.colour_from("AS7341", counts(1), None, counts(2.0))
        self.assertEqual(flags, ["above_white"])
        self.assertEqual(colour, "#ffffff")

    def test_missing_channels_and_a_dim_white_are_refused_in_words(self):
        incomplete = counts(1)
        del incomplete["f3"]
        with self.assertRaisesRegex(ValueError, "missing channels: f3"):
            cal.colour_from("AS7341", counts(1), None, incomplete)
        with self.assertRaisesRegex(ValueError, "not brighter than the dark one on f1"):
            cal.colour_from("AS7341", counts(1, 0), counts(1, 0), counts(0.5))

    def test_an_unsupported_sensor_is_refused(self):
        with self.assertRaisesRegex(ValueError, "AS7341 and the TCS34725"):
            cal.colour_from("VEML6040", {}, None, {})

    def test_the_conversion_constants_agree_with_each_other(self):
        white = [sum(cal._XYZ_TO_RGB[row][axis] * cal._D65_WHITE[axis] for axis in range(3)) for row in range(3)]
        for value in white:
            self.assertAlmostEqual(value, 1.0, places=3)


class CalibrationFlow(unittest.TestCase):
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
        self.now = 1000
        self.clock(1000)
        sensor.configure(configuration())

    def clock(self, now):
        self.now = now
        sensor.time.time.return_value = now
        sensor.time.monotonic.return_value = now - 950

    def send(self, raw, **extra):
        return sensor.ingest(sample(self.now, raw, **extra))

    def head(self):
        return sensor.read("T0")

    def record_white(self):
        self.send(counts(1))
        return color_check.calibrate("T0", "white")

    def test_raw_counts_without_a_reference_stay_uncalibrated(self):
        self.send(counts(ORANGE))
        self.assertEqual(self.head()["status"], "uncalibrated")
        self.assertIsNone(self.head()["detected_hex"])
        self.assertEqual(self.head()["calibration"]["state"], "none")

    def test_a_white_reference_turns_later_counts_into_a_colour_with_provenance(self):
        state = self.record_white()
        self.assertEqual(state["state"], "ready")
        self.assertTrue(state["id"].startswith("dv1-"))
        self.clock(1001)
        self.send(counts(ORANGE))
        head = self.head()
        self.assertEqual(head["status"], "reading")
        self.assertEqual(head["detected_hex"], cal.colour_from("AS7341", counts(1), None, counts(ORANGE))[0])
        self.assertEqual(head["reading"]["calibrated"]["source"], "deja-vu1")
        self.assertEqual(head["reading"]["calibrated"]["calibration_id"], state["id"])
        self.assertEqual(head["calibration"]["state"], "ready")

    def test_a_colour_the_companion_reports_is_left_alone(self):
        self.record_white()
        self.clock(1001)
        claim = {"hex": "#112233", "calibration_id": "device-own", "confidence": 0.95}
        self.send(counts(ORANGE), claim=claim)
        self.assertEqual(self.head()["detected_hex"], "#112233")
        self.assertNotIn("source", self.head()["reading"]["calibrated"])

    def test_a_dark_reference_alone_is_not_a_calibration(self):
        self.send(counts(0, 40))
        state = color_check.calibrate("T0", "dark")
        self.assertEqual(state["state"], "needs_white")
        self.clock(1001)
        self.send(counts(ORANGE, 40))
        self.assertEqual(self.head()["status"], "uncalibrated")

    def test_dark_then_white_removes_the_offset_from_later_samples(self):
        self.send(counts(0, 40))
        color_check.calibrate("T0", "dark")
        self.clock(1001)
        self.send(counts(1, 40))
        self.assertEqual(color_check.calibrate("T0", "white")["state"], "ready")
        self.clock(1002)
        self.send(counts(ORANGE, 40))
        self.assertEqual(self.head()["detected_hex"], cal.colour_from("AS7341", counts(1), None, counts(ORANGE))[0])

    def test_a_dark_reference_brighter_than_white_is_refused_and_not_kept(self):
        self.record_white()
        self.clock(1001)
        self.send(counts(1.5))
        with self.assertRaisesRegex(ValueError, "not brighter than the dark one"):
            color_check.calibrate("T0", "dark")
        self.assertFalse(self.head()["calibration"]["has_dark"])
        self.assertEqual(self.head()["calibration"]["state"], "ready")

    def test_a_reference_needs_a_fresh_clean_reading(self):
        self.send(counts(1))
        self.clock(1010)
        with self.assertRaisesRegex(ValueError, "new reading"):
            color_check.calibrate("T0", "white")
        self.send(counts(1), flags=["saturated"])
        with self.assertRaisesRegex(ValueError, "saturated"):
            color_check.calibrate("T0", "white")
        self.assertEqual(self.head()["calibration"]["state"], "none")

    def test_replacing_the_chip_moving_the_channel_or_removing_it_drops_the_calibration(self):
        for rows in ([binding(sensor_id="as7341-2")], [binding(channel="inlet-1")], []):
            with self.subTest(rows=rows):
                sensor.configure(configuration())
                self.clock(self.now + 10)
                self.record_white()
                self.assertNotEqual(cal._load(), {})
                sensor.configure(configuration(rows))
                self.assertEqual(cal._load(), {})
                sensor.configure(configuration())
                self.assertEqual(self.head()["calibration"]["state"], "none")

    def test_saving_the_same_assignment_keeps_the_calibration(self):
        state = self.record_white()
        sensor.configure(configuration())
        self.assertEqual(self.head()["calibration"]["id"], state["id"])

    def test_clearing_forgets_both_references(self):
        self.record_white()
        self.clock(1001)
        self.send(counts(0))
        color_check.calibrate("T0", "dark")
        self.assertEqual(color_check.calibrate("T0", "clear")["state"], "none")
        self.assertEqual(cal._load(), {})

    def test_a_sample_much_brighter_than_the_white_target_is_low_confidence(self):
        self.record_white()
        self.clock(1001)
        self.send(counts(2.0))
        self.assertEqual(self.head()["status"], "low_confidence")
        self.assertIsNone(self.head()["detected_hex"])

    def test_the_calibration_id_changes_when_a_reference_is_retaken(self):
        first = self.record_white()["id"]
        self.clock(1001)
        self.send(counts(1.1))
        self.assertNotEqual(color_check.calibrate("T0", "white")["id"], first)

    def test_a_sensor_this_module_cannot_calibrate_is_refused(self):
        sensor.configure(configuration([binding(model="VEML6040", sensor_id="x-1")]))
        self.send(counts(1), model="VEML6040", sensor_id="x-1")
        self.assertEqual(self.head()["calibration"]["state"], "unsupported")
        with self.assertRaisesRegex(ValueError, "AS7341 and the TCS34725"):
            color_check.calibrate("T0", "white")

    def test_a_head_with_no_sensor_and_a_demo_printer_are_refused(self):
        with self.assertRaisesRegex(ValueError, "No colour sensor is assigned to head T2"):
            color_check.calibrate("T2", "white")
        with mock.patch.object(mock_moonraker, "is_real", return_value=False):
            with self.assertRaisesRegex(ValueError, "demo printers have none"):
                color_check.calibrate("T0", "white")

    def test_an_unknown_step_is_refused(self):
        self.send(counts(1))
        with self.assertRaisesRegex(ValueError, "white, dark or clear"):
            color_check.calibrate("T0", "grey")

    def test_the_colour_three_sensor_calibrates_from_red_green_and_blue(self):
        sensor.configure(configuration([binding(model="TCS34725", sensor_id="tcs-1")]))
        self.send(channels((800, 900, 700)), model="TCS34725", sensor_id="tcs-1")
        self.assertEqual(color_check.calibrate("T0", "white")["state"], "ready")
        self.clock(1001)
        self.send(channels((400, 450, 350)), model="TCS34725", sensor_id="tcs-1")
        self.assertEqual(self.head()["detected_hex"], "#bcbcbc")


class CalibrationAPI(RealPrinterAPI):
    def setUp(self):
        super().setUp()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        for patch in (mock.patch.object(sensor, "_PATH", os.path.join(folder.name, "sensors.json")),
                      mock.patch.object(cal, "_PATH", os.path.join(folder.name, "calibrations.json")),
                      mock.patch.object(sensor, "_readings", {})):
            patch.start()
            self.addCleanup(patch.stop)
        modules.set_enabled("color_check", True)
        self.route = "?printer=" + self.pid
        self.request("/api/colorcheck/sensors" + self.route, configuration())

    def send(self, raw):
        return self.request("/api/colorcheck/readings" + self.route, sample(time.time(), raw))

    def test_record_a_white_reference_then_read_a_colour_over_http(self):
        self.assertEqual(self.send(counts(1))[0], 200)
        status, state = self.request("/api/colorcheck/calibration" + self.route, {"toolhead": "T0", "step": "white"})
        self.assertEqual((status, state["state"]), (200, "ready"), state)
        self.assertEqual(self.send(counts(ORANGE))[0], 200)
        _, body = self.request("/api/colorcheck/sensors" + self.route)
        head = body["sensors"][0]
        self.assertEqual(head["status"], "reading")
        self.assertEqual(head["calibration"]["state"], "ready")
        self.assertEqual(head["reading"]["calibrated"]["source"], "deja-vu1")

    def test_refusals_answer_400_in_words(self):
        status, body = self.request("/api/colorcheck/calibration" + self.route, {"toolhead": "T0", "step": "white"})
        self.assertEqual(status, 400)
        self.assertIn("new reading", body["error"])
        status, body = self.request("/api/colorcheck/calibration" + self.route, {"toolhead": "T3", "step": "white"})
        self.assertEqual(status, 400)
        self.assertIn("No colour sensor is assigned to head T3", body["error"])

    def test_the_route_respects_the_module_switch(self):
        modules.set_enabled("color_check", False)
        self.assertEqual(self.request("/api/colorcheck/calibration" + self.route, {"toolhead": "T0"})[0], 403)


if __name__ == "__main__":
    unittest.main()
