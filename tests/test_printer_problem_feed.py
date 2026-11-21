"""
A problem the printer reports, from the live feed to the logbook, the browser's event stream, the rules and Tester mode:
the demo printers raise the same shape of problem a U1 does (a code with Snapmaker's words), so the whole path runs
without a printer.
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import automations   # noqa: E402
import live_feed   # noqa: E402
import logbook   # noqa: E402
import mock_moonraker   # noqa: E402
import modules   # noqa: E402
import tester   # noqa: E402

STUDIO = "u1-studio"        # Demo printer 2: paused on 0002-0523-0000-0038 (Printing Anomaly, toolhead 1)
WORKSHOP = "u1-workshop"    # Demo printer 1: printing


def problem_events():
    return [e for e in live_feed.events_since(0) if e.get("type") == "printer_problem"]


class FeedCase(unittest.TestCase):
    def setUp(self):
        modules.reset_state()
        mock_moonraker.reset_all()
        live_feed.reset()
        automations.reset()
        logbook.reset()
        live_feed.mark_demo_seen()

    def tearDown(self):
        automations.wait_idle()
        modules.reset_state()
        mock_moonraker.reset_all()
        live_feed.reset()
        automations.reset()
        logbook.reset()

    def entries(self, printer=STUDIO):
        return [e for e in logbook.entries(printer, demo=True)["entries"] if e.get("incident")]


class TestAProblemAppears(FeedCase):
    def test_it_is_announced_and_logged_once_in_the_wikis_words(self):
        live_feed.tick(0.25)
        live_feed.tick(0.25)
        events = [e for e in problem_events() if e["printer"] == STUDIO]
        self.assertEqual(len(events), 1)
        shown = events[0]["problem"]
        self.assertEqual((shown["code"], shown["title"], shown["effect"]), ("0002-0523-0000-0038", "Printing Anomaly", "paused"))
        self.assertEqual(shown["guide"]["slug"], "troubleshooting/printing_anomaly")
        rows = self.entries()
        self.assertEqual(len(rows), 1)
        self.assertIn("Printing Anomaly (0002-0523-0000-0038)", rows[0]["problem"])
        self.assertIn("tangled on the spool", rows[0]["problem"])
        self.assertEqual(rows[0]["incident"]["file"], "gridfinity_bin_2x1.gcode")
        self.assertIn("0002-0523-0000-0038", rows[0]["tags"])
        self.assertTrue(rows[0]["auto"])
        self.assertIsNone(rows[0]["incident"]["cleared_at"])

    def test_the_readings_from_just_before_are_kept_with_it(self):
        logbook._sampled.clear()
        live_feed.tick(0.25)
        incident = self.entries()[0]["incident"]
        self.assertIsInstance(incident["before"], list)
        self.assertTrue(incident["before"])
        self.assertIn("bed", incident["before"][-1])

    def test_a_restart_does_not_log_the_same_open_problem_again(self):
        live_feed.tick(0.25)
        live_feed._problems_seen.clear()          # what a restart forgets
        live_feed.tick(0.25)
        self.assertEqual(len(self.entries()), 1)
        self.assertEqual(len([e for e in problem_events() if e["printer"] == STUDIO]), 1)

    def test_resuming_marks_it_cleared(self):
        live_feed.tick(0.25)
        with mock_moonraker.use_printer(STUDIO):
            mock_moonraker.resume_print()
        live_feed.refresh(STUDIO)
        self.assertTrue(self.entries()[0]["incident"]["cleared_at"])
        self.assertNotIn("problem", live_feed.snapshot(STUDIO)["state"])

    def test_the_same_code_again_after_a_resume_is_a_new_incident(self):
        live_feed.tick(0.25)
        for _ in range(2):
            with mock_moonraker.use_printer(WORKSHOP):
                mock_moonraker.inject_runout(mock_moonraker.get_printer_state()["active_toolhead"])
            live_feed.refresh(WORKSHOP)
            with mock_moonraker.use_printer(WORKSHOP):
                mock_moonraker.resume_print()
            live_feed.refresh(WORKSHOP)
        rows = self.entries(WORKSHOP)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["incident"]["cleared_at"] for r in rows))

    def test_a_runout_pause_names_the_head_and_its_code(self):
        live_feed.tick(0.25)
        with mock_moonraker.use_printer(WORKSHOP):
            head = mock_moonraker.get_printer_state()["active_toolhead"]
            state = mock_moonraker.inject_runout(head)
        self.assertEqual(state["state"], "paused")
        number = int(head[1:])
        self.assertEqual(state["problem"]["code"], "0002-0523-%04d-0000" % number)
        self.assertEqual(state["problem"]["title"], "Filament Anomaly")
        self.assertIn("Filament runout detected in Toolhead %d" % (number + 1), state["problem"]["details"])
        live_feed.refresh(WORKSHOP)
        self.assertEqual(len(self.entries(WORKSHOP)), 1)

    def test_a_pause_pressed_by_hand_is_not_a_problem(self):
        live_feed.tick(0.25)
        before = len(problem_events())
        with mock_moonraker.use_printer(WORKSHOP):
            mock_moonraker.pause_print()
        state = live_feed.refresh(WORKSHOP)
        self.assertEqual(state["state"], "paused")
        self.assertNotIn("problem", state)
        self.assertEqual(len(problem_events()), before)
        self.assertEqual(self.entries(WORKSHOP), [])

    def test_with_the_logbook_switched_off_the_browser_still_hears_of_it(self):
        modules.set_enabled("maintenance", False)
        live_feed.tick(0.25)
        self.assertTrue([e for e in problem_events() if e["printer"] == STUDIO])
        self.assertEqual(self.entries(), [])

    def test_a_problem_is_not_logged_for_a_printer_that_has_lost_its_link(self):
        state = {"state": "paused", "link_lost": True, "problems": [{"code": "0002-0523-0000-0000", "level": 2}]}
        live_feed._note_problems("u1-garage", state, True)
        self.assertEqual(problem_events(), [])


class TestRulesAndTesters(FeedCase):
    def test_the_error_rule_fires_for_a_pause_the_printer_raised_but_not_for_a_pause_by_hand(self):
        automations.add_rule({"trigger": {"type": "error"}, "action": {"type": "notify", "message": "The printer reported a problem"},
                              "cooldown_s": 0}, demo=True)
        with mock_moonraker.use_printer(STUDIO):
            raised = mock_moonraker.get_printer_state()
        self.assertEqual(len(automations.evaluate(STUDIO, raised, set(), True)), 1)
        with mock_moonraker.use_printer(WORKSHOP):
            mock_moonraker.pause_print()
            by_hand = mock_moonraker.get_printer_state()
        self.assertEqual(automations.evaluate(WORKSHOP, by_hand, set(), True), [])
        notice = dict(raised, problem=dict(raised["problem"], level=1))
        automations._edge.clear()
        self.assertEqual(automations.evaluate(STUDIO, notice, set(), True), [])      # a notice is not an error

    def test_tester_mode_keeps_the_code_and_the_wikis_title_only(self):
        sent = []
        original = tester.record
        tester.record = lambda kind, **fields: sent.append((kind, fields)) or True
        enabled = tester.enabled
        tester.enabled = lambda: True
        self.addCleanup(setattr, tester, "record", original)
        self.addCleanup(setattr, tester, "enabled", enabled)
        live_feed.tick(0.25)
        printer = [f for k, f in sent if k == "printer" and f.get("ev") == "problem"]
        self.assertEqual(len(printer), 1)
        self.assertEqual(printer[0]["code"], "0002-0523-0000-0038")
        self.assertEqual(printer[0]["words"], "0002-0523-0000-0038: Printing Anomaly")
        self.assertNotIn("gridfinity", json.dumps(printer))          # no file name travels with it


if __name__ == "__main__":
    unittest.main()
