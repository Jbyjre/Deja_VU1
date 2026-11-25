"""How the page's files reach the browser, and how the connection holds.

- The page's text files are sent compressed and cached (backend/static_files.py), with a short 304 for a file the
  browser already has. A browser on this computer gets them plain, since compressing only costs time there.
- A browser keeps one connection for many files (HTTP/1.1 keep-alive), but a stream, the live link and every POST
  still close theirs, so nothing waits on a connection that never ends. Replies leave at once (no Nagle wait).
- The server listens on IPv6 and IPv4 together where it can (DualStackServer), so "localhost" answers at once on
  either, and falls back to IPv4 alone where IPv6 is missing.
- A caller on this computer reached over the dual-stack socket still counts as this computer.
- The live link sends a line of its own every 20 seconds, which the page watches to reconnect a link gone quiet.
"""

import errno
import gzip
import http.client
import os
import sys
import threading
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import app as dv_app  # noqa: E402
import static_files  # noqa: E402
from app_part1 import DejaVuServer  # noqa: E402

FRONTEND = os.path.join(ROOT, "frontend")


class ServerCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = DejaVuServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.port = cls.server.server_port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def connect(self):
        return http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)

    def get(self, conn, path, **headers):
        headers.setdefault("Host", "localhost")
        conn.request("GET", path, headers=headers)
        response = conn.getresponse()
        return response, response.read()


class TestCompressedFiles(ServerCase):
    """These requests come from this computer, so each test stands in for a phone on the same network."""

    def setUp(self):
        patcher = mock.patch.object(static_files, "same_computer", return_value=False)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_script_is_sent_compressed_and_whole(self):
        conn = self.connect()
        response, body = self.get(conn, "/app.js", **{"Accept-Encoding": "gzip, deflate"})
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Encoding"), "gzip")
        self.assertEqual(response.getheader("Vary"), "Accept-Encoding")
        self.assertIn("javascript", response.getheader("Content-Type"))
        with open(os.path.join(FRONTEND, "app.js"), "rb") as f:
            self.assertEqual(gzip.decompress(body), f.read())
        self.assertLess(len(body), os.path.getsize(os.path.join(FRONTEND, "app.js")))
        conn.close()

    def test_a_file_the_browser_has_gets_a_short_304(self):
        conn = self.connect()
        response, _ = self.get(conn, "/app.js", **{"Accept-Encoding": "gzip"})
        etag = response.getheader("ETag")
        self.assertTrue(etag)
        response, body = self.get(conn, "/app.js", **{"Accept-Encoding": "gzip", "If-None-Match": etag})
        self.assertEqual(response.status, 304)
        self.assertEqual(body, b"")
        conn.close()

    def test_the_page_itself_is_compressed(self):
        conn = self.connect()
        response, body = self.get(conn, "/", **{"Accept-Encoding": "gzip"})
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Encoding"), "gzip")
        self.assertIn(b"<html", gzip.decompress(body)[:2000].lower())
        conn.close()

    def test_left_as_they_are(self):
        conn = self.connect()
        cases = [
            ("/app.js", {}),                                                    # a browser that can't unpack it
            ("/app.js", {"Accept-Encoding": "gzip", "Range": "bytes=0-99"}),    # part of a file
            ("/icon-192.png", {"Accept-Encoding": "gzip"}),                     # already compressed
            ("/manifest.webmanifest", {"Accept-Encoding": "gzip"}),             # too small to be worth it
        ]
        for path, headers in cases:
            with self.subTest(path=path, headers=headers):
                response, _ = self.get(conn, path, **headers)
                self.assertIn(response.status, (200, 206))
                self.assertIsNone(response.getheader("Content-Encoding"))
        conn.close()

    def test_a_changed_file_is_compressed_again(self):
        path = os.path.join(FRONTEND, "app.js")
        stat = os.stat(path)
        first = static_files._compressed(path, stat)
        fake = mock.Mock(st_mtime_ns=stat.st_mtime_ns + 1, st_size=stat.st_size)
        with mock.patch.object(static_files.gzip, "compress", return_value=b"new") as compress:
            self.assertEqual(static_files._compressed(path, fake), b"new")
            compress.assert_called_once()
        static_files._cache.pop(path, None)
        self.assertEqual(static_files._compressed(path, stat), first)


class TestThisComputerGetsFilesPlain(ServerCase):
    def test_a_browser_on_this_computer_is_not_sent_compressed_files(self):
        conn = self.connect()
        response, body = self.get(conn, "/app.js", **{"Accept-Encoding": "gzip"})
        self.assertEqual(response.status, 200)
        self.assertIsNone(response.getheader("Content-Encoding"))
        self.assertEqual(len(body), os.path.getsize(os.path.join(FRONTEND, "app.js")))
        conn.close()

    def test_every_loopback_form_counts_and_a_phone_does_not(self):
        def who(ip):
            return static_files.same_computer(mock.Mock(client_address=(ip, 5000)))
        self.assertTrue(who("127.0.0.1"))
        self.assertTrue(who("::1"))
        self.assertTrue(who("::ffff:127.0.0.1"))
        self.assertFalse(who("192.168.1.20"))
        self.assertFalse(who("::ffff:192.168.1.20"))


