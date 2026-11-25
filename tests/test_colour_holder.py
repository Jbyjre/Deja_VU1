"""The printable parts for the colour checker (tools/colour-holder.py).

These tests check the geometry the design depends on: a closed mesh, a strand channel that runs straight through,
a chimney that shuts the chip off from the board's own LEDs while a slit lets it see the strand, a pocket that fits
the board's published size and a cradle that leaves the Pico's antenna end free. They cannot check how the real board
fits: its chip position and its socket height are estimates until someone measures one (docs/colour-checker.md).
"""

import collections
import importlib.util
import os
import struct
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("colour_holder", os.path.join(ROOT, "tools", "colour-holder.py"))
holder = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(holder)

P = dict(holder.PARAMS)
L = holder.layout(P)
CX, CY = L["chip_cx"], L["chip_cy"]


def steps(start, stop, step):
    value = start
    while value <= stop:
        yield value
        value += step


class TestMeshes(unittest.TestCase):
    def test_every_part_is_a_closed_mesh_with_positive_volume(self):
        for name, make in holder.PARTS.items():
            triangles = make(P).triangles()
            edges = collections.Counter()
            for a, b, c in triangles:
                for u, v in ((a, b), (b, c), (c, a)):
                    edges[(tuple(round(t, 4) for t in u), tuple(round(t, 4) for t in v))] += 1
            bad = [e for e in edges if edges[e] != 1 or edges.get((e[1], e[0])) != 1]
            volume = sum(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
                         for a, b, c in triangles) / 6
            self.assertEqual(bad, [], name)
            self.assertGreater(volume, 100, name)

    def test_no_wall_is_thinner_than_a_print_line_or_two(self):
        """Walk every row of cells along each axis: a run of solid shorter than 0.8 mm cannot be printed as a wall."""
        for name, make in holder.PARTS.items():
            xs, ys, zs, solid = make(P).cells()
            lines = (xs, ys, zs)
            thin = []
            for axis in range(3):
                others = [a for a in range(3) if a != axis]
                rows = {(i, j) for (i, j, k) in ((c[others[0]], c[others[1]], 0) for c in solid)}
                for a, b in rows:
                    index, run = 0, 0.0
                    while index < len(lines[axis]) - 1:
                        cell = [0, 0, 0]
                        cell[others[0]], cell[others[1]], cell[axis] = a, b, index
                        if tuple(cell) in solid:
                            run += lines[axis][index + 1] - lines[axis][index]
                        else:
                            if 0 < run < 0.8:
                                thin.append((axis, a, b, round(run, 2)))
                            run = 0.0
                        index += 1
                    if 0 < run < 0.8:
                        thin.append((axis, a, b, round(run, 2)))
            self.assertEqual(thin, [], name)

    def test_the_stl_files_are_readable_and_in_millimetres(self):
        with tempfile.TemporaryDirectory() as folder:
            holder.main(["--out", folder])
            for name in holder.PARTS:
                with open(os.path.join(folder, name + ".stl"), "rb") as handle:
                    data = handle.read()
                count = struct.unpack("<I", data[80:84])[0]
                self.assertEqual(len(data), 84 + 50 * count, name)
                first = struct.unpack("<12fH", data[84:134])
                self.assertAlmostEqual(sum(t * t for t in first[0:3]) ** 0.5, 1.0, places=3)
                self.assertTrue(all(abs(v) < 100 for v in first[3:12]))


