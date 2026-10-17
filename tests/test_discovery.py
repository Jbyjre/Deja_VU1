"""Finding printers on the network, and testing an address before adding it."""

import os
import socket
import struct
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "backend"))
sys.path.insert(0, HERE)

import discovery                      # noqa: E402
import fleet                          # noqa: E402
from fake_moonraker import FakeMoonraker   # noqa: E402


def _name(n):
    return b"".join(bytes([len(p)]) + p.encode() for p in n.split(".")) + b"\x00"


def snapmaker_answer():
    """An mDNS answer shaped like the U1's (u1-moonraker zeroconf.py):
    _snapmaker._tcp PTR, SRV on the LAN MQTT port, TXT with its ip."""
    service = "_snapmaker._tcp.local"
    head = struct.pack(">HHHHHH", 0, 0x8400, 0, 3, 0, 0)
    body = _name(service)                                   # at offset 12
    pointer = struct.pack(">H", 0xC000 | 12)
    instance = bytes([12]) + b"U1-ABC123456" + pointer      # "U1-ABC123456." + service
    ptr = body + struct.pack(">HHIH", 12, 1, 120, len(instance)) + instance
    inst_off = 12 + len(body) + 10
    inst_ptr = struct.pack(">H", 0xC000 | inst_off)
    target = _name("U1-ABC123456.local")
    srv = inst_ptr + struct.pack(">HHIH", 33, 0x8001, 120, 6 + len(target)) + struct.pack(">HHH", 0, 0, 1884) + target
    txt_items = [b"device_name=Bench U1", b"machine_type=U1", b"ip=192.168.1.50"]
    txt_data = b"".join(bytes([len(t)]) + t for t in txt_items)
    txt = inst_ptr + struct.pack(">HHIH", 16, 0x8001, 120, len(txt_data)) + txt_data
    return head + ptr + srv + txt


class TestMulticastDNS(unittest.TestCase):

    def test_the_question_asks_for_both_services_with_the_unicast_bit(self):
        q = discovery.build_query()
        self.assertEqual(struct.unpack(">H", q[4:6])[0], 2)
        self.assertIn(b"\x0a_snapmaker\x04_tcp\x05local\x00\x00\x0c\x80\x01", q)
        self.assertIn(b"\x0a_moonraker", q)

    def test_a_u1_answer_becomes_a_printer_on_moonrakers_port(self):
        records = discovery.parse_response(snapmaker_answer())
        self.assertEqual(records["ptr"], ["U1-ABC123456._snapmaker._tcp.local"])
        found = discovery._from_records(records)
        self.assertEqual(found, [{"ip": "192.168.1.50", "port": 7125, "name": "Bench U1", "u1": True}])

    def test_a_cut_short_answer_is_refused_not_misread(self):
        with self.assertRaises((ValueError, struct.error, IndexError)):
            discovery.parse_response(snapmaker_answer()[:40])


class TestProbe(unittest.TestCase):

    def test_a_u1_moonraker(self):
        fake = FakeMoonraker()
        self.addCleanup(fake.close)
        r = discovery.probe(fake.url)
        self.assertTrue(r["ok"])
        self.assertIsNone(r["error"])
        self.assertEqual((r["u1"], r["toolheads"], r["klippy_state"]), (True, 4, "ready"))

    def test_a_moonraker_that_wants_a_key_says_so(self):
        fake = FakeMoonraker(api_key="abcdef0123456789abcdef0123456789")
        self.addCleanup(fake.close)
        r = discovery.probe(fake.url)
        self.assertFalse(r["ok"])
        self.assertTrue(r["needs_key"])
        self.assertIn("API key", r["error"])
        self.assertTrue(discovery.probe(fake.url, "abcdef0123456789abcdef0123456789")["ok"])

    def test_nothing_listening_is_said_in_words(self):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        r = discovery.probe(f"http://127.0.0.1:{port}", timeout=1)
        self.assertFalse(r["ok"])
        self.assertTrue(r["error"])

    def test_something_that_isnt_moonraker(self):
        class Other(BaseHTTPRequestHandler):
            def do_GET(self):
                body = b'{"hello": "world"}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass
        srv = HTTPServer(("127.0.0.1", 0), Other)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        r = discovery.probe(f"http://127.0.0.1:{srv.server_address[1]}")
        self.assertIn("isn't Moonraker", r["error"])


class TestDiscover(unittest.TestCase):

    def test_found_printers_are_checked_and_marked_when_already_added(self):
        fake = FakeMoonraker()
        self.addCleanup(fake.close)
        r = discovery.discover([fake.url], hosts=[f"127.0.0.1:{fake.port}"])
        self.assertEqual(len(r["printers"]), 1)
        p = r["printers"][0]
        self.assertTrue(p["ok"] and p["u1"] and p["added"])

    def test_one_search_at_a_time(self):
        discovery._lock.acquire()
        try:
            with self.assertRaises(ValueError):
                discovery.discover(hosts=[])
        finally:
            discovery._lock.release()

    def test_only_a_private_home_network_is_swept(self):
        net = discovery.home_network()
        if net is not None:
            homes = [discovery.ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]
            self.assertTrue(any(net.subnet_of(h) for h in homes))
            self.assertEqual(net.prefixlen, 24)


class TestPortCheck(unittest.TestCase):

    def test_ports_outside_the_range_are_refused_in_words(self):
        for url in ("http://192.168.1.50:0", "http://192.168.1.50:70000"):
            with self.subTest(url=url), self.assertRaises(ValueError) as e:
                fleet.check_url(url)
            self.assertIn("isn't a port number", str(e.exception))
        fleet.check_url("http://192.168.1.50:7125")
        fleet.check_url("http://u1.local")


if __name__ == "__main__":
    unittest.main()
