"""
Free-form solids for the assistant, standard library only: an outline pushed up into a solid (with holes and
rounded corners), a profile spun around the Z axis, and a spur gear. Sizes in millimetres. Every solid stands
on Z = 0, is closed, and has its faces pointing outward.
"""

import math

MAX_POINTS = 2000
_EPS = 1e-9


class ShapeError(ValueError):
    pass


def _pts(raw, what, minimum=3):
    if not isinstance(raw, list) or len(raw) < minimum:
        raise ShapeError(f"The {what} needs at least {minimum} points, each [x, y] in mm")
    if len(raw) > MAX_POINTS:
        raise ShapeError(f"The {what} has more than {MAX_POINTS} points")
    out = []
    for p in raw:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            raise ShapeError(f"Each point of the {what} is [x, y] in mm")
        try:
            x, y = float(p[0]), float(p[1])
        except (TypeError, ValueError):
            raise ShapeError(f"A point of the {what} isn't a number")
        if not (math.isfinite(x) and math.isfinite(y)) or abs(x) > 300 or abs(y) > 300:
            raise ShapeError(f"A point of the {what} is outside the printer's reach")
        out.append((x, y))
    return out


def area2(pts):
    """Twice the signed area: positive when the points run anticlockwise."""
    return sum(pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1] for i in range(len(pts)))


def _cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _clean(pts):
    """Drop repeated points, a closing copy of the first, and points on a straight line between neighbours."""
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) > 1e-6 or abs(p[1] - out[-1][1]) > 1e-6:
            out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) <= 1e-6 and abs(out[0][1] - out[-1][1]) <= 1e-6:
        out.pop()
    changed = True
    while changed and len(out) > 3:
        changed = False
        for i in range(len(out)):
            a, b, c = out[i - 1], out[i], out[(i + 1) % len(out)]
            if abs(_cross(a, b, c)) <= 1e-9 * max(1.0, abs(b[0]) + abs(b[1])) ** 2:
                out.pop(i)
                changed = True
                break
    return out


def _segments_cross(a, b, c, d):
    """Whether segments ab and cd touch or cross, apart from sharing an end."""
    if a in (c, d) or b in (c, d):
        return False
    d1, d2, d3, d4 = _cross(c, d, a), _cross(c, d, b), _cross(a, b, c), _cross(a, b, d)
    if ((d1 > _EPS and d2 < -_EPS) or (d1 < -_EPS and d2 > _EPS)) and \
            ((d3 > _EPS and d4 < -_EPS) or (d3 < -_EPS and d4 > _EPS)):
        return True

    def on(p, q, r):
        return abs(_cross(p, q, r)) <= _EPS and min(p[0], q[0]) - _EPS <= r[0] <= max(p[0], q[0]) + _EPS \
            and min(p[1], q[1]) - _EPS <= r[1] <= max(p[1], q[1]) + _EPS

    return on(c, d, a) or on(c, d, b) or on(a, b, c) or on(a, b, d)


def _edges(loop):
    return [(loop[i], loop[(i + 1) % len(loop)]) for i in range(len(loop))]


def check_simple(loops):
    """No outline may cross itself or another one."""
    edges = [e for loop in loops for e in _edges(loop)]
    for i in range(len(edges)):
        for j in range(i + 1, len(edges)):
            if _segments_cross(edges[i][0], edges[i][1], edges[j][0], edges[j][1]):
                raise ShapeError("The outline crosses itself, so it doesn't enclose one area. Check the order of the points")


def round_corners(pts, radius, steps=8):
    """Replace each corner with an arc of the given radius (smaller where the sides are short)."""
    if not radius or radius <= 0:
        return pts
    out = []
    n = len(pts)
    for i in range(n):
        a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
        ux, uy = a[0] - b[0], a[1] - b[1]
        vx, vy = c[0] - b[0], c[1] - b[1]
        lu, lv = math.hypot(ux, uy), math.hypot(vx, vy)
        if lu < _EPS or lv < _EPS:
            out.append(b)
            continue
        ux, uy, vx, vy = ux / lu, uy / lu, vx / lv, vy / lv
        angle = math.acos(max(-1.0, min(1.0, ux * vx + uy * vy)))
        if angle < 1e-3 or angle > math.pi - 1e-3:
            out.append(b)
            continue
        t = min(radius / math.tan(angle / 2), lu / 2, lv / 2)
        r = t * math.tan(angle / 2)
        bx, by = ux + vx, uy + vy
        bl = math.hypot(bx, by)
        cx, cy = b[0] + bx / bl * r / math.sin(angle / 2), b[1] + by / bl * r / math.sin(angle / 2)
        start = math.atan2(b[1] + uy * t - cy, b[0] + ux * t - cx)
        end = math.atan2(b[1] + vy * t - cy, b[0] + vx * t - cx)
        sweep = end - start
        while sweep > math.pi:
            sweep -= 2 * math.pi
        while sweep < -math.pi:
            sweep += 2 * math.pi
        for k in range(steps + 1):
            ang = start + sweep * k / steps
            out.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return _clean(out)


