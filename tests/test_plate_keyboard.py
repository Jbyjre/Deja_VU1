"""The plate editor's keyboard commands (frontend/plate.js): safe by construction, and written down for the user."""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(name):
    with open(os.path.join(ROOT, "frontend", name), encoding="utf-8") as f:
        return f.read()


PLATE = read("plate.js")
VIEWER = read("viewer3d.js")
KEYS = PLATE[PLATE.index("function onKey(e)"):PLATE.index("document.addEventListener('keydown', onKey);")]


class TestPlateKeyboard(unittest.TestCase):
    def test_typing_in_a_field_never_moves_an_object(self):
        self.assertIn("field(e.target)", KEYS)
        self.assertRegex(PLATE, r"INPUT\|TEXTAREA\|SELECT")
        self.assertIn("isContentEditable", PLATE)

    def test_single_keys_need_the_model_view_in_focus_and_the_plate_on_screen(self):
        self.assertIn("controls.offsetParent === null", KEYS)
        before_single_keys = KEYS[:KEYS.index("document.activeElement !== viewer.canvas")]
        # Only Ctrl/Cmd with Z, Y, D or S may act before that check.
        self.assertIn("mod &&", before_single_keys)
        for single in ("key === 'r'", "key === 'f'", "key === 'l'", "'Delete'", "plate-drop"):
            self.assertNotIn(single, before_single_keys)

    def test_the_arrow_keys_alone_still_turn_the_camera(self):
        self.assertIn("if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;", VIEWER)
        self.assertIn("const step = (e.shiftKey ?", KEYS)

    def test_every_command_is_a_button_or_a_change_that_can_be_undone(self):
        for button in ("plate-undo", "plate-redo", "plate-duplicate", "plate-save", "plate-flat", "plate-drop", "plate-remove"):
            self.assertIn(f"$p('{button}')", KEYS)
        # A move or a turn goes through change(), which keeps the undo history; quick arrow moves share one step.
        self.assertIn("change(o => around(o, rotated(2,", KEYS)
        self.assertIn("}, now - nudgedAt < 900 && undo.length > 0);", PLATE)

    def test_the_listener_is_removed_with_the_plate_and_the_commands_are_written_down(self):
        self.assertIn("document.removeEventListener('keydown', onKey);", PLATE)
        help_text = re.search(r'<details id="plate-keys">.*?</details>', PLATE, re.S).group(0)
        for words in ("Shift + arrow keys", "Page Up", "<b>R</b>", "previous or next", "<b>L</b>", "<b>D</b>", "<b>F</b>",
                      "<b>Delete</b>", "Ctrl or Cmd + Z", "duplicates", "saves a new 3MF plate"):
            self.assertIn(words, help_text, words)


if __name__ == "__main__":
    unittest.main()
