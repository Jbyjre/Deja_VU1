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
from unittest.mock import patch
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
import print_preview            # noqa: E402
import print_queue              # noqa: E402
import sample_files             # noqa: E402
import stock_camera             # noqa: E402
from fake_moonraker import FakeMoonraker, history_job   # noqa: E402
from test_websocket import LiveClient                    # noqa: E402

NO_PRINTER = {"connected": False, "demo": False}
CUBE = "3dbenchy_pla.gcode"


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
    def test_selected_stock_camera_is_real_and_module_gated(self):
        self.addCleanup(stock_camera.stop_all)
        status, picture = self.request('/api/camera/snapshot?printer=' + self.pid)
        self.assertEqual(status, 200)
        self.assertIsInstance(picture, bytes)
        self.assertTrue(picture.startswith(b'\xff\xd8'))
        modules.set_enabled('camera', False)
        self.addCleanup(lambda: modules.set_enabled('camera', True))
        status, body = self.request('/api/camera/snapshot?printer=' + self.pid)
        self.assertEqual(status, 403)
        self.assertTrue(body.get('module_disabled'))

    def test_live_camera_is_one_continuous_stream_of_pictures(self):
        # The Printer page's camera: one MJPEG stream instead of a request per picture.
        self.addCleanup(stock_camera.stop_all)
        with urlopen(self.base + '/api/camera/live?printer=' + self.pid, timeout=10) as resp:
            self.assertTrue(resp.headers['Content-Type'].startswith('multipart/x-mixed-replace; boundary=dvframe'))
            self.assertEqual(resp.readline(), b'--dvframe\r\n')
            self.assertEqual(resp.readline(), b'Content-Type: image/jpeg\r\n')
            size = int(resp.readline().split(b':')[1])
            self.assertEqual(resp.readline(), b'\r\n')
            picture = resp.read(size)
        self.assertTrue(picture.startswith(b'\xff\xd8') and picture.endswith(b'\xff\xd9'))
        # A simulated printer has no live stream (the page shows single demo pictures), and
        # nothing is ever invented without a printer.
        for query in ('printer=u1-garage&demo=1', 'printer=u1-garage'):
            status, body = self.request('/api/camera/live?' + query)
            self.assertIn(body, (NO_PRINTER, {"error": "Live pictures come from a real printer. The demo shows "
                                                       "single pictures"}))

    def test_camera_never_invents_a_picture_without_printer_or_demo(self):
        status, body = self.request('/api/camera/snapshot?printer=u1-garage')
        self.assertEqual(status, 200)
        self.assertEqual(body, NO_PRINTER)
        status, body = self.request('/api/camera/snapshot?printer=u1-garage&demo=1')
        self.assertEqual(status, 200)
        self.assertIn(b'<svg', body)

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


