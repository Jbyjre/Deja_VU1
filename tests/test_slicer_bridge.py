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
import stat
import sys
import tempfile
import textwrap
import time
import unittest

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
    if "--help" in args:
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
        file_library.save("dock_bracket.stl", sample_files.build("dock_bracket.stl"), origin="sample")

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
        self.assertIn("Install OrcaSlicer yourself", s["problem"])
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
        report = slicer_bridge.slice_model("dock_bracket.stl")
        with open(self.args_file) as fh:
            args = json.load(fh)
        self.assertEqual(args[:2], ["--slice", "0"])
        self.assertEqual(args[args.index("--load-settings") + 1], f"{self.machine};{self.process}")
        self.assertEqual(args[args.index("--load-filaments") + 1], self.filament)
        self.assertTrue(args[-1].endswith("dock_bracket.stl"))
        self.assertEqual(report["files"][0]["name"], "dock_bracket.gcode")
        self.assertGreater(report["files"][0]["layers"], 0)
        entry = file_library.describe("dock_bracket.gcode")
        self.assertEqual(entry["origin"], "sliced")
        self.assertIn(profile["name"], entry["note"])
        self.assertIn("2.3.2", entry["note"])
        # Slicing again never overwrites the first file.
        again = slicer_bridge.slice_model("dock_bracket.stl")
        self.assertEqual(again["files"][0]["name"], "dock_bracket-2.gcode")

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
            slicer_bridge.slice_model("dock_bracket.stl")
        self.assertEqual(set(self.library_names()), before)
        return ctx.exception.report

    def test_orca_error_code_is_put_into_words(self):
        report = self.assertFailsWithoutAFile("config_error", "couldn't load one of the preset files")
        self.assertEqual(report["orca_result"]["return_code"], -5)
        self.assertIn("can not resolve preset", report["error_tail"])

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
            slicer_bridge.slice_model("dock_bracket.stl")


class TestJobs(SlicerBridgeTest):
    def test_slice_and_queue(self):
        self.configure()
        done = []
        job = slicer_bridge.start_job("dock_bracket.stl", queue_to="u1-garage", on_done=done.append)
        job = slicer_bridge.wait(job["id"])
        self.assertEqual(job["status"], "queued", job)
        queued = print_queue.get("u1-garage")["items"]
        self.assertEqual([i["filename"] for i in queued], ["dock_bracket.gcode"])
        self.assertEqual(queued[0]["status"], "queued")     # queued, not started: the gate comes later
        self.assertEqual(mock_moonraker.printer_ids()[2], "u1-garage")
        time.sleep(0.1)
        self.assertEqual(done[0]["status"], "queued")

    def test_failed_job_is_worded_and_listed(self):
        self.configure()
        os.environ["FAKE_ORCA_MODE"] = "config_error"
        job = slicer_bridge.wait(slicer_bridge.start_job("dock_bracket.stl")["id"])
        self.assertEqual(job["status"], "failed")
        self.assertIn("preset", job["error"])
        self.assertEqual(slicer_bridge.jobs()["jobs"][0]["id"], job["id"])

    def test_previous_output_is_remembered_for_what_changed(self):
        self.configure()
        first = slicer_bridge.wait(slicer_bridge.start_job("dock_bracket.stl")["id"])
        second = slicer_bridge.start_job("dock_bracket.stl")
        self.assertEqual(second["previous"], first["report"]["files"][0]["name"])
        slicer_bridge.wait(second["id"])

    def test_refuses_to_start_without_a_slicer(self):
        with self.assertRaisesRegex(ValueError, "No slicer set up"):
            slicer_bridge.start_job("dock_bracket.stl")


if __name__ == "__main__":
    unittest.main()
