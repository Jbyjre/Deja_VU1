"""
Solid modelling on a grid: join parts, cut holes, keep where parts overlap.

Standard library only. Every solid is a closed triangle mesh (a simple shape the assistant made, or a model
from the library). Each one is sampled on a regular grid of points: rays along X, Y and Z find exactly where
its surface crosses the grid lines, which says which points are inside. The solids are combined point by
point in the order given (add joins, cut removes, keep leaves only the overlap), and a new surface is drawn
through the crossings (surface nets: one vertex per grid cell the surface passes through, joined across
every crossed grid edge). Flat faces stay flat; edges and corners come out rounded by about one grid cell,
so the cell size is the accuracy, and it is reported with the result. A cell of 0.4 mm matches a common
nozzle's line width, which is about the finest detail a printer lays down in X and Y anyway.
"""

import math

DEFAULT_CELL = 0.4          # mm
FINEST_CELL = 0.1
MAX_POINTS = 4_000_000      # grid points; a larger model gets a coarser grid, and the result says so
_PAD = 2                    # empty cells around everything, so the surface never touches the grid's edge
_FAR = 1.5                  # values are distances in cells, clipped to this
# The grid sits a little off round numbers so rays don't run exactly along the edges of a mesh made in
# whole millimetres. Different on each axis so a diagonal x = y doesn't line up either.
_OFFSET = (0.123457, 0.234571, 0.345713)
OPS = ("add", "cut", "keep")


class CarveError(ValueError):
    pass


def bounds(triangles):
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    for t in triangles:
        for p in t:
            for a in range(3):
                v = p[a]
                if v < lo[a]:
                    lo[a] = v
                if v > hi[a]:
                    hi[a] = v
    return lo, hi


def _edge(a, b, p):
    """Twice the signed area of (a, b, p), worked out the same way whichever end comes first, so a point
    on an edge two triangles share gets exactly opposite values from the two of them."""
    if (a[0], a[1]) > (b[0], b[1]):
        return -((a[0] - b[0]) * (p[1] - b[1]) - (a[1] - b[1]) * (p[0] - b[0]))
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def _owns(a, b):
    """Which of the two triangles on either side of an edge counts a point that lies exactly on it."""
    return b[1] < a[1] or (b[1] == a[1] and b[0] > a[0])


def _crossings(grid_tris, axis, lo, hi):
    """
    For each grid ray along `axis` inside the index box lo..hi, where it passes through the surface.
    grid_tris are in grid units. Returns {(u, v): [w, ...]} with (u, v) the ray's indices on the other two
    axes, in the order (axis + 1, axis + 2).
    """
    ua, va = (axis + 1) % 3, (axis + 2) % 3
    u_lo, u_hi, v_lo, v_hi = lo[ua], hi[ua], lo[va], hi[va]
    rays = {}
    ceil, floor = math.ceil, math.floor
    for t in grid_tris:
        a, b, c = (t[0][ua], t[0][va]), (t[1][ua], t[1][va]), (t[2][ua], t[2][va])
        wa, wb, wc = t[0][axis], t[1][axis], t[2][axis]
        area = _edge(a, b, c)
        if area == 0:
            continue                                   # edge-on to the rays: they run along it, never through
        if area < 0:
            b, c, wb, wc, area = c, b, wc, wb, -area
        iu0, iu1 = max(u_lo, ceil(min(a[0], b[0], c[0]))), min(u_hi, floor(max(a[0], b[0], c[0])))
        iv0, iv1 = max(v_lo, ceil(min(a[1], b[1], c[1]))), min(v_hi, floor(max(a[1], b[1], c[1])))
        if iu0 > iu1 or iv0 > iv1:
            continue
        own_ab, own_bc, own_ca = _owns(a, b), _owns(b, c), _owns(c, a)
        for iu in range(iu0, iu1 + 1):
            for iv in range(iv0, iv1 + 1):
                p = (iu, iv)
                e_bc = _edge(b, c, p)
                if e_bc < 0 or (e_bc == 0 and not own_bc):
                    continue
                e_ca = _edge(c, a, p)
                if e_ca < 0 or (e_ca == 0 and not own_ca):
                    continue
                e_ab = _edge(a, b, p)
                if e_ab < 0 or (e_ab == 0 and not own_ab):
                    continue
                w = (wa * e_bc + wb * e_ca + wc * e_ab) / area
                rays.setdefault(p, []).append(w)
    return rays


