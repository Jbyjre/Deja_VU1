"""The left sidebar (frontend/rail.js): every destination opens a screen and part that exist."""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(name):
    with open(os.path.join(ROOT, "frontend", name), encoding="utf-8") as f:
        return f.read()


RAIL = read("rail.js")
APP = read("app.js")
INDEX = read("index.html")
DEST = re.findall(r"\['([a-z]+)', '([^']+)', '([a-z]+)', (null|'[a-z]+'), '(main|tools)'\]", RAIL)
ICONS = set(re.findall(r"^\s+([a-z]+): 'M", RAIL, re.M))


def sections():
    """{screen: [part ids]} from app.js SECTIONS."""
    block = APP[APP.index("const SECTIONS = {"):APP.index("const SECTION_KEY")]
    out, screen = {}, None
    for line in block.splitlines():
        m = re.match(r"\s{2}([a-z]+): \[$", line)
        if m:
            screen = m.group(1)
            out[screen] = []
        m = re.match(r"\s{4}\['([a-z]+)', '", line)
        if m and screen:
            out[screen].append(m.group(1))
    return out


class TestRail(unittest.TestCase):
    def test_the_destinations_the_plan_asks_for(self):
        ids = [d[0] for d in DEST]
        for wanted in ("overview", "printers", "printer", "library", "prepare", "jobs", "materials", "care",
                       "settings"):
            self.assertIn(wanted, ids)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreaterEqual(len(DEST), 16)

    def test_every_destination_opens_a_real_screen_and_part(self):
        parts = sections()
        for ident, label, tab, part, _group in DEST:
            self.assertIn(f'id="tab-{tab}"', INDEX, f"{label}: no screen tab-{tab}")
            if part != "null":
                self.assertIn(part.strip("'"), parts.get(tab, []), f"{label}: {tab} has no part {part}")
            self.assertIn(ident, ICONS, f"{label} has no icon")

    def test_old_screen_names_still_resolve(self):
        old = dict(re.findall(r"([a-z]+): '([a-z]+)'", RAIL[RAIL.index("const OLD"):RAIL.index("const COLLAPSE_KEY")]))
        tabs = set(re.findall(r'data-tab="([a-z]+)"', INDEX))
        ids = {d[0] for d in DEST}
        for name, dest in old.items():
            self.assertIn(dest, ids)
        for tab in tabs:
            self.assertTrue(tab in ids or tab in old, f"the old screen name {tab} has no destination")

    def test_the_sidebar_loads_last_and_keeps_the_phone_layout(self):
        scripts = re.findall(r'<script src="([^"]+)"', INDEX)
        self.assertEqual(scripts[-1], "rail.js")
        css = read("workshop.css")
        self.assertIn("@media (max-width: 720px) {\n  .rail { display: none; }", css)
        self.assertIn("window.dispatchEvent(new CustomEvent('dv-tab'", APP)


class TestRailLiveParts(unittest.TestCase):
    """What the sidebar draws from the live fleet and how it is used from the keyboard (looked at in Chromium, 7 November 2026)."""

    def test_it_follows_the_fleet_the_page_already_receives(self):
        self.assertIn("window.addEventListener('dv-fleet'", RAIL)
        for part in ("rail-dot", "rail-progress", "rail-badge", "rail-switch", "rail-menu"):
            self.assertIn(part, RAIL, part)
        # Every item keeps an accessible name when only the icon shows, and says what the badge counts.
        self.assertIn("a.setAttribute('aria-label', label[d.id])", RAIL)
        self.assertNotIn('title="${esc(d.label)}"', RAIL)
        self.assertIn("printers need you", RAIL)
        self.assertIn("printers have upkeep due", RAIL)

    def test_the_keyboard_moves_through_the_items_and_never_while_typing(self):
        for key in ("ArrowDown", "ArrowUp", "Home", "End"):
            self.assertIn(key, RAIL)
        self.assertIn("e.key === '['", RAIL)
        self.assertIn("!typing(e.target)", RAIL)
        self.assertIn("setAttribute('tabindex'", RAIL)

    def test_tools_and_learn_folds_but_never_hides_the_place_you_are_in(self):
        self.assertIn("dejavu1.rail.tools", RAIL)
        self.assertIn("if (d.group === 'tools') setTools(true, false)", RAIL)
        css = read("workshop.css")
        self.assertIn(".rail-list.is-folded { display: none; }", css)
        # With icons only there is no heading to unfold from, so nothing may stay folded.
        self.assertIn("html.rail-collapsed .rail-list.is-folded { display: flex; }", css)

    def test_the_menu_and_the_label_beside_an_icon_are_hidden_on_phones_and_in_dark(self):
        css = read("workshop.css")
        self.assertIn(".rail-menu, .rail-tip { display: none; }", css)
        dark = read("dark.css")
        self.assertIn('.rail-menu.liquid-glass', dark)
        self.assertIn('.rail-tip', dark)
        looks = read("looks.css")
        self.assertIn(".rail, .rail-menu, .live-pill", looks)


if __name__ == "__main__":
    unittest.main()
