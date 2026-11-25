"""
The colour checker's setup window in a real browser (tools/colour-setup-check.js): the Wi-Fi details and the settings.toml they make,
four ways to hand them over, finding a Pico that posts over Wi-Fi and giving it a head, the channel test, the brightness, the white
reference and a measured colour, then a second Pico through a fake USB port: connecting, sending the Wi-Fi details down the cable,
and a command answered at once.

The Pico is the real firmware file running as a process against a model of the sensor (tools/colour_pico_sim.py); the server and its
sockets are real. Nothing here measures a real colour or runs on a Pico W. It needs Node, Playwright for Node and a Chromium, so it is
skipped where they are missing.
"""

import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TOOL = os.path.join(ROOT, "tools", "colour-setup-check.js")


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
class TestTheColourSetup(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        done = subprocess.run(["node", TOOL], capture_output=True, timeout=900, cwd=ROOT)
        cls.out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        cls.code = done.returncode

    def test_every_check_passed(self):
        self.assertEqual(self.code, 0, self.out[-4000:])
        self.assertIn("All colour setup checks passed", self.out)
        self.assertNotIn("FAIL", self.out)

    def test_it_walked_the_whole_journey(self):
        for line in ("a password with a quote, a backslash, a newline and an accent is written as a TOML string",
                     "the download is settings.toml with the real password and address",
                     "the password never reached the server",
                     "Find the right brightness reaches the Wi-Fi sensor and its answer comes back",
                     "an orange spool reads as an orange",
                     "after the gain changes the window says what changed",
                     "the page connects to the Pico over USB and it says hello",
                     "sending Wi-Fi details over USB reports the result and never repeats the password"):
            self.assertIn(line, self.out)


if __name__ == "__main__":
    unittest.main()
