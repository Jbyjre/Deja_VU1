"""The colour checker's Wi-Fi route: the real firmware file, a stand-in Pico W, the real server over real sockets.

The Wi-Fi radio, the board's LED and the sensor are stand-ins (tools/colour_pico_sim.py). The sockets and the server
are real, so the HTTP the firmware writes is read by Deja Vu1's own handler. Nothing here has run on a real Pico W.
"""

import contextlib
import io
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import colour_pico_sim as sim  # noqa: E402
import companion_sensor as sensor  # noqa: E402
import idle_stop  # noqa: E402
import mock_moonraker  # noqa: E402
import modules  # noqa: E402
import sensor_calibration as cal  # noqa: E402
from tests.test_real_printer import RealPrinterAPI  # noqa: E402

DEVICE = "pico-deadbeef00000001"


def binding(head="T0"):
    return {"toolhead": head, "device_id": DEVICE, "channel_id": "inlet-0", "sensor_id": "as7341-1",
            "sensor_model": "AS7341"}


class WifiCase(RealPrinterAPI):
    def setUp(self):
        super().setUp()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.base_time = int(time.time())
        self.rig = None
        for patch in (mock.patch.object(sensor, "_PATH", os.path.join(folder.name, "sensors.json")),
                      mock.patch.object(cal, "_PATH", os.path.join(folder.name, "calibrations.json")),
                      mock.patch.object(sensor, "_readings", {}),
                      mock.patch.object(sensor, "_unassigned", {}),
                      mock.patch.object(sensor, "_commands", {})):
            patch.start()
            self.addCleanup(patch.stop)
        # One timeline for the server and the Pico, so nothing waits for real: the server reads the rig's clock.
        clock = mock.patch.object(sensor, "time")
        fake = clock.start()
        self.addCleanup(clock.stop)
        fake.time.side_effect = lambda: self.base_time + (self.rig.clock.now - 1000.0 if self.rig else 0)
        fake.monotonic.side_effect = lambda: self.rig.clock.now if self.rig else 1000.0
        modules.set_enabled("color_check", True)
        self.route = "?printer=" + self.pid

    def pico(self, env=None, **options):
        values = {"CIRCUITPY_WIFI_SSID": "HomeNet", "CIRCUITPY_WIFI_PASSWORD": "correct-horse",
                  "DV1_SERVER": "127.0.0.1:%d" % self.server.server_port, "DV1_PRINTER": self.pid}
        values.update(env or {})
        patch = mock.patch.dict(os.environ, {k: v for k, v in values.items() if v is not None})
        patch.start()
        self.addCleanup(patch.stop)
        for name in [k for k, v in values.items() if v is None]:
            os.environ.pop(name, None)
        self.rig = sim.Rig(**options)
        self.addCleanup(self.rig.close)
        return self.rig

    def step(self, count=1):
        self.rig.led_log.clear()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            for _ in range(count):
                self.rig.checker.step()
        protocol, plain = [], []
        for line in out.getvalue().splitlines():
            (protocol if line.startswith("DV1 ") else plain).append(line)
        self.output = out.getvalue()
        return [json.loads(line[4:]) for line in protocol], plain

    def assign(self, head="T0"):
        status, body = self.request("/api/colorcheck/sensors" + self.route,
                                    {"version": 1, "simulated": False, "bindings": [binding(head)]})
        self.assertEqual(status, 200, body)

    def server_view(self):
        return self.request("/api/colorcheck/sensors" + self.route)[1]

    def blinks(self):
        log = self.rig.led_log
        return 0 if log == [True] else log.count(False)


