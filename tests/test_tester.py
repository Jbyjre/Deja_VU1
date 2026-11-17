"""
Tester mode (backend/tester.py, backend/tester_report.py): the record a tester saves as one zip.

What these prove:
  - switched off, every tester route answers 403 and nothing is written;
  - switched on, events are kept, and nothing private reaches events.jsonl, report.json or report.html;
  - a long week of events is thinned to stay under the forum's attachment limit, and the report says so;
  - the saved zip holds every section, with the slow action and the error that were recorded.
"""

import io
import json
import os
import sys
import threading
import time
import unittest
import zipfile
from http.server import HTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import app as dv_app                 # noqa: E402
import file_library                  # noqa: E402
import modules                       # noqa: E402
import storage                       # noqa: E402
import tester                        # noqa: E402
import tester_report                 # noqa: E402

PRIVATE = [
    "192.168.1.77", "10.20.30.40", "fe80::dead:beef", "aa:bb:cc:dd:ee:ff",
    "sk-LIVEKEYabcdefghij123456", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "hunter2hunter2",
    "AbCdEfGhIjKlMnOpQrStUvWx12345678",
    "/Users/jane.doe/", "C:\\Users\\JaneDoe\\", "jane.doe", "JaneDoe",
    "Joe's Secret Keychain", "Quarterly Dragon Prototype", "snapmaker-garage.local", "GarageWifi5G",
    "U1-SERIAL-ABC12345", "someone@example.org",
]


def _all_text(data):
    """Everything a person could read in a saved zip."""
    z = zipfile.ZipFile(io.BytesIO(data))
    return "\n".join(z.read(name).decode("utf-8") for name in z.namelist())


class TesterBase(unittest.TestCase):
    def setUp(self):
        modules.set_enabled("tester", False)
        tester.refresh()
        tester.delete_all()

    def tearDown(self):
        modules.set_enabled("tester", False)
        tester.refresh()
        tester.delete_all()

    def turn_on(self):
        modules.set_enabled("tester", True)
        tester.refresh()


class TestTheSwitch(TesterBase):
    def test_it_is_a_setting_that_starts_off(self):
        module = next(m for m in modules.get_all() if m["id"] == "tester")
        self.assertEqual(module["kind"], "setting")
        self.assertFalse(module["enabled"])
        self.assertNotIn("tester", modules.EXTRAS)

    def test_nothing_is_written_while_it_is_off(self):
        self.assertFalse(tester.record("note", text="hello"))
        self.assertEqual(tester.ingest({"events": [{"k": "click", "ctl": "#a"}]}), {"accepted": 0, "dropped": 0, "enabled": False})
        tester.note_error("server", ValueError("x"))
        tester.note_gate("a.gcode", {"verdict": "clear"})
        self.assertEqual(tester.event_files(), [])
        self.assertFalse(os.path.exists(os.path.join(tester.folder(), "ids.json")))

    def test_turning_it_off_stops_recording_at_once_and_keeps_what_was_recorded(self):
        self.turn_on()
        self.assertTrue(tester.record("note", text="first"))
        modules.set_enabled("tester", False)
        tester.refresh()
        self.assertFalse(tester.record("note", text="second"))
        self.assertEqual(sum(1 for _ in tester_report.iter_events(tester.event_files())), 1)

    def test_the_environment_variable_turns_it_on_at_start(self):
        old = os.environ.get("DEJAVU_TESTER")
        try:
            os.environ["DEJAVU_TESTER"] = "1"
            modules.apply_environment()
            self.assertTrue(modules.is_enabled("tester"))
            modules.set_enabled("tester", False)               # Settings can still turn it off afterwards
            self.assertFalse(modules.is_enabled("tester"))
        finally:
            if old is None:
                os.environ.pop("DEJAVU_TESTER", None)
            else:
                os.environ["DEJAVU_TESTER"] = old

    def test_delete_removes_everything(self):
        self.turn_on()
        tester.record("note", text="a")
        tester.file_label("x.3mf", 100)
        self.assertTrue(tester.event_files())
        tester.delete_all()
        self.assertEqual(tester.event_files(), [])
        self.assertEqual(os.listdir(tester.folder()) if os.path.isdir(tester.folder()) else [], [])

    def test_backups_leave_the_record_out(self):
        import backup
        self.assertIn("tester", backup._EXCLUDED)


