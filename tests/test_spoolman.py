"""
Tests for spoolman_bridge.py - importing spools from Spoolman into the
filament inventory, against a stand-in that answers the way Spoolman's
API does (spoolman/api/v1/models.py and spool.py, commit d102f94).

    python3 -m unittest discover tests
"""

import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import filament_inventory  # noqa: E402
import spoolman_bridge     # noqa: E402


def spool(sid, name, material, color_hex=None, remaining=None, archived=False, multi=None, vendor="Polymaker"):
    filament = {"id": 100 + sid, "registered": "2026-01-01T00:00:00Z", "name": name, "material": material,
                "density": 1.24, "diameter": 1.75, "vendor": {"id": 1, "name": vendor, "registered": "2026-01-01T00:00:00Z"}}
    if color_hex is not None:
        filament["color_hex"] = color_hex
    if multi is not None:
        filament["multi_color_hexes"] = multi
    out = {"id": sid, "registered": "2026-01-01T00:00:00Z", "filament": filament, "used_weight": 0.0,
           "used_length": 0.0, "archived": archived}
    if remaining is not None:                      # response_model_exclude_none drops nulls
        out["remaining_weight"] = remaining
    return out


class FakeSpoolman:
    def __init__(self, spools):
        self.spools = spools
        self.paths = []
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                fake.paths.append(self.path)
                if self.path.split("?")[0] != "/api/v1/spool":
                    body, status = b'{"message": "Not Found"}', 404
                else:
                    # Spoolman leaves archived spools out unless asked (allow_archived=False).
                    body, status = json.dumps([s for s in fake.spools if not s["archived"]]).encode(), 200
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class TestSpoolmanImport(unittest.TestCase):
    def setUp(self):
        filament_inventory.reset()
        self.addCleanup(filament_inventory.reset)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self._path = spoolman_bridge._SETTINGS_PATH
        spoolman_bridge._SETTINGS_PATH = os.path.join(tmp.name, "spoolman_settings.json")
        self.addCleanup(setattr, spoolman_bridge, "_SETTINGS_PATH", self._path)
        self.fake = FakeSpoolman([
            spool(1, "PolyTerra Charcoal", "PLA", "1C1C1E", remaining=640.5),
            spool(2, "Silk Rainbow", "PLA", multi="FF0000,00FF00", remaining=120),
            spool(3, "Mystery", "PETG"),                                  # no colour
            spool(4, "Old", "ABS", "FFFFFF", remaining=5, archived=True),
            spool(5, "Galaxy", "PETG", "3B82F6CC"),                       # alpha, no weight known
        ])
        self.addCleanup(self.fake.close)

    def imported(self):
        return {s["spoolman_id"]: s for s in filament_inventory.get_inventory() if s.get("spoolman_id")}

    def test_spools_come_in_with_colour_and_grams(self):
        result = spoolman_bridge.import_spools(self.fake.url + "/")
        self.assertEqual(self.fake.paths, ["/api/v1/spool"])
        self.assertEqual((result["found"], result["added"], result["updated"]), (4, 3, 0))
        got = self.imported()
        self.assertEqual(got["1"]["color_hex"], "#1c1c1e")
        self.assertEqual(got["1"]["grams_remaining"], 640.5)
        self.assertEqual(got["1"]["color_name"], "Polymaker PolyTerra Charcoal")
        self.assertEqual(got["2"]["color_hex"], "#ff0000")              # first of a multi-colour
        self.assertEqual(got["5"]["color_hex"], "#3b82f6")              # alpha dropped
        self.assertEqual(got["5"]["grams_remaining"], 0)
        self.assertEqual(result["unknown_weight"], 1)
        self.assertNotIn("4", got)                                      # archived stays out
        self.assertTrue(any("no colour" in s for s in result["skipped"]))

    def test_importing_again_updates_instead_of_duplicating(self):
        spoolman_bridge.import_spools(self.fake.url)
        hand_added = filament_inventory.add_spool("PLA", "Mine", "#123456", 300)
        self.fake.spools[0]["remaining_weight"] = 400.0
        result = spoolman_bridge.import_spools(None)                    # remembers the address
        self.assertEqual((result["added"], result["updated"]), (0, 3))
        self.assertEqual(self.imported()["1"]["grams_remaining"], 400.0)
        self.assertIn(hand_added, filament_inventory.get_inventory())
        self.assertEqual(len(self.imported()), 3)

    def test_the_api_address_is_accepted_too(self):
        self.assertEqual(spoolman_bridge.import_spools(self.fake.url + "/api/v1")["added"], 3)

    def test_failures_are_in_words(self):
        for bad in ("", "ftp://x", "not a url"):
            with self.assertRaises(ValueError):
                spoolman_bridge.import_spools(bad)
        self.fake.close()
        with self.assertRaisesRegex(ValueError, "Spoolman"):
            spoolman_bridge.import_spools(self.fake.url)


if __name__ == "__main__":
    unittest.main()