class Posting(WifiCase):
    def test_it_joins_the_wifi_syncs_the_clock_and_posts_readings_the_app_accepts(self):
        rig = self.pico()
        self.assign()
        self.step(3)
        head = self.server_view()["sensors"][0]
        self.assertEqual(head["status"], "uncalibrated")  # raw counts arrived, no white reference yet
        self.assertEqual(head["reading"]["info"]["transport"], "wifi")
        self.assertEqual(head["reading"]["info"]["rssi"], -58)
        self.assertEqual(head["reading"]["settings"]["gain"], 16)
        self.assertIsInstance(head["reading"]["captured_at"], int)  # whole seconds: a CircuitPython float cannot do better
        self.assertLessEqual(head["reading"]["captured_at"], self.base_time + rig.clock.now - 1000 + 1)
        self.assertEqual(rig.checker.link.state, "ok")
        self.assertEqual(self.blinks(), 0)
        self.assertEqual(rig.radio.attempts, [("HomeNet", "correct-horse")])

    def test_each_reading_is_stamped_later_than_the_last(self):
        self.pico()
        self.assign()
        seen = []
        for _ in range(4):
            self.step()
            seen.append(self.server_view()["sensors"][0]["reading"]["captured_at"])
        self.assertEqual(seen, sorted(set(seen)))
        self.assertEqual(self.server_view()["sensors"][0]["status"], "uncalibrated")

    def test_a_colour_arrives_after_the_white_reference_over_wifi(self):
        rig = self.pico(spool="white")
        self.assign()
        self.step(2)
        status, state = self.request("/api/colorcheck/calibration" + self.route, {"toolhead": "T0", "step": "white"})
        self.assertEqual((status, state["state"]), (200, "ready"), state)
        rig.spool = "orange"
        self.step(2)
        head = self.server_view()["sensors"][0]
        self.assertEqual(head["status"], "reading", head["message"])
        self.assertEqual(head["reading"]["calibrated"]["source"], "deja-vu1")
        red = int(head["detected_hex"][1:3], 16)
        blue = int(head["detected_hex"][5:7], 16)
        self.assertGreater(red, blue + 80)

    def test_a_sensor_that_is_not_assigned_is_refused_listed_and_works_once_assigned(self):
        self.pico()
        self.step()
        link = self.rig.checker.link
        self.assertEqual(link.state, "refused")
        self.assertIn("not assigned to a head", link.message)
        self.assertEqual(self.blinks(), 3)
        listed = self.server_view()["unassigned"]
        self.assertEqual((listed[0]["device_id"], listed[0]["info"]["transport"]), (DEVICE, "wifi"))
        self.assign()
        self.step()
        self.assertEqual(link.state, "ok")
        self.assertEqual(self.blinks(), 0)

    def test_the_sensor_traffic_does_not_keep_the_app_running_after_the_last_page_closes(self):
        self.pico()
        self.assign()
        with mock.patch.object(idle_stop, "page_seen") as seen:
            self.step(2)
        seen.assert_not_called()


class Trouble(WifiCase):
    def test_a_wrong_password_names_the_network_blinks_once_and_never_calls_the_app(self):
        rig = self.pico(env={"CIRCUITPY_WIFI_PASSWORD": "wrong-password"})
        self.step()
        link = rig.checker.link
        self.assertEqual(link.state, "no_wifi")
        self.assertIn("HomeNet", link.message)
        self.assertIn("5 GHz", link.message)
        self.assertEqual(self.blinks(), 1)
        self.assertNotIn("wrong-password", self.output)
        self.assertEqual(self.server_view()["unassigned"], [])

    def test_it_waits_between_tries_and_joins_when_the_password_is_right(self):
        rig = self.pico(env={"CIRCUITPY_WIFI_PASSWORD": "wrong-password"})
        self.assign()
        self.step(3)
        self.assertLessEqual(len(rig.radio.attempts), 2)  # 6 fake seconds passed: not one try a second
        rig.network = {"ssid": "HomeNet", "password": "wrong-password"}
        rig.clock.now += 30
        self.step()
        self.assertEqual(rig.checker.link.state, "ok")

    def test_the_wifi_going_away_and_coming_back_is_reported_and_recovers(self):
        rig = self.pico()
        self.assign()
        self.step()
        rig.wifi_up = False
        self.step()
        self.assertEqual(rig.checker.link.state, "no_wifi")
        self.assertEqual(self.blinks(), 1)
        rig.wifi_up = True
        rig.clock.now += 30
        self.step(2)
        self.assertEqual(rig.checker.link.state, "ok")

    def test_an_app_that_is_not_there_is_named_by_address_and_blinks_twice(self):
        rig = self.pico(env={"DV1_SERVER": "127.0.0.1:1"})
        self.step()
        link = rig.checker.link
        self.assertEqual(link.state, "unreachable")
        self.assertIn("127.0.0.1:1", link.message)
        self.assertIn("firewall", link.message)
        self.assertEqual(self.blinks(), 2)

    def test_after_a_failed_try_the_app_is_left_alone_for_a_few_seconds_so_the_readings_keep_their_pace(self):
        rig = self.pico(env={"DV1_SERVER": "127.0.0.1:1"})
        link = rig.checker.link
        with mock.patch.object(link, "_call", wraps=link._call) as call:
            self.step()
            first = call.call_count
            self.assertGreater(first, 0)
            self.step()  # two fake seconds later: inside the hold
            self.assertEqual(call.call_count, first)
            rig.clock.now += 11
            self.step()
            self.assertGreater(call.call_count, first)

    def test_several_addresses_are_tried_in_order_and_the_one_that_works_is_kept(self):
        rig = self.pico(env={"DV1_SERVER": "127.0.0.1:1, localhost:%d" % self.server.server_port})
        self.assign()
        self.step()
        link = rig.checker.link
        self.assertEqual(link.state, "ok")
        self.assertEqual(link.server, 1)  # a name is looked up through the pool, as the real board does
        self.step()
        self.assertEqual(link.state, "ok")

    def test_a_wrong_printer_id_is_refused_in_words(self):
        rig = self.pico(env={"DV1_PRINTER": "no-such-printer"})
        self.step()
        self.assertEqual(rig.checker.link.state, "refused")
        self.assertEqual(self.blinks(), 3)

    def test_the_module_being_off_is_refused_in_words(self):
        rig = self.pico()
        self.assign()
        modules.set_enabled("color_check", False)
        self.step()
        link = rig.checker.link
        self.assertEqual(link.state, "refused")
        self.assertTrue(link.message)

    def test_no_printer_id_says_to_use_the_setup_screen(self):
        rig = self.pico(env={"DV1_PRINTER": None})
        self.step()
        self.assertIn("DV1_PRINTER", rig.checker.link.message)

    def test_the_sensor_wires_come_loose_blinks_four_times(self):
        rig = self.pico()
        self.assign()
        self.step()
        rig.unplugged = True
        self.step()
        self.assertEqual(self.blinks(), 4)


