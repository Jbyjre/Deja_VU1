"""
The SHELL frame's own pieces: the instrument strip with Halt (strip.js), the docked panes and dividers (panes.js), Settings as one
place (settings.js), the command bar's entries (finder.js) and the stylesheets (shell.css, shell-panes.css). Source checks that run
everywhere; tools/pagebar-walk.js (tests/test_pagebar.py) exercises them in a real browser.
"""

import os
import re
import sys
import unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from frontend_parts import read_frontend  # noqa: E402

INDEX = read_frontend("index.html")
STRIP = read_frontend("strip.js")
PANES = read_frontend("panes.js")
SETTINGS = read_frontend("settings.js")
FINDER = read_frontend("finder.js")
SHELL = read_frontend("shell.css")
PANES_CSS = read_frontend("shell-panes.css")
APP = read_frontend("app.js")
RAIL = read_frontend("rail.js")
BOOT = read_frontend("theme-boot.js")
LOOKS = read_frontend("looks.css")
DARK = read_frontend("dark.css")


class TestStrip(unittest.TestCase):
    def test_the_strip_holds_the_printers_the_connection_the_orb_and_halt(self):
        strip = INDEX[INDEX.index('<footer class="strip liquid-glass" id="strip"'):INDEX.index("</footer>", INDEX.index('id="strip"'))]
        for needle in ('id="strip-insts"', 'id="strip-halted"', 'id="conn"', 'id="conn-label"', 'id="strip-cmd"', 'id="orb-dock"', 'id="orb"', 'id="toasts"',
                       'id="strip-halt"', 'id="watch-only-pill"', 'id="handoff"'):
            self.assertIn(needle, strip)
        self.assertLess(strip.index('id="orb-dock"'), strip.index('id="strip-halt"'))      # Halt is the last thing, under the thumb

    def test_halt_stops_the_selected_printer_with_one_press_and_says_so_in_words(self):
        self.assertIn("'/api/printer/control/estop'", STRIP)
        self.assertIn("runCommand(null,", STRIP)                  # the app's own command path: a refusal is shown in words
        self.assertIn("halted: motors and heaters off", STRIP)
        self.assertIn("Halt was refused", STRIP)
        self.assertIn("'/api/printer/control/restart'", STRIP)
        self.assertIn("Restart firmware", STRIP)
        self.assertNotIn("confirm(", STRIP)                        # no browser dialog; the second press is the setting

    def test_the_two_press_setting_and_the_shortcut(self):
        self.assertIn("dejavu1.pref.haltAsk", STRIP)
        self.assertIn("Press again", STRIP)
        self.assertIn("setTimeout(disarm, 4000)", STRIP)
        self.assertIn("e.key !== 'h'", STRIP)
        self.assertIn("1500", STRIP)                               # H then H within a second and a half
        self.assertIn("isContentEditable", STRIP)                  # never while typing

    def test_halt_is_off_without_a_printer_and_the_old_stop_button_is_not_a_second_path(self):
        self.assertIn("p.link_lost", STRIP)
        self.assertIn('id="pp-estop"', INDEX)                      # still on the screen for tests and tours, hidden behind Halt
        self.assertIn("html.has-shell .wrap #pp-estop { display: none; }", SHELL)

    def test_the_strip_shows_demo_data_and_keeps_halt_red_in_every_look(self):
        self.assertIn("is-demo", read_frontend("app-shell.js"))
        self.assertIn("--halt: #c8102e;", SHELL)
        self.assertIn("--halt-ink: #fff;", SHELL)
        self.assertIn("background: var(--halt); color: var(--halt-ink)", SHELL)
        self.assertNotIn("--halt", LOOKS)                           # no look recolours it

    def test_the_ask_button_and_the_handoff_offer_join_the_strip(self):
        self.assertIn("ai-launch", STRIP)
        self.assertIn("insts.before(offer)", read_frontend("workshop-part3.js"))
        self.assertIn("html.has-shell .strip #handoff", SHELL)

    def test_one_instrument_per_printer_with_a_layer_stack_meter(self):
        for needle in ("class=\"stack\"", "inst-name", "data-printer", "aria-pressed", "doneAt(", "formatTemp("):
            self.assertIn(needle, STRIP)
        self.assertIn("repeating-linear-gradient(0deg, var(--accent) 0 1.5px", SHELL)
        self.assertIn(".strip-insts:not([data-count=\"1\"]):not([data-count=\"2\"])", SHELL)      # three or more printers drop the extras


