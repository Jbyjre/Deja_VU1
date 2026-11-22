"""
The Slicer sidebar's working profile (backend/slicer_working.py): the stock U1 presets that fit the four heads, a choice of process preset,
what the person changed on top, and the one profile rebuilt from all of it. Presets are small fakes in a temporary folder, shaped like
Snapmaker's own (a machine, two process presets, a material), so nothing here needs the real engine.
"""

import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import slicer_bridge  # noqa: E402
import slicer_bridge_part1  # noqa: E402
import slicer_profiles  # noqa: E402
import slicer_working as work  # noqa: E402
import tool_setup  # noqa: E402


class WorkingProfile(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = self.root = Path(self.tmp.name)
        self.program = root / "bin" / "snapmaker-orca"
        self.program.parent.mkdir()
        self.program.write_text("#!/bin/sh\n")
        self.program.chmod(self.program.stat().st_mode | stat.S_IEXEC)
        self.presets = root / "resources" / "profiles" / "Snapmaker"
        self.presets.mkdir(parents=True)
        self.write("base", {"type": "machine", "name": "base", "from": "system", "instantiation": "false", "printer_model": "Snapmaker U1"})
        self.write("printer", {"type": "machine", "name": "Snapmaker U1 (0.4 nozzle)", "inherits": "base", "instantiation": "true", "nozzle_diameter": ["0.4"] * 4})
        for name, height, speed in (("0.12mm Fine", ".12", "150"), ("0.20mm Standard", ".2", "200"), ("0.28mm Draft", ".28", "250")):
            self.write("process-" + name, {"type": "process", "name": name + " @Snapmaker U1 (0.4 nozzle)", "instantiation": "true", "layer_height": height,
                                           "outer_wall_speed": speed, "compatible_printers": ["Snapmaker U1 (0.4 nozzle)"]})
        self.write("process-other", {"type": "process", "name": "0.20mm Standard @Snapmaker U1 (0.6 nozzle)", "instantiation": "true", "layer_height": ".2",
                                     "compatible_printers": ["Snapmaker U1 (0.6 nozzle)"]})
        self.write("pla", {"type": "filament", "name": "Generic PLA @U1", "instantiation": "true", "filament_type": ["PLA"], "compatible_printers": ["Snapmaker U1 (0.4 nozzle)"]})
        # the settings file is read by functions in slicer_bridge_part1, so that is the module whose names are replaced
        for target, value in ((slicer_bridge_part1, "_DATA_DIR"), (slicer_profiles, "_DATA_DIR"), (tool_setup, "_DATA_DIR")):
            p = patch.object(target, value, str(root / "data"))
            p.start()
            self.addCleanup(p.stop)
        for target, name, value in ((slicer_bridge_part1, "_PATH", str(root / "data" / "slicer.json")), (slicer_bridge_part1, "_RECEIPTS", str(root / "data" / "r.json")),
                                    (tool_setup, "_PATH", str(root / "data" / "tool_setup.json"))):
            p = patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)
        (root / "data").mkdir()
        os.environ[slicer_bridge.ENV_PATH] = str(self.program)
        self.addCleanup(lambda: os.environ.pop(slicer_bridge.ENV_PATH, None))
        self.heads = [{"toolhead": f"T{i}", "nozzle": 0.4, "height": 0.2, "material": "PLA", "color_hex": "#123456"} for i in range(4)]
        tool_setup.save({"heads": self.heads})

    def write(self, name, data):
        (self.presets / (name + ".json")).write_text(json.dumps(data))


