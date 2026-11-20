"""
Tester mode, what it learns (backend/tester.py, backend/tester_report.py): the wider record and the report built from it.

What these prove:
  - the browser's new events (how a control was pressed, what was changed, keys, the setup and the tour, how fast the app opened,
    the connection, the test round) are kept in the shapes the server lists, and nothing typed gets through;
  - the report counts them: how people pressed, the paths between screens, the first run, the first times, the speed;
  - errors are grouped, named by kind, tied to a part of the app and to the control pressed just before;
  - the findings list ranks what went wrong, points at where to look, and leaves expected refusals out;
  - nothing private in the new fields reaches any file in the saved zip.
"""

import io
import json
import os
import sys
import time
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import modules                       # noqa: E402
import tester                        # noqa: E402
import tester_report                 # noqa: E402
import tester_study                  # noqa: E402


class InsightBase(unittest.TestCase):
    def setUp(self):
        self._always, self._env = modules.TESTER_ALWAYS_ON, os.environ.pop("DEJAVU_TESTER", None)
        modules.TESTER_ALWAYS_ON = True
        tester.refresh()
        tester.delete_all()
        self.now = int(time.time() * 1000)

    def tearDown(self):
        tester.delete_all()
        modules.TESTER_ALWAYS_ON = self._always
        if self._env is not None:
            os.environ["DEJAVU_TESTER"] = self._env
        tester.refresh()

    def ago(self, seconds):
        return self.now - int(seconds * 1000)

    def feed(self, events):
        result = tester.ingest({"events": events})
        self.assertEqual(result["dropped"], 0, events)
        return result

    def report(self, study=None):
        return tester_report.build_report(server_setup=tester_report.setup_facts(), study=study if study is not None else tester_study.for_report())

    def events(self):
        return list(tester_report.iter_events(tester.event_files()))


class TestTheWiderRecord(InsightBase):
    def test_new_events_keep_their_fields_in_the_listed_shapes(self):
        self.feed([
            {"k": "click", "s": "abc123", "q": 9, "ctl": "#pause", "screen": "printer", "paint": 30, "how": "touch", "btn": 2, "mods": "ctrl-shift",
             "dbl": True, "x": 41, "y": 88, "gap": 1500, "role": "button", "t": self.ago(5)},
            {"k": "change", "s": "abc123", "ctl": "#demo-toggle", "screen": "settings", "role": "switch", "on": True, "t": self.ago(4)},
            {"k": "change", "s": "abc123", "ctl": "#speed", "screen": "printer", "role": "range", "num": 120.5, "t": self.ago(3)},
            {"k": "change", "s": "abc123", "ctl": "select \"Material\"", "screen": "files", "role": "select", "idx": 3, "of": 6, "t": self.ago(3)},
            {"k": "change", "s": "abc123", "ctl": "#upload", "screen": "files", "role": "file", "files": 2, "ext": "3mf", "t": self.ago(3)},
            {"k": "key", "s": "abc123", "combo": "ctrl-k", "screen": "overview", "t": self.ago(2)},
            {"k": "onboarding", "s": "abc123", "ev": "wizard_step", "step": 3, "of": 7, "name": "Your printer", "ms": 5200, "how": "next", "t": self.ago(2)},
            {"k": "perf", "s": "abc123", "boot": True, "fcp": 380, "lcp": 610, "cls": 4, "dcl": 200, "load": 540, "ttfb": 20, "heap": 24.5, "nodes": 1900, "t": self.ago(2)},
            {"k": "net", "s": "abc123", "ev": "ws_close", "code": 1006, "clean": False, "t": self.ago(2)},
            {"k": "study", "s": "abc123", "ev": "section", "sec": 4, "ms": 61000, "t": self.ago(1)},
            {"k": "resize", "s": "abc123", "w": 390, "h": 844, "bp": "phone", "t": self.ago(1)},
            {"k": "session", "s": "abc123", "ev": "start", "first": True, "up": 2, "t": self.ago(6)},
        ])
        by_kind = {e["k"]: e for e in self.events()}
        click = by_kind["click"]
        self.assertEqual((click["how"], click["btn"], click["mods"], click["dbl"], click["x"], click["y"], click["gap"], click["role"], click["q"]),
                         ("touch", 2, "ctrl-shift", True, 41, 88, 1500, "button", 9))
        self.assertEqual(by_kind["key"]["combo"], "ctrl-k")
        self.assertEqual((by_kind["onboarding"]["name"], by_kind["onboarding"]["ms"]), ("Your printer", 5200))
        self.assertEqual(by_kind["perf"]["heap"], 24.5)
        self.assertIs(by_kind["net"]["clean"], False)
        self.assertEqual(by_kind["resize"]["bp"], "phone")
        self.assertTrue(by_kind["session"]["first"])
        changes = [e for e in self.events() if e["k"] == "change"]
        self.assertEqual([(e.get("on"), e.get("num"), e.get("idx"), e.get("files"), e.get("ext")) for e in changes],
                         [(True, None, None, None, None), (None, 120.5, None, None, None), (None, None, 3, None, None), (None, None, None, 2, "3mf")])

    def test_what_is_typed_cannot_get_in_through_the_new_fields(self):
        result = tester.ingest({"events": [
            {"k": "change", "ctl": "#x", "val": "my private words with spaces", "screen": "files", "t": self.ago(1)},
            {"k": "click", "ctl": "#x", "how": "a very long made up method with spaces", "role": "button with spaces", "mods": "ctrl shift",
             "x": "left", "y": True, "gap": "soon", "q": "first", "t": self.ago(1)},
            {"k": "net", "ev": "ws close", "code": "1006", "t": self.ago(1)},
            {"k": "study", "ev": "answer", "text": "typed answer", "t": self.ago(1)}]})
        self.assertEqual(result["accepted"], 4)
        for event in self.events():
            self.assertFalse({"val", "text", "how", "role", "mods", "x", "y", "gap", "q", "code"} & set(event), event)

    def test_strings_in_the_new_fields_are_masked(self):
        self.feed([{"k": "err", "kind": "js", "msg": "failed at 192.168.1.77", "stack": ["load app.js:1:2 /Users/jane.doe/x", "run key sk-LIVEKEYabcdefghij123456"],
                    "ctl": "button \"Open ssid=GarageWifi5G\"", "pstate": "printing", "t": self.ago(1)},
                   {"k": "note", "text": "see 10.20.30.40", "err": "Server said 192.168.1.77", "tag": "broken", "t": self.ago(1)},
                   {"k": "onboarding", "ev": "wizard_step", "name": "Step for jane@example.org", "t": self.ago(1)},
                   {"k": "key", "combo": "ctrl-192.168.1.77", "t": self.ago(1)}])
        text = json.dumps(self.events())
        for secret in ("192.168.1.77", "10.20.30.40", "jane.doe", "sk-LIVEKEYabcdefghij123456", "jane@example.org", "GarageWifi5G"):
            self.assertNotIn(secret, text)

    def test_the_server_times_slow_answers_but_not_streams_or_quick_ones(self):
        tester.note_handler("GET", "/api/files/analysis?name=Benchy.3mf", 2100)
        tester.note_handler("GET", "/api/files/analysis", 200)
        tester.note_handler("GET", "/api/camera/stream", 90000)
        tester.note_handler("GET", "/api/live", 90000)
        tester.note_handler("POST", "/api/assistant/chat", 30000)
        slow = [e for e in self.events() if e["k"] == "slowroute"]
        self.assertEqual([(e["method"], e["route"], e["ms"]) for e in slow], [("GET", "/api/files/analysis", 2100)])
        self.assertNotIn("Benchy", json.dumps(slow))

    def test_the_server_notes_its_own_memory_processor_and_disk(self):
        sample = tester.server_sample()
        self.assertEqual(sorted(sample), ["cpu", "disk_free", "rss", "threads", "up"])
        self.assertGreaterEqual(sample["threads"], 1)
        self.assertTrue(tester.record("server", **sample))

    def test_server_errors_say_where_in_more_lines(self):
        def deep(n):
            if n:
                return deep(n - 1)
            raise RuntimeError("deep boom")
        try:
            deep(8)
        except RuntimeError as exc:
            tester.note_error("server", exc, route="/api/x", status=500)
        event = [e for e in self.events() if e["k"] == "err"][0]
        self.assertEqual(len(event["where"]), 5)
        self.assertTrue(all("test_tester_insights.py" in w for w in event["where"]))


