#!/usr/bin/env python3
"""
Makes the 3D-printable parts for the colour checker: a black holder for the sensor board that keeps the strand of
filament 1 to 2 mm below the sensor, and a cradle for the Pico W that sits beside it.

    python3 tools/colour-holder.py --out holder            # block, lid, cradle and a short test piece (STL, millimetres)
    python3 tools/colour-holder.py --out holder --chip-x 15.6 --tube-od 4.1

Standard library only. Each part is a union and difference of boxes on a grid, so every face is flat and the mesh is
watertight by construction (tests/test_colour_holder.py checks it). Print the parts in black PLA or PETG: a light colour
lets room light in and changes every reading. docs/colour-checker.md says how to print them and how to measure your board.

What is known and what is not
  Known, from the makers' own documents: the sensor board is 30.5 x 23 mm with 2.0 mm mounting holes (Waveshare wiki); the
  Pico W is 51 x 21 x 1 mm with four 2.1 mm holes and its antenna end needs a free 14 x 9 mm area (Raspberry Pi's Pico W
  datasheet); the sensor sees a 40 degree half cone (ams datasheet), which is why the strand sits 1 to 2 mm below it.
  Likely, not confirmed: the Pico's two pin rows are 17.78 mm (0.7 inch, seven 0.1 inch pitches) apart. The number is on
  Raspberry Pi's mechanical drawing, but the datasheet's text does not label it. Check it against your Pico with a ruler
  before you print the cradle, and change `rows` in cradle() if it differs.
  Estimated from a product picture, NOT measured: where the sensor chip sits on the board (--chip-x), the board's
  thickness, how tall its parts and socket are. Measure your board with a ruler or calipers and pass the numbers in, or print
  the test piece first (--part coupon) and check the fit before printing the whole block.
  Not known: the U1's tube size. --tube-od is a guess of 4.0 mm: measure the PTFE tube you use.
Nothing about the U1 itself is assumed: the block stands on a table or is fixed beside the filament path with tape, ties or
screws you add. Power the Pico from a USB wall charger, never from the printer.
"""

import argparse
import itertools
import os
import struct
import sys

PARAMS = {
    # the sensor board (Waveshare AS7341, lying component side down)
    "board_w": 30.5, "board_h": 23.0,   # Waveshare wiki
    "board_t": 1.6,                     # typical board thickness: measure
    "fit": 0.25,                        # clearance on each side of the board
    "chip_x": 14.9,                     # from the board's left edge to the middle of the chip, socket on the right: ESTIMATE from a picture
    "chip_h": 1.0,                      # how far the chip stands below the board: ams package, rounded up
    "gap": 1.0,                         # window to the nearest side of the strand, mm (the 1 to 2 mm of the setup guide)
    "socket_h": 7.0, "socket_len": 8.0, "socket_w": 16.0,   # room for the socket and plug on the right edge: ESTIMATE
    # the strand and its tube
    "chan_w": 2.3, "chan_h": 2.0,       # a 1.75 mm strand with a little play
    "tube_od": 4.0, "tube_fit": 0.15, "tube_depth": 8.0,    # PTFE tube pushed into a square socket: measure yours
    "wall": 2.4, "end": 3.0, "lid_t": 1.0,
    "cable_w": 10.0, "cable_h": 3.0,    # the sensor cable's way out through the right wall
    "slit_x": 2.3, "slit_y": 3.6,       # what the sensor sees, across and along the strand (across: as wide as the groove)
    "mask_t": 0.8,
}


