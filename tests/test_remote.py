"""
Away from home (backend/remote.py), against a stand-in `tailscale` program
that answers in the formats of Tailscale's own source: `status --json`
(ipn/ipnstate), `serve status --json` (ipn/serve.go) and `serve --bg`, which
may print a link and wait until HTTPS is switched on for the tailnet.
"""

import json
import os
import stat
import sys
import tempfile
import textwrap
import time
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "backend"))

import remote  # noqa: E402

FAKE = textwrap.dedent('''\
    #!/usr/bin/env python3
    import json, os, sys, time
    path = os.environ["FAKE_TS_STATE"]
    state = json.load(open(path))
    args = sys.argv[1:]
    def save():
        json.dump(state, open(path, "w"))
    if args == ["status", "--json"]:
        print(json.dumps({"BackendState": state["backend"], "TailscaleIPs": ["100.101.102.103", "fd7a::1"],
                          "Self": {"DNSName": "bench-pc.tail1234.ts.net.", "TailscaleIPs": ["100.101.102.103", "fd7a::1"]}}))
    elif args == ["serve", "status", "--json"]:
        print(json.dumps(state.get("serve") or {}))
    elif args[:2] == ["serve", "--bg"]:
        target = args[-1]
        if state.get("needs_https"):
            print("Serve is not enabled on your tailnet.")
            print("         https://login.tailscale.com/f/serve?node=abc123")
            sys.stdout.flush()
            while json.load(open(path)).get("needs_https"):
                time.sleep(0.1)
            state = json.load(open(path))
        if state.get("refuse"):
            print(state["refuse"]); sys.exit(1)
        state["serve"] = {"TCP": {"443": {"HTTPS": True}},
                          "Web": {"bench-pc.tail1234.ts.net:443": {"Handlers": {"/": {"Proxy": target}}}}}
        save()
        print("Available within your tailnet:")
    elif args == ["serve", "--https=443", "off"]:
        state["serve"] = {}
        save()
    else:
        print("unexpected", args); sys.exit(2)
''')


class Remote(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.cli = os.path.join(self.dir.name, "tailscale")
        with open(self.cli, "w") as f:
            f.write(FAKE)
        os.chmod(self.cli, os.stat(self.cli).st_mode | stat.S_IEXEC)
        self.state = os.path.join(self.dir.name, "state.json")
        self.set(backend="Running")
        env = patch.dict(os.environ, {"FAKE_TS_STATE": self.state})
        env.start()
        self.addCleanup(env.stop)
        found = patch.object(remote, "cli", return_value=self.cli)
        found.start()
        self.addCleanup(found.stop)
        self.addCleanup(lambda: remote._pending.update(proc=None, url=None, lines=[]))

    def set(self, **state):
        with open(self.state, "w") as f:
            json.dump(state, f)

    def test_not_installed_says_so(self):
        with patch.object(remote, "cli", return_value=None):
            r = remote.status(8000)
        self.assertEqual((r["installed"], r["running"], r["shared_url"]), (False, False, None))
        with patch.object(remote, "cli", return_value=None), self.assertRaisesRegex(ValueError, "isn't installed"):
            remote.share(8000)

    def test_connected_but_not_shared_offers_the_plain_tailnet_address(self):
        r = remote.status(8000)
        self.assertTrue(r["running"])
        self.assertEqual(r["name"], "bench-pc.tail1234.ts.net")
        self.assertEqual(r["http_url"], "http://100.101.102.103:8000")
        self.assertIsNone(r["shared_url"])

    def test_not_connected_is_refused_in_words(self):
        self.set(backend="NeedsLogin")
        self.assertFalse(remote.status(8000)["running"])
        with self.assertRaisesRegex(ValueError, "not connected"):
            remote.share(8000)

    def test_share_then_stop(self):
        out = remote.share(8000, wait=10)
        self.assertEqual(out, {"shared_url": "https://bench-pc.tail1234.ts.net"})
        self.assertEqual(remote.status(8000)["shared_url"], "https://bench-pc.tail1234.ts.net")
        self.assertEqual(remote.share(8000), out)               # already on: nothing new is run
        self.assertEqual(remote.stop(8000), {"shared_url": None})

    def test_https_switched_on_first_shows_tailscales_link_then_finishes(self):
        self.set(backend="Running", needs_https=True)
        out = remote.share(8000, wait=5)
        self.assertEqual(out, {"waiting": True, "approval_url": "https://login.tailscale.com/f/serve?node=abc123"})
        self.assertTrue(remote.status(8000)["waiting"])
        with open(self.state) as f:
            state = json.load(f)
        state["needs_https"] = False
        self.set(**state)
        deadline = time.monotonic() + 8
        while remote.status(8000)["shared_url"] is None and time.monotonic() < deadline:
            time.sleep(0.1)
        self.assertEqual(remote.status(8000)["shared_url"], "https://bench-pc.tail1234.ts.net")

    def test_tailscales_own_refusal_is_passed_on(self):
        self.set(backend="Running", refuse="Access denied: serve config denied. Use 'sudo tailscale serve'.")
        with self.assertRaisesRegex(ValueError, "Access denied"):
            remote.share(8000, wait=10)

    def test_only_a_share_pointing_at_this_dashboard_counts(self):
        serve = {"Web": {"bench-pc.tail1234.ts.net:443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:3000"}}},
                         "bench-pc.tail1234.ts.net:8443": {"Handlers": {"/": {"Proxy": "http://127.0.0.1:8000"}}}}}
        self.assertEqual(remote.shared_url(serve, 8000), "https://bench-pc.tail1234.ts.net:8443")
        self.assertIsNone(remote.shared_url(serve, 9000))
        self.assertTrue(remote.points_here("localhost:8000", 8000))
        self.assertTrue(remote.points_here("8000", 8000))
        self.assertFalse(remote.points_here("http://192.168.1.9:8000", 8000))


class RemoteThroughTheServer(unittest.TestCase):
    """Switching sharing is for the computer itself; a phone (or the share) gets a 403."""

    @classmethod
    def setUpClass(cls):
        import threading
        import app as dv_app
        cls.server = dv_app.DejaVuServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.port = cls.server.server_port
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def post(self, path, host):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("POST", path, body=b"{}", headers={"Host": host, "Content-Type": "application/json"})
        resp = conn.getresponse()
        return resp.status, json.loads(resp.read() or b"{}")

    def test_a_phone_cannot_switch_sharing(self):
        for host in ("192.168.1.20:8000", "bench-pc.tail1234.ts.net"):
            status, body = self.post("/api/remote/share", host)
            self.assertEqual(status, 403, host)
            self.assertIn("computer running Deja Vu1", body["error"])

    def test_this_computer_gets_a_reason_when_tailscale_is_missing(self):
        with patch.object(remote, "cli", return_value=None):
            status, body = self.post("/api/remote/share", f"localhost:{self.port}")
        self.assertEqual(status, 400)
        self.assertIn("isn't installed", body["error"])

    def test_a_link_needs_sharing_on_first(self):
        with patch.object(remote, "cli", return_value=None):
            status, body = self.post("/api/remote/link", f"localhost:{self.port}")
        self.assertEqual(status, 400)
        self.assertIn("Turn on Away from home first", body["error"])


if __name__ == "__main__":
    unittest.main()