class TestHowTheyUsedIt(InsightBase):
    def test_methods_buttons_double_presses_hours_and_paths_are_counted(self):
        events = [{"k": "session", "s": "sessa1", "ev": "start", "first": True, "t": self.ago(900)},
                  {"k": "session", "s": "sessb2", "ev": "start", "t": self.ago(300)}]
        for i, (how, btn, mods, dbl) in enumerate([("mouse", 0, None, None), ("mouse", 0, None, True), ("touch", 0, None, None), ("key", 0, None, None),
                                                    ("mouse", 2, None, None), ("mouse", 1, "ctrl", None)]):
            events.append({"k": "click", "s": "sessa1", "ctl": "#c%d" % (i % 2), "screen": "overview", "paint": 20 + i * 400, "how": how, "btn": btn, "mods": mods,
                           "dbl": dbl, "x": 10 + i * 15, "y": 20, "gap": 1000 + i * 1000, "role": "button", "t": self.ago(800 - i)})
        for session, seq in (("sessa1", ["overview", "printer", "files", "printer"]), ("sessb2", ["settings", "printer", "files"])):
            for i, screen in enumerate(seq):
                events.append({"k": "screen", "s": session, "screen": screen, "ms": 5000, "via": "[data-dest=%s] in #rail" % screen if i else "address",
                               "t": self.ago(700 - i * 10 - (0 if session == "sessa1" else 200))})
        events += [{"k": "change", "s": "sessa1", "ctl": "#demo-toggle", "screen": "settings", "role": "switch", "on": True, "t": self.ago(600)},
                   {"k": "key", "s": "sessa1", "combo": "ctrl-k", "screen": "overview", "t": self.ago(590)}]
        self.feed(events)
        use = self.report()["usage"]
        click = use["how_they_click"]
        self.assertEqual(click["methods"], {"mouse": 4, "touch": 1, "key": 1})
        self.assertEqual(click["buttons"], {"left": 4, "right": 1, "middle": 1})
        self.assertEqual(click["modifiers"], {"ctrl": 1})
        self.assertEqual(click["double_presses"], [{"control": "#c1", "count": 1}])
        self.assertEqual((click["keyboard_percent"], click["touch_percent"]), (16.7, 16.7))
        self.assertEqual(click["think_time_seconds"]["median"], 3.5)
        self.assertEqual(sum(sum(row) for row in click["screen_map_percent"]) > 99, True)
        self.assertEqual(sum(use["hours"]), 6)
        paths = {(p["from"], p["to"]): p["count"] for p in use["paths"]["transitions"]}
        self.assertEqual(paths[("printer", "files")], 2)
        self.assertEqual(paths[("overview", "printer")], 1)
        self.assertEqual(use["paths"]["entry_screens"], {"overview": 1, "settings": 1})
        self.assertEqual(use["paths"]["exit_screens"], {"printer": 1, "files": 1})
        self.assertEqual(use["paths"]["reached_by"][0], {"via": "[data-dest=printer] in #rail", "count": 3})
        self.assertEqual(use["changes"]["total"], 1)
        self.assertEqual(use["changes"]["settings"][0]["value"], "on")
        self.assertEqual(use["keys"], [{"combo": "ctrl-k", "count": 1}])

    def test_the_journey_lists_the_first_actions_in_order(self):
        self.feed([{"k": "session", "s": "sessa1", "ev": "start", "t": self.ago(100)},
                   {"k": "screen", "s": "sessa1", "screen": "overview", "ms": 4000, "via": "address", "t": self.ago(98)},
                   {"k": "click", "s": "sessa1", "ctl": "#b", "screen": "overview", "paint": 40, "how": "mouse", "t": self.ago(95)},
                   {"k": "change", "s": "sessa1", "ctl": "#t", "screen": "settings", "on": False, "t": self.ago(94)},
                   {"k": "key", "s": "sessa1", "combo": "Escape", "t": self.ago(93)}])
        (visit,) = self.report()["usage"]["journey"]
        self.assertEqual([(a["did"], a["what"]) for a in visit["actions"]], [("opened", "overview"), ("pressed", "#b"), ("changed", "#t"), ("pressed key", "Escape")])
        self.assertEqual(visit["actions"][1]["how"], "mouse")

    def test_the_first_run_and_the_first_times(self):
        base = self.ago(1200)
        events = [{"k": "session", "s": "sessa1", "ev": "start", "first": True, "t": base},
                  {"k": "onboarding", "s": "sessa1", "ev": "wizard_open", "first": True, "step": 1, "of": 7, "t": base + 1000}]
        for i, (name, ms, how) in enumerate([("Welcome", 4000, "next"), ("Make it yours", 9000, "next"), ("Your printer", 41000, "skip")], 1):
            events.append({"k": "onboarding", "s": "sessa1", "ev": "wizard_step", "step": i, "of": 7, "name": name, "ms": ms, "how": how, "t": base + 5000 * i})
        events += [{"k": "onboarding", "s": "sessa1", "ev": "wizard_end", "how": "skipped", "step": 3, "of": 7, "ms": 54000, "t": base + 16000},
                   {"k": "onboarding", "s": "sessa1", "ev": "tour_start", "of": 9, "name": "A quick look", "t": base + 20000},
                   {"k": "onboarding", "s": "sessa1", "ev": "tour_step", "step": 1, "of": 9, "name": "A quick look", "ms": 6000, "how": "next", "t": base + 26000},
                   {"k": "onboarding", "s": "sessa1", "ev": "tour_end", "how": "ended", "step": 2, "of": 9, "ms": 30000, "t": base + 50000},
                   {"k": "req", "s": "sessa1", "route": "/api/printers/discover", "method": "POST", "status": 200, "ms": 900, "t": base + 90000},
                   {"k": "req", "s": "sessa1", "route": "/api/printers/test", "method": "POST", "status": 200, "ms": 300, "t": base + 120000},
                   {"k": "req", "s": "sessa1", "route": "/api/fleet/registry", "method": "POST", "status": 200, "ms": 200, "t": base + 150000},
                   {"k": "click", "s": "sessa1", "ctl": "#go", "screen": "printers", "paint": 20, "t": base + 30000}]
        self.feed(events)
        tester.record("printer", ev="connect", printer="printer 1")
        report = self.report()
        wizard = report["onboarding"]["wizard"]
        self.assertEqual((wizard["opened"], wizard["skipped"], wizard["finished"], wizard["furthest_step"], wizard["steps_total"]), (1, 1, 0, 3, 7))
        self.assertEqual([(s["name"], s["median_seconds"]) for s in wizard["steps"]], [("Welcome", 4.0), ("Make it yours", 9.0), ("Your printer", 41.0)])
        self.assertEqual(wizard["steps"][2]["left_by"], {"skip": 1})
        self.assertEqual(report["onboarding"]["tour"]["ended_early"], 1)
        self.assertTrue(report["onboarding"]["first_run"])
        milestones = {m["id"]: m for m in report["milestones"]}
        self.assertEqual(milestones["setup_closed"]["minutes_after_start"], 0.3)
        self.assertEqual(milestones["tested_a_printer"]["minutes_after_start"], 2.0)
        self.assertEqual(milestones["added_a_printer"]["minutes_after_start"], 2.5)
        self.assertGreater(milestones["printer_connected"]["minutes_after_start"], 15)
        self.assertEqual([m["at"] for m in report["milestones"]], sorted(m["at"] for m in report["milestones"]))
        self.assertIn("Connecting the first printer took", " ".join(f["title"] for f in report["findings"]))

    def test_the_speed_numbers_and_percentiles(self):
        events = [{"k": "click", "s": "sessa1", "ctl": "#c", "screen": "files", "paint": p, "how": "mouse", "t": self.ago(100 - i)}
                  for i, p in enumerate([20] * 8 + [350, 4200])]
        events += [{"k": "perf", "s": "sessa1", "boot": True, "fcp": 400, "lcp": 650, "cls": 12, "load": 800, "heap": 20, "nodes": 2000, "t": self.ago(90)},
                   {"k": "perf", "s": "sessa1", "boot": True, "fcp": 500, "lcp": 750, "cls": 3, "load": 1200, "heap": 22, "nodes": 2100, "t": self.ago(80)},
                   {"k": "req", "s": "sessa1", "route": "/api/live/snapshot", "method": "GET", "agg": True, "n": 98, "ok": 98, "fail": 0, "p50": 10, "max": 30, "t": self.ago(70)},
                   {"k": "req", "s": "sessa1", "route": "/api/x", "method": "POST", "status": 500, "ms": 50, "err": "boom", "t": self.ago(60)},
                   {"k": "req", "s": "sessa1", "route": "/api/y", "method": "POST", "status": 500, "ms": 50, "err": "boom", "t": self.ago(59)}]
        self.feed(events)
        r = self.report()
        cp = r["stats"]["click_to_paint"]
        self.assertEqual((cp["samples"], cp["median_ms"], cp["slowest_ms"]), (10, 20, 4200))
        self.assertGreater(cp["p95_ms"], 350)
        self.assertEqual({h["label"]: h["count"] for h in cp["histogram"]}, {"up to 100 ms": 8, "100 to 300 ms": 0, "0.3 to 1 s": 1, "1 to 3 s": 0, "over 3 s": 1})
        self.assertEqual(r["stats"]["requests"], {"total": 100, "failed": 2, "failed_percent": 2.0, "slow": 0})
        self.assertEqual(r["stats"]["errors"]["per_100_presses"], 0.0)
        start = r["performance"]["start_up"]
        self.assertEqual((start["samples"], start["first_paint_ms"], start["largest_paint_ms"], start["page_loaded_ms"], start["slowest_load_ms"]), (2, 450, 700, 1000, 1200))

    def test_memory_that_climbs_for_hours_is_a_finding(self):
        events = [{"k": "perf", "s": "sessa1", "heap": 30 + i * 40, "nodes": 2000 + i * 500, "up": 3600 * i, "t": self.ago(3600 * (5 - i))} for i in range(5)]
        self.feed(events)
        for i, (up, rss) in enumerate(((3600, 110), (30000, 420))):
            tester.record("server", up=up, cpu=40.0 + i, rss=rss, threads=20, disk_free=900000)
        r = self.report()
        self.assertEqual(r["performance"]["memory"]["first_mb"], 30)
        self.assertEqual(r["server_health"]["memory_mb"], {"first": 110, "last": 420, "highest": 420})
        titles = " | ".join(f["title"] for f in r["findings"])
        self.assertIn("The page's memory grew from 30 MB to 190 MB", titles)
        self.assertIn("The server's memory grew from 110 MB to 420 MB", titles)

    def test_losing_the_connection_is_counted(self):
        self.feed([{"k": "net", "s": "sessa1", "ev": "offline", "t": self.ago(300)}, {"k": "net", "s": "sessa1", "ev": "online", "ms": 45000, "t": self.ago(255)}]
                  + [{"k": "net", "s": "sessa1", "ev": "ws_close", "code": 1006, "clean": False, "t": self.ago(200 - i)} for i in range(3)])
        net = self.report()["network"]
        self.assertEqual((net["went_offline"], net["live_link_closed_unexpectedly"], net["seconds_offline"]), (1, 3, 45))
        self.assertIn("closed unexpectedly 3 times", " ".join(f["title"] for f in self.report()["findings"]))


