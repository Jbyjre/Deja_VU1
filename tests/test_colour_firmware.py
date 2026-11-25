"""The colour checker's Pico firmware, run on an ordinary computer against a stand-in sensor.

These tests show that the firmware's lines, commands and failure messages behave as written. The sensor is a model
(tools/colour_pico_sim.py), so nothing here measures a real colour: the real parts were checked by hand on
25 November 2026 with the arrival-test program, and the firmware itself has not yet run on them.
"""

import contextlib
import io
import json
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import colour_pico_sim as sim  # noqa: E402
import companion_sensor  # noqa: E402


def lines_of(text):
    """The firmware's DV1 lines as dicts, and its plain lines as strings."""
    protocol, plain = [], []
    for line in text.splitlines():
        if line.startswith("DV1 "):
            protocol.append(json.loads(line[4:]))
        elif line.strip():
            plain.append(line)
    return protocol, plain


class RigCase(unittest.TestCase):
    def make(self, **options):
        rig = sim.Rig(**options)
        self.addCleanup(rig.close)
        return rig

    def run_steps(self, rig, count=1):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            for _ in range(count):
                rig.checker.step()
        return lines_of(out.getvalue())

    def reading(self, rig):
        protocol, _ = self.run_steps(rig)
        return [m for m in protocol if m["t"] == "reading"][-1]


class Identity(RigCase):
    def test_the_device_id_comes_from_the_board_and_passes_the_apps_rules(self):
        rig = self.make()
        protocol, _ = self.run_steps(rig)
        hello = protocol[0]
        self.assertEqual(hello["t"], "hello")
        self.assertEqual(hello["device_id"], "pico-deadbeef00000001")
        self.assertEqual((hello["protocol"], hello["firmware"]), (1, rig.firmware.FIRMWARE))
        for key in ("device_id", "channel_id", "sensor_id", "sensor_model"):
            self.assertRegex(hello[key], companion_sensor._ID, key)
        self.assertEqual((hello["channel_id"], hello["sensor_id"], hello["sensor_model"]),
                         ("inlet-0", "as7341-1", "AS7341"))

    def test_a_new_sensor_changes_only_the_sensor_id_and_keeps_it_after_a_restart(self):
        rig = self.make()
        self.run_steps(rig)
        rig.command(cmd="new_sensor")
        protocol, _ = self.run_steps(rig)
        ack = next(m for m in protocol if m["t"] == "ack")
        self.assertTrue(ack["ok"])
        self.assertEqual((ack["sensor_id"], ack["device_id"]), ("as7341-2", "pico-deadbeef00000001"))
        again = self.make(nvm=rig.nvm)
        self.assertEqual(self.reading(again)["sensor_id"], "as7341-2")

    def test_damaged_saved_settings_fall_back_to_the_defaults(self):
        rig = self.make()
        rig.command(cmd="set", gain=64)
        self.run_steps(rig)
        rig.nvm[5] ^= 0x55  # flip bits inside the checked bytes
        again = self.make(nvm=rig.nvm)
        self.assertEqual(self.reading(again)["settings"]["gain"], rig.firmware.DEFAULT_GAIN)

    def test_no_memory_for_settings_is_not_an_error(self):
        rig = self.make(nvm=False)
        rig.command(cmd="set", gain=4)
        protocol, _ = self.run_steps(rig)
        self.assertTrue(next(m for m in protocol if m["t"] == "ack")["ok"])


