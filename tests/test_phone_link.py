"""
Opening the dashboard on a phone: the QR code maker (backend/qr.py) and
POST /api/pairing/link, which hands a phone the address, a one-time pairing
code and a QR code of both.

The QR matrices below are pinned to the output of an independent library
(python-qrcode 8, same version, level M and mask), checked when qr.py was
written; scanning was also checked with the zxing-cpp and OpenCV readers.
Those libraries are not needed to run these tests.
"""

import hashlib
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.dirname(__file__))

import app as dv_app         # noqa: E402
import discovery             # noqa: E402
import pairing               # noqa: E402
import qr                    # noqa: E402
from test_api import APITestCase  # noqa: E402


def _digest(rows):
    return hashlib.sha256("\n".join(rows).encode()).hexdigest()


class TestQrCode(unittest.TestCase):

    def test_matches_an_independent_encoder(self):
        self.assertEqual(_digest(qr.rows("http://192.168.1.23:8000/?pair=123456")),
                         "4eb482b4a15b8a6b0546d9f3b39d127afe317d389f7456f76bb08e46f86bea2b")
        self.assertEqual(_digest(qr.rows("http://10.0.0.10:8000/")),
                         "85d4daaf1939d06c7f8f32540f7ee5f2908ce3d262381e97c6c4ba8b960dfab2")

    def test_size_grows_with_the_text(self):
        self.assertEqual(len(qr.matrix("x")), 21)                  # version 1
        self.assertEqual(len(qr.matrix("x" * 213)), 57)            # version 10, the largest here
        with self.assertRaises(ValueError):
            qr.matrix("x" * 214)

    def test_every_size_has_its_three_finder_squares(self):
        for length in (1, 30, 60, 100, 150, 200):
            grid = qr.matrix("a" * length)
            n = len(grid)
            for cx, cy in ((3, 3), (n - 4, 3), (3, n - 4)):
                self.assertTrue(grid[cy][cx])                       # the dark centre
                self.assertFalse(grid[cy - 2][cx])                  # the light ring
                self.assertTrue(grid[cy - 3][cx])                   # the dark outer ring
            self.assertTrue(grid[n - 8][8])                         # the always-dark module

    def test_terminal_drawing_is_two_rows_per_line(self):
        lines = qr.terminal("http://10.0.0.10:8000/", quiet=2)
        size = len(qr.matrix("http://10.0.0.10:8000/")) + 4
        self.assertEqual(len(lines), (size + 1) // 2)
        self.assertTrue(all(len(line) == size for line in lines))
        self.assertTrue(set("".join(lines)) <= set("█▀▄ "))


class TestPhoneLink(APITestCase):

    def setUp(self):
        super().setUp()
        pairing.reset()

    def tearDown(self):
        super().tearDown()
        pairing.reset()

    def test_localhost_page_gets_the_computers_home_address(self):
        with mock.patch.object(discovery, "home_addresses", return_value=["192.168.1.23", "10.8.0.2"]):
            status, body = self.post("/api/pairing/link", {"base": "http://localhost:8000"})
        self.assertEqual(status, 200)
        self.assertEqual(body["origin"], f"http://192.168.1.23:{dv_app.PORT}")
        self.assertEqual(body["url"], f"{body['origin']}/?pair={body['code']}")
        self.assertEqual(body["others"], [f"http://10.8.0.2:{dv_app.PORT}"])
        self.assertEqual(body["qr"], qr.rows(body["url"]))

    def test_a_page_opened_by_network_address_keeps_that_address(self):
        with mock.patch.object(discovery, "home_addresses", return_value=["192.168.1.23"]):
            status, body = self.post("/api/pairing/link", {"base": "http://192.168.1.50:8123"})
        self.assertEqual(body["origin"], "http://192.168.1.50:8123")
        self.assertEqual(body["others"], [f"http://192.168.1.23:{dv_app.PORT}"])

    def test_a_foreign_name_is_never_put_in_the_code(self):
        # Only names the server itself answers to (host_is_local) are used.
        with mock.patch.object(discovery, "home_addresses", return_value=["192.168.1.23"]):
            for base in ("https://evil.example.com", "http://user@192.168.1.9:8000", "javascript:alert(1)", 42):
                status, body = self.post("/api/pairing/link", {"base": base})
                self.assertEqual(status, 200)
                self.assertEqual(body["origin"], f"http://192.168.1.23:{dv_app.PORT}", base)

    def test_no_home_network_says_so_instead_of_inventing_an_address(self):
        with mock.patch.object(discovery, "home_addresses", return_value=[]):
            status, body = self.post("/api/pairing/link", {"base": "http://127.0.0.1:8000"})
        self.assertEqual(status, 200)
        self.assertIsNone(body["origin"])
        self.assertNotIn("qr", body)

    def test_the_code_in_the_link_pairs_the_phone_once(self):
        with mock.patch.object(discovery, "home_addresses", return_value=["192.168.1.23"]):
            _, body = self.post("/api/pairing/link", {})
        status, device = self.post("/api/pairing/redeem", {"code": body["code"], "device_name": "iPhone"})
        self.assertEqual(status, 200)
        self.assertEqual(device["name"], "iPhone")
        status, _ = self.post("/api/pairing/redeem", {"code": body["code"], "device_name": "Again"})
        self.assertEqual(status, 400)

    def test_a_new_link_replaces_the_old_code(self):
        _, first = self.post("/api/pairing/link", {})
        _, second = self.post("/api/pairing/link", {})
        if first["code"] != second["code"]:
            status, _ = self.post("/api/pairing/redeem", {"code": first["code"], "device_name": "Old"})
            self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
