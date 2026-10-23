"""Tests for backend/print_gate.py and the start-print interlock in printer_control.py."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import file_library     # noqa: E402
import maintenance      # noqa: E402
import mock_moonraker   # noqa: E402
import print_gate       # noqa: E402
import printer_control  # noqa: E402


class GateCase(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_all()
        file_library.reset()
        file_library.add_samples()
        maintenance.reset_log()

    def tearDown(self):
        mock_moonraker.reset_all()
        file_library.reset()
        maintenance.reset_log()


class TestGate(GateCase):
    def test_busy_printer_blocks(self):
        gate = print_gate.summary("3dbenchy_pla.gcode")
        self.assertEqual(gate["verdict"], "blocked")
        self.assertTrue(any("busy" in r for r in gate["blocking"]))

    def test_preflight_errors_block(self):
        mock_moonraker.cancel_print()
        gate = print_gate.summary("unsafe_example_purge_past_bed.gcode")
        self.assertEqual(gate["verdict"], "blocked")
        self.assertTrue(any("Pre-flight" in r for r in gate["blocking"]))

    def test_wrong_colour_blocks(self):
        with mock_moonraker.use_printer("u1-garage"):
            mock_moonraker.load_filament("T0", 1)          # White, where the cube wants orange
            gate = print_gate.summary("3dbenchy_pla.gcode")
        self.assertEqual(gate["verdict"], "blocked")
        self.assertEqual(gate["filament"][0]["status"], "mismatch")

    def test_the_demo_tour_can_really_print_a_sample(self):
        # The idle demo printer has what the sample files were sliced for,
        # so "Files -> Add sample files -> Print..." ends in a started print.
        with mock_moonraker.use_printer("u1-garage"):
            gate = print_gate.summary("3dbenchy_pla.gcode")
            self.assertEqual(gate["verdict"], "confirm", gate["blocking"])
            self.assertEqual(print_gate.summary("hex_coaster_three_colour.gcode")["verdict"], "confirm")
            state = printer_control.start_print("benchy_gear_vase_skip_one.gcode", confirmed=True)
            self.assertEqual(state["state"], "printing")
            # The file's own object labels arrive as the printer's plate, ready to skip one.
            self.assertEqual(len(state["objects"]["list"]), 3)
            skipped = printer_control.exclude_object("SPUR_GEAR.STL_ID_1_COPY_0")
            self.assertEqual(skipped["objects"]["excluded"], ["SPUR_GEAR.STL_ID_1_COPY_0"])

    def test_matching_file_needs_only_a_confirm_for_overdue_maintenance(self):
        mock_moonraker.cancel_print()
        gate = print_gate.summary("3dbenchy_pla.gcode")
        self.assertEqual(gate["filament"][0]["status"], "match")
        overdue = maintenance.get_status()["summary"]["overdue"]
        self.assertEqual(gate["verdict"], "confirm" if overdue else "clear")
        self.assertGreater(gate["cost"]["total_cost"], 0)
        self.assertIn("score", gate["health"])

    def test_clear_when_everything_is_fine(self):
        mock_moonraker.cancel_print()
        for task in maintenance.TASKS:
            maintenance.mark_done(task["id"])
        gate = print_gate.summary("3dbenchy_pla.gcode")
        self.assertEqual(gate["verdict"], "clear")
        self.assertEqual(gate["health"]["score"], 100)

    def test_models_cannot_be_printed(self):
        with self.assertRaises(ValueError):
            print_gate.summary("spur_gear_24t.stl")


class TestHealth(unittest.TestCase):
    def test_deductions_are_listed_and_add_up(self):
        maint = {"tasks": [{"status": "overdue"}, {"status": "due_soon"}]}
        rows = [{"toolhead": "T0", "status": "mismatch"}]
        pre = {"errors": [1], "warnings": [1, 2]}
        h = print_gate.health(pre, rows, maint)
        self.assertEqual(h["score"], 100 - 15 - 5 - 35 - 40 - 16 if 100 - 111 > 0 else 0)
        self.assertEqual(h["band"], "poor")
        self.assertEqual(len(h["deductions"]), 5)


class TestInterlock(GateCase):
    def test_blocked_print_never_starts(self):
        mock_moonraker.cancel_print()
        with self.assertRaises(printer_control.PrintBlocked):
            printer_control.start_print("unsafe_example_purge_past_bed.gcode", confirmed=True)
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "ready")

    def test_warnings_need_confirmation(self):
        mock_moonraker.cancel_print()
        with self.assertRaises(printer_control.PrintBlocked) as ctx:
            printer_control.start_print("3dbenchy_pla.gcode")
        self.assertEqual(ctx.exception.gate["verdict"], "confirm")
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "ready")

    def test_confirmed_start_uploads_then_prints_the_file(self):
        mock_moonraker.cancel_print()
        state = printer_control.start_print("3dbenchy_pla.gcode", confirmed=True)
        self.assertEqual(state["state"], "printing")
        self.assertEqual(state["current_file"], "3dbenchy_pla.gcode")
        kinds = [e["kind"] for e in mock_moonraker.get_console_log()]
        self.assertEqual(kinds[:2], ["start", "upload"])        # newest first
        self.assertEqual(mock_moonraker.get_current_job()["layers"], 240)

    def test_printer_failure_is_raised_not_hidden(self):
        mock_moonraker.cancel_print()
        mock_moonraker.fail_next("start", "Klippy is shutdown")
        with self.assertRaises(mock_moonraker.PrinterCommandError):
            printer_control.start_print("3dbenchy_pla.gcode", confirmed=True)
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "ready")


if __name__ == "__main__":
    unittest.main()