class TestTheLightPath(unittest.TestCase):
    def setUp(self):
        self.block = holder.block(P)

    def free(self, x, y, z):
        return not self.block.inside(x, y, z)

    def test_the_strand_channel_runs_straight_through_the_whole_block(self):
        for y in steps(0.25, L["LY"] - 0.25, 0.5):
            for dx in (-0.85, 0.0, 0.85):  # a 1.75 mm strand is 0.875 mm either side of its middle
                self.assertTrue(self.free(CX + dx, y, L["axis_z"]), "blocked at y=%.2f dx=%.2f" % (y, dx))

    def test_both_ends_take_a_tube_wider_than_the_channel_and_stop_at_its_depth(self):
        tube = P["tube_od"] / 2
        for y in (0.5, P["tube_depth"] - 0.5, L["LY"] - 0.5, L["LY"] - P["tube_depth"] + 0.5):
            self.assertTrue(self.free(CX + tube * 0.9, y, L["axis_z"] + tube * 0.9), y)
        wide = CX + P["tube_od"] / 2 * 0.9
        for y in (P["tube_depth"] + 1.0, 20.0, L["LY"] - P["tube_depth"] - 1.0):  # past a socket the channel is narrow again
            self.assertFalse(self.free(wide, y, L["axis_z"]), y)

    def test_the_chip_sees_the_strand_through_the_slit_and_nothing_else(self):
        # straight down from the chip's window to the top of the strand is open
        for z in steps(L["strand_top"] + 0.1, -P["chip_h"], 0.1):
            self.assertTrue(self.free(CX, CY, z), z)
        mid_plate = L["strand_top"] + P["mask_t"] / 2
        self.assertFalse(self.free(CX + P["slit_x"] / 2 + 0.3, CY, mid_plate))    # beside the slit the mask is solid
        self.assertFalse(self.free(CX, CY + P["slit_y"] / 2 + 0.3, mid_plate))
        self.assertTrue(self.free(CX + P["slit_x"] / 2 - 0.2, CY, mid_plate))     # inside the slit it is open
        self.assertTrue(self.free(CX, CY, mid_plate))

    def test_the_chimney_walls_stand_between_the_chip_and_the_boards_leds(self):
        outer = 4.0 / 2 + 1.2
        for z in (-1.8, -1.0, -0.2):
            self.assertFalse(self.free(CX + outer - 0.3, CY, z), z)   # a wall at the chip's side
            self.assertFalse(self.free(CX - outer + 0.3, CY, z), z)
            self.assertTrue(self.free(CX + outer + 0.4, CY, z), z)    # beyond it, the light well the LEDs shine into
        self.assertFalse(self.free(CX + outer - 0.3, CY, -0.01))      # it reaches the board's underside

    def test_the_light_well_is_open_over_the_strand_so_the_leds_light_it(self):
        outer = 4.0 / 2 + 1.2
        for dy in (-8.0, -5.0, 5.0, 8.0):
            self.assertTrue(self.free(CX, CY + dy, -1.0), dy)
            self.assertTrue(self.free(CX, CY + dy, L["strand_top"] - 0.5), dy)
        self.assertGreater(CY - L["y0"], outer)

    def test_the_pocket_is_the_published_board_size_plus_the_fit_and_the_board_rests_on_a_ledge(self):
        self.assertAlmostEqual(L["pocket_x"], 30.5 + 2 * P["fit"])
        self.assertAlmostEqual(L["pocket_y"], 23.0 + 2 * P["fit"])
        self.assertTrue(self.free(L["x0"] + 0.1, L["y0"] + 0.1, 0.5))
        self.assertFalse(self.free(L["x0"] + 0.5, L["y0"] + 0.5, -0.5))          # the ledge holds the board's edge
        self.assertTrue(self.free(L["x0"] + 4.0, L["y0"] + 4.0, -0.5))           # under the board's middle is the light well

    def test_the_strand_sits_one_to_two_millimetres_from_the_sensors_window(self):
        window = -P["chip_h"]
        distance = window - L["strand_top"]
        self.assertGreaterEqual(distance, 1.0)
        self.assertLessEqual(distance, 2.0)

    def test_the_cable_has_a_way_out_and_the_socket_has_room(self):
        self.assertTrue(self.free(L["x1"] + 1.0, CY, -1.5))
        self.assertTrue(self.free(L["x1"] - 2.0, CY, -P["socket_h"] + 0.5))

    def test_moving_the_chip_moves_the_channel_with_it(self):
        moved = dict(P, chip_x=P["chip_x"] + 2.0)
        lay = holder.layout(moved)
        self.assertAlmostEqual(lay["chip_cx"] - L["chip_cx"], 2.0)
        block = holder.block(moved)
        for y in steps(0.25, lay["LY"] - 0.25, 1.0):
            self.assertFalse(block.inside(lay["chip_cx"], y, lay["axis_z"]), y)

    def test_the_test_piece_has_the_same_pocket_and_chimney_in_a_shorter_block(self):
        coupon = holder.block(P, coupon=True)
        full = holder.block(P)
        self.assertLess(coupon.bounds()[1][1] - coupon.bounds()[1][0], full.bounds()[1][1] - full.bounds()[1][0])
        for point in ((CX, CY, -1.0), (CX + 3.0, CY, -1.0), (L["x0"] + 0.5, L["y0"] + 0.5, -0.5)):
            self.assertEqual(coupon.inside(*point), full.inside(*point), point)


class TestTheLidAndTheCradle(unittest.TestCase):
    def test_the_lid_goes_inside_the_pocket_with_play_and_presses_the_board_with_four_ribs(self):
        lid = holder.lid(P)
        (x0, x1), (y0, y1), (z0, z1) = lid.bounds()
        self.assertLess(x1 - x0, L["pocket_x"])
        self.assertLess(y1 - y0, L["pocket_y"])
        self.assertAlmostEqual(z1, P["lid_t"])
        self.assertLess(z0, 0)
        self.assertLessEqual(P["board_t"] + P["lid_t"], L["top"])

    def test_the_cradle_carries_the_pico_by_its_pin_rows_and_leaves_the_antenna_end_free(self):
        cradle = holder.cradle(P)
        (x0, x1), (y0, y1), (z0, z1) = cradle.bounds()
        centre = (x0 + x1) / 2
        for sign in (-1, 1):
            self.assertFalse(cradle.inside(centre + sign * 17.78 / 2, 5.0, 5.0))      # a groove where each pin row goes down
        self.assertTrue(cradle.inside(centre, 5.0, 4.0))                                  # a platform between them
        self.assertLessEqual(y1 - y0, 51.0 - 14.0 + 3.5)                                  # the last 14 mm of the board overhangs
        self.assertTrue(x1 - x0 >= 21.0)

    def test_the_cradle_is_built_from_the_pico_sizes_the_tool_names(self):
        with open(os.path.join(ROOT, "tools", "colour-holder.py"), encoding="utf-8") as handle:
            source = handle.read()
        for fact in ("17.78", "14.0", "51.0", "21.0"):
            self.assertIn(fact, source)



class TestPublishedFiles(unittest.TestCase):
    def test_the_stl_files_offered_in_the_setup_window_are_what_the_generator_makes(self):
        with tempfile.TemporaryDirectory() as folder:
            holder.main(["--out", folder])
            for name in holder.PARTS:
                with open(os.path.join(folder, name + ".stl"), "rb") as fresh, \
                        open(os.path.join(ROOT, "frontend", "colour-checker", "holder", name + ".stl"), "rb") as shipped:
                    self.assertEqual(fresh.read(), shipped.read(),
                                     "run: python3 tools/colour-holder.py --out frontend/colour-checker/holder")


if __name__ == "__main__":
    unittest.main()