class TestTheRoutes(TesterBase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.base = "http://127.0.0.1:%d" % cls.server.server_port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def call(self, method, path, payload=None, headers=None):
        data = json.dumps(payload).encode() if payload is not None else (b"{}" if method == "POST" else None)
        request = Request(self.base + path, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urlopen(request, timeout=20) as response:
                return response.status, response.read(), response.headers
        except HTTPError as err:
            return err.code, err.read(), err.headers

    def test_every_tester_route_answers_403_while_it_is_off(self):
        for method, path in (("GET", "/api/tester/status"), ("GET", "/api/tester/report.html"), ("GET", "/api/tester/report.zip"),
                             ("POST", "/api/tester/events"), ("POST", "/api/tester/delete")):
            status, body, _ = self.call(method, path, {"events": []} if method == "POST" else None)
            self.assertEqual(status, 403, path)
            self.assertTrue(json.loads(body).get("module_disabled"), path)
        self.assertEqual(tester.event_files(), [])

    def test_the_browser_can_switch_it_on_send_events_and_save_a_report(self):
        status, body, _ = self.call("POST", "/api/modules/tester/toggle", {"enabled": True})
        self.assertEqual(status, 200)
        status, body, _ = self.call("POST", "/api/tester/events", {"events": [
            {"k": "session", "s": "abc123", "ev": "start", "device": "desk", "w": 1366, "h": 768},
            {"k": "click", "s": "abc123", "ctl": "#pause", "screen": "printer", "paint": 1400},
            {"k": "err", "s": "abc123", "kind": "js", "msg": "TypeError: x is undefined", "file": "app.js", "line": 12}]})
        self.assertEqual(json.loads(body)["accepted"], 3)
        status, body, _ = self.call("GET", "/api/tester/status")
        info = json.loads(body)
        self.assertEqual((info["actions"], info["errors"], info["slow"]), (1, 1, 1))
        status, body, headers = self.call("GET", "/api/tester/report.html?theme=dark")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers["Content-Type"])
        self.assertIn("script-src" if False else "default-src 'none'", headers["Content-Security-Policy"])
        self.assertIn(b'data-theme="dark"', body)
        status, body, headers = self.call("GET", "/api/tester/report.zip")
        self.assertEqual(status, 200)
        self.assertRegex(headers["Content-Disposition"], r'deja-vu1-tester-report-\d{4}-\d{2}-\d{2}\.zip')
        self.assertEqual(sorted(zipfile.ZipFile(io.BytesIO(body)).namelist()), ["README.txt", "events.jsonl", "report.html", "report.json"])
        status, body, _ = self.call("POST", "/api/tester/delete")
        self.assertEqual(status, 200)
        self.assertEqual(tester.event_files(), [])

    def test_a_page_from_another_site_cannot_write_events(self):
        self.turn_on()
        status, body, _ = self.call("POST", "/api/tester/events", {"events": [{"k": "click", "ctl": "#x"}]},
                                    headers={"Origin": "http://evil.example"})
        self.assertEqual(status, 403)
        self.assertEqual(tester.event_files(), [])

    def test_saving_with_nothing_recorded_says_so_in_words(self):
        self.turn_on()
        status, body, _ = self.call("GET", "/api/tester/report.zip")
        self.assertEqual(status, 400)
        self.assertIn("Nothing has been recorded", json.loads(body)["error"])

    def test_a_server_error_is_recorded_with_where_but_no_source_text(self):
        self.turn_on()
        try:
            raise RuntimeError("boom at 192.168.1.77 for /Users/jane.doe/x")
        except RuntimeError as exc:
            tester.note_error("server", exc, route="/api/files/thumb?name=Quarterly Dragon Prototype.3mf", status=500)
        events = list(tester_report.iter_events(tester.event_files()))
        self.assertEqual(events[0]["k"], "err")
        text = json.dumps(events)
        self.assertIn("RuntimeError", text)
        self.assertIn("test_tester.py", text)
        for secret in ("192.168.1.77", "jane.doe", "Quarterly Dragon"):
            self.assertNotIn(secret, text)


class TestMasking(TesterBase):
    def test_masking_is_idempotent_and_leaves_versions_and_times_alone(self):
        for text in ("Slicer 02.08.01.55 and Orca 2.4.2 at 2026-11-17T12:30:45 stage input", "file 3, .3mf, 2.4 MB",
                     "The printer is busy (printing file 2 (3mf))", "Layer 12 of 340, 215 C"):
            self.assertEqual(tester.mask(text), text)
            self.assertEqual(tester.mask(tester.mask(text)), tester.mask(text))

    def test_firmware_versions_that_look_like_addresses_stay_versions(self):
        self.turn_on()
        tester.record("printer", ev="firmware", printer="printer 1", facts={"product_info.firmware_version": "1.0.0.123"})
        event = next(tester_report.iter_events(tester.event_files()))
        self.assertEqual(event["facts"]["product_info.firmware_version"], "1.0.0.123")
        self.assertEqual(tester_report._remask(event, {})["facts"]["product_info.firmware_version"], "1.0.0.123")

    def test_known_names_are_replaced_wherever_they_appear(self):
        name = "Quarterly Dragon Prototype.3mf"
        tester.file_label(name, 1234)             # the app handled this file, so the recorder knows its name
        tester._known_cache["at"] = 0.0
        for text in ("Couldn't slice Quarterly Dragon Prototype.3mf: no plates", "quarterly dragon prototype.3MF is missing",
                     "Opened 'Quarterly Dragon Prototype.3mf'"):
            out = tester.mask(text)
            self.assertNotIn("Dragon", out, out)
            self.assertIn("file ", out)

    def test_quoted_names_with_apostrophes_and_paths_are_replaced(self):
        for text in ("Cannot open 'Joe's Secret Keychain.stl' now", 'Cannot open "Joe\'s Secret Keychain.stl" now',
                     "Read /Users/jane.doe/Documents/Joe's Secret Keychain.gcode", "Read C:\\Users\\JaneDoe\\Desktop\\Keychain.gcode"):
            out = tester.mask(text)
            for secret in ("Secret", "Keychain", "jane.doe", "JaneDoe"):
                self.assertNotIn(secret, out, out)

    def test_users_with_a_space_in_their_name_are_hidden(self):
        out = tester.mask("C:\\Users\\Bob Smith\\AppData\\x and /Users/Bob Smith/Library/y")
        self.assertNotIn("Bob", out)
        self.assertNotIn("Smith", out)

    def test_addresses_keys_wifi_and_serials_are_hidden(self):
        text = ("Could not reach http://192.168.1.77:7125/printer/info; also 10.20.30.40 fe80::dead:beef aa:bb:cc:dd:ee:ff "
                "api_key=hunter2hunter2 Authorization: Bearer AbCdEfGhIjKlMnOpQrStUvWx12345678 sk-LIVEKEYabcdefghij123456 "
                "ghp_abcdefghijklmnopqrstuvwxyz0123456789 ssid: GarageWifi5G Wi-Fi network 'GarageWifi5G' "
                "serial number: U1-SERIAL-ABC12345 host snapmaker-garage.local:7125 mail someone@example.org")
        out = tester.mask(text, 2000)
        for secret in PRIVATE:
            if secret.startswith(("/Users", "C:\\", "jane", "Jane", "Joe", "Quarterly")):
                continue
            self.assertNotIn(secret, out, secret)

    def test_spool_names_the_person_typed_are_hidden_too(self):
        import filament_inventory
        filament_inventory.add_spool("PLA", "Aunt Marge's Galaxy Black", "#101010", 800)
        tester._known_cache["at"] = 0.0
        try:
            out = tester.mask('button "Remove spool Aunt Marge\'s Galaxy Black" in #filament-card')
            self.assertNotIn("Marge", out)
            self.assertNotIn("Galaxy", out)
            self.assertIn("<spool>", out)
            self.assertEqual(tester.mask("A black screen appeared"), "A black screen appeared")
        finally:
            for spool in filament_inventory.get_inventory():
                if spool.get("color_name") == "Aunt Marge's Galaxy Black":
                    filament_inventory.remove_spool(spool["id"])
            tester._known_cache["at"] = 0.0

    def test_routes_lose_ids_and_queries(self):
        self.assertEqual(tester.route_of("/api/fleet/registry/u1-garage/remove?key=abc"), "/api/fleet/registry/:id/remove")
        self.assertEqual(tester.route_of("/api/files/thumb?name=Secret.3mf"), "/api/files/thumb")
        self.assertEqual(tester.route_of("http://192.168.1.77:8000/api/modules/printer_control/toggle"), "/api/modules/printer_control/toggle")

    def test_nothing_private_survives_the_whole_pipeline(self):
        """Feed private text through every way in, save the zip, and look for it in every file."""
        self.turn_on()
        name = "Quarterly Dragon Prototype.3mf"
        tester.file_label(name, 5000)
        tester._known_cache["at"] = 0.0
        private_text = ("%s at 192.168.1.77 key sk-LIVEKEYabcdefghij123456 in /Users/jane.doe/Documents and C:\\Users\\JaneDoe\\x "
                        "on snapmaker-garage.local ssid: GarageWifi5G serial: U1-SERIAL-ABC12345" % name)
        tester.ingest({"events": [
            {"k": "click", "s": "aaa111", "ctl": 'button "Print %s" in #files' % name, "screen": "files", "paint": 20,
             "value": "Joe's Secret Keychain", "text": "Joe's Secret Keychain", "typed": "TYPEDMARKER123"},
            {"k": "err", "s": "aaa111", "kind": "toast", "msg": private_text, "screen": "files", "last": [private_text, "click #x"]},
            {"k": "note", "s": "aaa111", "text": "It froze. " + private_text, "screen": "files", "last": [private_text]},
            {"k": "req", "s": "aaa111", "route": "/api/files/%s" % name, "method": "POST", "status": 500, "ms": 5, "err": private_text},
            {"k": "screen", "s": "aaa111", "screen": "files; DROP TABLE", "ms": 100},
            {"k": "setup", "s": "aaa111", "browser": "Chrome", "bver": "131", "ua_os": "Windows", "w": 1366, "h": 768,
             "look": "glass", "theme": "dark", "lang": "en"},
        ]})
        tester.note_refused("/api/printer/control/start", 409, private_text)
        tester.note_gate(name, {"verdict": "blocked", "blocking": [private_text], "warnings": [], "info": []}, 5000)
        tester.record("slice", engine="Orca", version="2.4.2", ok=False, status="failed", model=tester.file_label(name),
                      report=json.dumps({"input": {"name": name}, "host": "/Users/jane.doe/", "note": private_text}))
        tester.record("update", **{"from": "0.20.14", "to": "0.20.15", "ok": False, "words": private_text})
        filename, data = tester_report.build_zip()
        everything = _all_text(data)
        for secret in PRIVATE + [name, "Dragon", "DROP TABLE", "TYPEDMARKER123", "Secret Keychain"]:
            self.assertNotIn(secret, everything, "private text reached the zip: %s" % secret)
        for section in ("report.html", "report.json", "events.jsonl", "README.txt"):
            self.assertIn(section, zipfile.ZipFile(io.BytesIO(data)).namelist())
        # What is meant to stay: the tester's own note, minus anything private
        self.assertIn("It froze.", everything)

    def test_only_known_fields_and_shapes_are_kept_from_the_browser(self):
        self.turn_on()
        result = tester.ingest({"events": [
            {"k": "click", "ctl": "#a", "paint": "slow", "screen": "not a word with spaces", "extra": "typed text"},
            {"k": "nonsense"}, "text", None, 4,
            {"k": "note", "text": ""}]})
        self.assertEqual(result["accepted"], 1)
        self.assertEqual(result["dropped"], 5)
        (event,) = list(tester_report.iter_events(tester.event_files()))
        self.assertEqual(sorted(event), ["ctl", "k", "t"])

    def test_a_batch_is_capped(self):
        self.turn_on()
        result = tester.ingest({"events": [{"k": "click", "ctl": "#a", "paint": 5}] * (tester.MAX_BATCH + 50)})
        self.assertEqual(result["accepted"], tester.MAX_BATCH)
        self.assertEqual(result["dropped"], 50)


class TestHooks(TesterBase):
    def events(self):
        return list(tester_report.iter_events(tester.event_files()))

    def test_print_events_gate_and_links_are_noted(self):
        self.turn_on()
        tester.note_print_event({"type": "print_event", "event": "started", "printer": "u1-test", "file": "Benchy Boat.gcode", "demo": False})
        tester.note_print_event({"type": "print_event", "event": "finished", "printer": "u1-test", "file": "Benchy Boat.gcode", "demo": False,
                                 "summary": {"hours": 1.5, "grams": 42.0, "material": "PLA"}})
        tester.note_print_event({"type": "queue"})
        tester.note_start("Benchy Boat.gcode", "u1-test")
        tester.note_link("u1-test", {"link_lost": False}, False)
        tester.note_link("u1-test", {"link_lost": True}, False)
        tester.note_link("u1-test", {"link_lost": False}, False)
        tester.note_link("demo-1", {"link_lost": True}, True)            # a simulated printer is not a connection
        kinds = [(e["k"], e.get("ev")) for e in self.events()]
        self.assertEqual([k for k in kinds if k[1] in ("print_started", "print_finished", "start_requested")],
                         [("printer", "print_started"), ("printer", "print_finished"), ("printer", "start_requested")])
        self.assertEqual([e["ev"] for e in self.events() if e.get("ev") in ("connect", "drop", "reconnect")], ["connect", "drop", "reconnect"])
        self.assertNotIn("Benchy", json.dumps(self.events()))
        self.assertNotIn("u1-test", json.dumps(self.events()))

    def test_confirm_print_checks_and_whether_the_tester_went_on(self):
        self.turn_on()
        tester.note_gate("A.gcode", {"verdict": "confirm", "warnings": ["Maintenance overdue: nozzle"], "blocking": [], "info": []}, 2048)
        tester.note_start("A.gcode", "p")
        tester.note_gate("B.gcode", {"verdict": "blocked", "blocking": ["The printer is busy (printing)"], "warnings": [], "info": []}, 4096)
        report = tester_report.build_report()
        cp = report["confirm_print"]
        self.assertEqual((cp["checks"], cp["by_verdict"], cp["went_on_to_print"]), (2, {"confirm": 1, "blocked": 1}, 1))
        self.assertEqual({r["reason"] for r in cp["reasons"]}, {"Maintenance overdue: nozzle", "The printer is busy (printing)"})

    def test_slices_conversions_and_updates(self):
        self.turn_on()
        tester.note_slice({"status": "failed", "model": "M.3mf", "stage": "run", "cause": {"code": "engine_exit"},
                           "started_at": "2026-11-17T10:00:00", "finished_at": "2026-11-17T10:00:12"},
                          {"engine": {"app": "OrcaSlicer", "version": "2.4.2"}, "stage": {"reached": "run"}})
        tester.note_slice({"status": "done", "model": "M.3mf"}, {"engine": {"app": "OrcaSlicer", "version": "2.4.2"}})
        tester.note_convert("P.3mf", {"source_label": "Bambu Studio", "plates": [1, 2], "filaments": [1, 2, 3], "warnings": ["Check the nozzle"]})
        tester.note_convert("Q.3mf", None, error="This isn't a project")
        tester.note_update_result({"ok": True, "version": "0.20.16", "previous": "0.20.15", "message": "", "at": 1})
        tester.note_update_result({"ok": True, "version": "0.20.16", "previous": "0.20.15", "message": "", "at": 1})     # once only
        report = tester_report.build_report()
        slices = report["slicing"]
        self.assertEqual([s["ok"] for s in slices], [False, True])
        self.assertEqual(slices[0]["seconds"], 12.0)
        self.assertEqual(slices[0]["engine"], "OrcaSlicer")
        self.assertIn("engine", slices[0]["report"])
        self.assertIsNone(slices[1]["report"])
        self.assertEqual([c["ok"] for c in report["converter"]], [True, False])
        self.assertEqual((report["converter"][0]["source"], report["converter"][0]["plates"], report["converter"][0]["colours"]), ("Bambu Studio", 2, 3))
        self.assertEqual(len(report["updates"]), 1)
        self.assertEqual((report["updates"][0]["from"], report["updates"][0]["to"]), ("0.20.15", "0.20.16"))


def _line(event):
    return json.dumps(event, separators=(",", ":")) + "\n"


class TestTheReport(TesterBase):
    def synthetic_session(self):
        """A short session with a slow click, an error, printer events, smoothness and a note."""
        self.turn_on()
        now = int(time.time() * 1000)
        events = [
            {"k": "session", "s": "sess01", "ev": "start", "device": "desk", "w": 1366, "h": 768, "t": now - 600000},
            {"k": "setup", "s": "sess01", "browser": "Chrome", "bver": "131", "ua_os": "Linux", "w": 1366, "h": 768, "dpr": 1, "look": "glass",
             "theme": "light", "lang": "en", "t": now - 599000},
            {"k": "screen", "s": "sess01", "screen": "overview", "ms": 20000, "t": now - 590000},
            {"k": "screen", "s": "sess01", "screen": "printer", "ms": 60000, "t": now - 570000},
            {"k": "click", "s": "sess01", "ctl": "#pause-btn", "screen": "printer", "paint": 40, "req": 300, "t": now - 500000},
            {"k": "click", "s": "sess01", "ctl": "#slow-btn", "screen": "printer", "paint": 2600, "req": 2800, "slow": True, "t": now - 400000},
            {"k": "long", "s": "sess01", "ms": 450, "screen": "printer", "t": now - 399000},
            {"k": "req", "s": "sess01", "route": "/api/printer/control/exclude", "method": "POST", "status": 200, "ms": 90, "t": now - 300000},
            {"k": "req", "s": "sess01", "route": "/api/printer/control/pause", "method": "POST", "status": 409, "ms": 80,
             "err": "Pause refused", "t": now - 290000},
            {"k": "req", "s": "sess01", "route": "/api/live/snapshot", "method": "GET", "agg": True, "n": 120, "ok": 120, "fail": 0, "p50": 12, "max": 80, "t": now - 280000},
            {"k": "err", "s": "sess01", "kind": "js", "msg": "TypeError: Cannot read properties of undefined (reading 'x')", "file": "app.js", "line": 10,
             "screen": "printer", "last": ["click #pause-btn", "click #slow-btn"], "t": now - 250000},
            {"k": "err", "s": "sess01", "kind": "js", "msg": "TypeError: Cannot read properties of undefined (reading 'x')", "file": "app.js", "line": 11,
             "screen": "printer", "t": now - 240000},
            {"k": "printer", "ev": "confirmed", "what": "Paused", "ms": 420, "t": now - 230000},
            {"k": "fps", "s": "sess01", "surface": "twin", "fps": 41, "layers": 300, "t": now - 220000},
            {"k": "fps", "s": "sess01", "surface": "gcode", "fps": 58, "layers": 120, "t": now - 210000},
            {"k": "feature", "name": "needs_you", "s": "sess01", "t": now - 200000},
            {"k": "note", "s": "sess01", "text": "The pause button felt stuck", "screen": "printer", "last": ["click #slow-btn"], "t": now - 190000},
            {"k": "session", "s": "sess01", "ev": "end", "ms": 480000, "t": now - 100000},
        ]
        tester.ingest({"events": events})
        tester.record("printer", ev="print_started", printer="printer 1", demo=False, file=tester.file_label("A.gcode", 1000))
        tester.record("printer", ev="print_failed", printer="printer 1", demo=False, file=tester.file_label("A.gcode", 1000))
        tester.record("printer", ev="refused", route="/api/printer/control/home", words="Homing is refused mid-print")
        tester.record("printer", ev="firmware", printer="printer 1", facts={"moonraker_version": "v0.9.3", "machine_type": "Snapmaker U1"})
        tester.note_gate("A.gcode", {"verdict": "clear", "blocking": [], "warnings": [], "info": []}, 1000)
        tester.note_slice({"status": "done", "model": "M.stl"}, {"engine": {"app": "Orca", "version": "2.4.2"}})

    def test_the_report_holds_every_section(self):
        self.synthetic_session()
        report = tester_report.build_report(server_setup=tester_report.setup_facts())
        self.assertEqual(report["schema_version"], 1)
        for key in ("summary", "setup", "sessions", "screens", "clicks", "slow", "requests", "errors", "printer", "confirm_print",
                    "slicing", "converter", "smoothness", "features", "notes", "updates", "timeline", "thinning", "never_recorded"):
            self.assertIn(key, report)
        s = report["summary"]
        self.assertEqual((s["sessions"], s["clicks"], s["prints_started"], s["prints_failed"]), (1, 2, 1, 1))
        self.assertEqual(s["errors_total"], 2)
        self.assertEqual(s["error_groups"], 1)                                   # same message, grouped
        self.assertEqual(report["errors"]["groups"][0]["count"], 2)
        self.assertEqual(report["errors"]["groups"][0]["last_actions"], ["click #pause-btn", "click #slow-btn"])
        self.assertEqual(report["slow"]["slowest_actions"][0]["control"], "#slow-btn")
        self.assertEqual(report["slow"]["long_tasks"]["count"], 1)
        self.assertEqual([r["route"] for r in report["requests"]["failed"]], ["/api/printer/control/pause"])
        self.assertEqual(report["printer"]["confirmed_by_printer"][0]["median_ms"], 420)
        self.assertEqual(report["printer"]["refused"][0]["words"], "Homing is refused mid-print")
        self.assertEqual(report["printer"]["firmware"]["printer 1"]["machine_type"], "Snapmaker U1")
        self.assertEqual(report["smoothness"]["twin"]["lowest_fps"], 41)
        self.assertEqual(report["notes"][0]["text"], "The pause button felt stuck")
        used = set(report["features"]["used"])
        self.assertTrue({"Needs you", "The 3D twin", "G-code preview", "Skip object", "Confirm Print", "Slicing"} <= used, used)
        self.assertIn("Spoolman", report["features"]["not_used"])
        self.assertEqual(len(report["features"]["detail"]), 22)
        self.assertTrue(all("questions_section" in f for f in report["features"]["detail"]))
        self.assertFalse(report["thinning"]["happened"])

    def test_the_zip_has_four_files_and_a_page_with_no_scripts(self):
        self.synthetic_session()
        name, data = tester_report.build_zip()
        z = zipfile.ZipFile(io.BytesIO(data))
        self.assertEqual(sorted(z.namelist()), ["README.txt", "events.jsonl", "report.html", "report.json"])
        page = z.read("report.html").decode()
        self.assertNotIn("<script", page.lower())
        self.assertNotIn("http://", page)
        self.assertNotIn("https://", page)
        self.assertNotIn("src=", page)
        for heading in ("The short version", "Day by day", "Setup", "The slowest 25 actions", "Errors", "The printer", "Confirm Print",
                        "Slicing and converting", "Smoothness", "Features used and not used", "Their notes", "Updates"):
            self.assertIn(heading, page)
        self.assertIn("#slow-btn", page)
        self.assertIn("TypeError", page)
        self.assertIn("The pause button felt stuck", page)
        report = json.loads(z.read("report.json"))
        self.assertEqual(report["schema_version"], 1)
        self.assertIn("never", z.read("README.txt").decode().lower())
        for line in z.read("events.jsonl").decode().splitlines():
            json.loads(line)

    def test_everything_in_the_page_is_escaped(self):
        self.turn_on()
        tester.ingest({"events": [{"k": "err", "kind": "js", "msg": "<img src=x onerror=alert(1)> & <script>alert(2)</script>", "s": "q12345"},
                                  {"k": "note", "text": "<b>bold</b> \"quoted\"", "screen": "files", "s": "q12345"},
                                  {"k": "click", "ctl": "<script>x</script>", "paint": 3000, "s": "q12345"}]})
        page = tester_report.build_html()
        self.assertNotIn("<img src=x", page)
        self.assertNotIn("<script", page.lower())
        self.assertNotIn("<b>bold</b>", page)
        self.assertIn("&lt;script&gt;", page)

    def test_the_report_page_has_light_and_dark_and_phone_layout(self):
        self.synthetic_session()
        page = tester_report.build_html("dark")
        self.assertIn('data-theme="dark"', page)
        self.assertIn("prefers-color-scheme:dark", page)
        self.assertIn("width=device-width", page)
        self.assertIn("overflow-x:auto", page)
        self.assertIn('<html lang="en">', tester_report.build_html())


class TestAWeekOfEvents(TesterBase):
    """A week of busy use, far past the 20 MB the report keeps raw, still saves under the forum's 25 MB."""

    def write_week(self, megabytes):
        os.makedirs(tester.folder(), exist_ok=True)
        base = time.time() - 7 * 86400
        controls = ["#btn-%d" % i for i in range(40)]
        written, count, clicks, errors, slow = 0, 0, 0, 0, 0
        day_files = {}
        i = 0
        while written < megabytes * 1024 * 1024:
            t = int((base + (i * 7.0 * 86400 / 230000)) * 1000)
            day = time.strftime("%Y-%m-%d", time.localtime(t / 1000.0))
            kind = i % 10
            if kind < 6:
                slow_click = i % 997 == 0
                event = {"t": t, "k": "click", "s": "wk%04d" % (i // 5000), "ctl": 'button "%s" in #card-%d' % (controls[i % 40], i % 7),
                         "screen": ("overview", "printer", "files", "settings")[i % 4], "paint": 2400 if slow_click else 30 + i % 90}
                if slow_click:
                    event["slow"] = True
                    slow += 1
                clicks += 1
            elif kind < 8:
                event = {"t": t, "k": "req", "s": "wk%04d" % (i // 5000), "route": "/api/route/%d" % (i % 25), "method": "GET", "agg": True,
                         "n": 60, "ok": 60, "fail": 0, "p50": 12, "max": 90, "bucket": t // 300000}
            elif kind == 8:
                event = {"t": t, "k": "screen", "s": "wk%04d" % (i // 5000), "screen": ("overview", "printer", "files")[i % 3], "ms": 9000}
            else:
                event = {"t": t, "k": "fps", "s": "wk%04d" % (i // 5000), "surface": "twin", "fps": 50 + i % 10, "layers": 200}
            if i % 5003 == 0:
                if event["k"] == "click":
                    clicks -= 1
                    slow -= 1 if event.get("slow") else 0
                event = {"t": t, "k": "err", "s": "wk0000", "kind": "js", "msg": "Error number %d in app.js" % (i % 7), "file": "app.js", "line": 5}
                errors += 1
            line = _line(event)
            day_files.setdefault(day, []).append(line)
            written += len(line)
            i += 1
        for day, lines in day_files.items():
            with open(os.path.join(tester.folder(), "events-%s.jsonl" % day), "w", encoding="utf-8", newline="\n") as f:
                f.writelines(lines)
        return {"events": i, "clicks": clicks, "errors": errors, "slow": slow}

    def test_a_long_busy_week_stays_under_the_forum_limit_and_the_report_says_what_was_thinned(self):
        self.turn_on()
        made = self.write_week(26)
        self.assertGreater(tester.disk_bytes(), tester.EXPORT_LIMIT)
        started = time.time()
        name, data = tester_report.build_zip()
        took = time.time() - started
        self.assertLess(len(data), 25 * 1024 * 1024)
        z = zipfile.ZipFile(io.BytesIO(data))
        raw = z.read("events.jsonl")
        self.assertLessEqual(len(raw), tester.EXPORT_LIMIT)
        report = json.loads(z.read("report.json"))
        thin = report["thinning"]
        self.assertTrue(thin["happened"])
        self.assertGreater(thin["dropped_events"], 0)
        self.assertIn("click", thin["by_kind"])
        # The totals were counted before anything was dropped
        self.assertEqual(report["summary"]["clicks"], made["clicks"])
        self.assertEqual(report["summary"]["errors_total"], made["errors"])
        # Every error and every slow action is still in the raw events
        kept = [json.loads(line) for line in raw.decode().splitlines()]
        self.assertEqual(sum(1 for e in kept if e["k"] == "err"), made["errors"])
        self.assertEqual(sum(1 for e in kept if e["k"] == "click" and e.get("slow")), made["slow"])
        # The oldest routine clicks went first: what is left of them is newer than what was summed up
        summed = [e for e in kept if e["k"] == "thinned" and e["of"] == "click"]
        self.assertTrue(summed)
        self.assertEqual(sum(e["dropped"] for e in kept if e["k"] == "thinned"), thin["dropped_from_events_file"])
        page = z.read("report.html").decode()
        self.assertIn("Thinned:", page)
        self.assertIn(str(thin["dropped_events"]), page)
        self.assertLess(took, 120)

    def test_a_short_record_is_not_thinned(self):
        self.turn_on()
        self.write_week(1)
        report = json.loads(zipfile.ZipFile(io.BytesIO(tester_report.build_zip()[1])).read("report.json"))
        self.assertFalse(report["thinning"]["happened"])
        self.assertEqual(report["thinning"]["dropped_events"], 0)

    def test_the_record_on_disk_is_summed_up_when_it_grows_too_large(self):
        self.turn_on()
        made = self.write_week(12)
        before = tester.disk_bytes()
        old_at = tester.COMPACT_AT
        try:
            tester.COMPACT_AT = 8 * 1024 * 1024
            dropped = tester.compact(target=6 * 1024 * 1024)
        finally:
            tester.COMPACT_AT = old_at
        self.assertLess(tester.disk_bytes(), before)
        self.assertTrue(any(os.path.basename(p) == "events-archive.jsonl" for p in tester.event_files()))
        report = tester_report.build_report()
        self.assertEqual(report["summary"]["clicks"], made["clicks"])
        self.assertTrue(report["thinning"]["happened"])
        self.assertTrue(report["thinning"]["medians_are_estimates"])

    def test_the_status_counts_come_from_the_files_and_grow_with_them(self):
        self.turn_on()
        tester.ingest({"events": [{"k": "click", "ctl": "#a", "paint": 10}, {"k": "click", "ctl": "#b", "paint": 1200}]})
        first = tester_report.totals()
        self.assertEqual((first["actions"], first["slow"], first["days"]), (2, 1, 1))
        tester.ingest({"events": [{"k": "err", "msg": "boom", "kind": "js"}]})
        second = tester_report.totals()
        self.assertEqual((second["actions"], second["errors"]), (2, 1))


if __name__ == "__main__":
    unittest.main()
