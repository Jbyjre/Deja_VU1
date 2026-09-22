"""Tests for backend/live_feed.py - the 250 ms cache, events and their side effects."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import automations     # noqa: E402
import file_library    # noqa: E402
import live_feed       # noqa: E402
import maintenance     # noqa: E402
import mock_moonraker  # noqa: E402
import print_queue     # noqa: E402
import timelapse       # noqa: E402


class TestLiveFeed(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_all()
        live_feed.reset()
        automations.reset()
        timelapse.reset()

    def tearDown(self):
        automations.wait_idle()
        mock_moonraker.reset_all()
        live_feed.reset()
        automations.reset()
        timelapse.reset()

    def test_tick_advances_and_numbers_every_update(self):
        live_feed.tick(0.25)
        first = live_feed.snapshot("u1-workshop")
        live_feed.tick(0.25)
        second = live_feed.snapshot("u1-workshop")
        self.assertGreater(second["seq"], first["seq"])
        self.assertGreaterEqual(second["state"]["progress"], first["state"]["progress"])

    def test_refresh_after_a_control_action_emits_the_event(self):
        live_feed.tick(0.25)
        with mock_moonraker.use_printer("u1-workshop"):
            mock_moonraker.pause_print()
        state = live_feed.refresh("u1-workshop")
        self.assertEqual(state["state"], "paused")
        events = live_feed.events_since(0)
        self.assertEqual(events[-1]["event"], "paused")
        self.assertTrue(events[-1]["demo"])

    def test_no_side_effects_for_simulated_printers_unless_demo_is_in_use(self):
        automations.add_rule({"trigger": {"type": "state", "event": "paused"},
                              "action": {"type": "pause"}}, demo=True)
        live_feed.tick(0.25)
        with mock_moonraker.use_printer("u1-workshop"):
            mock_moonraker.pause_print()
        live_feed.refresh("u1-workshop")
        automations.wait_idle()
        self.assertEqual(automations.get_log(), [])

        live_feed.mark_demo_seen()
        with mock_moonraker.use_printer("u1-workshop"):
            mock_moonraker.resume_print()
        live_feed.refresh("u1-workshop")
        with mock_moonraker.use_printer("u1-workshop"):
            mock_moonraker.pause_print()
        live_feed.refresh("u1-workshop")
        automations.wait_idle()
        self.assertEqual(len(automations.get_log()), 1)

    def test_finish_produces_a_celebration_summary_and_timelapse(self):
        live_feed.mark_demo_seen()
        file_library.reset()
        file_library.add_samples()
        maintenance.reset_log()
        for t in maintenance.TASKS:
            maintenance.mark_done(t["id"])
        print_queue.reset()
        import printer_control
        with mock_moonraker.use_printer("u1-workshop"):
            mock_moonraker.cancel_print()
        live_feed.tick(0.25)
        with mock_moonraker.use_printer("u1-workshop"):
            printer_control.start_print("calibration_cube_20mm.gcode", confirmed=True)
            mock_moonraker.set_time_scale(60)
        live_feed.refresh("u1-workshop")
        self.assertTrue(timelapse.is_recording("u1-workshop"))
        for n in range(400):
            live_feed.tick(0.25, n)
            if live_feed.snapshot("u1-workshop")["state"]["state"] == "complete":
                break
        finished = [e for e in live_feed.events_since(0) if e.get("event") == "finished"]
        self.assertEqual(len(finished), 1)
        summary = finished[0]["summary"]
        self.assertEqual(summary["file"], "calibration_cube_20mm.gcode")
        self.assertGreater(summary["cost"]["total_cost"], 0)
        sessions = timelapse.sessions("u1-workshop")
        self.assertTrue(sessions[0]["finished"])
        self.assertGreater(sessions[0]["frames"], 5)
        file_library.reset()
        maintenance.reset_log()

    def test_climate_history_is_sampled(self):
        live_feed.tick(0.25)
        samples = live_feed.climate("u1-workshop")
        self.assertEqual(len(samples), 1)
        self.assertIn("chamber", samples[0])

    def test_fleet_snapshot_lists_every_printer(self):
        snap = live_feed.fleet_snapshot()
        self.assertEqual([p["id"] for p in snap["printers"]], mock_moonraker.printer_ids())
        garage = snap["printers"][2]
        self.assertTrue(any(a["level"] == "error" for a in garage["alerts"]))


if __name__ == "__main__":
    unittest.main()
