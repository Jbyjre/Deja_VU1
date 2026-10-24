"""
Regression tests for defects found in the October 2026 code audit. Each
test names the failure it guards against.

    python3 -m unittest tests.test_audit_fixes
"""

import io
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import app as dv_app         # noqa: E402
import color_check           # noqa: E402
import gcode_tools           # noqa: E402
import led_status            # noqa: E402
import live_feed             # noqa: E402
import maintenance           # noqa: E402
import pairing               # noqa: E402
import updates               # noqa: E402


class FileMetadataIsSanitised(unittest.TestCase):

    def test_only_real_hex_colours_survive(self):
        # A colour ends up in a style attribute in the browser; a url(...)
        # tacked onto it would make the page fetch an outside address.
        meta = gcode_tools.parse_metadata(
            "; filament_colour = #ff0000 url(http://x/y);#00FF00;#0000ffcc;red\nG28\n")
        self.assertEqual(meta["filament_colours"], ["#00FF00", "#0000ffcc"])


class UploadsCutOffPartWay(unittest.TestCase):

    def test_half_a_file_is_not_saved(self):
        handler = object.__new__(dv_app.DejaVuHandler)
        handler.headers = {"Content-Length": "10"}
        handler.rfile = io.BytesIO(b"abc")          # the browser left after 3 of 10 bytes
        with self.assertRaises(dv_app._Gone):
            handler._read_raw_body()

    def test_a_whole_file_is_read(self):
        handler = object.__new__(dv_app.DejaVuHandler)
        handler.headers = {"Content-Length": "3"}
        handler.rfile = io.BytesIO(b"abc")
        self.assertEqual(handler._read_raw_body(), b"abc")


class GarbledRequestLine(unittest.TestCase):

    def test_logging_before_the_path_is_known_does_not_crash(self):
        # https:// sent to this plain-HTTP port is logged before self.path exists.
        handler = object.__new__(dv_app.DejaVuHandler)
        handler.command = None
        with mock.patch("sys.stderr", new=io.StringIO()):
            handler.log_message("%s", "bad request")


class PairingCodeAndTheDeviceLimit(unittest.TestCase):

    def setUp(self):
        pairing.reset()
        self.addCleanup(pairing.reset)

    def test_a_refused_correct_code_still_works_after_unpairing(self):
        code = pairing.generate_code()["code"]
        full = [{"id": f"device-{i}", "name": "x", "paired_at": ""} for i in range(pairing.MAX_DEVICES)]
        with mock.patch.object(pairing, "_load_devices", return_value=full):
            with self.assertRaises(ValueError):
                pairing.redeem_code(code, "Phone")
        with mock.patch.object(pairing, "_load_devices", return_value=full[:-1]), \
                mock.patch.object(pairing, "_save_devices"):
            device = pairing.redeem_code(code, "Phone")
        self.assertEqual(device["name"], "Phone")


class UpdateCheckerWithNoUpdateManager(unittest.TestCase):

    def test_the_printers_note_is_passed_on(self):
        note = "This printer's Moonraker has no update manager switched on"
        with mock.patch.object(updates.mock_moonraker, "get_update_status",
                               return_value={"packages": [], "note": note}):
            status = updates.get_status()
        self.assertEqual(status["note"], note)
        self.assertEqual(status["updates_available"], 0)


class DockRingOnAFault(unittest.TestCase):

    def test_a_faulted_head_that_has_cooled_shows_the_fault(self):
        ring = led_status.decide_ring_state("T0", {"status": "active", "temperature": 120},
                                            {"state": "error", "progress": 0.4})
        self.assertEqual(ring["state"], "error")

    def test_a_cold_head_on_a_printing_printer_is_still_heating(self):
        ring = led_status.decide_ring_state("T0", {"status": "active", "temperature": 120},
                                            {"state": "printing", "progress": 0.0})
        self.assertEqual(ring["state"], "heating")


class ColourCheckWithoutColoursInTheFile(unittest.TestCase):

    def test_no_colour_metadata_is_nothing_to_check_not_a_crash(self):
        job = {"filename": "cura.gcode", "required_filament": [
            {"toolhead": "T0", "expected_color_hex": None, "expected_color_name": None,
             "expected_material": "PLA"}]}
        with mock.patch.object(color_check, "get_current_job_requirements", return_value=job), \
                mock.patch.object(color_check.mock_moonraker, "is_real", return_value=False):
            result = color_check.check_current_job()
        self.assertEqual(result["checks"], [])
        self.assertEqual(result["overall"], "nothing_to_check")


