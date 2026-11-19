"""
tools/tester-reports.py: several testers' zips combined into real totals.

Two sample zips are built with the real Tester mode code (different computers, prints, errors and features),
then combined; the totals are checked by hand-counting what went in.
"""

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))

import modules                    # noqa: E402
import tester                     # noqa: E402
import tester_report              # noqa: E402

TOOL = os.path.join(ROOT, "tools", "tester-reports.py")
_spec = importlib.util.spec_from_file_location("tester_reports_tool", TOOL)
tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tool)


def _zip_with(events, server=None, answers=None, record=None):
    """Record `events` with Tester mode (and whatever `record()` adds from the server's side), save the report and clear the record. Returns the zip's bytes."""
    modules.set_enabled("tester", True)
    tester.refresh()
    tester.delete_all()
    tester.ingest({"events": events})
    if record:
        record()
    now = int(time.time() * 1000)
    tester.record("printer", ev="print_started", printer="printer 1", demo=False, t=now)
    if answers:
        import tester_study
        tester_study.save_answers(answers)
    data = tester_report.build_zip()[1]
    return data


class TestCombiningReports(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(self.cleanup)

    def cleanup(self):
        tester.refresh()
        tester.delete_all()

    def write(self, name, data):
        path = os.path.join(self.dir, name)
        with open(path, "wb") as f:
            f.write(data)
        return path

    def two_reports(self):
        now = int(time.time() * 1000)
        a = _zip_with([
            {"k": "session", "s": "aaaaaa01", "ev": "start", "device": "desk", "t": now - 5000},
            {"k": "setup", "s": "aaaaaa01", "browser": "Chrome", "bver": "131", "ua_os": "Windows", "w": 1920, "h": 1080, "t": now - 4900},
            {"k": "click", "s": "aaaaaa01", "ctl": "#slow", "screen": "printer", "paint": 2200, "slow": True, "t": now - 4000},
            {"k": "click", "s": "aaaaaa01", "ctl": "#fast", "screen": "printer", "paint": 30, "t": now - 3000},
            {"k": "err", "s": "aaaaaa01", "kind": "js", "msg": "TypeError: x is undefined at line 10", "t": now - 2000},
            {"k": "req", "s": "aaaaaa01", "route": "/api/files/samples", "method": "POST", "status": 200, "ms": 9000, "slow": True, "t": now - 1500},
            {"k": "fps", "s": "aaaaaa01", "surface": "twin", "fps": 30, "t": now - 1000},
            {"k": "feature", "s": "aaaaaa01", "name": "needs_you", "t": now - 900},
        ])
        b = _zip_with([
            {"k": "session", "s": "bbbbbb01", "ev": "start", "device": "phone", "t": now - 5000},
            {"k": "setup", "s": "bbbbbb01", "browser": "Safari", "bver": "17", "ua_os": "macOS", "w": 1440, "h": 900, "t": now - 4900},
            {"k": "click", "s": "bbbbbb01", "ctl": "#slow", "screen": "printer", "paint": 1500, "slow": True, "t": now - 4000},
            {"k": "err", "s": "bbbbbb01", "kind": "js", "msg": "TypeError: x is undefined at line 99", "t": now - 2000},
            {"k": "err", "s": "bbbbbb01", "kind": "toast", "msg": "Pause failed", "t": now - 1900},
            {"k": "fps", "s": "bbbbbb01", "surface": "twin", "fps": 50, "t": now - 1000},
        ])
        return self.write("a.zip", a), self.write("b.zip", b)

    def test_the_totals_are_what_went_in(self):
        paths = self.two_reports()
        reports = [tool.load(p) for p in paths]
        total = tool.combine(reports)
        self.assertEqual(total["testers"], 2)
        self.assertEqual(total["clicks"], 3)                                   # 2 + 1
        self.assertEqual(total["sessions"], 2)
        self.assertEqual(total["prints"]["started"], 2)                       # one print each
        self.assertEqual(total["devices"], {"desk": 1, "phone": 1})
        self.assertEqual(sorted(total["browsers"]), ["Chrome 131", "Safari 17"])
        # The same error said with different numbers is one kind, seen by both testers
        kinds = {e["message"]: e for e in total["errors"]}
        merged = next(e for m, e in kinds.items() if m.startswith("TypeError"))
        self.assertEqual((merged["count"], merged["testers"]), (2, 2))
        self.assertEqual(sum(e["count"] for e in total["errors"]), 3)
        slow = {c["control"]: c for c in total["slowest_controls"]}
        self.assertEqual((slow["#slow"]["presses"], slow["#slow"]["slow_presses"], slow["#slow"]["slowest_ms"], slow["#slow"]["testers"]), (2, 2, 2200, 2))
        self.assertNotIn("#fast", slow)                                        # never slow
        self.assertEqual(total["slowest_requests"][0]["request"], "POST /api/files/samples")
        self.assertEqual(total["smoothness_median_fps"]["twin"], {"testers": 2, "lowest": 30, "median": 40, "highest": 50})
        used = {f["name"]: f["testers_used"] for f in total["features"]}
        self.assertEqual(used["Needs you"], 1)
        self.assertEqual(used["The 3D twin"], 2)
        self.assertEqual(used["Spoolman"], 0)
        self.assertIn("Spoolman", total["features_nobody_used"])
        self.assertNotIn("Needs you", total["features_nobody_used"])

    def test_the_command_line_prints_a_readable_summary_and_json(self):
        a, b = self.two_reports()
        text = subprocess.run([sys.executable, TOOL, self.dir], capture_output=True, text=True, check=True).stdout
        self.assertIn("2 reports combined", text)
        self.assertIn("Nobody used:", text)
        self.assertIn("Spoolman", text)
        self.assertIn("Started 2", text)
        data = json.loads(subprocess.run([sys.executable, TOOL, a, b, "--json"], capture_output=True, text=True, check=True).stdout)
        self.assertEqual(data["testers"], 2)
        self.assertEqual(data["skipped"], 0)

    def two_rounds(self):
        """Two testers with answers, a first run and the same problem (one of them said so)."""
        import tester_study
        now = int(time.time() * 1000)
        a = _zip_with([
            {"k": "session", "s": "aaaaaa01", "ev": "start", "first": True, "t": now - 9000},
            {"k": "onboarding", "s": "aaaaaa01", "ev": "wizard_open", "first": True, "step": 1, "of": 7, "t": now - 8900},
            {"k": "onboarding", "s": "aaaaaa01", "ev": "wizard_end", "how": "done", "step": 7, "of": 7, "ms": 60000, "t": now - 8000},
            {"k": "click", "s": "aaaaaa01", "ctl": "#go", "screen": "printers", "paint": 25, "how": "mouse", "t": now - 7000},
            {"k": "click", "s": "aaaaaa01", "ctl": "#go2", "screen": "printers", "paint": 35, "how": "touch", "t": now - 6900},
            {"k": "err", "s": "aaaaaa01", "kind": "js", "msg": "TypeError: x is undefined at line 10", "file": "app.js", "line": 10, "screen": "files", "t": now - 6000},
            {"k": "perf", "s": "aaaaaa01", "boot": True, "load": 800, "t": now - 5000},
        ], answers={"q19": {"c": None, "t": "Refused"}, "q18": {"c": None, "t": "Confirm Print"}, "q16": {"c": "didnt_try", "t": ""}})
        b = _zip_with([
            {"k": "session", "s": "bbbbbb01", "ev": "start", "t": now - 9000},
            {"k": "onboarding", "s": "bbbbbb01", "ev": "wizard_end", "how": "skipped", "step": 2, "of": 7, "ms": 9000, "t": now - 8000},
            {"k": "click", "s": "bbbbbb01", "ctl": "#go", "screen": "printers", "paint": 45, "how": "key", "t": now - 7000},
            {"k": "err", "s": "bbbbbb01", "kind": "js", "msg": "TypeError: x is undefined at line 99", "file": "app.js", "line": 99, "screen": "files", "t": now - 6000},
            {"k": "note", "s": "bbbbbb01", "text": "Files screen broke", "tag": "broken", "screen": "files", "t": now - 5900},
            {"k": "perf", "s": "bbbbbb01", "boot": True, "load": 1200, "t": now - 5000},
        ], answers={"q19": {"c": None, "t": "Files crashed"}, "q18": {"c": None, "t": "The twin"}, "q20": {"c": None, "t": "Faster Pause"}})
        return self.write("a.zip", a), self.write("b.zip", b)

    def test_answers_findings_first_run_and_pressing_are_combined(self):
        total = tool.combine([tool.load(p) for p in self.two_rounds()])
        q = {x["n"]: x for x in total["questions"]}
        self.assertEqual((q[19]["answered"], q[19]["of"], q[19]["id"]), (2, 2, "q19"))
        self.assertEqual([t["text"] for t in q[18]["texts"]], ["Confirm Print", "The twin"])
        self.assertEqual([t["tester"] for t in q[18]["texts"]], [1, 2])
        self.assertEqual(q[16]["choices"], {"didnt_try": 1})
        self.assertEqual(total["questions_answered_median"], 3)
        merged = next(f for f in total["findings"] if f["kind"] == "error")
        self.assertEqual((merged["testers"], merged["tester_numbers"], merged["severity"], merged["origin"]), (2, [1, 2], "high", "app"))
        self.assertEqual(merged["code"][0], "frontend/app.js:10")
        self.assertTrue(any(f["kind"] == "note" and f["tester_said"] for f in total["findings"]))
        self.assertEqual([f["severity"] for f in total["findings"]], sorted((f["severity"] for f in total["findings"]), key=lambda v: {"high": 0, "medium": 1, "low": 2}[v]))
        self.assertEqual((total["first_run"]["setup_finished"], total["first_run"]["setup_skipped"], total["first_run"]["setup_opened"]), (1, 1, 1))
        self.assertEqual(total["how_they_press"], {"mouse": 1, "touch": 1, "key": 1})
        self.assertEqual(total["median_page_load_ms"], 1000)
        self.assertNotIn("rounds", total)

    def test_the_answers_and_findings_switches_print_text_a_person_can_read(self):
        a, b = self.two_rounds()
        answers = subprocess.run([sys.executable, TOOL, a, b, "--answers"], capture_output=True, text=True, check=True).stdout
        self.assertIn("19. What frustrated you most", answers)
        self.assertIn("Tester 1: Confirm Print", answers)
        self.assertIn("Tester 2: The twin", answers)
        self.assertIn("Didn't try it: 1", answers)
        findings = subprocess.run([sys.executable, TOOL, a, b, "--findings"], capture_output=True, text=True, check=True).stdout
        self.assertTrue(findings.startswith("# Deja Vu1 tester findings, 2 reports combined"))
        self.assertIn("## Fix first", findings)
        self.assertIn("- Testers: 2 of 2 (1, 2)", findings)
        self.assertIn("- Where to look: frontend/app.js:10", findings)
        text = subprocess.run([sys.executable, TOOL, a, b], capture_output=True, text=True, check=True).stdout
        for needle in ("First run", "Setup opened 1 time: finished 1, skipped 1", "Fix first: the app's own faults", "The questions: how many testers answered each"):
            self.assertIn(needle, text)

    def stall_zip(self, seconds, hour_offset):
        """A tester whose server stopped answering for `seconds` while a time-lapse was kept: nine routes waited together."""
        now = int(time.time() * 1000)
        routes = ["/api/connection", "/api/leds", "/api/cost/:id", "/api/health", "/api/queue", "/api/maintenance", "/api/chamber", "/api/printers", "/api/fleet"]
        events = [{"k": "click", "s": "stall%02d" % hour_offset, "ctl": "#keep-copy", "screen": "printer", "paint": 30, "t": now - 40000}]
        events += [{"k": "req", "s": "stall%02d" % hour_offset, "route": r, "method": "GET", "status": 200, "ms": seconds * 1000 + i * 50, "slow": True, "screen": "printer",
                    "t": now - 1000} for i, r in enumerate(routes)]
        events += [{"k": "req", "s": "stall%02d" % hour_offset, "route": r, "method": "GET", "agg": True, "n": 200, "ok": 200, "fail": 0, "p50": 6, "max": 40,
                    "bucket": 1, "t": now - 3600000} for r in routes]
        events.append({"k": "req", "s": "stall%02d" % hour_offset, "route": "/api/timelapse/keep", "method": "POST", "status": 200, "ms": seconds * 1000 + 1000, "slow": True,
                       "screen": "printer", "t": now - 500})
        events += [{"k": "req", "s": "stall%02d" % hour_offset, "route": "/api/app/alive", "method": "GET", "status": 0, "ms": 20, "err": "Failed to fetch", "t": now - 200000 + i}
                   for i in range(3)]
        return _zip_with(events, record=lambda: tester.record("slowroute", method="POST", route="/api/timelapse/keep", ms=seconds * 1000 + 1000))

    def test_stalls_that_differ_only_in_their_numbers_are_one_top_fix_with_how_many_testers_hit_it(self):
        a = self.write("s1.zip", self.stall_zip(27, 0))
        b = self.write("s2.zip", self.stall_zip(31, 5))
        total = tool.combine([tool.load(a), tool.load(b)])
        stalls = [f for f in total["findings"] if f["kind"] == "stall"]
        self.assertEqual(len(stalls), 1, [f["title"] for f in total["findings"]])
        stall = stalls[0]
        self.assertEqual((stall["testers"], stall["tester_numbers"], stall["origin"], stall["fix_first"]), (2, [1, 2], "app", 1))
        self.assertEqual(stall["code"], ["backend/timelapse.py"])
        self.assertEqual(stall["trail"][-1], "click #keep-copy")
        lost = [f for f in total["findings"] if f["title"].startswith("The page lost the server")]
        self.assertEqual((len(lost), lost[0]["origin"], lost[0]["fix_first"], lost[0]["testers"]), (1, "condition", None, 2))
        text = tool.render_findings(total)
        self.assertLess(text.index("## Fix first"), text.index("## Around the app"))
        self.assertIn("### 1. [high] The server stopped answering", text)
        self.assertIn("- Testers: 2 of 2 (1, 2)", text)
        self.assertIn("- Where to look: backend/timelapse.py", text)
        self.assertIn("- Last presses before it (from one tester): click #keep-copy", text)
        self.assertIn("The page lost the server", text[text.index("## Around the app"):])
        self.assertLessEqual(text[:text.index("## Around the app")].count("### "), 10)

    def test_the_combined_fix_first_never_holds_more_than_ten(self):
        events = [{"k": "err", "s": "many0001", "kind": "js", "msg": "TypeError: bug %s" % "abcdefghijklmnop"[n], "file": "app.js", "line": n + 1, "screen": "files",
                   "t": int(time.time() * 1000) - 5000 - n} for n in range(16)]
        data = self.write("many.zip", _zip_with(events))
        total = tool.combine([tool.load(data)])
        self.assertEqual(len([f for f in total["findings"] if f["fix_first"]]), 10)
        self.assertEqual(sorted(f["fix_first"] for f in total["findings"] if f["fix_first"]), list(range(1, 11)))

    def test_a_schema_2_report_with_no_origin_or_code_still_combines(self):
        a, _ = self.two_rounds()
        import zipfile
        path = self.write("v2.zip", b"")
        with zipfile.ZipFile(a) as src, zipfile.ZipFile(path, "w") as out:
            report = json.loads(src.read("report.json"))
            report["schema_version"] = 2
            for f in report["findings"]:
                for key in ("origin", "code", "screens", "fix_first"):
                    f.pop(key, None)
            out.writestr("report.json", json.dumps(report))
        total = tool.combine([tool.load(path)])
        self.assertTrue(total["findings"])
        self.assertTrue(all(f["origin"] in ("app", "condition") for f in total["findings"]))
        self.assertEqual(len([f for f in total["findings"] if f["fix_first"]]), len([f for f in total["findings"] if f["origin"] == "app" and f["severity"] in ("high", "medium")][:10]))

    def test_a_schema_1_report_still_combines(self):
        a, _ = self.two_reports()
        import zipfile
        path = self.write("old.zip", b"")
        with zipfile.ZipFile(a) as src, zipfile.ZipFile(path, "w") as out:
            report = json.loads(src.read("report.json"))
            for key in ("study", "onboarding", "milestones", "usage", "stats", "performance", "server_health", "network", "findings"):
                report.pop(key, None)
            report["schema_version"] = 1
            out.writestr("report.json", json.dumps(report))
        total = tool.combine([tool.load(path)])
        self.assertEqual((total["testers"], total["clicks"], total["questions"], total["findings"]), (1, 2, [], []))
        self.assertIn("1 report combined", tool.render(total))

    def test_a_bad_zip_is_skipped_in_words_and_the_rest_still_count(self):
        a, _ = self.two_reports()
        bad = self.write("bad.zip", b"not a zip")
        other = self.write("other.zip", b"")
        import zipfile
        with zipfile.ZipFile(other, "w") as z:
            z.writestr("report.json", json.dumps({"schema_version": 99}))
        done = subprocess.run([sys.executable, TOOL, a, bad, other, "--json"], capture_output=True, text=True)
        self.assertEqual(done.returncode, 0)
        self.assertIn("skipped:", done.stderr)
        self.assertIn("bad.zip", done.stderr)
        self.assertIn("schema_version 99", done.stderr)
        data = json.loads(done.stdout)
        self.assertEqual((data["testers"], data["skipped"]), (1, 2))

    def test_nothing_readable_is_a_failure_in_words(self):
        bad = self.write("bad.zip", b"nope")
        done = subprocess.run([sys.executable, TOOL, bad], capture_output=True, text=True)
        self.assertEqual(done.returncode, 1)
        self.assertIn("No readable tester reports", done.stderr)

    def test_the_tool_uses_only_the_standard_library(self):
        with open(TOOL, encoding="utf-8") as f:
            source = f.read()
        for line in source.splitlines():
            if line.startswith(("import ", "from ")):
                name = line.split()[1].split(".")[0]
                self.assertIn(name, sys.stdlib_module_names if hasattr(sys, "stdlib_module_names") else
                              {"argparse", "io", "json", "os", "re", "statistics", "sys", "zipfile", "collections"}, line)


if __name__ == "__main__":
    unittest.main()
