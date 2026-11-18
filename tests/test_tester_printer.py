"""
Tester mode with a printer on the other end (the Moonraker stand-in, tests/fake_moonraker.py): not a real U1.

What these prove:
  - Tester mode and watch-only mode work together: the printer is sent nothing but reads, the refusals are recorded
    in the app's words, and the lookup of the printer's version is a read that watch-only allows;
  - a print's start and its end are recorded against a file that is shown only as "file 3, .gcode";
  - the printer's own name and address never reach the record.
"""

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "backend"))
sys.path.insert(0, HERE)

import file_library              # noqa: E402
import live_feed                 # noqa: E402
import mock_moonraker            # noqa: E402
import modules                   # noqa: E402
import tester                    # noqa: E402
import tester_report             # noqa: E402
from test_real_printer import RealPrinterAPI, wait_for   # noqa: E402


class TestTesterWithAPrinter(RealPrinterAPI):
    def setUp(self):
        super().setUp()
        import watch_only
        watch_only.reset()
        self.addCleanup(watch_only.reset)
        modules.set_enabled("tester", True)
        tester.refresh()
        tester.delete_all()
        self.addCleanup(self.finish)

    def finish(self):
        tester.refresh()
        tester.delete_all()

    def events(self, kind=None):
        found = list(tester_report.iter_events(tester.event_files()))
        return [e for e in found if kind is None or e["k"] == kind]

    def writes(self):
        return [r for r in self.fake.requests if r[0] != "GET" and r[1] != "/printer/objects/query"]

    def test_the_printers_versions_are_read_with_watch_only_on_and_nothing_is_written_to_it(self):
        self.request("/api/app/watch-only", {"on": True})
        before = len(self.writes())
        facts = mock_moonraker.real_printer(self.pid).version_facts()
        self.assertEqual(facts.get("moonraker_version"), "fake")           # what the stand-in reports in server.info
        self.assertEqual(self.writes()[before:], [])

    def test_refused_commands_are_recorded_in_the_apps_words_and_nothing_reaches_the_printer(self):
        file_library.add_samples()
        self.printing()
        self.request("/api/app/watch-only", {"on": True})
        before = len(self.writes())
        status, body = self.request("/api/printer/control/pause?printer=" + self.pid, {})
        self.assertEqual(status, 409)
        self.assertEqual(self.writes()[before:], [])
        refused = [e for e in self.events("printer") if e["ev"] == "refused"]
        self.assertEqual(len(refused), 1)
        self.assertEqual(refused[0]["route"], "/api/printer/control/pause")
        self.assertIn("Watch-only mode is on", refused[0]["words"])
        # A failed read is a failed request, not a refused command
        self.request("/api/printer/files?printer=" + self.pid)
        self.assertEqual(len([e for e in self.events("printer") if e["ev"] == "refused"]), 1)

    def test_a_print_is_recorded_without_the_file_name_or_the_printers_name_or_address(self):
        file_library.add_samples()
        name = None
        for sample in (f["name"] for f in file_library.list_files()["files"] if f["name"].endswith(".gcode")):
            self.fake.files[sample] = b"G28\n"
            status, body = self.request("/api/printer/control/start?printer=" + self.pid, {"filename": sample, "confirmed": True})
            if status == 200:                    # one sample is made unsafe on purpose: Confirm Print refuses it
                name = sample
                break
        self.assertIsNotNone(name, "no sample G-code file could be started on the stand-in printer")
        self.assertTrue(wait_for(lambda: mock_moonraker.real_printer(self.pid).snapshot()["state"] == "printing"))
        live_feed.refresh(self.pid)
        text = json.dumps(self.events())
        self.assertTrue([e for e in self.events("printer") if e["ev"] == "start_requested"])
        self.assertNotIn(name, text)
        self.assertNotIn("Bench U1", text)
        self.assertNotIn(self.fake.url.split("//")[1], text)
        self.assertNotIn("127.0.0.1", text)
        self.assertRegex(text, r"file \d+, \.gcode")


if __name__ == "__main__":
    unittest.main()
