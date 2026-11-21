"""
The glass system and the text system (frontend/glass.css, frontend/text.css, frontend/text.js, tools/text-audit.js).

The source checks run everywhere. The audit needs Node, Playwright for Node and a Chromium, so it is skipped where they are missing: it
stresses every screen at two widths with very long printer, file and task names and fails on text that is cut with no ellipsis, runs
out of its panel, collides with other text, wraps where a label must not, is under 11 px or has no way to be read in full, and on controls
under 24 px or without a name. Run it by hand with `node tools/text-audit.js` (add `--focus` to tab through every screen too).
"""

import json
import os
import re
import shutil
import subprocess
import sys
import unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from frontend_parts import read_frontend  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
AUDIT = os.path.join(ROOT, "tools", "text-audit.js")
GLASS = read_frontend("glass.css")
TEXT_CSS = read_frontend("text.css")
TEXT_JS = read_frontend("text.js")
COCKPIT_CSS = read_frontend("cockpit.css")
COCKPIT_JS = read_frontend("cockpit.js")
TWIN = read_frontend("twin3d.js")
PRINTER_PAGE = read_frontend("printer-page.js")


class TestGlassSystem(unittest.TestCase):
    def test_two_grades_of_glass_and_the_three_accessibility_settings(self):
        for token in ("--g-tint:", "--m-tint:", "--g-sh-3:", "--g-line:", "--r-card: 16px", "--room-top:", "--scene-sky:"):
            self.assertIn(token, GLASS)
        self.assertIn("@media (prefers-reduced-transparency: reduce)", GLASS)
        self.assertIn("@media (prefers-contrast: more)", GLASS)
        self.assertIn("@media (prefers-reduced-transparency: reduce)", COCKPIT_CSS)
        self.assertIn("@media (prefers-reduced-motion: reduce)", COCKPIT_CSS)
        self.assertIn("backdrop-filter: none; background: var(--m-tint-solid)", GLASS)        # reduced transparency makes every panel solid

    def test_cards_inside_the_room_and_overview_are_not_floating_panels(self):
        self.assertIn(":not(.cp *):not(.ovd *)", GLASS)
        self.assertNotIn(":not(.cp-sheet *):not(.cp-hold *)", GLASS)

    def test_the_room_is_a_fixed_layer_the_twin_frames_itself_in(self):
        stage = COCKPIT_CSS[COCKPIT_CSS.index("html.has-shell .cp-stage {"):]
        self.assertIn("position: fixed", stage[:stage.index("}")])
        for needle in ("--twin-fit", "--twin-dx", "--twin-dy"):
            self.assertIn(needle, COCKPIT_CSS)
            self.assertIn(needle, TWIN)
        self.assertIn("tagTemp", TWIN)                                                  # temperatures on the machine
        self.assertIn("id: 'bed'", TWIN)
        self.assertIn("id: 'chamber'", TWIN)

    def test_the_camera_window_takes_the_pictures_own_shape(self):
        self.assertIn("--cam-ar", PRINTER_PAGE)
        self.assertIn("aspect-ratio: var(--cam-ar, 16 / 9)", COCKPIT_CSS)
        self.assertIn("object-fit: contain", COCKPIT_CSS)                                  # the whole picture, never cropped

    def test_the_sidebar_opens_above_a_sheet_and_has_an_edge_strip(self):
        self.assertIn("html.has-shell .rail { z-index: 40; }", GLASS)
        self.assertIn(".rail-edge {", GLASS)


class TestRegressionsFoundByTheScans(unittest.TestCase):
    """Each of these was found by the accessibility scan or the text audit, on a screen that looked right."""

    def test_overview_stretches_its_columns_on_a_phone(self):
        # shrink-wrapped, the "Needs you" card became as wide as its longest unbroken line (516 px on a 390 px phone) and the page scrolled sideways
        phone = COCKPIT_CSS[COCKPIT_CSS.index("@media (max-width: 720px)"):]
        self.assertIn("html.has-shell .ovd { display: flex; flex-direction: column; align-items: stretch;", phone)

    def test_a_control_named_by_its_values_has_the_visible_text_in_its_name(self):
        # WCAG "label in name": an aria-label that does not contain the visible words fails; "Tune " plus the shown values does not
        self.assertNotIn('aria-label="Tune', COCKPIT_JS)
        self.assertIn('<span class="sr-only">Tune </span>', COCKPIT_JS)

    def test_text_js_loads_with_the_frame_scripts_and_text_css_before_the_looks(self):
        index = read_frontend("index.html")
        scripts = re.findall(r'<script src="([^"]+)"', index)
        self.assertLess(scripts.index("cockpit.js"), scripts.index("text.js"))
        self.assertLess(scripts.index("text.js"), scripts.index("pagebar.js"))
        sheets = re.findall(r'<link rel="stylesheet" href="([^"]+)"', index)
        self.assertLess(sheets.index("glass.css"), sheets.index("text.css"))
        self.assertLess(sheets.index("text.css"), sheets.index("looks.css"))

    def test_the_sidebar_leaves_the_way_for_a_sheet_and_for_the_keyboard(self):
        rail = read_frontend("rail.js")
        self.assertIn("CLICK_MS * 2 : LINGER_MS", rail)                                  # Tab out of it: it hands the screen over quickly
        self.assertIn("rail-edge", rail)
        self.assertIn("matches(':focus-visible')", rail)                                 # a mouse click leaves no focus that pins it open