class TestAccessibleNames(unittest.TestCase):
    """axe-core's "label in name" (WCAG 2.5.3): a control's spoken name must contain the text it shows."""

    def test_counts_and_key_hints_are_drawn_by_css_not_written_as_text(self):
        self.assertIn("el.dataset.count", RAIL)
        self.assertIn(".rail-badge::after { content: attr(data-count); }", SHELL)
        self.assertIn("dataset.keys", STRIP)
        self.assertIn("kbd::after { content: attr(data-keys); }", SHELL)
        self.assertIn('<kbd id="strip-cmd-key"></kbd>', INDEX)

    def test_the_printer_row_and_the_instruments_are_named_by_what_they_show(self):
        row = RAIL[RAIL.index('id="rail-switch"'):RAIL.index("rail-scroll")]
        self.assertNotIn('aria-label="', row)
        inst = STRIP[STRIP.index("function instrument"):STRIP.index("function paint(")]
        self.assertNotIn('aria-label="', inst)
        self.assertIn("aria-pressed", inst)
        self.assertIn('aria-label="More places"', RAIL)
        self.assertIn("version history", read_frontend("versions.js"))

    def test_a_region_that_scrolls_can_be_reached_from_the_keyboard(self):
        self.assertIn("function scrollers()", PANES)
        self.assertIn("el.tabIndex = 0", PANES)


class TestOnlineDemo(unittest.TestCase):
    def test_halt_shuts_the_simulated_printer_down_until_its_firmware_restarts(self):
        demo = read_frontend("app-demo.js")
        self.assertIn("if (action === 'estop')", demo)
        self.assertIn("mode: 'error'", demo)
        self.assertIn("sim.mode === 'error'", demo)
        self.assertIn("live.state !== 'error'", demo)       # Restart firmware is refused unless the printer reports an error


class TestPanes(unittest.TestCase):
    def test_a_divider_is_a_w3c_window_splitter(self):
        for needle in ("role', 'separator'", "aria-orientation", "aria-valuenow", "aria-valuemin", "aria-valuemax", "'ArrowRight'", "'ArrowUp'",
                       "e.shiftKey ? 48 : 12", "'Home'", "'End'", "'Enter'", "setPointerCapture", "pointercancel", "dblclick"):
            self.assertIn(needle, PANES)

    def test_sizes_are_kept_per_browser_and_reset_clears_them(self):
        self.assertIn("dejavu1.layout.", PANES)
        self.assertIn("reset", PANES)
        self.assertIn("window.Panes", PANES)
        self.assertIn("Panes.reset()", SETTINGS)

    def test_every_card_it_moves_is_on_the_page(self):
        ids = re.findall(r"put\('([a-z-]+)'", PANES) + re.findall(r"\['([a-z' ,-]+)'\]\.forEach\(id => put", PANES)
        flat = []
        for chunk in ids:
            flat += [i.strip(" '") for i in chunk.split(",")]
        self.assertGreaterEqual(len(flat), 12)
        for one in flat:
            if one:
                self.assertIn('id="%s"' % one, INDEX, one + " is not on the page")

    def test_a_moved_card_keeps_the_module_switch_its_wrapper_carried(self):
        self.assertIn("dataset.moduleBody", PANES)

    def test_the_twin_is_one_shared_instance_docked_into_the_open_place(self):
        self.assertIn("ov-stage", PANES)
        self.assertIn("p-stage", PANES)
        self.assertIn("slot.prepend(card)", PANES)
        self.assertEqual(INDEX.count('id="twin-card"'), 1)

    def test_a_phone_has_no_dividers_and_panes_stack_under_the_stage(self):
        self.assertIn("html.has-shell .split { display: none; }", PANES_CSS)
        self.assertIn("html.has-shell .cockpit > .stage { order: -1; }", PANES_CSS)


