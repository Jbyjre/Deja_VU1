"""Light / Dark / System (frontend/theme-boot.js, frontend/dark.css): applied before first paint, readable."""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(name):
    with open(os.path.join(ROOT, "frontend", name), encoding="utf-8") as f:
        return f.read()


INDEX = read("index.html")
DARK = read("dark.css")
APP = read("app.js")
PANELS = {"panel": "#18212d", "raised": "#202c3a", "page": "#10151d"}


def lum(hex_colour):
    rgb = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def token(name):
    m = re.search(rf"--{name}:\s*(#[0-9a-fA-F]{{6}})", DARK)
    return m.group(1) if m else None


class TestDarkTheme(unittest.TestCase):
    def test_the_choice_is_applied_in_the_head_before_anything_is_drawn(self):
        head = INDEX[:INDEX.index("</head>")]
        self.assertIn('<script src="theme-boot.js"></script>', head)
        sheets = re.findall(r'<link rel="stylesheet" href="([^"]+)"', head)
        self.assertEqual(sheets[-2:], ["dark.css", "looks.css"])
        self.assertLess(head.index('href="dark.css"'), head.index("theme-boot.js"))
        boot = read("theme-boot.js")
        self.assertNotIn("defer", INDEX[INDEX.index("theme-boot.js") - 40:INDEX.index("theme-boot.js") + 20])
        for word in ("'dark'", "'system'", "prefers-color-scheme: dark", "data-theme", "dv-theme"):
            self.assertIn(word, boot)

    def test_three_choices_in_preferences(self):
        for choice in ("light", "dark", "system"):
            self.assertIn(f'data-theme-choice="{choice}"', INDEX)
        self.assertIn("color-scheme: dark", DARK)

    def test_text_colours_pass_wcag_aa_on_every_dark_panel(self):
        for name in ("text", "text-dim", "text-faint", "accent-text", "ok-text", "warn-text", "bad-text"):
            colour = token(name)
            self.assertIsNotNone(colour, f"dark.css has no --{name}")
            for panel, bg in PANELS.items():
                self.assertGreaterEqual(contrast(colour, bg), 4.5, f"--{name} {colour} on the {panel} {bg}")

    def test_every_accent_has_a_readable_dark_shade(self):
        accents = re.findall(r"\{ id: '([a-z]+)'.*?darkText: '(#[0-9a-f]{6})' \}", APP)
        self.assertEqual(len(accents), 4)
        for ident, colour in accents:
            for panel, bg in PANELS.items():
                self.assertGreaterEqual(contrast(colour, bg), 4.5, f"{ident} accent text on the {panel}")

    def test_nothing_is_inverted(self):
        # Camera pictures, thumbnails and filament swatches keep their real colours.
        self.assertNotRegex(DARK, r"filter:\s*invert|mix-blend-mode:\s*difference")

    def test_canvas_and_3d_follow_the_theme(self):
        self.assertIn("dv-theme", read("backdrop.js"))
        self.assertIn("dv-theme", read("twin3d.js"))


if __name__ == "__main__":
    unittest.main()
