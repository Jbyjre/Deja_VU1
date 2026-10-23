"""
process_settings.py
===================

The print-process settings Deja Vu1 can write into a private working copy of
an installed Snapmaker/Orca process preset, laid out the way OrcaSlicer's
own process tabs are (Quality, Strength, Speed, Support, Others).

Every key and every choice was checked against OrcaSlicer's option table
(src/libslic3r/PrintConfig.cpp, the `this->add("...")` definitions and their
enum lists). Only names and allowed values were taken; no engine code.
Ranges here are deliberately conservative: the engine still applies its own
limits and the printer's machine limits when it slices.

A blank field means "inherit the preset's value", so nothing here is ever
written unless the user typed it.
"""

import math

# Infill patterns present in OrcaSlicer 2.x's InfillPattern table.
_SPARSE = ["grid", "gyroid", "honeycomb", "3dhoneycomb", "cubic", "adaptivecubic", "supportcubic", "lightning",
           "triangles", "tri-hexagon", "line", "rectilinear", "alignedrectilinear", "crosshatch", "concentric",
           "hilbertcurve", "archimedeanchords", "octagramspiral"]
_SURFACE = ["monotonic", "monotonicline", "rectilinear", "alignedrectilinear", "concentric", "hilbertcurve",
            "archimedeanchords", "octagramspiral"]

