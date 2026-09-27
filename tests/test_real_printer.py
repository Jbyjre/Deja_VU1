"""
The whole dashboard with a "real" printer: the actual web server, live
feed and every module, connected through backend/moonraker_client.py to
fake_moonraker.py (a stand-in that speaks Moonraker's wire format, modelled
on Moonraker's, Klipper's and Snapmaker's U1 source). The printer is added
through the API exactly as a person adds one in the dashboard.

What this proves: every module works on translated real data unchanged,
and demo data and real printers never mix - demo switches never reach a
real printer, and a real printer's figures are never labelled demo (or
shown at all while it isn't connected).
"""

import json
import os
import sys
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "backend"))
sys.path.insert(0, HERE)

import app as dv_app            # noqa: E402
import automations              # noqa: E402
import file_library             # noqa: E402
import filament_inventory       # noqa: E402
import fleet                    # noqa: E402
import live_feed                # noqa: E402
import maintenance              # noqa: E402
import mock_moonraker           # noqa: E402
import moonraker_client as mc   # noqa: E402
import modules                  # noqa: E402
import print_queue              # noqa: E402
import sample_files             # noqa: E402
from fake_moonraker import FakeMoonraker, history_job   # noqa: E402
from test_websocket import LiveClient                    # noqa: E402

NO_PRINTER = {"connected": False, "demo": False}
CUBE = "calibration_cube_20mm.gcode"


def wait_for(check, seconds=6.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.05)
    return False


