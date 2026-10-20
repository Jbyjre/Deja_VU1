import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'backend'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import moonraker_client as mc
import stock_camera
from fake_moonraker import FakeMoonraker

class StockCamera(unittest.TestCase):
    def setUp(self):
        self.fake = FakeMoonraker(api_key='private-key')
        self.addCleanup(self.fake.close)
        self.addCleanup(stock_camera.stop_all)
        self.warm = patch.object(stock_camera, 'WARMUP_SECONDS', 0)
        self.warm.start(); self.addCleanup(self.warm.stop)
        self.printer = mc.MoonrakerPrinter('camera-test', 'Bench', self.fake.url, api_key='private-key')

    def test_authenticated_picture_and_stop(self):
        picture = stock_camera.snapshot(self.printer)
        self.assertTrue(picture.startswith(b'\xff\xd8'))
        self.assertTrue(self.fake.camera_monitoring)
        stock_camera.stop_all()
        self.assertIsNone(stock_camera._sessions.get('camera-test'))

    def test_refusal_has_plain_words_and_no_picture(self):
        self.fake.camera_refused = True
        with self.assertRaisesRegex(ValueError, 'Camera method not available'):
            stock_camera.snapshot(self.printer)
        self.assertIsNone(stock_camera._sessions['camera-test'].frame)

    def test_printers_do_not_share_camera_sessions(self):
        other = FakeMoonraker()
        self.addCleanup(other.close)
        printer2 = mc.MoonrakerPrinter('camera-other', 'Other', other.url)
        stock_camera.snapshot(self.printer)
        stock_camera.snapshot(printer2)
        self.assertIsNot(stock_camera._sessions['camera-test'], stock_camera._sessions['camera-other'])
        self.assertTrue(other.camera_monitoring)