# (key, label, type, tab, section, extra). Types: float, int, percent,
# speed_or_percent, enum, bool. extra: min, max, unit, choices, tip, simple.
_RAW = [
    # ---- Quality ---------------------------------------------------------
    ("layer_height", "Layer height", "float", "Quality", "Layer height", dict(min=.04, max=.56, unit="mm", simple=True)),
    ("initial_layer_print_height", "First layer height", "float", "Quality", "Layer height", dict(min=.04, max=.56, unit="mm", simple=True)),
    ("line_width", "Default line width", "float", "Quality", "Line width", dict(min=.1, max=1.2, unit="mm")),
    ("initial_layer_line_width", "First layer", "float", "Quality", "Line width", dict(min=.1, max=1.2, unit="mm")),
    ("outer_wall_line_width", "Outer wall", "float", "Quality", "Line width", dict(min=.1, max=1.2, unit="mm")),
    ("inner_wall_line_width", "Inner wall", "float", "Quality", "Line width", dict(min=.1, max=1.2, unit="mm")),
    ("top_surface_line_width", "Top surface", "float", "Quality", "Line width", dict(min=.1, max=1.2, unit="mm")),
    ("sparse_infill_line_width", "Sparse infill", "float", "Quality", "Line width", dict(min=.1, max=1.2, unit="mm")),
    ("internal_solid_infill_line_width", "Internal solid infill", "float", "Quality", "Line width", dict(min=.1, max=1.2, unit="mm")),
    ("support_line_width", "Support", "float", "Quality", "Line width", dict(min=.1, max=1.2, unit="mm")),
    ("seam_position", "Seam position", "enum", "Quality", "Seam", dict(choices=["nearest", "aligned", "back", "random"], simple=True)),
    ("seam_gap", "Seam gap", "float", "Quality", "Seam", dict(min=0, max=.5, unit="mm", tip="Stops the loop this short of its start so the seam doesn't bulge.")),
    ("seam_slope_type", "Scarf joint seam", "enum", "Quality", "Seam", dict(choices=["none", "external", "all"], tip="Ramps the seam over a distance instead of a single spot.")),
    ("staggered_inner_seams", "Stagger inner seams", "bool", "Quality", "Seam", {}),
    ("resolution", "Resolution", "float", "Quality", "Precision", dict(min=.001, max=.1, unit="mm", tip="Smallest detail kept when outlines are simplified.")),
    ("xy_hole_compensation", "X-Y hole compensation", "float", "Quality", "Precision", dict(min=-1, max=1, unit="mm", tip="Positive makes holes bigger.")),
    ("xy_contour_compensation", "X-Y contour compensation", "float", "Quality", "Precision", dict(min=-1, max=1, unit="mm", tip="Positive makes outer edges bigger.")),
    ("elefant_foot_compensation", "Elephant foot compensation", "float", "Quality", "Precision", dict(min=0, max=1, unit="mm")),
    ("precise_outer_wall", "Precise outer wall", "bool", "Quality", "Precision", {}),
    ("ironing_type", "Ironing", "enum", "Quality", "Ironing", dict(choices=["no ironing", "top", "topmost", "solid"])),
    ("ironing_flow", "Ironing flow", "percent", "Quality", "Ironing", dict(min=0, max=100, unit="%")),
    ("ironing_spacing", "Ironing line spacing", "float", "Quality", "Ironing", dict(min=.01, max=1, unit="mm")),
    ("ironing_speed", "Ironing speed", "float", "Quality", "Ironing", dict(min=5, max=300, unit="mm/s")),
    ("wall_generator", "Wall generator", "enum", "Quality", "Walls and surfaces", dict(choices=["classic", "arachne"], tip="Arachne varies line width for thin features.")),
    ("wall_sequence", "Wall order", "enum", "Quality", "Walls and surfaces", dict(choices=["inner wall/outer wall", "outer wall/inner wall", "inner-outer-inner wall"])),
    ("only_one_wall_top", "Only one wall on top surfaces", "bool", "Quality", "Walls and surfaces", {}),
    ("detect_thin_wall", "Detect thin walls", "bool", "Quality", "Walls and surfaces", {}),
    ("detect_overhang_wall", "Detect overhang walls", "bool", "Quality", "Walls and surfaces", {}),
    ("reduce_crossing_wall", "Avoid crossing walls", "bool", "Quality", "Walls and surfaces", {}),
    ("max_travel_detour_distance", "Max detour to avoid walls", "float", "Quality", "Walls and surfaces", dict(min=0, max=1000, unit="mm")),
    ("bridge_flow", "Bridge flow ratio", "float", "Quality", "Bridging", dict(min=.5, max=2, tip="Above 1 squeezes more plastic into bridges.")),
    ("thick_bridges", "Thick bridges", "bool", "Quality", "Bridging", {}),
    # ---- Strength --------------------------------------------------------
    ("wall_loops", "Wall loops", "int", "Strength", "Walls", dict(min=1, max=20, simple=True)),
    ("top_shell_layers", "Top shell layers", "int", "Strength", "Top and bottom shells", dict(min=0, max=30, simple=True)),
    ("top_shell_thickness", "Top shell thickness", "float", "Strength", "Top and bottom shells", dict(min=0, max=5, unit="mm")),
    ("top_surface_pattern", "Top surface pattern", "enum", "Strength", "Top and bottom shells", dict(choices=_SURFACE)),
    ("bottom_shell_layers", "Bottom shell layers", "int", "Strength", "Top and bottom shells", dict(min=0, max=30, simple=True)),
    ("bottom_shell_thickness", "Bottom shell thickness", "float", "Strength", "Top and bottom shells", dict(min=0, max=5, unit="mm")),
    ("bottom_surface_pattern", "Bottom surface pattern", "enum", "Strength", "Top and bottom shells", dict(choices=_SURFACE)),
    ("internal_solid_infill_pattern", "Internal solid infill pattern", "enum", "Strength", "Top and bottom shells", dict(choices=_SURFACE)),
    ("sparse_infill_density", "Sparse infill density", "percent", "Strength", "Infill", dict(min=0, max=100, unit="%", simple=True)),
    ("sparse_infill_pattern", "Sparse infill pattern", "enum", "Strength", "Infill", dict(choices=_SPARSE, simple=True)),
    ("infill_direction", "Infill direction", "float", "Strength", "Infill", dict(min=0, max=360, unit="°")),
    ("infill_wall_overlap", "Infill/wall overlap", "percent", "Strength", "Infill", dict(min=0, max=100, unit="%")),
    ("minimum_sparse_infill_area", "Minimum sparse infill area", "float", "Strength", "Infill", dict(min=0, max=500, unit="mm²", tip="Smaller pockets are filled solid instead.")),
    ("infill_combination", "Combine infill", "bool", "Strength", "Infill", dict(tip="Prints sparse infill every few layers, thicker, to save time.")),
    # ---- Speed -----------------------------------------------------------
    ("initial_layer_speed", "First layer", "float", "Speed", "First layer", dict(min=5, max=150, unit="mm/s", simple=True)),
    ("initial_layer_infill_speed", "First layer infill", "float", "Speed", "First layer", dict(min=5, max=300, unit="mm/s")),
    ("outer_wall_speed", "Outer wall", "float", "Speed", "Other layers", dict(min=5, max=500, unit="mm/s", simple=True)),
    ("inner_wall_speed", "Inner wall", "float", "Speed", "Other layers", dict(min=5, max=500, unit="mm/s", simple=True)),
    ("small_perimeter_speed", "Small perimeters", "speed_or_percent", "Speed", "Other layers", dict(min=1, max=500, unit="mm/s or %", tip="A number in mm/s, or a percentage of the outer wall speed, like 50%.")),
    ("sparse_infill_speed", "Sparse infill", "float", "Speed", "Other layers", dict(min=5, max=500, unit="mm/s", simple=True)),
    ("internal_solid_infill_speed", "Internal solid infill", "float", "Speed", "Other layers", dict(min=5, max=500, unit="mm/s")),
    ("top_surface_speed", "Top surface", "float", "Speed", "Other layers", dict(min=5, max=500, unit="mm/s")),
    ("gap_infill_speed", "Gap infill", "float", "Speed", "Other layers", dict(min=5, max=500, unit="mm/s")),
    ("support_speed", "Support", "float", "Speed", "Other layers", dict(min=5, max=500, unit="mm/s")),
    ("support_interface_speed", "Support interface", "float", "Speed", "Other layers", dict(min=5, max=500, unit="mm/s")),
    ("bridge_speed", "Bridge", "float", "Speed", "Overhangs and bridges", dict(min=5, max=500, unit="mm/s")),
    ("enable_overhang_speed", "Slow down for overhangs", "bool", "Speed", "Overhangs and bridges", {}),
    ("overhang_1_4_speed", "Overhang 10–25%", "float", "Speed", "Overhangs and bridges", dict(min=0, max=500, unit="mm/s", tip="0 means no slowdown for this band.")),
    ("overhang_2_4_speed", "Overhang 25–50%", "float", "Speed", "Overhangs and bridges", dict(min=0, max=500, unit="mm/s")),
    ("overhang_3_4_speed", "Overhang 50–75%", "float", "Speed", "Overhangs and bridges", dict(min=0, max=500, unit="mm/s")),
    ("overhang_4_4_speed", "Overhang 75–100%", "float", "Speed", "Overhangs and bridges", dict(min=0, max=500, unit="mm/s")),
    ("travel_speed", "Travel", "float", "Speed", "Travel", dict(min=10, max=700, unit="mm/s", simple=True)),
    ("default_acceleration", "Normal printing", "float", "Speed", "Acceleration", dict(min=100, max=40000, unit="mm/s²")),
    ("outer_wall_acceleration", "Outer wall", "float", "Speed", "Acceleration", dict(min=100, max=40000, unit="mm/s²")),
    ("inner_wall_acceleration", "Inner wall", "float", "Speed", "Acceleration", dict(min=100, max=40000, unit="mm/s²")),
    ("top_surface_acceleration", "Top surface", "float", "Speed", "Acceleration", dict(min=100, max=40000, unit="mm/s²")),
    ("sparse_infill_acceleration", "Sparse infill", "speed_or_percent", "Speed", "Acceleration", dict(min=1, max=40000, unit="mm/s² or %")),
    ("initial_layer_acceleration", "First layer", "float", "Speed", "Acceleration", dict(min=100, max=40000, unit="mm/s²")),
    ("travel_acceleration", "Travel", "float", "Speed", "Acceleration", dict(min=100, max=40000, unit="mm/s²")),
    ("default_jerk", "Default jerk", "float", "Speed", "Jerk", dict(min=0, max=50, unit="mm/s", tip="On Klipper printers the engine writes this as square corner velocity.")),
    ("infill_jerk", "Infill jerk", "float", "Speed", "Jerk", dict(min=0, max=50, unit="mm/s")),
    # ---- Support ---------------------------------------------------------
    ("enable_support", "Enable support", "bool", "Support", "Support", dict(simple=True)),
    ("support_type", "Type", "enum", "Support", "Support", dict(choices=["normal(auto)", "tree(auto)", "normal(manual)", "tree(manual)"], simple=True)),
    ("support_style", "Style", "enum", "Support", "Support", dict(choices=["default", "grid", "snug", "tree_slim", "tree_strong", "tree_hybrid", "organic"])),
    ("support_threshold_angle", "Threshold angle", "float", "Support", "Support", dict(min=0, max=90, unit="°", simple=True)),
    ("support_on_build_plate_only", "On build plate only", "bool", "Support", "Support", {}),
    ("support_top_z_distance", "Top Z distance", "float", "Support", "Support", dict(min=0, max=1, unit="mm")),
    ("support_bottom_z_distance", "Bottom Z distance", "float", "Support", "Support", dict(min=0, max=1, unit="mm")),
    ("support_object_xy_distance", "Support/object XY distance", "float", "Support", "Support", dict(min=0, max=10, unit="mm")),
    ("support_base_pattern", "Base pattern", "enum", "Support", "Advanced", dict(choices=["default", "rectilinear", "rectilinear-grid", "honeycomb", "lightning", "hollow"])),
    ("support_base_pattern_spacing", "Base pattern spacing", "float", "Support", "Advanced", dict(min=0, max=10, unit="mm")),
    ("support_interface_top_layers", "Top interface layers", "int", "Support", "Advanced", dict(min=0, max=10)),
    ("support_interface_bottom_layers", "Bottom interface layers", "int", "Support", "Advanced", dict(min=0, max=10)),
    ("support_interface_pattern", "Interface pattern", "enum", "Support", "Advanced", dict(choices=["auto", "rectilinear", "concentric", "rectilinear_interlaced", "grid"])),
    ("independent_support_layer_height", "Independent support layer height", "bool", "Support", "Advanced", {}),
    ("raft_layers", "Raft layers", "int", "Support", "Raft", dict(min=0, max=10)),
    # ---- Others ----------------------------------------------------------
    ("skirt_loops", "Skirt loops", "int", "Others", "Skirt", dict(min=0, max=20)),
    ("skirt_distance", "Skirt distance", "float", "Others", "Skirt", dict(min=0, max=30, unit="mm")),
    ("skirt_height", "Skirt height", "int", "Others", "Skirt", dict(min=1, max=100, unit="layers")),
    ("brim_type", "Brim type", "enum", "Others", "Brim", dict(choices=["no_brim", "outer_only", "inner_only", "outer_and_inner", "auto_brim", "brim_ears"], simple=True)),
    ("brim_width", "Brim width", "float", "Others", "Brim", dict(min=0, max=30, unit="mm", simple=True)),
    ("brim_object_gap", "Brim-object gap", "float", "Others", "Brim", dict(min=0, max=2, unit="mm")),
    ("enable_prime_tower", "Prime tower", "bool", "Others", "Prime tower", dict(tip="Needed for clean colour changes on a tool changer; switch off only for single-head prints.")),
    ("prime_tower_width", "Prime tower width", "float", "Others", "Prime tower", dict(min=2, max=200, unit="mm")),
    ("prime_tower_brim_width", "Prime tower brim width", "float", "Others", "Prime tower", dict(min=0, max=20, unit="mm")),
    ("ooze_prevention", "Ooze prevention", "bool", "Others", "Prime tower", dict(tip="Drops idle heads' temperature while another head prints.")),
    ("print_sequence", "Print sequence", "enum", "Others", "Special modes", dict(choices=["by layer", "by object"])),
    ("spiral_mode", "Spiral vase", "bool", "Others", "Special modes", {}),
    ("slow_down_layers", "Slow down for the first", "int", "Others", "Special modes", dict(min=0, max=20, unit="layers")),
    ("fuzzy_skin", "Fuzzy skin", "enum", "Others", "Fuzzy skin", dict(choices=["none", "external", "all", "allwalls"])),
    ("fuzzy_skin_thickness", "Fuzzy skin thickness", "float", "Others", "Fuzzy skin", dict(min=0, max=1, unit="mm")),
    ("fuzzy_skin_point_distance", "Fuzzy skin point distance", "float", "Others", "Fuzzy skin", dict(min=.1, max=5, unit="mm")),
    ("exclude_object", "Label objects for skipping", "bool", "Others", "G-code output", dict(tip="Lets you skip one object mid-print from the Control tab.")),
    ("gcode_label_objects", "Label objects in comments", "bool", "Others", "G-code output", {}),
]

