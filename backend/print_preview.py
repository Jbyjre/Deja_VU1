"""
print_preview.py
================

The part on the plate, for the 3D twin: the outside walls and top surfaces
of every layer of the file being printed, read from that file's own G-code
and grouped by the toolhead that lays each one down. The twin grows them up
to the height the nozzle has reached, each in the colour loaded in its head,
so a Benchy printed in two colours shows in those two colours, layer by layer.

Where the G-code comes from, in order:
  1. a real printer: the file itself, downloaded from the printer
     (Moonraker's GET /server/files/gcodes/<name>), so it is exactly what is
     being printed;
  2. this dashboard's file library, when it holds a file of that name (the
     usual case: it was sent from here);
  3. a simulated printer printing one of the sample files: that sample.
Nothing is drawn for a file none of these can supply; the reply says why.

Only extrusion is kept, and of that only what can be seen from outside:
walls tagged as the outer wall by the slicer (";TYPE:Outer wall" in Orca,
"External perimeter" in PrusaSlicer) and top or solid surfaces. A file with
no such tags keeps every extruding move. Paths are thinned to a tolerance of
a few hundredths of a millimetre and capped, so a large print still loads in
the browser in a moment.
"""

import math
import threading

import gcode_tools

WALL_TOLERANCE_MM = 0.04         # a point closer than this to its neighbours' line is dropped
MAX_WALL_POINTS = 160000
MAX_FILL_POINTS = 60000
MAX_FILE_BYTES = 64 * 1024 * 1024
_UNIT = 100                      # coordinates are sent as hundredths of a millimetre

_WALL_FEATURES = ("outer wall", "external perimeter", "overhang wall", "overhang perimeter")
_FILL_FEATURES = ("top surface", "top solid infill", "solid infill", "ironing")

_cache = {}
_cache_order = []
_cache_lock = threading.Lock()
_CACHE_KEEP = 4


def _feature_kind(name):
    n = (name or "").strip().lower()
    if any(n.startswith(f) for f in _WALL_FEATURES):
        return "wall"
    if any(n.startswith(f) for f in _FILL_FEATURES):
        return "fill"
    return None


def _thin(points, tol):
    """Drop points that sit on the line between their neighbours (within tol)."""
    if len(points) <= 2:
        return points
    out = [points[0]]
    for i in range(1, len(points) - 1):
        ax, ay = out[-1]
        bx, by = points[i + 1]
        px, py = points[i]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        if length < 1e-9:
            dist = math.hypot(px - ax, py - ay)
        else:
            dist = abs(dx * (ay - py) - dy * (ax - px)) / length
        if dist > tol:
            out.append(points[i])
    out.append(points[-1])
    return out


def build(text):
    """
    The visible paths of a G-code file, per toolhead.

    Returns {"layers": [{"z", "h"}], "tools": {"T0": {"walls": [...], "fill": [...]}}, ...}
    where each path is [layer index, object index (-1: none), x0, y0, dx1, dy1, ...] in hundredths of a
    millimetre: the first point, then each next point as a step from the one before.
    """
    pos = {"X": 0.0, "Y": 0.0, "Z": 0.0, "E": 0.0}
    absolute_xyz, absolute_e = True, True
    tool = 0
    feature = None
    any_tags = False
    layer_z = []                  # distinct extrusion heights, in print order
    layer_of = {}                 # rounded z -> index
    paths = []                    # [tool, kind, layer, object, [(x, y), ...]]
    objects = []                  # object names, from EXCLUDE_OBJECT_START (upper-cased, as Klipper does)
    obj = -1
    current = None                # the path being extended

    def layer_index(z):
        key = round(z, 2)
        idx = layer_of.get(key)
        if idx is None:
            idx = layer_of[key] = len(layer_z)
            layer_z.append(key)
        return idx

    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped:
            continue
        if stripped.startswith(";"):
            low = stripped[1:].strip()
            head = low[:8].upper()
            if head.startswith("TYPE:") or head.startswith("FEATURE:"):
                feature = low.split(":", 1)[1].strip()
                any_tags = True
                current = None
            continue
        cmd, params, _line = gcode_tools.klipper_command(raw)
        if not cmd:
            continue
        if cmd in ("EXCLUDE_OBJECT_START", "EXCLUDE_OBJECT_END"):
            name = gcode_tools._extended(raw.split(";", 1)[0]).get("NAME", "").upper()[:120]
            if cmd == "EXCLUDE_OBJECT_END" or not name:
                obj = -1
            else:
                if name not in objects and len(objects) < gcode_tools.MAX_OBJECTS:
                    objects.append(name)
                obj = objects.index(name) if name in objects else -1
            current = None
            continue
        if cmd in ("G0", "G1", "G2", "G3"):
            end = dict(pos)
            for axis in ("X", "Y", "Z"):
                v = gcode_tools._num(params.get(axis))
                if v is not None:
                    end[axis] = v if absolute_xyz else pos[axis] + v
            e = gcode_tools._num(params.get("E"))
            extruding = False
            if e is not None:
                extruding = (e > pos["E"] + 1e-6) if absolute_e else e > 1e-6
                end["E"] = e if absolute_e else pos["E"]
            moved = (end["X"] != pos["X"]) or (end["Y"] != pos["Y"])
            if extruding and moved:
                kind = _feature_kind(feature)
                keep = kind if any_tags else "wall"
                if keep:
                    if cmd in ("G2", "G3"):
                        i = gcode_tools._num(params.get("I")) or 0.0
                        j = gcode_tools._num(params.get("J")) or 0.0
                        pts = [(p[0], p[1]) for p in gcode_tools._arc_points(pos, end, i, j, cmd == "G2")]
                    else:
                        pts = [(end["X"], end["Y"])]
                    li = layer_index(end["Z"])
                    if (current is None or current[0] != tool or current[1] != keep or current[2] != li
                            or current[3] != obj or current[4][-1] != (pos["X"], pos["Y"])):
                        current = [tool, keep, li, obj, [(pos["X"], pos["Y"])]]
                        paths.append(current)
                    current[4].extend(pts)
                else:
                    current = None
            elif moved or end["Z"] != pos["Z"]:
                current = None
            pos = end
        elif cmd == "G90":
            absolute_xyz = True
        elif cmd == "G91":
            absolute_xyz = False
        elif cmd == "M82":
            absolute_e = True
        elif cmd == "M83":
            absolute_e = False
        elif cmd == "G92":
            v = gcode_tools._num(params.get("E"))
            if v is not None:
                pos["E"] = v
        elif len(cmd) >= 2 and cmd[0] == "T" and cmd[1:].isdigit():
            n = int(cmd[1:])
            if n in gcode_tools.VALID_TOOLS:
                tool = n
                current = None

    # Heights, in the order the layers rise (a few files print a lower
    # height after a higher one, for example a second object; sort them).
    order = sorted(range(len(layer_z)), key=lambda i: layer_z[i])
    remap = {old: new for new, old in enumerate(order)}
    zs = [layer_z[i] for i in order]
    layers = [{"z": z, "h": round(z - (zs[k - 1] if k else 0.0), 3) or 0.2} for k, z in enumerate(zs)]

    result = {"layers": layers, "tools": {}, "objects": objects, "tagged": any_tags, "simplified": False}
    budgets = {"wall": MAX_WALL_POINTS, "fill": MAX_FILL_POINTS}
    tol = WALL_TOLERANCE_MM
    for attempt in range(4):
        counts = {"wall": 0, "fill": 0}
        tools = {}
        for t, kind, li, oi, pts in paths:
            thin = _thin(pts, tol if kind == "wall" else tol * 2)
            if len(thin) < 2:
                continue
            counts[kind] += len(thin)
            entry = tools.setdefault(f"T{t}", {"walls": [], "fill": []})
            # [layer, object, x0, y0, then each next point as a step from the one before]
            flat = [remap[li], oi]
            px = py = 0
            for x, y in thin:
                ix, iy = int(round(x * _UNIT)), int(round(y * _UNIT))
                flat.append(ix - px)
                flat.append(iy - py)
                px, py = ix, iy
            entry["walls" if kind == "wall" else "fill"].append(flat)
        if counts["fill"] > budgets["fill"]:
            for entry in tools.values():
                entry["fill"] = []
            result["simplified"] = True
            counts["fill"] = 0
        if counts["wall"] <= budgets["wall"]:
            break
        tol *= 2.5
        result["simplified"] = True
    result["tools"] = tools
    result["points"] = counts["wall"] + counts["fill"]
    result["unit_mm"] = 1.0 / _UNIT
    return result


