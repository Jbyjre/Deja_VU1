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

    def test_unreachable_camera_is_explained_in_words(self):
        # It used to read "Couldn't reach the camera: <urlopen error [Errno 111] ...>".
        probe = HTTPServer(("127.0.0.1", 0), FakeCamera)
        port = probe.server_port
        probe.server_close()                          # nothing listens there now
        with self.assertRaises(ValueError) as caught:
            camera.open_stream(f"http://127.0.0.1:{port}/stream", timeout=2)
        self.assertEqual(str(caught.exception),
                         f"The camera at 127.0.0.1:{port} refused the connection - "
                         "is it on, and is that the right address and port?")

    def test_watchdog_is_readable_without_a_printer(self):
        # The page reads it to flag a frozen picture; a printer whose link is
        # down must not hide it, since the camera has nothing to do with that.
        import app
        self.assertIn("/api/camera", app._APP_ROUTES)
        self.assertNotIn("/api/camera", app._DATA_ROUTES)


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


class TestFindPrinterCamera(unittest.TestCase):
    """The camera Moonraker lists (moonraker/components/webcam.py), as the Extended Firmware publishes it."""

    def test_candidates_follow_the_listed_camera_and_stay_on_the_printer(self):
        cams = [{"name": "case", "enabled": True, "service": "webrtc-camerastreamer",
                 "stream_url": "/webcam/webrtc", "snapshot_url": "/webcam/snapshot.jpg"},
                {"name": "off", "enabled": False, "stream_url": "/webcam2/webrtc"},
                {"name": "far", "enabled": True, "service": "mjpegstreamer", "stream_url": "http://203.0.113.9/x"}]
        got = camera.stream_candidates("http://192.168.1.5", cams)
        self.assertEqual(got[:3], ["http://192.168.1.5/webcam/stream.mjpg", "http://192.168.1.5/webcam/?action=stream",
                                   "http://192.168.1.5/webcam/snapshot.jpg"])
        self.assertFalse(any("203.0.113.9" in u or "webcam2" in u for u in got))

    def test_an_mjpeg_service_uses_its_own_stream_address(self):
        cams = [{"enabled": True, "service": "mjpegstreamer-adaptive", "stream_url": "/cam/?action=stream"}]
        self.assertEqual(camera.stream_candidates("http://10.0.0.2", cams)[0], "http://10.0.0.2/cam/?action=stream")

    def test_find_saves_the_first_feed_that_really_answers(self):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import moonraker_client as mc
        from fake_moonraker import FakeMoonraker
        fake = FakeMoonraker()
        self.addCleanup(fake.close)
        fake.webcam_picture = JPEG
        host_port = fake.url.split("//")[1]
        fake.webcams = [{"name": "case", "enabled": True, "service": "webrtc-camerastreamer",
                         "stream_url": f"http://{host_port}/webcam/webrtc"}]
        printer = mc.MoonrakerPrinter("find-cam", "Bench", fake.url)
        found = camera.find_printer_stream(printer, timeout=2)
        self.assertEqual(found["stream_url"], f"http://{host_port}/webcam/stream.mjpg")
        fake.webcam_picture = None
        with self.assertRaisesRegex(ValueError, "No camera feed answered"):
            camera.find_printer_stream(printer, timeout=1)
