"""
Tests for modules.py - the feature on/off registry.

    python3 -m unittest discover tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import modules      # noqa: E402


class TestRegistry(unittest.TestCase):

    def setUp(self):
        modules.reset_state()

    def tearDown(self):
        modules.reset_state()

    def test_every_module_has_the_required_fields(self):
        for module in modules.get_all():
            for field in ("id", "name", "description", "status", "enabled"):
                self.assertIn(field, module)

    def test_default_enabled_state_matches_registry(self):
        for module in modules.get_all():
            definition = next(m for m in modules.REGISTRY if m["id"] == module["id"])
            self.assertEqual(module["enabled"], definition["default_enabled"])

    def test_an_older_copy_gets_the_new_defaults_once(self):
        # A copy saved before November 2026 holds the old "off" default for these four.
        old = {m["id"]: m["default_enabled"] for m in modules.REGISTRY}
        old.update({mid: False for mid in modules.DEFAULTS_ON})
        modules._save_state(old)
        for mid in modules.DEFAULTS_ON:
            self.assertTrue(modules.is_enabled(mid), mid)
        # Turned off afterwards, it stays off.
        modules.set_enabled("compare", False)
        self.assertFalse(modules.is_enabled("compare"))

    def test_toggle_off_and_on(self):
        modules.set_enabled("filament_inventory", True)
        self.assertTrue(modules.is_enabled("filament_inventory"))
        modules.set_enabled("filament_inventory", False)
        self.assertFalse(modules.is_enabled("filament_inventory"))

    def test_toggle_persists_across_get_all_calls(self):
        modules.set_enabled("maintenance", False)
        updated = next(m for m in modules.get_all() if m["id"] == "maintenance")
        self.assertFalse(updated["enabled"])

    def test_unknown_module_is_rejected(self):
        with self.assertRaises(ValueError):
            modules.set_enabled("not_a_real_module", True)

    def test_unknown_module_id_counts_as_enabled(self):
        # A route with no matching registry entry should never be blocked
        # by accident.
        self.assertTrue(modules.is_enabled("something_not_in_the_registry"))


class TestKinds(unittest.TestCase):
    """Settings > Optional extras lists only what needs something outside Deja Vu1; the rest has no list row."""

    def setUp(self):
        modules.reset_state()
        self.addCleanup(modules.reset_state)

    def kinds(self, kind):
        return sorted(m["id"] for m in modules.REGISTRY if m["kind"] == kind)

    def test_every_module_has_exactly_one_known_kind(self):
        for module in modules.get_all():
            self.assertIn(module["kind"], ("extra", "setting", "core"), module["id"])

    def test_the_optional_extras_are_the_ones_that_need_a_program_a_device_or_a_service(self):
        self.assertEqual(self.kinds("extra"), sorted(
            ["auto_print", "webrtc_camera", "led_status", "wled_bridge", "home_assistant_bridge", "color_check"]))

    def test_a_few_features_are_ordinary_settings_that_switch_in_their_own_card(self):
        self.assertEqual(self.kinds("setting"), ["camera", "handoff", "timelapse"])

    def test_everything_else_is_part_of_deja_vu1(self):
        core = self.kinds("core")
        for needed in ("printer_control", "fleet", "file_library", "print_queue", "maintenance", "automations",
                       "cost_calculator", "backup", "notifications", "converter", "updates"):
            self.assertIn(needed, core)

    def test_an_older_copy_gets_its_parts_of_deja_vu1_switched_back_on_once(self):
        # Saved by 0.20: the person had switched three parts, an extra and a setting off.
        old = {m["id"]: m["default_enabled"] for m in modules.REGISTRY}
        old.update({"cost_calculator": False, "backup": False, "notifications": False,
                    "wled_bridge": False, "timelapse": False, "_defaults": 2})
        modules._save_state(old)
        for module_id in ("cost_calculator", "backup", "notifications"):
            self.assertTrue(modules.is_enabled(module_id), module_id)     # no switch on screen, so on
        self.assertFalse(modules.is_enabled("wled_bridge"))               # an extra keeps its choice
        self.assertFalse(modules.is_enabled("timelapse"))                 # a setting keeps its choice
        # Once: a part switched off afterwards (by a script) stays off.
        modules.set_enabled("backup", False)
        self.assertFalse(modules.is_enabled("backup"))

    def test_the_page_lists_only_extras_and_gives_the_three_settings_their_own_switch(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "frontend", "index.html"), encoding="utf-8") as f:
            page = f.read()
        self.assertIn("<h2>Optional extras</h2>", page)
        self.assertNotIn("<h2>Modules</h2>", page)
        self.assertNotIn("<h2>Print cost pricing</h2>", page)           # the prices sit in the Print cost card now
        self.assertEqual(page.count('id="cost-electricity"'), 1)
        for module_id in modules.SETTINGS:
            self.assertEqual(page.count(f'data-setting-module="{module_id}"'), 1, module_id)
        with open(os.path.join(root, "frontend", "app.js"), encoding="utf-8") as f:
            script = f.read()
        self.assertIn("m.kind === 'extra'", script)                     # the list filters on the server's word


if __name__ == "__main__":
    unittest.main()
