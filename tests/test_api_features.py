"""
API tests for the features added with the fleet / live / files work, against
the real server on a spare port - what a browser or curl actually gets.
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

import app as dv_app       # noqa: E402
import automations         # noqa: E402
import file_library        # noqa: E402
import fleet               # noqa: E402
import live_feed           # noqa: E402
import maintenance         # noqa: E402
import mock_moonraker      # noqa: E402
import modules             # noqa: E402
import print_queue         # noqa: E402
import sample_files        # noqa: E402

NO_PRINTER = {"connected": False, "demo": False}


class FeatureAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = dv_app.DejaVuServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        mock_moonraker.reset_all()
        live_feed.reset()
        file_library.reset()
        automations.reset()
        print_queue.reset()
        fleet.reset()
        modules.reset_state()
        maintenance.reset_all_logs()

    def tearDown(self):
        automations.wait_idle()
        mock_moonraker.reset_all()
        file_library.reset()
        automations.reset()
        print_queue.reset()
        fleet.reset()
        maintenance.reset_all_logs()

    def request(self, path, body=None, raw=None, method=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = Request(self.base + path, data=data, method=method or ("POST" if data is not None else "GET"),
                      headers={"Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=10) as resp:
                content = resp.read()
                ctype = resp.headers.get("Content-Type", "")
                return resp.status, (json.loads(content) if "json" in ctype else content)
        except HTTPError as err:
            return err.code, json.loads(err.read() or b"{}")


class TestNoFakeData(FeatureAPI):
    def test_every_new_printer_route_refuses_without_demo(self):
        modules.set_enabled("filament_inventory", True)      # optional modules, off by default
        modules.set_enabled("compare", True)
        for path in ("/api/fleet", "/api/live/snapshot", "/api/live/events", "/api/chamber", "/api/health",
                     "/api/queue", "/api/timelapse", "/api/filament/forecast",
                     "/api/compare/side-by-side", "/api/print/confirm?file=x.gcode"):
            status, body = self.request(path)
            self.assertEqual((status, body), (200, NO_PRINTER), path)

    def test_every_new_printer_action_refuses_without_demo(self):
        for path in ("/api/printer/control/start", "/api/queue/add", "/api/maintenance/swap"):
            status, body = self.request(path, {})
            self.assertEqual((status, body), (409, NO_PRINTER), path)

    def test_demo_tools_refuse_without_demo(self):
        for path in ("/api/demo/fail-next", "/api/demo/time-scale", "/api/demo/reset"):
            self.assertEqual(self.request(path, {})[0], 403)

    def test_a_registered_real_printer_never_shows_simulated_numbers(self):
        _, entry = self.request("/api/fleet/registry", {"name": "Bench", "moonraker_url": "http://10.0.0.5:7125"})
        status, body = self.request(f"/api/printer?demo=1&printer={entry['id']}")
        self.assertEqual((status, body), (200, NO_PRINTER))
        status, body = self.request(f"/api/printer/control/pause?demo=1&printer={entry['id']}", {})
        self.assertEqual((status, body), (409, NO_PRINTER))

    def test_unknown_printer_is_a_404_not_a_silent_fallback(self):
        self.assertEqual(self.request("/api/printer?demo=1&printer=nope")[0], 404)


class TestCrossSiteProtection(FeatureAPI):
    def post_from(self, origin, path="/api/printer/control/pause?demo=1"):
        req = Request(self.base + path, data=b"{}", method="POST",
                      headers={"Content-Type": "text/plain", "Origin": origin,
                               "Host": self.base.split("//")[1]})
        try:
            with urlopen(req, timeout=5) as resp:
                return resp.status
        except HTTPError as err:
            return err.code

    def test_a_command_from_another_website_is_refused(self):
        self.assertEqual(self.post_from("https://evil.example"), 403)
        self.assertEqual(self.request("/api/printer?demo=1")[1]["state"], "printing")

    def test_the_dashboard_own_page_is_allowed(self):
        self.assertEqual(self.post_from(self.base), 200)


class TestPrinterScoping(FeatureAPI):
    def test_printer_parameter_scopes_existing_modules(self):
        _, workshop = self.request("/api/printer?demo=1")
        _, studio = self.request("/api/printer?demo=1&printer=u1-studio")
        self.assertEqual((workshop["state"], studio["state"]), ("printing", "paused"))
        _, m1 = self.request("/api/maintenance?demo=1&printer=u1-studio")
        self.assertEqual(m1["totals"]["total_prints"], 24)
        self.request("/api/maintenance/done?demo=1&printer=u1-studio", {"task_id": "nozzle_check"})
        _, h_studio = self.request("/api/maintenance/history?demo=1&printer=u1-studio")
        _, h_workshop = self.request("/api/maintenance/history?demo=1")
        self.assertEqual(len(h_studio["history"]), 1)
        self.assertEqual(len(h_workshop["history"]), 0)

    def test_polling_fallback_gets_events_too(self):
        self.request("/api/live/snapshot?demo=1")        # the server's first read, as at start-up
        self.request("/api/printer/control/pause?demo=1", {})
        status, body = self.request("/api/live/events?demo=1&since=0")
        self.assertEqual(status, 200)
        self.assertIn("paused", [e.get("event") for e in body["events"]])

    def test_fleet_overview(self):
        status, body = self.request("/api/fleet?demo=1")
        self.assertEqual(status, 200)
        self.assertTrue(body["demo"])
        self.assertEqual(len(body["printers"]), 3)


class TestHonestControl(FeatureAPI):
    def test_a_failed_pause_is_reported_as_failed_and_nothing_changes(self):
        self.request("/api/demo/fail-next?demo=1", {"action": "pause", "message": "Klippy is shutdown"})
        status, body = self.request("/api/printer/control/pause?demo=1", {})
        self.assertEqual(status, 502)
        self.assertTrue(body["printer_failed"])
        self.assertIn("Klippy is shutdown", body["error"])
        _, state = self.request("/api/printer?demo=1")
        self.assertEqual(state["state"], "printing")

    def test_successful_control_returns_the_state_read_back_afterwards(self):
        status, body = self.request("/api/printer/control/pause?demo=1", {})
        self.assertEqual(status, 200)
        self.assertEqual(body["confirmed_state"]["state"], "paused")
        self.assertLess(body["server_ms"], 200)

    def test_start_print_goes_through_the_gate(self):
        self.request("/api/files/samples", {})
        self.request("/api/printer/control/cancel?demo=1", {})
        status, body = self.request("/api/printer/control/start?demo=1",
                                    {"filename": "unsafe_example_purge_past_bed.gcode", "confirmed": True})
        self.assertEqual(status, 409)
        self.assertTrue(body["blocked"])
        self.assertEqual(body["gate"]["verdict"], "blocked")
        for task in maintenance.TASKS:
            maintenance.mark_done(task["id"])
        status, body = self.request("/api/printer/control/start?demo=1",
                                    {"filename": "calibration_cube_20mm.gcode", "confirmed": True})
        self.assertEqual(status, 200)
        self.assertEqual(body["confirmed_state"]["current_file"], "calibration_cube_20mm.gcode")


class TestFilesAndConversion(FeatureAPI):
    def test_upload_view_edit_and_download(self):
        gcode = sample_files.calibration_cube().encode()
        status, entry = self.request("/api/files/upload?name=my%20cube.gcode", raw=gcode)
        self.assertEqual((status, entry["name"]), (200, "my cube.gcode"))
        status, png = self.request("/api/files/thumb?name=my%20cube.gcode")
        self.assertTrue(png.startswith(b"\x89PNG"))
        _, lines = self.request("/api/files/lines?name=my%20cube.gcode&q=PRINT_START")
        self.assertEqual(lines["matches"], 1)
        line = lines["lines"][0]["n"]
        status, result = self.request("/api/files/edit", {"name": "my cube.gcode", "edits": [
            {"kind": "insert", "after_line": line, "command": "M117 Printing from Deja Vu1"}]})
        self.assertEqual(status, 200)
        status, raw = self.request("/api/files/raw?name=my%20cube.gcode")
        self.assertIn(b"M117 Printing from Deja Vu1", raw)
        status, bad = self.request("/api/files/edit", {"name": "my cube.gcode", "edits": [
            {"kind": "insert", "after_line": line, "command": "M112"}]})
        self.assertEqual(status, 400)

    def test_upload_refuses_bad_names(self):
        self.assertEqual(self.request("/api/files/upload?name=evil.sh", raw=b"x")[0], 400)

    def test_convert_saves_a_u1_project(self):
        self.request("/api/files/samples", {})
        status, body = self.request("/api/convert", {"name": "sample_bambu_studio_layout.3mf"})
        self.assertEqual(status, 200)
        self.assertEqual(body["file"]["name"], "sample_bambu_studio_layout_U1.3mf")
        self.assertEqual(body["report"]["printer_profile"], "Snapmaker U1 (0.4 nozzle)")
        status, diff = self.request("/api/profiles/diff?a=sample_bambu_studio_layout.3mf"
                                    "&b=sample_bambu_studio_layout_U1.3mf")
        changed = {r["setting"] for r in diff["rows"] if r["status"] == "changed"}
        self.assertIn("printer_settings_id", changed)
        self.assertEqual(self.request("/api/convert", {"name": "calibration_cube_20mm.gcode"})[0], 400)


class TestAutomationDemoPath(FeatureAPI):
    """The pitch moment: build a rule, trigger it, watch it fire."""

    def test_build_a_rule_heat_the_nozzle_and_watch_it_fire(self):
        status, rule = self.request("/api/automations?demo=1", {"rule": {
            "printer": "u1-workshop",
            "trigger": {"type": "temperature", "sensor": "T0", "op": "above", "value": 180},
            "action": {"type": "pause"}}})
        self.assertEqual(status, 200)
        self.assertTrue(rule["demo"])
        self.request("/api/printer/control/temperature?demo=1", {"toolhead": "T0", "target": 220})
        for n in range(40):                          # let the heater climb, 250 ms at a time
            live_feed.mark_demo_seen()
            live_feed.tick(1.0, n)
            if automations.get_log():
                break
        automations.wait_idle()
        log = self.request("/api/automations/log")[1]["log"]
        self.assertEqual(len(log), 1)
        self.assertTrue(log[0]["ok"])
        self.assertIn("T0 at", log[0]["trigger"])
        self.assertEqual(self.request("/api/printer?demo=1")[1]["state"], "paused")
        events = [e for e in live_feed.events_since(0) if e["type"] == "automation"]
        self.assertEqual(events[0]["rule_id"], rule["id"])

    def test_a_demo_rule_cannot_be_test_fired_outside_demo(self):
        _, rule = self.request("/api/automations?demo=1", {"rule": {
            "trigger": {"type": "state", "event": "paused"}, "action": {"type": "pause"}}})
        status, _ = self.request(f"/api/automations/{rule['id']}/test", {})
        self.assertEqual(status, 409)


class TestModuleGating(FeatureAPI):
    def test_new_modules_can_be_switched_off(self):
        for module_id, path in (("file_library", "/api/files"), ("automations", "/api/automations"),
                                ("fleet", "/api/fleet?demo=1"), ("print_queue", "/api/queue?demo=1"),
                                ("chamber_climate", "/api/chamber?demo=1"),
                                ("timelapse", "/api/timelapse?demo=1")):
            modules.set_enabled(module_id, False)
            status, body = self.request(path)
            self.assertEqual((status, body.get("module_disabled")), (403, True), path)
            modules.set_enabled(module_id, True)


if __name__ == "__main__":
    unittest.main()
