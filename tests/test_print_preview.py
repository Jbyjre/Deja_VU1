"""
The print on the plate for the 3D twin (backend/print_preview.py): the
outside walls of every layer, per toolhead, from the file's own G-code.
"""

import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mock_moonraker      # noqa: E402
import moonraker_client as mc      # noqa: E402
import print_preview       # noqa: E402
import sample_files        # noqa: E402
from fake_moonraker import FakeMoonraker   # noqa: E402


def decode(path, unit=0.01):
    """[layer, object, x0, y0, dx, dy, ...] back to points in millimetres."""
    x, y, pts = path[2] * unit, path[3] * unit, []
    pts.append((x, y))
    for i in range(4, len(path), 2):
        x += path[i] * unit
        y += path[i + 1] * unit
        pts.append((x, y))
    return pts


class TestBuild(unittest.TestCase):
    def test_the_two_colour_benchies_come_in_both_heads(self):
        p = print_preview.build(sample_files.two_colour_benchy_pair_gcode())
        self.assertEqual(len(p["layers"]), 240)
        self.assertEqual(sorted(p["tools"]), ["T0", "T1"])
        self.assertEqual(p["objects"], ["3DBENCHY.STL_ID_0_COPY_0", "3DBENCHY.STL_ID_0_COPY_1"])
        # Below the deck the first boat is T0 (orange hull); above it, T1 (black cabin).
        deck = sample_files.TWO_COLOUR_DECK_MM
        for tool, below, above in (("T0", 0, 1), ("T1", 1, 0)):
            objs_low = {w[1] for w in p["tools"][tool]["walls"] if p["layers"][w[0]]["z"] <= deck}
            objs_high = {w[1] for w in p["tools"][tool]["walls"] if p["layers"][w[0]]["z"] > deck}
            self.assertEqual(objs_low, {below}, tool)
            self.assertEqual(objs_high, {above}, tool)
        self.assertLess(p["points"], print_preview.MAX_WALL_POINTS + print_preview.MAX_FILL_POINTS)

    def test_walls_stay_on_the_boats(self):
        p = print_preview.build(sample_files.two_colour_benchy_pair_gcode())
        for tool in p["tools"].values():
            for path in tool["walls"]:
                for x, y in decode(path):
                    self.assertTrue(103 <= x <= 167 and 94 <= y <= 176, (x, y))

    def test_only_outer_walls_and_surfaces_of_a_tagged_file(self):
        text = "\n".join([
            "G90", "M83", "T0", "G1 Z0.2", ";TYPE:Outer wall", "G1 X10 Y10", "G1 X20 Y10 E1", "G1 X20 Y20 E1",
            ";TYPE:Inner wall", "G1 X21 Y21", "G1 X30 Y21 E1",
            ";TYPE:Sparse infill", "G1 X40 Y40 E1",
            ";TYPE:Top surface", "G1 X50 Y50", "G1 X60 Y50 E1",
            "G1 X70 Y70",                                   # a travel: never drawn
        ])
        p = print_preview.build(text)
        walls, fill = p["tools"]["T0"]["walls"], p["tools"]["T0"]["fill"]
        self.assertEqual([decode(w) for w in walls], [[(10, 10), (20, 10), (20, 20)]])
        self.assertEqual([decode(f) for f in fill], [[(50, 50), (60, 50)]])

    def test_an_untagged_file_keeps_every_extruding_move(self):
        text = "\n".join(["G90", "M82", "G92 E0", "G1 Z0.3", "G1 X0 Y0", "G1 X10 Y0 E1", "G1 X10 Y10 E2",
                          "G1 X10 Y20 E2",                 # no new plastic: a travel
                          "T1", "G1 X30 Y20 E3", "G91", "G1 Z0.2", "G90", "G1 X40 Y20 E4"])
        p = print_preview.build(text)
        self.assertFalse(p["tagged"])
        self.assertEqual([decode(w) for w in p["tools"]["T0"]["walls"]], [[(0, 0), (10, 0), (10, 10)]])
        t1 = p["tools"]["T1"]["walls"]
        self.assertEqual([round(l["z"], 2) for l in p["layers"]], [0.3, 0.5])
        self.assertEqual([(w[0], decode(w)) for w in t1], [(0, [(10, 20), (30, 20)]), (1, [(30, 20), (40, 20)])])

    def test_a_skipped_object_is_named(self):
        text = "\n".join(["M83", "EXCLUDE_OBJECT_DEFINE NAME=a_part", "G1 Z0.2", "EXCLUDE_OBJECT_START NAME=a_part",
                          "G1 X1 Y1", "G1 X5 Y1 E1", "EXCLUDE_OBJECT_END NAME=a_part", "G1 X9 Y9 E1"])
        p = print_preview.build(text)
        self.assertEqual(p["objects"], ["A_PART"])
        self.assertEqual([w[1] for w in p["tools"]["T0"]["walls"]], [0, -1])