TABS = ["Quality", "Strength", "Speed", "Support", "Others"]
OPTIONS = {key: {"key": key, "label": label, "type": kind, "tab": tab, "section": section, **extra}
           for key, label, kind, tab, section, extra in _RAW}
LINE_WIDTHS = [k for k in OPTIONS if k.endswith("line_width")]
WHOLE = {k for k, o in OPTIONS.items() if o["type"] == "int"}


def schema():
    """The settings, in tab and section order, for the profile editor."""
    return {"tabs": TABS, "options": [OPTIONS[key] for key, *_ in _RAW],
            "note": "Blank fields inherit the chosen preset. Names and choices match OrcaSlicer's own option table; the engine applies its own limits when it slices."}


def _number(key, value, lo, hi):
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key} needs a number")
    if not math.isfinite(n) or not lo <= n <= hi:
        raise ValueError(f"{key} must be between {lo:g} and {hi:g}")
    return n


def validate(key, value):
    """One setting, checked and written the way an Orca preset file stores it."""
    option = OPTIONS.get(key)
    if option is None:
        raise ValueError(f"Unsupported print setting: {key}")
    kind = option["type"]
    if kind == "bool":
        if isinstance(value, bool):
            return "1" if value else "0"
        if str(value) in ("0", "1"):
            return str(value)
        raise ValueError(f"{key} must be on or off")
    if kind == "enum":
        if value in option["choices"]:
            return value
        raise ValueError(f"{key} must be one of: {', '.join(option['choices'])}")
    if kind == "percent":
        if key == "sparse_infill_density":
            try:
                n = float(str(value).rstrip("%"))
            except (TypeError, ValueError):
                raise ValueError("Infill must be a percentage")
            if not math.isfinite(n) or not 0 <= n <= 100:
                raise ValueError("Infill must be between 0 and 100%")
            return f"{n:g}%"
        n = _number(key, str(value).rstrip("%"), option["min"], option["max"])
        return f"{n:g}%"
    if kind == "speed_or_percent":
        text = str(value).strip()
        if text.endswith("%"):
            n = _number(key, text[:-1], 1, 1000)
            return f"{n:g}%"
        n = _number(key, text, option["min"], option["max"])
        return f"{n:g}"
    n = _number(key, value, option["min"], option["max"])
    if key in WHOLE and not n.is_integer():
        if key in ("wall_loops", "top_shell_layers", "bottom_shell_layers", "skirt_loops"):
            raise ValueError("Wall and shell counts must be whole numbers")
        raise ValueError(f"{key} must be a whole number")
    return str(int(n) if n.is_integer() else n)
