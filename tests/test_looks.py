"""The looks (frontend/looks.css): Workbench, Control room and Glass, chosen before first paint, readable."""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(name):
    with open(os.path.join(ROOT, "frontend", name), encoding="utf-8") as f:
        return f.read()


LOOKS = read("looks.css")
DARK = read("dark.css")
BOOT = read("theme-boot.js")
INDEX = read("index.html")


def lum(hex_colour):
    rgb = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def block(selector_start):
    """The token block that starts with this selector."""
    i = LOOKS.index(selector_start + " {")
    return LOOKS[i:LOOKS.index("}", i)]


def tok(text, name, fallback=None):
    m = re.search(rf"--{name}:\s*(#[0-9a-fA-F]{{6}})", text)
    return m.group(1) if m else fallback


class TestLooks(unittest.TestCase):
    def test_three_looks_and_glass_by_default(self):
        self.assertIn("var LOOKS = ['glass', 'workbench', 'control'];", BOOT)
        self.assertIn("var DEFAULT_LOOK = 'glass';", BOOT)
        self.assertIn("return LOOKS.indexOf(v) >= 0 ? v : DEFAULT_LOOK;", BOOT)
        self.assertNotIn("? v : 'workbench'", BOOT)
        for look in ("workbench", "control", "glass"):
            self.assertIn(f'data-look-choice="{look}"', INDEX)
        # Set in the head, before anything is drawn, by the same script as the theme.
        head = INDEX[:INDEX.index("</head>")]
        self.assertIn('href="looks.css"', head)
        self.assertIn("applyLook(look());", BOOT)

    def test_text_tokens_pass_wcag_aa_on_their_panels(self):
        wb = ':root:is([data-ui="workbench"], [data-ui="control"]):not(#ui)'
        sets = {
            "workbench light": block(wb),
            "workbench dark": block(':root:is([data-ui="workbench"], [data-ui="control"])[data-theme="dark"]:not(#ui)'),
        }
        sets["control light"] = sets["workbench light"] + block(':root[data-ui="control"]:not(#ui)')
        sets["control dark"] = sets["workbench dark"] + block(':root[data-ui="control"][data-theme="dark"]:not(#ui)')
        for name, text in sets.items():
            # Later declarations in the joined text win, as in the page.
            def last(token):
                found = re.findall(rf"--{token}:\s*(#[0-9a-fA-F]{{6}})", text)
                return found[-1] if found else None
            for surface in ("wb-panel", "wb-raised", "wb-bg"):
                bg = last(surface)
                for fg in ("text", "text-dim", "text-faint"):
                    colour = last(fg) or tok(DARK, fg)
                    self.assertIsNotNone(colour, f"{name}: no --{fg}")
                    self.assertGreaterEqual(contrast(colour, bg), 4.5, f"{name}: --{fg} {colour} on --{surface} {bg}")

    def test_emergency_stop_always_stands_out(self):
        self.assertIn(".btn.estop:not(#ui):not(:disabled) { background: #c8102e;", LOOKS)
        self.assertGreaterEqual(contrast("#ffffff", "#c8102e"), 4.5)

    def test_the_moving_background_belongs_to_glass_only(self):
        backdrop = read("backdrop.js")
        self.assertIn("!glassLook() ? 'still'", backdrop)
        self.assertIn("window.addEventListener('dv-ui'", backdrop)
        self.assertIn(".bg { display: none; }", LOOKS)

    def test_no_sparkle_glass_or_pills_in_the_new_looks(self):
        self.assertIn('.tips-btn > span[aria-hidden="true"] { display: none; }', LOOKS)
        self.assertIn("backdrop-filter: none;", LOOKS)
        self.assertIn("--wb-r: 8px;", LOOKS)

    def test_no_id_inside_a_grouped_selector(self):
        # :is() takes the priority of its strongest member: one id inside lifts the whole group
        # above every later class rule, which once hid the dark theme's status tints.
        for name, css in (("dark.css", DARK), ("looks.css", LOOKS)):
            for group in re.findall(r":is\(([^)]*)\)", css):
                self.assertNotIn("#", group, f"{name}: an id inside :is({group[:60]}...)")


class TestSpacing(unittest.TestCase):
    def test_comfortable_by_default_and_compact_on_request(self):
        self.assertIn("var DENSITIES = ['comfortable', 'compact'];", BOOT)
        self.assertIn("return DENSITIES.indexOf(v) >= 0 ? v : 'comfortable';", BOOT)
        self.assertIn("applyDensity(density());", BOOT)
        for choice in ("comfortable", "compact"):
            self.assertIn(f'data-density-choice="{choice}"', INDEX)
        self.assertIn("compact", LOOKS)
        self.assertIn('html[data-density="compact"]:not(#dv) .card {', LOOKS)

    def test_compact_leaves_text_sizes_alone(self):
        block = LOOKS[LOOKS.index("Spacing: Compact"):]
        self.assertNotIn("font-size", block)


if __name__ == "__main__":
    unittest.main()
