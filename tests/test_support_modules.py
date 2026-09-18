"""
Tests for the smaller support modules: updates, backup, camera, pairing.

    python3 -m unittest discover tests
"""

import os
import sys
import unittest
import zipfile
from io import BytesIO

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import backup       # noqa: E402
import camera        # noqa: E402
import pairing       # noqa: E402
import updates       # noqa: E402


class TestUpdates(unittest.TestCase):

    def test_reports_a_package_list(self):
        status = updates.get_status()
        names = [p["name"] for p in status["packages"]]
        self.assertIn("klipper", names)
        self.assertIn("moonraker", names)

    def test_counts_available_updates(self):
        status = updates.get_status()
        expected = sum(1 for p in status["packages"] if p["update_available"])
        self.assertEqual(status["updates_available"], expected)


class TestBackup(unittest.TestCase):

    def test_produces_a_valid_zip(self):
        filename, data = backup.create_backup()
        self.assertTrue(filename.endswith(".zip"))
        archive = zipfile.ZipFile(BytesIO(data))
        self.assertIsNone(archive.testzip())

    def test_includes_a_manifest(self):
        _, data = backup.create_backup()
        archive = zipfile.ZipFile(BytesIO(data))
        self.assertIn("manifest.json", archive.namelist())

    def test_skips_files_that_do_not_exist_yet(self):
        # A fresh checkout may not have generated any data/*.json yet — the
        # backup should still succeed with just a manifest, not crash.
        filename, data = backup.create_backup()
        self.assertGreater(len(data), 0)


class TestCamera(unittest.TestCase):

    def setUp(self):
        camera.reset()

    def tearDown(self):
        camera.reset()

    def test_fresh_frame_is_not_frozen(self):
        status = camera.get_status()
        self.assertFalse(status["frozen"])

    def test_stale_frame_is_flagged_frozen(self):
        camera._simulate_age(camera.STALE_AFTER_SECONDS + 5)
        status = camera.get_status()
        self.assertTrue(status["frozen"])

    def test_receiving_a_frame_clears_the_freeze(self):
        camera._simulate_age(camera.STALE_AFTER_SECONDS + 5)
        camera.receive_frame()
        status = camera.get_status()
        self.assertFalse(status["frozen"])


class TestPairing(unittest.TestCase):

    def setUp(self):
        pairing.reset()

    def tearDown(self):
        pairing.reset()

    def test_redeeming_correct_code_pairs_a_device(self):
        generated = pairing.generate_code()
        device = pairing.redeem_code(generated["code"], "My Phone")
        self.assertEqual(device["name"], "My Phone")
        self.assertIn(device, pairing.list_devices())

    def test_wrong_code_is_rejected(self):
        pairing.generate_code()
        with self.assertRaises(ValueError):
            pairing.redeem_code("000000", "My Phone")

    def test_no_code_generated_yet_is_rejected(self):
        with self.assertRaises(ValueError):
            pairing.redeem_code("123456", "My Phone")

    def test_blank_device_name_gets_a_default(self):
        generated = pairing.generate_code()
        device = pairing.redeem_code(generated["code"], "   ")
        self.assertEqual(device["name"], "New device")

    def test_unpair_removes_a_device(self):
        generated = pairing.generate_code()
        device = pairing.redeem_code(generated["code"], "My Phone")
        remaining = pairing.unpair(device["id"])
        self.assertNotIn(device["id"], [d["id"] for d in remaining])

    def test_unpair_unknown_device_is_rejected(self):
        with self.assertRaises(ValueError):
            pairing.unpair("not-a-real-device")


if __name__ == "__main__":
    unittest.main()
