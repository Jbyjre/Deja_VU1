"""
Tests for backend/slicer_bridge.py - the Auto-print pipeline.

There's no OrcaSlicer here, so a small stand-in program plays its part. It
behaves the way OrcaSlicer's source says the real one does
(src/OrcaSlicer.cpp: plate_<n>.gcode in --outputdir, result.json with
return_code / error_string, "<AppKey>-<version>:" as the first line of
--help) and can be told to misbehave: fail, hang, write nothing, write an
empty or unprintable file. Every one of those must end in a worded failure
and never in a file added to the library.
"""

import json
import os
import platform
import stat
import sys
import tempfile
import textwrap
import time
import unittest
import unittest.mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import file_library    # noqa: E402
import mock_moonraker  # noqa: E402
import print_queue     # noqa: E402
import sample_files    # noqa: E402
import slicer_bridge   # noqa: E402

FAKE_ORCA = textwrap.dedent('''\
    #!{python}
    import json, os, sys, time
    mode = os.environ.get("FAKE_ORCA_MODE", "ok")
    args = sys.argv[1:]
    if mode in ("windows_console", "windows_console_no_file"):
        # The Windows build, as a user's engine report showed it: the help goes to a console window, so the
        # pipe holds only start-up log lines and the program exits 0. The settings file is still written.
        sys.stdout.write("sentry_init returned: 0\\r\\nsentry_init succeeded, init_success set to true\\r\\n"
                         "Starting Sentry session and setting flags...\\r\\n"
                         "[trace]   Initializing StaticPrintConfigs\\r\\n")
        if "--export-settings" in args and mode == "windows_console":
            with open(args[args.index("--export-settings") + 1], "w") as fh:
                json.dump({{"version": "2.4.2", "name": "project_settings", "from": "project",
                           "layer_height": "0.2", "nozzle_diameter": ["0.4"]}}, fh)
        sys.exit(0)
    if "--help" in args:
        if mode == "missing_library":
            # What Linux's loader prints for a program whose library isn't installed; it exits 127 and
            # prints nothing on stdout, which is what once hid the cause behind "no output".
            sys.stderr.write("orca-slicer: error while loading shared libraries: libwebkit2gtk-4.1.so.0: "
                             "cannot open shared object file: No such file or directory\\n")
            sys.exit(127)
        if mode == "not_orca":
            print("usage: something else entirely")
        else:
            print("OrcaSlicer-2.3.2:")
            print("Usage: orca-slicer [ OPTIONS ] [ file.3mf/file.stl ... ]")
        sys.exit(0)
    with open(os.environ["FAKE_ORCA_ARGS"], "w") as fh:
        json.dump(args, fh)
    out = args[args.index("--outputdir") + 1]
    def result(code, text):
        with open(os.path.join(out, "result.json"), "w") as fh:
            json.dump({{"plate_index": 0, "return_code": code, "error_string": text}}, fh)
    if mode == "missing_library":
        sys.stderr.write("orca-slicer: error while loading shared libraries: libwebkit2gtk-4.1.so.0: "
                         "cannot open shared object file: No such file or directory\\n")
        sys.exit(127)
    if mode == "segfault":
        import signal
        os.kill(os.getpid(), signal.SIGSEGV)
    if mode == "no_display":
        sys.stderr.write("Gtk-WARNING **: cannot open display: \\n")
        sys.exit(1)
    if mode == "hang":
        time.sleep(60)
    if mode == "hang_with_helper":
        # A helper in a session of its own, holding our output pipes open:
        # killing the process group doesn't reach it.
        import subprocess
        subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)
        time.sleep(60)
    if mode == "config_error":
        result(-5, "Loading configuration file failed")
        sys.stderr.write("load_config_file: can not resolve preset\\n")
        sys.exit(251)
    if mode == "model_outside_bed":
        # What Orca writes for a model it won't slice (src/OrcaSlicer.cpp,
        # cli_errors[CLI_OBJECTS_PARTLY_INSIDE]); it exits with the code, -52.
        result(-52, "Some objects are located over the boundary of the heated bed.")
        sys.exit(256 - 52)
    if mode == "unreadable_model":
        result(-6, "The input model file to the slicer can not be parsed.")
        sys.exit(256 - 6)
    if mode == "crash_no_result":
        sys.stderr.write("Segmentation fault\\n")
        sys.exit(3)
    if mode == "no_output":
        result(0, "Success.")
        sys.exit(0)
    body = {{"ok": "", "empty": None, "nothing_printable": "G28\\nG1 X10 Y10\\n"}}[mode]
    with open(os.path.join(out, "plate_1.gcode"), "w") as fh:
        fh.write(os.environ["FAKE_ORCA_GCODE"] if body == "" else (body or ""))
    result(0, "Success.")
''')


def _preset(folder, name, kind, **extra):
    path = os.path.join(folder, f"{name}.json")
    with open(path, "w") as fh:
        json.dump({"name": name, "type": kind, "from": "User", **extra}, fh)
    return path


