"""
Mixed-nozzle layer planning for the Snapmaker U1, and the nozzle check
Confirm Print runs before a start.

Each toolhead has a preferred layer height. A shared grid makes those
heights whole multiples of a common step; coarser heads print every Nth
step. This calculator checks that grid against the selected nozzle limits.

This module doesn't slice. It plans: which grid a set of nozzles and
heights lands on, how many grid layers each head spans, and whether each
height is one the U1's own profile allows for that nozzle.
"""

import math

# min/max layer height per nozzle, from Snapmaker's U1 machine profiles
# (github.com/Snapmaker/OrcaSlicer, commit 8931178, resources/profiles/
# Snapmaker/machine/"Snapmaker U1 (<n> nozzle).json").
U1_LIMITS = {0.2: (0.04, 0.14), 0.4: (0.08, 0.32), 0.6: (0.12, 0.42), 0.8: (0.16, 0.56)}
TOLERANCE = 0.01          # mm: "lands within 0.01 mm of a whole multiple"


def _nozzle(value):
    try:
        n = round(float(value), 2)
    except (TypeError, ValueError):
        raise ValueError(f"'{value}' isn't a nozzle size")
    if n not in U1_LIMITS:
        raise ValueError(f"The U1 has no {n} mm nozzle profile (0.2, 0.4, 0.6 and 0.8 mm exist)")
    return n


def _height(value):
    try:
        h = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"'{value}' isn't a layer height")
    if not (0.01 <= h <= 1.0) or h != h:
        raise ValueError("Layer heights must be between 0.01 and 1 mm")
    return h


def shared_grid(heights, exact=False):
    """
    The object's layer height for these preferred heights.

    Normal: the coarsest height g, from the finest preferred height down to
    a quarter of it, on which every preferred height lands within 0.01 mm
    of a whole multiple. Exact: the coarsest g that every height (to the
    hundredth of a millimetre) is an exact multiple of.
    """
    hs = [round(h, 2) for h in heights]
    if exact:
        g = 0
        for h in hs:
            g = math.gcd(g, int(round(h * 100)))
        return g / 100
    finest = min(hs)
    steps = int(round(finest * 1000))
    for k in range(steps, int(math.ceil(steps / 4)) - 1, -1):
        g = k / 1000
        if all(abs(h - max(1, round(h / g)) * g) <= TOLERANCE + 1e-9 for h in hs):
            return g
    return round(finest / 4, 3)