class Readings(RigCase):
    def test_a_reading_carries_everything_the_page_needs_to_post_it(self):
        rig = self.make()
        message = self.reading(rig)
        self.assertEqual(sorted(message["raw"]), sorted(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "clear", "nir"]))
        self.assertTrue(all(isinstance(v, int) and 0 <= v <= 65535 for v in message["raw"].values()))
        self.assertEqual(message["quality_flags"], [])
        self.assertEqual(message["settings"], {"gain": 16, "led_ma": 10, "led": True, "atime": 100, "astep": 999,
                                               "average": 3, "full_scale": 65535})
        self.assertEqual(message["seq"], 1)
        self.assertEqual(message["device_id"], "pico-deadbeef00000001")

    def test_the_bands_follow_the_spool_in_front_of_the_sensor(self):
        rig = self.make(spool="white")
        white = self.reading(rig)["raw"]
        rig.spool = "red"
        red = self.reading(rig)["raw"]
        self.assertGreater(red["f7"] / white["f7"], 0.6)
        self.assertLess(red["f3"] / white["f3"], 0.1)
        rig.spool = "none"
        self.assertLess(self.reading(rig)["raw"]["f7"], white["f7"] * 0.1)

    def test_the_chips_saturation_bit_and_the_full_scale_raise_the_saturated_flag(self):
        rig = self.make(spool="white")
        rig.command(cmd="set", gain=64)
        self.run_steps(rig)
        self.assertIn("saturated", self.reading(rig)["quality_flags"])

    def test_a_dark_scene_raises_low_light(self):
        rig = self.make(spool="none")
        rig.command(cmd="set", gain=1)
        self.run_steps(rig)
        self.assertIn("low_light", self.reading(rig)["quality_flags"])

    def test_normal_noise_is_not_instability_but_a_drifting_light_is(self):
        rig = self.make(spool="white")
        self.assertNotIn("unstable", self.reading(rig)["quality_flags"])
        rig.drift = 0.3
        flagged = [self.reading(rig) for _ in range(3)]
        self.assertTrue(any("unstable" in m["quality_flags"] for m in flagged))

    def test_a_library_without_the_private_helpers_still_works(self):
        rig = self.make(spool="white", private_names=False)
        message = self.reading(rig)
        self.assertEqual(message["quality_flags"], [])
        self.assertGreater(message["raw"]["f6"], 1000)
        rig.command(cmd="set", gain=64)
        self.run_steps(rig)
        self.assertIn("saturated", self.reading(rig)["quality_flags"])  # by count, as the chip's own bit is out of reach

    def test_a_plain_line_is_printed_for_the_serial_console(self):
        rig = self.make()
        _, plain = self.run_steps(rig)
        self.assertTrue(any(re.match(r"#1 nm 415:\d+ .* clear:\d+  nir:\d+", line) for line in plain), plain)

    def test_the_first_reading_after_a_change_is_thrown_away(self):
        rig = self.make(spool="white")
        before = self.reading(rig)["raw"]["f5"]
        rig.command(cmd="set", gain=8)
        message = self.reading(rig)
        self.assertLess(abs(message["raw"]["f5"] / (before / 2.0) - 1), 0.1)
        self.assertEqual(message["settings"]["gain"], 8)


class Commands(RigCase):
    def acks(self, rig, **body):
        rig.command(**body)
        protocol, _ = self.run_steps(rig)
        return [m for m in protocol if m["t"] in ("ack", "autogain")]

    def test_set_changes_gain_and_light_and_refuses_what_the_chip_or_the_board_cannot_take(self):
        rig = self.make()
        self.run_steps(rig)
        ack = self.acks(rig, cmd="set", gain=32, led_ma=13)[0]
        self.assertEqual((ack["ok"], ack["settings"]["gain"], ack["settings"]["led_ma"]), (True, 32, 12))
        self.assertFalse(self.acks(rig, cmd="set", gain=3)[0]["ok"])
        self.assertFalse(self.acks(rig, cmd="set", led_ma=21)[0]["ok"])
        self.assertFalse(self.acks(rig, cmd="set", led_ma=True)[0]["ok"])
        self.assertEqual(rig.sensor.led_current, 12)
        ack = self.acks(rig, cmd="set", led=False)[0]
        self.assertFalse(ack["settings"]["led"])
        self.assertFalse(rig.sensor.led)

    def test_settings_survive_a_restart(self):
        rig = self.make()
        self.acks(rig, cmd="set", gain=4, led_ma=8)
        again = self.make(nvm=rig.nvm)
        self.assertEqual(self.reading(again)["settings"]["gain"], 4)
        self.assertEqual(self.reading(again)["settings"]["led_ma"], 8)

    def test_a_command_that_is_not_ours_changes_nothing_and_never_stops_the_readings(self):
        rig = self.make()
        self.run_steps(rig)
        for junk in ("hello", "DV1 not json", 'DV1 {"nocmd": 1}', 'DV1 {"cmd": "explode"}', "x" * 500):
            rig.type(junk)
        protocol, _ = self.run_steps(rig)
        self.assertIn("reading", [m["t"] for m in protocol])
        self.assertTrue(all(m["ok"] is False for m in protocol if m["t"] == "ack"))

    def test_hello_answers_with_the_settings_in_force(self):
        rig = self.make()
        self.run_steps(rig)
        rig.command(cmd="hello")
        protocol, _ = self.run_steps(rig)
        hello = [m for m in protocol if m["t"] == "hello"][0]
        self.assertTrue(hello["sensor_ready"])
        self.assertEqual(hello["settings"]["gain"], 16)

    def test_auto_gain_picks_a_gain_that_keeps_the_brightest_channel_under_the_target(self):
        rig = self.make(spool="white")
        self.run_steps(rig)
        result = self.acks(rig, cmd="autogain")[0]
        self.assertTrue(result["ok"], result)
        self.assertIn(result["gain"], rig.firmware.GAINS)
        scale = result["full_scale"]
        self.assertLessEqual(result["peak"], 0.5 * scale * 1.1)
        self.assertGreater(result["peak"], 0.15 * scale)
        self.assertEqual(self.reading(rig)["settings"]["gain"], result["gain"])
        again = self.make(nvm=rig.nvm)
        self.assertEqual(self.reading(again)["settings"]["gain"], result["gain"])

    def test_auto_gain_with_a_dark_scene_says_so_and_puts_the_gain_back(self):
        rig = self.make(spool="none")
        self.run_steps(rig)
        original = sim.STRAY
        sim.STRAY = 0.0
        try:
            result = self.acks(rig, cmd="autogain")[0]
        finally:
            sim.STRAY = original
        self.assertEqual((result["ok"], result["code"]), (False, "too_dark"))
        self.assertEqual(self.reading(rig)["settings"]["gain"], 16)

    def test_auto_gain_with_too_much_light_says_so_and_puts_the_gain_back(self):
        rig = self.make(spool="white")
        self.run_steps(rig)
        original = sim.HOUSING
        sim.HOUSING = 5000.0
        try:
            result = self.acks(rig, cmd="autogain")[0]
        finally:
            sim.HOUSING = original
        self.assertEqual((result["ok"], result["code"]), (False, "too_bright"))
        self.assertEqual(rig.checker.settings["gain"], 16)

    def test_auto_gain_needs_the_light_on(self):
        rig = self.make(spool="white")
        self.acks(rig, cmd="set", led=False)
        result = self.acks(rig, cmd="autogain")[0]
        self.assertEqual((result["ok"], result["code"]), (False, "led_off"))