def _inside(p, a, b, c):
    return _cross(a, b, p) >= -_EPS and _cross(b, c, p) >= -_EPS and _cross(c, a, p) >= -_EPS


def _bridge(outer, hole, blockers):
    """Join a hole (clockwise) into the outline (anticlockwise) with a two-way cut, so one loop holds both."""
    m = max(range(len(hole)), key=lambda k: (hole[k][0], hole[k][1]))
    mp = hole[m]
    for k in sorted(range(len(outer)), key=lambda k: (outer[k][0] - mp[0]) ** 2 + (outer[k][1] - mp[1]) ** 2):
        p = outer[k]
        if not any(_segments_cross(mp, p, e0, e1) for e0, e1 in blockers):
            ring = hole[m:] + hole[:m]
            return outer[:k + 1] + ring + [mp, p] + outer[k + 1:]
    raise ShapeError("A hole couldn't be joined to the outline. Is it inside the outline?")


def triangulate(loop):
    """Ear clipping. `loop` runs anticlockwise; returns triangles as point triples, anticlockwise."""
    work = list(loop)
    tris = []
    guard = 0
    while len(work) > 3:
        guard += 1
        if guard > 4 * len(loop) * len(loop) + 100:
            raise ShapeError("The outline couldn't be filled. Check it doesn't cross itself")
        found = False
        for k in range(len(work)):
            a, b, c = work[k - 1], work[k], work[(k + 1) % len(work)]
            if _cross(a, b, c) <= _EPS:
                continue
            if any(p not in (a, b, c) and _inside(p, a, b, c) for p in work):
                continue
            tris.append((a, b, c))
            work.pop(k)
            found = True
            break
        if not found:
            # Only straight or reflex corners remain (a sliver): drop a straight one, or give up.
            for k in range(len(work)):
                if abs(_cross(work[k - 1], work[k], work[(k + 1) % len(work)])) <= _EPS:
                    work.pop(k)
                    found = True
                    break
            if not found:
                raise ShapeError("The outline couldn't be filled. Check it doesn't cross itself")
    if len(work) == 3 and _cross(*work) > _EPS:
        tris.append(tuple(work))
    return tris


def extrude(points, height, holes=None, radius=0, hole_radius=0):
    """An outline (and holes inside it) pushed straight up by `height` mm."""
    h = float(height)
    if not 0.1 <= h <= 300:
        raise ShapeError("The height must be between 0.1 and 300 mm")
    outer = _clean(_pts(points, "outline"))
    if len(outer) < 3:
        raise ShapeError("The outline needs at least three corners")
    if area2(outer) < 0:
        outer.reverse()
    outer = round_corners(outer, float(radius or 0))
    inner = []
    for raw in holes or []:
        hole = _clean(_pts(raw, "hole"))
        if len(hole) < 3:
            raise ShapeError("Each hole needs at least three corners")
        if area2(hole) > 0:
            hole.reverse()
        hole = round_corners(hole, float(hole_radius or 0))
        inner.append(hole)
    loops = [outer] + inner
    check_simple(loops)
    for hole in inner:
        if not all(_point_in_polygon(p, outer) for p in hole):
            raise ShapeError("A hole reaches outside the outline")
    if abs(area2(outer)) / 2 < 0.01:
        raise ShapeError("The outline encloses no area")
    merged = outer
    for hole in sorted(inner, key=lambda lp: -max(p[0] for p in lp)):
        blockers = [e for loop in [merged] + inner for e in _edges(loop)]
        merged = _bridge(merged, hole, blockers)
    caps = triangulate(merged)
    tris = []
    for a, b, c in caps:
        tris.append(((a[0], a[1], 0.0), (c[0], c[1], 0.0), (b[0], b[1], 0.0)))       # bottom, facing down
        tris.append(((a[0], a[1], h), (b[0], b[1], h), (c[0], c[1], h)))             # top, facing up
    for loop in loops:
        for (ax, ay), (bx, by) in _edges(loop):
            a0, b0, b1, a1 = (ax, ay, 0.0), (bx, by, 0.0), (bx, by, h), (ax, ay, h)
            tris += [(a0, b0, b1), (a0, b1, a1)]
    return tris


