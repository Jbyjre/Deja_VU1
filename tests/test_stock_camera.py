from pathlib import Path
import sys
import tempfile
import time
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
        self.warm.start()
        self.addCleanup(self.warm.stop)
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

    def test_monitor_request_carries_the_req_id_snapmaker_expects(self):
        stock_camera.snapshot(self.printer)
        start = self.fake.camera_params[0]
        self.assertEqual((start['domain'], start['interval']), ('lan', 0))
        self.assertIsInstance(start['req_id'], int)

    def test_a_failed_state_reply_is_a_failure_not_a_picture(self):
        # u1-moonraker repeater.py answers {"state": "failed"} instead of an error.
        self.fake.camera_failed = 'camera service busy'
        with self.assertRaisesRegex(ValueError, 'camera service busy'):
            stock_camera.snapshot(self.printer)

    def test_listed_webcam_is_used_first_and_only_on_the_printer(self):
        # The Extended Firmware lists its camera with Moonraker (/webcam/snapshot.jpg).
        host, port = self.fake.url.split('//')[1].split(':')
        self.fake.webcams = [
            {'name': 'elsewhere', 'enabled': True, 'snapshot_url': 'http://203.0.113.9/snap.jpg'},
            {'name': 'case', 'enabled': True, 'service': 'webrtc-camerastreamer', 'stream_url': '/webcam/webrtc',
             'snapshot_url': f'http://{host}:{port}/webcam/snapshot.jpg'}]
        self.fake.webcam_picture = b'\xff\xd8extended-firmware\xff\xd9'
        self.assertEqual(stock_camera.snapshot(self.printer), self.fake.webcam_picture)
        self.assertEqual(self.fake.camera_params, [])
        self.assertEqual(stock_camera._sessions['camera-test'].source, 'webcam')

    def test_a_broken_listed_webcam_falls_back_to_the_monitor(self):
        host, port = self.fake.url.split('//')[1].split(':')
        self.fake.webcams = [{'name': 'case', 'enabled': True, 'snapshot_url': f'http://{host}:{port}/webcam/snapshot.jpg'}]
        picture = stock_camera.snapshot(self.printer)
        self.assertTrue(picture.startswith(b'\xff\xd8fake-camera-fixture'))
        self.assertEqual(stock_camera._sessions['camera-test'].source, 'monitor')

    def test_printers_do_not_share_camera_sessions(self):
        other = FakeMoonraker()
        self.addCleanup(other.close)
        printer2 = mc.MoonrakerPrinter('camera-other', 'Other', other.url)
        stock_camera.snapshot(self.printer)
        stock_camera.snapshot(printer2)
        self.assertIsNot(stock_camera._sessions['camera-test'], stock_camera._sessions['camera-other'])
        self.assertTrue(other.camera_monitoring)

    def test_time_lapse_uses_authenticated_selected_printer_camera(self):
        import mock_moonraker as fleet
        import timelapse
        import storage

        self.printer.start()
        self.addCleanup(self.printer.stop)
        deadline=time.monotonic()+5
        while not self.printer.is_connected() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(self.printer.is_connected())
        with tempfile.TemporaryDirectory() as folder,patch.object(timelapse,'_ROOT',folder),patch.dict(fleet._REAL,{'camera-test':self.printer}),patch('modules.is_enabled',return_value=True):
            session=timelapse.begin('camera-test','fixture.gcode','printer camera')
            try:
                timelapse._capture_camera('camera-test',5,session)
                meta=storage.load_json(timelapse._meta_path('camera-test',session),{})
                self.assertEqual(meta['frames'], 1)
                self.assertIsNone(meta['last_error'])
                self.assertTrue(Path(timelapse._dir('camera-test',session),'00001.jpg').read_bytes().startswith(b'\xff\xd8'))
                self.assertTrue(self.fake.camera_monitoring)
            finally:
                timelapse._active.pop('camera-test', None)