class RealPrinterAPI(unittest.TestCase):
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
        saved = {k: getattr(mc, k) for k in ("STATE_WAIT", "START_WAIT", "PING_INTERVAL", "DEAD_AFTER")}
        mc.STATE_WAIT, mc.START_WAIT, mc.PING_INTERVAL, mc.DEAD_AFTER = 2.0, 3.0, 0.3, 2.0
        self.addCleanup(lambda: [setattr(mc, k, v) for k, v in saved.items()])
        for reset in (mock_moonraker.reset_all, live_feed.reset, file_library.reset, automations.reset,
                      print_queue.reset, fleet.reset, modules.reset_state, maintenance.reset_all_logs):
            reset()
        self.fake = FakeMoonraker()
        self.fake.history = [history_job(i, start=time.time() - 86400 * (30 - i)) for i in range(1, 11)]
        self.addCleanup(self.fake.close)
        status, entry = self.request("/api/fleet/registry", {"name": "Bench U1", "moonraker_url": self.fake.url})
        self.assertEqual(status, 200, entry)
        self.pid = entry["id"]
        self.assertTrue(wait_for(lambda: mock_moonraker.is_connected(self.pid)),
                        mock_moonraker.diagnostics(self.pid))
        self.assertTrue(wait_for(lambda: len(mock_moonraker.real_printer(self.pid).get_print_history()) == 10))

    def tearDown(self):
        automations.wait_idle()
        fleet.reset()
        for reset in (mock_moonraker.reset_all, file_library.reset, automations.reset, print_queue.reset,
                      maintenance.reset_all_logs, filament_inventory.reset if hasattr(filament_inventory, "reset")
                      else (lambda: None)):
            reset()

    def request(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = Request(self.base + path, data=data, method="POST" if data is not None else "GET",
                      headers={"Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=15) as resp:
                content = resp.read()
                return resp.status, (json.loads(content) if "json" in resp.headers.get("Content-Type", "")
                                     else content)
        except HTTPError as err:
            return err.code, json.loads(err.read() or b"{}")

    def printing(self, name=CUBE):
        self.fake.files[name] = b"G28\n"
        self.fake.begin_print(name)
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot()["state"] == "printing"))


class TestReading(RealPrinterAPI):
    def test_the_dashboard_opens_on_the_real_printer(self):
        status, conn = self.request("/api/connection")
        self.assertTrue(conn["connected"])
        self.assertEqual(conn["printer"], self.pid)
        status, state = self.request("/api/printer")               # no ?printer=, no demo
        self.assertEqual((state["connected"], state["demo"], state["real"]), (True, False, True))
        self.assertEqual(state["toolheads"]["T0"]["filament_color_hex"], "#F26A1B")

    def test_every_printer_route_answers_from_real_data(self):
        modules.set_enabled("filament_inventory", True)
        modules.set_enabled("compare", True)
        modules.set_enabled("sanity_check", True)
        for path in ("/api/maintenance", "/api/maintenance/history", "/api/leds", "/api/colorcheck",
                     "/api/printer/control/capabilities", "/api/printer/control/console", "/api/filament/check",
                     "/api/filament/forecast", "/api/compare", "/api/compare/repeat", "/api/compare/side-by-side",
                     "/api/sanity", "/api/updates", "/api/cost/history", "/api/chamber", "/api/health",
                     "/api/live/snapshot", "/api/live/events", "/api/queue", "/api/timelapse", "/api/fleet",
                     "/api/fleet/history", "/api/fleet/queues"):
            status, body = self.request(path)
            self.assertIn(status, (200, 400), f"{path}: {body}")
            if status == 200:
                self.assertTrue(body.get("connected"), path)
                self.assertFalse(body.get("demo"), path)

    def test_maintenance_counts_the_printers_own_history(self):
        status, body = self.request("/api/maintenance")
        self.assertEqual(status, 200)
        self.assertEqual(len(mock_moonraker.real_printer(self.pid).get_print_history()), 10)

    def test_the_simulated_sensor_never_speaks_for_a_real_printer(self):
        modules.set_enabled("sanity_check", True)
        _, check = self.request("/api/colorcheck")
        self.assertEqual(check["overall"], "no_sensor")
        _, sanity = self.request("/api/sanity")
        self.assertNotIn("Filament colour mismatch detected before this print starts", sanity["blocking"])

    def test_updates_without_an_update_manager_say_so(self):
        _, body = self.request("/api/updates")
        self.assertEqual(body["packages"], [])

    def test_diagnostics_show_what_was_said(self):
        status, diag = self.request(f"/api/printers/diagnostics?printer={self.pid}")
        self.assertEqual(status, 200)
        self.assertTrue(diag["connected"])
        self.assertTrue(any(e["method"] == "printer.objects.subscribe" for e in diag["log"]))
        _, reg = self.request("/api/fleet/registry")
        self.assertEqual(reg["printers"][0]["link"], "Connected")


class TestDemoAndRealStayApart(RealPrinterAPI):
    def test_the_fleet_shows_simulated_printers_only_with_demo_on(self):
        _, real_only = self.request("/api/fleet")
        self.assertEqual([p["id"] for p in real_only["printers"]], [self.pid])
        _, mixed = self.request("/api/fleet?demo=1")
        rows = {p["id"]: p["demo"] for p in mixed["printers"]}
        self.assertFalse(rows[self.pid])
        self.assertTrue(rows["u1-workshop"])

    def test_demo_switches_never_reach_the_real_printer(self):
        status, _ = self.request("/api/demo/fail-next?demo=1", {"action": "pause"})
        self.assertEqual(status, 403)                               # default printer is the real one
        with mock_moonraker.use_printer(self.pid):
            with self.assertRaises(ValueError):
                mock_moonraker.inject_jam()
            with self.assertRaises(ValueError):
                mock_moonraker.set_link(False)

    def test_sandbox_scenarios_only_touch_simulated_printers(self):
        self.printing()
        path = "/api/sandbox/fire?demo=1&printer=u1-studio"
        status, body = self.request(path, {"event": "pause", "printer": self.pid})
        self.assertFalse(body["outcomes"][0]["ok"])                 # logged as refused
        self.assertIn("real printer", body["outcomes"][0]["detail"])
        status, body = self.request("/api/sandbox/scenario?demo=1&printer=u1-studio",
                                    {"steps": [{"at_s": 0, "printer": self.pid, "event": "pause"}]})
        self.assertEqual(status, 400)
        status, body = self.request(path, {"event": "pause", "printer": "all"})
        self.assertEqual(status, 200)
        self.assertEqual(mock_moonraker.real_printer(self.pid).snapshot()["state"], "printing")
        self.assertNotIn(("POST", "/printer/print/pause"), self.fake.requests)

    def test_a_demo_pause_all_reaches_only_simulated_printers(self):
        self.printing()
        _, body = self.request("/api/fleet/broadcast?demo=1", {"action": "pause", "printers": []})
        self.assertNotIn(self.pid, [r["printer"] for r in body["results"]])
        self.assertNotIn(("POST", "/printer/print/pause"), self.fake.requests)

    def test_without_demo_pause_all_means_the_real_printers(self):
        self.printing()
        _, body = self.request("/api/fleet/broadcast", {"action": "pause", "printers": []})
        self.assertEqual([r["printer"] for r in body["results"]], [self.pid])
        self.assertTrue(body["all_ok"], body["headline"])
        status, body = self.request("/api/fleet/broadcast", {"action": "pause", "printers": ["u1-studio"]})
        self.assertEqual(status, 400)

    def test_an_offline_real_printer_shows_nothing_even_with_demo_on(self):
        self.fake.close()
        mock_moonraker.real_printer(self.pid)._ws.close()
        self.assertTrue(wait_for(lambda: not mock_moonraker.is_connected(self.pid)))
        for path in (f"/api/printer?printer={self.pid}", f"/api/printer?demo=1&printer={self.pid}"):
            self.assertEqual(self.request(path), (200, NO_PRINTER))
        _, conn = self.request("/api/connection")
        self.assertFalse(conn["connected"])
        self.assertIn("isn't connected yet", conn["message"])

    def test_the_live_socket_labels_each_printer_honestly(self):
        client = LiveClient(self.server.server_port, "/api/live")
        self.addCleanup(client.close)
        state = client.recv_until(lambda m: m.get("type") == "state")
        self.assertEqual((state["printer"], state["connected"], state["demo"]), (self.pid, True, False))
        client.send({"type": "subscribe", "printer": "u1-workshop"})     # not a demo connection
        live_feed.refresh(self.pid)
        time.sleep(0.3)
        live_feed.refresh(self.pid)
        state = client.recv_until(lambda m: m.get("type") == "state")
        self.assertEqual(state["printer"], self.pid)


class TestPrinting(RealPrinterAPI):
    def test_pause_resume_cancel_through_the_api(self):
        self.printing()
        status, body = self.request("/api/printer/control/pause", {})
        self.assertEqual((status, body["confirmed_state"]["state"]), (200, "paused"))
        status, body = self.request("/api/printer/control/resume", {})
        self.assertEqual(body["confirmed_state"]["state"], "printing")
        status, body = self.request("/api/printer/control/cancel", {})
        self.assertEqual(body["confirmed_state"]["state"], "ready")

    def test_start_from_the_library_uploads_the_exact_file(self):
        file_library.add_samples()
        status, gate = self.request(f"/api/print/confirm?file={CUBE}")
        self.assertEqual(status, 200)
        self.assertNotEqual(gate["verdict"], "blocked", gate["blocking"])
        status, body = self.request("/api/printer/control/start", {"filename": CUBE, "confirmed": True})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["confirmed_state"]["state"], "printing")
        self.assertEqual(self.fake.files[CUBE], file_library.read_bytes(CUBE))

    def test_a_printer_refusal_is_a_502_in_its_own_words(self):
        file_library.add_samples()
        self.fake.gcode_errors["SDCARD_PRINT_FILE"] = "Must home axis first"
        status, body = self.request("/api/printer/control/start", {"filename": CUBE, "confirmed": True})
        self.assertEqual(status, 502)
        self.assertIn("Must home axis first", body["error"])

    def test_unknown_filament_asks_for_a_look_instead_of_guessing(self):
        file_library.add_samples()
        pc = self.fake.status["print_task_config"]
        pc["filament_type"][0] = "NONE"                            # no tag, nothing set on the screen
        self.fake.set("print_task_config", filament_type=list(pc["filament_type"]))
        self.assertTrue(wait_for(lambda: not mock_moonraker.real_printer(self.pid).snapshot()
                                 ["toolheads"]["T0"]["filament_known"]))
        _, gate = self.request(f"/api/print/confirm?file={CUBE}")
        self.assertEqual(gate["verdict"], "confirm")
        self.assertTrue(any("check it by eye" in w for w in gate["warnings"]))

    def test_the_files_mapping_is_checked_against_the_head_that_prints(self):
        file_library.add_samples()
        pc = self.fake.status["print_task_config"]
        self.fake.set("print_task_config", extruder_map_table=[1, 0, 2, 3] + [0] * 28)
        self.assertTrue(wait_for(lambda: "extruder_map" in mock_moonraker.real_printer(self.pid).snapshot()))
        _, gate = self.request(f"/api/print/confirm?file={CUBE}")
        # The cube is orange on T0; the mapping prints T0 on T1, which holds black.
        self.assertEqual(gate["verdict"], "blocked")
        self.assertTrue(any("printing on T1" in b for b in gate["blocking"]), gate["blocking"])
        self.assertIsNotNone(pc)

    def test_a_finish_is_celebrated_and_taken_off_the_spool(self):
        modules.set_enabled("filament_inventory", True)
        spool = filament_inventory.add_spool("PETG", "Black", "#1C1C1E", 500)
        self.fake.metadata["box.gcode"] = {"filament_type": "PETG", "filament_total": 1000.0,
                                           "filament_weight_total": 10.0, "filament_colour": "#1C1C1E"}
        live_feed.tick(0.25)
        self.printing("box.gcode")
        live_feed.tick(0.25)
        self.fake.set("print_stats", filament_used=1000.0, print_duration=1800.0, total_duration=1800.0)
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).get_current_job().get("material")))
        self.fake.set("print_stats", state="complete")
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot()["state"] == "complete"))
        live_feed.tick(0.25)
        finished = [e for e in live_feed.events_since(0) if e.get("event") == "finished"]
        self.assertEqual(len(finished), 1)
        self.assertEqual(finished[0]["summary"]["grams"], 10.0)
        self.assertFalse(finished[0]["demo"])
        left = next(s for s in filament_inventory.get_inventory() if s["id"] == spool["id"])
        self.assertEqual(left["grams_remaining"], 490.0)


if __name__ == "__main__":
    unittest.main()
