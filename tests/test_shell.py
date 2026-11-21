"""
The frame's own pieces: the floating dock and Halt (strip.js, cockpit.js), the dividers and the one shared twin (panes.js), the tiles and sheets
of the Printer screen and Overview (cockpit.js, overview.js, deck.js), Settings as one place (settings.js), the command bar's entries (finder.js)
and the stylesheets (shell.css, shell-panes.css, cockpit.css). Source checks that run everywhere; tools/pagebar-walk.js (tests/test_pagebar.py)
exercises them in a real browser.
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
COCKPIT = read_frontend("cockpit.js")
OVERVIEW = read_frontend("overview.js")
DECK = read_frontend("deck.js")
INTRO = read_frontend("intro.js")
COCKPIT_CSS = read_frontend("cockpit.css")
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
    def test_the_dock_holds_the_orb_the_link_words_and_the_offer_and_nothing_runs_along_the_bottom(self):
        dock = INDEX[INDEX.index('<footer class="strip float-dock" id="strip"'):INDEX.index("</footer>", INDEX.index('id="strip"'))]
        for needle in ('id="conn"', 'id="conn-label"', 'id="orb-dock"', 'id="orb"', 'id="toasts"', 'id="watch-only-pill"', 'id="handoff"'):
            self.assertIn(needle, dock)
        for gone in ('id="strip-insts"', 'id="strip-cmd"', 'id="strip-halt"', 'id="strip-halted"'):
            self.assertNotIn(gone, dock)                          # no printers, no Find, no Halt: the printers are in the sidebar
        self.assertNotIn("liquid-glass", dock[:dock.index(">")])    # and the dock itself is no glass bar (its notification panel still is glass)
        self.assertIn("position: fixed", SHELL[SHELL.index("html.has-shell .strip {"):SHELL.index("html.has-shell .strip > *")])
        self.assertIn('grid-template-areas: "rail main";', SHELL)        # the frame has no bottom row

    def test_halt_is_built_on_the_printer_screen_and_nowhere_else(self):
        self.assertIn('id="strip-halt"', COCKPIT)
        self.assertIn('id="strip-halted"', COCKPIT)
        self.assertNotIn('id="strip-halt"', INDEX)
        self.assertNotIn('id="strip-halt"', OVERVIEW)
        self.assertIn("document.addEventListener('click'", STRIP)       # the button is built after strip.js is parsed: one listener on the page
        self.assertIn("e.key !== 'h'", STRIP)                            # the shortcut H H still works from every place

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

    def test_the_ask_button_and_the_handoff_offer_join_the_dock(self):
        self.assertIn("ai-launch", STRIP)
        self.assertIn("floating.prepend(offer)", read_frontend("workshop-part3.js"))
        self.assertIn("html.has-shell .strip #handoff", SHELL)

    def test_the_link_is_named_only_when_something_is_off(self):
        self.assertIn('html.has-shell .strip .conn:is(.is-live, :not([class*="is-"])) { display: none; }', SHELL)

    def test_the_printers_are_chosen_in_the_sidebar_not_in_a_bar(self):
        self.assertNotIn('class="stack"', STRIP)
        self.assertNotIn("function instrument", STRIP)
        self.assertIn('id="rail-switch"', RAIL)


class TestAccessibleNames(unittest.TestCase):
    """axe-core's "label in name" (WCAG 2.5.3): a control's spoken name must contain the text it shows."""

    def test_counts_and_key_hints_are_drawn_by_css_not_written_as_text(self):
        self.assertIn("el.dataset.count", RAIL)
        self.assertIn(".rail-badge::after { content: attr(data-count); }", SHELL)
        self.assertIn("dataset.keys", STRIP)
        self.assertIn("kbd::after { content: attr(data-keys); }", SHELL)
        self.assertIn('<kbd class="halt-key" aria-hidden="true"></kbd>', COCKPIT)

    def test_the_printer_row_and_the_tiles_are_named_by_what_they_show(self):
        row = RAIL[RAIL.index('id="rail-switch"'):RAIL.index("rail-scroll")]
        self.assertNotIn('aria-label="', row)
        # a tile is named by its visible text, which holds the figures; the tune row has only values, so it says what it is
        for tile in ('id="tile-job-open"', 'id="tile-tune"'):
            button = COCKPIT[COCKPIT.index(tile):COCKPIT.index(">", COCKPIT.index(tile))]
            self.assertIn('aria-haspopup="dialog"', button)
        job = COCKPIT[COCKPIT.index('id="tile-job-open"'):COCKPIT.index(">", COCKPIT.index('id="tile-job-open"'))]
        self.assertNotIn("aria-label", job)
        tune = COCKPIT[COCKPIT.index('id="tile-tune"'):COCKPIT.index(">", COCKPIT.index('id="tile-tune"'))]
        self.assertIn('aria-label="Tune speed, flow and fan"', tune)
        # the temperatures are drawn on the machine (twin3d.js tags), and their button in the dock keeps its name for screen readers
        self.assertIn("['temps', 'Temperatures']", COCKPIT)
        self.assertIn('aria-label="${label}"', COCKPIT)
        self.assertNotIn('id="tile-temps"', COCKPIT)
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

    def test_every_card_the_screens_move_is_on_the_page(self):
        ids = []
        for source in (COCKPIT, OVERVIEW):
            for chunk in re.findall(r"\[([a-z' ,-]+)\]\.forEach\(id => put\(id,", source):
                ids += [i.strip(" '") for i in chunk.split(",")]
            ids += re.findall(r"put\('([a-z-]+)'", source)
        self.assertGreaterEqual(len(ids), 14)
        for one in ids:
            self.assertIn('id="%s"' % one, INDEX, one + " is not on the page")

    def test_a_moved_card_keeps_the_module_switch_its_wrapper_carried(self):
        self.assertIn("dataset.moduleBody", PANES)

    def test_the_twin_is_one_shared_instance_docked_into_the_printer_stage_and_lent_to_sheets(self):
        self.assertIn("p-stage", PANES)
        self.assertIn("p-stage", COCKPIT)
        self.assertNotIn("ov-stage", PANES)                       # Overview has no 3D printer: it lives on the Printer screen
        self.assertIn("slot.prepend(card)", PANES)
        self.assertIn("card.closest('.cp-sheet')", PANES)           # a sheet that borrowed it keeps it until it closes
        self.assertEqual(INDEX.count('id="twin-card"'), 1)

    def test_a_phone_has_no_dividers_and_the_stage_comes_first(self):
        self.assertIn("html.has-shell .split { display: none; }", PANES_CSS)
        phone = COCKPIT_CSS[COCKPIT_CSS.index("@media (max-width: 720px)"):]
        self.assertIn("html.has-shell .cp > .cp-stage { position: relative;", phone)       # a picture at the top of the page, not a window-sized layer
        self.assertIn("order: 1;", phone[phone.index("html.has-shell .cp > .cp-stage"):][:200])
        self.assertIn("html.has-shell .cp > .cp-dock { position: relative;", phone)

    def test_dragging_a_divider_is_one_move_per_frame_and_tells_the_twin_only_when_let_go(self):
        for needle in ("requestAnimationFrame", "announce(!live)", "if (now) window.dispatchEvent(new Event('resize'))"):
            self.assertIn(needle, PANES)
        self.assertNotIn("ev => set(from + sign", PANES)           # no resize broadcast for every pointer event
        self.assertNotIn("setTimeout(() => window.dispatchEvent", PANES)
        self.assertIn("html.is-resizing .cp-stage #twin-model canvas { object-fit: contain; }", COCKPIT_CSS)


class TestTilesAndSheets(unittest.TestCase):
    def test_every_sheet_names_cards_that_exist(self):
        block = COCKPIT[COCKPIT.index("const SHEETS = {"):COCKPIT.index("const DOCK")]
        ids = set(re.findall(r"'([a-z-]+)'", block)) & set(re.findall(r"'((?:pp|ctrl|cp|twin)-[a-z-]+)'", block))
        self.assertGreaterEqual(len(ids), 10)
        for one in ids:
            if one != "cp-job":                                   # built by cockpit.js itself
                self.assertIn('id="%s"' % one, INDEX, one)
        self.assertIn("section.id = 'cp-job'", COCKPIT.replace("job.id", "section.id"))
        for name in ("move", "extrude", "tune", "macros"):
            body = block[block.index("    %s:" % name):]
            body = body[:body.index("\n")]
            self.assertIn("'twin-card'", body, name)                # the smart view: the 3D printer and the camera come beside these
            self.assertIn("'pp-camera-card'", body, name)

    def test_a_sheet_is_a_modal_dialog_that_closes_with_escape_traps_focus_and_hands_cards_back(self):
        for needle in ("role', 'dialog'", "aria-modal", "e.key === 'Escape'", "e.key === 'Tab'", "release()", "homeOf(", "xBtn.focus(",
                       "back.focus(", "prefers-reduced-motion"):
            self.assertIn(needle, DECK)
        self.assertIn("grows out of what opened it", DECK)

    def test_nothing_on_the_printer_screen_scrolls_but_a_sheet_may(self):
        # the room has no rails to scroll: the 3D scene is a fixed layer behind everything, the cards and the dock are laid over it
        stage = COCKPIT_CSS[COCKPIT_CSS.index("html.has-shell .cp-stage {"):]
        stage = stage[:stage.index("}")]
        self.assertIn("position: fixed", stage)
        self.assertIn("overflow: hidden", stage)
        for part in ("html.has-shell .cp-left {", "html.has-shell .cp-right {", "html.has-shell .cp-dock {"):
            rule = COCKPIT_CSS[COCKPIT_CSS.index(part):]
            rule = rule[:rule.index("}")]
            self.assertIn("position: absolute", rule, part)
            self.assertNotIn("overflow: auto", rule.replace("overflow-x: auto", ""), part)
        self.assertNotIn("cp-rail", COCKPIT)                        # no side rails, no dividers
        self.assertIn("overflow: auto", COCKPIT_CSS[COCKPIT_CSS.index("html.has-shell .cp-main {"):][:200])

    def test_overview_is_a_glance_with_no_3d_printer(self):
        self.assertNotIn("twin", OVERVIEW.replace("The 3D printer is on the Printer screen only", ""))
        for needle in ("attention", "ov-now", "ov-camera", "ov-printers", "data-open"):
            self.assertIn(needle, OVERVIEW)
        self.assertIn("nth-child(n+4)", COCKPIT_CSS)                # the first three of Needs you; the rest in a sheet

    def test_the_halted_note_and_restart_sit_with_halt(self):
        self.assertLess(COCKPIT.index('id="strip-halted"'), COCKPIT.index('id="strip-halt"'))
        self.assertIn("strip-restart", STRIP)


class TestOpeningScene(unittest.TestCase):
    def test_it_plays_only_on_a_fresh_start_never_with_reduced_motion_or_a_robot_and_can_be_switched_off(self):
        for needle in ("type === 'navigate'", "dejavu1.pref.intro", "prefers-reduced-motion", "navigator.webdriver", "nointro", "intro-pending"):
            self.assertIn(needle, BOOT)
        self.assertIn("5200", BOOT)                                 # the cover is lifted by a timer too: a page is never left covered
        for needle in ("HOLD_MS = 3000", "drawsInSoftware", "Cockpit.software()", "intro=force", "keydown", "pointerdown", "Skip", "reduced()"):
            self.assertIn(needle, INTRO)
        self.assertIn("swiftshader", COCKPIT)                       # software drawing is read once, from the twin's own context
        self.assertIn("(on && software())", COCKPIT)               # and the twin does not turn by itself there
        self.assertIn("'Opening scene'", SETTINGS)

    def test_the_twin_is_lent_to_the_scene_and_handed_back(self):
        self.assertIn("stage.append(card)", INTRO)
        self.assertIn("home.parent.insertBefore(card, home.next)", INTRO)
        self.assertIn("Panes.dock()", INTRO)


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
        for needle in ("'layout-card'", "'halt-card'", "'practice-card'", 'id="halt-ask"', 'id="practice-show"', "Reset layout", "Your experience", "Opens on hover",
                       "Always open", "Opening scene", 'id="set-search"'):
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
