"""Tests for backend/print_queue.py - every queued start goes through the gate."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import file_library    # noqa: E402
import maintenance     # noqa: E402
import mock_moonraker  # noqa: E402
import print_gate      # noqa: E402
import print_queue     # noqa: E402
import printer_control  # noqa: E402


class TestQueue(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_all()
        file_library.reset()
        file_library.add_samples()
        print_queue.reset()
        maintenance.reset_log()
        for task in maintenance.TASKS:
            maintenance.mark_done(task["id"])
        mock_moonraker.cancel_print()

    def tearDown(self):
        mock_moonraker.reset_all()
        file_library.reset()
        print_queue.reset()
        maintenance.reset_log()

    def test_add_move_remove(self):
        print_queue.add("3dbenchy_pla.gcode")
        q = print_queue.add("hex_coaster_three_colour.gcode")
        first, second = q["items"]
        q = print_queue.move(second["id"], "up")
        self.assertEqual(q["items"][0]["filename"], "hex_coaster_three_colour.gcode")
        q = print_queue.remove(first["id"])
        self.assertEqual(len(q["items"]), 1)
        with self.assertRaises(ValueError):
            print_queue.add("spur_gear_24t.stl")

    def test_clear_file_starts(self):
        print_queue.add("3dbenchy_pla.gcode")
        result = print_queue.start_next()
        self.assertEqual(result["started"]["filename"], "3dbenchy_pla.gcode")
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "printing")

    def test_blocked_file_is_held_with_the_reason(self):
        print_queue.add("unsafe_example_purge_past_bed.gcode")
        result = print_queue.start_next()
        self.assertIn("held", result)
        self.assertTrue(result["held"]["note"].startswith("Blocked"))
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "ready")

    def test_warnings_hold_until_confirmed(self):
        maintenance.reset_log()                     # brings back overdue tasks
        print_queue.add("3dbenchy_pla.gcode")
        held = print_queue.start_next()
        if "started" in held:                       # nothing overdue in this history
            return
        self.assertTrue(held["held"]["note"].startswith("Waiting for you to confirm"))
        started = print_queue.start_next(confirmed=True)
        self.assertIn("started", started)

    def test_auto_advance_after_a_finish(self):
        print_queue.add("3dbenchy_pla.gcode")
        print_queue.add("benchy_gear_vase_skip_one.gcode")
        print_queue.set_auto_advance(True)
        print_queue.start_next()
        mock_moonraker.set_time_scale(600)
        finished = None
        for _ in range(200):
            finished = mock_moonraker.advance(1.0) or finished
            if finished:
                break
        self.assertIsNotNone(finished)
        pid = mock_moonraker.selected_printer_id()
        result = print_queue.on_print_finished(pid, "3dbenchy_pla.gcode")
        # The finished part may still be on the bed: the next file waits for a person.
        self.assertTrue(result["bed_clear_needed"])
        self.assertTrue(result["held"]["note"].startswith("Waiting for the bed to be cleared after 3dbenchy_pla"))
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "complete")
        bed = print_queue.bed_state(pid)
        self.assertEqual((bed["state"], bed["file"]), ("awaiting_clear", "3dbenchy_pla.gcode"))
        cleared = print_queue.confirm_bed_clear(pid, bed["job_key"])
        self.assertEqual(cleared["next"]["started"]["filename"], "benchy_gear_vase_skip_one.gcode")
        statuses = [i["status"] for i in print_queue.get()["items"]]
        self.assertEqual(statuses, ["done", "started"])

    def test_nothing_starts_over_a_part_on_the_bed_not_even_by_hand(self):
        pid = mock_moonraker.selected_printer_id()
        print_queue.add("3dbenchy_pla.gcode")
        print_queue.print_ended(pid, "earlier.gcode", "failed")
        result = print_queue.start_next(confirmed=True)
        self.assertTrue(result["bed_clear_needed"])
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "ready")

    def test_a_confirmation_counts_only_for_the_print_it_names(self):
        pid = mock_moonraker.selected_printer_id()
        first = print_queue.print_ended(pid, "a.gcode")
        second = print_queue.print_ended(pid, "b.gcode")       # another print ended since
        with self.assertRaises(ValueError) as ctx:
            print_queue.confirm_bed_clear(pid, first["job_key"])
        self.assertIn("b.gcode", str(ctx.exception))
        self.assertEqual(print_queue.bed_state(pid)["state"], "awaiting_clear")
        print_queue.confirm_bed_clear(pid, second["job_key"])
        self.assertEqual(print_queue.bed_state(pid)["state"], "clear")
        with self.assertRaises(ValueError):
            print_queue.confirm_bed_clear(pid, second["job_key"])          # nothing to confirm now
        third = print_queue.print_ended(pid, "c.gcode")                    # and a new end needs a new one
        self.assertEqual(print_queue.bed_state(pid)["job_key"], third["job_key"])
        self.assertEqual(print_queue.bed_state(pid)["state"], "awaiting_clear")

    def test_the_hold_and_the_confirmation_are_kept_on_disk(self):
        import json
        pid = mock_moonraker.selected_printer_id()
        ended = print_queue.print_ended(pid, "a.gcode")
        on_disk = json.load(open(print_queue._PATH))[pid]["bed"]
        self.assertEqual((on_disk["state"], on_disk["job_key"]), ("awaiting_clear", ended["job_key"]))
        print_queue.confirm_bed_clear(pid, ended["job_key"])
        self.assertEqual(json.load(open(print_queue._PATH))[pid]["bed"]["cleared_for"], ended["job_key"])

    def test_a_print_started_another_way_means_the_bed_is_in_use(self):
        pid = mock_moonraker.selected_printer_id()
        print_queue.print_ended(pid, "a.gcode")
        print_queue.print_started(pid, "b.gcode")
        self.assertEqual(print_queue.bed_state(pid)["state"], "in_use")

    def test_beds_are_per_printer(self):
        print_queue.print_ended("u1-studio", "a.gcode")
        self.assertEqual(print_queue.bed_state("u1-garage")["state"], "clear")

    def test_queues_are_per_printer(self):
        print_queue.add("3dbenchy_pla.gcode")
        self.assertEqual(print_queue.get("u1-studio")["items"], [])


class TestConfirmPrintWaitsForTheBedTick(unittest.TestCase):
    """A print that ended on the bed may still be there: the start waits for the screen's tick (22 November 2026 live run)."""

    def setUp(self):
        mock_moonraker.reset_all()
        file_library.reset()
        file_library.add_samples()
        print_queue.reset()
        maintenance.reset_log()
        for task in maintenance.TASKS:
            maintenance.mark_done(task["id"])
        mock_moonraker.cancel_print()
        self.pid = mock_moonraker.selected_printer_id()

    def tearDown(self):
        mock_moonraker.reset_all()
        file_library.reset()
        print_queue.reset()

    def test_a_clear_bed_has_nothing_to_tick(self):
        gate = print_gate.summary("3dbenchy_pla.gcode")
        self.assertIsNone(gate["bed_check"])
        printer_control.start_print("3dbenchy_pla.gcode", confirmed=True)
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "printing")

    def test_a_cancelled_print_makes_the_start_wait_for_the_tick(self):
        print_queue.print_ended(self.pid, "3dbenchy_pla.gcode", "cancelled")
        gate = print_gate.summary("3dbenchy_pla.gcode")
        check = gate["bed_check"]
        self.assertEqual((check["file"], check["outcome"]), ("3dbenchy_pla.gcode", "cancelled"))
        self.assertEqual(check["leftover_box"], check["this_box"])
        self.assertTrue(check["overlaps"])
        self.assertTrue(any("sit where 3dbenchy_pla.gcode did" in w for w in gate["warnings"]), gate["warnings"])
        with self.assertRaises(printer_control.PrintBlocked) as ctx:
            printer_control.start_print("3dbenchy_pla.gcode", confirmed=True)
        self.assertIn("Tick that you looked at the bed", " ".join(ctx.exception.gate["warnings"]))
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "ready")
        printer_control.start_print("3dbenchy_pla.gcode", confirmed=True, bed_clear=True)
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "printing")

    def test_the_tick_alone_does_not_skip_a_blocked_print(self):
        print_queue.print_ended(self.pid, "earlier.gcode", "failed")
        data = file_library.read_bytes("3dbenchy_pla.gcode")
        mock_moonraker.upload_file("3dbenchy_pla.gcode", len(data), data)
        mock_moonraker.start_print("3dbenchy_pla.gcode", {})          # the printer is busy: the gate refuses
        with self.assertRaises(printer_control.PrintBlocked):
            printer_control.start_print("3dbenchy_pla.gcode", confirmed=True, bed_clear=True)

    def test_a_last_file_that_is_gone_still_needs_the_tick_and_draws_no_guess(self):
        print_queue.print_ended(self.pid, "gone-from-the-library.gcode", "failed")
        gate = print_gate.summary("3dbenchy_pla.gcode")
        self.assertIsNone(gate["bed_check"]["leftover_box"])
        self.assertFalse(gate["bed_check"]["overlaps"])
        with self.assertRaises(printer_control.PrintBlocked):
            printer_control.start_print("3dbenchy_pla.gcode", confirmed=True)

    def test_confirming_the_bed_removes_the_tick(self):
        ended = print_queue.print_ended(self.pid, "3dbenchy_pla.gcode", "finished")
        print_queue.confirm_bed_clear(self.pid, ended["job_key"])
        self.assertIsNone(print_gate.summary("3dbenchy_pla.gcode")["bed_check"])


if __name__ == "__main__":
    unittest.main()
