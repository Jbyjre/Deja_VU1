"""
Tests for notifications.py — quiet hours, priority routing, and the
deferred-send queue. These don't test actual delivery (that would mean
depending on ntfy.sh/Discord/Telegram being reachable in a test run) — they
test the decision of whether to send now or queue, which is the real logic.

    python3 -m unittest discover tests
"""

import os
import sys
import unittest
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import notifications      # noqa: E402


class TestQuietHours(unittest.TestCase):

    def test_same_day_window(self):
        settings = {"quiet_hours_start": 22, "quiet_hours_end": 7}
        self.assertFalse(notifications.is_quiet_hours(datetime(2026, 1, 1, 15, 0), settings))
        self.assertTrue(notifications.is_quiet_hours(datetime(2026, 1, 1, 23, 0), settings))

    def test_window_wraps_past_midnight(self):
        settings = {"quiet_hours_start": 22, "quiet_hours_end": 7}
        self.assertTrue(notifications.is_quiet_hours(datetime(2026, 1, 1, 3, 0), settings))
        self.assertFalse(notifications.is_quiet_hours(datetime(2026, 1, 1, 8, 0), settings))

    def test_equal_start_and_end_means_never_quiet(self):
        settings = {"quiet_hours_start": 5, "quiet_hours_end": 5}
        self.assertFalse(notifications.is_quiet_hours(datetime(2026, 1, 1, 5, 0), settings))


class TestSettings(unittest.TestCase):

    def setUp(self):
        notifications.reset()

    def tearDown(self):
        notifications.reset()

    def test_defaults(self):
        settings = notifications.get_settings()
        self.assertEqual(settings["quiet_hours_start"], 22)
        self.assertEqual(settings["quiet_hours_end"], 7)

    def test_save_only_updates_known_keys(self):
        notifications.save_settings({"ntfy_topic": "my-topic", "not_a_real_field": "x"})
        settings = notifications.get_settings()
        self.assertEqual(settings["ntfy_topic"], "my-topic")
        self.assertNotIn("not_a_real_field", settings)


class TestPriorityRouting(unittest.TestCase):

    def setUp(self):
        notifications.reset()
        # No channels configured, so "sending" is a safe no-op in tests —
        # this exercises the routing decision, not real network delivery.

    def tearDown(self):
        notifications.reset()

    def test_high_priority_always_sends_even_in_quiet_hours(self):
        settings = notifications.get_settings()
        settings["quiet_hours_start"] = 0
        settings["quiet_hours_end"] = 23
        result = notifications.notify("failure", priority="high", settings=settings)
        self.assertTrue(result["sent"])
        self.assertFalse(result["queued"])

    def test_normal_priority_queues_during_quiet_hours(self):
        settings = notifications.get_settings()
        settings["quiet_hours_start"] = 0
        settings["quiet_hours_end"] = 23
        result = notifications.notify("done", priority="normal", settings=settings)
        self.assertFalse(result["sent"])
        self.assertTrue(result["queued"])
        self.assertEqual(len(notifications.get_queue()), 1)

    def test_normal_priority_sends_outside_quiet_hours(self):
        settings = notifications.get_settings()
        settings["quiet_hours_start"] = 3
        settings["quiet_hours_end"] = 4
        result = notifications.notify("done", priority="normal", settings=settings)
        self.assertTrue(result["sent"])

    def test_rejects_bad_priority(self):
        with self.assertRaises(ValueError):
            notifications.notify("x", priority="urgent-ish")

    def test_flush_queue_empties_it(self):
        settings = notifications.get_settings()
        settings["quiet_hours_start"] = 0
        settings["quiet_hours_end"] = 23
        notifications.notify("done", priority="normal", settings=settings)
        result = notifications.flush_queue(settings)
        self.assertEqual(result["flushed"], 1)
        self.assertEqual(notifications.get_queue(), [])


class TestPrintEventHelper(unittest.TestCase):

    def setUp(self):
        notifications.reset()

    def tearDown(self):
        notifications.reset()

    def test_failure_is_always_high_priority(self):
        settings = notifications.get_settings()
        settings["quiet_hours_start"] = 0
        settings["quiet_hours_end"] = 23
        result = notifications.notify_print_event("error", "vase.gcode", settings=settings)
        self.assertTrue(result["sent"])

    def test_completed_respects_quiet_hours(self):
        settings = notifications.get_settings()
        settings["quiet_hours_start"] = 0
        settings["quiet_hours_end"] = 23
        result = notifications.notify_print_event("completed", "vase.gcode", settings=settings)
        self.assertTrue(result["queued"])

    def test_unknown_status_is_rejected(self):
        with self.assertRaises(ValueError):
            notifications.notify_print_event("sideways", "vase.gcode")


if __name__ == "__main__":
    unittest.main()