class _Grid:
    def __init__(self, lo_mm, hi_mm, cell, max_points):
        size = [hi_mm[a] - lo_mm[a] for a in range(3)]
        self.cell = cell
        while True:
            n = [int(math.ceil(size[a] / self.cell)) + 2 * _PAD for a in range(3)]
            points = (n[0] + 1) * (n[1] + 1) * (n[2] + 1)
            if points <= max_points:
                break
            self.cell *= max(1.05, (points / max_points) ** (1 / 3))
        self.n = n
        self.origin = [lo_mm[a] - (_PAD - _OFFSET[a]) * self.cell for a in range(3)]
        self.values = [_FAR] * points

    def to_grid(self, triangles):
        o, h = self.origin, self.cell
        return [tuple(((p[0] - o[0]) / h, (p[1] - o[1]) / h, (p[2] - o[2]) / h) for p in t) for t in triangles]

    def index(self, i, j, k):
        return (i * (self.n[1] + 1) + j) * (self.n[2] + 1) + k


def _field(grid, grid_tris):
    """
    The solid sampled on the grid inside its own box: negative inside, positive outside, near the surface
    the distance in cells to the nearest crossing along a grid line. Returns (box lo, box hi, rows, leaks)
    with rows[(i, j)] the values along Z for k = lo[2]..hi[2].
    """
    lo_g, hi_g = bounds(grid_tris)
    lo = [max(0, int(math.floor(lo_g[a])) - 1) for a in range(3)]
    hi = [min(grid.n[a], int(math.ceil(hi_g[a])) + 1) for a in range(3)]
    k0, nk = lo[2], hi[2] - lo[2] + 1
    rows, leaks = {}, 0
    # Inside or outside, from the rays along Z (pairs of crossings bound the inside).
    for (i, j), ws in _crossings(grid_tris, 2, lo, hi).items():
        ws.sort()
        if len(ws) % 2:
            leaks += 1
            ws.pop()
        row = [_FAR] * nk
        for s in range(0, len(ws), 2):
            start, end = max(k0, int(math.floor(ws[s])) + 1), min(hi[2], int(math.ceil(ws[s + 1])) - 1)
            if end >= start:
                row[start - k0:end - k0 + 1] = [-_FAR] * (end - start + 1)
        for w in ws:
            for k in range(int(math.floor(w)) - 1, int(math.ceil(w)) + 2):
                if k0 <= k <= hi[2]:
                    v, d = row[k - k0], abs(k - w)
                    if d < abs(v):
                        row[k - k0] = math.copysign(d, v)
        rows[(i, j)] = row
    # Rays along X and Y place the surface between grid points on those lines too.
    for axis in (0, 1):
        for (u, v), ws in _crossings(grid_tris, axis, lo, hi).items():
            for w in ws:
                for m in range(int(math.floor(w)) - 1, int(math.ceil(w)) + 2):
                    if not lo[axis] <= m <= hi[axis]:
                        continue
                    if axis == 0:                       # u = j, v = k
                        i, j, k = m, u, v
                    else:                               # u = k, v = i
                        i, j, k = v, m, u
                    row = rows.get((i, j))
                    if row is None:                      # no Z crossings here: the whole row is outside
                        row = rows[(i, j)] = [_FAR] * nk
                    d, old = abs(m - w), row[k - k0]
                    if d < abs(old):
                        row[k - k0] = math.copysign(d, old)
    return lo, hi, rows, leaks


def _combine(grid, op, solid):
    lo, hi, rows, _ = solid
    n, values = grid.n, grid.values
    k0, k1 = lo[2], hi[2]
    if op == "keep":
        far_row = [_FAR] * (n[2] + 1)
        for i in range(n[0] + 1):
            for j in range(n[1] + 1):
                start = grid.index(i, j, 0)
                row = rows.get((i, j))
                if row is None:
                    values[start:start + n[2] + 1] = far_row
                    continue
                values[start:start + k0] = far_row[:k0]
                values[start + k1 + 1:start + n[2] + 1] = far_row[k1 + 1:]
                s = start + k0
                values[s:s + len(row)] = [a if a > b else b for a, b in zip(values[s:s + len(row)], row)]
        return
    for (i, j), row in rows.items():
        s = grid.index(i, j, k0)
        here = values[s:s + len(row)]
        if op == "add":
            values[s:s + len(row)] = [a if a < b else b for a, b in zip(here, row)]
        else:                                           # cut: outside the cutter stays, inside it goes
            values[s:s + len(row)] = [a if a > -b else -b for a, b in zip(here, row)]


_CORNERS = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)]
_CELL_EDGES = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]


