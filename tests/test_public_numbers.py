"""
The figures the README, the docs and the "By the numbers" board quote must match the code, so nobody can
find one that is out of date. A failure here means a number changed: update every copy together (README,
docs/testing.md, docs/slicer-workspace-validation.md, tools/readme-images/boards.html, then re-render the
board with tools/readme-images/render.js and copy it with sync.py) as .claude/rules/public-text.md says.
"""

import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))

import ai_providers
import home_assistant_bridge
import maintenance
import mock_moonraker


def text(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def one(pattern, source, label):
    found = re.findall(pattern, source)
    assert len(found) == 1, f"{label}: expected one match for {pattern!r}, found {len(found)}"
    return found[0]


class PublicNumbers(unittest.TestCase):
    def test_the_test_count_is_the_same_everywhere_it_is_quoted(self):
        counted = unittest.defaultTestLoader.discover(HERE, top_level_dir=HERE).countTestCases()
        how = f"The suite has {counted} tests. Update every copy together (see this file's docstring)."
        readme = text("README.md")
        self.assertEqual(int(one(r"\*\*Automated:\*\* (\d+) tests passed", readme, "README")), counted, how)
        self.assertEqual(int(one(r"By the numbers: (\d+) automated tests", readme, "README picture")), counted, how)
        self.assertEqual(int(one(r"<b>(\d+)</b><span>automated tests", text("tools", "readme-images", "boards.html"),
                                 "board")), counted, how)
        self.assertEqual(int(one(r"\*\*The test suite:\*\* (\d+) tests passed", text("docs", "testing.md"),
                                 "testing.md")), counted, how)
        self.assertIn(f"**{counted} tests**", text("docs", "slicer-workspace-validation.md"), how)
        self.assertIn(f"**{counted}-test**", text("tools", "readme-images", "README.md"), how)

    def test_the_numbers_in_the_readme_picture_match_the_code(self):
        picture = one(r"!\[By the numbers: ([^\]]*)\]", text("README.md"), "README picture")
        key_services = sum(1 for row in ai_providers.PROVIDERS if row["kind"] == "key")
        # A U1 with its four heads, a bed and a chamber sensor, as the bridge publishes them (no extras).
        head = {"temperature": 200.0, "target_temperature": 210.0, "status": "ready", "filament_loaded": True,
                "filament_color_name": "Black", "filament_color_hex": "#101010"}
        state = {"state": "ready", "state_message": "", "progress": 0.0, "current_file": None, "active_toolhead": None,
                 "layer": {}, "bed_target": 0.0, "bed_temperature": 25.0, "chamber_temperature": 25.0,
                 "toolheads": {name: dict(head) for name in ("T0", "T1", "T2", "T3")}}
        sensors = len(home_assistant_bridge._sensors_from_state(state, "sensor.dv"))
        demo_printers = len([1 for pid in mock_moonraker._PRINTERS if not mock_moonraker.is_sandbox_printer(pid)])
        farm = demo_printers + mock_moonraker.MAX_SANDBOX_PRINTERS
        self.assertIn(f"{len(maintenance.TASKS)} maintenance tasks", picture)
        self.assertIn(f"{sensors} Home Assistant sensors", picture)
        self.assertIn(f"{farm} printers in the farm sandbox", picture)
        self.assertIn(f"any of {key_services} services", text("README.md"))
        self.assertIn(f"Home Assistant ({sensors} sensors)", text("README.md"))


if __name__ == "__main__":
    unittest.main()