class Solid:
    """A union and difference of axis-aligned boxes, turned into triangles on the grid their edges make."""

    def __init__(self):
        self.ops = []

    def add(self, x0, y0, z0, x1, y1, z1):
        self.ops.append((True, (x0, y0, z0, x1, y1, z1)))
        return self

    def cut(self, x0, y0, z0, x1, y1, z1):
        self.ops.append((False, (x0, y0, z0, x1, y1, z1)))
        return self

    def inside(self, x, y, z):
        state = False
        for solid, (x0, y0, z0, x1, y1, z1) in self.ops:
            if x0 <= x <= x1 and y0 <= y <= y1 and z0 <= z <= z1:
                state = solid
        return state

    def lines(self):
        return [sorted({round(box[axis], 4) for _, box in self.ops} | {round(box[axis + 3], 4) for _, box in self.ops})
                for axis in range(3)]

    def cells(self):
        xs, ys, zs = self.lines()
        solid = {}
        for i, j, k in itertools.product(range(len(xs) - 1), range(len(ys) - 1), range(len(zs) - 1)):
            if self.inside((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, (zs[k] + zs[k + 1]) / 2):
                solid[(i, j, k)] = True
        return xs, ys, zs, solid

    def triangles(self):
        xs, ys, zs, solid = self.cells()
        lines = (xs, ys, zs)
        out = []
        for (i, j, k) in solid:
            cell = (i, j, k)
            for axis in range(3):
                for sign in (-1, 1):
                    other = list(cell)
                    other[axis] += sign
                    if tuple(other) in solid:
                        continue
                    a1, a2 = [(axis + 1) % 3, (axis + 2) % 3]
                    plane = lines[axis][cell[axis] + (1 if sign > 0 else 0)]
                    lo1, hi1 = lines[a1][cell[a1]], lines[a1][cell[a1] + 1]
                    lo2, hi2 = lines[a2][cell[a2]], lines[a2][cell[a2] + 1]
                    corners = []
                    for u, v in ((lo1, lo2), (hi1, lo2), (hi1, hi2), (lo1, hi2)):
                        point = [0.0, 0.0, 0.0]
                        point[axis], point[a1], point[a2] = plane, u, v
                        corners.append(tuple(point))
                    # (a1, a2, axis) is a right-handed turn, so this order faces +axis; reverse it for -axis
                    if sign < 0:
                        corners.reverse()
                    out.append((corners[0], corners[1], corners[2]))
                    out.append((corners[0], corners[2], corners[3]))
        return out

    def bounds(self):
        xs, ys, zs, solid = self.cells()
        out = []
        for axis, line in enumerate((xs, ys, zs)):
            used = [cell[axis] for cell in solid]
            out.append((line[min(used)], line[max(used) + 1]))
        return out


def write_stl(path, triangles, name):
    with open(path, "wb") as handle:
        handle.write(name.encode("ascii")[:79].ljust(80, b" "))
        handle.write(struct.pack("<I", len(triangles)))
        for a, b, c in triangles:
            ux, uy, uz = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
            vx, vy, vz = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
            n = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
            length = (n[0] ** 2 + n[1] ** 2 + n[2] ** 2) ** 0.5 or 1.0
            handle.write(struct.pack("<12fH", n[0] / length, n[1] / length, n[2] / length, *a, *b, *c, 0))


# -- the sensor block -----------------------------------------------------------------------------------------------

def layout(p):
    """Every coordinate the block is built from. x runs across the board, y along the strand, z up (0 = the board's underside)."""
    pocket_x, pocket_y = p["board_w"] + 2 * p["fit"], p["board_h"] + 2 * p["fit"]
    top = p["board_t"] + p["lid_t"] + 0.1
    depth = p["socket_h"] + p["end"]
    lay = {"pocket_x": pocket_x, "pocket_y": pocket_y, "top": top, "bottom": -depth}
    lay["x0"], lay["x1"] = p["wall"], p["wall"] + pocket_x                      # the pocket
    lay["y0"] = p["tube_depth"] + p["end"]
    lay["y1"] = lay["y0"] + pocket_y
    lay["LX"] = lay["x1"] + p["wall"]
    lay["LY"] = lay["y1"] + p["end"] + p["tube_depth"]
    lay["chip_cx"] = lay["x0"] + p["fit"] + p["chip_x"]                          # the strand runs along y through here
    lay["chip_cy"] = (lay["y0"] + lay["y1"]) / 2
    lay["strand_top"] = -(p["chip_h"] + p["gap"])
    lay["strand_bottom"] = lay["strand_top"] - p["chan_h"]
    lay["axis_z"] = (lay["strand_top"] + lay["strand_bottom"]) / 2
    return lay


def block(p, coupon=False):
    L = layout(p)
    s = Solid()
    y0_total = 0.0
    LY = L["LY"]
    if coupon:  # just the part around the chip: a short test piece that checks the board's fit and where the chip sits
        y0_total = L["y0"] - p["end"]
        LY = L["y1"] + p["end"]
    s.add(0, y0_total, L["bottom"], L["LX"], LY, L["top"])
    # the pocket for the board, open at the top, and the light well under it down to the top of the strand
    s.cut(L["x0"], L["y0"], 0.0, L["x1"], L["y1"], L["top"] + 1)
    ledge = 1.2
    s.cut(L["x0"] + ledge, L["y0"] + ledge, L["strand_top"], L["x1"] - ledge, L["y1"] - ledge, 0.0)
    # the socket and plug at the right edge need more room below the board
    s.cut(L["x1"] - p["socket_len"], L["chip_cy"] - p["socket_w"] / 2, -p["socket_h"], L["x1"] + p["wall"] + 0.1,
          L["chip_cy"] + p["socket_w"] / 2, 0.0)
    # the sensor cable leaves through the right wall
    s.cut(L["x1"] - 1.0, L["chip_cy"] - p["cable_w"] / 2, -p["cable_h"], L["LX"] + 0.1, L["chip_cy"] + p["cable_w"] / 2, 0.0)
    # the strand's groove, open at the top under the board, and its tube sockets at both ends
    cx = L["chip_cx"]
    half = p["chan_w"] / 2
    if not coupon:
        s.cut(cx - half, -0.1, L["strand_bottom"], cx + half, LY + 0.1, L["strand_top"])
        tube = p["tube_od"] / 2 + p["tube_fit"]
        for y0, y1 in ((-0.1, p["tube_depth"]), (LY - p["tube_depth"], LY + 0.1)):
            s.cut(cx - tube, y0, L["axis_z"] - tube, cx + tube, y1, L["axis_z"] + tube)
    else:
        s.cut(cx - half, y0_total - 0.1, L["strand_bottom"], cx + half, LY + 0.1, L["strand_top"])
    # the light well and the strand groove are open under the board, so the board's own LEDs light the strand.
    # Re-add the chimney around the chip: it shuts the chip off from the LEDs and, with the mask under it, limits what it sees.
    chim_x, chim_y, wall = 4.0, 4.0, 1.2
    s.add(cx - chim_x / 2 - wall, L["chip_cy"] - chim_y / 2 - wall, L["strand_top"],
          cx + chim_x / 2 + wall, L["chip_cy"] + chim_y / 2 + wall, 0.0)
    # the opening around the chip, down to a thin mask plate just under it; the slit through the plate limits what it sees
    s.cut(cx - chim_x / 2, L["chip_cy"] - chim_y / 2, L["strand_top"] + p["mask_t"], cx + chim_x / 2, L["chip_cy"] + chim_y / 2, 0.0)
    s.cut(cx - p["slit_x"] / 2, L["chip_cy"] - p["slit_y"] / 2, L["strand_top"],
          cx + p["slit_x"] / 2, L["chip_cy"] + p["slit_y"] / 2, 0.0)
    # keep the groove open through the chimney's footing
    s.cut(cx - half, L["chip_cy"] - chim_y / 2 - wall - 0.1, L["strand_bottom"], cx + half, L["chip_cy"] + chim_y / 2 + wall + 0.1,
          L["strand_top"])
    return s


def lid(p):
    L = layout(p)
    s = Solid()
    inset = 0.15
    w, h = L["pocket_x"] - 2 * inset, L["pocket_y"] - 2 * inset
    s.add(0, 0, 0, w, h, p["lid_t"])
    # four ribs that press the board's corners down onto the ledge
    for x, y in ((1.5, 1.5), (w - 3.5, 1.5), (1.5, h - 3.5), (w - 3.5, h - 3.5)):
        s.add(x, y, -0.3, x + 2.0, y + 2.0, 0.0)
    return s


def cradle(p):
    """A base for the Pico W: its two pin rows drop into grooves, the board lies on the platform between them, and a cable
    tie through two slots holds it down. Both ends are open: the micro-USB plug leaves at one end, and the antenna end
    hangs free, because Raspberry Pi asks for nothing near the antenna's 14 x 9 mm."""
    pico_w, pico_l = 21.0, 51.0
    keep_out = 14.0           # Raspberry Pi: nothing near the antenna end
    rows = 17.78              # the distance between the two pin rows (the 0.1 inch grid)
    seat = pico_l - keep_out  # the part of the board the cradle carries
    height = 9.0
    s = Solid()
    base_w = pico_w + 12.0
    cx = base_w / 2
    s.add(0, 0, 0, base_w, seat, height)
    for sign in (-1, 1):      # the header strips and the pins, which point down, go into these
        s.cut(cx + sign * rows / 2 - 1.6, -0.1, 2.0, cx + sign * rows / 2 + 1.6, seat + 0.1, height + 0.1)
    # the board lies on the platform; low walls keep it from sliding sideways
    s.cut(cx - pico_w / 2 - 0.3, -0.1, height - 1.6, cx + pico_w / 2 + 0.3, seat + 0.1, height + 0.1)
    # a cable tie goes up one slot, over the board and down the other
    for sign in (-1, 1):
        edge = cx + sign * (pico_w / 2 + 3.0)
        s.cut(edge - 1.2, seat / 2 - 1.5, -0.1, edge + 1.2, seat / 2 + 1.5, height + 0.1)
    return s


def preview_svg(path, p):
    """A picture of the parts side by side, for the docs: isometric, flat shaded, drawn back to front."""
    import math
    shown = [("sensor block", PARTS["sensor-block"](p), 0.0), ("lid", PARTS["sensor-lid"](p), 56.0),
             ("Pico cradle", PARTS["pico-cradle"](p), 100.0)]
    cos, sin = math.cos(math.radians(30)), math.sin(math.radians(30))
    light = (0.35, -0.45, 0.82)
    polygons, labels = [], []
    for name, solid, shift in shown:
        for a, b, c in solid.triangles():
            ux, uy, uz = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
            vx, vy, vz = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
            n = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
            length = math.sqrt(sum(t * t for t in n)) or 1.0
            n = tuple(t / length for t in n)
            if n[0] * -0.5 + n[1] * -0.5 + n[2] * 0.7 <= 0:  # facing away from the viewer
                continue
            points = [((x + shift - y) * cos, -((x + shift + y) * sin) + z * -1.0) for x, y, z in (a, b, c)]
            depth = sum(x + y + shift - 0.3 * z for x, y, z in (a, b, c))
            shade = max(0.0, min(1.0, 0.4 + 0.6 * (n[0] * light[0] + n[1] * light[1] + n[2] * light[2])))
            polygons.append((depth, points, int(40 + 150 * shade)))
        labels.append(name)
    polygons.sort(key=lambda item: item[0])
    xs = [pt[0] for _, pts, _ in polygons for pt in pts]
    ys = [pt[1] for _, pts, _ in polygons for pt in pts]
    scale = 10.0
    left, top = min(xs) - 3, min(ys) - 3
    width, height = (max(xs) - min(xs) + 6) * scale, (max(ys) - min(ys) + 6) * scale
    rows = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.0f %.0f" role="img" aria-label="The sensor block, its lid and the '
            'Pico cradle">' % (width, height), '<rect width="100%" height="100%" fill="#f4f5f7"/>']
    for _, pts, grey in polygons:
        coords = " ".join("%.1f,%.1f" % ((x - left) * scale, (y - top) * scale) for x, y in pts)
        rows.append('<polygon points="%s" fill="rgb(%d,%d,%d)" stroke="rgb(%d,%d,%d)" stroke-width="0.6"/>' % (
            (coords,) + (grey,) * 3 + (grey,) * 3))
    rows.append("</svg>")
    with open(path, "w") as handle:
        handle.write("\n".join(rows))


