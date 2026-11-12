"""The grid solid modeller: joins, cuts and keeps closed meshes and returns a closed surface."""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import ai_assistant  # noqa: E402
import carve  # noqa: E402


def box(w, d, h, at=(0, 0, 0)):
    return ai_assistant._placed(ai_assistant._shape("box", width=w, depth=d, height=h), list(at))


def cylinder(diameter, height, at=(0, 0, 0), rotate=None):
    return ai_assistant._placed(ai_assistant._shape("cylinder", diameter=diameter, height=height, segments=96), list(at), rotate)


class TestCarve(unittest.TestCase):
    def check(self, triangles, wanted, delta=0.005):
        self.assertEqual(carve.open_edges(triangles), 0)
        self.assertAlmostEqual(carve.volume(triangles) / wanted, 1, delta=delta)

    def test_a_single_box_keeps_its_exact_size_and_volume(self):
        tris, report = carve.carve([("add", box(20, 10, 5))])
        lo, hi = carve.bounds(tris)
        self.assertEqual([round(v, 6) for v in lo], [0, 0, 0])
        self.assertEqual([round(v, 6) for v in hi], [20, 10, 5])
        self.assertEqual(report, {"cell_mm": 0.4})
        self.check(tris, 20 * 10 * 5, delta=0.02)          # the edges are rounded by about a cell

    def test_a_hole_through_the_side(self):
        tris, _ = carve.carve([("add", box(30, 20, 20)), ("cut", cylinder(6, 40, at=(-5, 10, 10), rotate=[0, 90, 0]))])
        self.check(tris, 30 * 20 * 20 - math.pi * 9 * 30)

    def test_two_overlapping_parts_count_their_overlap_once(self):
        tris, _ = carve.carve([("add", box(20, 20, 10)), ("add", box(20, 20, 10, at=(10, 0, 0)))])
        self.check(tris, 30 * 20 * 10, delta=0.02)

    def test_keep_leaves_only_the_overlap(self):
        tris, _ = carve.carve([("add", box(20, 20, 10)), ("keep", box(20, 20, 10, at=(10, 5, 0)))])
        self.check(tris, 10 * 15 * 10, delta=0.03)

    def test_parts_work_in_order_so_a_peg_can_stand_in_a_cut_pocket(self):
        tris, _ = carve.carve([("add", box(20, 20, 10)), ("cut", box(10, 10, 10, at=(5, 5, 5))),
                               ("add", cylinder(4, 10, at=(10, 10, 5)))])
        self.check(tris, 20 * 20 * 10 - 10 * 10 * 5 + math.pi * 4 * 5, delta=0.02)

    def test_a_finer_grid_is_closer(self):
        parts = [("add", box(20, 20, 6)), ("cut", cylinder(5, 20, at=(10, 10, -5)))]
        wanted = 20 * 20 * 6 - math.pi * 6.25 * 6
        coarse = abs(carve.volume(carve.carve(parts, cell=0.8)[0]) - wanted)
        fine = abs(carve.volume(carve.carve(parts, cell=0.2)[0]) - wanted)
        self.assertLess(fine, coarse)

    def test_a_big_model_gets_a_coarser_grid_and_says_so(self):
        tris, report = carve.carve([("add", box(200, 200, 200))], cell=0.4)
        self.assertGreater(report["cell_mm"], 0.4)
        self.assertIn("grid instead of 0.4 mm", report["note"])
        self.assertEqual(carve.open_edges(tris), 0)
        self.assertEqual(carve.carve([("add", box(200, 20, 20))])[1]["cell_mm"], 0.8)   # 250 cells on the longest side

    def test_nothing_left_or_nothing_to_cut_from_is_said_in_words(self):
        with self.assertRaises(carve.CarveError):
            carve.carve([("add", box(10, 10, 10)), ("cut", box(20, 20, 20, at=(-5, -5, -5)))])
        with self.assertRaises(carve.CarveError):
            carve.carve([("cut", box(10, 10, 10))])
        with self.assertRaises(carve.CarveError):
            carve.carve([])

    def test_a_model_with_a_gap_in_its_surface_is_flagged(self):
        whole = box(10, 10, 10)
        leaky = whole[:2] + whole[3:]                         # one triangle of the top missing
        _, report = carve.carve([("add", leaky)])
        self.assertIn("isn't fully closed", report["warning"])

    def test_a_mesh_in_whole_millimetres_on_a_diagonal_still_comes_out_right(self):
        # Box faces are split along their diagonals; the grid's offsets keep rays off those shared edges.
        tris, _ = carve.carve([("add", box(10, 10, 10)), ("add", box(10, 10, 10, at=(10, 10, 0)))], cell=1.0)
        self.assertEqual(carve.open_edges(tris), 0)
        self.assertAlmostEqual(carve.volume(tris) / 2000, 1, delta=0.1)


if __name__ == "__main__":
    unittest.main()
