"""
The Slicer in a real browser (tools/slicer-check.js): the screen and its old links, the U1's plate in the app's own room colours, a model on the
plate with its real size, undo and redo, turning, dragging, laying on a face, arranging, orienting, problems with their fixes, the prime tower,
the dock's dials and the full settings sheet, slicing with a stand-in engine, the Preview and its sliders, a model handed over from Files, the
project coming back after a reload, and the phone's width in light and dark.

The engine is a stand-in (tools/stand-in-engine.py) and nothing leaves the machine. It needs Node, Playwright for Node and a Chromium, so it is
skipped where they are missing (GitHub's Python jobs).
"""

import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TOOL = os.path.join(ROOT, "tools", "slicer-check.js")


def _browser_ready():
    node = shutil.which("node")
    if not node:
        return False
    try:
        done = subprocess.run([node, TOOL, "--probe"], capture_output=True, timeout=60, cwd=ROOT)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return done.returncode == 0


@unittest.skipUnless(_browser_ready(), "Node, Playwright for Node and a Chromium are needed")
class TestTheSlicer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        done = subprocess.run(["node", TOOL], capture_output=True, timeout=900, cwd=ROOT)
        cls.out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        cls.code = done.returncode

    def test_every_check_passed(self):
        self.assertEqual(self.code, 0, self.out[-4000:])
        self.assertIn("0 failed", self.out)

    def test_it_walked_the_whole_journey(self):
        for line in ("the Slicer opens", "Slice plate runs the engine and finishes", "the Preview opens with the line types",
                     "a model opened in Files offers Open in Slicer", "the plate comes back after a reload", "390-dark: nothing scrolls sideways"):
            self.assertIn(line, self.out)


if __name__ == "__main__":
    unittest.main()