class SlicerBridgeTest(unittest.TestCase):
    def setUp(self):
        slicer_bridge.reset()
        file_library.reset()
        print_queue.reset()
        mock_moonraker.reset_all()
        self.tmp = tempfile.mkdtemp(prefix="dv-slicer-test-")
        self.orca = os.path.join(self.tmp, "orca-slicer")
        with open(self.orca, "w") as fh:
            fh.write(FAKE_ORCA.format(python=sys.executable))
        os.chmod(self.orca, os.stat(self.orca).st_mode | stat.S_IEXEC)
        self.args_file = os.path.join(self.tmp, "args.json")
        os.environ.update(FAKE_ORCA_MODE="ok", FAKE_ORCA_ARGS=self.args_file,
                          FAKE_ORCA_GCODE=sample_files.build("calibration_cube_20mm.gcode").decode())
        os.environ.pop(slicer_bridge.ENV_PATH, None)
        self.machine = _preset(self.tmp, "Snapmaker U1 (0.4 nozzle)", "machine")
        self.process = _preset(self.tmp, "0.20mm Standard", "process")
        self.filament = _preset(self.tmp, "Generic PLA", "filament")
        file_library.save("spur_gear_24t.stl", sample_files.build("spur_gear_24t.stl"), origin="sample")

    def tearDown(self):
        for key in ("FAKE_ORCA_MODE", "FAKE_ORCA_ARGS", "FAKE_ORCA_GCODE", slicer_bridge.ENV_PATH):
            os.environ.pop(key, None)
        slicer_bridge.reset()
        file_library.reset()
        print_queue.reset()

    def configure(self, timeout=None):
        slicer_bridge.save_settings({"slicer_path": self.orca, **({"timeout_s": timeout} if timeout else {})})
        return slicer_bridge.add_profile("U1 standard", self.machine, self.process, [self.filament])

    def library_names(self):
        return [f["name"] for f in file_library.list_files()["files"]]