def _surface(grid):
    """Surface nets over the combined values. Returns triangles in millimetres, faces outward."""
    n, values = grid.n, grid.values
    nz1 = n[2] + 1
    o, h = grid.origin, grid.cell
    verts = {}

    def vertex(i, j, k):
        key = (i, j, k)
        found = verts.get(key)
        if found is not None:
            return found
        vals = [values[grid.index(i + c[0], j + c[1], k + c[2])] for c in _CORNERS]
        sx = sy = sz = 0.0
        count = 0
        for a, b in _CELL_EDGES:
            va, vb = vals[a], vals[b]
            if (va < 0) != (vb < 0):
                t = va / (va - vb)
                ca, cb = _CORNERS[a], _CORNERS[b]
                sx += ca[0] + (cb[0] - ca[0]) * t
                sy += ca[1] + (cb[1] - ca[1]) * t
                sz += ca[2] + (cb[2] - ca[2]) * t
                count += 1
        p = (o[0] + (i + sx / count) * h, o[1] + (j + sy / count) * h, o[2] + (k + sz / count) * h)
        verts[key] = p
        return p

    tris = []

    def quad(cells, outward):
        q = [vertex(*c) for c in cells]
        if not outward:
            q.reverse()
        tris.append((q[0], q[1], q[2]))
        tris.append((q[0], q[2], q[3]))

    # Which rows along Z hold any inside point at all; the rest are skipped.
    has_inside = {}
    for i in range(n[0] + 1):
        for j in range(n[1] + 1):
            s = grid.index(i, j, 0)
            row = values[s:s + nz1]
            if min(row) < 0:
                has_inside[(i, j)] = row
    for (i, j), row in has_inside.items():
        # Crossed edges along Z.
        for k in range(n[2]):
            if (row[k] < 0) != (row[k + 1] < 0):
                quad([(i - 1, j - 1, k), (i, j - 1, k), (i, j, k), (i - 1, j, k)], row[k] < 0)
        # Along X and Y, against the next row (and the previous one when that row is all outside).
        for di, dj, axis in ((1, 0, 0), (0, 1, 1)):
            for nb, forward in (((i + di, j + dj), True), ((i - di, j - dj), False)):
                other = has_inside.get(nb)
                if other is not None and not forward:
                    continue                            # counted once, from the earlier row
                if other is None:
                    if not (0 <= nb[0] <= n[0] and 0 <= nb[1] <= n[1]):
                        continue
                    other = [_FAR] * nz1
                first, second = (row, other) if forward else (other, row)
                bi, bj = (i, j) if forward else nb
                for k in range(n[2] + 1):
                    if (first[k] < 0) == (second[k] < 0):
                        continue
                    if axis == 0:
                        cells = [(bi, bj - 1, k - 1), (bi, bj, k - 1), (bi, bj, k), (bi, bj - 1, k)]
                    else:
                        cells = [(bi - 1, bj, k - 1), (bi - 1, bj, k), (bi, bj, k), (bi, bj, k - 1)]
                    quad(cells, first[k] < 0)
    return tris


def carve(solids, cell=None, max_points=MAX_POINTS):
    """
    solids: [(op, triangles)] in order; the first must be "add". Returns (triangles, report) where the
    report gives the cell size used and anything worth telling the owner. cell None picks one by size.
    """
    if not solids:
        raise CarveError("Nothing to make")
    if solids[0][0] != "add":
        raise CarveError("Start with a part to add: there is nothing to cut from yet")
    for op, tris in solids:
        if op not in OPS:
            raise CarveError("Each part is added, cut or kept (add, cut, keep)")
        if not tris:
            raise CarveError("One of the parts holds no triangles")
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    for op, tris in solids:
        if op != "add":
            continue
        a, b = bounds(tris)
        lo = [min(lo[x], a[x]) for x in range(3)]
        hi = [max(hi[x], b[x]) for x in range(3)]
    if cell in (None, ""):
        # 0.4 mm, or 250 cells along the longest side for a big part, which keeps the file a sensible size.
        cell = max(DEFAULT_CELL, max(hi[x] - lo[x] for x in range(3)) / 250)
    try:
        cell = float(cell)
    except (TypeError, ValueError):
        cell = DEFAULT_CELL
    cell = min(5.0, max(FINEST_CELL, cell))
    grid = _Grid(lo, hi, cell, max_points)
    leaks = 0
    for op, tris in solids:
        solid = _field(grid, grid.to_grid(tris))
        leaks += solid[3]
        _combine(grid, op, solid)
    triangles = _surface(grid)
    if not triangles:
        raise CarveError("Nothing is left: the cuts removed the whole part")
    report = {"cell_mm": round(grid.cell, 3)}
    if grid.cell > cell * 1.01:
        report["note"] = (f"The model is large, so it was made on a {grid.cell:.2f} mm grid instead of {cell:g} mm: "
                          "edges are softer and details smaller than about twice that may not show.")
    if leaks:
        report["warning"] = ("One of the models isn't fully closed (its surface has gaps), so parts of it may be "
                             "missing or filled in. Check the result in the 3D view.")
    return triangles, report


def volume(triangles):
    """Enclosed volume in cubic millimetres (positive for a closed, outward-facing surface)."""
    total = 0.0
    for a, b, c in triangles:
        total += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
                  + a[2] * (b[0] * c[1] - b[1] * c[0]))
    return total / 6


def open_edges(triangles):
    """How many edges are not matched by a neighbour running the other way (0 for a closed surface)."""
    count = {}
    for t in triangles:
        for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            count[e] = count.get(e, 0) + 1
    return sum(1 for (a, b), c in count.items() if count.get((b, a), 0) != c)
