"""The sidebar of eight places (frontend/rail.js): every destination opens a screen and part that exist."""

import os
import re
import unittest
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from frontend_parts import read_frontend  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(name):
    return read_frontend(name)          # a split file comes back whole (frontend_parts.py)


RAIL = read("rail.js")
APP = read("app.js")
INDEX = read("index.html")
PLACES = re.findall(r"\{ id: '([a-z]+)', label: '([^']+)', group: '(main|foot|more)'", RAIL)
DEST = re.findall(r"\['([a-z]+)', '([^']+)', '([a-z]+)', '([a-z]+)', (null|'[a-z]+')(?:, (?:true|false))*\]", RAIL)
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


class TestPlaces(unittest.TestCase):
    def test_the_eight_places_and_the_more_group(self):
        ids = [p[0] for p in PLACES]
        self.assertEqual([p[0] for p in PLACES if p[2] == "main"],
                         ["overview", "printer", "slicer", "files", "models", "ai", "maintenance"])
        self.assertEqual([p[0] for p in PLACES if p[2] == "foot"], ["settings"])
        self.assertEqual([p[0] for p in PLACES if p[2] == "more"], ["automations", "studio", "games"])
        self.assertEqual(len(ids), 11)
        labels = dict((p[0], p[1]) for p in PLACES)
        self.assertEqual(labels["studio"], "Photo studio")

    def test_every_place_has_a_home_and_an_icon(self):
        homes = {}
        for dest_id, _label, place, _tab, _part in DEST:
            homes.setdefault(place, dest_id)
        for place, _label, _group in PLACES:
            self.assertIn(place, homes, place + " has no destination")
            self.assertIn(place, ICONS, place + " has no icon")

    def test_settings_is_no_longer_a_sun(self):
        # The old icon was a circle with eight rays; the owner asked for a clear settings symbol of its own.
        self.assertNotIn("M12 3v2.5M12 18.5V21", RAIL)
        self.assertIn("settings: 'M4 7h9M17 7h3", RAIL)

    def test_every_destination_opens_a_screen_and_part_that_exist(self):
        parts = sections()
        self.assertGreaterEqual(len(DEST), 21)
        for dest_id, _label, _place, tab, part in DEST:
            self.assertIn('id="tab-%s"' % tab, INDEX, dest_id + ": no screen " + tab)
            if part != "null":
                self.assertIn(part.strip("'"), parts.get(tab, []), "%s: %s has no part %s" % (dest_id, tab, part))

    def test_the_parts_of_printer_are_the_plans(self):
        printer = [d for d in DEST if d[2] == "printer"]
        self.assertEqual([d[1] for d in printer],
                         ["Control", "Readings", "Camera & time-lapses", "History", "All printers", "Farm", "Practice printers"])
        self.assertIn("'printers', 'All printers', 'printer', 'fleet', 'printers', true", RAIL)    # a new group in the row

    def test_old_screen_names_still_resolve(self):
        ids = {d[0] for d in DEST}
        old = dict(re.findall(r"(\w+): '(\w+)'", RAIL[RAIL.index("const OLD = {"):RAIL.index("const MODE_KEY")]))
        for name in ("fleet", "control", "library", "care", "modules", "autoprint", "prepare", "jobs", "materials"):
            self.assertIn(name, old, name + " no longer resolves")
        for name, target in old.items():
            self.assertIn(target, ids, "%s points at %s, which is not a destination" % (name, target))

    def test_every_go_to_key_names_a_real_place(self):
        ids = {d[0] for d in DEST}
        keys = re.findall(r"(?:^|[ ,{])('?[a-z,]'?|,): '([a-z]+)'", RAIL[RAIL.index("const GO_KEYS = {"):RAIL.index("const keyFor")])
        self.assertGreaterEqual(len(keys), 15)
        for key, dest in keys:
            self.assertIn(dest, ids, key + " goes nowhere")
        letters = [k.strip("'") for k, _ in keys]
        self.assertEqual(len(letters), len(set(letters)), "two destinations share a key")
        self.assertIn("Alt", RAIL)
        self.assertIn("/^Digit([1-8])$/", RAIL)       # Alt+1 to 8 are the eight places

    def test_the_sidebar_loads_last_and_keeps_the_phone_layout(self):
        scripts = re.findall(r'<script src="([^"]+)"', INDEX)
        self.assertEqual(scripts[-1], "intro.js")            # the opening scene borrows the twin once everything else is built
        self.assertEqual(scripts[-2], "rail.js")
        self.assertEqual(scripts[-3], "pagebar.js")
        self.assertIn("(max-width: 720px)", RAIL)
        css = read("shell.css")
        self.assertIn("html.has-shell .rail, html.has-shell .rail-menu { display: none; }", css)

    def test_the_phone_dock_and_more_sheet_name_the_places(self):
        dock = re.findall(r'<button data-tab="[a-z]+" data-dest="([a-z]+)">', INDEX[INDEX.index('<nav class="bottom-nav'):])
        self.assertEqual(dock[:4], ["overview", "printer", "slice", "files"])
        more = re.findall(r'data-dest="([a-z]+)"', INDEX[INDEX.index('<div class="ms-grid"'):INDEX.index('<div class="ms-tools"')])
        self.assertEqual(more, ["models", "ai", "maintenance", "automations", "studio", "games", "settings"])
        ids = {d[0] for d in DEST}
        for dest in dock + more:
            self.assertIn(dest, ids)

    def test_the_u1_profiles_converter_is_the_first_thing_on_files_and_models_points_to_it(self):
        files = INDEX[INDEX.index('id="tab-files"'):INDEX.index('id="tab-models"')]
        self.assertIn('id="convert-card"', files)
        self.assertLess(files.index('id="convert-card"'), files.index('class="files-layout"'))      # above the library
        self.assertIn("Snapmaker U1 profiles", files)
        self.assertIn("Bambu Studio", files)
        panel = INDEX[INDEX.index('id="tab-models"'):INDEX.index('id="tab-automations"')]
        self.assertNotIn('id="convert-card"', panel)
        self.assertIn('id="models-to-profiles"', panel)           # Models points to the banner
        links = re.findall(r'<a class="site-row" href="(https://[^"]+)" target="_blank" rel="noopener noreferrer">', panel)
        self.assertGreaterEqual(len(links), 5)