class TestWatchOnly(RealPrinterAPI):
    """Watch-only mode: the server sends a real printer nothing but reads, the camera and E-stop."""

    def setUp(self):
        super().setUp()
        import watch_only
        watch_only.reset()
        self.addCleanup(watch_only.reset)

    def writes(self):
        return [r for r in self.fake.requests if r[0] != "GET" and r[1] != "/printer/objects/query"]

    def test_every_command_is_refused_and_nothing_reaches_the_printer(self):
        file_library.add_samples()
        self.printing()
        status, body = self.request("/api/app/watch-only", {"on": True})
        self.assertEqual((status, body["on"]), (200, True))
        before = len(self.writes())
        for path, sent in (("/api/printer/control/pause", {}), ("/api/printer/control/cancel", {}),
                           ("/api/printer/control/gcode", {"command": "G28"}),
                           ("/api/printer/control/home", {"axes": "XYZ"})):
            status, body = self.request(path + f"?printer={self.pid}", sent)
            self.assertEqual(status, 409, (path, body))
            self.assertTrue(body.get("watch_only"), (path, body))
            self.assertIn("Watch-only mode is on", body["error"])
        self.assertEqual(self.writes()[before:], [])
        self.assertEqual(mock_moonraker.real_printer(self.pid).snapshot()["state"], "printing")
        # Reading still works.
        status, state = self.request(f"/api/printer?printer={self.pid}")
        self.assertEqual((status, state["state"]), (200, "printing"))
        self.assertTrue(self.request("/api/app/info")[1]["watch_only"]["on"])

    def test_a_start_is_refused_before_any_upload(self):
        file_library.add_samples()
        self.request("/api/app/watch-only", {"on": True})
        status, body = self.request(f"/api/printer/control/start?printer={self.pid}",
                                    {"filename": CUBE, "confirmed": True})
        self.assertEqual(status, 409, body)
        self.assertNotIn(CUBE, self.fake.files)
        self.assertFalse(any(r[1].startswith("/server/files/upload") for r in self.fake.requests))

    def test_emergency_stop_is_never_refused(self):
        self.printing()
        self.request("/api/app/watch-only", {"on": True})
        status, body = self.request(f"/api/printer/control/estop?printer={self.pid}", {})
        self.assertEqual(status, 200, body)

    def test_turning_it_off_lets_commands_through_again(self):
        self.printing()
        self.request("/api/app/watch-only", {"on": True})
        self.request("/api/app/watch-only", {"on": False})
        status, body = self.request(f"/api/printer/control/pause?printer={self.pid}", {})
        self.assertEqual((status, body["confirmed_state"]["state"]), (200, "paused"))


