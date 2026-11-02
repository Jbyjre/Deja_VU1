"""
One printer's failing side checks (an automation rule, the time-lapse, event detection) must not
stop its readings reaching the page: the reading is published first.

    python3 -m unittest tests.test_live_feed_robust
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import live_feed          # noqa: E402
import mock_moonraker     # noqa: E402


class TestReadingsGoOutFirst(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_live_state()
        self.addCleanup(mock_moonraker.reset_live_state)

    def test_a_failing_detector_still_publishes(self):
        pid = mock_moonraker.printer_ids()[0]
        before = (live_feed.snapshot(pid) or {}).get("seq", 0)
        with mock.patch.object(live_feed, "_detect", side_effect=RuntimeError("odd report")):
            live_feed.tick(0.25, count=1)
        after = live_feed.snapshot(pid)
        self.assertGreater(after["seq"], before)

    def test_failing_side_effects_still_publish(self):
        pid = mock_moonraker.printer_ids()[0]
        before = (live_feed.snapshot(pid) or {}).get("seq", 0)
        with mock.patch.object(live_feed, "_side_effects", side_effect=RuntimeError("rule broke")):
            live_feed.tick(0.25, count=1)
        self.assertGreater(live_feed.snapshot(pid)["seq"], before)

    def test_refresh_publishes_even_when_detection_fails(self):
        pid = mock_moonraker.printer_ids()[0]
        with mock.patch.object(live_feed, "_detect", side_effect=RuntimeError("odd report")):
            state = live_feed.refresh(pid)
        self.assertEqual(live_feed.snapshot(pid)["state"], state)


if __name__ == "__main__":
    unittest.main()
