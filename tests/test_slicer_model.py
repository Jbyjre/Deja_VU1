"""
The Slicer's plate model (frontend/slicer-model.js): packing, turning, laying a face down, undo, plates, cutting and splitting into edited parts, and
every check that says what is wrong with a plate. And the cutting geometry (frontend/slicer-cut.js): every part a cut makes is a closed solid, the
parts add up to the model's volume, the cut face is closed round holes, and the bytes of an edited model are a valid STL. Neither has graphics, so
both run in Node; this test runs tests/slicer_model_check.js and tests/slicer_cut_check.js and fails on any line that does not start with "ok".
"""

import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


@unittest.skipUnless(shutil.which("node"), "Node is not installed")
class TestSlicerModel(unittest.TestCase):
    def test_every_check_passes(self):
        for script, at_least in (("slicer_model_check.js", 30), ("slicer_cut_check.js", 20)):
            with self.subTest(script=script):
                proc = subprocess.run(["node", os.path.join(HERE, script)], capture_output=True, text=True, timeout=180)
                lines = [ln for ln in proc.stdout.splitlines() if ln.startswith(("ok", "FAIL"))]
                self.assertGreaterEqual(len(lines), at_least, proc.stdout + proc.stderr)
                failed = [ln for ln in lines if ln.startswith("FAIL")]
                self.assertEqual(failed, [], "\n".join(failed))
                self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)


if __name__ == "__main__":
    unittest.main()
