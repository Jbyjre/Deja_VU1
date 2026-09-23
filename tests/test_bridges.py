"""
Tests for wled_bridge.py and home_assistant_bridge.py — outbound HTTP
integrations. No real network calls are made: both are pointed at nothing
configured (the default) to confirm they fail cleanly, and at an
unreachable address to confirm real request attempts are caught rather than
raised.

    python3 -m unittest discover tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import home_assistant_bridge   # noqa: E402
import led_status               # noqa: E402
import wled_bridge              # noqa: E402


class TestWledSettings(unittest.TestCase):

    def setUp(self):
        wled_bridge.reset()

    def tearDown(self):
        wled_bridge.reset()

    def test_defaults_have_no_host(self):
        settings = wled_bridge.get_settings()
        self.assertEqual(settings["host"], "")

    def test_saving_host(self):
        wled_bridge.save_settings({"host": "192.0.2.5", "leds_per_segment": 16})
        settings = wled_bridge.get_settings()
        self.assertEqual(settings["host"], "192.0.2.5")
        self.assertEqual(settings["leds_per_segment"], 16)


class TestWledPush(unittest.TestCase):

    def setUp(self):
        wled_bridge.reset()

    def tearDown(self):
        wled_bridge.reset()

    def test_push_without_host_fails_cleanly(self):
        result = wled_bridge.push_ring_states()
        self.assertFalse(result["ok"])
        self.assertIn("error", result)

    def test_push_to_unreachable_host_fails_cleanly(self):
        wled_bridge.save_settings({"host": "192.0.2.1"})   # TEST-NET-1, never routable
        result = wled_bridge.push_ring_states(ring_states=led_status.get_all_ring_states())
        self.assertFalse(result["ok"])
        self.assertIn("error", result)
        self.assertEqual(result["segments_sent"], 4)

    def test_test_connection_without_host(self):
        result = wled_bridge.test_connection()
        self.assertFalse(result["ok"])


class TestHomeAssistantSettings(unittest.TestCase):

    def setUp(self):
        home_assistant_bridge.reset()

    def tearDown(self):
        home_assistant_bridge.reset()

    def test_defaults_are_empty(self):
        settings = home_assistant_bridge.get_settings()
        self.assertEqual(settings["base_url"], "")
        self.assertEqual(settings["token"], "")

    def test_saving_settings_strips_trailing_slash(self):
        home_assistant_bridge.save_settings({
            "base_url": "http://homeassistant.local:8123/",
            "token": "sekret",
        })
        settings = home_assistant_bridge.get_settings()
        self.assertEqual(settings["base_url"], "http://homeassistant.local:8123")
        self.assertEqual(settings["token"], "sekret")


class TestHomeAssistantPush(unittest.TestCase):

    def setUp(self):
        home_assistant_bridge.reset()

    def tearDown(self):
        home_assistant_bridge.reset()

    def test_push_without_config_fails_cleanly(self):
        result = home_assistant_bridge.push_sensors()
        self.assertFalse(result["ok"])
        self.assertIn("error", result)

    def test_push_to_unreachable_host_fails_cleanly(self):
        home_assistant_bridge.save_settings({
            "base_url": "http://192.0.2.1:8123", "token": "sekret",
        })
        result = home_assistant_bridge.push_sensors()
        self.assertFalse(result["ok"])
        self.assertIn("results", result)
        # Every entity is reported on, not silently dropped: state, progress,
        # layers, bed, chamber, and four readings per toolhead.
        self.assertGreaterEqual(len(result["results"]), 20)
        for entity in ("sensor.dejavu1_state", "sensor.dejavu1_progress",
                       "sensor.dejavu1_t0_temperature", "sensor.dejavu1_chamber_temperature"):
            self.assertIn(entity, result["results"])
            self.assertFalse(result["results"][entity]["ok"])


if __name__ == "__main__":
    unittest.main()