class TestOneConnectionForManyFiles(ServerCase):
    def test_files_share_one_connection(self):
        conn = self.connect()
        self.get(conn, "/app.js", **{"Accept-Encoding": "gzip"})
        first = conn.sock
        self.assertIsNotNone(first)
        response, _ = self.get(conn, "/rail.js", **{"Accept-Encoding": "gzip"})
        self.assertEqual(response.status, 200)
        self.assertIs(conn.sock, first)                    # the same socket answered the second file
        response, _ = self.get(conn, "/api/app/alive")
        self.assertEqual(response.status, 200)
        self.assertIs(conn.sock, first)
        conn.close()

    def test_a_reply_is_not_held_back_on_a_connection_that_stays_open(self):
        # Without it, each file on a kept-open connection waits about 40 ms for the previous write to be acknowledged.
        self.assertTrue(dv_app.DejaVuHandler.disable_nagle_algorithm)

    def test_a_post_closes_its_connection(self):
        conn = self.connect()
        conn.request("POST", "/api/nothing-here", body=b"{}", headers={
            "Host": "localhost", "Content-Type": "application/json", "Origin": f"http://localhost:{self.port}"})
        response = conn.getresponse()
        response.read()
        self.assertEqual((response.getheader("Connection") or "").lower(), "close")
        conn.close()

    def test_a_reply_with_no_length_closes_its_connection(self):
        handler = object.__new__(dv_app.DejaVuHandler)
        handler.request_version = "HTTP/1.1"
        handler.command = "GET"
        handler._headers_buffer = []
        handler.wfile = mock.Mock()
        handler.close_connection = False
        handler.log_request = lambda *a, **k: None
        handler.requestline = "GET /api/x HTTP/1.1"
        handler.path = "/api/x"
        handler.send_response(200)
        handler.send_header("Content-Type", "text/plain")
        handler.end_headers()
        self.assertTrue(handler.close_connection)
        sent = b"".join(c.args[0] for c in handler.wfile.write.call_args_list)
        self.assertIn(b"Connection: close", sent)

    def test_a_stream_closes_its_connection(self):
        with open(os.path.join(ROOT, "backend", "app.py"), encoding="utf-8") as f:
            source = f.read()
        stream = source[source.index("def _send_stream"):]
        self.assertIn("self._no_keep_alive()", stream[:stream.index("\n    def ", 10)])


class TestListening(unittest.TestCase):
    def test_falls_back_to_ipv4_where_ipv6_is_missing(self):
        missing = OSError(errno.EAFNOSUPPORT, "Address family not supported by protocol")
        with mock.patch.object(dv_app, "DualStackServer", side_effect=missing), \
                mock.patch.object(dv_app, "DejaVuServer", return_value="ipv4") as ipv4, \
                mock.patch.object(dv_app.socket, "has_ipv6", True):
            self.assertEqual(dv_app._listen(), "ipv4")
        self.assertEqual(ipv4.call_args.args[0][0], "0.0.0.0")

    def test_a_port_in_use_is_not_hidden_by_the_fallback(self):
        busy = OSError(errno.EADDRINUSE, "Address already in use")
        with mock.patch.object(dv_app, "DualStackServer", side_effect=busy), \
                mock.patch.object(dv_app, "DejaVuServer") as ipv4, \
                mock.patch.object(dv_app.socket, "has_ipv6", True):
            with self.assertRaises(OSError):
                dv_app._listen()
        ipv4.assert_not_called()

    def test_ipv4_only_by_choice(self):
        with mock.patch.dict(os.environ, {"DEJAVU_IPV4_ONLY": "1"}), \
                mock.patch.object(dv_app, "DualStackServer") as dual, \
                mock.patch.object(dv_app, "DejaVuServer", return_value="ipv4"):
            self.assertEqual(dv_app._listen(), "ipv4")
        dual.assert_not_called()


class TestThisComputer(unittest.TestCase):
    def judge(self, ip, host="localhost:8000"):
        handler = object.__new__(dv_app.DejaVuHandler)
        handler.client_address = (ip, 50000)
        handler.headers = {"Host": host}
        return handler._this_computer()

    def test_loopback_in_every_form_counts(self):
        self.assertTrue(self.judge("127.0.0.1"))
        self.assertTrue(self.judge("::1", "[::1]:8000"))
        self.assertTrue(self.judge("::ffff:127.0.0.1"))                # IPv4 on the dual-stack socket

    def test_another_device_does_not(self):
        self.assertFalse(self.judge("::ffff:192.168.1.20"))
        self.assertFalse(self.judge("192.168.1.20"))
        self.assertFalse(self.judge("127.0.0.1", "deja.example.net"))   # a tunnel's name


class TestTheLiveLinkStaysAwake(unittest.TestCase):
    def test_the_server_sends_a_line_the_page_can_hear(self):
        with open(os.path.join(ROOT, "backend", "app_get.py"), encoding="utf-8") as f:
            self.assertIn('conn.send_text(\'{"type":"alive"}\')', f.read())

    def test_the_page_reconnects_a_quiet_link(self):
        with open(os.path.join(FRONTEND, "workshop-part5.js"), encoding="utf-8") as f:
            part = f.read()
        with open(os.path.join(FRONTEND, "workshop.js"), encoding="utf-8") as f:
            main = f.read()
        self.assertIn("live.heardAt = performance.now()", part)
        self.assertIn("LIVE_SILENT_MS", part)
        self.assertIn("setInterval(watchLive, 10000)", main)


if __name__ == "__main__":
    unittest.main()
