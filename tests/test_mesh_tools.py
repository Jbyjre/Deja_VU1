"""Tests for backend/mesh_tools.py - STL/3MF reading and the PNG thumbnail."""

import io
import os
import sys
import unittest
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "backend"))


import mesh_tools  # noqa: E402
import sample_files  # noqa: E402

MODEL = ('<?xml version="1.0"?><model unit="millimeter" '
         'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
         'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">'
         '<resources><object id="2" type="model"><components>'
         '<component p:path="/3D/Objects/part.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/>'
         '</components></object></resources>'
         '<build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 5"/></build></model>')
PART = ('<?xml version="1.0"?><model unit="millimeter" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>'
        '<object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/>'
        '<vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>'
        '<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>'
        '</resources></model>')


class TestMesh(unittest.TestCase):
    def test_binary_stl_round_trip(self):
        tris = sample_files.dock_bracket_triangles()
        parsed = mesh_tools.parse_stl(mesh_tools.to_binary_stl(tris))
        self.assertEqual(len(parsed), len(tris))
        self.assertEqual(mesh_tools.bounds(parsed)["size"], [30.0, 40.0, 25.0])

    def test_ascii_stl(self):
        text = ("solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 2 0 0\n"
                "vertex 0 3 0\nendloop\nendfacet\nendsolid t\n").encode()
        self.assertEqual(mesh_tools.bounds(mesh_tools.parse_stl(text))["size"], [2.0, 3.0, 0.0])

    def test_3mf_components_and_transforms_across_parts(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("3D/3dmodel.model", MODEL)
            z.writestr("3D/Objects/part.model", PART)
        tris, info = mesh_tools.parse_3mf(buf.getvalue())
        self.assertEqual(len(tris), 1)
        # component moves +10 in X, the build item +5 in Z
        self.assertEqual(tris[0][0], (10.0, 0.0, 5.0))
        self.assertEqual(info["objects"], 1)

    def test_bad_files_raise_a_clear_error(self):
        with self.assertRaises(mesh_tools.MeshError):
            mesh_tools.parse_3mf(b"not a zip")
        with self.assertRaises(mesh_tools.MeshError):
            mesh_tools.parse_stl(b"hello")

    def test_png_thumbnail_is_a_real_png(self):
        png = mesh_tools.png_thumbnail(sample_files.dock_bracket_triangles(), 64)
        self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertIn(b"IHDR", png[:20])


if __name__ == "__main__":
    unittest.main()


class TestHostileModels(unittest.TestCase):
    """Damaged or hostile models are refused in words, quickly, without filling memory."""

    def zip_of(self, entries):
        import io
        import zipfile
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for name, data in entries.items():
                z.writestr(name, data)
        return buf.getvalue()

    def test_a_zip_bomb_is_refused_before_unpacking(self):
        import time
        import safe_zip
        bomb = self.zip_of({"3D/3dmodel.model": b" " * (safe_zip.MAX_PART_BYTES + 1024)})
        self.assertLess(len(bomb), 3 * 1024 * 1024)
        began = time.monotonic()
        with self.assertRaisesRegex(ValueError, "would unpack to"):
            mesh_tools.parse_model(bomb, "bomb.3mf")
        self.assertLess(time.monotonic() - began, 2)

    def test_xml_entity_expansion_is_refused(self):
        entities = b"".join(b'<!ENTITY e%d "%s">' % (i, (b"&e%d;" % (i - 1)) * 10) for i in range(1, 9))
        bomb = b'<?xml version="1.0"?><!DOCTYPE m [<!ENTITY e0 "aaaaaaaaaa">' + entities + b']><model>&e8;</model>'
        # A billion "a"s from 1 KB of XML: expat refuses it itself.
        with self.assertRaisesRegex(ValueError, "amplification"):
            mesh_tools.parse_model(self.zip_of({"3D/3dmodel.model": bomb}), "x.3mf")

    def test_damaged_archives_say_so(self):
        good = sample_files.build("sample_bambu_studio_layout.3mf")
        info = zipfile.ZipFile(io.BytesIO(good)).getinfo("3D/3dmodel.model")
        data_at = info.header_offset + 30 + len(info.filename.encode()) + len(info.extra)
        corrupt = bytearray(good)
        for i in range(data_at + 20, data_at + 80):
            corrupt[i] ^= 0x5A                      # inside the model part's compressed data
        with self.assertRaises(ValueError):
            mesh_tools.parse_model(bytes(corrupt), "x.3mf")
        with self.assertRaises(ValueError):
            mesh_tools.parse_model(good[: len(good) // 2], "x.3mf")

    def test_a_triangle_pointing_nowhere(self):
        model = (b'<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>'
                 b'<object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/>'
                 b'<vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles>'
                 b'<triangle v1="0" v2="1" v3="9"/></triangles></mesh></object></resources>'
                 b'<build><item objectid="1"/></build></model>')
        with self.assertRaisesRegex(ValueError, "vertex 9"):
            mesh_tools.parse_model(self.zip_of({"3D/3dmodel.model": model}), "x.3mf")

    def test_coordinates_that_arent_numbers(self):
        import struct
        nan_stl = b"\0" * 80 + struct.pack("<I", 1) + struct.pack("<12fH", 0, 0, 1, float("nan"), 0, 0,
                                                                     1, 0, 0, 0, 1, 0, 0)
        with self.assertRaisesRegex(ValueError, "isn't a number"):
            mesh_tools.parse_model(nan_stl, "x.stl")
        ascii_inf = b"solid x\nfacet normal 0 0 1\nouter loop\nvertex 1 2 inf\nvertex 0 0 0\nvertex 1 1 1\n"
        with self.assertRaisesRegex(ValueError, "isn't a number"):
            mesh_tools.parse_model(ascii_inf, "x.stl")

    def test_a_cut_short_stl_says_so(self):
        data = mesh_tools.to_binary_stl(sample_files.dock_bracket_triangles())
        with self.assertRaisesRegex(ValueError, "cut short"):
            mesh_tools.parse_model(data[:-100], "x.stl")

    def test_a_large_model_is_summarised_without_holding_it(self):
        import struct
        n = 300_000
        data = b"\0" * 80 + struct.pack("<I", n) + struct.pack("<12fH", 0, 0, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0) * n
        summary = mesh_tools.summarize(data, "big.stl", keep=1000)
        self.assertEqual(summary["count"], n)
        self.assertLessEqual(len(summary["sample"]), 2000)
        self.assertEqual(summary["bounds"]["size"], [6.0, 6.0, 6.0])
