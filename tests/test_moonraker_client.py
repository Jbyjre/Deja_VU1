"""
Contract tests for backend/moonraker_client.py - the real printer connection.

There is no physical printer here, so these check the client against
Moonraker's own contract instead: replies copied from Moonraker's
documentation (docs/external_api/*.md at Arksine/moonraker 1cfb0c4) and a
stand-in server (fake_moonraker.py) whose every behaviour is taken from
Moonraker's, Klipper's and Snapmaker's U1 source. They talk over real
sockets: real HTTP, a real WebSocket handshake, masked frames, JSON-RPC.
"""

import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import moonraker_client as mc      # noqa: E402
from fake_moonraker import FakeMoonraker, history_job   # noqa: E402

# history.md, "Get job list" example response (auxiliary data trimmed).
DOC_HISTORY_JOB = {
    "job_id": "000001", "exists": True, "end_time": 1615764265.6493807, "filament_used": 7.83,
    "filename": "test/history_test.gcode", "metadata": {}, "print_duration": 18.37201827496756,
    "status": "completed", "start_time": 1615764496.622146, "total_duration": 18.37201827496756,
    "user": "testuser", "auxiliary_data": [],
}

# file_manager.md, metadata example (upstream Moonraker, PrusaSlicer file).
DOC_METADATA = {
    "size": 1629418, "modified": 1706359465.4947228, "slicer": "PrusaSlicer", "object_height": 8,
    "estimated_time": 5947, "nozzle_diameter": 0.4, "layer_height": 0.2, "first_layer_height": 0.2,
    "first_layer_extr_temp": 215, "first_layer_bed_temp": 60, "filament_name": "Generic PLA Brown",
    "filament_type": "PLA", "filament_total": 9159.55, "filament_weight_total": 27.32,
}

# update_manager.md, "Get update status" example (two entries).
DOC_UPDATE_STATUS = {
    "busy": False, "version_info": {
        "system": {"name": "system", "configured_type": "system", "package_count": 4,
                   "package_list": ["libtiff5"]},
        "moonraker": {"name": "moonraker", "version": "v0.7.1-364", "remote_version": "v0.7.1-364",
                      "is_valid": True},
        "mainsail": {"name": "mainsail", "version": "v2.1.1", "remote_version": "v2.2.0", "is_valid": True},
    }}


def fast(test):
    """Shrink the client's waits so the suite stays quick."""
    saved = {k: getattr(mc, k) for k in ("PING_INTERVAL", "DEAD_AFTER", "STATE_WAIT", "START_WAIT", "KLIPPY_RETRY")}
    mc.PING_INTERVAL, mc.DEAD_AFTER, mc.STATE_WAIT, mc.START_WAIT, mc.KLIPPY_RETRY = 0.2, 1.5, 2.0, 2.0, 0.2
    test.addCleanup(lambda: [setattr(mc, k, v) for k, v in saved.items()])


