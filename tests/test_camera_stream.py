"""Tests for the MJPEG bridge in backend/camera.py, against a local fake camera."""

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import camera  # noqa: E402

JPEG = b"\xff\xd8\xff\xe0fakejpegdata\xff\xd9"


class FakeCamera(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.end_headers()
        for _ in range(3):
            self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + JPEG + b"\r\n")

    def log_message(self, *args):
        pass


class TestMJPEG(unittest.TestCase):
    def test_splitter_finds_whole_frames_across_chunks(self):
        splitter = camera.FrameSplitter()
        stream = (b"--frame\r\n\r\n" + JPEG) * 2
        found = sum(splitter.feed(stream[i:i + 7]) for i in range(0, len(stream), 7))
        self.assertEqual(found, 2)
        self.assertEqual(camera.latest_frame(), JPEG)

    def test_relay_copies_the_stream_and_feeds_the_watchdog(self):
        server = HTTPServer(("127.0.0.1", 0), FakeCamera)
        thread = threading.Thread(target=server.handle_request, daemon=True)
        thread.start()
        camera._simulate_age(120)
        self.assertTrue(camera.get_status()["frozen"])
        upstream = camera.open_stream(f"http://127.0.0.1:{server.server_port}/stream")
        out = []
        camera.relay(upstream, out.append, lambda: False)
        server.server_close()
        self.assertEqual(b"".join(out).count(JPEG), 3)
        self.assertFalse(camera.get_status()["frozen"])

    def test_no_camera_configured_is_an_honest_error(self):
        camera.save_settings({"stream_url": ""})
        with self.assertRaisesRegex(ValueError, "No camera stream"):
            camera.open_stream()
        with self.assertRaises(ValueError):
            camera.save_settings({"stream_url": "not a url"})


if __name__ == "__main__":
    unittest.main()