class TestErrorsAndFindings(InsightBase):
    def test_errors_are_named_by_kind_and_tied_to_the_control_and_the_part_of_the_app(self):
        self.feed([
            {"k": "err", "s": "sessa1", "kind": "js", "msg": "TypeError: Cannot read properties of null (reading 'classList')", "file": "app.js", "line": 120,
             "stack": ["renderFiles files.js:40:3", "onTab app.js:90:5"], "screen": "files", "ctl": "[data-dest=files] in #rail", "pstate": "printing",
             "last": ["open files", "click [data-dest=files] in #rail"], "t": self.ago(300)},
            {"k": "err", "s": "sessb2", "kind": "js", "msg": "TypeError: Cannot read properties of null (reading 'classList')", "file": "app.js", "line": 120,
             "screen": "files", "last": ["open overview", "click [data-dest=files] in #rail"], "t": self.ago(200)},
            {"k": "err", "s": "sessa1", "kind": "js", "msg": "TypeError: Failed to fetch", "screen": "printer", "online": False, "t": self.ago(150)},
            {"k": "err", "s": "sessa1", "kind": "toast", "msg": "Pause failed: the printer reported a failure", "screen": "printer",
             "last": ["click #ctrl-pause-resume"], "t": self.ago(100)},
            {"k": "err", "s": "sessa1", "kind": "resource", "msg": "Could not load snapshot", "screen": "overview", "t": self.ago(90)},
            {"k": "err", "s": "sessa1", "kind": "csp", "msg": "Blocked img-src from <host>", "screen": "overview", "t": self.ago(80)},
            {"k": "err", "s": "sessa1", "kind": "console", "msg": "Something logged", "screen": "overview", "t": self.ago(70)},
        ])
        tester.record("err", kind="server", msg="KeyError: 'x'", where=["app.py:10 in handler"], route="/api/printer/control/pause", status=500, src="server")
        groups = self.report()["errors"]["groups"]

        def one(kind, start):
            return next(g for g in groups if g["kind"] == kind and g["message"].startswith(start))
        classlist = one("js", "TypeError: Cannot read")
        self.assertEqual((classlist["count"], classlist["sessions"], classlist["category"]), (2, 2, "app_bug"))
        self.assertEqual(classlist["area"], "Files")
        self.assertEqual(classlist["controls"], {"[data-dest=files] in #rail": 2})
        self.assertEqual(classlist["stack"], ["renderFiles files.js:40:3", "onTab app.js:90:5"])
        self.assertEqual(len(classlist["samples"]), 2)
        self.assertEqual(classlist["printer_states"], {"printing": 1})
        self.assertIn("bug", classlist["meaning"])
        self.assertEqual(one("js", "TypeError: Failed to fetch")["category"], "network")
        self.assertEqual(one("toast", "Pause failed")["category"], "toast")
        self.assertEqual(one("toast", "Pause failed")["area"], "Printer page")
        self.assertEqual(one("resource", "Could not load")["category"], "resource")
        self.assertEqual(one("csp", "Blocked img-src")["category"], "csp")
        server = one("server", "KeyError")
        self.assertEqual((server["category"], server["area"], server["statuses"]), ("server_bug", "Printer page controls", {500: 1}))

    def test_findings_rank_by_severity_and_point_at_where_to_look(self):
        self.feed([
            {"k": "err", "s": "sessa1", "kind": "js", "msg": "ReferenceError: nope is not defined", "file": "app.js", "line": 7, "screen": "files", "t": self.ago(300)},
            {"k": "click", "s": "sessa1", "ctl": "#slow-one", "screen": "printer", "paint": 6200, "slow": True, "how": "mouse", "t": self.ago(290)},
            {"k": "req", "s": "sessa1", "route": "/api/queue/add", "method": "POST", "status": 500, "ms": 80, "err": "Something went wrong", "screen": "queue", "t": self.ago(280)},
            {"k": "req", "s": "sessa1", "route": "/api/printer/control/home", "method": "POST", "status": 409, "ms": 30, "err": "Watch-only is on", "t": self.ago(270)},
            {"k": "req", "s": "sessa1", "route": "/api/x", "method": "GET", "status": 403, "ms": 5, "err": "Module disabled", "t": self.ago(260)},
            {"k": "note", "s": "sessa1", "text": "It froze for a moment", "tag": "broken", "screen": "printer", "after_err": True, "err": "Pause failed", "pstate": "printing",
             "last": ["click #slow-one"], "t": self.ago(250)},
            {"k": "note", "s": "sessa1", "tag": "good", "screen": "files", "t": self.ago(240)},
            {"k": "fps", "s": "sessa1", "surface": "twin", "fps": 9, "layers": 800, "t": self.ago(230)},
            {"k": "long", "s": "sessa1", "ms": 400, "screen": "printer", "t": self.ago(220)},
        ])
        tester.note_slice({"status": "failed", "model": "M.3mf", "stage": "run", "cause": {"code": "engine_exit"}}, {"engine": {"app": "OrcaSlicer", "version": "2.4.2"}})
        r = self.report()
        findings = r["findings"]
        self.assertEqual([f["id"] for f in findings], ["F%d" % n for n in range(1, len(findings) + 1)])
        ranks = [{"high": 0, "medium": 1, "low": 2}[f["severity"]] for f in findings]
        self.assertEqual(ranks, sorted(ranks))
        titles = [f["title"] for f in findings]
        self.assertTrue(any(t.startswith("A script error in the page: ReferenceError") for t in titles))
        high = {f["kind"] for f in findings if f["severity"] == "high"}
        self.assertTrue({"error", "slice", "request", "smooth", "note"} <= high, high)
        slow = next(f for f in findings if f["kind"] == "slow" and "#slow-one" in f["title"])
        self.assertEqual(slow["severity"], "high")                                         # 6.2 s
        self.assertIn("Control: #slow-one", slow["where"])
        request = next(f for f in findings if f["kind"] == "request")
        self.assertEqual((request["title"], request["where"]), ("Request failed: POST /api/queue/add", ["Request: POST /api/queue/add"]))
        self.assertFalse([f for f in findings if "/api/printer/control/home" in f["title"] or "/api/x" in f["title"]])   # refusals on purpose are not failures
        note = next(f for f in findings if f["kind"] == "note" and "froze" in f["title"])
        self.assertTrue(note["tester_said"])
        self.assertIn("Written right after the error: Pause failed", note["detail"])
        self.assertIn("The printer was printing", note["detail"])
        self.assertEqual(note["trail"], ["click #slow-one"])
        self.assertTrue(next(f for f in findings if f["kind"] == "note" and f["severity"] == "low"))      # the "works well" note
        self.assertEqual(r["summary"]["findings"], {k: sum(1 for f in findings if f["severity"] == k) for k in ("high", "medium", "low")})

    def test_only_the_what_frustrated_you_and_change_one_thing_answers_become_findings(self):
        tester_study.save_answers({"q19": {"c": None, "t": "The twin lagged"}, "q20": {"c": None, "t": "Make Pause faster"},
                                   "q18": {"c": None, "t": "Confirm Print"}, "q16": {"c": "didnt_try", "t": ""}, "q10": {"c": None, "t": "It caught it"}})
        found = {f["title"].split(":")[0]: f for f in self.report()["findings"] if f["kind"] == "answer"}
        self.assertEqual(sorted(found), ["Question 19", "Question 20"])
        self.assertTrue(all(f["tester_said"] and f["severity"] == "medium" for f in found.values()))
        self.assertIn("The twin lagged", found["Question 19"]["title"])
        self.assertIn("What frustrated you most", found["Question 19"]["detail"])

    def test_findings_md_opens_with_the_headline_and_fix_first_then_their_answers(self):
        self.feed([{"k": "err", "s": "sessa1", "kind": "js", "msg": "TypeError: x", "file": "app.js", "line": 3, "screen": "files",
                    "last": ["click #a"], "t": self.ago(50)}])
        tester_study.save_answers({"q19": {"c": None, "t": "It broke on Files"}})
        text = tester_report.render_findings(self.report())
        self.assertTrue(text.startswith("# Deja Vu1 tester findings"))
        self.assertLess(text.index("press"), text.index("## Fix first"))                      # the headline counts come first
        self.assertIn("## Fix first", text)
        self.assertIn("### 1. F1 [high] A script error in the page: TypeError: x", text)
        self.assertIn("- Screen: files", text)
        self.assertIn("- Last presses before it: click #a", text)
        self.assertIn("- Where to look: frontend/app.js:3", text)
        self.assertIn("## Their answers (1 of 22 questions)", text)
        self.assertIn("It broke on Files", text)
        self.assertNotIn("\u2014", text)