class TestState(WorkingProfile):
    def test_it_says_what_is_missing_when_there_is_no_engine(self):
        os.environ.pop(slicer_bridge.ENV_PATH)
        with patch.object(slicer_bridge.engine_installer, "managed_program", return_value=None), patch.object(slicer_bridge, "_search_places", return_value=[]), \
                patch("shutil.which", return_value=None):
            state = work.state()
        self.assertFalse(state["ready"])
        self.assertIn("no slicing engine", state["problem"])

    def test_it_offers_the_process_presets_that_fit_this_printer_and_the_stock_choice(self):
        state = work.state()
        self.assertTrue(state["ready"], state["problem"])
        names = [p["name"] for p in state["processes"]]
        self.assertEqual(len(names), 3, names)
        self.assertTrue(all("0.4 nozzle" in n for n in names), "a preset for another nozzle is never offered")
        self.assertEqual([p["layer_height"] for p in state["processes"]], [".12", ".2", ".28"], "in order of layer height")
        self.assertIn("0.20mm Standard", state["stock"]["names"]["process"])
        self.assertEqual(state["machine"]["name"], "Snapmaker U1 (0.4 nozzle)")
        self.assertEqual(state["processes"][1]["options"]["outer_wall_speed"], "200", "the profile's own speed is there for the speed slider")
        self.assertIn("outer_wall_speed", state["speed_keys"])

    def test_four_different_nozzles_are_explained_not_guessed(self):
        heads = [dict(h) for h in self.heads]
        heads[2]["nozzle"] = 0.6
        heads[2]["height"] = 0.2
        tool_setup.save({"heads": heads})
        state = work.state()
        self.assertFalse(state["ready"])
        self.assertIn("different nozzles", state["problem"])


class TestSetting(WorkingProfile):
    def test_a_working_profile_is_made_from_the_stock_choice_and_what_was_changed(self):
        result = work.set_working({"options": {"wall_loops": 4, "sparse_infill_density": 20}})
        settings = slicer_bridge.get_settings()
        prof = next(p for p in settings["profiles"] if p["id"] == result["profile_id"])
        self.assertTrue(prof["working"])
        self.assertEqual(prof["name"], work.WORKING_NAME)
        self.assertEqual(settings["default_profile"], result["profile_id"])
        written = json.loads(Path(prof["process"]).read_text())
        self.assertEqual(written["wall_loops"], "4")
        self.assertEqual(written["sparse_infill_density"], "20%")

    def test_changing_again_replaces_the_working_profile_instead_of_adding_another(self):
        first = work.set_working({"options": {"wall_loops": 3}})["profile_id"]
        second = work.set_working({"options": {"wall_loops": 5}})["profile_id"]
        self.assertNotEqual(first, second)
        working = [p for p in slicer_bridge.get_settings()["profiles"] if p.get("working")]
        self.assertEqual([p["id"] for p in working], [second])
        self.assertEqual(len(slicer_bridge.get_settings()["profiles"]), 1)

    def test_a_refused_change_leaves_the_working_profile_that_was_there(self):
        good = work.set_working({"options": {"wall_loops": 3}})["profile_id"]
        with self.assertRaises(ValueError):
            work.set_working({"options": {"wall_loops": 9999}})
        self.assertEqual([p["id"] for p in slicer_bridge.get_settings()["profiles"] if p.get("working")], [good])

    def test_a_setting_the_engine_table_does_not_have_is_refused(self):
        with self.assertRaises(ValueError):
            work.set_working({"options": {"not_a_setting": 1}})

    def test_a_chosen_process_preset_is_used_and_a_stranger_is_refused(self):
        rows = work.state()["processes"]
        draft = next(r for r in rows if r["layer_height"] == ".28")
        result = work.set_working({"process": draft["id"]})
        prof = next(p for p in slicer_bridge.get_settings()["profiles"] if p["id"] == result["profile_id"])
        self.assertEqual(json.loads(Path(prof["process"]).read_text())["layer_height"], ".28")
        with self.assertRaises(ValueError):
            work.set_working({"process": "ffffffffffffffff"})

    def test_the_heads_are_saved_where_tools_and_filaments_keeps_them(self):
        heads = [dict(h) for h in self.heads]
        heads[1]["color_hex"] = "#ff0000"
        work.set_working({"heads": heads})
        self.assertEqual(tool_setup.get()["heads"][1]["color_hex"], "#ff0000")
        self.assertEqual(work.state()["heads"][1]["color_hex"], "#ff0000")

    def test_per_head_layer_heights_need_an_engine_that_can_print_them(self):
        heads = [dict(h) for h in self.heads]
        heads[1]["height"] = 0.28
        with self.assertRaises(ValueError) as caught:
            work.set_working({"heads": heads, "layer_mode": "per_tool"})
        self.assertIn("per-tool", str(caught.exception).lower())

    def test_a_layer_height_a_nozzle_cannot_print_is_refused_in_words(self):
        heads = [dict(h) for h in self.heads]
        heads[0]["height"] = 0.5
        with self.assertRaises(ValueError) as caught:
            work.set_working({"heads": heads})
        self.assertIn("layer height between", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
