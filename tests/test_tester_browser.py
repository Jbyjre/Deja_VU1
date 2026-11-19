"""
Tester mode in a real browser (tools/tester-walk.js): the walk, then the saved zip.

The walk starts the servers and a stand-in printer (tests/fake_moonraker.py). It checks that a run kept off with DEJAVU_TESTER=0
records nothing, then uses the tester build as shipped (always on): the first-run setup, no tester pop-up with it, every place,
presses of every kind, a file checked and printed on the stand-in printer, and three things made to go wrong on purpose (a request
held for 2.6 s, a button that freezes the page for 1.4 s, an error with a failed promise and an error toast). It writes a note right
after the error, opens the 22 questions from Settings, Tester mode (no round to run out), answers some and saves the zip from the
last step.

This module reads that zip and checks that every section is there, with what the walk did on purpose, and that nothing private
(an IP address typed into the deliberate error, the note and an answer) reached any file.

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
        # A run kept off records nothing; the shipped build records, asks the questions and saves the zip.
        self.assertEqual(self.code, 0, "The tester walk failed:\n" + self.out[-3000:])
        self.assertIn("PASSED", self.out)
        self.assertIn("DEJAVU_TESTER=0: the browser sent nothing to /api/tester (0 requests)", self.out)
        self.assertIn("DEJAVU_TESTER=0: /api/tester/events answers 403", self.out)
        self.assertIn("Recording is on with no switch", self.out)
        self.assertIn("The browser hid the address before it sent anything", self.out)
        self.assertIn("No tester pop-up, chip or panel appears on the first start", self.out)
        self.assertIn("The card has no days to pick and no round", self.out)
        self.assertIn("Only the phone and AI questions have a one-press", self.out)

    def test_the_saved_zip_holds_every_section(self):
        self.assertIsNotNone(self.report, "the walk saved no zip:\n" + self.out[-2000:])
        self.assertEqual(sorted(self.archive.namelist()), ["README.txt", "events.jsonl", "findings.md", "report.html", "report.json"])
        r = self.report
        self.assertEqual(r["schema_version"], 3)
        for key in ("summary", "setup", "sessions", "screens", "clicks", "slow", "requests", "errors", "printer", "confirm_print",
                    "slicing", "converter", "smoothness", "features", "notes", "updates", "timeline", "thinning", "never_recorded",
                    "study", "onboarding", "milestones", "usage", "stats", "performance", "server_health", "network", "findings", "headline", "stalls", "lost_link"):
            self.assertIn(key, r)
        setup = r["setup"]
        self.assertTrue(setup["server"]["os"] and setup["server"]["python"] and setup["server"]["app_version"])
        self.assertEqual(setup["server"]["printers_added"], 1)
        self.assertEqual(setup["browsers"][-1]["browser"], "Chrome")
        self.assertTrue(setup["browsers"][-1]["w"] and setup["browsers"][-1]["cores"])
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
        js = next(g for g in r["errors"]["groups"] if g["kind"] == "js" and "deliberate error" in g["message"])
        self.assertEqual(js["category"], "app_bug")
        self.assertTrue(js["controls"], "the control pressed just before the error")
        self.assertIn(js["area"], ("The 3D twin", "Printer page", "Printer page controls"))

    def test_the_notes_carry_their_tag_and_the_error_that_came_just_before(self):
        notes = self.report["notes"]
        slow = next(n for n in notes if n["tag"] == "slow")
        self.assertEqual(slow["text"].split(" (")[0], "Pause felt slow")
        self.assertTrue(slow["after_error"])
        self.assertIn("deliberate", slow["error"])
        self.assertTrue(slow["last_actions"])
        self.assertTrue(any(n["tag"] == "good" and n["text"] == "" for n in notes), "a note that is only a tag")

    def test_it_knows_how_the_first_run_went(self):
        ob = self.report["onboarding"]
        self.assertTrue(ob["first_run"])
        wizard = ob["wizard"]
        self.assertEqual((wizard["opened"], wizard["skipped"], wizard["finished"], wizard["furthest_step"], wizard["steps_total"]), (1, 1, 0, 3, 7))
        self.assertEqual([s["name"] for s in wizard["steps"]], ["Welcome", "Make it yours", "Your printer"])
        self.assertEqual(ob["tour"]["started"], 1)
        self.assertEqual(ob["tour"]["ended_early"], 1)
        self.assertGreaterEqual(ob["tour"]["steps_seen"], 2)
        ids = {m["id"] for m in self.report["milestones"]}
        for needed in ("setup_opened", "setup_closed", "added_a_printer", "printer_connected", "first_print_started", "first_error", "first_note", "questions_opened"):
            self.assertIn(needed, ids)

    def test_it_knows_how_the_controls_were_pressed(self):
        use = self.report["usage"]
        click = use["how_they_click"]
        self.assertGreater(click["methods"].get("mouse", 0), 20)
        self.assertEqual(click["buttons"].get("right"), 1)
        self.assertTrue(any(d["control"].startswith("[data-view=top]") or "top" in d["control"] for d in click["double_presses"]), click["double_presses"])
        self.assertIn("shift", click["modifiers"])
        self.assertTrue(any(k["combo"] == "ctrl-k" for k in use["keys"]))
        self.assertGreaterEqual(use["changes"]["total"], 1)
        self.assertTrue(any(c["value"] and c["value"].startswith("option ") for c in use["changes"]["recent"]))
        self.assertTrue(use["paths"]["transitions"])
        self.assertTrue(use["journey"] and use["journey"][0]["actions"])
        self.assertGreater(self.report["stats"]["click_to_paint"]["samples"], 20)
        self.assertGreaterEqual(self.report["performance"]["start_up"]["samples"], 1)
        self.assertGreaterEqual(self.report["server_health"]["samples"], 1)

    def test_the_questions_were_answered_in_the_app_and_are_in_the_report(self):
        study = self.report["study"]
        self.assertNotIn("plan", study)
        self.assertEqual((study["answered"], study["total"], study["didnt_try"], study["with_words"]), (7, 22, 1, 6))
        answers = {a["id"]: a for a in study["answers"] if a["answered"]}
        self.assertEqual(sorted(answers), sorted(["q1", "q2", "q3", "q5", "q16", "q19", "q20"]))
        self.assertEqual(answers["q16"]["choice"], "didnt_try")
        self.assertIn("connection refused", answers["q3"]["answer"])
        self.assertIn("<ip>", answers["q3"]["answer"])
        titles = " | ".join(f["title"] for f in self.report["findings"])
        for needle in ("Question 19", "Question 20"):
            self.assertIn(needle, titles)
        self.assertRegex(titles, r"A script error in the page: (Uncaught )?Error: walk: deliberate error")
        self.assertEqual(self.report["summary"]["findings"]["high"] >= 2, True)
        first = [f for f in self.report["findings"] if f.get("fix_first")]
        self.assertTrue(1 <= len(first) <= 10)
        self.assertTrue(all(f["origin"] == "app" for f in first))
        md = self.archive.read("findings.md").decode("utf-8")
        self.assertIn("## Fix first", md)
        self.assertIn("## Their answers (7 of 22 questions)", md)
        page = self.archive.read("report.html").decode("utf-8")
        for heading in ("Fix first", "Their answers", "The first run", "How they used it", "Smoothness and speed"):
            self.assertIn(heading, page)

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