class Commands(WifiCase):
    def test_a_command_from_the_app_rides_the_reply_and_its_result_comes_back_with_the_next_reading(self):
        rig = self.pico(spool="white")
        self.assign()
        self.step()
        status, queued = self.request("/api/colorcheck/command" + self.route, {"toolhead": "T0", "cmd": "autogain"})
        self.assertEqual((status, queued["state"]), (200, "waiting"))
        self.step()  # the reply to this reading carries the command, which runs at once
        self.assertEqual(self.server_view()["sensors"][0]["command"]["state"], "sent")
        self.step()  # the next reading carries the answer
        command = self.server_view()["sensors"][0]["command"]
        self.assertEqual(command["state"], "done", command)
        self.assertIn("keeps the brightest channel", command["message"])
        self.assertEqual(self.server_view()["sensors"][0]["reading"]["settings"]["gain"], rig.checker.settings["gain"])

    def test_a_refused_command_shows_the_sensors_own_words(self):
        self.pico()
        self.assign()
        self.step()
        self.request("/api/colorcheck/command" + self.route, {"toolhead": "T0", "cmd": "set", "gain": 4, "led_ma": 12})
        self.step(2)
        self.assertEqual(self.server_view()["sensors"][0]["command"]["state"], "done")
        self.assertEqual(self.rig.checker.settings["gain"], 4)
        self.assertEqual(self.rig.sensor.led_current, 12)

    def test_wifi_settings_never_change_over_wifi(self):
        rig = self.pico()
        out = rig.checker.execute("wifi_set", {"ssid": "Evil", "password": "12345678"}, False)
        self.assertFalse(out["ok"])
        self.assertIn("only change over USB", out["message"])


