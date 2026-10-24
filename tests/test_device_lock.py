"""
The device lock: with it on, only this computer (reached as localhost) and
paired devices can use the dashboard. Tested against the real server; a
request with a network-address Host header stands in for another device
(or a tunnel), exactly as the server tells them apart.
"""
import json
import os
import sys
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
import app as dv_app       # noqa: E402
import pairing             # noqa: E402


class DeviceLock(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = dv_app.DejaVuServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.port = cls.server.server_port
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        pairing.reset()
        self.addCleanup(pairing.reset)

    def call(self, path, body=None, host="localhost", cookie=None):
        headers = {"Host": f"{host}:{self.port}", "Content-Type": "application/json"}
        if cookie:
            headers["Cookie"] = cookie
        req = Request(f"http://127.0.0.1:{self.port}{path}", data=None if body is None else json.dumps(body).encode(),
                      headers=headers, method="GET" if body is None else "POST")
        try:
            with urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read()), r.headers.get("Set-Cookie")
        except HTTPError as e:
            return e.code, json.loads(e.read() or b"{}"), None

    def test_off_by_default_everyone_answers(self):
        self.assertEqual(self.call("/api/printer?demo=1", host="192.168.1.20")[0], 200)

    def test_with_the_lock_on_only_paired_devices_and_this_computer_get_in(self):
        self.assertEqual(self.call("/api/pairing/lock", {"on": True})[0], 200)       # from this computer
        status, body, _ = self.call("/api/printer?demo=1", host="192.168.1.20")
        self.assertEqual((status, body.get("pairing_required")), (401, True))
        self.assertEqual(self.call("/api/printer/control/pause?demo=1", {}, host="192.168.1.20")[0], 401)
        self.assertEqual(self.call("/api/printer?demo=1")[0], 200)                   # this computer, as localhost
        self.assertEqual(self.call("/api/printer?demo=1", host="127.0.0.1")[0], 200)
        # A tunnel's domain counts as another device, even though cloudflared runs on this machine.
        from unittest.mock import patch
        with patch.object(dv_app, "EXTRA_HOSTS", {"printer.example.com"}):
            self.assertEqual(self.call("/api/printer?demo=1", host="printer.example.com")[0], 401)
        code = pairing.generate_code()["code"]
        status, device, cookie = self.call("/api/pairing/redeem", {"code": code, "device_name": "Phone"}, host="192.168.1.20")
        self.assertEqual(status, 200)
        self.assertNotIn("token", device)
        self.assertNotIn("key_hash", device)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        key = cookie.split(";")[0]
        self.assertEqual(self.call("/api/printer?demo=1", host="192.168.1.20", cookie=key)[0], 200)
        self.assertEqual(self.call("/api/printer?demo=1", host="192.168.1.20", cookie="dv_device=guess")[0], 401)
        # Unpairing withdraws the key at once.
        pairing.unpair(device["id"])
        self.assertEqual(self.call("/api/printer?demo=1", host="192.168.1.20", cookie=key)[0], 401)

    def test_an_unpaired_device_cannot_switch_the_lock(self):
        status, body, _ = self.call("/api/pairing/lock", {"on": True}, host="192.168.1.20")
        self.assertEqual(status, 400)
        self.assertFalse(pairing.lock_enabled())

    def test_the_pairing_screen_still_works_while_locked(self):
        pairing.set_lock(True)
        status, body, _ = self.call("/api/pairing/status", host="192.168.1.20")
        self.assertEqual((status, body["lock"], body["paired"], body["this_computer"]), (200, True, False, False))
        self.assertEqual(self.call("/api/pairing/redeem", {"code": "000000"}, host="192.168.1.20")[0], 400)

    def test_stored_device_keys_are_hashes(self):
        code = pairing.generate_code()["code"]
        device = pairing.redeem_code(code, "Tablet")
        stored = json.dumps(pairing._load_devices())
        self.assertNotIn(device["token"], stored)
        self.assertEqual(pairing.device_for(device["token"])["name"], "Tablet")


if __name__ == "__main__":
    unittest.main()