def _point_in_polygon(p, loop):
    inside = False
    x, y = p
    for (ax, ay), (bx, by) in _edges(loop):
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
    return inside


def revolve(profile, segments=96):
    """A profile in (radius, height) pairs, spun all the way round the Z axis."""
    pts = _clean(_pts(profile, "profile"))
    if any(r < -1e-6 for r, _ in pts):
        raise ShapeError("A profile point has a negative radius: use radius 0 or more")
    pts = [(max(0.0, r), z) for r, z in pts]
    if len(pts) < 3 or abs(area2(pts)) / 2 < 0.01:
        raise ShapeError("The profile needs at least three points enclosing an area")
    if area2(pts) < 0:
        pts.reverse()
    check_simple([pts])
    n = int(max(8, min(256, int(segments or 96))))
    rings = [(math.cos(2 * math.pi * i / n), math.sin(2 * math.pi * i / n)) for i in range(n)]
    low = min(z for _, z in pts)

    def at(p, i):
        r, z = p
        if r == 0:
            return (0.0, 0.0, z - low)
        cu, su = rings[i % n]
        return (r * cu, r * su, z - low)

    tris = []
    for p, q in _edges(pts):
        if p[0] == 0 and q[0] == 0:
            continue                                     # along the axis: nothing to spin
        for i in range(n):
            a, b, c, d = at(p, i), at(p, i + 1), at(q, i + 1), at(q, i)
            if p[0] > 0:
                tris.append((a, b, c))
            if q[0] > 0:
                tris.append((a, c, d))
    return tris


def gear_outline(teeth, module, pressure_angle=20.0, steps=6):
    """The outline of a spur gear with involute teeth, centred on the origin."""
    n = int(teeth)
    m = float(module)
    if not 6 <= n <= 200:
        raise ShapeError("A gear here has 6 to 200 teeth")
    if not 0.3 <= m <= 10:
        raise ShapeError("The module (tooth size) must be between 0.3 and 10 mm")
    alpha = math.radians(float(pressure_angle))
    rp = m * n / 2
    ra, rf, rb = rp + m, max(rp - 1.25 * m, 0.5 * m), rp * math.cos(alpha)
    if ra > 140:
        raise ShapeError("That gear is wider than the printer")

    def inv(r):
        a = math.acos(min(1.0, rb / r)) if r > rb else 0.0
        return math.tan(a) - a

    half = math.pi / (2 * n) + (math.tan(alpha) - alpha)        # half a tooth's angle at the base circle
    start = max(rb, rf)
    radii = [start + (ra - start) * k / steps for k in range(steps + 1)]
    out = []
    for k in range(n):
        centre = 2 * math.pi * k / n
        right = [(r, centre - (half - inv(r))) for r in radii]
        left = [(r, centre + (half - inv(r))) for r in reversed(radii)]
        if rf < rb:
            out.append((rf, right[0][1]))
        out += right
        out += left
        if rf < rb:
            out.append((rf, left[-1][1]))
        gap_end = 2 * math.pi * (k + 1) / n - (half - inv(start))
        a0 = out[-1][1]
        for s in range(1, 3):
            out.append((rf, a0 + (gap_end - a0) * s / 3))
    return [(r * math.cos(a), r * math.sin(a)) for r, a in out], {"pitch_diameter": round(2 * rp, 3),
                                                                  "outside_diameter": round(2 * ra, 3)}


def circle(diameter, segments=64, centre=(0.0, 0.0)):
    r = float(diameter) / 2
    return [(centre[0] + r * math.cos(2 * math.pi * i / segments), centre[1] + r * math.sin(2 * math.pi * i / segments))
            for i in range(segments)]
