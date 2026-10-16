"""
Tests for backend/photo_studio.py - the server half of the Photo-to-Print
Studio: the palette it offers (your filament, or clearly-labelled
suggestions) and the checks on the model the browser built.
"""

import io
import os
import struct
import sys
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))

import file_library        # noqa: E402
import filament_inventory  # noqa: E402
import modules             # noqa: E402
import photo_studio        # noqa: E402


def box_stl(w=40.0, d=30.0, h=2.0):
    """A closed box as binary STL - the simplest thing the studio could send."""
    v = [(x, y, z) for z in (0, h) for y in (0, d) for x in (0, w)]
    faces = [(0, 2, 1), (1, 2, 3), (4, 5, 6), (5, 7, 6), (0, 1, 4), (1, 5, 4),
             (2, 6, 3), (3, 6, 7), (0, 4, 2), (2, 4, 6), (1, 3, 5), (3, 7, 5)]
    out = bytearray(80) + struct.pack("<I", len(faces))
    for f in faces:
        out += struct.pack("<3f", 0, 0, 0)
        for i in f:
            out += struct.pack("<3f", *v[i])
        out += b"\0\0"
    return bytes(out)


def studio_3mf(swaps, w=40.0):
    """A 3MF laid out the way studio.js writes it, with its swap plan."""
    model = ('<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" '
             'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>'
             '<object id="1" type="model"><mesh><vertices>'
             f'<vertex x="0" y="0" z="0"/><vertex x="{w}" y="0" z="0"/><vertex x="0" y="{w}" z="0"/>'
             '<vertex x="0" y="0" z="2"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/>'
             '<triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/>'
             '</triangles></mesh></object></resources><build><item objectid="1"/></build></model>')
    layers = "".join(f'<layer top_z="{z}" type="2" extruder="{e}" color="{c}" extra="" gcode="tool_change"/>'
                     for z, e, c in swaps)
    plan = ('<?xml version="1.0" encoding="utf-8"?><custom_gcodes_per_layer><plate><plate_info id="1"/>'
            f'{layers}<mode value="MultiAsSingle"/></plate></custom_gcodes_per_layer>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("3D/3dmodel.model", model)
        z.writestr(photo_studio.CUSTOM_GCODE_PART, plan)
    return buf.getvalue()


class PhotoStudioTest(unittest.TestCase):
    def setUp(self):
        modules.reset_state()
        file_library.reset()
        filament_inventory.reset()

    def tearDown(self):
        modules.reset_state()
        file_library.reset()
        filament_inventory.reset()

    def test_palette_uses_your_spools_when_inventory_is_on(self):
        modules.set_enabled("filament_inventory", True)
        p = photo_studio.palette()
        self.assertEqual(p["source"], "inventory")
        self.assertEqual([c["hex"] for c in p["colours"]],
                         [s["color_hex"].upper() for s in filament_inventory.get_inventory()])
        self.assertTrue(all(c["td_source"] == "estimate" for c in p["colours"]))

    def test_palette_without_inventory_claims_nothing(self):
        modules.set_enabled("filament_inventory", False)
        p = photo_studio.palette()
        self.assertEqual((p["source"], p["colours"]), ("free", []))
        self.assertTrue(p["suggestions"])
        self.assertIn("nothing here claims you own them", p["note"])

    def test_estimated_td_orders_dark_below_light(self):
        self.assertLess(photo_studio.estimate_td("#111111"), photo_studio.estimate_td("#888888"))
        self.assertLess(photo_studio.estimate_td("#888888"), photo_studio.estimate_td("#FFFFFF"))

    def test_saves_a_real_stl(self):
        result = photo_studio.save("portrait.stl", box_stl(), note="4 colours")
        self.assertEqual(result["triangles"], 12)
        entry = file_library.describe("portrait.stl")
        self.assertEqual(entry["origin"], "studio")
        self.assertIn("4 colours", entry["note"])

    def test_reads_back_the_swap_plan_from_a_3mf(self):
        data = studio_3mf([(1.2, 2, "#C8102E"), (0.6, 1, "#1C1C1E")])
        self.assertEqual([(s["top_z"], s["extruder"], s["type"]) for s in photo_studio.read_swap_plan(data)],
                         [(0.6, 1, 2), (1.2, 2, 2)])
        result = photo_studio.save("portrait.3mf", data)
        self.assertEqual(len(result["swaps"]), 2)
        self.assertIn("T1 from 1.20 mm", file_library.describe("portrait.3mf")["note"])

    def test_refusals(self):
        with self.assertRaisesRegex(ValueError, "readable model"):
            photo_studio.save("x.stl", b"not a model at all, just some bytes" * 3)
        with self.assertRaisesRegex(ValueError, "doesn't fit"):
            photo_studio.save("huge.stl", box_stl(w=300))
        with self.assertRaisesRegex(ValueError, "STL or 3MF"):
            photo_studio.save("x.gcode", b"G28")
        broken = io.BytesIO()
        with zipfile.ZipFile(broken, "w") as z:
            z.writestr("3D/3dmodel.model", zipfile.ZipFile(io.BytesIO(studio_3mf([]))).read("3D/3dmodel.model"))
            z.writestr(photo_studio.CUSTOM_GCODE_PART, "<custom_gcodes_per_layer><plate><layer top_z='x'/>")
        with self.assertRaisesRegex(ValueError, "isn't valid XML"):
            photo_studio.save("x.3mf", broken.getvalue())
        self.assertEqual(file_library.list_files()["files"], [])


if __name__ == "__main__":
    unittest.main()
