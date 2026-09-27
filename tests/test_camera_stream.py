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

    def test_only_camera_streams_are_relayed(self):
        self.assertTrue(camera.looks_like_camera("multipart/x-mixed-replace; boundary=frame"))
        self.assertTrue(camera.looks_like_camera("image/jpeg"))
        self.assertFalse(camera.looks_like_camera("text/html; charset=utf-8"))
        self.assertFalse(camera.looks_like_camera(""))

    def test_no_camera_configured_is_an_honest_error(self):
        camera.save_settings({"stream_url": ""})
        with self.assertRaisesRegex(ValueError, "No camera stream"):
            camera.open_stream()
        with self.assertRaises(ValueError):
            camera.save_settings({"stream_url": "not a url"})


if __name__ == "__main__":
    unittest.main()


class TestFramesWithoutAViewer(unittest.TestCase):
    """A real printer's time-lapse needs camera frames while nobody is watching the stream."""

    def setUp(self):
        from http.server import ThreadingHTTPServer
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeCamera)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        camera.save_settings({"stream_url": f"http://127.0.0.1:{self.server.server_address[1]}/stream"})

    def tearDown(self):
        camera._grab["until"] = 0
        self.server.shutdown()
        self.server.server_close()
        camera.save_settings({"stream_url": ""})

    def test_frames_keep_coming_while_asked_and_stale_ones_dont_count(self):
        import time
        with camera._frame_lock:
            camera._latest_frame, camera._latest_frame_mono = b"old", time.monotonic() - 3600
        self.assertIsNone(camera.latest_frame(max_age=15))          # an hour-old frame is no frame
        self.assertTrue(camera.keep_frames_coming(3))
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and camera.latest_frame(max_age=15) != JPEG:
            time.sleep(0.05)
        self.assertEqual(camera.latest_frame(max_age=15), JPEG)

    def test_nothing_is_read_without_a_camera(self):
        camera.save_settings({"stream_url": ""})
        self.assertFalse(camera.keep_frames_coming(3))
