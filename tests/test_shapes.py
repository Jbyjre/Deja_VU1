"""Free-form solids: outlines with holes and rounded corners, spun profiles and gears, all closed and outward."""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import carve  # noqa: E402
import shapes  # noqa: E402


def closed(triangles):
    edges = {}
    for t in triangles:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            key = (tuple(round(v, 6) for v in a), tuple(round(v, 6) for v in b))
            edges[key] = edges.get(key, 0) + 1
    return all(n == 1 and edges.get((b, a)) == 1 for (a, b), n in edges.items())


SQUARE = [[0, 0], [40, 0], [40, 30], [0, 30]]


class TestShapes(unittest.TestCase):
    def check(self, triangles, wanted, delta=0.002):
        self.assertTrue(closed(triangles))
        self.assertAlmostEqual(carve.volume(triangles) / wanted, 1, delta=delta)

    def test_an_outline_in_either_direction_becomes_the_same_solid(self):
        self.check(shapes.extrude(SQUARE, 5), 40 * 30 * 5)
        self.check(shapes.extrude(list(reversed(SQUARE)), 5), 40 * 30 * 5)

    def test_an_l_shaped_outline_with_a_reflex_corner(self):
        self.check(shapes.extrude([[0, 0], [30, 0], [30, 5], [5, 5], [5, 25], [0, 25]], 3), (30 * 5 + 5 * 20) * 3)

    def test_holes_go_right_through(self):
        holes = [shapes.circle(8, 64, (10, 10)), shapes.circle(8, 64, (30, 20))]
        hole_area = 64 / 2 * 16 * math.sin(2 * math.pi / 64)
        self.check(shapes.extrude(SQUARE, 5, holes=holes), (40 * 30 - 2 * hole_area) * 5)

    def test_rounded_corners(self):
        self.check(shapes.extrude(SQUARE, 5, radius=5), (40 * 30 - (4 - math.pi) * 25) * 5, delta=0.003)

    def test_a_profile_spun_round_makes_a_cup_with_a_floor(self):
        cup = shapes.revolve([[0, 0], [30, 0], [30, 60], [27, 60], [27, 3], [0, 3]], 128)
        self.check(cup, math.pi * (30 ** 2 * 60 - 27 ** 2 * 57), delta=0.002)
        self.assertEqual(round(carve.bounds(cup)[0][2], 6), 0)

    def test_a_gear_has_its_size_and_teeth(self):
        outline, info = shapes.gear_outline(20, 2)
        self.assertEqual(info, {"pitch_diameter": 40.0, "outside_diameter": 44.0})
        radii = [math.hypot(x, y) for x, y in outline]
        self.assertAlmostEqual(max(radii), 22, places=6)
        self.assertAlmostEqual(min(radii), 17.5, places=6)               # root: pitch radius less 1.25 modules
        gear = shapes.extrude(outline, 6, holes=[shapes.circle(5, 48)])
        self.assertTrue(closed(gear))
        self.assertLess(carve.volume(gear), math.pi * 22 ** 2 * 6)
        self.assertGreater(carve.volume(gear), math.pi * 17.5 ** 2 * 6 - math.pi * 2.5 ** 2 * 6)

    def test_bad_outlines_are_refused_in_words(self):
        for points, holes in (([[0, 0], [10, 10], [10, 0], [0, 10]], None),       # crosses itself
                              (SQUARE, [shapes.circle(10, 32, (38, 15))]),       # hole pokes out
                              ([[0, 0], [10, 0]], None),
                              ([[0, 0], [10, 0], [5, "x"]], None)):
            with self.assertRaises(shapes.ShapeError):
                shapes.extrude(points, 3, holes=holes)
        with self.assertRaises(shapes.ShapeError):
            shapes.revolve([[-5, 0], [10, 0], [10, 10]])
        with self.assertRaises(shapes.ShapeError):
            shapes.gear_outline(3, 2)


if __name__ == "__main__":
    unittest.main()