class NoFalseStartWhenAPrinterFirstAnswers(unittest.TestCase):

    def setUp(self):
        live_feed.reset()
        self.addCleanup(live_feed.reset)
        patcher = mock.patch.object(live_feed, "demo_active", return_value=False)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_print_already_running_when_the_printer_answers_is_not_started(self):
        live_feed._detect("u1-garage", {"state": "error", "never_connected": True})
        events, _, _ = live_feed._detect("u1-garage", {"state": "printing", "current_file": "a.gcode"})
        self.assertEqual(events, [])

    def test_a_real_start_is_still_announced(self):
        live_feed._detect("u1-garage", {"state": "ready"})
        events, _, _ = live_feed._detect("u1-garage", {"state": "printing", "current_file": "a.gcode"})
        self.assertEqual(events, ["started"])


class RealPrinterMaintenanceStartingPoint(unittest.TestCase):
    """A real printer's maintenance log must start from its loaded history."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "maintenance_log.printer-test.json")
        for target, value in ((maintenance, "_log_path"),):
            patcher = mock.patch.object(target, value, return_value=self.path)
            patcher.start()
            self.addCleanup(patcher.stop)
        real = mock.patch.object(maintenance.mock_moonraker, "is_real", return_value=True)
        real.start()
        self.addCleanup(real.stop)

    def test_nothing_is_saved_before_the_history_has_loaded(self):
        with mock.patch.object(maintenance.mock_moonraker, "history_loaded", return_value=False), \
                mock.patch.object(maintenance, "get_print_history", return_value=[]):
            maintenance._load_log()
        self.assertFalse(os.path.exists(self.path))

    def test_counting_starts_at_the_printers_current_totals(self):
        jobs = [{"print_duration_hours": 5.0, "filament_used_grams": 10.0, "status": "completed",
                 "start_time": "2026-01-0%dT10:00:00" % (i + 1)} for i in range(2)]
        with mock.patch.object(maintenance.mock_moonraker, "history_loaded", return_value=True), \
                mock.patch.object(maintenance, "get_print_history", return_value=jobs):
            log = maintenance._load_log()
        self.assertTrue(os.path.exists(self.path))
        for entry in log["tasks"].values():
            self.assertEqual(entry["hours_at_last_done"], 10.0)
            self.assertEqual(entry["prints_at_last_done"], 2)


if __name__ == "__main__":
    unittest.main()


class TestHeaterFaultRing(unittest.TestCase):
    """A heater fault marks its own head, so that head's dock ring shows the fault, not "ready"."""

    def setUp(self):
        import mock_moonraker
        mock_moonraker.reset_all()
        self.addCleanup(mock_moonraker.reset_all)

    def test_the_faulty_heads_ring_reads_error_until_cleared(self):
        import led_status
        import mock_moonraker
        mock_moonraker.inject_heater_fault("T1")
        rings = led_status.get_all_ring_states()
        states = rings.get("rings", rings)
        states = {r["toolhead"]: r["state"] for r in states} if isinstance(states, list) else states
        self.assertEqual(states["T1"], "error")
        mock_moonraker.clear_error()
        self.assertEqual(mock_moonraker.get_printer_state()["toolheads"]["T1"]["status"], "docked")


class TestFirmwareRestart(unittest.TestCase):
    """Clearing an error (FIRMWARE_RESTART) is reachable, and only when there is an error."""

    def setUp(self):
        import mock_moonraker
        mock_moonraker.reset_all()
        self.addCleanup(mock_moonraker.reset_all)

    def test_refused_unless_the_printer_reports_an_error(self):
        import printer_control
        with self.assertRaisesRegex(ValueError, "isn't reporting an error"):
            printer_control.clear_error()          # the demo printer is mid-print

    def test_an_errored_printer_comes_back(self):
        import mock_moonraker
        import printer_control
        mock_moonraker.inject_jam("T0")
        self.assertEqual(mock_moonraker.get_printer_state()["state"], "error")
        self.assertEqual(printer_control.clear_error()["state"], "ready")