class Trouble(RigCase):
    def test_loose_wires_are_named_and_a_plain_line_says_what_to_check(self):
        rig = self.make(wiring_ok=False)
        protocol, plain = self.run_steps(rig)
        error = next(m for m in protocol if m["t"] == "error")
        self.assertEqual(error["code"], "wiring")
        self.assertIn("pin 6", error["message"])
        self.assertTrue(plain)

    def test_a_missing_sensor_is_reported_once_and_readings_start_when_it_appears(self):
        rig = self.make(sensor_present=False)
        protocol, _ = self.run_steps(rig, 3)
        self.assertEqual([m["code"] for m in protocol if m["t"] == "error"], ["no_sensor"])
        rig.sensor_present = True
        protocol, _ = self.run_steps(rig)
        self.assertEqual([m["t"] for m in protocol][:2], ["hello", "reading"])

    def test_a_wire_that_comes_loose_mid_run_is_reported_and_recovers(self):
        rig = self.make()
        self.run_steps(rig)
        rig.unplugged = True
        protocol, _ = self.run_steps(rig)
        self.assertEqual(protocol[0]["code"], "sensor_lost")
        rig.unplugged = False
        protocol, _ = self.run_steps(rig, 2)
        self.assertIn("reading", [m["t"] for m in protocol])

    def test_the_hello_still_names_the_board_when_there_is_no_sensor(self):
        rig = self.make(sensor_present=False)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rig.checker.hello()
        hello = lines_of(out.getvalue())[0][0]
        self.assertFalse(hello["sensor_ready"])
        self.assertEqual(hello["device_id"], "pico-deadbeef00000001")


class WithTheApp(RigCase):
    def test_a_reading_is_accepted_by_the_companion_api_as_it_stands(self):
        from unittest import mock

        import mock_moonraker
        import tempfile

        rig = self.make(spool="white")
        message = self.reading(rig)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        patches = (mock.patch.object(companion_sensor, "_PATH", os.path.join(folder.name, "sensors.json")),
                   mock.patch.object(companion_sensor, "_readings", {}),
                   mock.patch.object(mock_moonraker, "selected_printer_id", return_value="real-a"),
                   mock.patch.object(mock_moonraker, "is_real", return_value=True),
                   mock.patch("fleet.registered", return_value=[{"id": "real-a"}]))
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        binding = {key: message[key] for key in ("device_id", "channel_id", "sensor_id", "sensor_model")}
        binding["toolhead"] = "T0"
        companion_sensor.configure({"version": 1, "simulated": False, "bindings": [binding]})
        import time
        reply = companion_sensor.ingest({"version": 1, "simulated": False, "captured_at": time.time(),
                                         **{key: message[key] for key in binding if key != "toolhead"},
                                         "raw": message["raw"], "quality_flags": message["quality_flags"]})
        self.assertTrue(reply["accepted"])
        self.assertEqual(reply["sensor"]["status"], "uncalibrated")


if __name__ == "__main__":
    unittest.main()
