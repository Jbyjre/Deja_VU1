"""Tests for backend/file_library.py - the local print-file shelf."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import file_library  # noqa: E402
import sample_files  # noqa: E402


class TestLibrary(unittest.TestCase):
    def setUp(self):
        file_library.reset()

    def tearDown(self):
        file_library.reset()

    def test_samples_are_added_once_with_summaries(self):
        result = file_library.add_samples()
        self.assertEqual(len(result["added"]), len(sample_files.SAMPLES))
        self.assertEqual(file_library.add_samples()["added"], [])
        by_name = {f["name"]: f for f in result["files"]}
        cube = by_name["calibration_cube_20mm.gcode"]["summary"]
        self.assertEqual(cube["preflight"], "clear")
        self.assertEqual(cube["layers"], 50)
        self.assertEqual(by_name["unsafe_example_purge_past_bed.gcode"]["summary"]["preflight"], "blocked")
        self.assertEqual(by_name["dock_bracket.stl"]["summary"]["size_mm"], [30.0, 40.0, 25.0])

    def test_thumbnails_for_gcode_and_models(self):
        file_library.add_samples()
        for name in ("calibration_cube_20mm.gcode", "dock_bracket.stl", "sample_bambu_studio_layout.3mf"):
            self.assertTrue(file_library.thumbnail(name).startswith(b"\x89PNG"), name)

    def test_names_are_sanitised(self):
        for bad in ("../../etc/passwd.gcode", ".hidden.gcode", "notes.txt", ""):
            with self.assertRaises(ValueError):
                file_library.save(bad, b"G1") if "/" not in bad else file_library.read_bytes(bad)
        entry = file_library.save("../sneaky.gcode", b"PRINT_START\nG1 X1 E1\n")
        self.assertEqual(entry["name"], "sneaky.gcode")

    def test_edit_keeps_the_original_and_restores_it(self):
        file_library.add_samples()
        name = "calibration_cube_20mm.gcode"
        before = file_library.read_text(name)
        line = next(i for i, l in enumerate(before.splitlines(), 1) if l.startswith("G1 "))
        result = file_library.save_edit(name, [{"kind": "comment_out", "line": line}])
        self.assertTrue(result["file"]["has_original"])
        self.assertNotEqual(file_library.read_text(name), before)
        file_library.restore_original(name)
        self.assertEqual(file_library.read_text(name), before)

    def test_recent_list_follows_opening(self):
        file_library.add_samples()
        file_library.touch("two_colour_coaster.gcode", "last_opened")
        self.assertEqual(file_library.list_files()["recent"][0], "two_colour_coaster.gcode")

    def test_delete(self):
        file_library.add_samples()
        file_library.delete("dock_bracket.stl")
        self.assertFalse(file_library.exists("dock_bracket.stl"))


if __name__ == "__main__":
    unittest.main()
