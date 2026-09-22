"""Tests for backend/gcode_tools.py - the G-code reader, pre-flight check and editor."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))


import gcode_tools  # noqa: E402
import sample_files  # noqa: E402

BASIC = """; filament_type = PLA;PETG
; filament_colour = #F26A1B;#1C1C1E
; estimated printing time (normal mode) = 1h 30m 0s
PRINT_START
G90
M83
G1 X10 Y10 Z0.2 F3000
G1 X50 Y10 E200.0
T1
G1 X50 Y50 E200.0
"""


class TestMetadata(unittest.TestCase):
    def test_reads_slicer_comments(self):
        meta = gcode_tools.parse_metadata(BASIC)
        self.assertEqual(meta["filament_types"], ["PLA", "PETG"])
        self.assertEqual(meta["filament_colours"], ["#F26A1B", "#1C1C1E"])
        self.assertAlmostEqual(meta["estimated_hours"], 1.5)

    def test_duration_formats(self):
        self.assertAlmostEqual(gcode_tools._duration_to_hours("2d 1h"), 49.0)
        self.assertAlmostEqual(gcode_tools._duration_to_hours("3600"), 1.0)

    def test_thumbnail_extraction(self):
        text = sample_files.calibration_cube()
        self.assertTrue(gcode_tools.extract_thumbnail(text).startswith("data:image/png;base64,iVBOR"))
        self.assertIsNone(gcode_tools.extract_thumbnail(BASIC))


class TestAnalysis(unittest.TestCase):
    def test_counts_filament_per_tool_and_bounds(self):
        result = gcode_tools.analyze(BASIC)
        self.assertEqual(result["tools_used"], ["T0", "T1"])
        self.assertEqual(result["filament_mm"], {"T0": 200.0, "T1": 200.0})
        self.assertEqual(result["bounds"]["max"][:2], [50.0, 50.0])
        self.assertEqual(result["filament_grams_source"], "estimated from extrusion length")
        # PETG is denser than PLA, so T1's 2 mm weighs more than T0's.
        self.assertGreater(result["filament_grams_by_tool"]["T1"], result["filament_grams_by_tool"]["T0"])

    def test_relative_and_absolute_extrusion(self):
        text = "PRINT_START\nM82\nG1 X1 Y1 Z0.2\nG1 X20 E5\nG1 X40 E8\nG92 E0\nG1 X60 E1\n"
        self.assertEqual(gcode_tools.analyze(text)["filament_mm"]["T0"], 9.0)

    def test_clean_file_is_clear(self):
        result = gcode_tools.analyze(sample_files.calibration_cube())
        self.assertEqual(result["preflight"]["verdict"], "clear")
        self.assertEqual(result["layers"], 50)
        self.assertGreater(len(result["toolpath"]["segments"]), 100)

    def test_toolpath_is_capped(self):
        lines = ["PRINT_START", "G1 Z0.2"] + [f"G1 X{i % 200} Y{i % 100} E0.01" for i in range(70000)]
        result = gcode_tools.analyze("\n".join(lines))
        self.assertTrue(result["toolpath"]["downsampled"])
        self.assertEqual(len(result["toolpath"]["segments"]), gcode_tools.MAX_SEGMENTS)


class TestPreflight(unittest.TestCase):
    def codes(self, text):
        pre = gcode_tools.preflight(text)
        return {f["code"] for f in pre["errors"]}, {f["code"] for f in pre["warnings"]}, pre["verdict"]

    def test_out_of_bounds_extrusion_blocks(self):
        errors, _, verdict = self.codes(sample_files.unsafe_example())
        self.assertIn("out_of_bounds", errors)
        self.assertEqual(verdict, "blocked")

    def test_below_bed_blocks(self):
        errors, _, _ = self.codes("PRINT_START\nG1 X10 Y10 Z-0.3\nG1 X20 E1\n")
        self.assertIn("below_bed", errors)

    def test_unknown_toolhead_and_hot_nozzle_block(self):
        errors, _, _ = self.codes("PRINT_START\nT5\nM104 S320\nG1 X10 Y10 Z0.2 E1\n")
        self.assertIn("unknown_tool", errors)
        self.assertIn("nozzle_too_hot", errors)

    def test_no_extrusion_blocks(self):
        errors, _, _ = self.codes("PRINT_START\nG1 X10 Y10\n")
        self.assertIn("no_extrusion", errors)

    def test_warnings(self):
        text = "G1 X10 Y10 Z0.2\nG1 X20 E1\n"          # no homing, no heat, no PRINT_START
        _, warnings, verdict = self.codes(text)
        self.assertEqual(verdict, "check")
        self.assertTrue({"move_before_home", "cold_extrusion", "no_print_start"} <= warnings)

    def test_travel_below_printed_part_is_a_collision_risk(self):
        text = "PRINT_START\nM83\nG1 X10 Y10 Z0.2\n" + "".join(
            f"G1 Z{z:.1f}\nG1 X30 E1\nG1 X10 E1\n" for z in (0.4, 0.6, 0.8, 1.0, 1.2)) + \
            "G1 Z0.3\nG0 X80 Y80\n"
        _, warnings, _ = self.codes(text)
        self.assertIn("low_travel", warnings)

    def test_repeats_are_counted_not_listed(self):
        text = "PRINT_START\nM83\nG1 Z0.2\n" + "\n".join(f"G1 X{300 + i} Y10 E1" for i in range(9))
        pre = gcode_tools.preflight(text)
        oob = [e for e in pre["errors"] if e["code"] == "out_of_bounds"]
        self.assertEqual(len(oob), 5)
        self.assertEqual(oob[0]["more_like_this"], 4)


class TestEdits(unittest.TestCase):
    TEXT = "M104 S210 ; nozzle\nG1 X10 F3000\nG1 X20\n"

    def test_set_value_keeps_the_comment(self):
        out = gcode_tools.apply_edit(self.TEXT, {"kind": "set_value", "line": 1, "param": "S", "value": 215})
        self.assertEqual(out.splitlines()[0], "M104 S215 ; nozzle")

    def test_set_value_never_touches_the_command_word(self):
        with self.assertRaises(ValueError):
            gcode_tools.apply_edit("M104 S210", {"kind": "set_value", "line": 1, "param": "M", "value": 1})

    def test_set_value_is_validated(self):
        for edit in ({"kind": "set_value", "line": 1, "param": "S", "value": 400},
                     {"kind": "set_value", "line": 2, "param": "F", "value": 0},
                     {"kind": "set_value", "line": 3, "param": "Y", "value": 5},
                     {"kind": "set_value", "line": 9, "param": "S", "value": 5}):
            with self.assertRaises(ValueError):
                gcode_tools.apply_edit(self.TEXT, edit)

    def test_comment_out(self):
        out = gcode_tools.apply_edit(self.TEXT, {"kind": "comment_out", "line": 2})
        self.assertTrue(out.splitlines()[1].startswith("; G1 X10 F3000"))
        with self.assertRaises(ValueError):
            gcode_tools.apply_edit(out, {"kind": "comment_out", "line": 2})

    def test_insert_validates_the_command(self):
        out = gcode_tools.apply_edit(self.TEXT, {"kind": "insert", "after_line": 1, "command": "M106 S128"})
        self.assertTrue(out.splitlines()[1].startswith("M106 S128"))
        ok = gcode_tools.apply_edit(self.TEXT, {"kind": "insert", "after_line": 1,
                                                "command": "SET_PRINT_STATS_INFO CURRENT_LAYER=2"})
        self.assertIn("SET_PRINT_STATS_INFO", ok)
        for bad in ("M112", "hello world", "T7", "M104 S999", "G1 X1\nG1 X2", "FIRMWARE_RESTART"):
            with self.assertRaises(ValueError):
                gcode_tools.apply_edit(self.TEXT, {"kind": "insert", "after_line": 1, "command": bad})

    def test_view_and_search(self):
        view = gcode_tools.view_lines(self.TEXT, 1, 1)
        self.assertEqual(view["lines"], [{"n": 2, "text": "G1 X10 F3000"}])
        self.assertEqual(gcode_tools.view_lines(self.TEXT, query="g1")["matches"], 2)


if __name__ == "__main__":
    unittest.main()