class TestFixFirst(InsightBase):
    """The report says what to fix first: stalls are one finding, the app's faults come before conditions around it, at most ten."""

    ROUTES = ["/api/connection", "/api/leds", "/api/cost/:id", "/api/printers", "/api/fleet", "/api/health", "/api/queue",
              "/api/filament/spools", "/api/camera/status", "/api/app/alive", "/api/maintenance", "/api/chamber", "/api/live", "/api/modules"]

    def stall(self, seconds=27):
        """14 routes that each waited `seconds` at the same moment while a time-lapse was being kept on the server."""
        wait = int(seconds * 1000)
        events = [{"k": "click", "s": "sessa1", "ctl": "#nav-%d" % i, "screen": "printer", "paint": 40, "t": self.ago(60 - i)} for i in range(5)]
        events += [{"k": "click", "s": "sessa1", "ctl": "#keep-copy", "screen": "printer", "paint": 30, "t": self.ago(40)}]
        events += [{"k": "req", "s": "sessa1", "route": route, "method": "GET", "status": 200, "ms": wait + i * 100, "slow": True, "screen": "printer",
                    "t": self.ago(1)} for i, route in enumerate(self.ROUTES)]
        events += [{"k": "req", "s": "sessa1", "route": "/api/timelapse/keep", "method": "POST", "status": 200, "ms": wait + 1000, "slow": True,
                    "screen": "printer", "t": self.ago(0.5)}]
        # What these routes usually take: background reads that answered in a few milliseconds (summed up, as the browser sends them).
        events += [{"k": "req", "s": "sessa1", "agg": True, "route": route, "method": "GET", "n": 300, "ok": 300, "fail": 0, "p50": 6, "max": 40,
                    "bucket": 1, "t": self.ago(3600)} for route in self.ROUTES]
        self.feed(events)
        tester.record("slowroute", method="POST", route="/api/timelapse/keep", ms=wait + 1000)

    def test_fourteen_requests_that_waited_together_are_one_finding_naming_what_was_running(self):
        self.stall()
        r = self.report()
        self.assertEqual(len(r["stalls"]), 1)
        stall = r["stalls"][0]
        self.assertEqual(stall["waited"], 14)
        self.assertEqual(stall["seconds"], 28)
        self.assertEqual([x["route"] for x in stall["running"]], ["/api/timelapse/keep"])
        self.assertEqual(stall["running"][0]["what"], "keeping a time-lapse video")
        stalls = [f for f in r["findings"] if f["kind"] == "stall"]
        self.assertEqual(len(stalls), 1)
        f = stalls[0]
        self.assertTrue(f["title"].startswith("The server stopped answering for 28 s at "), f["title"])
        self.assertIn("14 requests waited at the same moment", f["detail"])
        self.assertIn("Running at the time: keeping a time-lapse video (POST /api/timelapse/keep", f["detail"])
        self.assertEqual((f["origin"], f["severity"]), ("app", "high"))
        self.assertEqual(f["code"], ["backend/timelapse.py"])
        self.assertEqual(f["trail"][-1], "click #keep-copy")
        self.assertEqual(len(f["trail"]), 5)
        # None of the 14 waiting routes is also its own finding.
        self.assertFalse([x for x in r["findings"] if x["kind"] in ("slow", "request") and any(route in x["title"] for route in self.ROUTES)], [x["title"] for x in r["findings"]])
        self.assertEqual(r["headline"]["stalls"], 1)

    def test_the_stall_says_whether_the_wait_was_inside_the_server_or_before_it(self):
        self.stall()
        self.assertIn("before the requests reached the server's code", self.report()["stalls"][0]["where_waited"])
        # When the server itself recorded the waiting routes as slow too, the delay was inside the server.
        for route in self.ROUTES[:10]:
            tester.record("slowroute", method="GET", route=route, ms=27000)
        self.assertIn("inside the server", self.report()["stalls"][0]["where_waited"])

    def test_one_slow_route_or_one_route_repeated_is_not_a_stall(self):
        self.feed([{"k": "req", "s": "sessa1", "route": "/api/files", "method": "GET", "status": 200, "ms": 9000, "slow": True, "t": self.ago(5)}])
        self.feed([{"k": "req", "s": "sessa1", "route": "/api/queue", "method": "GET", "status": 200, "ms": 4000 + i, "slow": True, "t": self.ago(3 - i * 0.1)} for i in range(4)])
        r = self.report()
        self.assertEqual(r["stalls"], [])
        self.assertTrue([f for f in r["findings"] if f["title"].startswith("Request often slow: GET /api/queue")])

    def test_slow_presses_during_a_stall_are_not_reported_as_slow_controls(self):
        self.stall()
        self.feed([{"k": "click", "s": "sessa1", "ctl": "#during-stall", "screen": "printer", "paint": 6000, "slow": True, "t": self.ago(1)},
                   {"k": "click", "s": "sessa1", "ctl": "#really-slow", "screen": "printer", "paint": 6000, "slow": True, "t": self.ago(300)}])
        titles = [f["title"] for f in self.report()["findings"]]
        self.assertFalse([t for t in titles if "#during-stall" in t], titles)
        self.assertTrue([t for t in titles if "#really-slow" in t], titles)

    def test_requests_that_failed_because_the_page_lost_the_server_are_one_finding_kept_apart_from_the_apps_faults(self):
        self.feed([{"k": "req", "s": "sessa1", "route": "/api/app/alive", "method": "GET", "status": 0, "ms": 30, "err": "Failed to fetch", "t": self.ago(300 - i)} for i in range(5)]
                  + [{"k": "req", "s": "sessa1", "route": "/api/leds", "method": "GET", "status": 0, "ms": 40, "err": "Failed to fetch", "t": self.ago(30)},
                     {"k": "err", "s": "sessa1", "kind": "promise", "msg": "Failed to fetch", "screen": "printer", "t": self.ago(29)},
                     {"k": "err", "s": "sessa1", "kind": "js", "msg": "TypeError: real bug", "file": "app.js", "line": 9, "screen": "files", "t": self.ago(20)}])
        r = self.report()
        lost = [f for f in r["findings"] if f["title"].startswith("The page lost the server")]
        self.assertEqual(len(lost), 1)
        self.assertEqual(lost[0]["title"], "The page lost the server 2 times")
        self.assertEqual(lost[0]["origin"], "condition")
        self.assertIn("6 requests failed with no answer", lost[0]["detail"])
        self.assertFalse([f for f in r["findings"] if "Failed to fetch" in f["title"] or f["title"].startswith("Request failed: GET /api/app/alive")])
        self.assertFalse(lost[0].get("fix_first"))
        self.assertEqual(r["lost_link"]["requests"], 6)
        self.assertTrue([f for f in r["findings"] if "real bug" in f["title"] and f["origin"] == "app"])

    def test_a_loss_that_matches_a_restart_says_so(self):
        self.feed([{"k": "req", "s": "sessa1", "route": "/api/app/alive", "method": "GET", "status": 0, "ms": 30, "err": "Failed to fetch", "t": self.ago(200)}])
        tester.record("server", up=500, cpu=1.0, rss=80.0, threads=5, disk_free=9000)
        tester.record("server", up=4, cpu=0.1, rss=60.0, threads=3, disk_free=9000)           # the second sample is after a restart
        lost = self.report()["lost_link"]
        self.assertEqual(lost["unexplained"], 1 if not lost["losses"][0]["why"] else 0)

    def test_fix_first_holds_at_most_ten_app_faults_worst_first_and_never_a_condition(self):
        events = []
        for n in range(14):
            events.append({"k": "err", "s": "sessa1", "kind": "js", "msg": "TypeError: bug %s" % "abcdefghijklmn"[n], "file": "app.js", "line": 10 + n, "screen": "files", "t": self.ago(500 - n)})
        events += [{"k": "printer", "s": "sessa1", "ev": "drop", "t": self.ago(100)} for _ in range(4)]
        self.feed(events)
        tester.record("printer", ev="drop")
        r = self.report()
        first = sorted((f for f in r["findings"] if f.get("fix_first")), key=lambda f: f["fix_first"])
        self.assertEqual([f["fix_first"] for f in first], list(range(1, 11)))
        self.assertTrue(all(f["origin"] == "app" and f["severity"] in ("high", "medium") for f in first))
        self.assertEqual(len([f for f in r["findings"] if f["kind"] == "error" and f["origin"] == "app"]), 14)
        drops = [f for f in r["findings"] if f["kind"] == "printer"]
        self.assertTrue(drops and all(f["origin"] == "condition" and not f.get("fix_first") for f in drops))
        self.assertEqual(r["summary"]["fix_first"], 10)

    def test_every_fix_first_item_says_what_how_often_where_the_last_presses_and_the_code(self):
        self.feed([{"k": "click", "s": "sessa1", "ctl": "#open-files", "screen": "files", "paint": 20, "t": self.ago(30)},
                   {"k": "err", "s": "sessa1", "kind": "js", "msg": "TypeError: x is null", "file": "workshop-part2.js", "line": 617, "screen": "printer",
                    "last": ["click #nav-0", "click #nav-1", "click #open-files"], "t": self.ago(20)},
                   {"k": "err", "s": "sessa1", "kind": "js", "msg": "TypeError: x is null", "file": "workshop-part2.js", "line": 617, "screen": "printer",
                    "last": ["click #open-files"], "t": self.ago(10)}])
        f = next(x for x in self.report()["findings"] if x.get("fix_first") == 1)
        self.assertEqual((f["count"], f["screens"], f["code"][0]), (2, ["printer"], "frontend/workshop-part2.js:617"))
        self.assertEqual(f["trail"], ["click #open-files"])
        self.assertIn("2 times in 1 session", f["detail"])
        page = tester_report.build_html()
        self.assertIn("frontend/workshop-part2.js:617", page)

    def test_a_replay_of_the_first_testers_run_puts_its_faults_in_fix_first_and_its_conditions_beside_them(self):
        """The run that found these: a 27 s wait while a time-lapse copy ran, a gauge script error, an Orca -100 slice on Windows,
        six moments without the server and 24 page freezes. Fix first names the three faults with where to look; the lost server
        stays a condition; the freezes are counted in the headline."""
        self.stall(27)
        events = [{"k": "err", "s": "sessa1", "kind": "js", "msg": "TypeError: Cannot read properties of null (reading 'setAttribute')",
                   "file": "workshop.js", "line": 1746, "screen": "printer", "last": ["click #tab-control"], "t": self.ago(900)}]
        events += [{"k": "req", "s": "sessa1", "route": "/api/app/alive", "method": "GET", "status": 0, "ms": 30, "err": "Failed to fetch",
                    "t": self.ago(1500 - 200 * i)} for i in range(6)]
        screens = ["settings", "printer", "files"]
        events += [{"k": "long", "s": "sessa1", "ms": 1040, "screen": screens[i % 3], "t": self.ago(1200 - 10 * i)} for i in range(24)]
        self.feed(events)
        tester.note_slice({"status": "failed", "model": "Benchy.3mf", "stage": "slice", "error": "Orca hit an error while slicing (Orca's code -100)",
                           "cause": {"code": "orca_-100"}},
                          {"engine": {"app": "Snapmaker_Orca", "version": "2.4.1"}, "run": {"exit_code": 4294967196}},
                          {"stdout": "Slic3r::CLI::run found error, exit", "stderr": "[error] the engine's own words"})
        r = self.report()
        first = sorted((f for f in r["findings"] if f.get("fix_first")), key=lambda f: f["fix_first"])
        by_kind = {f["kind"]: f for f in first}
        self.assertTrue({"stall", "slice", "error"} <= set(by_kind), [(f["kind"], f["title"]) for f in first])
        self.assertTrue(all(f["origin"] == "app" for f in first))
        self.assertIn("keeping a time-lapse video", by_kind["stall"]["detail"])
        self.assertEqual(by_kind["stall"]["code"], ["backend/timelapse.py"])
        self.assertIn("Snapmaker_Orca 2.4.1", by_kind["slice"]["title"])
        self.assertIn("Orca's code -100", by_kind["slice"]["detail"])
        self.assertEqual(by_kind["slice"]["code"][0], "backend/slicer_bridge.py")
        self.assertIn("Cannot read properties of null", by_kind["error"]["title"])
        self.assertEqual(by_kind["error"]["code"][0], "frontend/workshop.js:1746")
        self.assertEqual(by_kind["error"]["trail"], ["click #tab-control"])
        lost = [f for f in r["findings"] if f["title"].startswith("The page lost the server")]
        self.assertEqual(len(lost), 1)
        self.assertEqual(lost[0]["origin"], "condition")
        self.assertFalse(lost[0].get("fix_first"))
        h = r["headline"]
        self.assertEqual((h["freezes"], h["freeze_seconds"], h["stalls"]), (24, 25, 1))
        page = tester_report.build_html()
        self.assertLess(page.index("Fix first"), page.index("Around the app"))
        self.assertLessEqual(page.count('<details class="fix"'), 10)

    def test_the_page_opens_with_the_headline_then_fix_first_with_ten_rows_at_most(self):
        self.feed([{"k": "err", "s": "sessa1", "kind": "js", "msg": "TypeError: bug %s" % "abcdefghijklm"[n], "file": "app.js", "line": n + 1, "screen": "files", "t": self.ago(100 - n)} for n in range(13)])
        page = tester_report.build_html()
        self.assertLess(page.index('class="strip"'), page.index('id="fix"'))
        self.assertLess(page.index('id="fix"'), page.index('id="sum"'))                      # the long summary comes after
        fix = page[page.index('id="fix"'):page.index('</section>', page.index('id="fix"'))]
        self.assertEqual(fix.count('class="fix"'), 10)
        self.assertIn("The ten worst faults", fix)
        self.assertLess(page.index('id="fix"'), page.index('id="more"'))                      # the other three are under More findings, by part of the app
        self.assertEqual(page[page.index('id="more"'):].count('class="fix"') >= 3, True)

    def test_a_failed_slice_keeps_the_engines_whole_output_not_twelve_hundred_characters(self):
        stderr = "\n".join("[warning] plate 1: layer %d is empty (tester at 192.168.1.50)" % n for n in range(1, 900)) + "\n[error] Empty layers detected between 4.2 and 4.4"
        stdout = "Slic3r::CLI::run found error, exit"
        self.assertGreater(len(stderr), 40000)
        tester.note_slice({"status": "failed", "model": "M.3mf", "stage": "slice", "error": "Orca hit an error while slicing (Orca's code -100)", "cause": {"code": "orca_-100"}},
                          {"engine": {"app": "Snapmaker_Orca", "version": "2.4.1"}, "run": {"exit_code": 4294967196}}, {"stdout": stdout, "stderr": stderr})
        r = self.report()
        sl = r["slicing"][0]
        self.assertEqual((sl["ok"], sl["exit_code"]), (False, 4294967196))
        self.assertGreater(len(sl["stderr"]), 38000)
        self.assertTrue(sl["stderr"].endswith("[error] Empty layers detected between 4.2 and 4.4"))
        self.assertIn("layer 1 is empty", sl["stderr"])
        self.assertEqual(sl["stdout"], stdout)
        self.assertNotIn("192.168.1.50", json.dumps(r))
        self.assertIn("<ip>", sl["stderr"])
        f = next(x for x in r["findings"] if x["kind"] == "slice")
        self.assertIn("Exit code 4294967196", f["detail"])
        self.assertIn("Orca's code -100", f["detail"])
        self.assertEqual(f["slice"], 0)
        text = tester_report.render_findings(r)
        self.assertIn("Empty layers detected between 4.2 and 4.4", text)                    # the cause is in findings.md itself
        self.assertIn("whole output", text)
        self.assertIn("Empty layers detected between 4.2 and 4.4", tester_report.build_html())

    def test_the_slice_report_line_starts_with_the_outcome_so_a_cut_never_loses_the_cause(self):
        tester.note_slice({"status": "failed", "model": "M.3mf", "stage": "slice", "error": "Orca hit an error while slicing", "cause": {"code": "orca_-100"}},
                          {"engine": {"app": "Snapmaker_Orca", "version": "2.4.1"}, "outcome": {"status": "failed", "message": "Orca hit an error while slicing", "cause": {"code": "orca_-100"}},
                           "stage": {"reached": "slice"}, "host": {"os": "x" * 3000}, "run": {"exit_code": 156, "stdout": {"text": "y" * 3000}}})
        line = next(e for e in self.events() if e["k"] == "slice")
        self.assertTrue(line["report"].startswith('{"outcome": {"status": "failed", "message": "Orca hit an error while slicing"'), line["report"][:120])
        self.assertLessEqual(len(line["report"]), tester.MAX_NOTE)

    def test_the_code_pointers_name_files_that_exist(self):
        import tester_report_part4 as causes
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        paths = [p for _prefix, files in causes.ROUTE_CODE for p in files] + [p for files in causes.AREA_CODE.values() for p in files]
        self.assertGreater(len(paths), 30)
        for path in paths:
            self.assertTrue(os.path.isfile(os.path.join(root, path)), path)


