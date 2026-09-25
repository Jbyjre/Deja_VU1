"""
The optional low-latency camera: a small fake go2rtc stands in for the real
one, answering exactly the call go2rtc documents in its source
(POST /api/webrtc?src=NAME with a JSON offer -> JSON answer). go2rtc itself
is never needed to run these tests.
"""

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import app as dv_app       # noqa: E402
import modules             # noqa: E402
import webrtc_camera       # noqa: E402

OFFER = {"type": "offer", "sdp": "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n"}
ANSWER_SDP = "v=0\r\no=go2rtc 3 4 IN IP4 127.0.0.1\r\ns=-\r\n"


class FakeGo2rtc(BaseHTTPRequestHandler):
    """Behaves like go2rtc's outputWebRTC for the JSON content type."""
    seen = []
    reply = "answer"          # or "garbage", "error"

    def do_POST(self):
        url = urlparse(self.path)
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        FakeGo2rtc.seen.append({"path": url.path, "query": parse_qs(url.query),
                                "ctype": self.headers.get("Content-Type"), "body": body})
        if url.path != "/api/webrtc" or parse_qs(url.query).get("src") != ["u1"]:
            self.send_response(404); self.end_headers(); self.wfile.write(b"stream not found")
            return
        if FakeGo2rtc.reply == "error":
            self.send_response(500); self.end_headers(); self.wfile.write(b"codecs not matched")
            return
        out = b"<html>not sdp</html>" if FakeGo2rtc.reply == "garbage" else \
            json.dumps({"type": "answer", "sdp": ANSWER_SDP}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


class WebRTCCamera(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = ThreadingHTTPServer(("127.0.0.1", 0), FakeGo2rtc)
        cls.fake_url = f"http://127.0.0.1:{cls.fake.server_port}"
        threading.Thread(target=cls.fake.serve_forever, daemon=True).start()
        cls.server = dv_app.DejaVuServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for s in (cls.fake, cls.server):
            s.shutdown(); s.server_close()

    def setUp(self):
        webrtc_camera.reset()
        modules.reset_state()
        FakeGo2rtc.seen = []
        FakeGo2rtc.reply = "answer"

    def tearDown(self):
        webrtc_camera.reset()
        modules.reset_state()

    def request(self, path, body=None):
        req = Request(self.base + path, data=json.dumps(body).encode() if body is not None else None,
                      headers={"Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=10) as resp:
                return resp.status, json.loads(resp.read())
        except HTTPError as err:
            return err.code, json.loads(err.read() or b"{}")

    def turn_on(self):
        modules.set_enabled("webrtc_camera", True)

    # -- off by default, and a separate program --------------------------

    def test_off_by_default_and_every_route_says_so(self):
        entry = next(m for m in modules.get_all() if m["id"] == "webrtc_camera")
        self.assertFalse(entry["enabled"])
        self.assertEqual(entry["status"], "optional")
        for path, body in (("/api/camera/webrtc/settings", None),
                           ("/api/camera/webrtc/settings", {"go2rtc_url": self.fake_url, "stream": "u1"}),
                           ("/api/camera/webrtc/offer", OFFER)):
            status, data = self.request(path, body)
            self.assertEqual(status, 403, path)
            self.assertTrue(data["module_disabled"])
        self.assertEqual(FakeGo2rtc.seen, [])

    def test_backend_never_imports_go2rtc(self):
        src = open(webrtc_camera.__file__, encoding="utf-8").read()
        imports = [line for line in src.splitlines() if line.startswith(("import ", "from "))]
        self.assertTrue(all(line.split()[1].split(".")[0] in
                            {"json", "os", "re", "urllib", "storage"} for line in imports), imports)

    # -- settings --------------------------------------------------------

    def test_settings_start_empty_and_save(self):
        self.turn_on()
        self.assertEqual(self.request("/api/camera/webrtc/settings"), (200, {"go2rtc_url": "", "stream": ""}))
        status, data = self.request("/api/camera/webrtc/settings", {"go2rtc_url": self.fake_url + "/", "stream": "u1"})
        self.assertEqual(status, 200)
        self.assertEqual(data, {"go2rtc_url": self.fake_url, "stream": "u1"})
        status, data = self.request("/api/camera/webrtc/settings", {"go2rtc_url": "", "stream": ""})
        self.assertEqual(data, {"go2rtc_url": "", "stream": ""})

    def test_settings_reject_bad_values_in_words(self):
        self.turn_on()
        for body in ({"go2rtc_url": "ftp://x", "stream": "u1"},
                     {"go2rtc_url": self.fake_url, "stream": "bad name"},
                     {"go2rtc_url": self.fake_url, "stream": ""},
                     {"go2rtc_url": self.fake_url + "/?src=x", "stream": "u1"}):
            status, data = self.request("/api/camera/webrtc/settings", body)
            self.assertEqual(status, 400, body)
            self.assertTrue(data["error"])

    # -- the signalling exchange -----------------------------------------

    def test_offer_goes_to_go2rtc_exactly_as_its_api_expects(self):
        self.turn_on()
        self.request("/api/camera/webrtc/settings", {"go2rtc_url": self.fake_url, "stream": "u1"})
        status, data = self.request("/api/camera/webrtc/offer", OFFER)
        self.assertEqual(status, 200)
        self.assertEqual(data, {"type": "answer", "sdp": ANSWER_SDP})
        call = FakeGo2rtc.seen[0]
        self.assertEqual(call["path"], "/api/webrtc")
        self.assertEqual(call["query"], {"src": ["u1"]})
        self.assertEqual(call["ctype"], "application/json")
        self.assertEqual(json.loads(call["body"]), OFFER)

    def test_not_set_up_is_an_error_not_a_fake_answer(self):
        self.turn_on()
        status, data = self.request("/api/camera/webrtc/offer", OFFER)
        self.assertEqual(status, 400)
        self.assertIn("isn't set up", data["error"])

    def test_bad_offer_never_reaches_go2rtc(self):
        self.turn_on()
        self.request("/api/camera/webrtc/settings", {"go2rtc_url": self.fake_url, "stream": "u1"})
        for bad in ({"type": "answer", "sdp": "v=0"}, {"type": "offer", "sdp": "hello"},
                    {"type": "offer", "sdp": "v=0" + "x" * webrtc_camera.MAX_SDP}, {}):
            status, data = self.request("/api/camera/webrtc/offer", bad)
            self.assertEqual(status, 400)
        self.assertEqual(FakeGo2rtc.seen, [])

    def test_go2rtc_failures_are_reported_in_words(self):
        self.turn_on()
        self.request("/api/camera/webrtc/settings", {"go2rtc_url": self.fake_url, "stream": "nope"})
        status, data = self.request("/api/camera/webrtc/offer", OFFER)
        self.assertEqual(status, 400)
        self.assertIn('no stream called "nope"', data["error"])

        self.request("/api/camera/webrtc/settings", {"go2rtc_url": self.fake_url, "stream": "u1"})
        FakeGo2rtc.reply = "error"
        status, data = self.request("/api/camera/webrtc/offer", OFFER)
        self.assertEqual(status, 400)
        self.assertIn("refused the connection (500", data["error"])

        FakeGo2rtc.reply = "garbage"
        status, data = self.request("/api/camera/webrtc/offer", OFFER)
        self.assertEqual(status, 400)
        self.assertIn("wasn't the expected WebRTC answer", data["error"])

    def test_go2rtc_not_running(self):
        self.turn_on()
        self.request("/api/camera/webrtc/settings", {"go2rtc_url": "http://127.0.0.1:9", "stream": "u1"})
        status, data = self.request("/api/camera/webrtc/offer", OFFER)
        self.assertEqual(status, 400)
        self.assertIn("Couldn't reach go2rtc", data["error"])

    def test_signalling_url_escapes_the_stream_name(self):
        url = webrtc_camera.signalling_url({"go2rtc_url": "http://h:1984", "stream": "a:b"})
        self.assertEqual(url, "http://h:1984/api/webrtc?src=a%3Ab")


if __name__ == "__main__":
    unittest.main()
