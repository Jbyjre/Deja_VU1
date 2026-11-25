"""
The toolbar edge (frontend/pagebar.js) and the frame walk (tools/pagebar-walk.js).

There is no bar across the top of the page. The first row of the working surface names the place, shows its parts as tabs, holds
the place's own buttons and the search. The source checks run everywhere; the walk needs Node, Playwright for Node and a Chromium,
so it is skipped where they are missing (GitHub's Python jobs). Run it by hand with `python3 -m unittest tests.test_pagebar` or run
the tool: `node tools/pagebar-walk.js --shots <folder>`.
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
BOOT = read("frontend", "theme-boot.js")
SHELL = read("frontend", "shell.css")


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
class TestFrameWalk(unittest.TestCase):

    def test_the_frame_passes_in_a_real_browser(self):
        done = subprocess.run(["node", TOOL], capture_output=True, timeout=900, cwd=ROOT)
        out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        self.assertEqual(done.returncode, 0, "The frame walk failed:\n" + out[-3000:])
        self.assertIn("PASSED", out)
        self.assertIn("One press of Halt stops the printer and says so in words", out)
        self.assertIn("Overview shows no 3D printer", out)
        self.assertIn("Halt is on screen on the Printer screen and nowhere else", out)
        self.assertIn("Move opens a sheet with the pad and brings the 3D printer and the camera beside it", out)


class ToolbarEdgeSource(unittest.TestCase):
    """Source checks that run everywhere, without a browser."""

    def test_the_toolbar_edge_is_the_first_row_of_the_working_surface(self):
        main = INDEX[INDEX.index('<main class="wrap" id="main">'):]
        header = main[main.index('<header class="topbar" id="topbar">'):main.index("</header>")]
        for needle in ('id="pb-title"', 'id="pb-icon"', 'id="pb-sub"', 'id="pb-parts"', 'role="tablist"', 'id="pb-actions"', 'id="feature-search"',
                       'id="feature-results"'):
            self.assertIn(needle, header)
        self.assertNotIn("liquid-glass", header[:header.index(">")])       # the edge belongs to the surface, which is paper, not glass

    def test_what_other_scripts_write_to_by_id_is_kept_in_the_hidden_holder(self):
        holder = INDEX[INDEX.index('<div class="tb-hold" hidden>'):INDEX.index("</header>")]
        for needle in ('id="ver-chip"', 'id="private-greeting"', 'id="printer-chip"', 'id="demo-toggle"', 'id="pb-help"'):
            self.assertIn(needle, holder)

    def test_the_old_banner_and_the_page_look_switch_are_gone(self):
        header = INDEX[INDEX.index('<header class="topbar" id="topbar">'):INDEX.index("</header>")]
        self.assertNotIn('class="brand', header)          # the brand sits at the top of the sidebar now
        self.assertNotIn("launch-strip", INDEX)
        self.assertNotIn('id="notice"', INDEX)
        self.assertNotIn("html[data-page", SHELL)
        theme_shell = read("frontend", "theme-shell.css")
        self.assertNotIn(".pb-page", theme_shell)
        self.assertNotIn("html.pb-help-open", theme_shell)

    def test_the_scripts_load_in_the_order_the_frame_needs(self):
        scripts = re.findall(r'<script src="([^"]+)"', INDEX)
        self.assertEqual(scripts[-1], "intro.js")
        self.assertEqual(scripts[-2], "rail.js")
        self.assertEqual(scripts[-3], "activity.js")           # the Activity tray mounts in the frame pagebar.js built
        self.assertEqual(scripts[-4], "pagebar.js")
        for name in ("panes.js", "deck.js", "cockpit.js", "overview.js", "settings.js", "strip.js"):
            self.assertLess(scripts.index(name), scripts.index("pagebar.js"), name)
        self.assertLess(scripts.index("deck.js"), scripts.index("cockpit.js"))
        self.assertLess(scripts.index("deck.js"), scripts.index("overview.js"))
        sheets = re.findall(r'<link rel="stylesheet" href="([^"]+)"', INDEX)
        self.assertEqual(sheets[-8:], ["dark.css", "shell.css", "shell-panes.css", "cockpit.css", "slicer.css", "glass.css", "text.css", "looks.css"])

    def test_the_frame_is_marked_in_the_head_before_anything_is_drawn(self):
        self.assertIn("classList.add('has-shell')", BOOT)
        self.assertIn("data-experience", BOOT)

    def test_the_parts_row_comes_from_the_place_and_asks_the_sidebar(self):
        for needle in ("Rail.partsOf(place)", "Rail.goDest(", "Rail.placeLabel(", "Rail.icon(", "role=\"tab\"", "aria-selected", "'dv-rail'"):
            self.assertIn(needle, PAGEBAR)
        for needle in ("partsOf: id =>", "goDest:", "placeLabel:", "place: () =>"):
            self.assertIn(needle, RAIL)
        self.assertNotIn("document.title", PAGEBAR)          # the browser tab already mirrors the print (app-shell.js)

    def test_every_button_the_bar_adds_presses_something_that_exists(self):
        dests = {d[0] for d in re.findall(r"\['([a-z]+)', '([^']+)', '([a-z]+)', '([a-z]+)', (?:null|'[a-z]+')", RAIL)}
        block = PAGEBAR[PAGEBAR.index("const ACTIONS = {"):PAGEBAR.index("function mirror(")]
        for place in re.findall(r"^\s{4}([a-z]+): \[", block, re.M):
            self.assertIn(place, dests, place + " is not a destination in the sidebar")
        ids = re.findall(r"mirror: '([^']+)'", block) + re.findall(r"\$\('([^']+)'\)", PAGEBAR[PAGEBAR.index("function openAddPrinter"):PAGEBAR.index("const ACTIONS")])
        self.assertTrue(ids)
        for one in ids:
            self.assertIn('id="%s"' % one, INDEX, one + " is not on the page")

    def test_pause_and_cancel_follow_the_screens_own_buttons_and_halt_is_not_here(self):
        # The screen's buttons ask first (Cancel asks twice) and say in words when the printer refuses: the toolbar is not a second path.
        self.assertIn("mirror: 'ctrl-pause-resume'", PAGEBAR)
        self.assertIn("mirror: 'ctrl-cancel'", PAGEBAR)
        self.assertIn("src.click()", PAGEBAR)
        self.assertIn("btn.hidden = src.hidden", PAGEBAR)          # they appear only while a print runs
        self.assertNotIn("estop", PAGEBAR.replace("Halt is not here", ""))

    def test_every_look_and_setting_has_its_form_of_the_frame(self):
        for needle in ("@media (max-width: 720px)", "@container topbar", "prefers-reduced-transparency", "prefers-contrast: more", "prefers-reduced-motion"):
            self.assertIn(needle, SHELL)
        looks = read("frontend", "looks.css")
        self.assertIn(".strip, .rail-card).liquid-glass", looks)      # Workbench and Control room make them solid panels

    def test_the_search_opens_as_a_command_bar_while_it_has_focus(self):
        for needle in (".feature-finder:focus-within", "top: 12vh", "min(620px", "#feature-results { position: static"):
            self.assertIn(needle, SHELL)


if __name__ == "__main__":
    unittest.main()
