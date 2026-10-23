"""
sample_slicer.py
================

A small, honest slicer used only to build the sample G-code files. It cuts a
closed triangle mesh into horizontal layers, joins the cut edges into
outlines, prints two walls per outline and fills the inside with straight
lines (solid where the part has a floor or a roof nearby, sparse elsewhere).

It is deliberately simple and says so in every file it writes: no seams,
no overhang handling, no supports, no bridges and no pressure advance.
Real prints come from the user's own slicing engine. These files exist so
the viewer, the pre-flight check, Confirm Print and the simulated printers
have a recognisable boat, gear or vase to show instead of a cube.

Standard library only, like the rest of the backend.
"""

import math
import struct

LAYER = 0.2
FIRST_LAYER = 0.2
WIDTH = 0.42
FILAMENT_AREA = math.pi * (1.75 / 2) ** 2
SPARSE_EVERY = 6          # one sparse line per this many solid-spaced lines (about 15 %)
SOLID_SHELLS = 3          # floors and roofs this many layers deep are filled solid

# Feeds in mm/min. Ordinary Snapmaker Orca-style values for a 0.4 mm nozzle
# in PLA; the file is a sample, so these are not a tuned profile.
FEED = {"Outer wall": 9000, "Inner wall": 15000, "Sparse infill": 16200,
        "Solid infill": 12000, "first": 3000, "travel": 30000}
ACCEL = 5000.0            # mm/s^2 used only for the time estimate


def read_binary_stl(data):
    """Triangles [(p1, p2, p3), ...] from a binary STL."""
    count = struct.unpack_from("<I", data, 80)[0]
    tris = []
    off = 84
    for _ in range(count):
        v = struct.unpack_from("<9f", data, off + 12)
        tris.append(((v[0], v[1], v[2]), (v[3], v[4], v[5]), (v[6], v[7], v[8])))
        off += 50
    return tris


def place(tris, x, y, rotate_deg=0.0):
    """Move a mesh so its footprint is centred on (x, y) and it sits on z = 0."""
    c, s = math.cos(math.radians(rotate_deg)), math.sin(math.radians(rotate_deg))
    rot = [tuple((p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]) for p in t) for t in tris]
    xs = [p[0] for t in rot for p in t]
    ys = [p[1] for t in rot for p in t]
    zs = [p[2] for t in rot for p in t]
    dx, dy, dz = x - (min(xs) + max(xs)) / 2, y - (min(ys) + max(ys)) / 2, -min(zs)
    return [tuple((p[0] + dx, p[1] + dy, p[2] + dz) for p in t) for t in rot]


def layer_heights(top):
    zs, z = [], FIRST_LAYER
    while z <= top + 1e-6:
        zs.append(round(z, 3))
        z += LAYER
    return zs


def _key(p):
    return (round(p[0], 4), round(p[1], 4))


def contours(tris, zs):
    """
    Outlines for every layer height, as closed point loops. Each triangle is
    visited only for the layers it spans (sorted sweep), and a cut point is
    always computed from its edge in the same direction, so neighbouring
    triangles produce exactly the same point and the loops join up.
    """
    spans = sorted(((min(p[2] for p in t), max(p[2] for p in t), t) for t in tris), key=lambda s: s[0])
    out, active, nxt = [], [], 0
    for z in zs:
        cut = z - LAYER / 2
        while nxt < len(spans) and spans[nxt][0] < cut:
            active.append(spans[nxt])
            nxt += 1
        active = [s for s in active if s[1] > cut]
        links = {}
        for _, _, t in active:
            pts = []
            for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                if (a[2] < cut) != (b[2] < cut):
                    lo, hi = (a, b) if a < b else (b, a)
                    f = (cut - lo[2]) / (hi[2] - lo[2])
                    pts.append(_key((lo[0] + (hi[0] - lo[0]) * f, lo[1] + (hi[1] - lo[1]) * f)))
            if len(pts) == 2 and pts[0] != pts[1]:
                links.setdefault(pts[0], []).append(pts[1])
                links.setdefault(pts[1], []).append(pts[0])
        out.append(_join(links))
    return out


def _join(links):
    loops, seen = [], set()
    for start in links:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nexts = [n for n in links[cur] if n != prev and n not in seen]
            if not nexts:
                break
            prev, cur = cur, nexts[0]
            seen.add(cur)
            loop.append(cur)
        if len(loop) >= 3 and math.dist(loop[0], loop[-1]) < 1.0:
            loop = _thin(loop)
            if len(loop) >= 3 and abs(_area(loop)) > 0.5:
                loops.append(loop)
    return loops


