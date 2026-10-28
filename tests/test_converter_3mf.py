"""Tests for backend/converter_3mf.py - MakerWorld / NexPrint to Snapmaker U1."""

import io
import json
import math
import os
import re
import sys
import unittest
import zipfile
from xml.etree import ElementTree

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
                                           '<metadata name="Application">Cura 5.8</metadata></model>')
        with self.assertRaisesRegex(converter_3mf.ConversionError, "are supported"):
            converter_3mf.convert(buf.getvalue())
        # A PrusaSlicer 3MF with no project settings in it is only a model.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("3D/3dmodel.model", '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
                                           '<metadata name="Application">PrusaSlicer-2.8</metadata></model>')
        with self.assertRaisesRegex(converter_3mf.ConversionError, "only contains the model"):
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

    def test_more_filaments_than_heads_are_fitted_to_four(self):
        # Six AMS slots, but the model only prints with the first one.
        data = sample_files._project_3mf("BambuStudio-01.10", {
            "printer_model": "Bambu Lab P1S", "filament_type": ["PLA"] * 6,
            "filament_colour": ["#000000"] * 6, "nozzle_diameter": ["0.4"], "layer_height": "0.2"})
        out, report = converter_3mf.convert(data)
        self.assertEqual(report["colours"]["dropped"], [2, 3, 4, 5, 6])
        self.assertEqual(_config(out)["filament_colour"], ["#000000"])
        self.assertFalse(any("4 toolheads" in w for w in report["warnings"]))

    def test_converted_name(self):
        self.assertEqual(converter_3mf.converted_name("dragon.gcode.3mf"), "dragon_U1.3mf")


def _items(data):
    model = zipfile.ZipFile(io.BytesIO(data)).read("3D/3dmodel.model").decode()
    return [(int(m.group(1)), [float(v) for v in m.group(2).split()])
            for m in re.finditer(r'<item objectid="(\d+)" transform="([^"]*)"', model)]