class TestRailLiveParts(unittest.TestCase):
    def test_it_follows_the_fleet_the_page_already_receives(self):
        for needle in ("dv-fleet", "needsYou", "dueCount", "rail-badge", "rail-switch", "rail-state", "aria-label"):
            self.assertIn(needle, RAIL)
        self.assertNotIn("title=", RAIL[RAIL.index("function build()"):RAIL.index("function keySheet()")])   # names are aria-label, never title

    def test_the_sidebar_rests_as_icons_opens_on_hover_and_closes_three_seconds_after_you_leave(self):
        for needle in ("chosenMode", "dejavu1.rail.mode", "rail-collapsed", "dv-rail-width", "LINGER_MS = 3000", "rail-open", "pointerenter", "pointerleave",
                       "focusin", "focusout", "e.pointerType === 'touch'"):
            self.assertIn(needle, RAIL)
        self.assertNotIn("narrow: true", RAIL)                  # no place decides the width: the sidebar is icons everywhere
        self.assertIn("mode ? mode === 'narrow' : true", RAIL)
        css = read("shell.css")
        self.assertIn("html.has-shell.rail-collapsed.rail-open .rail-card", css)       # labels over the page, not moving it
        self.assertIn("transition: width 0.3s cubic-bezier(0.22, 1, 0.36, 1)", css)
        self.assertNotIn(".rail:is(:hover, :focus-within)", css)                       # opening is the script's, so it can linger

    def test_practice_printers_stay_out_of_sight_until_settings_turns_them_on(self):
        for needle in ("PRACTICE_KEY = 'dejavu1.pref.practice'", "shownDest", "setPractice", "dv-practice", "!shownDest(d)"):
            self.assertIn(needle, RAIL)
        self.assertIn('id="practice-show"', read("settings.js"))
        self.assertIn("'#practice-card'", read("app-shell.js"))
        self.assertIn("Rail.practice()", read("finder.js"))

    def test_more_folds_but_never_hides_the_place_you_are_in(self):
        self.assertIn("setMore(true, false)", RAIL)
        self.assertIn("is-folded", RAIL)

    def test_the_printer_menu_follows_the_switcher(self):
        for needle in ("menuitemradio", "openMenu", "closeMenu", "Escape", "go(byId.printer, b.dataset.printer)"):
            self.assertIn(needle, RAIL)

    def test_the_label_in_the_name_rule(self):
        # axe-core's WCAG 2.5.3: a control's spoken name must start with its visible label.
        self.assertIn("label.overview +=", RAIL)
        self.assertIn("aria-label", RAIL)


if __name__ == "__main__":
    unittest.main()
