"""
API tests for the four flagship features - fleet command center, Photo-to-
Print Studio, the auto-print pipeline and the farm sandbox - against the
real server on a spare port: module gating, the no-printer-no-figures rule,
and each route doing what its docstring says.
"""

import json
import os
import sys
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app as dv_app       # noqa: E402
import file_library        # noqa: E402
import fleet               # noqa: E402
import live_feed           # noqa: E402
import maintenance         # noqa: E402
import mock_moonraker      # noqa: E402
import modules             # noqa: E402
import print_queue         # noqa: E402
import sandbox             # noqa: E402
import slicer_bridge       # noqa: E402
from test_photo_studio import box_stl   # noqa: E402

NO_PRINTER = {"connected": False, "demo": False}


class FlagshipAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = dv_app.DejaVuServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        sandbox.reset()
        mock_moonraker.reset_all()
        live_feed.reset()
        modules.reset_state()
        file_library.reset()
        print_queue.reset()
        fleet.reset()
        slicer_bridge.reset()
        maintenance.reset_all_logs()

    def tearDown(self):
        sandbox.reset()
        mock_moonraker.reset_all()
        modules.reset_state()
        file_library.reset()
        print_queue.reset()
        slicer_bridge.reset()
        maintenance.reset_all_logs()

    def request(self, path, body=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = Request(self.base + path, data=data, method="POST" if data is not None else "GET",
                      headers={"Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=15) as resp:
                return resp.status, json.loads(resp.read())
        except HTTPError as err:
            return err.code, json.loads(err.read() or b"{}")


class TestGating(FlagshipAPI):
    def test_printer_figures_need_demo(self):
        for path in ("/api/fleet/history", "/api/fleet/queues"):
            self.assertEqual(self.request(path), (200, NO_PRINTER), path)
        for path, body in (("/api/fleet/broadcast", {"action": "home"}),
                           ("/api/fleet/route", {"filename": "x.gcode", "to": "u1-garage"})):
            self.assertEqual(self.request(path, body), (409, NO_PRINTER), path)
        status, body = self.request("/api/sandbox")
        self.assertEqual(status, 403)
        self.assertEqual(self.request("/api/sandbox/farm", {"count": 2})[0], 403)
        self.assertEqual(mock_moonraker.printer_ids(), list(mock_moonraker.BUILT_IN_IDS))

    def test_each_module_switch_closes_its_routes(self):
        cases = {
            "fleet_command": [("/api/fleet/history?demo=1", None), ("/api/fleet/broadcast?demo=1", {"action": "home"})],
            "photo_studio": [("/api/studio/palette", None)],
            "auto_print": [("/api/slicer/settings", None), ("/api/slicer/check", {})],
            "sandbox": [("/api/sandbox?demo=1", None), ("/api/sandbox/step?demo=1", {"seconds": 5})],
        }
        modules.set_enabled("auto_print", True)
        for module_id, routes in cases.items():
            modules.set_enabled(module_id, False)
            for path, body in routes:
                status, payload = self.request(path, body)
                self.assertEqual((status, payload.get("module_disabled")), (403, True), path)
            modules.set_enabled(module_id, True)

    def test_auto_print_is_off_by_default(self):
        self.assertEqual(self.request("/api/slicer/settings")[0], 403)

    def test_broadcast_needs_printer_control_on(self):
        modules.set_enabled("printer_control", False)
        status, payload = self.request("/api/fleet/broadcast?demo=1", {"action": "home"})
        self.assertEqual((status, payload.get("module_disabled")), (403, True))


class TestFleetCommandRoutes(FlagshipAPI):
    def test_broadcast_reports_each_printer(self):
        status, body = self.request("/api/fleet/broadcast?demo=1", {"action": "pause", "printers": []})
        self.assertEqual(status, 200)
        self.assertTrue(body["demo"])
        self.assertFalse(body["all_ok"])
        rows = {r["printer"]: r for r in body["results"]}
        self.assertEqual(rows["u1-workshop"]["confirmed_state"]["state"], "paused")
        self.assertIn("Nothing is printing", rows["u1-garage"]["error"])
        # The live cache already has the read-back.
        self.assertEqual(live_feed.snapshot("u1-workshop")["state"]["state"], "paused")

    def test_bad_request_is_a_400_in_words(self):
        status, body = self.request("/api/fleet/broadcast?demo=1", {"action": "preheat", "params": {"nozzle": 999}})
        self.assertEqual(status, 400)
        self.assertIn("between", body["error"])

    def test_route_and_queues(self):
        self.request("/api/files/samples", {})
        status, body = self.request("/api/fleet/route?demo=1", {"filename": "calibration_cube_20mm.gcode",
                                                                 "to": "u1-studio"})
        self.assertEqual(status, 200, body)
        status, body = self.request("/api/fleet/queues?demo=1")
        self.assertEqual(body["queues"]["u1-studio"]["items"][0]["filename"], "calibration_cube_20mm.gcode")

    def test_history(self):
        status, body = self.request("/api/fleet/history?demo=1&days=14&bucket=week")
        self.assertEqual(status, 200)
        self.assertEqual(body["bucket"], "week")
        self.assertEqual(len(body["printers"]), 3)
        self.assertEqual(self.request("/api/fleet/history?demo=1&days=0")[0], 400)


class TestStudioRoutes(FlagshipAPI):
    def test_palette_and_save(self):
        status, body = self.request("/api/studio/palette")
        self.assertEqual(status, 200)
        self.assertIn("suggestions", body)
        status, body = self.request("/api/studio/save?name=relief.stl&note=3%20colours", raw=box_stl())
        self.assertEqual(status, 200, body)
        self.assertEqual(body["file"]["origin"], "studio")
        status, body = self.request("/api/studio/save?name=relief.stl", raw=b"nonsense" * 20)
        self.assertEqual(status, 400)


class TestSlicerRoutes(FlagshipAPI):
    def setUp(self):
        super().setUp()
        modules.set_enabled("auto_print", True)

    def test_settings_check_and_slice_fail_in_words_without_a_slicer(self):
        status, body = self.request("/api/slicer/settings")
        self.assertIn("Install OrcaSlicer yourself", body["problem"])
        status, body = self.request("/api/slicer/check", {})
        self.assertFalse(body["ok"])
        status, body = self.request("/api/slicer/settings", {"slicer_path": "/bin/sh"})
        self.assertEqual(status, 400)
        self.request("/api/files/upload?name=part.stl", raw=box_stl())
        status, body = self.request("/api/slicer/slice", {"name": "part.stl"})
        self.assertEqual(status, 400)
        self.assertIn("No slicer set up", body["error"])

    def test_queueing_a_slice_is_a_printer_action(self):
        self.request("/api/files/upload?name=part.stl", raw=box_stl())
        status, body = self.request("/api/slicer/slice", {"name": "part.stl", "queue": True})
        self.assertEqual(status, 409)
        self.assertIn("No printer connected", body["error"])


class TestSandboxRoutes(FlagshipAPI):
    def test_a_scenario_end_to_end(self):
        status, body = self.request("/api/sandbox/farm?demo=1", {"count": 3, "busy_fraction": 1, "seed": 2})
        self.assertEqual((status, body["sandbox_count"]), (200, 3))
        status, fleet_rows = self.request("/api/fleet?demo=1")
        self.assertEqual(len(fleet_rows["printers"]), 6)
        status, body = self.request("/api/sandbox/scenario?demo=1", {"preset": "jam", "seed": 1})
        self.assertEqual(body["pending"], 1)
        status, body = self.request("/api/sandbox/step?demo=1", {"seconds": 700})
        self.assertEqual(body["pending"], 0)
        step = body["steps"][0]
        self.assertTrue(step["outcome"]["ok"], step)
        jammed = next(f for f in body["farm"] if f["state"] == "error")
        status, events = self.request("/api/live/events?demo=1&since=0")
        self.assertIn(("print_event", "failed", jammed["id"]),
                      [(e["type"], e.get("event"), e.get("printer")) for e in events["events"]])
        status, body = self.request("/api/sandbox/fire?demo=1", {"event": "clear_error", "printer": jammed["id"]})
        self.assertTrue(body["outcomes"][0]["ok"])
        status, body = self.request("/api/sandbox/teardown?demo=1", {})
        self.assertEqual(body["sandbox_count"], 0)

    def test_unknown_sandbox_verb(self):
        self.assertEqual(self.request("/api/sandbox/explode?demo=1", {})[0], 404)
        self.assertEqual(self.request("/api/sandbox/scenario?demo=1", {"preset": "nope"})[0], 400)


if __name__ == "__main__":
    unittest.main()