def _thin(loop, step=0.25, tolerance=0.012):
    """Drop points closer than step to the last kept one, then points that lie on a straight run."""
    kept = [loop[0]]
    for p in loop[1:]:
        if math.dist(p, kept[-1]) >= step:
            kept.append(p)
    out = []
    for i, p in enumerate(kept):
        a, b = (out[-1] if out else kept[i - 1]), kept[(i + 1) % len(kept)]
        ex, ey = b[0] - a[0], b[1] - a[1]
        length = math.hypot(ex, ey)
        if length < 1e-9 or abs((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / length > tolerance:
            out.append(p)
    return out


def _area(loop):
    return sum(loop[i - 1][0] * p[1] - p[0] * loop[i - 1][1] for i, p in enumerate(loop)) / 2


def _inside(pt, loops):
    x, y = pt
    hit = False
    for loop in loops:
        for i, (x2, y2) in enumerate(loop):
            x1, y1 = loop[i - 1]
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                hit = not hit
    return hit


def inset(loop, loops, d):
    """Move every point of a loop inward by d (miter, clamped). Simple and good enough for samples."""
    n = len(loop)
    a, b = loop[0], loop[1]
    ex, ey = b[0] - a[0], b[1] - a[1]
    length = math.hypot(ex, ey) or 1.0
    probe = ((a[0] + b[0]) / 2 - ey / length * 0.05, (a[1] + b[1]) / 2 + ex / length * 0.05)
    side = 1.0 if _inside(probe, loops) else -1.0
    out = []
    for i in range(n):
        p0, p1, p2 = loop[i - 1], loop[i], loop[(i + 1) % n]
        n1 = _left(p0, p1)
        n2 = _left(p1, p2)
        nx, ny = n1[0] + n2[0], n1[1] + n2[1]
        m = math.hypot(nx, ny)
        if m < 1e-6:
            nx, ny, m = n1[0], n1[1], 1.0
        nx, ny = nx / m, ny / m
        cos = max(0.5, nx * n1[0] + ny * n1[1])
        out.append((p1[0] + side * nx * d / cos, p1[1] + side * ny * d / cos))
    return out if abs(_area(out)) > 0.3 and (_area(out) > 0) == (_area(loop) > 0) else None


def _left(a, b):
    ex, ey = b[0] - a[0], b[1] - a[1]
    m = math.hypot(ex, ey) or 1.0
    return -ey / m, ex / m


def _crossings(loops, angle, spacing):
    """{scanline index: sorted crossing positions} in a frame rotated by angle."""
    c, s = math.cos(angle), math.sin(angle)
    lines = {}
    for loop in loops:
        rot = [(x * c + y * s, -x * s + y * c) for x, y in loop]
        for i, (x2, y2) in enumerate(rot):
            x1, y1 = rot[i - 1]
            if y1 == y2:
                continue
            lo, hi = (y1, y2) if y1 < y2 else (y2, y1)
            k = math.ceil(lo / spacing)
            while k * spacing < hi:
                yy = k * spacing
                lines.setdefault(k, []).append(x1 + (yy - y1) * (x2 - x1) / (y2 - y1))
                k += 1
    for v in lines.values():
        v.sort()
    return lines


def _pairs(xs):
    return [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]


def _intersect(a, b):
    out, i, j = [], 0, 0
    while i < len(a) and j < len(b):
        lo, hi = max(a[i][0], b[j][0]), min(a[i][1], b[j][1])
        if lo < hi:
            out.append((lo, hi))
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return out


def _subtract(a, b):
    out = []
    for lo, hi in a:
        cur = lo
        for blo, bhi in b:
            if bhi <= cur or blo >= hi:
                continue
            if blo > cur:
                out.append((cur, blo))
            cur = max(cur, bhi)
        if cur < hi:
            out.append((cur, hi))
    return out


def infill_paths(layers, index, angle):
    """
    Straight infill lines for one layer. Lines are solid-spaced where layers a
    few above or below do not cover the same spot (a floor or a roof), and
    sparse elsewhere. Works on 1-D intervals along each scanline, so it needs
    no polygon library.
    """
    spacing = WIDTH
    here = _crossings(layers[index], angle, spacing)
    around = []
    for k in range(1, SOLID_SHELLS + 1):
        for j in (index - k, index + k):
            around.append(_crossings(layers[j], angle, spacing) if 0 <= j < len(layers) else {})
    c, s = math.cos(angle), math.sin(angle)
    solid, sparse = [], []
    trim = WIDTH * 1.6
    for k in sorted(here):
        mine = _pairs(here[k])
        covered = mine
        for other in around:
            covered = _intersect(covered, _pairs(other.get(k, [])))
            if not covered:
                break
        wanted = mine if index < SOLID_SHELLS else _subtract(mine, covered)
        keep = [(lo + trim, hi - trim) for lo, hi in wanted if hi - lo > 2 * trim + 0.3]
        if k % SPARSE_EVERY == 0:
            rest = [(lo + trim, hi - trim) for lo, hi in _subtract(mine, wanted) if hi - lo > 2 * trim + 0.3]
        else:
            rest = []
        y = k * spacing
        for target, spans in ((solid, keep), (sparse, rest)):
            for lo, hi in spans:
                target.append(((lo * c - y * s, lo * s + y * c), (hi * c - y * s, hi * s + y * c)))
    for group in (solid, sparse):
        for n, seg in enumerate(group):
            if n % 2:
                group[n] = (seg[1], seg[0])
    return solid, sparse


class Writer:
    """Collects G-code and keeps an acceleration-aware time estimate and per-tool filament."""

    def __init__(self):
        self.lines = []
        self.x = self.y = 135.0
        self.z = 0.0
        self.seconds = 0.0
        self.e_total = {}
        self.tool = 0
        self.layers = 0
        self.feature = None

    def cmd(self, text):
        self.lines.append(text)

    def _time(self, dist, feed):
        v = feed / 60.0
        ramp = v * v / ACCEL
        self.seconds += (dist / v + v / ACCEL) if dist > ramp else 2 * math.sqrt(dist / ACCEL)

    def set_feature(self, name):
        if name != self.feature:
            self.cmd(f";TYPE:{name}")
            self.feature = name

    def travel(self, x, y, z=None):
        dz = 0.0 if z is None else z - self.z
        dist = math.sqrt((x - self.x) ** 2 + (y - self.y) ** 2 + dz * dz)
        if dist < 0.01:
            return
        self._time(dist, FEED["travel"])
        zpart = "" if z is None else f" Z{z:.2f}"
        self.cmd(f"G0 X{x:.2f} Y{y:.2f}{zpart} F{FEED['travel']}")
        self.x, self.y = x, y
        if z is not None:
            self.z = z

    def extrude(self, x, y, feed, height):
        dist = math.hypot(x - self.x, y - self.y)
        if dist < 0.01:
            return
        e = dist * WIDTH * height / FILAMENT_AREA
        self._time(dist, feed)
        self.e_total[self.tool] = self.e_total.get(self.tool, 0.0) + e
        self.cmd(f"G1 X{x:.2f} Y{y:.2f} E{e:.5f} F{feed}")
        self.x, self.y = x, y

    def tool_change(self, tool):
        if tool != self.tool:
            self.cmd(f"T{tool}")
            self.tool = tool
            self.seconds += 9.0     # a dock-and-pick on a tool changer takes several seconds

    def loop(self, pts, feature, feed, height):
        self.set_feature(feature)
        start = min(range(len(pts)), key=lambda i: (pts[i][1], pts[i][0]))
        order = pts[start:] + pts[:start] + [pts[start]]
        self.travel(*order[0])
        for p in order[1:]:
            self.extrude(p[0], p[1], feed, height)

    def lines_of(self, segs, feature, feed, height):
        if not segs:
            return
        self.set_feature(feature)
        for a, b in segs:
            self.travel(*a)
            self.extrude(b[0], b[1], feed, height)


def print_layer(w, layers, index, z, first, region_tool=None):
    """Walls and infill of one object's layer, written at height z."""
    loops = layers[index]
    if not loops:
        return
    height = FIRST_LAYER if index == 0 else LAYER
    slow = FEED["first"] if first else None
    if region_tool is not None:
        w.tool_change(region_tool)
    for loop in loops:
        inner = inset(loop, loops, WIDTH)
        if inner:
            w.loop(inner, "Inner wall", slow or FEED["Inner wall"], height)
        outer = inset(loop, loops, WIDTH / 2) or loop
        w.loop(outer, "Outer wall", slow or FEED["Outer wall"], height)
    angle = math.radians(45 if index % 2 == 0 else -45)
    shrunk = [p for p in (inset(l, loops, WIDTH * 1.5) for l in loops) if p]
    use = layers[:index] + [shrunk or loops] + layers[index + 1:]
    solid, sparse = infill_paths(use, index, angle)
    w.lines_of(solid, "Solid infill", slow or FEED["Solid infill"], height)
    w.lines_of(sparse, "Sparse infill", slow or FEED["Sparse infill"], height)
