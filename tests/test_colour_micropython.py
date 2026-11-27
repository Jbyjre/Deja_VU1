"""The colour checker's real firmware file under MicroPython, against the real server over a real socket.

CircuitPython, the Pico's interpreter, is built on MicroPython, and ordinary Python accepts things it does not. These
tests run hardware/colour-checker/code.py with tools/colour_micropython_run.py (the sensor, the radio and the memory are
stand-ins in tools/mp_shim/) and read what it prints. They skip where the `micropython` program is not installed
(Ubuntu: `sudo apt install micropython`, version 1.22 was used). It is close to the Pico's interpreter, not the same:
nothing here ran on a real Pico W.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import companion_sensor as sensor  # noqa: E402
import modules  # noqa: E402
import sensor_calibration as cal  # noqa: E402
from tests.test_real_printer import RealPrinterAPI  # noqa: E402

MICROPYTHON = shutil.which("micropython")
DRIVER = os.path.join(ROOT, "tools", "colour_micropython_run.py")
DEVICE = "pico-deadbeef00000002"  # the id tools/mp_shim/microcontroller.py gives the stand-in board


@unittest.skipUnless(MICROPYTHON, "the micropython program is not installed")
class UnderMicroPython(RealPrinterAPI):
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

    def run_firmware(self, server, steps=8):
        env = dict(os.environ, CIRCUITPY_WIFI_SSID="HomeNet", CIRCUITPY_WIFI_PASSWORD="correct-horse",
                   DV1_SERVER=server, DV1_PRINTER=self.pid)
        done = subprocess.run([MICROPYTHON, DRIVER, str(steps)], env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertNotIn("Traceback", done.stderr + done.stdout)
        protocol, plain = [], []
        for line in done.stdout.splitlines():
            (protocol if line.startswith("DV1 ") else plain).append(json.loads(line[4:]) if line.startswith("DV1 ") else line)
        return protocol, plain

    def test_every_step_runs_and_the_real_app_accepts_the_readings(self):
        status, body = self.request("/api/colorcheck/sensors?printer=" + self.pid,
                                    {"version": 1, "simulated": False, "bindings": [{
                                        "toolhead": "T0", "device_id": DEVICE, "channel_id": "inlet-0",
                                        "sensor_id": "as7341-1", "sensor_model": "AS7341"}]})
        self.assertEqual(status, 200, body)
        protocol, plain = self.run_firmware("127.0.0.1:%d" % self.server.server_port)
        self.assertEqual(plain[-1], "MP-DONE failures=0 link=ok", "\n".join(l[:300] for l in plain if l.startswith("Wi-Fi")))
        self.assertFalse([m for m in protocol if m["t"] == "error"], protocol)
        readings = [m for m in protocol if m["t"] == "reading"]
        self.assertGreaterEqual(len(readings), 7)
        for reading in readings:
            self.assertEqual(sorted(reading["raw"]), ["clear", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "nir"])
            self.assertTrue(all(isinstance(v, int) for v in reading["raw"].values()))
        by_cmd = {(m.get("cmd"), m["t"]): m for m in protocol if m["t"] in ("ack", "autogain")}
        self.assertTrue(by_cmd[("set", "ack")]["ok"] in (True, False))
        self.assertTrue(by_cmd[("autogain", "autogain")]["ok"])
        self.assertLessEqual(by_cmd[("autogain", "autogain")]["peak_percent"], 50.0)
        self.assertFalse(by_cmd[("nonsense", "ack")]["ok"])
        self.assertEqual(by_cmd[("nonsense", "ack")]["message"], "Unknown command.")
        self.assertFalse([m for m in protocol if m["t"] == "ack" and m.get("cmd") is None and m["ok"]])
        self.assertTrue(by_cmd[("net", "ack")]["ok"])
        self.assertTrue(by_cmd[("wifi_set", "ack")]["ok"])
        self.assertNotIn("12345678", json.dumps(protocol))  # the Wi-Fi password is never repeated
        self.assertTrue(by_cmd[("wifi_test", "ack")]["ok"], by_cmd[("wifi_test", "ack")])
        self.assertEqual(by_cmd[("new_sensor", "ack")]["sensor_id"], "as7341-2")
        head = self.request("/api/colorcheck/sensors?printer=" + self.pid)[1]["sensors"][0]
        self.assertEqual(head["reading"]["info"]["transport"], "wifi")
        self.assertIsInstance(head["reading"]["captured_at"], int)

    def test_an_app_that_is_not_there_is_named_in_one_sentence(self):
        protocol, plain = self.run_firmware("127.0.0.1:1", steps=3)
        self.assertTrue(plain[-1].endswith("link=unreachable"), plain[-1])
        wifi_lines = [line for line in plain if line.startswith("Wi-Fi: ")]
        self.assertEqual(len(wifi_lines), 1)
        self.assertEqual(wifi_lines[0].count("127.0.0.1:1"), 1)  # the address is named once
        self.assertIn("no answer from 127.0.0.1:1", wifi_lines[0])
        self.assertNotIn("((", wifi_lines[0])


if __name__ == "__main__":
    unittest.main()