class TestTextSystem(unittest.TestCase):
    def test_text_that_does_not_fit_is_cut_or_wrapped_by_rule(self):
        for needle in ("overflow-wrap: anywhere", "text-overflow: ellipsis", "text-wrap: balance", "text-wrap: pretty", ".mt > .mt-a", ".mt > .mt-b",
                       "-webkit-line-clamp: 3", "font-variant-numeric: tabular-nums"):
            self.assertIn(needle, TEXT_CSS)
        self.assertNotIn("font-size: 10", TEXT_CSS)          # nothing under 11 px
        floor = TEXT_CSS[TEXT_CSS.index("the size floor"):]
        self.assertIn("font-size: 11px", floor)

    def test_cut_text_can_be_read_and_file_names_keep_their_end(self):
        for needle in ("'pointerover'", "'focusin'", "MutationObserver", "requestAnimationFrame", "data-cut-title", "mt-a", "mt-b", "wbr", "softBreaks"):
            self.assertIn(needle, TEXT_JS)

    def test_a_long_file_name_is_cut_in_the_middle_between_words(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node is needed")
        script = (
            "const vm=require('vm'),fs=require('fs');"
            "const code=fs.readFileSync(process.argv[1],'utf8');"
            "const ctx={document:{readyState:'loading',addEventListener(){},body:{},querySelectorAll:()=>[]},MutationObserver:class{observe(){}disconnect(){}},"
            "requestAnimationFrame(){},getComputedStyle(){return {}}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);"
            "console.log(JSON.stringify(process.argv.slice(2).map(t=>ctx.DVText.split(t))));")
        names = ["two_benchies_two_colours_very_long_file_name_v12_final.gcode", "Snapmaker U1 bracket with a very long description 3.stl", "abcdefghijklmnopqrstuvwxyz.3mf"]
        done = subprocess.run([node, "-e", script, os.path.join(ROOT, "frontend", "text.js"), *names], capture_output=True, timeout=60, cwd=ROOT)
        self.assertEqual(done.returncode, 0, done.stderr.decode("utf-8", "replace"))
        for name, (head, tail) in zip(names, json.loads(done.stdout.decode())):
            self.assertEqual(head + tail, name)                                    # nothing lost, nothing added
            self.assertTrue(head, name)
            self.assertLessEqual(len(tail), 18, name)                              # the end that stays is short enough to fit beside the start
            self.assertTrue(re.search(r"\.(gcode|stl|3mf)$", tail), tail)          # and it always carries the extension
        # where a word break is near the end the cut falls on it, so no identifier is cut in two
        head, tail = json.loads(done.stdout.decode())[0]
        self.assertTrue(tail[0] in "_- .", tail)

    def test_the_audit_checks_every_kind_of_text_trouble(self):
        with open(AUDIT, encoding="utf-8") as f:
            audit = f.read()
        for kind in ("clipped", "outside", "hidden", "collide", "mute", "tiny", "wrap", "sideways", "target", "unnamed", "focus"):
            self.assertIn(f"add('{kind}'", audit) if kind != "focus" else self.assertIn("kind: 'focus'", audit)
        self.assertIn("route('**/api/**'", audit)                                      # the long names reach the page over the network, not through the product


def _browser_ready():
    node = shutil.which("node")
    if not node:
        return False
    try:
        done = subprocess.run([node, AUDIT, "--probe"], capture_output=True, timeout=60, cwd=ROOT)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return done.returncode == 0


@unittest.skipUnless(_browser_ready(), "Node, Playwright for Node and a Chromium are needed")
class TestTextAudit(unittest.TestCase):
    def test_no_screen_has_cut_hidden_colliding_or_unreadable_text(self):
        done = subprocess.run(["node", AUDIT, "--widths", "1366,390"], capture_output=True, timeout=1500, cwd=ROOT)
        out = done.stdout.decode("utf-8", "replace") + done.stderr.decode("utf-8", "replace")
        self.assertEqual(done.returncode, 0, "The text audit found problems:\n" + out[-4000:])


if __name__ == "__main__":
    unittest.main()