class FromUsb(WifiCase):
    def type(self, **body):
        self.rig.command(**body)
        protocol, _ = self.step()
        return [m for m in protocol if m["t"] == "ack"]

    def test_the_app_can_save_wifi_settings_over_usb_and_the_pico_never_says_the_password_back(self):
        rig = self.pico(env={"CIRCUITPY_WIFI_SSID": None, "CIRCUITPY_WIFI_PASSWORD": None})
        self.assertEqual(rig.checker.link.state, "off")
        self.step()
        ack = self.type(cmd="wifi_set", ssid="HomeNet", password="correct-horse")
        self.assertTrue(ack[0]["ok"], ack)
        self.assertNotIn("correct-horse", self.output)
        self.assertEqual(ack[0]["net"]["source"], "usb")
        self.assertEqual(ack[0]["net"]["ssid"], "HomeNet")
        self.assertNotIn("password", ack[0]["net"])
        self.assign()
        self.step(2)
        self.assertEqual(rig.checker.link.state, "ok")
        again = self.make_again(rig)
        self.assertEqual(again.checker.link.net["ssid"], "HomeNet")  # kept across an unplug

    def make_again(self, rig):
        other = sim.Rig(nvm=rig.nvm)
        self.addCleanup(other.close)
        return other

    def test_the_apps_saved_settings_win_over_settings_toml_and_wifi_clear_gives_the_file_back(self):
        rig = self.pico(env={"CIRCUITPY_WIFI_SSID": "OldNet"})
        self.assertEqual(rig.checker.link.net["source"], "file")
        self.type(cmd="wifi_set", ssid="HomeNet", password="correct-horse")
        self.assertEqual(rig.checker.link.net["ssid"], "HomeNet")
        ack = self.type(cmd="wifi_clear")
        self.assertTrue(ack[0]["ok"])
        self.assertEqual((rig.checker.link.net["ssid"], rig.checker.link.net["source"]), ("OldNet", "file"))

    def test_bad_wifi_settings_are_refused_in_words_and_save_nothing(self):
        rig = self.pico()
        for body in ({"ssid": ""}, {"ssid": "x" * 33}, {"password": "short"}, {"server": "not an address"},
                     {"printer": "a b"}, {"code": "12ab"}):
            ack = self.type(cmd="wifi_set", **body)
            self.assertFalse(ack[0]["ok"], body)
        self.assertEqual(sim_nvm_block(rig), {})

    def test_wifi_test_reports_where_it_got_to_in_words(self):
        rig = self.pico()
        self.assign()
        ack = self.type(cmd="wifi_test")
        self.assertTrue(ack[0]["ok"], ack)
        self.assertEqual(ack[0]["net"]["state"], "ok")
        self.assertEqual(ack[0]["net"]["ip"], "192.168.1.50")
        rig.wifi_up = False
        ack = self.type(cmd="wifi_test")
        self.assertFalse(ack[0]["ok"])
        self.assertIn("HomeNet", ack[0]["message"])

    def test_net_shows_the_settings_without_the_password(self):
        self.pico()
        ack = self.type(cmd="net")
        text = json.dumps(ack)
        self.assertNotIn("correct-horse", text)
        self.assertEqual(ack[0]["net"]["ssid"], "HomeNet")

    def test_usb_still_streams_readings_while_the_wifi_is_down(self):
        rig = self.pico()
        rig.wifi_up = False
        protocol, _ = self.step(2)
        self.assertEqual([m["t"] for m in protocol if m["t"] == "reading"], ["reading", "reading"])


def sim_nvm_block(rig):
    return rig.firmware.load_net_block()


