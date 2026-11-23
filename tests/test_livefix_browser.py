"""
The faults the live run on a real U1 found (22 November 2026), in a real browser (tools/livefix-check.js), one scenario each.

  resume   a U1 that still holds a halted print shows the Saved print card; Discard asks twice and sends the printer's own command
  bed      Confirm Print after a print ended on the bed shows where it sat and keeps Start print off until the bed is ticked
  dirty    a pause for a dirty bed shows the printer's own words and what to do
  errcard  the explain button opens the explanation, not the print tile's panel, even when the tile repaints under the mouse
  looks    switching the look to Workbench and back to Glass leaves the Printer screen drawn (not reproduced as a fault in Chromium here)
  phone    at 390 px on a phone, the buttons a finger presses are at least 32 px high

The stand-in printer is tests/fake_moonraker.py run as its own process (a pretend printer, not a real U1). It needs Node, Playwright for
Node and a Chromium, so it is skipped where they are missing.
"""

import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TOOL = os.path.join(ROOT, "tools", "livefix-check.js")


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
class TestTheLiveRunPageFaults(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        done = subprocess.run(["node", TOOL], capture_output=True, timeout=900, cwd=ROOT)
        cls.out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        cls.code = done.returncode

    def test_every_scenario_passed(self):
        self.assertEqual(self.code, 0, self.out[-4000:])
        self.assertNotIn("FAIL", self.out)

    def test_each_scenario_ran_and_checked_something(self):
        for name in ("resume", "bed", "dirty", "errcard", "looks", "phone"):
            self.assertRegex(self.out, r"ok   %s: " % name)


if __name__ == "__main__":
    unittest.main()
