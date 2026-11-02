"""
The U1's two doors (the owner, 2 November 2026: the printer's own web page,
opened from Deja Vu1, "worked smoothly"). Moonraker answers on its own port,
7125, and through the printer's web server on port 80, the door that web page
uses. Deja Vu1 tries the other door by itself when one doesn't
answer, both when an address is tested and while it keeps the printer link.

    python3 -m unittest tests.test_printer_doors
"""
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import fleet  # noqa: E402
import moonraker_client as mc  # noqa: E402


class Doors(unittest.TestCase):
    def test_each_door_names_the_other(self):
        self.assertEqual(mc.Endpoint("http://192.168.1.50:7125").other_door().label, "192.168.1.50:80")
        self.assertEqual(mc.Endpoint("http://192.168.1.50").other_door().label, "192.168.1.50:7125")
        self.assertEqual(mc.Endpoint("http://[fe80::1]:7125").other_door().host_header(), "[fe80::1]")
        # Any other port, or https, was chosen on purpose: left alone.
        self.assertIsNone(mc.Endpoint("http://192.168.1.50:8080").other_door())
        self.assertIsNone(mc.Endpoint("https://u1.example:7125").other_door())

    def test_the_address_test_also_tries_the_web_server(self):
        self.assertEqual(fleet.web_port_variant("http://192.168.1.50:7125"), "http://192.168.1.50")
        self.assertIsNone(fleet.web_port_variant("http://192.168.1.50:8080"))
        self.assertIsNone(fleet.web_port_variant("https://192.168.1.50:7125"))

    def test_the_link_tries_the_other_door_after_two_misses(self):
        saved = mc.RECONNECT_MAX
        mc.RECONNECT_MAX = 0.2
        self.addCleanup(setattr, mc, "RECONNECT_MAX", saved)
        printer = mc.MoonrakerPrinter("doors", "Doors", "http://127.0.0.1:7125")
        printer.start()
        self.addCleanup(printer.stop)
        deadline = time.monotonic() + 10
        while printer.endpoint.port == 7125 and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertEqual(printer.endpoint.port, 80)
        self.assertIs(printer.http.endpoint, printer.endpoint)
        self.assertEqual(printer.diagnostics()["door"], printer.endpoint.label)
        self.assertEqual(printer.url, "http://127.0.0.1:7125")       # the saved address never changes


if __name__ == "__main__":
    unittest.main()
