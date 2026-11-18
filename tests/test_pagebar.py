"""
The page bar (frontend/pagebar.js): the slim bar at the top of every screen except Overview.

Overview keeps the banner. Every other screen shows its name, its parts as tabs, its own main buttons, then the printer,
search and help. The source checks run everywhere; the walk (tools/pagebar-walk.js) needs Node, Playwright for Node and a
Chromium, so it is skipped where they are missing (GitHub's Python jobs). Run it by hand with
`python3 -m unittest tests.test_pagebar` or run the tool: `node tools/pagebar-walk.js --shots <folder>`.
"""

import os
import re
import shutil
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from frontend_parts import read_frontend  # noqa: E402
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TOOL = os.path.join(ROOT, "tools", "pagebar-walk.js")


def read(*parts):
    if len(parts) == 2 and parts[0] == "frontend":
        return read_frontend(parts[1])     # a split file comes back whole (frontend_parts.py)
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


INDEX = read("frontend", "index.html")
PAGEBAR = read("frontend", "pagebar.js")
APP = read("frontend", "app.js")
RAIL = read("frontend", "rail.js")
THEME = read("frontend", "theme.css")
BOOT = read("frontend", "theme-boot.js")


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
class TestPageBarWalk(unittest.TestCase):

    def test_the_bar_passes_in_a_real_browser(self):
        done = subprocess.run(["node", TOOL], capture_output=True, timeout=600, cwd=ROOT)
        out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        self.assertEqual(done.returncode, 0, "The page bar walk failed:\n" + out[-3000:])
        self.assertIn("PASSED", out)
        self.assertIn("Emergency stop asks first, and saying no sends nothing", out)
        self.assertIn("A link to Printer never shows the Overview look", out)


class PageBarSource(unittest.TestCase):
    """Source checks that run everywhere, without a browser."""

    def test_the_header_has_the_places_the_bar_fills(self):
        for needle in ('id="pb-title"', 'id="pb-icon"', 'id="pb-actions"', 'id="pb-tabs"', 'id="pb-help"', 'id="feature-search"'):
            self.assertIn(needle, INDEX)
        header = INDEX[INDEX.index('<header class="topbar'):INDEX.index("</header>")]
        for needle in ('id="pb-tabs"', 'id="pb-help"', 'id="feature-search"', 'id="demo-toggle"', 'id="printer-chip"'):
            self.assertIn(needle, header)

    def test_the_old_top_of_the_page_is_gone(self):
        # The greeting row, the demo banner and the always-open intro line gave way to the bar and the ? note.
        self.assertNotIn("launch-strip", INDEX)
        self.assertNotIn('id="notice"', INDEX)
        self.assertNotIn("Your print bench", INDEX + read("frontend", "launchpad.js"))
        self.assertNotIn("$('notice')", APP)

    def test_the_script_loads_before_the_sidebar_which_stays_last(self):
        scripts = re.findall(r'<script src="([^"]+)"', INDEX)
        self.assertEqual(scripts[-1], "rail.js")
        self.assertEqual(scripts[-2], "pagebar.js")

    def test_the_first_paint_gets_the_right_look(self):
        # data-page is set in <head> from the link, the chosen start screen or the last screen, so a link never flashes.
        self.assertIn("firstPage", BOOT)
        self.assertIn("'data-page'", BOOT)
        self.assertIn("location.hash", BOOT)
        self.assertIn("dejavu1.pref.start", BOOT)
        self.assertIn("dejavu1.tab", BOOT)

    def test_screens_put_their_parts_in_the_bar_and_switch_the_look(self):
        self.assertIn("$('pb-tabs')", APP)
        self.assertIn("document.documentElement.dataset.page", APP)
        self.assertIn("function show(requested, initial = false)", APP)
        # The first call leaves the look to theme-boot.js.
        self.assertRegex(APP, r"store\.get\(TAB_KEY\) \|\| 'overview'\),\s*true\)")
        # The row of parts is no longer inside the panel, so the pressed state is read from the row itself.
        self.assertNotIn("panel.querySelectorAll('.sec-bar button')", APP)
        self.assertIn(".sec-bar[hidden] { display: none; }", THEME)

    def test_every_button_the_bar_adds_presses_something_that_exists(self):
        places = {d[0] for d in re.findall(r"\['([a-z]+)', '([^']+)', '([a-z]+)', (null|'[a-z]+'), '(main|tools)'\]", RAIL)}
        block = PAGEBAR[PAGEBAR.index("const ACTIONS = {"):PAGEBAR.index("function mirror(")]
        for place in re.findall(r"^\s{4}([a-z]+): \[", block, re.M):
            self.assertIn(place, places, place + " is not a place in the sidebar")
        ids = re.findall(r"mirror: '([^']+)'", block) + re.findall(r"\$\('([^']+)'\)", PAGEBAR[PAGEBAR.index("function openAddPrinter"):])
        self.assertTrue(ids)
        for one in ids:
            self.assertIn('id="%s"' % one, INDEX, one + " is not on the page")

    def test_the_emergency_stop_in_the_bar_presses_the_screens_own_button(self):
        # The screen's button asks first and says in words when the printer refuses; the bar must not be a second path.
        self.assertIn("mirror: 'pp-estop'", PAGEBAR)
        self.assertIn("src.click()", PAGEBAR)
        self.assertIn("confirm('Emergency stop?", read("frontend", "printer-page.js"))
        self.assertIn("src.disabled", PAGEBAR)

    def test_the_bar_reads_names_and_icons_from_the_sidebar(self):
        for needle in ("label: id =>", "icon: id =>", "dv-rail", "rail-brand"):
            self.assertIn(needle, RAIL)
        for needle in ("Rail.current()", "Rail.label(", "Rail.icon(", "'dv-rail'"):
            self.assertIn(needle, PAGEBAR)

    def test_every_look_and_setting_has_its_form_of_the_bar(self):
        for needle in ('html[data-page="page"] .topbar', "@media (max-width: 720px)", "@container topbar", "prefers-reduced-transparency",
                       "prefers-contrast: more", "prefers-reduced-motion"):
            self.assertIn(needle, THEME)
        looks = read("frontend", "looks.css")
        dark = read("frontend", "dark.css")
        self.assertIn(".pb-help", looks)
        self.assertIn(".pb-help", dark)
        # The search icon is a variable so dark and the squarer looks can keep it (a background shorthand wipes an image).
        self.assertIn("--pb-search-icon", THEME)
        self.assertIn("--pb-search-icon", dark)
        self.assertIn("--pb-search-icon", looks)

    def test_the_search_can_open_wider_than_its_holder(self):
        # A global max-width: 100% on inputs once held it to the 40 px round button.
        self.assertIn("max-width: none", THEME[THEME.index(".topbar .feature-finder input {"):][:400])


if __name__ == "__main__":
    unittest.main()
