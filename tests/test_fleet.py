"""Tests for backend/fleet.py - the registry of real printers and the overview."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import fleet           # noqa: E402
import mock_moonraker  # noqa: E402


class TestFleet(unittest.TestCase):
    def setUp(self):
        fleet.reset()
        mock_moonraker.reset_all()

    def tearDown(self):
        fleet.reset()

    def test_register_validates_and_never_claims_a_connection(self):
        entry = fleet.add("Bench U1", "http://192.168.1.50:7125")
        self.assertFalse(entry["connected"])
        self.assertEqual(fleet.registry()["printers"][0]["name"], "Bench U1")
        for name, url in (("", "http://x.local"), ("A", "ftp://x"), ("A", "http://bad host")):
            with self.assertRaises(ValueError):
                fleet.add(name, url)
        fleet.remove(entry["id"])
        self.assertEqual(fleet.registry()["printers"], [])

    def test_overview_rows(self):
        rows = {p["id"]: p for p in fleet.overview()["printers"]}
        self.assertEqual(rows["u1-workshop"]["state"], "printing")
        self.assertIsNotNone(rows["u1-workshop"]["remaining_hours"])
        self.assertEqual(rows["u1-studio"]["state"], "paused")
        self.assertIn("Paused", [a["text"] for a in rows["u1-studio"]["alerts"]])
        self.assertEqual(rows["u1-garage"]["docks"]["T3"]["status"], "error")
        self.assertTrue(0 <= rows["u1-garage"]["health"] <= 100)


if __name__ == "__main__":
    unittest.main()