class TestSettings(unittest.TestCase):
    def test_settings_has_the_groups_of_the_plan(self):
        block = APP[APP.index("  modules: ["):APP.index("const SECTION_KEY")]
        groups = re.findall(r"^\s{4}\['([a-z]+)', '([^']+)'", block, re.M)
        self.assertEqual([g[1] for g in groups], ["Printers & connection", "Look & layout", "Phone & away", "Alerts & smart home", "Tester mode",
                                                  "Updates", "Advanced", "Help"])

    def test_preferences_is_folded_in_and_demo_data_is_in_advanced(self):
        self.assertIn("prefs: 'modules'", APP)
        self.assertIn("'#demo-card'", APP[APP.index("['advanced'"):APP.index("['help'")])
        self.assertIn("'#appearance-card'", APP[APP.index("['look'"):APP.index("['phone'")])
        self.assertIn("$('tab-prefs')", SETTINGS)

    def test_watch_only_has_a_name_and_one_line_anyone_understands(self):
        self.assertIn("Deja Vu1 shows everything and sends nothing to the printer. Halt still works.", INDEX)

    def test_the_new_rows_exist(self):
        for needle in ("'layout-card'", "'halt-card'", 'id="halt-ask"', "Reset layout", "Your experience", "Sidebar width", 'id="set-search"'):
            self.assertIn(needle, SETTINGS)

    def test_a_search_shows_every_matching_card_and_clearing_it_goes_back(self):
        self.assertIn("Sections.choose('modules', 'all', false)", SETTINGS)
        self.assertIn("set-miss", SETTINGS)
        self.assertIn("function endSearch()", SETTINGS)


class TestWords(unittest.TestCase):
    def test_the_experience_choice_is_applied_before_paint_and_asked_in_setup(self):
        self.assertIn("data-experience", BOOT)
        self.assertIn("setExperience", BOOT)
        self.assertIn("New to 3D printing", read_frontend("launchpad.js"))
        self.assertIn("I know my way around", read_frontend("launchpad.js"))

    def test_explainer_lines_go_for_know_but_live_lines_stay(self):
        rule = PANES_CSS[PANES_CSS.index("html:not([data-experience=\"new\"])"):]
        rule = rule[:rule.index("{ display: none; }")]
        for needle in (".card-sub:not([id])", ".field-hint:not([id])", ":not(.keep)", ":not([role=\"status\"])", ":not([aria-live])", ".xp-btn", "html.familiar"):
            self.assertIn(needle, rule)

    def test_dark_is_built_on_lighter_surfaces(self):
        dark = SHELL[SHELL.index('html[data-theme="dark"]:not(#dv) {'):]
        dark = dark[:dark.index("}")]
        for needle in ("--paper-solid: oklch(21% 0.02 256)", "--raised: oklch(24% 0.022 256)", "--text: oklch(94% 0.008 250)", "--well: oklch(17% 0.018 256)"):
            self.assertIn(needle, dark)
        self.assertIn("linear-gradient(160deg, oklch(14% 0.02 258)", SHELL)     # deep blue, never pure black


class TestCommandBar(unittest.TestCase):
    def test_every_place_part_group_and_action_is_listed_with_its_keys(self):
        for needle in ("Rail.destinations", "Rail.keyFor(", "Alt ${at + 1}", "SECTIONS.modules", "Settings › ", "e.hint"):
            self.assertIn(needle, FINDER)
        for title in ("Halt the selected printer", "Restart the printer\\'s firmware", "Narrow or widen the sidebar", "Reset layout", "Switch between light and dark",
                      "Show me this screen", "Hints: I know my way around", "Hints: New to 3D printing", "Turn demo data on or off"):
            self.assertIn(title, FINDER)
        self.assertIn("'H H'", FINDER)
        self.assertNotIn("['Emergency stop', 'Printer'", FINDER)

    def test_the_demo_switch_is_not_in_the_toolbar_any_more(self):
        header = INDEX[INDEX.index('<header class="topbar" id="topbar">'):INDEX.index("</header>")]
        shown = header[:header.index('<div class="tb-hold" hidden>')]
        self.assertNotIn("demo-toggle", shown)
        self.assertIn("demo-setting", INDEX[INDEX.index('id="demo-card"'):INDEX.index('id="watch-only-card"')])


if __name__ == "__main__":
    unittest.main()
