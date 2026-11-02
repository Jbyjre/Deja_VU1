"""
Finding printers further away (discovery.wider_places, remote.tailnet_places) and following a
saved printer to a new address by its serial number (refind.py, fleet.move).

    python3 -m unittest tests.test_refind
"""

import ipaddress
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import discovery      # noqa: E402
import fleet          # noqa: E402
import mock_moonraker  # noqa: E402
import refind         # noqa: E402
import remote         # noqa: E402
from fake_moonraker import FakeMoonraker      # noqa: E402
from test_moonraker_client import fast, wait_for      # noqa: E402

# The shape of `tailscale status --json` (ipn/ipnstate/ipnstate.go: Peer map, TailscaleIPs,
# PrimaryRoutes, Online, HostName).
STATUS = {"BackendState": "Running", "Self": {"DNSName": "desk.tail1.ts.net.", "TailscaleIPs": ["100.64.0.1"]},
          "Peer": {"nodekey:a": {"HostName": "home-pi", "Online": True, "TailscaleIPs": ["100.64.0.7", "fd7a::7"],
                                 "PrimaryRoutes": ["192.168.77.0/24", "::/0"]},
                   "nodekey:b": {"HostName": "old-laptop", "Online": False, "TailscaleIPs": ["100.64.0.9"],
                                 "PrimaryRoutes": ["192.168.99.0/24"]},
                   "nodekey:c": {"HostName": "exit", "Online": True, "TailscaleIPs": ["100.64.0.3"],
                                 "PrimaryRoutes": ["0.0.0.0/0", "10.0.0.0/8"]}}}


class TestWhereToLook(unittest.TestCase):
    def test_tailnet_places_reads_online_devices_and_their_shared_networks(self):
        with mock.patch.object(remote, "cli", return_value="/usr/bin/tailscale"), \
                mock.patch.object(remote, "_json", return_value=json.loads(json.dumps(STATUS))):
            places = remote.tailnet_places()
        self.assertTrue(places["running"])
        self.assertEqual(places["routes"], ["192.168.77.0/24", "10.0.0.0/8"])      # offline device and 0/0 left out
        self.assertEqual([p["name"] for p in places["peers"]], ["home-pi", "exit"])
        self.assertEqual(places["peers"][0]["ips"], ["100.64.0.7"])

    def test_not_running_means_nowhere(self):
        with mock.patch.object(remote, "cli", return_value=None):
            self.assertEqual(remote.tailnet_places(), {"running": False, "peers": [], "routes": []})

    def test_wider_places(self):
        with mock.patch.object(discovery, "home_networks", return_value=[ipaddress.ip_network("192.168.1.0/24")]):
            nets, hosts = discovery.wider_places({"routes": ["192.168.77.0/24", "10.0.0.0/8", "192.168.40.0/23"],
                                                  "peers": [{"name": "home-pi", "ips": ["100.64.0.7"]}]})
        names = [str(n) for n, _ in nets]
        self.assertEqual(names[:3], ["192.168.41.0/24", "192.168.40.0/24", "192.168.77.0/24"])  # tailnet routes first
        self.assertNotIn("192.168.1.0/24", names)                 # this computer's own network is already swept
        self.assertNotIn("10.0.0.0/8", names)                     # far too large to try
        self.assertIn("192.168.68.0/24", names)
        self.assertEqual(hosts, [("100.64.0.7", "home-pi on your Tailscale network")])
        self.assertLessEqual(len(nets), 24)


class TestProbeReadsTheSerial(unittest.TestCase):
    def test_serial_and_model_from_system_info(self):
        fake = FakeMoonraker(u1=False)
        self.addCleanup(fake.close)
        fake.device_name = "Bench"
        fake.serial = "ab12cd34"
        r = discovery.probe(fake.url)
        self.assertTrue(r["ok"])
        self.assertTrue(r["u1"])                                  # machine_type "Snapmaker U1"
        self.assertEqual(r["serial"], "AB12CD34")


class TestFollowingAMovedPrinter(unittest.TestCase):
    def setUp(self):
        fast(self)
        fleet.reset()
        self.addCleanup(fleet.reset)
        refind._down_since.clear()
        refind._searched_at.clear()
        self.old = FakeMoonraker()
        self.addCleanup(self.old.close)
        self.old.device_name = "Bench"
        self.old.serial = "U1SN0001"
        self.entry = fleet.add("Bench U1", self.old.url)
        self.printer = mock_moonraker.real_printer(self.entry["id"])
        self.assertTrue(wait_for(self.printer.is_connected), self.printer.diagnostics()["last_error"])

    def test_the_serial_is_kept_and_a_moved_printer_is_followed(self):
        self.assertTrue(wait_for(lambda: self.printer.serial is not None))
        refind.check(now=0)
        saved = next(p for p in fleet.registered() if p["id"] == self.entry["id"])
        self.assertEqual(saved["serial"], self.printer.serial)

        new = FakeMoonraker()
        self.addCleanup(new.close)
        self.old.close()                                           # the router gave it another address
        self.assertTrue(wait_for(lambda: not mock_moonraker.real_printer(self.entry["id"]).is_connected(), 8))
        events = []
        found = {"printers": [{"ok": True, "url": new.url, "serial": saved["serial"]}]}
        searches = []
        search = lambda urls: searches.append(urls) or found
        self.assertEqual(refind.check(now=10, search=search, publish=events.append), [])       # not down long enough
        moves = refind.check(now=10 + refind.DOWN_FOR, search=search, publish=events.append)
        self.assertEqual(len(searches), 1)
        self.assertEqual(moves[0]["to"], new.url)
        self.assertEqual(events[0]["type"], "printer_moved")
        saved = next(p for p in fleet.registered() if p["id"] == self.entry["id"])
        self.assertEqual((saved["moonraker_url"], saved["moved_from"]), (new.url, self.old.url))
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.entry["id"]).is_connected(), 8))

    def test_another_printer_is_never_taken_for_it(self):
        self.assertTrue(wait_for(lambda: self.printer.serial is not None))
        refind.check(now=0)
        self.old.close()
        self.assertTrue(wait_for(lambda: not mock_moonraker.real_printer(self.entry["id"]).is_connected(), 8))
        other = {"printers": [{"ok": True, "url": "http://192.168.1.80:7125", "serial": "SOMEONE-ELSE"}]}
        refind.check(now=1)
        self.assertEqual(refind.check(now=1 + refind.DOWN_FOR, search=lambda urls: other), [])
        saved = next(p for p in fleet.registered() if p["id"] == self.entry["id"])
        self.assertEqual(saved["moonraker_url"], self.old.url)


if __name__ == "__main__":
    unittest.main()
