"""
The tester fix release's page bugs in a real browser (tools/testfix-check.js), one scenario each.

Each came from a tester's report and each scenario fails on the code as it was before the fix:

  gauge      a script error (Cannot read properties of null) when the print-health gauge was replaced while it was animating
  timelapse  the time-lapse list blanked and came back whenever the switch was flipped or the printer was slow to answer
  keep       Keep a copy here held a connection for the whole copy; it is now a background copy with progress
  aiwidth    the AI shortcut in a card heading grew by 20 px on hover and moved the title and the switch beside it
  camera     a saved camera address that failed stopped the picture; the printer's own camera is now the fallback, by itself
  lost       a moment without the server showed "Failed to fetch" errors and turned the note button into an alert
  limit      six long requests used up the browser's six connections to one address, so the next request waited as long as they ran
  freeze     an idle printer's page froze for about 4 s in every 10 because the 3D twin was drawn again and again with nothing new to show
  report     the report's "fix first" list took 1,100 px for ten rows; the headline and all ten closed rows now fit one 1366 x 800 screen

It needs Node, Playwright for Node and a Chromium, so it is skipped where they are missing (GitHub's Python jobs).
"""

import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TOOL = os.path.join(ROOT, "tools", "testfix-check.js")


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
class TestTheTesterFixPageBugs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        done = subprocess.run(["node", TOOL], capture_output=True, timeout=900, cwd=ROOT)
        cls.out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        cls.code = done.returncode

    def test_every_scenario_passed(self):
        self.assertEqual(self.code, 0, self.out[-4000:])
        self.assertIn("0 failed", self.out)

    def test_each_scenario_ran_and_checked_something(self):
        for name in ("gauge", "timelapse", "keep", "aiwidth", "camera", "lost", "limit", "freeze", "report"):
            self.assertIn("--- " + name, self.out, name)
            self.assertRegex(self.out, r"ok   %s: " % name)


if __name__ == "__main__":
    unittest.main()