def wait_for(check, seconds=5.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return True
        time.sleep(0.05)
    return False


# ---------------------------------------------------------------------------
# Translation, from documented replies
# ---------------------------------------------------------------------------

class TestHistoryTranslation(unittest.TestCase):
    def test_the_documented_example(self):
        job = mc.translate_history_job(DOC_HISTORY_JOB)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["filename"], "test/history_test.gcode")
        self.assertAlmostEqual(job["print_duration_hours"], 18.372 / 3600, places=4)
        # 7.83 mm of 1.75 mm PLA-density filament, and no slicer weight: estimated.
        self.assertTrue(job["filament_grams_estimated"])
        self.assertAlmostEqual(job["filament_used_grams"], 0.0, places=1)
        self.assertRegex(job["start_time"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$")
        for key in ("job_id", "end_time", "filament_type", "filament_color_name", "filament_color_hex",
                    "toolheads_used"):
            self.assertIn(key, job)

    def test_millimetres_become_grams_from_the_slicer_weight(self):
        raw = history_job(1, filament_mm=1000.0, meta={"filament_type": "PETG", "filament_total": 2000.0,
                                                       "filament_weight_total": 6.0})
        job = mc.translate_history_job(raw)
        self.assertEqual(job["filament_used_grams"], 3.0)     # half the length -> half the weight
        self.assertFalse(job["filament_grams_estimated"])
        self.assertEqual(job["filament_type"], "PETG")

    def test_the_running_job_is_left_out(self):
        self.assertIsNone(mc.translate_history_job(history_job(1, status="in_progress")))

    def test_aborted_statuses_are_failures_and_keep_their_reason(self):
        for status in ("klippy_shutdown", "klippy_disconnect", "interrupted", "server_exit"):
            job = mc.translate_history_job(history_job(1, status=status))
            self.assertEqual(job["status"], "error")
            self.assertEqual(job["status_detail"], status)
        self.assertEqual(mc.translate_history_job(history_job(1, status="cancelled"))["status"], "cancelled")

    def test_an_interrupted_job_without_an_end_time_still_has_one(self):
        job = mc.translate_history_job(history_job(1, status="interrupted", start=1_700_000_000, duration=600))
        self.assertIsNotNone(job["end_time"])

    def test_garbage_entries_do_not_crash(self):
        for bad in (None, 3, {}, {"status": "completed"}, {"start_time": "yesterday"},
                    {"start_time": 1e20, "status": "completed", "metadata": "x"}):
            mc.translate_history_job(bad)


class TestMetadata(unittest.TestCase):
    def test_upstream_moonraker_fields(self):
        meta = {"filament_type": "PLA;PETG", "filament_colors": ["#FF0000", "#00ff00"],
                "referenced_tools": [0, 1], "filament_weights": [1.5, 2.5]}
        req = mc.filament_from_metadata(meta)
        self.assertEqual([r["toolhead"] for r in req], ["T0", "T1"])
        self.assertEqual(req[1]["expected_color_hex"], "#00FF00")
        self.assertEqual(req[1]["expected_material"], "PETG")

    def test_the_u1_forks_fields(self):
        # u1-moonraker metadata.py: filament_colour is the raw "; filament_colour = ..." string,
        # filament_weight the per-filament grams; no referenced_tools.
        meta = {"filament_type": "PLA;PLA;PETG", "filament_colour": "#F26A1B;#FFFFFF;#1C1C1E",
                "filament_weight": [4.2, 0.0, 1.1], "layer_count": 120}
        req = mc.filament_from_metadata(meta)
        self.assertEqual([r["toolhead"] for r in req], ["T0", "T2"])   # T1's weight is 0: unused
        self.assertEqual(req[1]["expected_color_hex"], "#1C1C1E")
        self.assertEqual(mc.job_from_metadata("a.gcode", meta)["layers"], 120)

    def test_the_documented_example(self):
        job = mc.job_from_metadata("hook.gcode", DOC_METADATA)
        self.assertAlmostEqual(job["total_hours"], 5947 / 3600, places=3)
        self.assertEqual(job["filament_grams"], 27.32)
        self.assertEqual(job["material"], "PLA")
        self.assertEqual(job["layer_height"], 0.2)


class TestStateTranslation(unittest.TestCase):
    EXTRUDERS = {"T0": "extruder", "T1": "extruder1", "T2": "extruder2", "T3": "extruder3"}

    def ctx(self, **extra):
        return {"printer_id": "p1", "name": "U1", "extruders": self.EXTRUDERS, "chamber": None, **extra}

    def fake_status(self):
        f = FakeMoonraker()
        self.addCleanup(f.close)
        return f.status

    def test_klipper_states_become_the_dashboards(self):
        status = self.fake_status()
        for raw, expected in (("standby", "ready"), ("printing", "printing"), ("paused", "paused"),
                              ("complete", "complete"), ("cancelled", "ready"), ("error", "error")):
            status["print_stats"]["state"] = raw
            self.assertEqual(mc.translate_state(status, self.ctx())["state"], expected, raw)

    def test_a_state_klipper_might_add_later_is_an_error_not_a_guess(self):
        status = self.fake_status()
        status["print_stats"]["state"] = "calibrating"
        state = mc.translate_state(status, self.ctx())
        self.assertEqual(state["state"], "error")
        self.assertIn("calibrating", state["state_message"])

    def test_klipper_shut_down_is_an_error_with_its_message(self):
        status = self.fake_status()
        status["webhooks"] = {"state": "shutdown", "state_message": "MCU 'mcu' shutdown: Timer too close"}
        status["print_stats"]["state"] = "printing"
        state = mc.translate_state(status, self.ctx())
        self.assertEqual(state["state"], "error")
        self.assertIn("Timer too close", state["state_message"])

    def test_the_u1_reports_what_each_head_has_loaded(self):
        state = mc.translate_state(self.fake_status(), self.ctx())
        t0, t2 = state["toolheads"]["T0"], state["toolheads"]["T2"]
        self.assertEqual(t0["filament_color_hex"], "#F26A1B")
        self.assertTrue(t0["filament_loaded"])
        self.assertEqual(t0["status"], "active")                       # its dock sensor says ACTIVATE
        self.assertEqual(state["active_toolhead"], "T0")
        # "NONE" is print_task_config's default: nothing known, so no colour is made up.
        self.assertFalse(t2["filament_known"])
        self.assertIsNone(t2["filament_color_hex"])
        self.assertFalse(t2["filament_loaded"])

    def test_a_generic_klipper_printer_says_unknown_not_empty(self):
        status = self.fake_status()
        del status["print_task_config"]
        state = mc.translate_state(status, self.ctx())
        self.assertIsNone(state["toolheads"]["T0"]["filament_loaded"])
        self.assertIsNone(state["toolheads"]["T0"]["filament_color_hex"])

    def test_the_layer_is_estimated_from_the_nozzle_height_when_klipper_doesnt_know(self):
        status = self.fake_status()
        status["print_stats"]["state"] = "printing"
        status["gcode_move"]["gcode_position"] = [0, 0, 2.2, 0]        # 0.2 first + 10 x 0.2
        job = {"layers": 100, "layer_height": 0.2, "first_layer_height": 0.2}
        state = mc.translate_state(status, self.ctx(job=job))
        self.assertEqual(state["layer"], {"current": 11, "total": 100, "estimated": True})
        status["print_stats"]["info"] = {"total_layer": 50, "current_layer": 7}
        self.assertEqual(mc.translate_state(status, self.ctx(job=job))["layer"], {"current": 7, "total": 50})

    def test_the_filament_mapping_is_reported_when_it_isnt_one_to_one(self):
        status = self.fake_status()
        self.assertNotIn("extruder_map", mc.translate_state(status, self.ctx()))
        status["print_task_config"]["extruder_map_table"] = [2, 1, 0, 3] + [0] * 28
        self.assertEqual(mc.translate_state(status, self.ctx())["extruder_map"], {"T0": "T2", "T2": "T0"})

    def test_every_key_the_dashboard_reads_is_present(self):
        import mock_moonraker
        simulated = mock_moonraker.get_printer_state()
        real = mc.translate_state(self.fake_status(), self.ctx())
        self.assertLessEqual(set(simulated) - {"printer_id", "printer_name"}, set(real))
        self.assertLessEqual(set(next(iter(simulated["toolheads"].values()))),
                             set(real["toolheads"]["T0"]))


class TestSmallPieces(unittest.TestCase):
    def test_u1_json_coded_errors_are_readable(self):
        self.assertEqual(mc.clean_error('{"coded":"0001-0523-0000-0006", "msg":"extruder1 not configured"}'),
                         "extruder1 not configured (code 0001-0523-0000-0006)")
        self.assertEqual(mc.clean_error("!! Must home axis first: 0.000 0.000"), "Must home axis first: 0.000 0.000")

    def test_update_status(self):
        packages = mc.packages_from_update_status(DOC_UPDATE_STATUS)["packages"]
        self.assertEqual([p["name"] for p in packages], ["mainsail", "moonraker"])   # "system" has no version
        self.assertTrue(packages[0]["update_available"])
        self.assertFalse(packages[1]["update_available"])

    def test_toolhead_names(self):
        self.assertEqual(mc.extruder_for("T0"), "extruder")
        self.assertEqual(mc.extruder_for("T3"), "extruder3")
        self.assertEqual(mc.toolhead_for("extruder2"), "T2")
        self.assertIsNone(mc.toolhead_for("extruder_stepper belt"))

    def test_bad_addresses_are_refused_up_front(self):
        for bad in ("", "192.168.1.5", "ftp://x", "http://", "http://host:99999"):
            with self.assertRaises(ValueError):
                mc.Endpoint(bad)


# ---------------------------------------------------------------------------
# Over the wire
# ---------------------------------------------------------------------------

class WireTest(unittest.TestCase):
    fake_kwargs = {}

    def setUp(self):
        fast(self)
        self.fake = FakeMoonraker(**self.fake_kwargs)
        self.addCleanup(self.fake.close)
        self.changes = []
        self.printer = self.connect()

    def connect(self, **kwargs):
        printer = mc.MoonrakerPrinter("p1", "Test U1", self.fake.url, on_change=self.changes.append, **kwargs)
        printer.start()
        self.addCleanup(printer.stop)
        return printer

    def wait_connected(self, printer=None):
        self.assertTrue(wait_for((printer or self.printer).is_connected),
                        (printer or self.printer).diagnostics()["last_error"])


class TestConnecting(WireTest):
    def test_connects_subscribes_and_reads_the_printer(self):
        self.wait_connected()
        state = self.printer.snapshot()
        self.assertEqual(state["state"], "ready")
        self.assertEqual(sorted(state["toolheads"]), ["T0", "T1", "T2", "T3"])
        self.assertEqual(state["chamber_temperature"], 31.5)
        self.assertTrue(state["real"])
        diag = self.printer.diagnostics()
        self.assertIn("print_task_config", diag["objects_subscribed"])
        self.assertTrue(any(e["method"] == "printer.objects.subscribe" for e in diag["log"]))

    def test_a_status_update_changes_only_what_it_names(self):
        self.wait_connected()
        self.fake.set("extruder1", temperature=180.0)
        self.assertTrue(wait_for(lambda: self.printer.snapshot()["toolheads"]["T1"]["temperature"] == 180.0))
        # The fake sent just that one field - and nothing else was forgotten.
        self.assertEqual(self.fake.sent_notifications[-1], {"extruder1": {"temperature": 180.0}})
        state = self.printer.snapshot()
        self.assertEqual(state["bed_temperature"], 24.0)
        self.assertEqual(state["toolheads"]["T0"]["filament_color_hex"], "#F26A1B")

    def test_history_is_read_in_pages_oldest_first(self):
        self.fake.history = [history_job(i, start=1_700_000_000 + i * 60) for i in range(1, 1201)]
        self.fake.history.append(history_job(1201, status="in_progress", start=1_700_100_000))
        self.wait_connected()
        self.assertTrue(wait_for(lambda: len(self.printer.get_print_history()) == 1200, 10))
        jobs = self.printer.get_print_history()
        self.assertEqual(jobs[0]["job_id"], "000001")
        self.assertEqual(jobs[-1]["job_id"], "0004B0")
        pages = [p for m, p in self.fake.requests if p == "/server/history/list"]
        self.assertGreaterEqual(len(pages), 3)                 # 1201 jobs, 500 a page

    def test_a_klipper_restart_is_reported_and_recovered(self):
        self.wait_connected()
        self.fake.klippy_disconnect()
        self.assertTrue(wait_for(lambda: self.printer.snapshot()["state"] == "error"))
        self.assertIn("Klipper", self.printer.snapshot()["state_message"])
        self.fake.klippy_ready()
        self.assertTrue(wait_for(lambda: self.printer.snapshot()["state"] == "ready"))
        # ...and it subscribed again, so updates flow once more.
        self.fake.set("heater_bed", temperature=55.0)
        self.assertTrue(wait_for(lambda: self.printer.snapshot()["bed_temperature"] == 55.0))

    def test_a_dropped_connection_comes_back_and_keeps_the_last_reading_meanwhile(self):
        self.wait_connected()
        self.fake.drop_websockets()
        self.assertTrue(wait_for(lambda: self.printer.snapshot().get("link_lost")))
        self.assertEqual(self.printer.snapshot()["toolheads"]["T0"]["filament_color_hex"], "#F26A1B")
        self.assertTrue(wait_for(self.printer.is_connected, 8))
        self.assertNotIn("link_lost", self.printer.snapshot())

    def test_a_silent_connection_is_noticed_and_reopened(self):
        self.wait_connected()
        self.fake.answer_pings = False
        self.assertTrue(wait_for(lambda: not self.printer.is_connected(), 6))
        self.fake.answer_pings = True
        self.assertTrue(wait_for(self.printer.is_connected, 10))


class TestCommands(WireTest):
    def setUp(self):
        super().setUp()
        self.wait_connected()

    def printing(self, name="cube.gcode"):
        self.fake.files[name] = b"G28\n"
        self.fake.begin_print(name)
        self.assertTrue(wait_for(lambda: self.printer.snapshot()["state"] == "printing"))

    def test_pause_resume_cancel_are_read_back(self):
        self.printing()
        self.assertEqual(self.printer.pause_print()["state"], "paused")
        # RESUME only schedules the print; the client waits for "printing".
        self.assertEqual(self.printer.resume_print()["state"], "printing")
        state = self.printer.cancel_print()
        self.assertEqual(state["state"], "ready")
        self.assertIsNone(state["current_file"])

    def test_pausing_an_idle_printer_is_refused_before_anything_is_sent(self):
        # Klipper would answer "ok" and set is_paused on an idle printer.
        with self.assertRaises(ValueError):
            self.printer.pause_print()
        self.assertNotIn(("POST", "/printer/print/pause"), self.fake.requests)

    def test_pausing_a_paused_printer_says_so_and_sends_nothing(self):
        self.printing()
        self.printer.pause_print()
        sent = self.fake.requests.count(("POST", "/printer/print/pause"))
        with self.assertRaisesRegex(ValueError, "^Print already paused$"):
            self.printer.pause_print()
        self.assertEqual(self.fake.requests.count(("POST", "/printer/print/pause")), sent)

    def test_start_uploads_with_a_checksum_then_waits_for_printing(self):
        data = b"G28\nG1 X10 E1\n"
        self.printer.upload_file("cube.gcode", len(data), data)
        self.assertEqual(self.fake.files["cube.gcode"], data)
        state = self.printer.start_print("cube.gcode", {"estimated_hours": 1.0, "layers": 10})
        self.assertEqual(state["state"], "printing")

    def test_a_damaged_upload_is_refused_by_its_checksum(self):
        self.fake.corrupt_uploads = True
        with self.assertRaises(mc.PrinterRefused) as caught:
            self.printer.upload_file("cube.gcode", 4, b"G28\n")
        self.assertIn("checksum", str(caught.exception))
        self.assertNotIn("cube.gcode", self.fake.files)

    def test_the_u1s_successful_looking_refusal_is_a_failure(self):
        self.printing()
        self.fake.files["next.gcode"] = b"G28\n"
        self.fake.status["print_stats"]["state"] = "standby"     # fool the dashboard's own check...
        self.fake.refuse_start_busy = True
        orig = self.printer._fresh_state
        self.printer._fresh_state = lambda: {**orig(), "state": "ready"}
        self.fake.status["print_stats"]["state"] = "printing"   # ...but the printer knows it's busy
        with self.assertRaises(mc.PrinterRefused) as caught:
            self.printer.start_print("next.gcode")
        self.assertIn("not ready", str(caught.exception))

    def test_a_start_that_never_begins_is_not_reported_as_started(self):
        self.fake.files["slow.gcode"] = b"G28\n"
        self.fake.start_delay = 60
        with self.assertRaises(mc.PrinterCommandError) as caught:
            self.printer.start_print("slow.gcode")
        self.assertIn("still reports", str(caught.exception))

    def test_a_missing_file_is_klippers_own_refusal(self):
        with self.assertRaises(mc.PrinterRefused) as caught:
            self.printer.start_print("nope.gcode")
        self.assertIn("Unable to open file", str(caught.exception))

    def test_temperatures_name_the_physical_heater(self):
        state = self.printer.set_target_temperature("T1", 215)
        self.assertEqual(self.fake.scripts[-1], "SET_HEATER_TEMPERATURE HEATER=extruder1 TARGET=215.0")
        self.assertEqual(state["toolheads"]["T1"]["target_temperature"], 215.0)
        self.printer.set_bed_temperature(60)
        self.assertEqual(self.fake.scripts[-1], "SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=60.0")
        self.assertFalse(any(s.startswith("M104") for s in self.fake.scripts))

    def test_homing_mid_print_is_refused(self):
        self.printing()
        with self.assertRaises(ValueError):
            self.printer.home_axes(["X", "Y"])
        self.assertFalse(any(s.startswith("G28") for s in self.fake.scripts))

    def test_homing_when_idle(self):
        self.assertEqual(self.printer.home_axes(["X", "Y", "Z"]), {"homed": ["X", "Y", "Z"]})
        self.assertEqual(self.fake.scripts[-1], "G28 X Y Z")

    def test_klippers_refusal_comes_back_in_its_words(self):
        self.fake.gcode_errors["G1"] = "Must home axis first: 10.000 0.000 0.000 [0.000]"
        with self.assertRaises(mc.PrinterRefused) as caught:
            self.printer.run_gcode("G1 X10")
        self.assertIn("Must home axis first", str(caught.exception))

    def test_m112_uses_the_emergency_stop(self):
        result = self.printer.run_gcode("M112")
        self.assertIn("Emergency stop", result["response"])
        self.assertTrue(wait_for(lambda: self.printer.snapshot()["state"] == "error"))
        self.assertNotIn("M112", self.fake.scripts)

    def test_a_finish_carries_its_summary(self):
        self.fake.metadata["cube.gcode"] = {"filament_type": "PETG", "filament_total": 1000.0,
                                            "filament_weight_total": 10.0, "filament_colour": "#1C1C1E"}
        self.printing()
        self.fake.set("print_stats", filament_used=500.0, print_duration=1800.0, total_duration=1900.0)
        self.assertTrue(wait_for(lambda: (self.printer.get_current_job().get("material") == "PETG")))
        self.fake.set("print_stats", state="complete")
        self.assertTrue(wait_for(lambda: self.printer.snapshot()["state"] == "complete"))
        job = self.printer.snapshot()["finished_job"]
        self.assertEqual(job["filament_used_grams"], 5.0)
        self.assertEqual(job["filament_type"], "PETG")
        self.assertEqual(job["filament_color_hex"], "#1C1C1E")
        self.assertEqual(job["print_duration_hours"], 0.5)

    def test_a_finish_during_a_dropped_link_still_carries_its_summary(self):
        self.printing()
        self.fake.drop_websockets()
        self.assertTrue(wait_for(lambda: not self.printer.is_connected()))
        self.fake.status["print_stats"]["state"] = "complete"
        self.assertTrue(wait_for(self.printer.is_connected, 8))
        self.assertTrue(wait_for(lambda: self.printer.snapshot()["state"] == "complete"))
        self.assertIn("finished_job", self.printer.snapshot())

    def test_commands_need_the_link(self):
        self.fake.drop_websockets()
        self.fake.close()
        self.assertTrue(wait_for(lambda: not self.printer.is_connected()))
        with self.assertRaises(mc.PrinterUnreachable):
            self.printer.pause_print()

    def test_update_manager_switched_off_is_a_note_not_a_failure(self):
        result = self.printer.get_update_status()
        self.assertEqual(result["packages"], [])
        self.assertIn("no update manager", result["note"])


class TestFailuresInWords(unittest.TestCase):
    """Every way the network can go wrong ends in a sentence, never a hang or a traceback."""

    def setUp(self):
        self.fake = FakeMoonraker()
        self.addCleanup(self.fake.close)

    def transport(self, url=None, **kw):
        return mc.HttpTransport(mc.Endpoint(url or self.fake.url), **kw)

    def test_nothing_listening(self):
        import socket
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        with self.assertRaises(mc.PrinterUnreachable) as caught:
            self.transport(f"http://127.0.0.1:{port}").request("GET", "/server/info")
        self.assertIn("refused the connection", str(caught.exception))

    def test_a_name_that_doesnt_exist(self):
        with self.assertRaises(mc.PrinterUnreachable) as caught:
            self.transport("http://no-such-printer.invalid:7125").request("GET", "/server/info")
        self.assertIn("Can't find", str(caught.exception))

    def test_too_slow(self):
        self.fake.http_faults["/server/history/list"] = {"delay": 2.0}
        began = time.monotonic()
        with self.assertRaises(mc.PrinterUnreachable) as caught:
            self.transport().request("GET", "/server/history/list", timeout=0.5)
        self.assertLess(time.monotonic() - began, 1.8)
        self.assertIn("No answer", str(caught.exception))

    def test_a_reply_cut_off_part_way(self):
        self.fake.http_faults["/server/history/list"] = {"truncate": True}
        with self.assertRaises(mc.PrinterUnreachable) as caught:
            self.transport().request("GET", "/server/history/list", timeout=2)
        self.assertIn("cut off", str(caught.exception))

    def test_a_web_page_instead_of_moonraker(self):
        self.fake.http_faults["/server/history/list"] = {"html": True}
        with self.assertRaises(mc.PrinterCommandError) as caught:
            self.transport().request("GET", "/server/history/list")
        self.assertIn("not with JSON", str(caught.exception))

    def test_an_api_key_is_needed(self):
        self.fake.api_key = "secret"
        with self.assertRaises(mc.PrinterRefused) as caught:
            self.transport().request("GET", "/server/history/list")
        self.assertIn("API key", str(caught.exception))
        self.assertIsInstance(self.transport(api_key="secret").request("GET", "/server/history/list"), dict)

    def test_klipper_not_connected(self):
        self.fake.klippy_state = "disconnected"
        with self.assertRaises(mc.PrinterRefused) as caught:
            self.transport().request("POST", "/printer/print/pause")
        self.assertIn("Klipper isn't running", str(caught.exception))

    def test_a_printer_that_needs_a_key_says_so_in_diagnostics(self):
        fast(self)
        self.fake.api_key = "secret"
        printer = mc.MoonrakerPrinter("p", "Keyed", self.fake.url)
        printer.start()
        self.addCleanup(printer.stop)
        self.assertTrue(wait_for(lambda: "Unauthorized" in (printer.diagnostics()["last_error"] or "")))
        self.assertFalse(printer.is_connected())
        keyed = mc.MoonrakerPrinter("q", "Keyed", self.fake.url, api_key="secret")
        keyed.start()
        self.addCleanup(keyed.stop)
        self.assertTrue(wait_for(keyed.is_connected))
        self.assertNotIn("secret", str(keyed.diagnostics()))


if __name__ == "__main__":
    unittest.main()
