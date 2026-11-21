"""
The error code window in a real browser (tools/errorhelp-check.js): the strip on the print tile, the window with the code in four groups and
Snapmaker's words, a guide whose markup stays text, a video that loads nothing until it is pressed, the lookup, the Care card and a phone's width.

The wiki and YouTube are answered by the script; nothing leaves the machine. It needs Node, Playwright for Node and a Chromium, so it is skipped
where they are missing (GitHub's Python jobs).
"""

import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TOOL = os.path.join(ROOT, "tools", "errorhelp-check.js")


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
class TestTheErrorCodeWindow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        done = subprocess.run(["node", TOOL], capture_output=True, timeout=600, cwd=ROOT)
        cls.out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        cls.code = done.returncode

    def test_every_check_passed(self):
        self.assertEqual(self.code, 0, self.out[-4000:])
        self.assertIn("0 failed", self.out)

    def test_the_checks_that_matter_ran(self):
        for words in ("strip: pressing it did not also open", "guide: markup in a guide stays plain text",
                      "video: the player carries a referrer policy", "phone: no sideways scroll"):
            self.assertIn(words, self.out)


if __name__ == "__main__":
    unittest.main()
