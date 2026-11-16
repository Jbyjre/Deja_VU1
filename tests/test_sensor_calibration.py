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
import print_gate
import printer_control
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


def seen_reading(hex_value, status="reading", source="deja-vu1"):
    """What companion_sensor.read returns for a head, trimmed to what the gate uses."""
    row = {"toolhead": "T0", "status": status, "age_s": 1.0, "detected_hex": hex_value if status == "reading" else None,
           "message": "Colour reported by the sensor." if status == "reading" else "This reading is old. Check power."}
    if status == "reading":
        row["reading"] = {"calibrated": {"hex": hex_value, "calibration_id": "dv1-abc12345", "confidence": 0.9,
                                         "source": source}}
    return row


def head_state(hex_value="#ff0000", loaded=True):
    return {"toolheads": {"T0": {"status": "ready", "filament_loaded": loaded, "filament_color_hex": hex_value,
                                 "filament_color_name": "Red", "filament_material": "PLA"}}, "extruder_map": {}}


FILE_NEEDS_RED = [{"toolhead": "T0", "expected_color_hex": "#ff0000", "expected_material": "PLA", "grams": 5}]


class ConfirmPrintEvidence(unittest.TestCase):
    """The sensor's colour sits beside the file's and the printer's, as advice that never blocks."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        patches = [mock.patch.object(color_check, "_OVERRIDES_PATH", os.path.join(folder.name, "overrides.json")),
                   mock.patch.object(mock_moonraker, "selected_printer_id", return_value="real-a"),
                   mock.patch.object(mock_moonraker, "is_real", side_effect=lambda pid: pid.startswith("real-"))]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def match(self, reading, state=None):
        with mock.patch.object(sensor, "read", return_value=reading):
            return print_gate._filament_match(FILE_NEEDS_RED, state or head_state())

    def test_a_head_with_no_sensor_shows_nothing_extra(self):
        rows, blocking, warnings = self.match(None)
        self.assertNotIn("measured", rows[0])
        self.assertEqual((blocking, warnings), ([], []))

    def test_a_sensor_that_agrees_adds_evidence_and_no_warning(self):
        rows, blocking, warnings = self.match(seen_reading("#f21010"))
        self.assertEqual(rows[0]["measured"]["versus_file"], "match")
        self.assertEqual(rows[0]["measured"]["calibration_id"], "dv1-abc12345")
        self.assertEqual(rows[0]["measured"]["advice"]["level"], "info")
        self.assertEqual((blocking, warnings), ([], []))
        self.assertEqual(rows[0]["status"], "match")          # the printer's own report still decides

    def test_a_sensor_that_disagrees_warns_and_never_blocks(self):
        rows, blocking, warnings = self.match(seen_reading("#0000ff"), head_state("#e03030"))
        self.assertEqual(blocking, [])
        self.assertEqual(rows[0]["measured"]["versus_file"], "mismatch")
        self.assertEqual(len(warnings), 2)                      # the printer's own close call, and the sensor
        self.assertIn("not as proof", warnings[-1])

    def test_when_the_printer_agrees_with_the_file_the_wrong_head_is_suggested(self):
        rows, blocking, warnings = self.match(seen_reading("#0000ff"))
        self.assertEqual(blocking, [])
        self.assertEqual(len(warnings), 1)
        self.assertIn("assigned to the right head", warnings[0])
        self.assertIn("printer reports the file's colour", warnings[0])

    def test_an_old_or_missing_reading_is_a_note_not_a_warning(self):
        rows, blocking, warnings = self.match(seen_reading(None, status="stale"))
        self.assertEqual((blocking, warnings), ([], []))
        self.assertIsNone(rows[0]["measured"]["hex"])
        self.assertIn("no current colour", rows[0]["measured"]["advice"]["text"])
        self.assertEqual(rows[0]["measured"]["advice"]["level"], "info")

    def test_a_printer_that_reports_no_colour_still_gets_the_sensors_view(self):
        state = head_state(None)
        state["toolheads"]["T0"]["filament_color_name"] = None
        rows, blocking, warnings = self.match(seen_reading("#ff0505"), state)
        self.assertEqual(rows[0]["status"], "unknown_colour")
        self.assertEqual(rows[0]["measured"]["versus_file"], "match")

    def test_a_demo_wrong_spool_gets_a_note_and_never_a_warning(self):
        state = head_state()
        state["toolheads"]["T1"] = dict(state["toolheads"]["T0"], filament_color_hex="#101010")
        required = [{"toolhead": "T1", "expected_color_hex": "#101010", "expected_material": "PLA", "grams": 5}]
        with mock.patch.object(mock_moonraker, "is_real", return_value=False):
            rows, blocking, warnings = print_gate._filament_match(required, state)
        self.assertEqual(rows[0]["measured"]["versus_file"], "mismatch")        # T1 is the demo's wrong spool
        self.assertEqual(rows[0]["measured"]["advice"]["level"], "info")
        self.assertIn("demo data", rows[0]["measured"]["advice"]["text"])
        self.assertEqual((blocking, warnings), ([], []))

    def test_demo_printers_show_a_labelled_simulation_with_no_advice(self):
        with mock.patch.object(mock_moonraker, "is_real", return_value=False):
            first = print_gate._filament_match(FILE_NEEDS_RED, head_state())
            second = print_gate._filament_match(FILE_NEEDS_RED, head_state())
        rows, blocking, warnings = first
        self.assertTrue(rows[0]["measured"]["simulated"])
        self.assertNotIn("advice", rows[0]["measured"])
        self.assertEqual((blocking, warnings), ([], []))
        self.assertEqual(first, second)                         # same file, same picture: no randomness

    def test_a_start_that_goes_ahead_against_the_sensor_is_recorded(self):
        rows, _, _ = self.match(seen_reading("#0000ff"))
        color_check.record_override("part.gcode", {"filament": rows})
        saved = color_check.overrides()["overrides"]
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]["file"], "part.gcode")
        self.assertEqual(saved[0]["heads"][0]["sensor_hex"], "#0000ff")
        self.assertEqual(saved[0]["heads"][0]["file_hex"], "#ff0000")
        self.assertEqual(saved[0]["heads"][0]["calibration_id"], "dv1-abc12345")

    def test_agreement_simulation_and_other_printers_leave_no_record(self):
        agreeing, _, _ = self.match(seen_reading("#f21010"))
        color_check.record_override("a.gcode", {"filament": agreeing})
        with mock.patch.object(mock_moonraker, "is_real", return_value=False):
            simulated, _, _ = print_gate._filament_match(FILE_NEEDS_RED, head_state())
        color_check.record_override("b.gcode", {"filament": simulated})
        self.assertEqual(color_check.overrides()["overrides"], [])
        rows, _, _ = self.match(seen_reading("#0000ff"))
        color_check.record_override("c.gcode", {"filament": rows})
        with mock.patch.object(mock_moonraker, "selected_printer_id", return_value="real-b"):
            self.assertEqual(color_check.overrides()["overrides"], [])

    def test_only_a_confirm_verdict_is_recorded_and_a_failed_note_never_stops_the_print(self):
        gate = {"verdict": "confirm", "job": {}, "filament": []}
        patches = (mock.patch.object(printer_control.file_library, "read_bytes", return_value=b""),
                   mock.patch.object(printer_control.file_library, "touch"),
                   mock.patch.object(printer_control.mock_moonraker, "upload_file"),
                   mock.patch.object(printer_control.mock_moonraker, "start_print", return_value={"state": "printing"}))
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        with mock.patch.object(printer_control.print_gate, "summary", return_value=gate), \
                mock.patch.object(color_check, "record_override") as record:
            printer_control._start_locked("x.gcode", True)
            record.assert_called_once_with("x.gcode", gate)
        with mock.patch.object(printer_control.print_gate, "summary", return_value=dict(gate, verdict="clear")), \
                mock.patch.object(color_check, "record_override") as record:
            printer_control._start_locked("x.gcode", True)
            record.assert_not_called()
        with mock.patch.object(printer_control.print_gate, "summary", return_value=gate), \
                mock.patch.object(color_check, "record_override", side_effect=OSError("disk full")):
            self.assertEqual(printer_control._start_locked("x.gcode", True), {"state": "printing"})


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
        self.assertEqual(self.request("/api/colorcheck/overrides" + self.route)[0], 403)

    def test_the_override_record_answers_empty_until_something_is_recorded(self):
        status, body = self.request("/api/colorcheck/overrides" + self.route)
        self.assertEqual((status, body["overrides"]), (200, []))


if __name__ == "__main__":
    unittest.main()
