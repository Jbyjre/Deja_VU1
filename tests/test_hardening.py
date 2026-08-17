"""Focused regression tests for server hardening and browser-facing headers."""

import json
import os
import sys
import threading
import unittest
from http.server import HTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import app as dv_app  # noqa: E402


class HardeningTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, path, data=None, headers=None, method=None):
        request = Request(
            self.base + path,
            data=data,
            headers=headers or {},
            method=method,
        )
        try:
            return urlopen(request, timeout=10)
        except HTTPError as error:
            return error

    def test_security_headers_are_present(self):
        with self.request("/") as response:
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
            self.assertIn("camera=()", response.headers["Permissions-Policy"])

    def test_invalid_json_is_rejected(self):
        response = self.request(
            "/api/maintenance/done?demo=1",
            data=b"{broken",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        self.assertEqual(response.code, 400)
        body = json.loads(response.read())
        self.assertEqual(body["error"], "Invalid JSON body")

    def test_non_object_json_is_rejected(self):
        response = self.request(
            "/api/maintenance/done?demo=1",
            data=b"[]",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        self.assertEqual(response.code, 400)
        body = json.loads(response.read())
        self.assertEqual(body["error"], "JSON body must be an object")

    def test_oversized_json_is_rejected_before_read(self):
        request = Request(
            self.base + "/api/maintenance/done?demo=1",
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(dv_app.MAX_JSON_BODY + 1),
            },
            method="POST",
        )
        try:
            urlopen(request, timeout=10)
            self.fail("expected HTTP 400")
        except HTTPError as error:
            self.assertEqual(error.code, 400)
            body = json.loads(error.read())
            self.assertEqual(body["error"], "Request body is too large")


if __name__ == "__main__":
    unittest.main()
