"""Tests for backend/print_record.py - the record of every print (FLOW.4) - and how the live feed fills it."""

import json
import os
import sys
import time
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

import file_library    # noqa: E402
import live_feed       # noqa: E402
import maintenance     # noqa: E402
import mock_moonraker  # noqa: E402
import print_queue     # noqa: E402
import print_record    # noqa: E402
import timelapse       # noqa: E402

STATE = {"current_file": "bracket.gcode", "printer_name": "Bench", "active_toolhead": "T0",
         "toolheads": {"T0": {"filament_color_hex": "#ff0000", "filament_color_name": "Red", "filament_material": "PLA"}}}
JOB = {"filename": "bracket.gcode", "total_hours": 1.5, "filament_grams": 20.0, "material": "PLA",
       "required_filament": [{"toolhead": "T0", "expected_color_hex": "#ff0000", "expected_material": "PLA", "grams": 20.0}]}


class TestRecord(unittest.TestCase):
    def setUp(self):
        print_record.reset()
        self.addCleanup(print_record.reset)

    def test_a_print_opens_on_start_and_fills_in_on_the_end(self):
        entry = print_record.started("p1", "Bench", STATE, JOB, demo=False)
        self.assertEqual(entry["status"], "running")
        self.assertEqual(entry["estimated_hours"], 1.5)
        self.assertEqual(entry["heads"][0]["toolhead"], "T0")
        self.assertEqual(entry["heads"][0]["grams_in_file"], 20.0)
        ended = print_record.ended("p1", "finished", STATE, {"print_duration_hours": 1.25, "filament_used_grams": 19.4,
                                                             "filament_type": "PLA"}, {"total_cost": 0.52}, "session-1")
        self.assertEqual(ended["id"], entry["id"])
        self.assertEqual((ended["status"], ended["real_hours"], ended["grams"], ended["cost"], ended["timelapse"]),
                         ("finished", 1.25, 19.4, 0.52, "session-1"))
        rows = print_record.listing()["prints"]
        self.assertEqual([r["id"] for r in rows], [entry["id"]])

    def test_a_failed_print_keeps_why_it_stopped(self):
        print_record.started("p1", "Bench", STATE, JOB, demo=False)
        ended = print_record.ended("p1", "failed", {**STATE, "state_message": "Nozzle clogged"})
        self.assertEqual(ended["status"], "failed")
        self.assertEqual(ended["ended_because"], "Nozzle clogged")
        self.assertIsNotNone(ended["real_hours"])

    def test_an_end_with_no_start_is_still_recorded(self):
        ended = print_record.ended("p1", "cancelled", STATE, {"filename": "late.gcode", "print_duration_hours": 0.2})
        self.assertTrue(ended["joined_late"])
        self.assertEqual(ended["file"], "late.gcode")

    def test_demo_and_real_prints_never_mix(self):
        real = print_record.started("p1", "Bench", STATE, JOB, demo=False)
        fake = print_record.started("p2", "Demo printer 1", STATE, JOB, demo=True)
        self.assertEqual([r["id"] for r in print_record.listing(demo=False)["prints"]], [real["id"]])
        self.assertEqual([r["id"] for r in print_record.listing(demo=True)["prints"]], [fake["id"]])

    def test_search_notes_and_forget(self):
        a = print_record.started("p1", "Bench", STATE, JOB, demo=False)
        print_record.ended("p1", "finished", STATE)
        print_record.started("p1", "Bench", {**STATE, "current_file": "vase.gcode"}, {**JOB, "filename": "vase.gcode"}, False)
        print_record.set_note(a["id"], "Glued the bracket, stronger in PETG next time")
        self.assertEqual([r["id"] for r in print_record.listing(query="petg")["prints"]], [a["id"]])
        self.assertEqual(len(print_record.listing(query="vase")["prints"]), 1)
        self.assertEqual(len(print_record.listing(status="running")["prints"]), 1)
        print_record.forget(a["id"])
        with self.assertRaises(ValueError):
            print_record.get(a["id"])
        with self.assertRaises(ValueError):
            print_record.set_note("nope", "x")

    def test_the_printers_own_history_is_listed_once(self):
        mine = print_record.started("p1", "Bench", STATE, JOB, demo=False)
        print_record.ended("p1", "finished", STATE, {"print_duration_hours": 1.0})
        end = datetime.now().isoformat(timespec="seconds")
        history = [{"job_id": "0001", "filename": "bracket.gcode", "status": "completed", "start_time": end, "end_time": end},
                   {"job_id": "0002", "filename": "old.gcode", "status": "cancelled", "start_time": "2026-11-01T10:00:00",
                    "end_time": "2026-11-01T11:00:00", "print_duration_hours": 1.0, "toolheads_used": ["T1"]}]
        rows = print_record.listing(printer_history=history, printer_id="p1", printer_name="Bench")["prints"]
        self.assertEqual([r["id"] for r in rows], [mine["id"], "printer-0002"])
        self.assertTrue(rows[1]["from_printer"])
        self.assertEqual(rows[1]["status"], "cancelled")

    def test_the_record_keeps_the_chosen_time(self):
        entry = print_record.started("p1", "Bench", STATE, JOB, demo=False)
        print_record.ended("p1", "finished", STATE)
        with open(print_record._PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        data["prints"][0]["started_at"] = data["prints"][0]["ended_at"] = (datetime.now() - timedelta(days=40)).isoformat(timespec="seconds")
        with open(print_record._PATH, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        self.assertEqual(len(print_record.listing()["prints"]), 1)          # a year by default
        result = print_record.set_settings(30)
        self.assertEqual(result["removed"], 1)
        self.assertEqual(print_record.listing()["prints"], [])
        with self.assertRaises(ValueError):
            print_record.set_settings(7)
        self.assertEqual(print_record.settings()["keep_days"], 30)
        del entry

    def test_the_end_picture_is_kept_and_served(self):
        entry = print_record.started("p1", "Bench", STATE, JOB, demo=True)
        self.assertTrue(print_record.keep_picture(entry["id"], b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml"))
        data, kind = print_record.picture(entry["id"])
        self.assertEqual(kind, "image/svg+xml")
        with self.assertRaises(ValueError):
            print_record.picture("../../etc")


class TestLiveFeedFillsTheRecord(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_all()
        live_feed.reset()
        timelapse.reset()
        print_record.reset()

    def tearDown(self):
        mock_moonraker.reset_all()
        live_feed.reset()
        timelapse.reset()
        print_record.reset()
        file_library.reset()
        print_queue.reset()

    def test_a_demo_print_from_start_to_finish(self):
        live_feed.mark_demo_seen()
        file_library.reset()
        file_library.add_samples()
        maintenance.reset_log()
        for t in maintenance.TASKS:
            maintenance.mark_done(t["id"])
        import printer_control
        with mock_moonraker.use_printer("u1-workshop"):
            mock_moonraker.cancel_print()
        live_feed.tick(0.25)
        cancelled = print_record.listing(demo=True)["prints"]
        with mock_moonraker.use_printer("u1-workshop"):
            printer_control.start_print("3dbenchy_pla.gcode", confirmed=True)
            mock_moonraker.set_time_scale(60)
        live_feed.refresh("u1-workshop")
        running = print_record.listing(demo=True, status="running")["prints"]
        self.assertEqual([r["file"] for r in running], ["3dbenchy_pla.gcode"])
        started = [e for e in live_feed.events_since(0) if e.get("event") == "started"]
        self.assertEqual(started[-1]["record"], running[0]["id"])
        for n in range(400):
            live_feed.tick(0.25, n)
            if live_feed.snapshot("u1-workshop")["state"]["state"] == "complete":
                break
        finished = [e for e in live_feed.events_since(0) if e.get("event") == "finished"]
        entry = print_record.get(finished[0]["record"], demo=True)
        self.assertEqual(entry["status"], "finished")
        self.assertGreater(entry["grams"], 0)
        self.assertGreater(entry["cost"], 0)
        self.assertEqual(entry["timelapse"], timelapse.sessions("u1-workshop")[0]["session"])
        self.assertTrue(entry["demo"])
        for _ in range(40):                     # the end picture is taken in the background
            if print_record.get(entry["id"], demo=True).get("picture"):
                break
            time.sleep(0.05)
        self.assertEqual(print_record.get(entry["id"], demo=True)["picture"], "svg")
        self.assertEqual(print_record.listing(demo=False)["prints"], [])
        del cancelled


if __name__ == "__main__":
    unittest.main()
