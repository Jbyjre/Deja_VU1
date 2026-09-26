"""
photo_studio.py
===============

The server half of the Photo-to-Print Studio. The studio itself runs in
the browser (frontend/studio.js): the photo never leaves the page while it
is being turned into a colour-layered relief, the same way viewer3d.js
reads STL and 3MF files without a round trip. This file does the two
things only the server can:

  1. palette() - the colours to build with: the spools in your filament
     inventory when that module is on, so the studio plans with filament
     you actually own. Each gets a *starting estimate* of its
     transmission distance (how thick a layer must be before it hides
     what's under it); real filaments vary a lot, so the studio lets you
     change it and says it's an estimate.
  2. save() - checks the model the browser built (it must read as a real
     STL or 3MF, fit on the U1's bed and not be absurdly large) and adds
     it to the file library like any other upload. For a 3MF it also reads
     back the colour-swap plan the studio wrote into
     Metadata/custom_gcode_per_layer.xml, so the library note says what
     the file really contains.

That XML is the layout OrcaSlicer's own 3MF reader expects
(src/libslic3r/Format/bbs_3mf.cpp, _extract_custom_gcode_per_print_z_from_archive,
tag v2.3.2): <custom_gcodes_per_layer><plate><plate_info id="1"/><layer
top_z=".." type="2" extruder=".." color=".." extra="" gcode="tool_change"/>
<mode value="MultiAsSingle"/></plate></custom_gcodes_per_layer>, where
type 2 is CustomGCode::ToolChange. Like the 3MF converter, not yet
confirmed by opening a studio file in Orca.
"""

import io
import re
import xml.etree.ElementTree as ET
import zipfile

import file_library
import filament_inventory
import mesh_tools
import mock_moonraker
import modules

BED_MM = 270.0
MAX_TRIANGLES = 1_500_000
CUSTOM_GCODE_PART = "Metadata/custom_gcode_per_layer.xml"
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _luminance(hex_colour):
    r, g, b = (int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, b)]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def estimate_td(hex_colour):
    """
    A rough starting transmission distance in mm. Dark pigments stop light
    in a fraction of a millimetre, pale ones let it through for several;
    this curve only encodes that ordering. It is not a measurement - the
    studio labels it an estimate and lets you type your own.
    """
    return round(0.4 + 3.6 * _luminance(hex_colour) ** 0.5, 1)


def palette():
    """Colours to plan with: your spools when the inventory is on."""
    colours = []
    if modules.is_enabled("filament_inventory"):
        for spool in filament_inventory.get_inventory():
            hx = spool.get("color_hex") or ""
            if not _HEX.match(hx):
                continue
            colours.append({"id": spool["id"], "name": spool.get("color_name") or hx, "hex": hx.upper(),
                            "material": spool.get("material") or "PLA",
                            "grams_remaining": spool.get("grams_remaining"),
                            "td_mm": estimate_td(hx), "td_source": "estimate", "source": "inventory"})
        source = "inventory"
    else:
        source = "free"
    return {
        "source": source,
        "colours": colours,
        # Suggestions when the inventory is off (or empty): the colours the
        # rest of this project already uses. Clearly not "yours".
        "suggestions": [{"name": c["name"], "hex": c["hex"].upper(), "td_mm": estimate_td(c["hex"]),
                         "td_source": "estimate"} for c in mock_moonraker.FILAMENT_COLORS],
        "note": ("From your filament inventory." if source == "inventory" and colours else
                 "Filament inventory is off (or empty) - pick colours yourself; nothing here claims you own them."),
        "bed_mm": BED_MM,
    }


def read_swap_plan(data):
    """The tool changes a 3MF asks for, from Metadata/custom_gcode_per_layer.xml."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return []
    if CUSTOM_GCODE_PART not in archive.namelist():
        return []
    try:
        root = ET.fromstring(archive.read(CUSTOM_GCODE_PART))
    except ET.ParseError:
        raise ValueError("The colour-swap plan inside the 3MF isn't valid XML")
    if root.tag != "custom_gcodes_per_layer":
        raise ValueError("The colour-swap plan inside the 3MF has the wrong root element")
    swaps = []
    for layer in root.iter("layer"):
        try:
            swaps.append({"top_z": float(layer.get("top_z")), "type": int(layer.get("type")),
                          "extruder": int(layer.get("extruder")), "color": layer.get("color") or ""})
        except (TypeError, ValueError):
            raise ValueError("A colour swap inside the 3MF is missing its height, type or toolhead")
    return sorted(swaps, key=lambda s: s["top_z"])


def save(name, data, note=None):
    """Check a studio model and add it to the library."""
    name = file_library.clean_name(name)
    if file_library.kind_of(name) not in ("stl", "3mf"):
        raise ValueError("The studio saves STL or 3MF models")
    if not data:
        raise ValueError("The model is empty")
    try:
        triangles, info = mesh_tools.parse_model(data, name)
    except mesh_tools.MeshError as exc:
        raise ValueError(f"That isn't a readable model: {exc}")
    if not triangles:
        raise ValueError("The model has no triangles")
    if len(triangles) > MAX_TRIANGLES:
        raise ValueError(f"{len(triangles):,} triangles is too many - lower the resolution")
    size = mesh_tools.bounds(triangles)["size"]
    if any(v > BED_MM + 1e-6 for v in size):
        raise ValueError(f"At {size[0]:.0f} × {size[1]:.0f} × {size[2]:.1f} mm it doesn't fit the U1's "
                         f"{BED_MM:.0f} mm build volume")
    swaps = read_swap_plan(data) if name.lower().endswith(".3mf") else []
    words = str(note or "").strip()[:300]
    if swaps:
        plan = ", ".join(f"T{s['extruder'] - 1} from {s['top_z']:.2f} mm" for s in swaps)
        words = (words + " · " if words else "") + f"Tool changes: {plan}"
    entry = file_library.save(name, data, origin="studio",
                              note=("Made in Photo-to-Print Studio. " + words).strip())
    return {"file": entry, "triangles": len(triangles), "size_mm": [round(v, 2) for v in size],
            "swaps": swaps}
