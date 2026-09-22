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