PARTS = {
    "sensor-block": lambda p: block(p),
    "sensor-lid": lid,
    "pico-cradle": cradle,
    "test-coupon": lambda p: block(p, coupon=True),
}


def build(p, out):
    os.makedirs(out, exist_ok=True)
    report = {}
    for name, make in PARTS.items():
        solid = make(p)
        tris = solid.triangles()
        write_stl(os.path.join(out, name + ".stl"), tris, "Deja Vu1 colour checker " + name)
        report[name] = (len(tris), solid.bounds())
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="colour-holder", help="folder for the STL files")
    parser.add_argument("--part", choices=sorted(PARTS), help="make only this part")
    parser.add_argument("--preview", help="also draw the parts to this SVG file")
    for key, value in PARAMS.items():
        parser.add_argument("--" + key.replace("_", "-"), type=float, default=value, help="default %s" % value)
    args = parser.parse_args(argv)
    p = {key: getattr(args, key) for key in PARAMS}
    if args.preview:
        preview_svg(args.preview, p)
    if args.part:
        os.makedirs(args.out, exist_ok=True)
        solid = PARTS[args.part](p)
        write_stl(os.path.join(args.out, args.part + ".stl"), solid.triangles(), "Deja Vu1 colour checker " + args.part)
        print(args.part, solid.bounds())
        return 0
    for name, (count, bounds) in build(p, args.out).items():
        size = " x ".join("%.1f" % (hi - lo) for lo, hi in bounds)
        print("%-13s %6d triangles, %s mm" % (name, count, size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