def _rebuild(data, replace):
    """Copy a 3MF, swapping some parts' text."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, "w") as z:
        for item in src.infolist():
            body = src.read(item)
            if item.filename in replace:
                body = replace[item.filename](body.decode()).encode()
            z.writestr(item.filename, body)
    return out.getvalue()


class TestPlates(unittest.TestCase):
    """Multi-plate projects land on the U1's own plate grid (PartPlate.cpp)."""

    def plate_origin(self, index, count, width, depth):
        # Written from Orca independently of the converter: plate i sits at
        # column i % cols, row i // cols, cols = ceil(sqrt(count)),
        # each plate size * (1 + 1/5) from the last.
        cols = math.ceil(math.sqrt(count))
        return (index % cols) * width * 1.2, -(index // cols) * depth * 1.2

    def test_every_plate_lands_on_the_matching_u1_plate(self):
        data = sample_files.bambu_multiplate_project()
        before = dict(_items(data))
        out, report = converter_3mf.convert(data)
        after = dict(_items(out))
        self.assertEqual(report["plates"]["count"], 3)
        self.assertEqual(report["plates"]["moved"], ["1", "2", "3"])
        self.assertEqual(report["plates"]["skipped"], [])
        plate_of = {1: 0, 2: 0, 3: 1, 4: 2}
        for oid, plate in plate_of.items():
            sx, sy = self.plate_origin(plate, 3, 256, 256)
            tx, ty = self.plate_origin(plate, 3, 270, 270)
            local = (before[oid][9] - sx, before[oid][10] - sy)
            # same spot relative to the bed's centre: Bambu 128,128 -> U1 135.5,136
            want = (tx + local[0] - 128 + 135.5, ty + local[1] - 128 + 136)
            self.assertAlmostEqual(after[oid][9], want[0], places=3)
            self.assertAlmostEqual(after[oid][10], want[1], places=3)
            self.assertEqual(after[oid][11], before[oid][11])      # height untouched
            self.assertEqual(after[oid][:9], before[oid][:9])      # rotation and scale untouched
        # objects that shared a plate keep their distance
        self.assertAlmostEqual(after[2][9] - after[1][9], before[2][9] - before[1][9], places=6)

    def test_a_plate_that_cant_be_matched_up_is_left_alone(self):
        data = _rebuild(sample_files.bambu_multiplate_project(), {
            "Metadata/model_settings.config":
                lambda s: s.replace('<metadata key="object_id" value="3"/>', '<metadata key="object_id" value="99"/>')})
        before = dict(_items(data))
        out, report = converter_3mf.convert(data)
        after = dict(_items(out))
        self.assertEqual(report["plates"]["skipped"], ["2"])
        self.assertEqual(after[3], before[3])
        self.assertNotEqual(after[1], before[1])
        self.assertTrue(any("Plate 2" in w and "left exactly as it was" in w for w in report["warnings"]))

    def test_the_converted_model_still_parses(self):
        out, _ = converter_3mf.convert(sample_files.bambu_multiplate_project())
        model = zipfile.ZipFile(io.BytesIO(out)).read("3D/3dmodel.model")
        ElementTree.fromstring(model)

    def test_projects_without_a_plate_list_are_untouched(self):
        data = sample_files.bambu_style_project()
        out, report = converter_3mf.convert(data)
        self.assertEqual(_items(out), _items(data))
        self.assertEqual(report["plates"]["count"], 0)

    def test_a_bigger_bed_is_warned_about(self):
        data = _rebuild(sample_files.bambu_multiplate_project(), {
            "Metadata/project_settings.config":
                lambda s: s.replace('"256x0"', '"350x0"').replace('"256x256"', '"350x320"').replace('"0x256"', '"0x320"'),
            "3D/3dmodel.model": lambda s: s.replace(" 158.0000 128.0000 0", " 330.0000 128.0000 0")})
        _, report = converter_3mf.convert(data)
        self.assertTrue(any("outside the U1" in w for w in report["warnings"]), report["warnings"])

    def test_bed_size_is_read_the_way_orca_reads_it(self):
        self.assertEqual(converter_3mf._bed(converter_3mf.U1_PRINTABLE_AREA)["width"], 270)
        self.assertEqual(converter_3mf._bed("0x0,256x0,256x256,0x256")["stride_x"], 256 * 1.2)
        self.assertIsNone(converter_3mf._bed(["junk"]))


class TestErrors(unittest.TestCase):
    def test_every_refusal_has_a_code_a_stage_and_a_next_step(self):
        cases = [b"not a zip"]
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("3D/3dmodel.model", '<model><metadata name="Application">Cura 5.8</metadata></model>')
        cases.append(buf.getvalue())
        out, _ = converter_3mf.convert(sample_files.bambu_style_project())
        cases.append(out)
        codes = []
        for data in cases:
            with self.assertRaises(converter_3mf.ConversionError) as caught:
                converter_3mf.convert(data)
            d = caught.exception.as_dict()
            self.assertRegex(d["code"], r"^CV-\d{3}$")
            self.assertTrue(d["stage"] and d["action"] and d["error"])
            codes.append(d["code"])
        self.assertEqual(codes, ["CV-101", "CV-202", "CV-201"])

    def test_codes_are_unique(self):
        codes = [v[0] for v in converter_3mf.ERRORS.values()]
        self.assertEqual(len(codes), len(set(codes)))

    def test_orcaslicer_projects_convert(self):
        data = sample_files._project_3mf("OrcaSlicer-2.3.1", {
            "printer_model": "Voron 2.4 350", "printer_settings_id": "Voron 2.4 350 0.4 nozzle",
            "filament_type": ["PLA"], "filament_colour": ["#FF0000"], "nozzle_diameter": ["0.4"],
            "layer_height": "0.2", "printable_area": ["0x0", "350x0", "350x350", "0x350"]})
        out, report = converter_3mf.convert(data)
        self.assertEqual(report["source"], "orca")
        self.assertEqual(report["source_label"], "OrcaSlicer")
        self.assertEqual(_config(out)["printer_settings_id"], "Snapmaker U1 (0.4 nozzle)")


if __name__ == "__main__":
    unittest.main()
