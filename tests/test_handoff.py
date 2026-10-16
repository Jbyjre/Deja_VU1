"""Tests for backend/handoff.py - continue on another device."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import handoff  # noqa: E402


class TestHandoff(unittest.TestCase):
    def setUp(self):
        handoff.reset()

    def test_offers_the_other_devices_view(self):
        handoff.report("laptop", "Laptop", {"printer": "u1-studio", "tab": "files", "file": "cube.gcode"})
        self.assertIsNone(handoff.offer_for("laptop")["offer"])
        offer = handoff.offer_for("phone")["offer"]
        self.assertEqual((offer["printer"], offer["tab"], offer["device_name"]), ("u1-studio", "files", "Laptop"))

    def test_needs_a_device_id(self):
        with self.assertRaises(ValueError):
            handoff.report("", "x", {})


if __name__ == "__main__":
    unittest.main()