def plan(heads, exact=False, part_height=None):
    """
    heads: [{"toolhead": "T0", "nozzle": 0.4, "height": 0.08}, ...] - a head
    with no "height" prints at the grid. Returns the grid, and per head the
    multiple, the height it really prints, layers for a part this tall, and
    anything outside the U1 profile's limits, in words.
    """
    if not heads:
        raise ValueError("Add at least one toolhead")
    rows = []
    for h in heads:
        th = str(h.get("toolhead") or "").strip().upper()
        if not (len(th) == 2 and th[0] == "T" and th[1] in "0123"):
            raise ValueError(f"'{h.get('toolhead')}' isn't a U1 toolhead (T0 to T3)")
        nozzle = _nozzle(h.get("nozzle"))
        height = None if h.get("height") in (None, "") else _height(h.get("height"))
        rows.append({"toolhead": th, "nozzle": nozzle, "preferred": height})
    if len({r["toolhead"] for r in rows}) != len(rows):
        raise ValueError("Each toolhead can appear once")
    preferred = [r["preferred"] for r in rows if r["preferred"]]
    if not preferred:
        raise ValueError("Give at least one toolhead a layer height")
    grid = shared_grid(preferred, exact)
    notes = []
    tall = None
    if part_height not in (None, ""):
        tall = float(part_height)
        if not (0 < tall <= 270):
            raise ValueError("Part height must be between 0 and 270 mm")
    for r in rows:
        k = 1 if not r["preferred"] else max(1, round(r["preferred"] / grid))
        r["every"] = k
        r["height"] = round(k * grid, 3)
        lo, hi = U1_LIMITS[r["nozzle"]]
        r["limits"] = [lo, hi]
        r["ok"] = lo - 1e-9 <= r["height"] <= hi + 1e-9
        if r["height"] > hi + 1e-9:
            notes.append(f"{r['toolhead']}: {r['height']:.3g} mm layers are thicker than the {r['nozzle']} mm nozzle's "
                         f"{hi} mm maximum in Snapmaker's U1 profile")
        elif r["height"] < lo - 1e-9:
            notes.append(f"{r['toolhead']}: {r['height']:.3g} mm layers are thinner than the {r['nozzle']} mm nozzle's "
                         f"{lo} mm minimum in Snapmaker's U1 profile")
        if r["preferred"] and abs(r["height"] - r["preferred"]) > 1e-6:
            notes.append(f"{r['toolhead']}: {r['preferred']:g} mm prints as {r['height']:.3g} mm, "
                         f"{k} grid layer{'s' if k > 1 else ''} of {grid:g} mm")
        r["layers"] = math.ceil(round(tall / r["height"], 6)) if tall else None
    # The prime tower prints a slab per tool change on the grid: a coarse
    # nozzle purging on a fine slab goes below its own minimum.
    thin = [r for r in rows if grid < r["limits"][0] - 1e-9]
    if thin:
        notes.append("The shared grid (" + f"{grid:g} mm) is below the minimum of "
                     + ", ".join(f"{r['toolhead']}'s {r['nozzle']} mm nozzle ({r['limits'][0]} mm)" for r in thin)
                     + "; its prime-tower slabs print that thin, and the slicer reports it")
    fine_layers = math.ceil(round(tall / grid, 6)) if tall else None
    return {"grid": grid, "exact": bool(exact), "heads": rows, "notes": notes,
            "part_height": tall, "grid_layers": fine_layers}


# -- Confirm Print -------------------------------------------------------------

def _floats(text):
    out = []
    for part in str(text or "").replace(";", ",").split(","):
        try:
            out.append(float(part))
        except ValueError:
            out.append(None)
    return out


def file_nozzles(meta):
    """{"T0": 0.4, ...} from the file's own settings (nozzle_diameter)."""
    values = _floats(meta.get("nozzle_diameter")) if meta.get("nozzle_diameter") else []
    return {f"T{i}": v for i, v in enumerate(values) if v}


def file_layer_heights(meta):
    """{"T0": 0.08, ...} when the file was sliced with per-extruder heights."""
    values = _floats(meta.get("extruder_layer_height")) if meta.get("extruder_layer_height") else []
    return {f"T{i}": v for i, v in enumerate(values) if v}


def check_nozzles(meta, used, toolheads):
    """
    Compare the nozzle each used toolhead was sliced for with the one the
    printer reports fitted. Returns (blocking, info, rows).
    """
    wanted = file_nozzles(meta)
    if not wanted:
        return [], [], []
    if len(set(wanted.values())) == 1 and len(wanted) == 1:
        wanted = {th: next(iter(wanted.values())) for th in used}
    heights = file_layer_heights(meta)
    blocking, info, rows = [], [], []
    unknown = []
    for th in sorted(used):
        want = wanted.get(th)
        have = (toolheads.get(th) or {}).get("nozzle_diameter")
        rows.append({"toolhead": th, "sliced_for": want, "fitted": have, "layer_height": heights.get(th)})
        if want is None:
            continue
        if have is None:
            unknown.append(th)
        elif abs(want - have) > 0.01:
            blocking.append(f"{th}: the file was sliced for a {want:g} mm nozzle, and {th} has a {have:g} mm nozzle fitted")
    if unknown:
        info.append("Nozzle sizes not checked for " + ", ".join(unknown) + ": this printer doesn't report them")
    if heights and len(set(round(v, 3) for v in heights.values())) > 1:
        info.append("Mixed layer heights: " + ", ".join(f"{th} {v:g} mm" for th, v in sorted(heights.items())))
    return blocking, info, rows
