"""
Tests for the fleet command center in backend/fleet.py: broadcasting one
action to several printers, routing files between queues, and the farm's
history. The rule under test throughout: a broadcast that partly fails
says exactly which printers failed and why - never a blanket "done".
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import file_library    # noqa: E402
import fleet           # noqa: E402
import maintenance     # noqa: E402
import mock_moonraker  # noqa: E402
import print_queue     # noqa: E402
import sample_files    # noqa: E402


class FleetCommandTest(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_all()
        fleet.reset()
        print_queue.reset()
        file_library.reset()
        maintenance.reset_all_logs()

    def tearDown(self):
        mock_moonraker.reset_all()
        fleet.reset()
        print_queue.reset()
        file_library.reset()


class TestBroadcast(FleetCommandTest):
    def rows(self, result):
        return {r["printer"]: r for r in result["results"]}

    def test_partial_failure_names_each_printer(self):
        result = fleet.broadcast("pause")                   # only the workshop is printing
        rows = self.rows(result)
        self.assertTrue(rows["u1-workshop"]["ok"])
        self.assertEqual(rows["u1-workshop"]["confirmed_state"]["state"], "paused")
        self.assertEqual(rows["u1-studio"]["kind"], "refused")
        self.assertIn("Nothing is printing", rows["u1-garage"]["error"])
        self.assertFalse(result["all_ok"])
        self.assertEqual((result["ok_count"], result["failed_count"]), (1, 2))
        self.assertIn("U1 · Studio", result["headline"])
        self.assertNotIn("all", result["headline"].split(":")[1])

    def test_printer_failure_is_reported_as_the_printer_s(self):
        with mock_moonraker.use_printer("u1-studio"):
            mock_moonraker.fail_next("resume", "Klippy is shut down")
        rows = self.rows(fleet.broadcast("resume", ["u1-studio"]))
        self.assertEqual(rows["u1-studio"]["kind"], "printer_failed")
        self.assertIn("Klippy is shut down", rows["u1-studio"]["error"])
        with mock_moonraker.use_printer("u1-studio"):
            self.assertEqual(mock_moonraker.get_printer_state()["state"], "paused")

    def test_everything_confirmed_says_so(self):
        with mock_moonraker.use_printer("u1-workshop"):
            mock_moonraker.cancel_print()
        result = fleet.broadcast("home", ["u1-workshop", "u1-garage"])
        self.assertTrue(result["all_ok"])
        self.assertIn("all 2", result["headline"])

    def test_preheat_sets_every_chosen_target(self):
        for pid in ("u1-workshop", "u1-studio"):
            with mock_moonraker.use_printer(pid):
                mock_moonraker.cancel_print()
        result = fleet.broadcast("preheat", [], {"nozzle": 210, "bed": 65, "toolheads": "all"})
        self.assertTrue(result["all_ok"], result["headline"])
        for pid in mock_moonraker.printer_ids():
            with mock_moonraker.use_printer(pid):
                state = mock_moonraker.get_printer_state()
            self.assertEqual(state["bed_target"], 65.0)
            self.assertTrue(all(t["target_temperature"] == 210.0 for t in state["toolheads"].values()))

    def test_preheat_leaves_running_prints_alone(self):
        # On a real printer this would rewrite the running print's temperatures.
        rows = self.rows(fleet.broadcast("preheat", [], {"nozzle": 150, "bed": 40}))
        for pid in ("u1-workshop", "u1-studio"):
            self.assertEqual(rows[pid]["kind"], "refused")
            self.assertIn("preheat is for idle printers", rows[pid]["error"])
            with mock_moonraker.use_printer(pid):
                self.assertNotEqual(mock_moonraker.get_printer_state()["bed_target"], 40.0)
        self.assertTrue(rows["u1-garage"]["ok"])

    def test_homing_a_printer_mid_print_is_refused(self):
        # A real G28 mid-print drives the toolhead through the print.
        rows = self.rows(fleet.broadcast("home"))
        self.assertEqual(rows["u1-workshop"]["kind"], "refused")
        self.assertIn("Homing is refused", rows["u1-workshop"]["error"])
        self.assertTrue(rows["u1-garage"]["ok"])

    def test_preheat_validates_once_for_the_whole_request(self):
        with self.assertRaisesRegex(ValueError, "between 0 and 300"):
            fleet.broadcast("preheat", [], {"nozzle": 900})
        with self.assertRaisesRegex(ValueError, "Bed temperature must be between"):
            fleet.broadcast("preheat", [], {"bed": 200})
        with self.assertRaisesRegex(ValueError, "Give a nozzle or bed"):
            fleet.broadcast("preheat", [], {})

    def test_a_dropped_link_fails_that_printer_only(self):
        with mock_moonraker.use_printer("u1-garage"):
            mock_moonraker.set_link(False)
        rows = self.rows(fleet.broadcast("pause"))
        self.assertTrue(rows["u1-workshop"]["ok"])
        self.assertEqual(rows["u1-garage"]["kind"], "printer_failed")
        self.assertIn("network link", rows["u1-garage"]["error"])

    def test_registered_printer_is_not_connected_not_skipped(self):
        added = fleet.add("Bench U1", "http://192.168.1.50:7125")
        rows = self.rows(fleet.broadcast("home", [added["id"], "u1-garage"]))
        self.assertEqual(rows[added["id"]]["kind"], "not_connected")
        self.assertTrue(rows["u1-garage"]["ok"])

    def test_unknown_things_are_refused(self):
        with self.assertRaisesRegex(ValueError, "Unknown action"):
            fleet.broadcast("explode")
        with self.assertRaisesRegex(ValueError, "Unknown printer"):
            fleet.broadcast("home", ["nope"])


class TestRouting(FleetCommandTest):
    def setUp(self):
        super().setUp()
        file_library.add_samples()

    def test_send_a_file_to_another_printer_s_queue(self):
        result = fleet.route_file("calibration_cube_20mm.gcode", "u1-garage")
        self.assertEqual(result["to_name"], "U1 · Garage")
        self.assertEqual([i["filename"] for i in print_queue.get("u1-garage")["items"]],
                         ["calibration_cube_20mm.gcode"])

    def test_move_between_queues_keeps_the_item_on_refusal(self):
        item = print_queue.add("two_colour_coaster.gcode", printer_id="u1-studio")["items"][0]
        fleet.route_file(None, "u1-garage", "u1-studio", item["id"])
        self.assertEqual(print_queue.get("u1-studio")["items"], [])
        self.assertEqual(print_queue.get("u1-garage")["items"][0]["filename"], "two_colour_coaster.gcode")
        # A refused move (models can't be queued) leaves the source alone.
        with self.assertRaisesRegex(ValueError, "Only G-code"):
            fleet.route_file("dock_bracket.stl", "u1-workshop")
        moved = print_queue.get("u1-garage")["items"][0]
        with self.assertRaisesRegex(ValueError, "already on that printer"):
            fleet.route_file(None, "u1-garage", "u1-garage", moved["id"])

    def test_started_items_do_not_move(self):
        item = print_queue.add("calibration_cube_20mm.gcode", printer_id="u1-studio")["items"][0]
        data = print_queue._load()
        data["u1-studio"]["items"][0]["status"] = "started"
        print_queue._save(data)
        with self.assertRaisesRegex(ValueError, "Only waiting items"):
            fleet.route_file(None, "u1-garage", "u1-studio", item["id"])


class TestHistory(FleetCommandTest):
    def test_totals_are_the_sum_of_the_printers(self):
        h = fleet.history(days=90)
        farm = h["farm"]
        self.assertEqual(farm["prints"], sum(p["prints"] for p in h["printers"]))
        self.assertAlmostEqual(farm["grams"], sum(p["grams"] for p in h["printers"]), places=0)
        self.assertEqual(farm["completed"] + farm["error"] + farm["cancelled"], farm["prints"])
        self.assertAlmostEqual(farm["completion_rate"], farm["completed"] / farm["prints"], places=3)
        self.assertEqual(len(farm["series"]), 90)
        self.assertEqual(sum(b["completed"] for b in farm["series"]), farm["completed"])

    def test_matches_the_raw_history(self):
        with mock_moonraker.use_printer("u1-studio"):
            jobs = mock_moonraker.get_print_history()
        row = next(p for p in fleet.history(365)["printers"] if p["id"] == "u1-studio")
        self.assertEqual(row["prints"], len(jobs))
        self.assertEqual(row["error"], sum(1 for j in jobs if j["status"] == "error"))

    def test_weeks_and_empty_windows(self):
        weekly = fleet.history(28, "week")
        self.assertLessEqual(len(weekly["farm"]["series"]), 5)
        for bucket in weekly["farm"]["series"]:
            self.assertEqual(__import__("datetime").date.fromisoformat(bucket["bucket"]).weekday(), 0)
        one_day = fleet.history(1)
        for p in one_day["printers"]:
            if p["prints"] == 0:
                self.assertIsNone(p["completion_rate"])     # no prints: no rate, not 0%
        with self.assertRaises(ValueError):
            fleet.history(0)
        with self.assertRaises(ValueError):
            fleet.history(30, "month")

    def test_a_failed_print_shows_up(self):
        before = fleet.history(1)["farm"]["error"]
        with mock_moonraker.use_printer("u1-workshop"):
            mock_moonraker.inject_jam()
        self.assertEqual(fleet.history(1)["farm"]["error"], before + 1)

    def test_an_overnight_failure_counts_on_the_day_it_ended(self):
        # A print that has run 30 hours always started before today's
        # midnight, whatever time the test runs. It failed today, so it is
        # one of today's failures (it used to be missed before ~2 am).
        before = fleet.history(1)["farm"]["error"]
        with mock_moonraker.use_printer("u1-workshop") as printer:
            printer.live["print_duration_hours"] = 30.0
            mock_moonraker.inject_jam()
        self.assertEqual(fleet.history(1)["farm"]["error"], before + 1)

    def test_a_running_job_is_not_counted_as_a_failure(self):
        # Real Moonraker lists the job in progress with status "in_progress".
        before = fleet.history(1)["farm"]
        with mock_moonraker.use_printer("u1-workshop") as printer:
            printer.session_jobs.append({
                "job_id": "live-x", "filename": "a.gcode", "status": "in_progress",
                "start_time": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
                "end_time": None, "print_duration_hours": 0.5, "filament_used_grams": 3.0,
                "filament_type": "PLA", "filament_color_name": "Black", "filament_color_hex": "#000000",
                "toolheads_used": ["T0"]})
        after = fleet.history(1)["farm"]
        self.assertEqual(after["prints"], before["prints"])
        self.assertEqual(after["error"], before["error"])


class TestOverviewAlerts(FleetCommandTest):
    def test_lost_link_is_an_alert_and_the_row_is_labelled(self):
        with mock_moonraker.use_printer("u1-studio"):
            mock_moonraker.set_link(False)
        row = fleet.summary_for("u1-studio")
        self.assertTrue(row["link_lost"])
        self.assertTrue(any("No answer since" in a["text"] for a in row["alerts"]))


if __name__ == "__main__":
    unittest.main()
