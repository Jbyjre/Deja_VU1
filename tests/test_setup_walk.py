"""
The first-run walk (tools/setup-walk.js): the setup screens a new user sees, in a real Chromium.

It starts its own server on an empty data folder and a stand-in printer, then checks that a printer address typed on the
printer step is connected by Continue and not thrown away, that a bad address is explained and can be skipped, that replaying
setup does not add the printer twice, that a phone gets five steps ending with the Home Screen step, that a browser blocking
saved settings does not bring the setup back on every reload, and the spacing of the printer step.

It needs Node, Playwright for Node and a Chromium, so it is skipped where they are missing (GitHub's Python jobs). Run it by
hand with `python3 -m unittest tests.test_setup_walk` or run the tool: `node tools/setup-walk.js --shots <folder>`.
"""

import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TOOL = os.path.join(ROOT, "tools", "setup-walk.js")


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
class TestSetupWalk(unittest.TestCase):

    def test_the_setup_screens_pass_in_a_real_browser(self):
        done = subprocess.run(["node", TOOL], capture_output=True, timeout=600, cwd=ROOT)
        out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        self.assertEqual(done.returncode, 0, "The setup walk failed:\n" + out[-3000:])
        self.assertIn("PASSED", out)
        self.assertIn("Continue with a typed printer address connects it and moves on", out)
        self.assertIn("A phone sees five steps ending with the Home Screen step", out)


class SetupSource(unittest.TestCase):
    """Source checks that run everywhere, without a browser (spacing in these tests does not matter)."""

    def read(self, *parts):
        with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
            return f.read()

    def test_the_shared_store_falls_back_when_the_browser_blocks_saved_settings(self):
        source = self.read("frontend", "app.js")
        start = source.index("const store = (() => {")
        block = source[start:start + 1500]
        for needle in ("localStorage", "sessionStorage", "remove(key)"):
            self.assertIn(needle, block)

    def test_the_setup_screens_keep_their_flag_through_the_shared_store(self):
        source = self.read("frontend", "launchpad.js")
        self.assertNotIn("localStorage", source)           # a direct localStorage call would skip the fallback
        self.assertIn("PHONE_STEPS", source)
        self.assertIn("Home Screen", source)


if __name__ == "__main__":
    unittest.main()
