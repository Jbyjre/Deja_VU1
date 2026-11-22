"""
The Slicer's plate model (frontend/slicer-model.js): packing, turning, laying a face down, undo, plates and every check that says what is
wrong with a plate. The model has no graphics, so it runs in Node; this test runs tests/slicer_model_check.js and fails on any line that
does not start with "ok".
"""

import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


@unittest.skipUnless(shutil.which("node"), "Node is not installed")
class TestSlicerModel(unittest.TestCase):
    def test_every_check_passes(self):
        proc = subprocess.run(["node", os.path.join(HERE, "slicer_model_check.js")], capture_output=True, text=True, timeout=120)
        lines = [ln for ln in proc.stdout.splitlines() if ln.startswith(("ok", "FAIL"))]
        self.assertGreaterEqual(len(lines), 20, proc.stdout + proc.stderr)
        failed = [ln for ln in lines if ln.startswith("FAIL")]
        self.assertEqual(failed, [], "\n".join(failed))
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)


if __name__ == "__main__":
    unittest.main()
