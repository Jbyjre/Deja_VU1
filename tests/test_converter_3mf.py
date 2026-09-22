"""Tests for backend/converter_3mf.py - MakerWorld / NexPrint to Snapmaker U1."""

import io
import json
import os
import sys
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))


import converter_3mf  # noqa: E402
import sample_files  # noqa: E402


def _config(data):
    return json.loads(zipfile.ZipFile(io.BytesIO(data)).read("Metadata/project_settings.config"))


class TestConverter(unittest.TestCase):
    def test_makerworld_project(self):
        out, report = converter_3mf.convert(sample_files.bambu_style_project())
        cfg = _config(out)
        self.assertEqual(report["source"], "makerworld")
        self.assertEqual(cfg["printer_model"], "Snapmaker U1")
        self.assertEqual(cfg["printer_settings_id"], "Snapmaker U1 (0.4 nozzle)")
        self.assertEqual(cfg["print_settings_id"], "0.20mm Standard @Snapmaker U1 (0.4 nozzle)")
        self.assertEqual(cfg["filament_settings_id"], ["Generic PLA", "Generic PLA"])
        self.assertEqual(cfg["printable_area"], converter_3mf.U1_PRINTABLE_AREA)
        # The loader's contract: inherits_group and different_settings_to_system
        # line up as [print, filament..., printer].
        self.assertEqual(len(cfg["inherits_group"]), 4)
        self.assertEqual(cfg["inherits_group"][-1], "Snapmaker U1 (0.4 nozzle)")
        self.assertEqual(len(cfg["different_settings_to_system"]), 4)
        self.assertEqual(cfg["different_settings_to_system"][-1], "printer_notes")
        # The creator's own changes are kept; colours are kept.
        self.assertIn("sparse_infill_density", cfg["different_settings_to_system"][0])
        self.assertEqual(cfg["sparse_infill_density"], "25%")
        self.assertEqual(cfg["filament_colour"], ["#F26A1B", "#1C1C1E"])
        self.assertIn("filament_colour", cfg["different_settings_to_system"][1])

    def test_old_start_gcode_can_never_reach_a_u1(self):
        out, _ = converter_3mf.convert(sample_files.bambu_style_project())
        cfg = _config(out)
        self.assertNotIn("M620", cfg["machine_start_gcode"])
        self.assertTrue(cfg["machine_start_gcode"].startswith(";"))

    def test_sliced_gcode_inside_is_removed(self):
        out, report = converter_3mf.convert(sample_files.bambu_style_project())
        names = zipfile.ZipFile(io.BytesIO(out)).namelist()
        self.assertNotIn("Metadata/plate_1.gcode", names)
        self.assertIn("3D/3dmodel.model", names)
        self.assertIn("Metadata/plate_1.png", names)
        self.assertTrue(any("slice again" in w for w in report["warnings"]))

    def test_nexprint_project_picks_nearest_layer_height(self):
        out, report = converter_3mf.convert(sample_files.elegoo_style_project())
        cfg = _config(out)
        self.assertEqual(report["source"], "nexprint")
        self.assertEqual(cfg["print_settings_id"], "0.16mm Standard @Snapmaker U1 (0.4 nozzle)")
        self.assertEqual(cfg["filament_settings_id"], ["Generic PETG"])
        self.assertEqual(cfg["layer_height"], "0.16")

    def test_refuses_what_it_cannot_honestly_convert(self):
        with self.assertRaises(converter_3mf.ConversionError):
            converter_3mf.convert(b"not a zip")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("3D/3dmodel.model", '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
                                           '<metadata name="Application">PrusaSlicer-2.8</metadata></model>')
        with self.assertRaisesRegex(converter_3mf.ConversionError, "Only MakerWorld"):
            converter_3mf.convert(buf.getvalue())
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("3D/3dmodel.model", '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
                                           '<metadata name="Application">BambuStudio-01.10</metadata></model>')
        with self.assertRaisesRegex(converter_3mf.ConversionError, "only contains the model"):
            converter_3mf.convert(buf.getvalue())

    def test_already_snapmaker(self):
        out, _ = converter_3mf.convert(sample_files.bambu_style_project())
        with self.assertRaisesRegex(converter_3mf.ConversionError, "already"):
            converter_3mf.convert(out)

    def test_too_many_filaments_is_warned_about(self):
        data = sample_files._project_3mf("BambuStudio-01.10", {
            "printer_model": "Bambu Lab P1S", "filament_type": ["PLA"] * 6,
            "filament_colour": ["#000000"] * 6, "nozzle_diameter": ["0.4"], "layer_height": "0.2"})
        _, report = converter_3mf.convert(data)
        self.assertTrue(any("4 toolheads" in w for w in report["warnings"]))

    def test_converted_name(self):
        self.assertEqual(converter_3mf.converted_name("dragon.gcode.3mf"), "dragon_U1.3mf")


if __name__ == "__main__":
    unittest.main()