class Pairing(unittest.TestCase):
    """The device lock answers an unpaired sensor 401. The lock is not enforced for a request from this computer, so
    these tests drive the firmware's side against canned answers rather than a locked server."""

    def setUp(self):
        patch = mock.patch.dict(os.environ, {"CIRCUITPY_WIFI_SSID": "HomeNet", "CIRCUITPY_WIFI_PASSWORD": "correct-horse",
                                              "DV1_SERVER": "10.0.0.5:8000", "DV1_PRINTER": "p1",
                                              "DV1_PAIR_CODE": "123456"})
        patch.start()
        self.addCleanup(patch.stop)
        self.rig = sim.Rig()
        self.addCleanup(self.rig.close)
        self.link = self.rig.checker.link
        self.link.offset = 5
        self.link.synced_at = 10 ** 9

    def test_a_pairing_code_is_used_once_and_the_key_comes_from_the_set_cookie_header(self):
        calls = []

        def request(method, path, body=None, cookie=True):
            calls.append((method, path, self.link.net["token"]))
            if path.startswith("/api/pairing/redeem"):
                return 200, {"set-cookie": "dv_device=KEY123; Path=/; HttpOnly"}, {"id": "device-1"}
            if not self.link.net["token"]:
                return 401, {}, {"error": "paired devices only", "pairing_required": True}
            return 200, {}, {"accepted": True, "server_time": 1900000000, "commands": []}

        with mock.patch.object(self.link, "request", side_effect=request), \
                mock.patch.object(self.link, "join", return_value=True):
            message = {k: "x" for k in ("device_id", "channel_id", "sensor_id", "sensor_model")}
            message.update(raw={}, quality_flags=[], settings={})
            commands = self.link.send(message)
        self.assertEqual(commands, [])
        self.assertEqual(self.link.net["token"], "KEY123")
        self.assertEqual([c[0:2] for c in calls][1], ("POST", "/api/pairing/redeem"))
        self.assertEqual(calls[-1][2], "KEY123")
        self.assertEqual(self.link.state, "ok")
        self.assertEqual(self.rig.firmware.load_net_block()["token"], "KEY123")

    def test_pairing_happens_at_the_first_call_the_time_request_when_the_clock_is_not_known_yet(self):
        self.link.offset = None
        calls = []

        def request(method, path, body=None, cookie=True):
            calls.append((method, path.split("?")[0], self.link.net["token"]))
            if path.startswith("/api/pairing/redeem"):
                return 200, {"set-cookie": "dv_device=KEY123; Path=/; HttpOnly"}, {"id": "device-1"}
            if not self.link.net["token"]:
                return 401, {}, {"error": "paired devices only", "pairing_required": True}
            if method == "GET":
                return 200, {}, {"server_time": 1900000000, "sensors": []}
            return 200, {}, {"accepted": True, "server_time": 1900000000, "commands": []}

        with mock.patch.object(self.link, "request", side_effect=request), \
                mock.patch.object(self.link, "join", return_value=True):
            message = {k: "x" for k in ("device_id", "channel_id", "sensor_id", "sensor_model")}
            message.update(raw={}, quality_flags=[], settings={})
            self.assertEqual(self.link.send(message), [])
        self.assertEqual([(c[0], c[1]) for c in calls], [("GET", "/api/colorcheck/sensors"), ("POST", "/api/pairing/redeem"),
                                                         ("GET", "/api/colorcheck/sensors"), ("POST", "/api/colorcheck/readings")])
        self.assertEqual([c[2] for c in calls], ["", "", "KEY123", "KEY123"])
        self.assertEqual(self.link.state, "ok")

    def test_a_code_that_does_not_work_is_not_tried_again_and_the_lock_is_explained(self):
        def request(method, path, body=None, cookie=True):
            if path.startswith("/api/pairing/redeem"):
                return 400, {}, {"error": "Incorrect pairing code"}
            return 401, {}, {"error": "paired devices only", "pairing_required": True}

        with mock.patch.object(self.link, "request", side_effect=request), \
                mock.patch.object(self.link, "join", return_value=True):
            message = {k: "x" for k in ("device_id", "channel_id", "sensor_id", "sensor_model")}
            message.update(raw={}, quality_flags=[], settings={})
            self.assertIsNone(self.link.send(message))
        self.assertEqual(self.link.state, "refused")
        self.assertIn("device lock is on", self.link.message)
        self.assertIn("was not accepted", self.link.message)


class Helpers(unittest.TestCase):
    def setUp(self):
        self.rig = sim.Rig()
        self.addCleanup(self.rig.close)
        self.firmware = self.rig.firmware

    def test_app_addresses_are_cleaned_and_limited(self):
        clean = self.firmware.clean_servers
        self.assertEqual(clean("192.168.1.23"), [("192.168.1.23", 8000)])
        self.assertEqual(clean(" http://192.168.1.23:8791/ , laptop.local "),
                         [("192.168.1.23", 8791), ("laptop.local", 8000)])
        self.assertEqual(clean(["a:1", "b:99999", "c:x", "", "d"]), [("a", 1), ("d", 8000)])
        self.assertEqual(len(clean(",".join("h%d" % i for i in range(9)))), 4)
        self.assertEqual(clean(None), [])

    def test_the_network_block_survives_and_a_damaged_one_is_ignored(self):
        save, load = self.firmware.save_net_block, self.firmware.load_net_block
        self.assertTrue(save({"ssid": "HomeNet", "server": ["1.2.3.4:8000"]}))
        self.assertEqual(load()["ssid"], "HomeNet")
        self.rig.nvm[self.firmware.NET_OFFSET + 8] ^= 0x01
        self.assertEqual(load(), {})
        self.assertTrue(save({}))
        self.assertEqual(load(), {})
        self.assertFalse(save({"x": "y" * 2000}))

    def test_the_settings_block_and_the_network_block_do_not_overwrite_each_other(self):
        self.firmware.save_net_block({"ssid": "HomeNet"})
        self.firmware.save_settings({"gain": 64, "led_ma": 12, "generation": 3})
        self.assertEqual(self.firmware.load_settings()["gain"], 64)
        self.assertEqual(self.firmware.load_net_block()["ssid"], "HomeNet")


if __name__ == "__main__":
    unittest.main()