class TestUpdatingDuringAPrint(RealPrinterAPI):
    """An update never waits for a print, never touches it, and sends the printer nothing while it restarts."""

    def setUp(self):
        super().setUp()
        import update_hold
        self.hold = update_hold
        update_hold.end()
        self.addCleanup(update_hold.end)

    def writes(self):
        return [r for r in self.fake.requests if r[0] != "GET" and r[1] != "/printer/objects/query"]

    def test_a_full_install_runs_while_the_printer_prints_and_the_print_is_untouched(self):
        import app_updates
        file_library.add_samples()
        self.printing()
        stopped = threading.Event()
        server = type("S", (), {"shutdown": lambda s: stopped.set()})()
        app_updates.set_job("idle")
        self.addCleanup(app_updates.set_job, "idle")
        before = len(self.fake.requests)
        with patch.dict(os.environ, DEJAVU_LAUNCHER="1"), patch.object(dv_app.memory, "snapshot"), \
                patch.object(app_updates, "prepare", return_value={"ready": True, "version": "9.9.9"}):
            reply = dv_app._install_update(server, background=True)
            self.assertTrue(reply["started"])
            self.assertTrue(stopped.wait(10), "the server should stop to restart into the update")
        self.assertEqual(app_updates.job()["state"], "restarting")
        self.assertEqual(mock_moonraker.real_printer(self.pid).snapshot()["state"], "printing")
        self.assertEqual([r for r in self.fake.requests[before:] if r[0] != "GET" and r[1] != "/printer/objects/query"],
                         [], "the printer must be sent nothing by an update")

    def test_commands_during_the_restart_are_refused_in_words_and_never_reach_the_printer(self):
        file_library.add_samples()
        self.printing()
        self.hold.begin("update")
        before = len(self.writes())
        for path, sent in (("/api/printer/control/pause", {}), ("/api/printer/control/cancel", {}),
                           ("/api/printer/control/gcode", {"command": "G28"}),
                           ("/api/printer/control/start", {"filename": CUBE, "confirmed": True})):
            status, body = self.request(path + f"?printer={self.pid}", sent)
            self.assertEqual(status, 409, (path, body))
            self.assertTrue(body.get("updating"), (path, body))
            self.assertIn("restarting", body["error"])
        self.assertEqual(self.writes()[before:], [])
        self.assertEqual(mock_moonraker.real_printer(self.pid).snapshot()["state"], "printing")
        status, state = self.request(f"/api/printer?printer={self.pid}")
        self.assertEqual((status, state["state"]), (200, "printing"))        # reading carries on

    def test_the_emergency_stop_is_never_held_back(self):
        self.printing()
        self.hold.begin("update")
        status, body = self.request(f"/api/printer/control/estop?printer={self.pid}", {})
        self.assertEqual(status, 200, body)

    def test_commands_work_again_once_the_hold_ends(self):
        self.printing()
        self.hold.begin("update")
        self.hold.end()
        status, body = self.request(f"/api/printer/control/pause?printer={self.pid}", {})
        self.assertEqual((status, body["confirmed_state"]["state"]), (200, "paused"))

    def test_the_alive_route_answers_without_the_slow_parts(self):
        with patch.object(dv_app.autostart, "status", side_effect=AssertionError("slow")), \
                patch.object(dv_app.readiness, "last_update", side_effect=AssertionError("slow")):
            status, body = self.request("/api/app/alive")
        self.assertEqual(status, 200, body)
        self.assertTrue(body["alive"])
        self.assertEqual(body["server_pid"], os.getpid())
        self.assertFalse(body["restarting"])
        self.hold.begin("update")
        self.assertTrue(self.request("/api/app/alive")[1]["restarting"])

    def test_a_print_that_finishes_during_the_restart_is_noticed_afterwards(self):
        self.printing()
        live_feed.refresh(self.pid)                    # the live feed sees it printing, and writes that down
        self.assertEqual(live_feed._remembered[self.pid]["state"], "printing")
        # What a new process starts with: no memory of its own, only the note on disk.
        live_feed._prev_state.clear()
        live_feed._remembered.clear()
        live_feed._checked_restart.clear()
        self.fake.set("print_stats", state="complete")      # the print ends while Deja Vu1 knows nothing
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot()["state"] == "complete"))
        live_feed.refresh(self.pid)
        self.assertTrue(any(e.get("event") == "finished" and e.get("printer") == self.pid
                            for e in live_feed.events_since(0)), live_feed.events_since(0))


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

    def test_sign_in_and_bare_addresses_through_the_api(self):
        key = "abcdef0123456789abcdef0123456789"
        locked = FakeMoonraker(api_key=key)
        self.addCleanup(locked.close)
        locked.users = {"admin": "pw-from-firmware-config"}
        bare = locked.url.split("//")[1]
        status, body = self.request("/api/printers/test", {"moonraker_url": bare})
        self.assertEqual((status, body["needs_key"], body["url"]), (200, True, locked.url))
        status, body = self.request("/api/printers/login", {"moonraker_url": bare, "username": "admin",
                                                            "password": "nope"})
        self.assertEqual(status, 400)
        self.assertIn("didn't accept", body["error"])
        status, body = self.request("/api/printers/login", {"moonraker_url": bare, "username": "admin",
                                                            "password": "pw-from-firmware-config"})
        self.assertEqual((status, body["api_key"]), (200, key))
        status, body = self.request("/api/printers/test", {"moonraker_url": bare, "api_key": key})
        self.assertTrue(body["ok"], body)

    def test_a_web_page_address_falls_back_to_moonrakers_port(self):
        # "http://<printer>" is its web page (port 80). When nothing there is
        # Moonraker, the test tries port 7125 and hands back the address that answered.
        import discovery
        asked = []

        def probe(url, api_key=None, timeout=3.0):
            asked.append(url)
            ok = url.endswith(":7125")
            return {"ok": ok, "url": url, "moonraker_version": None, "klippy_state": "ready" if ok else None,
                    "u1": ok, "toolheads": 4 if ok else None, "needs_key": False,
                    "error": None if ok else "Something answered there, but it isn't Moonraker"}
        with patch.object(discovery, "probe", probe):
            status, body = self.request("/api/printers/test", {"moonraker_url": "http://192.0.2.7/#/"})
            self.assertEqual((status, body["ok"], body["url"]), (200, True, "http://192.0.2.7:7125"))
            self.assertEqual(asked, ["http://192.0.2.7", "http://192.0.2.7:7125"])
            asked.clear()
            status, body = self.request("/api/printers/test", {"moonraker_url": "http://192.0.2.7:8080"})
            self.assertEqual((body["ok"], body["url"]), (False, "http://192.0.2.7:8080"))
            self.assertEqual(asked, ["http://192.0.2.7:8080"])

    def test_a_name_klipper_cannot_parse_is_refused_before_sending(self):
        # Klipper ends arguments at "#", "*" or ";" (u1-klipper gcode.py), so
        # firmware 2.0.0 refuses SDCARD_PRINT_FILE with an empty name.
        printer = mock_moonraker.real_printer(self.pid)
        with self.assertRaisesRegex(ValueError, "contains #"):
            printer.start_print("bracket#2.gcode")
        self.assertFalse(any(s.startswith("SDCARD_PRINT_FILE") for s in self.fake.scripts))

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