class TestNothingPrivateInTheSavedFiles(InsightBase):
    def test_the_new_sections_hold_nothing_private(self):
        self.feed([
            {"k": "session", "s": "sessa1", "ev": "start", "first": True, "t": self.ago(200)},
            {"k": "err", "s": "sessa1", "kind": "js", "msg": "boom at 192.168.1.77", "stack": ["f app.js:1:1 /Users/jane.doe/x"], "ctl": "button \"Garage ssid=GarageWifi5G\"", "screen": "files",
             "last": ["click button \"192.168.1.77\""], "t": self.ago(150)},
            {"k": "note", "s": "sessa1", "text": "tried 10.20.30.40", "tag": "slow", "err": "boom at 192.168.1.77", "t": self.ago(140)},
            {"k": "onboarding", "s": "sessa1", "ev": "tour_step", "step": 1, "of": 9, "name": "Tour for jane@example.org", "ms": 100, "t": self.ago(130)},
            {"k": "change", "s": "sessa1", "ctl": "#picker", "screen": "files", "files": 1, "ext": "3mf", "t": self.ago(120)},
            {"k": "key", "s": "sessa1", "combo": "ctrl-k", "t": self.ago(110)},
        ])
        tester_study.save_answers({"q4": {"c": None, "t": "My printer is 192.168.1.77 and the key is sk-LIVEKEYabcdefghij123456"},
                                   "q52": {"c": None, "t": "Files are in /Users/jane.doe/Documents, ssid: GarageWifi5G"}})
        tester.record("printer", ev="firmware", printer="printer 1", facts={"moonraker_version": "v0.9.3"})
        z = zipfile.ZipFile(io.BytesIO(tester_report.build_zip()[1]))
        everything = "\n".join(z.read(n).decode("utf-8") for n in z.namelist())
        for secret in ("192.168.1.77", "10.20.30.40", "jane.doe", "jane@example.org", "sk-LIVEKEYabcdefghij123456", "GarageWifi5G"):
            self.assertNotIn(secret, everything, secret)
        self.assertIn("<ip>", everything)
        self.assertNotIn("<script", z.read("report.html").decode().lower())
        for line in z.read("events.jsonl").decode().splitlines():
            json.loads(line)

    def test_the_new_sections_are_escaped_in_the_page(self):
        self.feed([{"k": "err", "s": "sessa1", "kind": "js", "msg": "<img src=x onerror=alert(1)>", "stack": ["<script>x</script> app.js:1:1"], "ctl": "<b>bold</b>", "screen": "files",
                    "t": self.ago(50)},
                   {"k": "note", "s": "sessa1", "text": "<script>alert(2)</script>", "tag": "broken", "err": "<i>x</i>", "t": self.ago(40)},
                   {"k": "change", "s": "sessa1", "ctl": "<script>x</script>", "on": True, "screen": "settings", "t": self.ago(30)},
                   {"k": "key", "s": "sessa1", "combo": "<u>k</u>", "t": self.ago(20)}])
        tester_study.save_answers({"q52": {"c": None, "t": "<script>alert(3)</script> \"quoted\""}})
        page = tester_report.render_html(self.report())
        self.assertNotIn("<script", page.lower())
        self.assertNotIn("<img src=x", page)
        self.assertNotIn("<b>bold</b>", page)
        self.assertIn("&lt;script&gt;", page)


if __name__ == "__main__":
    unittest.main()