def _cached(key, make):
    with _cache_lock:
        hit = _cache.get(key)
    if hit is not None:
        return hit
    value = make()
    with _cache_lock:
        _cache[key] = value
        _cache_order.append(key)
        while len(_cache_order) > _CACHE_KEEP:
            _cache.pop(_cache_order.pop(0), None)
    return value


def _colours(text):
    meta = gcode_tools.parse_metadata(text)
    out = []
    for c in meta.get("filament_colours") or []:
        c = str(c).strip()
        out.append(c[:7] if gcode_tools._HEX_COLOUR.fullmatch(c) else None)
    return out


def for_file(name, text, source, version):
    """The preview of one file's text, remembered per file version."""
    def make():
        data = build(text)
        data["file_colours"] = _colours(text)
        return data
    data = _cached((source, name, version), make)
    return {**data, "file": name, "source": source}


def for_current():
    """The preview of whatever the selected printer is printing now."""
    import file_library
    import mock_moonraker
    import sample_files

    state = mock_moonraker.get_printer_state()
    name = state.get("current_file")
    if not name or state.get("state") not in ("printing", "paused", "complete"):
        return {"file": None, "reason": "Nothing is printing"}
    printer_id = mock_moonraker.selected_printer_id()

    if mock_moonraker.is_real(printer_id):
        try:
            version = mock_moonraker.gcode_version(name)
            source = f"printer:{printer_id}"
            with _cache_lock:
                hit = _cache.get((source, name, version))
            if hit is not None and version != (None, None):
                return {**hit, "file": name, "source": source}
            data = mock_moonraker.fetch_gcode(name, MAX_FILE_BYTES)
            return for_file(name, data.decode("utf-8", "replace"), source, version)
        except (mock_moonraker.PrinterCommandError, OSError, ValueError) as exc:
            reason = str(exc)
        try:
            path = file_library._path(name)
            st = __import__("os").stat(path)
            out = for_file(name, file_library.read_text(name), "library", (st.st_size, st.st_mtime_ns))
            out["note"] = ("Drawn from this dashboard's copy of the file: the printer's own copy could "
                           f"not be read ({reason})")
            return out
        except (ValueError, OSError, LookupError):
            return {"file": name, "reason": f"The printer's copy of {name} could not be read: {reason}"}

    try:
        path = file_library._path(name)
        st = __import__("os").stat(path)
        return for_file(name, file_library.read_text(name), "library", (st.st_size, st.st_mtime_ns))
    except (ValueError, OSError, LookupError):
        pass
    if name in sample_files.SAMPLES or name in sample_files.LEGACY:
        if name.lower().endswith(".gcode"):
            text = sample_files.build(name).decode("utf-8")
            return for_file(name, text, "sample", len(text))
    return {"file": name, "reason": f"{name} isn't in the file library, so its layers can't be drawn"}