class TestPrintPreviewFromThePrinter(RealPrinterAPI):
    """The twin draws a real print from the printer's own copy of the file, with or without its index card."""

    WALL = "G90\nM83\nT0\nG1 Z0.2 F600\n;TYPE:Outer wall\nG1 X50 Y50 F3600\nG1 X60 Y50 E1\nG1 X60 Y60 E1\n"

    def preview(self):
        status, body = self.request(f"/api/print/preview?printer={self.pid}")
        self.assertEqual(status, 200, body)
        return body

    def test_the_layers_load_while_the_printer_has_no_metadata_for_the_file(self):
        # Moonraker reads a big file's metadata after it arrives; the print can start before that is done.
        self.fake.files["shoe.gcode"] = self.WALL.encode()
        self.assertNotIn("shoe.gcode", self.fake.metadata)
        self.fake.begin_print("shoe.gcode")
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot()["state"] == "printing"))
        body = self.preview()
        self.assertEqual(body["file"], "shoe.gcode")
        self.assertEqual(len(body["layers"]), 1)
        self.assertTrue(body["timeline"]["extrusion"])
        self.assertNotIn("reason", body)

    def test_the_layers_load_with_the_metadata_too(self):
        self.fake.files["shoe.gcode"] = self.WALL.encode()
        self.fake.metadata["shoe.gcode"] = {"size": len(self.WALL), "modified": 1_700_000_000.0}
        self.fake.begin_print("shoe.gcode")
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot()["state"] == "printing"))
        self.assertEqual(self.preview()["source"], f"printer:{self.pid}")

    def test_a_file_the_printer_cannot_hand_over_says_why_and_when_to_ask_again(self):
        self.fake.begin_print("missing.gcode")          # on the printer's screen, but not downloadable
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot()["state"] == "printing"))
        body = self.preview()
        self.assertEqual(body["file"], "missing.gcode")
        self.assertIn("could not be read", body["reason"])
        self.assertEqual(body["retry_s"], print_preview.RETRY_SECONDS)

    def test_the_printers_own_word_on_extruding_reaches_the_twin(self):
        self.printing()
        for velocity, expect in ((4.2, True), (0.0, False), (-3.0, False)):
            self.fake.set("motion_report", live_extruder_velocity=velocity)
            self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot()["sync"]["extruding"] is expect),
                            (velocity, mock_moonraker.real_printer(self.pid).snapshot().get("sync")))

    def test_the_extruders_speed_is_in_every_reading_even_when_nothing_prints(self):
        # A purge or a feed moves filament with no print running: the twin turns the spool and moves the filament.
        for velocity in (3.2, -1.5, 0.0):
            self.fake.set("motion_report", live_extruder_velocity=velocity)
            self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot().get("extruder_velocity") == velocity),
                            (velocity, mock_moonraker.real_printer(self.pid).snapshot().get("extruder_velocity")))
        self.assertNotEqual(mock_moonraker.real_printer(self.pid).snapshot()["state"], "printing")

    def test_without_that_field_the_twin_is_told_nothing(self):
        self.printing()
        self.fake.status["motion_report"].pop("live_extruder_velocity", None)
        self.fake.set("motion_report", live_velocity=0.0)
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot().get("sync") is not None))


if __name__ == "__main__":
    unittest.main()