class TestSettings(SlicerBridgeTest):
    def test_off_until_set_up_and_says_why(self):
        s = slicer_bridge.public_settings()
        self.assertIn("Install Snapmaker Orca or OrcaSlicer yourself", s["problem"])
        self.assertFalse(slicer_bridge.check()["ok"])

    def test_path_rules(self):
        with self.assertRaisesRegex(ValueError, "full path"):
            slicer_bridge.save_settings({"slicer_path": "orca-slicer"})
        with self.assertRaisesRegex(ValueError, "must contain \"orca\""):
            slicer_bridge.save_settings({"slicer_path": "/bin/sh"})
        slicer_bridge.save_settings({"slicer_path": os.path.join(self.tmp, "OrcaSlicer-missing")})
        self.assertIn("Nothing exists", slicer_bridge.public_settings()["problem"])
        with self.assertRaisesRegex(ValueError, "between"):
            slicer_bridge.save_settings({"timeout_s": 5})

    def test_not_executable_is_worded(self):
        path = os.path.join(self.tmp, "orca-noexec")
        open(path, "w").close()
        os.chmod(path, 0o644)
        slicer_bridge.save_settings({"slicer_path": path})
        self.assertIn("isn't allowed to run", slicer_bridge.public_settings()["problem"])

    def test_environment_variable_wins_and_skips_the_name_rule(self):
        os.environ[slicer_bridge.ENV_PATH] = self.orca
        s = slicer_bridge.public_settings()
        self.assertEqual((s["slicer_path"], s["path_source"], s["problem"]), (self.orca, "environment", None))

    def test_check_reads_the_version(self):
        self.configure()
        result = slicer_bridge.check()
        self.assertTrue(result["ok"], result)
        self.assertEqual((result["app"], result["version"]), ("OrcaSlicer", "2.3.2"))
        self.assertEqual(slicer_bridge.get_settings()["last_check"]["version"], "2.3.2")

    def test_check_refuses_a_program_that_isnt_orca(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "not_orca"
        result = slicer_bridge.check()
        self.assertFalse(result["ok"])
        self.assertIn("didn't answer like OrcaSlicer", result["error"])


class TestWindowsConsoleBuild(SlicerBridgeTest):
    """
    Snapmaker Orca on Windows prints `--help` to a console window of its own (Snapmaker_Orca.cpp,
    attach_console_on_demand), so the check once failed with "didn't answer like OrcaSlicer's command line (it said:
    'sentry_init returned: 0')". The settings file it writes still names the version.
    """

    def test_a_build_that_prints_its_help_elsewhere_is_read_from_its_settings_file(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "windows_console"
        with unittest.mock.patch.object(slicer_bridge.platform, "system", return_value="Windows"):
            result = slicer_bridge.check()
        self.assertTrue(result["ok"], result)
        self.assertEqual((result["app"], result["version"], result["checked_by"]), ("OrcaSlicer", "2.4.2", "settings file"))
        self.assertIn("console window", result["detail"])
        self.assertEqual(result["support"]["level"], "untested")
        self.assertFalse(result["capabilities"]["per_tool_heights"])
        self.assertEqual(slicer_bridge.get_settings()["last_check"]["version"], "2.4.2")

    def test_snapmaker_orca_is_named_from_the_program_file(self):
        named = os.path.join(self.tmp, "snapmaker-orca")
        os.rename(self.orca, named)
        slicer_bridge.save_settings({"slicer_path": named})
        os.environ["FAKE_ORCA_MODE"] = "windows_console"
        result = slicer_bridge.check()
        self.assertEqual((result["ok"], result["app"], result["version"]), (True, "Snapmaker_Orca", "2.4.2"))
        self.assertIn("Snapmaker_Orca", result["support"]["title"])

    def test_the_engine_is_then_used_to_slice_like_any_other(self):
        profile = self.configure()
        os.environ["FAKE_ORCA_MODE"] = "windows_console"
        self.assertTrue(slicer_bridge.check()["ok"])
        self.assertFalse(slicer_bridge.engine_changed(slicer_bridge.get_settings(), self.orca))
        self.assertTrue(profile["id"])

    def test_a_program_that_prints_log_lines_but_writes_no_settings_file_is_still_refused(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "windows_console_no_file"
        result = slicer_bridge.check()
        self.assertFalse(result["ok"])
        self.assertEqual(result["cause"]["code"], "not_orca")
        self.assertIn("sentry_init returned: 0", result["error"])


class TestReceiptsSurviveARestart(SlicerBridgeTest):
    """A restart (an update, Restart, a crash) used to lose the report that explains a failed slice."""

    def restart(self):
        with slicer_bridge._lock:
            slicer_bridge._jobs.clear()
            slicer_bridge._order.clear()
            slicer_bridge._traces.clear()
        slicer_bridge._load_receipts()

    def slice_and_wait(self, mode):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = mode
        job = slicer_bridge.start_job("spur_gear_24t.stl")
        return slicer_bridge.wait(job["id"], timeout=30)

    def test_a_failed_slice_and_its_report_come_back_after_a_restart(self):
        failed = self.slice_and_wait("config_error")
        self.assertEqual(failed["status"], "failed")
        before = slicer_bridge.export(failed["id"])
        self.restart()
        again = slicer_bridge.get_job(failed["id"])
        self.assertEqual((again["status"], again["cause"]["code"]), ("failed", failed["cause"]["code"]))
        after = slicer_bridge.export(failed["id"])
        self.assertEqual(after["outcome"]["cause"], before["outcome"]["cause"])
        self.assertEqual(after["run"], before["run"])
        self.assertEqual([j["id"] for j in slicer_bridge.jobs()["jobs"]], [failed["id"]])

    def test_a_finished_slice_keeps_its_files_after_a_restart(self):
        done = self.slice_and_wait("ok")
        self.assertEqual(done["status"], "done")
        self.restart()
        again = slicer_bridge.get_job(done["id"])
        self.assertEqual(again["status"], "done")
        self.assertEqual([f["name"] for f in again["report"]["files"]], [f["name"] for f in done["report"]["files"]])

    def test_a_slice_that_was_running_when_the_program_stopped_is_marked_interrupted(self):
        self.configure()
        job = {"id": "interrupt", "model": "spur_gear_24t.stl", "profile": "U1 standard", "profile_id": "p1",
               "printer_id": mock_moonraker.selected_printer_id(), "status": "running", "step": "Slicing",
               "created_at": "2026-11-07T10:00:00", "error": None, "report": None, "queued": None, "stage": None}
        with slicer_bridge._lock:
            slicer_bridge._jobs[job["id"]] = job
            slicer_bridge._traces[job["id"]] = {"stage": "slice"}
            slicer_bridge._order.append(job["id"])
            slicer_bridge._persist_locked()
        self.restart()
        again = slicer_bridge.get_job("interrupt")
        self.assertEqual((again["status"], again["interrupted"], again["cause"]["code"]), ("failed", True, "interrupted"))
        self.assertIn("did not finish", again["error"])
        self.assertEqual(again["stage"], "slice")
        self.assertFalse(slicer_bridge.any_active())
        # The next start finds it already settled and does not mark it twice.
        self.restart()
        self.assertEqual(slicer_bridge.get_job("interrupt")["error"], again["error"])

    def test_a_damaged_receipts_file_is_ignored(self):
        with open(slicer_bridge._RECEIPTS, "w") as fh:
            fh.write("{not json")
        self.restart()
        self.assertEqual(slicer_bridge.jobs()["jobs"], [])
        with open(slicer_bridge._RECEIPTS, "w") as fh:
            json.dump({"jobs": [{"job": "text"}, {"job": {"id": 7}}, 5]}, fh)
        self.restart()
        self.assertEqual(slicer_bridge.jobs()["jobs"], [])

    def test_resetting_forgets_the_receipts(self):
        self.slice_and_wait("config_error")
        slicer_bridge.reset()
        self.restart()
        self.assertEqual(slicer_bridge.jobs()["jobs"], [])

    def test_no_more_than_the_last_twenty_are_kept(self):
        with slicer_bridge._lock:
            for n in range(25):
                jid = f"job{n:02d}"
                slicer_bridge._jobs[jid] = {"id": jid, "model": "m.stl", "status": "done", "printer_id": "p"}
                slicer_bridge._order.append(jid)
            slicer_bridge._persist_locked()
        self.restart()
        self.assertEqual(len(slicer_bridge._order), slicer_bridge.MAX_JOBS_KEPT)
        self.assertEqual(slicer_bridge._order[-1], "job24")


class TestFindSlicers(SlicerBridgeTest):
    """"Find it for me": the usual install places, one level deep, nothing run."""

    def place(self, *parts, executable=True, content="#!/bin/sh\n"):
        path = os.path.join(self.tmp, "places", *parts)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(content)
        os.chmod(path, 0o755 if executable else 0o644)
        return path

    def test_finds_programs_and_skips_installers_projects_and_archives(self):
        appimage = self.place("Downloads", "OrcaSlicer_Linux_V2.3.0.AppImage", executable=False)
        opt = self.place("opt", "Snapmaker_Orca", "bin", "snapmaker-orca")
        for skipped in ("OrcaSlicer_Linux_V2.3.0.zip", "OrcaSlicer_Installer", "orca_benchy.stl", ".orca-hidden"):
            self.place("Downloads", skipped)
        self.place("Downloads", "orca-notes", executable=False)          # not a program
        places = [(os.path.join(self.tmp, "places", "Downloads"), "Downloads"),
                  (os.path.join(self.tmp, "places", "opt"), "/opt"),
                  (os.path.join(self.tmp, "places", "missing"), "nowhere")]
        found = slicer_bridge.find_slicers(places)["found"]
        self.assertEqual([f["path"] for f in found], [opt, appimage])   # runnable Snapmaker Orca first
        self.assertEqual(found[0]["name"], "Snapmaker Orca")
        self.assertTrue(found[0]["runnable"])
        self.assertFalse(found[1]["runnable"])
        self.assertIn("allow it to run", found[1]["hint"])

    def test_marks_the_one_in_use_and_lists_each_program_once(self):
        orca = self.place("Applications", "OrcaSlicer", "orca-slicer")
        os.symlink(orca, os.path.join(self.tmp, "places", "Applications", "orca-link"))
        slicer_bridge.save_settings({"slicer_path": orca})
        found = slicer_bridge.find_slicers([(os.path.join(self.tmp, "places", "Applications"), "Applications")])["found"]
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0]["in_use"])

    def test_the_answer_is_capped(self):
        for i in range(slicer_bridge.MAX_FOUND + 5):
            self.place("Downloads", f"orca-slicer-{i}")
        found = slicer_bridge.find_slicers([(os.path.join(self.tmp, "places", "Downloads"), "Downloads")])["found"]
        self.assertEqual(len(found), slicer_bridge.MAX_FOUND)


class TestProfiles(SlicerBridgeTest):
    def test_presets_are_checked_before_orca_runs(self):
        with self.assertRaisesRegex(ValueError, "this slot needs a machine"):
            slicer_bridge.add_profile("x", self.process, self.process, [self.filament])
        no_type = os.path.join(self.tmp, "old.json")
        with open(no_type, "w") as fh:
            json.dump({"name": "old", "from": "User"}, fh)
        with self.assertRaisesRegex(ValueError, "type"):
            slicer_bridge.add_profile("x", no_type, self.process, [self.filament])
        bad_from = _preset(self.tmp, "Shared", "process", **{"from": "project"})
        with self.assertRaisesRegex(ValueError, "system or User"):
            slicer_bridge.add_profile("x", self.machine, bad_from, [self.filament])
        not_json = os.path.join(self.tmp, "broken.json")
        with open(not_json, "w") as fh:
            fh.write("{nope")
        with self.assertRaisesRegex(ValueError, "isn't valid JSON"):
            slicer_bridge.add_profile("x", self.machine, not_json, [self.filament])
        with self.assertRaisesRegex(ValueError, "at most four"):
            slicer_bridge.add_profile("x", self.machine, self.process, [self.filament] * 5)

    def test_a_machine_that_isnt_the_u1_is_flagged(self):
        other = _preset(self.tmp, "Voron 2.4 350", "machine")
        profile = slicer_bridge.add_profile("Voron", other, self.process, [self.filament])
        self.assertTrue(any("doesn't mention the U1" in w for w in profile["warnings"]))

    def test_first_profile_becomes_default_and_removal_moves_it(self):
        a = self.configure()
        b = slicer_bridge.add_profile("Fine", self.machine, self.process, [self.filament, self.filament])
        self.assertEqual(slicer_bridge.get_settings()["default_profile"], a["id"])
        slicer_bridge.remove_profile(a["id"])
        self.assertEqual(slicer_bridge.get_settings()["default_profile"], b["id"])


class TestSlicing(SlicerBridgeTest):
    def test_slices_into_the_library_with_the_command_orca_documents(self):
        profile = self.configure()
        slicer_bridge.check()
        report = slicer_bridge.slice_model("spur_gear_24t.stl")
        with open(self.args_file) as fh:
            args = json.load(fh)
        self.assertEqual(args[:2], ["--slice", "0"])
        self.assertEqual(args[args.index("--load-settings") + 1], f"{self.machine};{self.process}")
        self.assertEqual(args[args.index("--load-filaments") + 1], self.filament)
        self.assertTrue(args[-1].endswith("spur_gear_24t.stl"))
        self.assertEqual(report["files"][0]["name"], "spur_gear_24t.gcode")
        self.assertGreater(report["files"][0]["layers"], 0)
        entry = file_library.describe("spur_gear_24t.gcode")
        self.assertEqual(entry["origin"], "sliced")
        self.assertIn(profile["name"], entry["note"])
        self.assertIn("2.3.2", entry["note"])
        # Slicing again never overwrites the first file.
        again = slicer_bridge.slice_model("spur_gear_24t.stl")
        self.assertEqual(again["files"][0]["name"], "spur_gear_24t-2.gcode")

    def test_gcode_is_refused(self):
        self.configure()
        file_library.save("cube.gcode", sample_files.build("calibration_cube_20mm.gcode"))
        with self.assertRaisesRegex(ValueError, "already sliced"):
            slicer_bridge.slice_model("cube.gcode")

    def assertFailsWithoutAFile(self, mode, pattern, timeout=None):
        self.configure(timeout)
        os.environ["FAKE_ORCA_MODE"] = mode
        before = set(self.library_names())
        with self.assertRaisesRegex(slicer_bridge.SliceFailed, pattern) as ctx:
            slicer_bridge.slice_model("spur_gear_24t.stl")
        self.assertEqual(set(self.library_names()), before)
        return ctx.exception.report

    def test_orca_error_code_is_put_into_words(self):
        report = self.assertFailsWithoutAFile("config_error", "couldn't load one of the preset files")
        self.assertEqual(report["orca_result"]["return_code"], -5)
        self.assertIn("can not resolve preset", report["error_tail"])

    def test_a_model_orca_rejects_is_a_failure_in_words(self):
        report = self.assertFailsWithoutAFile(
            "model_outside_bed",
            r"Part of the model is outside the printable area\. Orca said: Some objects are located "
            r"over the boundary of the heated bed\.")
        self.assertEqual(report["orca_result"]["return_code"], -52)
        self.assertEqual(report["exit_code"], 204)

    def test_a_model_orca_cannot_read_is_a_failure_in_words(self):
        self.assertFailsWithoutAFile("unreadable_model", "Orca couldn't read the model file")

    def test_a_crash_without_result_json_still_explains(self):
        self.assertFailsWithoutAFile("crash_no_result", "exited with code 3: Segmentation fault")

    def test_success_but_no_gcode(self):
        self.assertFailsWithoutAFile("no_output", "wrote no G-code")

    def test_empty_gcode(self):
        self.assertFailsWithoutAFile("empty", "it's empty")

    def test_gcode_that_prints_nothing(self):
        self.assertFailsWithoutAFile("nothing_printable", "no printable layers")

    def test_a_hang_with_a_helper_holding_the_output_still_ends(self):
        slicer_bridge.MIN_TIMEOUT, original = 1, slicer_bridge.MIN_TIMEOUT
        try:
            started = time.monotonic()
            self.assertFailsWithoutAFile("hang_with_helper", "didn't finish within 1 s", timeout=1)
            self.assertLess(time.monotonic() - started, 25)
        finally:
            slicer_bridge.MIN_TIMEOUT = original

    def test_a_hang_is_stopped_at_the_time_limit(self):
        slicer_bridge.MIN_TIMEOUT, original = 1, slicer_bridge.MIN_TIMEOUT
        try:
            started = time.monotonic()
            self.assertFailsWithoutAFile("hang", "didn't finish within 1 s", timeout=1)
            self.assertLess(time.monotonic() - started, 15)
        finally:
            slicer_bridge.MIN_TIMEOUT = original

    def test_a_preset_moved_since_saving_is_caught(self):
        self.configure()
        os.remove(self.process)
        with self.assertRaisesRegex(ValueError, "No file at"):
            slicer_bridge.slice_model("spur_gear_24t.stl")


class TestJobs(SlicerBridgeTest):
    def test_a_job_that_queues_is_never_seen_finished_before_it_is_queued(self):
        # Found as a failure under load: the job read "done" for a moment
        # before "queued", and anything polling it (the dashboard's job list
        # stops when nothing is running) could stop there.
        self.configure()
        seen = []
        real_add = print_queue.add

        def slow_add(filename, printer_id=None):
            seen.append(slicer_bridge.jobs()["jobs"][0]["status"])
            time.sleep(0.2)
            return real_add(filename, printer_id=printer_id)

        with unittest.mock.patch.object(print_queue, "add", slow_add):
            job = slicer_bridge.start_job("spur_gear_24t.stl", queue_to="u1-garage")
            job = slicer_bridge.wait(job["id"])
        self.assertEqual(seen, ["running"])
        self.assertEqual(job["status"], "queued", job)

    def test_slice_and_queue(self):
        self.configure()
        done = []
        job = slicer_bridge.start_job("spur_gear_24t.stl", queue_to="u1-garage", on_done=done.append)
        job = slicer_bridge.wait(job["id"])
        self.assertEqual(job["status"], "queued", job)
        queued = print_queue.get("u1-garage")["items"]
        self.assertEqual([i["filename"] for i in queued], ["spur_gear_24t.gcode"])
        self.assertEqual(queued[0]["status"], "queued")     # queued, not started: the gate comes later
        self.assertEqual(mock_moonraker.printer_ids()[2], "u1-garage")
        time.sleep(0.1)
        self.assertEqual(done[0]["status"], "queued")

    def test_failed_job_is_worded_and_listed(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "config_error"
        job = slicer_bridge.wait(slicer_bridge.start_job("spur_gear_24t.stl")["id"])
        self.assertEqual(job["status"], "failed")
        self.assertIn("preset", job["error"])
        self.assertEqual(slicer_bridge.jobs()["jobs"][0]["id"], job["id"])

    def test_blocked_engine_output_is_not_queued(self):
        self.configure()
        os.environ['FAKE_ORCA_GCODE']+='\nG90\nM83\nG1 X290 Y0 Z0.2 E5\n'
        with unittest.mock.patch.object(print_queue,'add',wraps=print_queue.add) as add:
            job=slicer_bridge.wait(slicer_bridge.start_job('spur_gear_24t.stl',queue_to='u1-garage')['id'])
        self.assertEqual(job['status'], 'failed')
        self.assertIn('Pre-flight blocked', job['error'])
        self.assertEqual(job['report']['files'][0]['preflight'], 'blocked')
        add.assert_not_called()

    def test_missing_engine_estimates_remain_unknown(self):
        profile=self.configure()
        os.environ['FAKE_ORCA_GCODE']='\n'.join(line for line in os.environ['FAKE_ORCA_GCODE'].splitlines() if not line.lstrip().startswith(';'))
        report=slicer_bridge.slice_model('spur_gear_24t.stl',profile['id'])
        self.assertIsNone(report['files'][0]['filament_grams'])
        self.assertIsNone(report['files'][0]['estimated_hours'])

    def test_previous_output_is_remembered_for_what_changed(self):
        self.configure()
        first = slicer_bridge.wait(slicer_bridge.start_job("spur_gear_24t.stl")["id"])
        second = slicer_bridge.start_job("spur_gear_24t.stl")
        self.assertEqual(second["previous"], first["report"]["files"][0]["name"])
        slicer_bridge.wait(second["id"])

    def test_refuses_to_start_without_a_slicer(self):
        with self.assertRaisesRegex(ValueError, "No slicer set up"):
            slicer_bridge.start_job("spur_gear_24t.stl")


if __name__ == "__main__":
    unittest.main()

class TestAutoDetect(unittest.TestCase):
    def test_known_program_is_detected_without_saving_a_path(self):
        from unittest.mock import patch
        with patch.dict(os.environ, {slicer_bridge.ENV_PATH: ''}), \
             patch.object(slicer_bridge.shutil, 'which', return_value='/opt/orca-slicer'), \
             patch.object(slicer_bridge.os.path, 'isfile', return_value=True), \
             patch.object(slicer_bridge.os, 'access', return_value=True):
            self.assertEqual(slicer_bridge.slicer_path({'slicer_path': ''}), ('/opt/orca-slicer', 'detected'))


class TestSliceCancellation(SlicerBridgeTest):
    def test_running_engine_is_stopped_and_never_queued(self):
        self.configure()
        os.environ['FAKE_ORCA_MODE'] = 'hang'
        job=slicer_bridge.start_job('spur_gear_24t.stl',queue_to=mock_moonraker.selected_printer_id())
        end=time.time()+5
        while not os.path.exists(self.args_file) and time.time() < end:
            time.sleep(0.02)
        self.assertTrue(os.path.exists(self.args_file))
        slicer_bridge.cancel_job(job['id'])
        result=slicer_bridge.wait(job['id'],timeout=5)
        self.assertEqual(result['status'],'cancelled')
        self.assertIsNone(result['queued'])
        self.assertEqual(self.library_names(),['spur_gear_24t.stl'])

    def test_other_printer_cannot_cancel_or_list_job(self):
        self.configure()
        os.environ['FAKE_ORCA_MODE'] = 'hang'
        job=slicer_bridge.start_job('spur_gear_24t.stl')
        with mock_moonraker.selection_only('u1-studio'):
            with self.assertRaisesRegex(ValueError, 'this printer'):
                slicer_bridge.cancel_job(job['id'])
            self.assertNotIn(job['id'],[j['id'] for j in slicer_bridge.jobs()['jobs']])
        slicer_bridge.cancel_job(job['id'])
        self.assertEqual(slicer_bridge.wait(job['id'], 5)['status'], 'cancelled')


class TestExportedHeightContracts(SlicerBridgeTest):
    def test_exported_preferences_cannot_bypass_engine_capability_check(self):
        self.configure()
        with open(self.machine, encoding='utf-8') as stream:
            data = json.load(stream)
        data.update(extruder_layer_height=['.1','.2','.1','.1'],nozzle_diameter=['.4']*4)
        with open(self.machine, 'w', encoding='utf-8') as stream:
            json.dump(data, stream)
        with self.assertRaisesRegex(ValueError,'shared-height fallback is refused'):
            slicer_bridge.slice_model('spur_gear_24t.stl')
        self.assertFalse(os.path.exists(self.args_file))


class TestWhyItFailed(SlicerBridgeTest):
    """B02: a failure names its real cause, and one report says what ran and where it stopped."""

    def fail_a_job(self, mode):
        self.configure()
        self.assertTrue(slicer_bridge.check()["ok"])
        os.environ["FAKE_ORCA_MODE"] = mode
        job = slicer_bridge.start_job("spur_gear_24t.stl")
        return slicer_bridge.wait(job["id"], timeout=20)

    def test_an_engine_check_names_the_missing_library_not_no_output(self):
        # The research session's real engine check: the engine printed one loader line on stderr and exited 127.
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "missing_library"
        result = slicer_bridge.check()
        self.assertFalse(result["ok"])
        self.assertIn("libwebkit2gtk-4.1.so.0", result["error"])
        self.assertNotIn("no output", result["error"])
        self.assertEqual((result["exit_code"], result["cause"]["code"]), (127, "missing_library"))
        self.assertEqual(result["cause"]["command"], "sudo apt-get install libwebkit2gtk-4.1-0")
        self.assertEqual(slicer_bridge.public_settings()["last_check"]["cause"]["code"], "missing_library")

    def test_a_check_of_a_program_that_is_not_orca_still_says_so_and_gives_a_way_on(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "not_orca"
        result = slicer_bridge.check()
        self.assertIn("didn't answer like OrcaSlicer", result["error"])
        self.assertEqual(result["cause"]["code"], "not_orca")
        self.assertTrue(result["cause"]["fixes"])

    def test_a_check_with_no_slicer_set_has_a_cause_with_a_way_on(self):
        result = slicer_bridge.check()
        self.assertEqual(result["cause"]["code"], "engine_problem")
        self.assertIn("Find it for me", result["cause"]["fixes"][0])

    def test_a_slice_that_cannot_load_a_library_says_which(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "missing_library"
        with self.assertRaises(slicer_bridge.SliceFailed) as ctx:
            slicer_bridge.slice_model("spur_gear_24t.stl")
        self.assertIn("missing the library libwebkit2gtk-4.1.so.0", str(ctx.exception))
        self.assertEqual(ctx.exception.cause["code"], "missing_library")
        self.assertEqual(ctx.exception.report["exit_code"], 127)

    @unittest.skipIf(os.name == "nt", "signals are POSIX")
    def test_a_crash_by_signal_is_named(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "segfault"
        with self.assertRaises(slicer_bridge.SliceFailed) as ctx:
            slicer_bridge.slice_model("spur_gear_24t.stl")
        self.assertIn("segmentation fault, signal 11", str(ctx.exception))
        self.assertEqual(ctx.exception.cause["code"], "crashed")

    def test_no_screen_is_named(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "no_display"
        with self.assertRaises(slicer_bridge.SliceFailed) as ctx:
            slicer_bridge.slice_model("spur_gear_24t.stl")
        self.assertEqual(ctx.exception.cause["code"], "no_display")

    def test_orcas_own_answer_still_wins_when_it_gave_one(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "model_outside_bed"
        with self.assertRaises(slicer_bridge.SliceFailed) as ctx:
            slicer_bridge.slice_model("spur_gear_24t.stl")
        self.assertEqual(ctx.exception.cause["code"], "orca_-52")
        self.assertIn("inside the build plate", ctx.exception.cause["fixes"][0])

    def test_a_file_the_system_cannot_run_is_named_at_the_check(self):
        if os.name == "nt":
            self.skipTest("a bad executable fails differently on Windows")
        broken = os.path.join(self.tmp, "orca-broken")
        with open(broken, "wb") as fh:
            fh.write(b"\x00\x01 not a program")
        os.chmod(broken, 0o755)
        slicer_bridge.save_settings({"slicer_path": broken})
        result = slicer_bridge.check()
        self.assertEqual(result["cause"]["code"], "wrong_program")
        self.assertIn("isn't a program this computer can run", result["error"])

    def test_a_script_whose_interpreter_is_missing_is_named_at_the_check(self):
        if os.name == "nt":
            self.skipTest("shebang lines are POSIX")
        script = os.path.join(self.tmp, "orca-nointerpreter")
        with open(script, "w") as fh:
            fh.write("#!/nonexistent/interpreter\n")
        os.chmod(script, 0o755)
        slicer_bridge.save_settings({"slicer_path": script})
        result = slicer_bridge.check()
        self.assertEqual(result["cause"]["code"], "loader_missing")

    def test_a_failed_job_carries_its_cause_and_the_stage_it_stopped_at(self):
        job = self.fail_a_job("missing_library")
        self.assertEqual(job["status"], "failed")
        self.assertEqual((job["cause"]["code"], job["stage"], job["stage_label"]),
                         ("missing_library", "slice", "Slicing"))
        self.assertIn("libwebkit2gtk-4.1.so.0", job["error"])

    def test_the_report_of_a_failed_slice_holds_everything_a_helper_needs(self):
        job = self.fail_a_job("missing_library")
        report = slicer_bridge.export(job["id"])
        blob = json.dumps(report)
        self.assertEqual((report["schema"], report["kind"]), ("dejavu1.slice-report/1", "slice"))
        self.assertEqual(report["host"]["os"], platform.system())
        self.assertEqual(report["mode"]["where"], "local Deja Vu1 server")
        self.assertFalse(report["mode"]["printer_is_real"])
        self.assertEqual((report["engine"]["app"], report["engine"]["version"]), ("OrcaSlicer", "2.3.2"))
        self.assertTrue(report["engine"]["last_check"]["ok"])
        self.assertEqual(report["profile"]["name"], "U1 standard")
        self.assertEqual(report["profile"]["machine_preset"], "Snapmaker U1 (0.4 nozzle).json")
        self.assertEqual(report["profile"]["filament_presets"], ["Generic PLA.json"])
        self.assertEqual((report["input"]["name"], report["input"]["kind"]), ("spur_gear_24t.stl", "stl"))
        self.assertGreater(report["input"]["bytes"], 0)
        self.assertEqual(len(report["input"]["sha256"]), 16)
        self.assertEqual(report["stage"], {"reached": "slice", "label": "Slicing", "failed_here": True})
        self.assertEqual(report["run"]["exit_code"], 127)
        self.assertIn("cannot open shared object file", report["run"]["stderr"]["text"])
        self.assertEqual(report["run"]["command"][0], "orca-slicer")
        self.assertEqual(report["output"]["status"], "none")
        self.assertEqual(report["outcome"]["status"], "failed")
        self.assertEqual(report["outcome"]["cause"]["code"], "missing_library")
        self.assertNotIn(self.process, blob, "preset paths stay out; only their names are listed")
        self.assertNotIn(self.filament, blob)

    def test_the_report_of_a_slice_refused_before_the_engine_ran_says_where(self):
        self.configure()
        self.assertTrue(slicer_bridge.check()["ok"])
        os.remove(self.process)
        job = slicer_bridge.wait(slicer_bridge.start_job("spur_gear_24t.stl")["id"], timeout=20)
        report = slicer_bridge.export(job["id"])
        self.assertEqual(job["status"], "failed")
        self.assertEqual((job["stage"], job["cause"]["code"]), ("profile", "profile_problem"))
        self.assertIsNone(report["run"])
        self.assertEqual(report["stage"]["label"], "Checking the presets")
        self.assertEqual(report["output"]["status"], "none")
        self.assertIn("Profiles", job["cause"]["fixes"][0])

    def test_the_report_names_what_came_out_when_the_engine_wrote_nothing_useful(self):
        for mode, status in (("no_output", "no_plate_files"), ("empty", "empty"), ("nothing_printable", "no_layers")):
            with self.subTest(mode=mode):
                slicer_bridge.reset()
                job = self.fail_a_job(mode)
                report = slicer_bridge.export(job["id"])
                self.assertEqual((report["output"]["status"], report["stage"]["reached"]), (status, "output"))
                self.assertEqual(report["run"]["exit_code"], 0)
                self.assertTrue(report["outcome"]["cause"]["fixes"])

    def test_the_report_of_a_good_slice_lists_the_files_it_saved(self):
        job = self.fail_a_job("ok")
        report = slicer_bridge.export(job["id"])
        self.assertEqual(job["status"], "done")
        self.assertEqual((report["stage"]["reached"], report["stage"]["failed_here"]), ("done", False))
        self.assertEqual(report["output"]["status"], "ok")
        self.assertEqual(report["output"]["saved"], [f["name"] for f in job["report"]["files"]])
        self.assertEqual(report["output"]["plates"][0]["file"], "plate_1.gcode")
        self.assertIsNone(report["outcome"]["cause"])

    def test_a_cancelled_slice_keeps_the_stage_it_reached(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "hang"
        job = slicer_bridge.start_job("spur_gear_24t.stl")
        end = time.time() + 10
        while time.time() < end and not os.path.exists(self.args_file):
            time.sleep(0.05)
        slicer_bridge.cancel_job(job["id"])
        job = slicer_bridge.wait(job["id"], timeout=20)
        self.assertEqual((job["status"], job["stage"]), ("cancelled", "slice"))
        self.assertEqual(slicer_bridge.export(job["id"])["outcome"]["status"], "cancelled")

    def test_a_job_that_is_not_there_has_no_report(self):
        with self.assertRaisesRegex(ValueError, "not available"):
            slicer_bridge.export("nope")

    def test_the_engine_report_works_with_no_job_and_lists_recent_slices(self):
        job = self.fail_a_job("missing_library")
        report = slicer_bridge.export()
        self.assertEqual(report["kind"], "engine")
        self.assertIsNone(report["problem"])
        self.assertEqual(report["recent"][0]["id"], job["id"])
        self.assertEqual(report["recent"][0]["cause"], "missing_library")

    def test_the_help_report_carries_the_slicing_lines(self):
        self.fail_a_job("missing_library")
        text = "\n".join(slicer_bridge.help_lines())
        self.assertIn("stage slice", text)
        self.assertIn("cause missing_library", text)

    def test_the_job_list_stays_small_because_logs_live_in_the_report(self):
        job = self.fail_a_job("missing_library")
        self.assertNotIn("stderr", job)
        self.assertNotIn("run", job)

    def test_old_jobs_and_their_traces_are_dropped_together(self):
        self.configure()
        for _ in range(slicer_bridge.MAX_JOBS_KEPT + 3):
            job = slicer_bridge.start_job("spur_gear_24t.stl")
            slicer_bridge.wait(job["id"], timeout=20)
        self.assertEqual(len(slicer_bridge._traces), slicer_bridge.MAX_JOBS_KEPT)
        self.assertEqual(set(slicer_bridge._traces), set(slicer_bridge._jobs))


class TestEngineSupportAndChanges(SlicerBridgeTest):
    """B26: what is known about the engine, and an engine is never swapped without being read again."""

    def replace_engine(self):
        with open(self.orca, "a") as fh:
            fh.write("\n# updated\n")
        stat_info = os.stat(self.orca)
        os.utime(self.orca, ns=(stat_info.st_atime_ns, stat_info.st_mtime_ns + 5_000_000_000))

    def test_a_check_says_how_much_is_known_about_this_build(self):
        self.configure()
        result = slicer_bridge.check()
        self.assertEqual(result["support"]["level"], "untested")
        self.assertIn("Not tested at this version (2.3.2)", result["support"]["title"])
        self.assertEqual(slicer_bridge.public_settings()["last_check"]["support"]["level"], "untested")

    def test_a_failed_check_carries_no_support_claim(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "not_orca"
        self.assertNotIn("support", slicer_bridge.check())

    def test_the_report_names_what_is_known_about_the_engine(self):
        self.configure()
        slicer_bridge.check()
        job = slicer_bridge.wait(slicer_bridge.start_job("spur_gear_24t.stl")["id"], timeout=20)
        report = slicer_bridge.export(job["id"])
        self.assertEqual(report["engine"]["support"]["level"], "untested")
        self.assertIn("Tested so far", report["engine"]["support"]["detail"])

    def test_an_engine_updated_since_the_check_waits_for_a_new_check(self):
        self.configure()
        self.assertTrue(slicer_bridge.check()["ok"])
        os.remove(self.args_file)         # the check itself runs the program for its option list
        self.replace_engine()
        with self.assertRaisesRegex(ValueError, "changed since it was last checked"):
            slicer_bridge.start_job("spur_gear_24t.stl")
        with self.assertRaisesRegex(ValueError, "changed since it was last checked"):
            slicer_bridge.slice_model("spur_gear_24t.stl")
        self.assertFalse(os.path.exists(self.args_file), "the engine was never run")
        self.assertIsNotNone(slicer_bridge.engine_changed(slicer_bridge.get_settings(), self.orca))
        self.assertTrue(slicer_bridge.check()["ok"])
        job = slicer_bridge.wait(slicer_bridge.start_job("spur_gear_24t.stl")["id"], timeout=20)
        self.assertEqual(job["status"], "done")

    def test_another_program_switched_in_without_a_check_waits_for_one(self):
        # Settings clears the last check when the path is edited; the start-up variable and auto-detection can
        # change the program without that, which is the gap this closes.
        self.configure()
        self.assertTrue(slicer_bridge.check()["ok"])
        other = os.path.join(self.tmp, "orca-slicer-other")
        with open(other, "w") as fh:
            fh.write(FAKE_ORCA.format(python=sys.executable))
        os.chmod(other, os.stat(other).st_mode | stat.S_IEXEC)
        os.environ[slicer_bridge.ENV_PATH] = other
        with self.assertRaisesRegex(ValueError, "changed since it was last checked"):
            slicer_bridge.start_job("spur_gear_24t.stl")
        self.assertTrue(slicer_bridge.check()["ok"])
        job = slicer_bridge.wait(slicer_bridge.start_job("spur_gear_24t.stl")["id"], timeout=20)
        self.assertEqual(job["status"], "done")

    def test_choosing_another_path_in_settings_clears_the_old_check(self):
        self.configure()
        self.assertTrue(slicer_bridge.check()["ok"])
        other = os.path.join(self.tmp, "orca-slicer-other")
        with open(other, "w") as fh:
            fh.write(FAKE_ORCA.format(python=sys.executable))
        os.chmod(other, os.stat(other).st_mode | stat.S_IEXEC)
        slicer_bridge.save_settings({"slicer_path": other})
        self.assertIsNone(slicer_bridge.get_settings()["last_check"])
        self.assertIsNone(slicer_bridge.public_settings()["last_check"])

    def test_an_engine_that_was_never_checked_still_slices(self):
        self.configure()
        self.assertIsNone(slicer_bridge.engine_changed(slicer_bridge.get_settings(), self.orca))
        job = slicer_bridge.wait(slicer_bridge.start_job("spur_gear_24t.stl")["id"], timeout=20)
        self.assertEqual(job["status"], "done")