class TestCurrentPrint(unittest.TestCase):
    def setUp(self):
        mock_moonraker.reset_all()
        self.addCleanup(mock_moonraker.reset_all)

    def test_the_demo_farm_draws_its_two_colour_benchies(self):
        p = print_preview.for_current()
        self.assertEqual(p["file"], "two_benchies_two_colours.gcode")
        self.assertEqual(p["source"], "sample")
        self.assertEqual(p["file_colours"], ["#F26A1B", "#1C1C1E"])
        self.assertEqual(mock_moonraker.get_printer_state()["layer"]["total"], len(p["layers"]))

    def test_an_idle_printer_has_nothing_to_draw(self):
        with mock_moonraker.use_printer("u1-garage"):
            self.assertEqual(print_preview.for_current(), {"file": None, "reason": "Nothing is printing"})

    def test_a_file_nobody_holds_says_so(self):
        with mock_moonraker.use_printer("u1-studio"):
            p = print_preview.for_current()
        self.assertEqual(p["file"], "gridfinity_bin_2x1.gcode")
        self.assertIn("isn't in the file library", p["reason"])

    def test_the_demo_head_follows_the_boat_it_prints(self):
        printer = mock_moonraker._get("u1-workshop")
        plan = printer.job["object_tools"]
        for _ in range(40):
            mock_moonraker.advance(9, "u1-workshop")
            st = mock_moonraker.get_printer_state()
            cur, layer = st["objects"]["current"], st["layer"]["current"]
            want = plan[cur][0] if layer <= plan[cur][2] else plan[cur][1]
            self.assertEqual(st["active_toolhead"], want, (cur, layer))


class TestRealPrinter(unittest.TestCase):
    """A real printer's own copy is downloaded and read (Moonraker's file download)."""

    def setUp(self):
        self.fake = FakeMoonraker()
        self.addCleanup(self.fake.close)
        self.printer = mc.MoonrakerPrinter("p1", "Test U1", self.fake.url)

    def test_the_printers_copy_is_downloaded(self):
        text = "M83\nG1 Z0.2\n;TYPE:Outer wall\nG1 X1 Y1\nG1 X9 Y1 E1\n"
        self.fake.files["sub dir/part.gcode"] = text.encode()
        self.fake.metadata["sub dir/part.gcode"] = {"size": len(text), "modified": time.time()}
        self.assertEqual(self.printer.fetch_gcode("sub dir/part.gcode", 1024).decode(), text)
        self.assertEqual(self.printer.gcode_version("sub dir/part.gcode")[0], len(text))
        with self.assertRaises(mc.PrinterCommandError):
            self.printer.fetch_gcode("not_there.gcode", 1024)
        with self.assertRaises(mc.PrinterCommandError):
            self.printer.fetch_gcode("sub dir/part.gcode", 10)        # over the size limit
        with self.assertRaises(ValueError):
            self.printer.fetch_gcode("../moonraker.conf", 1024)


if __name__ == "__main__":
    unittest.main()
