"""
Tester mode in a real browser (tools/tester-walk.js): the walk, then the saved zip.

The walk starts the server and a stand-in printer (tests/fake_moonraker.py), uses the app with Tester mode off (nothing is sent,
the routes answer 403), switches it on in Settings, opens every place, presses controls, checks and starts a print on the
stand-in printer, and makes three things go wrong on purpose: a request held for 2.6 s, a button that freezes the page for
1.4 s, and an error, a failed promise and an error toast. Then it presses View report and Save tester report.

This module reads the saved zip and checks that every section is there, with the slow action, the errors and the note the walk
made, and that nothing private (an IP address typed into the deliberate error and the note) reached any file.

It needs Node, Playwright for Node and a Chromium, so it is skipped where they are missing (GitHub's Python jobs).
"""

import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TOOL = os.path.join(ROOT, "tools", "tester-walk.js")


def _browser_ready():
    node = shutil.which("node")
    if not node:
        return False
    try:
        done = subprocess.run([node, TOOL, "--probe"], capture_output=True, timeout=60, cwd=ROOT)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return done.returncode == 0


@unittest.skipUnless(_browser_ready(), "Node, Playwright for Node and a Chromium are needed")
class TestTesterWalk(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.zip = os.path.join(cls.dir, "walk.zip")
        done = subprocess.run(["node", TOOL, "--zip", cls.zip], capture_output=True, timeout=600, cwd=ROOT)
        cls.out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        cls.code = done.returncode
        if os.path.exists(cls.zip):
            with open(cls.zip, "rb") as f:
                cls.data = f.read()
            cls.archive = zipfile.ZipFile(io.BytesIO(cls.data))
            cls.report = json.loads(cls.archive.read("report.json"))
        else:
            cls.data, cls.archive, cls.report = None, None, None

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_the_walk_passes(self):
        # Off: nothing sent and every route 403; on: events sent, the card, the viewer and the download work.
        self.assertEqual(self.code, 0, "The tester walk failed:\n" + self.out[-3000:])
        self.assertIn("PASSED", self.out)
        self.assertIn("Tester mode off: the browser sent nothing to /api/tester (0 requests)", self.out)
        self.assertIn("Tester mode off: /api/tester/events answers 403", self.out)
        self.assertIn("The browser hid the address before it sent anything", self.out)

    def test_the_saved_zip_holds_every_section(self):
        self.assertIsNotNone(self.report, "the walk saved no zip:\n" + self.out[-2000:])
        self.assertEqual(sorted(self.archive.namelist()), ["README.txt", "events.jsonl", "report.html", "report.json"])
        r = self.report
        for key in ("summary", "setup", "sessions", "screens", "clicks", "slow", "requests", "errors", "printer", "confirm_print",
                    "slicing", "converter", "smoothness", "features", "notes", "updates", "timeline", "thinning", "never_recorded"):
            self.assertIn(key, r)
        setup = r["setup"]
        self.assertTrue(setup["server"]["os"] and setup["server"]["python"] and setup["server"]["app_version"])
        self.assertEqual(setup["server"]["printers_added"], 1)
        self.assertEqual(setup["browsers"][-1]["browser"], "Chrome")
        self.assertTrue(setup["browsers"][-1]["w"])
        self.assertGreaterEqual(len(r["sessions"]), 1)
        self.assertGreaterEqual(len(r["screens"]["totals"]), 8)
        self.assertGreater(r["clicks"]["total"], 20)
        self.assertEqual(r["summary"]["prints_started"], 1)
        self.assertGreaterEqual(r["confirm_print"]["checks"], 1)
        self.assertEqual(r["confirm_print"]["went_on_to_print"], 1)
        self.assertTrue(r["printer"]["confirmed_by_printer"], "pause and resume should be confirmed by the printer")
        self.assertEqual([c["what"] for c in r["printer"]["sent_not_read_back"]], ["Walk: Emergency stop sent"])
        self.assertEqual(r["printer"]["sent_not_read_back"][0]["median_ms"], 123)
        self.assertEqual(r["printer"]["connections"].get("connect"), 1)
        self.assertEqual(len(r["features"]["detail"]), 22)
        self.assertIn("Confirm Print", r["features"]["used"])
        self.assertIn("The 3D twin", r["features"]["used"])

    def test_it_holds_the_slow_action_and_the_errors_the_walk_caused(self):
        r = self.report
        slow = r["slow"]
        self.assertTrue(any((a.get("paint_ms") or 0) >= 1000 for a in slow["slowest_actions"]), "the frozen click")
        self.assertTrue(any(q["route"] == "/api/maintenance/snooze" and q["ms"] >= 2000 for q in slow["slow_requests"]), "the held-back request")
        self.assertGreaterEqual(slow["long_tasks"]["count"], 1)
        messages = " | ".join(g["message"] for g in r["errors"]["groups"])
        for needle in ("deliberate error", "deliberate rejection", "deliberate error toast"):
            self.assertIn(needle, messages)
        kinds = {g["kind"] for g in r["errors"]["groups"]}
        self.assertTrue({"js", "promise", "toast"} <= kinds, kinds)
        self.assertTrue(all(g["last_actions"] for g in r["errors"]["groups"] if g["kind"] == "js"))
        self.assertEqual(r["notes"][0]["text"].split(" (")[0], "Pause felt slow")
        self.assertTrue(r["notes"][0]["last_actions"])

    def test_nothing_private_reached_any_file(self):
        self.assertIsNotNone(self.archive)
        everything = "\n".join(self.archive.read(n).decode("utf-8") for n in self.archive.namelist())
        self.assertNotIn("192.168.7.7", everything)
        self.assertIn("<ip>", everything)                      # said, not silently dropped
        self.assertNotIn("Walk stand-in", everything)           # the printer's name
        self.assertNotIn("127.0.0.1", everything)
        self.assertNotIn("<script", self.archive.read("report.html").decode("utf-8").lower())


if __name__ == "__main__":
    unittest.main()
