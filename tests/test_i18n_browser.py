"""
The page side of translations in a real browser (frontend/i18n.js, tools/i18n-check.js).

  loader scenarios  English costs nothing and fetches nothing; the pseudo language reaches text that arrives later, a sentence with pieces,
                    attributes and dialogs and leaves code and translate="no" alone; a real language file translates, reorders the pieces and
                    leaves a text with no translation in English; the picker lists what is installed and a chosen language is kept; a missing
                    language file never breaks the page
  every screen      all 19 screens and every part of them are opened in English and in the pseudo language: no script error, the same cards,
                    headings, help buttons and part buttons on each (code that looks at its own English words would show up here), and most
                    of the visible words reached by the catalogue

It needs Node, Playwright for Node and a Chromium, so it is skipped where they are missing (GitHub's Python jobs).
The fit of longer words is `node tools/text-audit.js --lang pseudo` (see docs/translating.md).
"""

import os
import re
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TOOL = os.path.join(ROOT, "tools", "i18n-check.js")


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
class TestTranslationsInABrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        done = subprocess.run(["node", TOOL, "--widths", "1366"], capture_output=True, timeout=900, cwd=ROOT)
        cls.out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        cls.code = done.returncode

    def test_the_check_passed(self):
        self.assertEqual(self.code, 0, self.out[-4000:])

    def test_every_loader_scenario_ran_and_passed(self):
        self.assertRegex(self.out, r"Loader scenarios: \d+ ok, 0 failed")
        count = int(re.search(r"Loader scenarios: (\d+) ok", self.out).group(1))
        self.assertGreaterEqual(count, 20)
        for name in ("english-is-free", "pseudo-text", "pseudo-pattern", "pseudo-attributes", "pseudo-leaves-code", "pseudo-dialog",
                     "german-text", "german-pattern", "german-missing-stays-english", "german-picker", "german-back-to-english",
                     "missing-file"):
            self.assertRegex(self.out, r"ok   %s: " % name)
        self.assertNotIn("FAIL ", self.out)

    def test_no_screen_is_built_differently_in_another_language(self):
        self.assertIn("script errors: 0", self.out)
        self.assertIn("screens built differently in pseudo: 0", self.out)

    def test_most_of_the_visible_words_are_reached_by_the_catalogue(self):
        reached = float(re.search(r"reached by the catalogue: \d+ \(([\d.]+)%\)", self.out).group(1))
        self.assertGreater(reached, 55.0, self.out[-2500:])


if __name__ == "__main__":
    unittest.main()
