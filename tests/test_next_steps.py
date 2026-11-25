"""The next step after each step (FLOW.1): checks that need no browser.

Confirm Print offers a fix for each reason it holds a print, a started print lands on the Printer page, the finished-
print summary leads to the record, a second print and the next file in the queue, and one tray in the top bar lists
the long jobs. The backend side (`fixes` in /api/print/confirm) is in test_print_gate.py; the browser walk is recorded
in CHANGELOG.md.
"""

import os
import re
import sys
import unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from frontend_parts import read_frontend  # noqa: E402

INDEX = read_frontend("index.html")
ACTIVITY = read_frontend("activity.js")
WORKSHOP = read_frontend("workshop.js")          # all five parts and workshop.js


class TestActivityTray(unittest.TestCase):
    def test_loaded_once_and_every_caller_checks_it_is_there(self):
        scripts = re.findall(r'<script src="([^"]+)"', INDEX)
        self.assertEqual(scripts.count("activity.js"), 1)
        # It loads late, after the screens that report to it; they call it only when a job starts, and each checks first.
        for name in ("workshop.js", "slicer-preview.js", "slicer-settings.js", "farm-part2.js"):
            text = read_frontend(name)
            calls = len(re.findall(r"Activity\.(?:add|refresh)\(", text))
            guarded = len(re.findall(r"window\.Activity(?:\)| &&) Activity\.(?:add|refresh)\(", text))
            self.assertEqual(calls, guarded, name)

    def test_it_only_reads(self):
        self.assertNotIn("postJSON", ACTIVITY)                    # the tray never starts, stops or changes a job
        for route in ("/api/slicer/jobs", "/api/slicer/engine", "/api/timelapse/jobs"):
            self.assertIn(route, ACTIVITY)

    def test_names_reach_the_page_escaped(self):
        self.assertIn("${esc(i.text)}", ACTIVITY)
        self.assertNotRegex(ACTIVITY, r"\$\{i\.text\}")

    def test_the_long_jobs_report_to_it(self):
        self.assertIn("Activity.add({ text: `Starting ${name}", WORKSHOP)
        self.assertIn("Activity.add(", WORKSHOP.split("async function uploadFiles")[1][:3000])
        for name in ("slicer-preview.js", "slicer-settings.js", "farm-part2.js"):
            self.assertIn("Activity.refresh()", read_frontend(name), name)


class TestNextSteps(unittest.TestCase):
    def test_the_summary_has_its_next_steps(self):
        for i in ("celebrate-record", "celebrate-again", "celebrate-next", "celebrate-next-go", "celebrate-timelapse"):
            self.assertIn(f'id="{i}"', INDEX, i)
            self.assertIn(f"$('{i}')", WORKSHOP, i)
        self.assertIn("It starts only when you start it.", WORKSHOP)

    def test_confirm_print_shows_its_fixes(self):
        self.assertIn('class="gate-fixes"', WORKSHOP)
        self.assertIn("data-fix=", WORKSHOP)
        for kind in ("bed", "queue", "slicer", "nozzle"):
            self.assertIn(f"'{kind}'", WORKSHOP.split("[data-fix]")[1][:2500], kind)

    def test_a_started_print_lands_on_the_printer_page(self):
        self.assertIn("goPlace('printer')", WORKSHOP)
        self.assertIn("Rail.goDest(", WORKSHOP)


if __name__ == "__main__":
    unittest.main()
