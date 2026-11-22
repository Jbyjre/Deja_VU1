"""
The browser walk (tools/browser-walk.js): every place in the sidebar and the main workflows (import,
Confirm Print, queue, model, the Slicer, pairing) in a real Chromium, with demo data, in light and dark.

It needs Node, Playwright for Node and a Chromium, so it is skipped where they are missing (GitHub's Python
jobs). Run it by hand with `python3 -m unittest tests.test_browser_walk` or run the tool for the full table:
`node tools/browser-walk.js`.
"""

import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TOOL = os.path.join(ROOT, "tools", "browser-walk.js")


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
class TestBrowserWalk(unittest.TestCase):

    def test_every_place_and_workflow_passes_in_a_real_browser(self):
        done = subprocess.run(["node", TOOL, "--quick"], capture_output=True, timeout=900, cwd=ROOT)
        out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        self.assertEqual(done.returncode, 0, "The browser walk failed:\n" + out[-3000:])
        self.assertIn("PASSED", out)

    def test_the_walk_reads_the_places_from_the_sidebar_itself(self):
        # A place added to rail.js is walked without touching the tool: the tool must find its table.
        with open(os.path.join(ROOT, "frontend", "rail.js"), encoding="utf-8") as f:
            source = f.read()
        self.assertIn("const DEST = [", source)
        self.assertIn("].map(([id, label, place, tab, part, sep, hide])", source)
        with open(TOOL, encoding="utf-8") as f:
            tool = f.read()
        self.assertIn("const DEST = [", tool)


if __name__ == "__main__":
    unittest.main()
