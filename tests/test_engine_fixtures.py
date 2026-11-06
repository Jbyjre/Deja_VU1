"""
tools/engine-fixtures.py: the same standard slices, repeated by anyone on any
system with a stand-in engine here. The real engines are not available to the
test suite, so this proves the tool, not a build.
"""

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))

import sample_files  # noqa: E402

TOOL = os.path.join(ROOT, "tools", "engine-fixtures.py")

FAKE = textwrap.dedent('''\
    #!{python}
    import json, os, sys
    args = sys.argv[1:]
    mode = os.environ.get("FAKE_MODE", "ok")
    if "--help" in args:
        if mode == "missing_library":
            sys.stderr.write("orca: error while loading shared libraries: libwebkit2gtk-4.1.so.0: "
                             "cannot open shared object file: No such file or directory\\n")
            sys.exit(127)
        print("OrcaSlicer-2.3.2:")
        sys.exit(0)
    out = args[args.index("--outputdir") + 1]
    if mode == "fail_vase" and "vase" in args[-1]:
        with open(os.path.join(out, "result.json"), "w") as fh:
            json.dump({{"return_code": -52, "error_string": "outside the bed"}}, fh)
        sys.exit(204)
    with open(os.path.join(out, "plate_1.gcode"), "w") as fh:
        fh.write(open(os.environ["FAKE_GCODE"]).read())
    with open(os.path.join(out, "result.json"), "w") as fh:
        json.dump({{"return_code": 0, "error_string": "Success."}}, fh)
''')


class TestEngineFixtures(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="dv-fixtures-test-")
        self.engine = os.path.join(self.tmp, "orca-slicer")
        with open(self.engine, "w") as fh:
            fh.write(FAKE.format(python=sys.executable))
        os.chmod(self.engine, 0o755)
        self.gcode = os.path.join(self.tmp, "cube.gcode")
        with open(self.gcode, "wb") as fh:
            fh.write(sample_files.build("calibration_cube_20mm.gcode"))
        self.presets = {}
        for kind in ("machine", "process", "filament"):
            self.presets[kind] = os.path.join(self.tmp, f"{'Snapmaker U1' if kind == 'machine' else kind}.json")
            with open(self.presets[kind], "w") as fh:
                json.dump({"name": kind, "type": kind, "from": "User"}, fh)
        self.real_data = os.path.join(self.tmp, "real-data")
        os.makedirs(self.real_data)

    def run_tool(self, mode="ok"):
        result_file = os.path.join(self.tmp, "result.json")
        env = dict(os.environ, FAKE_MODE=mode, FAKE_GCODE=self.gcode, DEJAVU_DATA_DIR=self.real_data)
        proc = subprocess.run(
            [sys.executable, TOOL, "--engine", self.engine, "--machine", self.presets["machine"],
             "--process", self.presets["process"], "--filament", self.presets["filament"], "--json", result_file],
            capture_output=True, text=True, env=env, timeout=180)
        result = None
        if os.path.isfile(result_file):
            with open(result_file, encoding="utf-8") as fh:
                result = json.load(fh)
        return proc, result

    def test_every_fixture_passes_and_the_row_for_the_document_is_printed(self):
        proc, result = self.run_tool()
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual([r["fixture"] for r in result["fixtures"]],
                         ["spur_gear_24t.stl", "twisted_vase.stl", "3dbenchy.stl"])
        self.assertTrue(all(r["ok"] and r["layers"] > 0 for r in result["fixtures"]))
        self.assertEqual((result["check"]["app"], result["check"]["version"]), ("OrcaSlicer", "2.3.2"))
        self.assertEqual(result["check"]["support"]["level"], "untested")
        self.assertIn("3 of 3 fixtures passed", proc.stdout)
        self.assertIn("| OrcaSlicer | 2.3.2 |", proc.stdout)

    def test_a_failing_fixture_is_named_with_its_stage_and_cause_and_the_exit_code_says_so(self):
        proc, result = self.run_tool("fail_vase")
        self.assertEqual(proc.returncode, 1)
        failed = [r for r in result["fixtures"] if not r["ok"]]
        self.assertEqual([r["fixture"] for r in failed], ["twisted_vase.stl"])
        self.assertEqual(failed[0]["failure"]["code"], "orca_-52")
        self.assertEqual(failed[0]["stage"], "slice")
        self.assertIn("FAIL  twisted_vase.stl", proc.stdout)
        self.assertIn("2 of 3 fixtures passed", proc.stdout)

    def test_an_engine_that_cannot_start_stops_at_the_check_with_what_to_try(self):
        proc, result = self.run_tool("missing_library")
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(result["fixtures"], [])
        self.assertEqual(result["check"]["cause"]["code"], "missing_library")
        self.assertIn("libwebkit2gtk-4.1.so.0", proc.stdout)
        self.assertIn("What to try", proc.stdout)

    def test_it_never_touches_the_real_data_folder(self):
        self.run_tool()
        self.assertEqual(os.listdir(self.real_data), [])


if __name__ == "__main__":
    unittest.main()
