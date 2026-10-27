"""
Which printer is on the other end: the Snapmaker U1, Deja Vu1's reference,
or another Klipper printer described from what it reports about itself.

A non-U1 printer is never given guessed figures. Its build volume comes
from Klipper's own axis limits (the toolhead status, kinematics get_status:
axis_minimum / axis_maximum), its heads from the extruders it lists, and its
nozzle and kinematics from its config file (configfile settings). Anything
it doesn't report stays None and the checks that need it say so.
"""

U1_ID = "snapmaker-u1"
KLIPPER_ID = "klipper"

# Snapmaker U1: a 270 mm cube with four heads (Snapmaker's U1 machine
# profile; gcode_tools keeps the slack for its 0.5-270.5 printable area).
U1 = {
    "model": U1_ID,
    "name": "Snapmaker U1",
    "kind": "Snapmaker U1",
    "min_mm": [0.0, 0.0, 0.0],
    "max_mm": [270.0, 270.0, 270.0],
    "heads": 4,
    "kinematics": None,
    "nozzle_mm": None,
    "reference": True,
    "note": None,
}

UNTESTED_NOTE = ("Deja Vu1 is made for the Snapmaker U1. This printer's size and heads come from its own "
                 "Klipper settings, and the U1-only parts (dock sensors, loaded-filament colours, the 3D "
                 "twin) stay empty.")

# A reported axis outside these limits is a misreading, not a printer.
_MIN_SPAN_MM, _MAX_SPAN_MM = 20.0, 2000.0


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _axes(values):
    """x, y, z from a Klipper Coord / list, or None."""
    if not isinstance(values, (list, tuple)) or len(values) < 3:
        return None
    xyz = [_num(v) for v in values[:3]]
    return xyz if all(v is not None for v in xyz) else None


def from_klipper(axis_minimum, axis_maximum, heads, kinematics=None, nozzle_mm=None):
    """A profile for a printer that isn't a U1, from what its Klipper reports."""
    lo, hi = _axes(axis_minimum), _axes(axis_maximum)
    if lo and hi and all(_MIN_SPAN_MM <= h - l <= _MAX_SPAN_MM for l, h in zip(lo, hi)):
        lo, hi = [round(v, 2) for v in lo], [round(v, 2) for v in hi]
    else:
        lo = hi = None
    nozzle = _num(nozzle_mm)
    return {
        "model": KLIPPER_ID,
        "name": "Klipper printer",
        "kind": f"Klipper printer ({kinematics})" if isinstance(kinematics, str) and kinematics else "Klipper printer",
        "min_mm": lo,
        "max_mm": hi,
        "heads": max(1, int(heads)) if isinstance(heads, int) else 1,
        "kinematics": kinematics if isinstance(kinematics, str) and kinematics else None,
        "nozzle_mm": nozzle if nozzle and 0.05 <= nozzle <= 3.0 else None,
        "reference": False,
        "note": UNTESTED_NOTE,
    }


def size_mm(machine):
    """[x, y, z] build size, or None when the printer didn't say."""
    m = machine or U1
    if not m.get("min_mm") or not m.get("max_mm"):
        return None
    return [round(h - l, 2) for l, h in zip(m["min_mm"], m["max_mm"])]


def label(machine):
    """One line for a printer card: "Snapmaker U1" or "Klipper printer · 235 × 235 × 250 mm"."""
    m = machine or U1
    if m.get("reference"):
        return m["name"]
    size = size_mm(m)
    return m["kind"] + (f" · {size[0]:g} × {size[1]:g} × {size[2]:g} mm" if size else " · size not reported")


def public(machine):
    """What the browser sees: the profile plus its size and card line."""
    m = dict(machine or U1)
    m["size_mm"] = size_mm(m)
    m["label"] = label(m)
    return m


def key(machine):
    """A hashable identity for caching checks made against this machine."""
    m = machine or U1
    return (m.get("model"), tuple(m.get("min_mm") or ()), tuple(m.get("max_mm") or ()), m.get("heads"))
