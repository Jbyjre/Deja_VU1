"""A colour checker on Wi-Fi: it announces itself, takes commands in the replies it gets, and the app says where it is.

Synthetic messages again. Nothing here measures a colour.
"""

import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import companion_sensor as sensor
import mock_moonraker
import modules
import sensor_calibration as cal
from tests.test_real_printer import RealPrinterAPI

BANDS = [name for name, _ in cal.AS7341_BANDS]
RAW = {name: 1000 for name in BANDS}


def binding(head="T0"):
    return {"toolhead": head, "device_id": "pico-1", "channel_id": "inlet-0",
            "sensor_id": "as7341-1", "sensor_model": "AS7341"}


def message(now, **extra):
    body = {"version": 1, "simulated": False, "device_id": "pico-1", "channel_id": "inlet-0",
            "sensor_id": "as7341-1", "sensor_model": "AS7341", "captured_at": now, "raw": RAW,
            "quality_flags": [], "calibrated": None}
    body.update(extra)
    return body


class Announce(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        for patch in (mock.patch.object(sensor, "_PATH", os.path.join(folder.name, "sensors.json")),
                      mock.patch.object(cal, "_PATH", os.path.join(folder.name, "calibrations.json")),
                      mock.patch.object(sensor, "_readings", {}),
                      mock.patch.object(sensor, "_unassigned", {}),
                      mock.patch.object(sensor, "_commands", {}),
                      mock.patch.object(sensor, "time"),
                      mock.patch.object(mock_moonraker, "selected_printer_id", return_value="real-a"),
                      mock.patch.object(mock_moonraker, "is_real", side_effect=lambda pid: pid.startswith("real-")),
                      mock.patch("fleet.registered", return_value=[{"id": "real-a"}])):
            patch.start()
            self.addCleanup(patch.stop)
        self.clock(1000)

    def clock(self, now):
        self.now = now
        sensor.time.time.return_value = now
        sensor.time.monotonic.return_value = now - 950

    def assign(self, *heads):
        sensor.configure({"version": 1, "simulated": False, "bindings": [binding(h) for h in heads]})

    def send(self, **extra):
        self.clock(self.now + 1)
        return sensor.ingest(message(self.now, **extra))

    # -- a sensor that is not assigned yet ------------------------------------------------------------------
    def test_a_sensor_that_is_not_assigned_is_refused_and_listed_so_the_app_can_offer_it(self):
        with self.assertRaises(ValueError) as caught:
            self.send(info={"firmware": "1.0.0", "transport": "wifi", "rssi": -61}, settings={"gain": 16})
        self.assertIn("not assigned", str(caught.exception))
        listed = sensor.status()["unassigned"]
        self.assertEqual(len(listed), 1)
        self.assertEqual((listed[0]["device_id"], listed[0]["channel_id"]), ("pico-1", "inlet-0"))
        self.assertEqual(listed[0]["info"]["rssi"], -61)
        self.assertEqual(listed[0]["settings"], {"gain": 16})

    def test_assigning_it_takes_it_off_the_list_and_the_next_message_is_accepted(self):
        with self.assertRaises(ValueError):
            self.send()
        self.assign("T0")
        self.assertEqual(sensor.status()["unassigned"], [])
        self.assertTrue(self.send()["accepted"])

    def test_the_list_forgets_a_sensor_after_ten_minutes_and_holds_at_most_eight(self):
        with self.assertRaises(ValueError):
            self.send()
        self.clock(self.now + sensor.UNASSIGNED_TTL_S + 5)
        self.assertEqual(sensor.status()["unassigned"], [])
        for number in range(12):
            with self.assertRaises(ValueError):
                self.clock(self.now + 1)
                sensor.ingest(message(self.now, device_id="pico-%d" % number))
        self.assertEqual(len(sensor.status()["unassigned"]), sensor.MAX_UNASSIGNED)

    def test_a_message_that_is_refused_for_other_reasons_is_not_listed(self):
        with self.assertRaises(ValueError):
            sensor.ingest(message(self.now + 99))  # a clock far ahead
        with self.assertRaises(ValueError):
            sensor.ingest(message(self.now, raw={}))
        self.assertEqual(sensor.status()["unassigned"], [])

    def test_the_facts_a_sensor_sends_about_itself_are_checked(self):
        self.assign("T0")
        for bad in ("text", ["a"], {"a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6, "g": 7, "h": 8, "i": 9},
                    {"note": "x" * 300}, {"note": "café"}, {"bad name": 1}):
            with self.assertRaises(ValueError, msg=repr(bad)):
                self.send(info=bad)
        self.send(info={"firmware": "1.0.0", "wifi": True, "rssi": -70})
        self.assertEqual(sensor.read("T0")["reading"]["info"]["rssi"], -70)

    # -- commands to the sensor ----------------------------------------------------------------------------
    def test_a_command_rides_in_the_reply_to_the_sensors_next_reading_once_and_its_result_comes_back(self):
        self.assign("T0")
        queued = sensor.queue_command({"toolhead": "T0", "cmd": "autogain"})
        self.assertEqual((queued["state"], queued["cmd"]), ("waiting", "autogain"))
        reply = self.send()
        self.assertEqual(reply["commands"], [{"id": queued["id"], "cmd": "autogain"}])
        self.assertEqual(sensor.read("T0")["command"]["state"], "sent")
        self.assertEqual(self.send()["commands"], [])  # delivered once
        self.send(command_result={"id": queued["id"], "ok": True, "message": "Gain 32 keeps the brightest channel at 48 %."})
        done = sensor.read("T0")["command"]
        self.assertEqual((done["state"], done["message"]),
                         ("done", "Gain 32 keeps the brightest channel at 48 %."))

    def test_a_refused_command_shows_as_failed_in_the_sensors_own_words(self):
        self.assign("T0")
        queued = sensor.queue_command({"toolhead": "T0", "cmd": "set", "gain": 64})
        self.assertEqual(self.send()["commands"][0]["gain"], 64)
        self.send(command_result={"id": queued["id"], "ok": False, "message": "gain must be one of the chip's."})
        self.assertEqual(sensor.read("T0")["command"]["state"], "failed")

    def test_a_command_nobody_picked_up_expires_in_words(self):
        self.assign("T0")
        sensor.queue_command({"toolhead": "T0", "cmd": "autogain"})
        self.clock(self.now + sensor.COMMAND_TTL_S + 1)
        head = sensor.status()["sensors"][0]
        self.assertEqual(head["command"]["state"], "expired")
        self.assertIn("powered and on Wi-Fi", head["command"]["message"])
        self.assertEqual(self.send()["commands"], [])

    def test_a_newer_command_replaces_a_waiting_one_and_an_old_result_is_ignored(self):
        self.assign("T0")
        first = sensor.queue_command({"toolhead": "T0", "cmd": "autogain"})
        second = sensor.queue_command({"toolhead": "T0", "cmd": "new_sensor"})
        self.assertGreater(second["id"], first["id"])
        self.send(command_result={"id": first["id"], "ok": True, "message": "old"})
        self.assertEqual(sensor.read("T0")["command"]["id"], second["id"])
        self.assertNotEqual(sensor.read("T0")["command"]["state"], "done")

    def test_commands_are_checked_before_they_are_queued(self):
        self.assign("T0")
        bad = [{"toolhead": "T9", "cmd": "autogain"}, {"toolhead": "T0", "cmd": "explode"},
               {"toolhead": "T1", "cmd": "autogain"},  # no sensor on T1
               {"toolhead": "T0", "cmd": "set"}, {"toolhead": "T0", "cmd": "set", "gain": 3},
               {"toolhead": "T0", "cmd": "set", "led_ma": 21}, {"toolhead": "T0", "cmd": "set", "led_ma": True},
               {"toolhead": "T0", "cmd": "set", "led": "yes"}, "autogain", None]
        for body in bad:
            with self.assertRaises(ValueError, msg=repr(body)):
                sensor.queue_command(body)
        self.assertEqual(sensor.queue_command({"toolhead": "T0", "cmd": "set", "gain": 0.5, "led_ma": 12,
                                               "led": True})["state"], "waiting")

    def test_reassigning_clears_a_waiting_command(self):
        self.assign("T0")
        sensor.queue_command({"toolhead": "T0", "cmd": "autogain"})
        self.assign("T0")
        self.assertIsNone(sensor.status()["sensors"][0]["command"])


class OverHttp(RealPrinterAPI):
    def setUp(self):
        super().setUp()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        for patch in (mock.patch.object(sensor, "_PATH", os.path.join(folder.name, "sensors.json")),
                      mock.patch.object(cal, "_PATH", os.path.join(folder.name, "calibrations.json")),
                      mock.patch.object(sensor, "_readings", {}),
                      mock.patch.object(sensor, "_unassigned", {}),
                      mock.patch.object(sensor, "_commands", {})):
            patch.start()
            self.addCleanup(patch.stop)
        modules.set_enabled("color_check", True)
        self.route = "?printer=" + self.pid

    def test_a_sensor_posts_before_it_is_assigned_and_the_app_lists_it_then_a_command_reaches_it(self):
        status, body = self.request("/api/colorcheck/readings" + self.route, message(int(time.time())))
        self.assertEqual(status, 400)
        self.assertIn("not assigned", body["error"])
        _, listing = self.request("/api/colorcheck/sensors" + self.route)
        self.assertEqual(listing["unassigned"][0]["device_id"], "pico-1")
        self.assertIsInstance(listing["server_time"], int)
        self.request("/api/colorcheck/sensors" + self.route,
                     {"version": 1, "simulated": False, "bindings": [binding()]})
        status, queued = self.request("/api/colorcheck/command" + self.route, {"toolhead": "T0", "cmd": "autogain"})
        self.assertEqual((status, queued["state"]), (200, "waiting"))
        status, reply = self.request("/api/colorcheck/readings" + self.route, message(int(time.time())))
        self.assertEqual(status, 200, reply)
        self.assertEqual(reply["commands"][0]["cmd"], "autogain")
        self.assertIsInstance(reply["server_time"], int)

    def test_a_bad_command_answers_400_in_words_and_the_switch_answers_403(self):
        self.request("/api/colorcheck/sensors" + self.route,
                     {"version": 1, "simulated": False, "bindings": [binding()]})
        status, body = self.request("/api/colorcheck/command" + self.route, {"toolhead": "T0", "cmd": "explode"})
        self.assertEqual(status, 400)
        self.assertIn("Unknown command", body["error"])
        modules.set_enabled("color_check", False)
        self.assertEqual(self.request("/api/colorcheck/command" + self.route, {"toolhead": "T0", "cmd": "autogain"})[0],
                         403)
        self.assertEqual(self.request("/api/colorcheck/connection" + self.route)[0], 403)

    def test_the_connection_route_names_the_computers_addresses_the_port_and_the_printer(self):
        with mock.patch("discovery.home_addresses", return_value=["192.168.1.23", "10.0.0.5"]):
            status, body = self.request("/api/colorcheck/connection" + self.route)
        self.assertEqual(status, 200)
        self.assertEqual(body["printer_id"], self.pid)
        self.assertTrue(body["physical"])
        self.assertEqual(body["addresses"][0].split(":")[0], "192.168.1.23")
        self.assertEqual(len(body["addresses"]), 2)
        self.assertIn("device_lock", body)
        self.assertTrue(all(a.endswith(":%d" % body["port"]) for a in body["addresses"]))


if __name__ == "__main__":
    unittest.main()
