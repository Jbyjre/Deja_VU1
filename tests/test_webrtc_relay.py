"""
The WebRTC camera relay (webrtc_relay.py): only the printer's own WebRTC camera, only the three
signalling messages, passed through unchanged.

    python3 -m unittest tests.test_webrtc_relay
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mock_moonraker      # noqa: E402
import webrtc_relay        # noqa: E402
from fake_moonraker import FakeMoonraker      # noqa: E402
from test_moonraker_client import fast, wait_for      # noqa: E402


class TestRelay(unittest.TestCase):
    def setUp(self):
        fast(self)
        webrtc_relay.forget()
        self.addCleanup(webrtc_relay.forget)
        self.fake = FakeMoonraker()
        self.addCleanup(self.fake.close)
        # Shaped like the Extended Firmware's moonraker/02_internal_camera.cfg (a full address here,
        # because the stand-in serves the camera on its own port, not port 80).
        self.fake.webcams = [{"name": "case", "enabled": True, "service": "webrtc-camerastreamer",
                              "stream_url": f"{self.fake.url}/webcam/webrtc", "snapshot_url": "/webcam/snapshot.jpg"}]
        self.printer = mock_moonraker.attach_real_printer("real-w", "Camera U1", self.fake.url)
        self.addCleanup(mock_moonraker.detach_real_printer, "real-w")
        self.assertTrue(wait_for(self.printer.is_connected), self.printer.diagnostics()["last_error"])

    def test_the_handshake_passes_through(self):
        self.assertTrue(webrtc_relay.info(self.printer)["available"])
        offer = webrtc_relay.signal(self.printer, {"type": "request", "iceServers": [], "keepAlive": True})
        self.assertEqual((offer["type"], offer["id"]), ("offer", "pc-1"))
        self.assertEqual(webrtc_relay.signal(self.printer, {"type": "answer", "id": "pc-1", "sdp": "v=0"}), {})
        webrtc_relay.signal(self.printer, {"type": "remote_candidate", "id": "pc-1", "candidates": [{"candidate": "x"}]})
        self.assertEqual([m["type"] for m in self.fake.webrtc_messages], ["request", "answer", "remote_candidate"])

    def test_only_signalling_messages_and_only_to_the_printer(self):
        with self.assertRaisesRegex(ValueError, "Only the camera"):
            webrtc_relay.signal(self.printer, {"type": "shell", "cmd": "reboot"})
        with self.assertRaisesRegex(ValueError, "too large"):
            webrtc_relay.signal(self.printer, {"type": "answer", "sdp": "x" * 70000})
        webrtc_relay.forget()
        self.fake.webcams = [{"name": "case", "service": "webrtc-camerastreamer",
                              "stream_url": "http://192.0.2.10/webcam/webrtc"}]     # another machine
        self.assertFalse(webrtc_relay.info(self.printer)["available"])
        with self.assertRaisesRegex(ValueError, "doesn't offer WebRTC"):
            webrtc_relay.signal(self.printer, {"type": "request"})

    def test_a_stock_camera_offers_no_webrtc(self):
        webrtc_relay.forget()
        self.fake.webcams = [{"name": "case", "service": "mjpegstreamer-adaptive", "snapshot_url": "/webcam/snapshot.jpg"}]
        self.assertFalse(webrtc_relay.info(self.printer)["available"])


if __name__ == "__main__":
    unittest.main()
