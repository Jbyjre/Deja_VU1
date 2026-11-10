"""Synthetic companion messages test the contract, not physical colour accuracy."""

import json
import os
import sys
import tempfile
import unittest
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import color_check
import companion_sensor as sensor
import fleet
import mock_moonraker
import modules
import pairing
from tests.test_real_printer import RealPrinterAPI


def binding(head="T0", channel="inlet-0", device="pico-1"):
    return {"toolhead": head, "device_id": device, "channel_id": channel,
            "sensor_id": "as7341-1", "sensor_model": "AS7341"}


def message(now=1000):
    return {"version": 1, "simulated": False, "device_id": "pico-1", "channel_id": "inlet-0",
            "sensor_id": "as7341-1", "sensor_model": "AS7341", "captured_at": now,
            "raw": {"f1": 100, "clear": 200}, "quality_flags": [],
            "calibrated": {"hex": "#F26A1B", "calibration_id": "white-dark-1", "confidence": 0.95}}


def configuration(rows=None):
    return {"version": 1, "simulated": False, "bindings": rows if rows is not None else [binding()]}


class CompanionContract(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        for patch in (mock.patch.object(sensor, "_PATH", os.path.join(folder.name, "sensors.json")),
                      mock.patch.object(sensor, "_readings", {}),
                      mock.patch.object(sensor, "time"),
                      mock.patch.object(mock_moonraker, "selected_printer_id", return_value="real-a"),
                      mock.patch.object(mock_moonraker, "is_real", side_effect=lambda pid: pid.startswith("real-"))):
            patch.start()
            self.addCleanup(patch.stop)
        sensor.time.time.return_value = 1000
        sensor.time.monotonic.return_value = 50
        sensor.configure(configuration())

    def current(self):
        return sensor.read("T0")

    def test_no_sample_is_not_a_measurement(self):
        self.assertEqual(self.current()["status"], "no_reading")
        self.assertIsNone(self.current()["detected_hex"])
        self.assertFalse(color_check.connect_sensor("T0"))

    def test_raw_channels_are_preserved_without_inventing_colour(self):
        body = message()
        body["calibrated"] = None
        sensor.ingest(body)
        self.assertEqual(self.current()["status"], "uncalibrated")
        self.assertEqual(self.current()["reading"]["raw"], body["raw"])
        self.assertIsNone(self.current()["detected_hex"])

    def test_current_colour_keeps_device_and_calibration_provenance(self):
        accepted = sensor.ingest(message())
        self.assertEqual((accepted["printer_id"], accepted["toolhead"]), ("real-a", "T0"))
        current = self.current()
        self.assertEqual(current["detected_hex"], "#f26a1b")
        self.assertEqual(current["reading"]["calibrated"]["calibration_id"], "white-dark-1")
        self.assertEqual(current["reading"]["received_at"], 1000)
        self.assertFalse(current["simulated"])
        self.assertTrue(color_check.connect_sensor("T0"))

    def test_old_sample_expires_at_boundary_and_hides_colour(self):
        sensor.ingest(message())
        sensor.time.time.return_value = 1030
        self.assertEqual(self.current()["status"], "stale")
        self.assertIsNone(self.current()["detected_hex"])
        self.assertFalse(color_check.connect_sensor("T0"))
        self.assertEqual(self.current()["reading"]["calibrated"]["hex"], "#f26a1b")

    def test_delayed_delivery_and_replay_cannot_renew_freshness(self):
        sensor.ingest(message(900))
        self.assertEqual(self.current()["status"], "stale")
        for captured in (900, 899):
            with self.assertRaises(ValueError):
                sensor.ingest(message(captured))
        sensor.ingest(message(1000))
        self.assertEqual(self.current()["status"], "reading")

    def test_wall_clock_going_back_cannot_keep_sample_current(self):
        sensor.ingest(message())
        sensor.time.time.return_value = 950
        sensor.time.monotonic.return_value = 80
        self.assertEqual(self.current()["status"], "stale")

    def test_future_samples_do_not_replace_a_good_reading(self):
        sensor.ingest(message())
        with self.assertRaises(ValueError):
            sensor.ingest(message(1010))
        self.assertEqual(self.current()["reading"]["captured_at"], 1000)

    def test_low_quality_and_unknown_flags_never_show_a_current_colour(self):
        for flag in ("low_light", "saturated", "unsupported_sample", "future_flag"):
            with self.subTest(flag=flag):
                body = message(1000 + (0.1 * len(flag)))
                sensor.configure(configuration())
                body["quality_flags"] = [flag]
                sensor.ingest(body)
                self.assertEqual(self.current()["status"], "unreadable")
                self.assertIsNone(self.current()["detected_hex"])

    def test_low_confidence_is_not_a_match(self):
        body = message()
        body["calibrated"]["confidence"] = 0.79
        sensor.ingest(body)
        self.assertEqual(self.current()["status"], "low_confidence")
        self.assertIsNone(self.current()["detected_hex"])

    def test_wrong_device_channel_sensor_or_model_is_refused(self):
        for field in ("device_id", "channel_id", "sensor_id", "sensor_model"):
            with self.subTest(field=field):
                body = message()
                body[field] = "replacement"
                with self.assertRaises(ValueError):
                    sensor.ingest(body)
        self.assertEqual(self.current()["status"], "no_reading")

    def test_reassigning_or_removing_sensor_discards_previous_reading(self):
        sensor.ingest(message())
        sensor.configure(configuration([binding("T1")]))
        self.assertIsNone(self.current())
        self.assertEqual(sensor.read("T1")["status"], "no_reading")
        sensor.configure(configuration([]))
        with self.assertRaises(ValueError):
            sensor.ingest(message())

    def test_printers_cannot_share_the_same_sensor_channel(self):
        sensor.ingest(message())
        with mock.patch.object(mock_moonraker, "selected_printer_id", return_value="real-b"):
            with self.assertRaises(ValueError):
                sensor.configure(configuration())
            self.assertIsNone(self.current())
            with self.assertRaises(ValueError):
                sensor.ingest(message())
        self.assertEqual(self.current()["status"], "reading")

    def test_distinct_channels_on_one_hub_stay_separate(self):
        sensor.configure(configuration([binding(), binding("T1", "inlet-1")]))
        sensor.ingest(message())
        self.assertEqual(sensor.read("T1")["status"], "no_reading")

    def test_deleted_printer_does_not_reserve_a_sensor_channel_forever(self):
        sensor.ingest(message())
        with mock.patch.object(mock_moonraker, "selected_printer_id", return_value="real-b"), \
                mock.patch.object(mock_moonraker, "is_real", side_effect=lambda pid: pid == "real-b"), \
                mock.patch.object(fleet, "registered", return_value=[]):
            sensor.configure(configuration())
            self.assertEqual(self.current()["status"], "no_reading")
        self.assertNotIn("real-a", sensor._readings)

    def test_offline_registered_printer_keeps_its_sensor_assignment(self):
        with mock.patch.object(mock_moonraker, "selected_printer_id", return_value="real-b"), \
                mock.patch.object(mock_moonraker, "is_real", side_effect=lambda pid: pid == "real-b"), \
                mock.patch.object(fleet, "registered", return_value=[{"id": "real-a"}]):
            with self.assertRaises(ValueError):
                sensor.configure(configuration())

    def test_duplicate_heads_or_channels_are_rejected_atomically(self):
        for rows in ([binding(), binding()], [binding(), binding("T1")],
                     [binding(), binding("T0", "inlet-1")]):
            with self.assertRaises(ValueError):
                sensor.configure(configuration(rows))
        self.assertEqual(len(sensor.status()["sensors"]), 1)

    def test_restart_retains_bindings_but_needs_new_readings(self):
        sensor.ingest(message())
        sensor._readings.clear()
        self.assertEqual(self.current()["device_id"], "pico-1")
        self.assertEqual(self.current()["status"], "no_reading")

    def test_recovered_assignment_cannot_relabel_cached_sensor_data(self):
        sensor.ingest(message())
        replacement = {**binding(), "sensor_id": "replacement-chip"}
        sensor.storage.save_json(sensor._PATH, {"real-a": [replacement]})
        self.assertEqual(self.current()["sensor_id"], "replacement-chip")
        self.assertEqual(self.current()["status"], "no_reading")
        self.assertIsNone(self.current()["detected_hex"])

    def test_callers_cannot_mutate_saved_observations(self):
        body = message()
        accepted = sensor.ingest(body)
        body["raw"]["f1"] = 0
        accepted["sensor"]["reading"]["raw"]["f1"] = 0
        current = self.current()
        current["reading"]["raw"]["f1"] = 0
        self.assertEqual(self.current()["reading"]["raw"]["f1"], 100)

    def test_schema_rejects_invalid_numbers_colours_and_unbounded_payloads(self):
        changes = [
            {"version": True}, {"version": 2}, {"simulated": True}, {"simulated": None},
            {"captured_at": True}, {"captured_at": float("nan")}, {"captured_at": float("inf")},
            {"captured_at": 10 ** 1000}, {"raw": {}}, {"raw": {"f1": -1}}, {"raw": {"f1": True}},
            {"raw": {"f1": 10 ** 1000}}, {"raw": {str(i): i for i in range(17)}},
            {"quality_flags": "low_light"}, {"quality_flags": [None]},
            {"calibrated": {"hex": "red;display:none"}},
            {"calibrated": {"hex": "#ffffff", "calibration_id": "white", "confidence": 1.1}},
            {"sensor_id": "<script>"}, {"device_id": "x" * 65},
        ]
        for change in changes:
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    sensor.ingest({**message(), **change})
        self.assertEqual(self.current()["status"], "no_reading")

    def test_demo_cannot_configure_ingest_or_receive_physical_samples(self):
        sensor.ingest(message())
        with mock.patch.object(mock_moonraker, "selected_printer_id", return_value="demo"):
            self.assertEqual(sensor.status()["sensors"], [])
            for action, body in ((sensor.configure, configuration()), (sensor.ingest, message())):
                with self.assertRaises(ValueError):
                    action(body)


class CompanionAPI(RealPrinterAPI):
    def setUp(self):
        super().setUp()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        for patch in (mock.patch.object(sensor, "_PATH", os.path.join(folder.name, "sensors.json")),
                      mock.patch.object(sensor, "_readings", {})):
            patch.start()
            self.addCleanup(patch.stop)
        modules.set_enabled("color_check", True)
        self.route = "?printer=" + self.pid

    def send_sample(self):
        import time
        return self.request("/api/colorcheck/readings" + self.route, message(time.time()))

    def test_bound_reading_reaches_colour_card_without_a_print_verdict(self):
        status, body = self.request("/api/colorcheck/sensors" + self.route, configuration())
        self.assertEqual(status, 200, body)
        self.assertEqual(self.send_sample()[0], 200)
        status, body = self.request("/api/colorcheck" + self.route)
        self.assertEqual(status, 200)
        self.assertFalse(body["simulated"])
        self.assertTrue(body["hardware_connected"])
        self.assertEqual(body["overall"], "sensor_readings")
        self.assertEqual(body["checks"], [])
        self.assertEqual(body["sensors"][0]["detected_hex"], "#f26a1b")

    def test_all_sensor_routes_respect_module_switch(self):
        modules.set_enabled("color_check", False)
        for path, body in (("/api/colorcheck/sensors", None),
                           ("/api/colorcheck/sensors", configuration()),
                           ("/api/colorcheck/readings", message())):
            self.assertEqual(self.request(path + self.route, body)[0], 403)

    def test_demo_flag_does_not_override_a_real_sensor_identity(self):
        self.request("/api/colorcheck/sensors" + self.route, configuration())
        self.assertEqual(self.send_sample()[0], 200)
        _, body = self.request("/api/colorcheck" + self.route + "&demo=1")
        self.assertFalse(body["simulated"])
        self.assertEqual(self.request("/api/colorcheck/readings?demo=1&printer=u1-workshop", message())[0], 400)

    def test_cross_site_and_unknown_host_cannot_send_readings(self):
        for headers, expected in (({"Origin": "https://other.example"}, 403),
                                  ({"Host": "other.example"}, 421)):
            req = Request(self.base + "/api/colorcheck/readings" + self.route,
                          data=json.dumps(message()).encode(), headers=headers)
            with self.assertRaises(HTTPError) as error:
                urlopen(req, timeout=5)
            self.assertEqual(error.exception.code, expected)

    def test_device_lock_has_no_sensor_bypass(self):
        req = Request(self.base + "/api/colorcheck/readings" + self.route,
                      data=json.dumps(message()).encode())
        with mock.patch.object(pairing, "lock_enabled", return_value=True), \
                mock.patch.object(__import__("app").DejaVuHandler, "_this_computer", return_value=False):
            with self.assertRaises(HTTPError) as error:
                urlopen(req, timeout=5)
            self.assertEqual(error.exception.code, 401)


if __name__ == "__main__":
    unittest.main()
