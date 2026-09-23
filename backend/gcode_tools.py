"""
gcode_tools.py
==============

Reads a G-code print file the way the printer will: line by line, tracking
where the nozzle is, whether it is extruding, which toolhead is active and
what temperature was asked for. One pass produces everything the dashboard
needs from a file:

  - metadata the slicer wrote into its comments (time, grams, colours,
    materials, settings) and any embedded preview thumbnail
  - a pre-flight risk check: moves outside the U1's build volume, the
    nozzle below the bed, a toolhead the U1 doesn't have, travel moves
    below plastic that is already printed (a collision risk), and more
  - a down-sampled toolpath for the 3D viewer
  - small, validated edits: change one number, comment a line out, insert
    one command - never anything that can't be checked first

This is a reader, not a slicer or a simulator of the firmware. It checks
the coordinates actually written in the file; it cannot see inside Klipper
macros such as PRINT_START, which run on the printer.
"""

import math
import re

BUILD_X, BUILD_Y, BUILD_Z = 270.0, 270.0, 270.0   # Snapmaker U1, mm
# Snapmaker Orca's U1 profile places the printable area 0.5-270.5 by
# 1-271, so allow a little slack before calling an extrusion out of bounds.
BOUNDS_SLACK = 1.5
TRAVEL_SLACK = 5.0
VALID_TOOLS = {0, 1, 2, 3}
MAX_NOZZLE_C = 300
MAX_COMMAND_LENGTH = 200
MAX_SEGMENTS = 60000
FILAMENT_DIAMETER_MM = 1.75

# Typical published densities (g/cm^3) for common filaments. Used only when
# the slicer didn't already write the grams into the file.
DENSITY = {"PLA": 1.24, "PETG": 1.27, "ABS": 1.04, "ASA": 1.07, "TPU": 1.21,
           "PC": 1.20, "PA": 1.14, "PVA": 1.23}

_WORD = re.compile(r"([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))")
_KV = re.compile(r"^;\s*([A-Za-z0-9_ \[\]\(\)\-]+?)\s*[=:]\s*(.*)$")
_COMMAND_OK = re.compile(r"^[GMT]\d{1,4}(\.\d)?(\s+[A-Z][-+]?(\d+\.?\d*|\.\d+)?)*$")
_MACRO_OK = re.compile(r"^[A-Z_][A-Z0-9_]{1,60}(\s+[A-Z_][A-Z0-9_]*=[^\s;]{1,40})*$")
_FORBIDDEN = {"M112": "M112 is an emergency stop - it doesn't belong in a print file",
              "FIRMWARE_RESTART": "A firmware restart would abort the print",
              "RESTART": "A restart would abort the print"}


# ---------------------------------------------------------------------------
# Metadata the slicer writes into comments
# ---------------------------------------------------------------------------

def _duration_to_hours(text):
    """'1h 2m 3s', '2d 1h 5m', or a plain number of seconds."""
    text = text.strip()
    if re.fullmatch(r"\d+(\.\d+)?", text):
        return float(text) / 3600.0
    total = 0.0
    for amount, unit in re.findall(r"(\d+(?:\.\d+)?)\s*([dhms])", text):
        total += float(amount) * {"d": 86400, "h": 3600, "m": 60, "s": 1}[unit]
    return total / 3600.0 if total else None


def _split_list(value):
    return [v.strip() for v in re.split(r"[;,]", value) if v.strip()]


def parse_metadata(text):
    """Settings and summary figures the slicer left in comment lines."""
    settings = {}
    for line in text.splitlines():
        if not line.startswith(";"):
            continue
        match = _KV.match(line)
        if match:
            key = match.group(1).strip().lower()
            if key.startswith("thumbnail"):
                continue
            settings.setdefault(key, match.group(2).strip())

    meta = {"settings": settings}
    for key in ("estimated printing time (normal mode)", "estimated printing time",
                "model printing time", "total estimated time"):
        if key in settings:
            hours = _duration_to_hours(settings[key])
            if hours:
                meta["estimated_hours"] = round(hours, 3)
                break
    for key in ("total filament used [g]", "filament used [g]", "total filament weight [g]"):
        if key in settings:
            try:
                meta["filament_grams"] = round(sum(float(v) for v in _split_list(settings[key])), 2)
                break
            except ValueError:
                pass
    if "filament_type" in settings:
        meta["filament_types"] = _split_list(settings["filament_type"])
    for key in ("filament_colour", "filament_color", "extruder_colour"):
        if key in settings:
            meta["filament_colours"] = [c for c in _split_list(settings[key]) if c.startswith("#")]
            break
    for key in ("total layer number", "total layers count", "total_layer_count"):
        if key in settings and settings[key].isdigit():
            meta["layers"] = int(settings[key])
            break
    for key in ("layer_height", "nozzle_diameter", "printer_model", "printer_settings_id",
                "print_settings_id"):
        if key in settings:
            meta[key] = settings[key]
    return meta


def extract_thumbnail(text):
    """
    The largest embedded preview as a data: URI, or None. Orca, Prusa and
    Bambu slicers all write it as base64 PNG between
    '; thumbnail begin WxH LEN' and '; thumbnail end'.
    """
    best, current, size = None, None, 0
    for line in text.splitlines():
        stripped = line.strip()
        begin = re.match(r";\s*thumbnail(?:_PNG)?\s+begin\s+(\d+)x(\d+)", stripped)
        if begin:
            current, size = [], int(begin.group(1)) * int(begin.group(2))
            continue
        if current is not None:
            if re.match(r";\s*thumbnail(?:_PNG)?\s+end", stripped):
                if best is None or size > best[0]:
                    best = (size, "".join(current))
                current = None
            else:
                current.append(stripped.lstrip("; ").strip())
    if not best:
        return None
    return "data:image/png;base64," + best[1]


# ---------------------------------------------------------------------------
# The one pass over every move
# ---------------------------------------------------------------------------

def _words(code):
    return {letter.upper(): float(value) for letter, value in _WORD.findall(code)}


def analyze(text, want_toolpath=True):
    """
    Walk the whole file. Returns metadata, movement statistics, the
    pre-flight findings and (optionally) a toolpath for the 3D viewer.
    """
    meta = parse_metadata(text)
    pos = {"X": 0.0, "Y": 0.0, "Z": 0.0, "E": 0.0}
    absolute, abs_e = True, True
    tool = 0
    homed = False
    heated = False
    top_printed_z = 0.0
    layer_z = None
    layer_zs = set()
    seen_print_start = False

    findings = []
    counts = {}

    def flag(level, code, line_no, message):
        # Keep the list readable: report the first few of each kind, count the rest.
        counts[code] = counts.get(code, 0) + 1
        if counts[code] <= 5:
            findings.append({"level": level, "code": code, "line": line_no, "message": message})

    ext_min = [math.inf] * 3
    ext_max = [-math.inf] * 3
    filament_mm = {}
    travel_mm = 0.0
    time_s = 0.0
    feed = 3000.0
    segments = []
    line_count = 0

    for line_no, raw in enumerate(text.splitlines(), start=1):
        line_count = line_no
        code = raw.split(";", 1)[0].strip()
        if not code:
            continue
        upper = code.upper()
        head = upper.split()[0]

        if head.startswith("T") and head[1:].isdigit():
            tool = int(head[1:])
            if tool not in VALID_TOOLS:
                flag("error", "unknown_tool", line_no,
                     f"Asks for toolhead {head}; the U1 has T0-T3")
            continue
        if head == "PRINT_START":
            seen_print_start, homed, heated = True, True, True
            continue
        if head == "G28":
            homed = True
            continue
        if head == "G90":
            absolute = True
            continue
        if head == "G91":
            absolute = False
            continue
        if head == "M82":
            abs_e = True
            continue
        if head == "M83":
            abs_e = False
            continue
        if head in ("M104", "M109"):
            s = _words(upper[len(head):]).get("S")
            if s is not None:
                if s > MAX_NOZZLE_C:
                    flag("error", "nozzle_too_hot", line_no,
                         f"Sets the nozzle to {s:.0f}°C; this dashboard allows at most {MAX_NOZZLE_C}°C")
                if s >= 150:
                    heated = True
            continue
        if head == "G92":
            words = _words(upper[3:])
            for axis in ("X", "Y", "Z", "E"):
                if axis in words:
                    pos[axis] = words[axis]
            continue
        if head not in ("G0", "G1", "G2", "G3"):
            continue

        words = _words(upper[len(head):])
        if "F" in words and words["F"] > 0:
            feed = words["F"]
        start = dict(pos)
        for axis in ("X", "Y", "Z"):
            if axis in words:
                pos[axis] = words[axis] if absolute else pos[axis] + words[axis]
        extruding = False
        if "E" in words:
            e_delta = words["E"] - start["E"] if abs_e else words["E"]
            pos["E"] = words["E"] if abs_e else pos["E"] + words["E"]
            if e_delta > 0:
                extruding = True
                filament_mm[tool] = filament_mm.get(tool, 0.0) + e_delta

        dx, dy, dz = pos["X"] - start["X"], pos["Y"] - start["Y"], pos["Z"] - start["Z"]
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)
        if dist:
            time_s += dist / (feed / 60.0)
        if not homed and dist:
            flag("warning", "move_before_home", line_no,
                 "Moves before the printer is homed (no G28 or PRINT_START yet)")
            homed = True   # report once, not for every move after

        x, y, z = pos["X"], pos["Y"], pos["Z"]
        if extruding:
            if not heated:
                flag("warning", "cold_extrusion", line_no,
                     "Extrudes before any nozzle heating command")
                heated = True
            if z < -0.01:
                flag("error", "below_bed", line_no,
                     f"Extrudes at Z={z:.2f} - the nozzle would press into the bed")
            if not (-BOUNDS_SLACK <= x <= BUILD_X + BOUNDS_SLACK and
                    -BOUNDS_SLACK <= y <= BUILD_Y + BOUNDS_SLACK and z <= BUILD_Z):
                flag("error", "out_of_bounds", line_no,
                     f"Extrudes at X{x:.1f} Y{y:.1f} Z{z:.1f}, outside the U1's "
                     f"{BUILD_X:.0f} x {BUILD_Y:.0f} x {BUILD_Z:.0f} mm build volume")
            for i, v in enumerate((x, y, z)):
                ext_min[i] = min(ext_min[i], v)
                ext_max[i] = max(ext_max[i], v)
            if layer_z is None or abs(z - layer_z) > 1e-6:
                layer_z = z
                layer_zs.add(round(z, 3))
            top_printed_z = max(top_printed_z, z)
        else:
            travel_mm += math.hypot(dx, dy)
            if not (-TRAVEL_SLACK <= x <= BUILD_X + TRAVEL_SLACK and
                    -TRAVEL_SLACK <= y <= BUILD_Y + TRAVEL_SLACK and
                    z <= BUILD_Z + TRAVEL_SLACK):
                flag("warning", "travel_out_of_bounds", line_no,
                     f"Travels to X{x:.1f} Y{y:.1f} Z{z:.1f}, past the build volume - "
                     "Klipper stops the print on a move beyond its axis limits")
            if (dx or dy) and top_printed_z > 0.6 and z < top_printed_z - 0.45:
                flag("warning", "low_travel", line_no,
                     f"Travels at Z{z:.2f}, below plastic already printed up to "
                     f"Z{top_printed_z:.2f} - a collision risk")

        if want_toolpath and (dx or dy or dz):
            segments.append((round(start["X"], 2), round(start["Y"], 2), round(start["Z"], 2),
                             round(x, 2), round(y, 2), round(z, 2), tool, 1 if extruding else 0))

    has_extrusion = ext_min[0] != math.inf
    if not has_extrusion:
        flag("error", "no_extrusion", 0, "The file never extrudes plastic - nothing would print")
    if not seen_print_start:
        flag("warning", "no_print_start", 0,
             "No PRINT_START line. Snapmaker Orca's U1 profile starts every print with "
             "PRINT_START (homing, auto-feed, flow calibration); this file skips it")

    grams_by_tool = {}
    types = meta.get("filament_types") or []
    area = math.pi * (FILAMENT_DIAMETER_MM / 2) ** 2
    for t, length in filament_mm.items():
        material = (types[t] if t < len(types) else (types[0] if types else "PLA")).upper()
        density = DENSITY.get(material.split("-")[0], 1.24)
        grams_by_tool[f"T{t}"] = round(length * area * density / 1000.0, 2)

    for f in findings:
        extra = counts[f["code"]] - 5
        if extra > 0 and "more_like_this" not in f:
            f["more_like_this"] = extra

    errors = [f for f in findings if f["level"] == "error"]
    warnings = [f for f in findings if f["level"] == "warning"]
    result = {
        "meta": meta,
        "lines": line_count,
        "layers": meta.get("layers") or len(layer_zs),
        "bounds": ({"min": [round(v, 2) for v in ext_min], "max": [round(v, 2) for v in ext_max]}
                   if has_extrusion else None),
        "footprint_mm": ([round(ext_max[0] - ext_min[0], 1), round(ext_max[1] - ext_min[1], 1)]
                         if has_extrusion else None),
        "tools_used": sorted(f"T{t}" for t in filament_mm),
        "filament_mm": {f"T{t}": round(v, 1) for t, v in filament_mm.items()},
        "filament_grams_by_tool": grams_by_tool,
        "filament_grams": meta.get("filament_grams") or round(sum(grams_by_tool.values()), 2),
        "filament_grams_source": "slicer" if meta.get("filament_grams") else "estimated from extrusion length",
        "estimated_hours": meta.get("estimated_hours") or round(time_s / 3600.0, 3),
        "estimated_hours_source": ("slicer" if meta.get("estimated_hours")
                                   else "estimated from move lengths and feed rates"),
        "travel_mm": round(travel_mm, 1),
        "preflight": {
            "verdict": "blocked" if errors else ("check" if warnings else "clear"),
            "errors": errors,
            "warnings": warnings,
        },
    }
    if want_toolpath:
        result["toolpath"] = _downsample(segments)
    return result


def _downsample(segments):
    """Keep the viewer fast: at most MAX_SEGMENTS, spread evenly through the file."""
    total = len(segments)
    if total <= MAX_SEGMENTS:
        kept = segments
    else:
        step = total / MAX_SEGMENTS
        kept = [segments[int(i * step)] for i in range(MAX_SEGMENTS)]
    return {"segments": [list(s) for s in kept], "total_segments": total,
            "downsampled": total > MAX_SEGMENTS}


def preflight(text):
    return analyze(text, want_toolpath=False)["preflight"]


def required_filament(analysis):
    """What the file needs loaded, per toolhead, from its own metadata."""
    meta = analysis["meta"]
    colours = meta.get("filament_colours") or []
    types = meta.get("filament_types") or []
    out = []
    for tool in analysis["tools_used"]:
        i = int(tool[1:])
        out.append({
            "toolhead": tool,
            "expected_color_hex": (colours[i] if i < len(colours) else None),
            "expected_color_name": None,
            "expected_material": (types[i] if i < len(types) else (types[0] if types else None)),
            "grams": analysis["filament_grams_by_tool"].get(tool),
        })
    return out


# ---------------------------------------------------------------------------
# Viewing and small edits
# ---------------------------------------------------------------------------

def view_lines(text, offset=0, limit=200, query=None):
    lines = text.splitlines()
    offset = max(0, int(offset))
    limit = max(1, min(1000, int(limit)))
    if query:
        q = query.lower()
        hits = [i for i, line in enumerate(lines) if q in line.lower()]
        return {"total": len(lines), "matches": len(hits),
                "lines": [{"n": i + 1, "text": lines[i]} for i in hits[:limit]]}
    return {"total": len(lines), "offset": offset,
            "lines": [{"n": i + 1, "text": lines[i]} for i in range(offset, min(len(lines), offset + limit))]}


def validate_command(command):
    """
    Is this a single, well-formed command we'd be willing to put in a file?
    Returns the cleaned command or raises ValueError saying why not.
    """
    command = (command or "").strip()
    if not command:
        raise ValueError("The command is empty")
    if len(command) > MAX_COMMAND_LENGTH:
        raise ValueError("The command is too long")
    if "\n" in command or "\r" in command:
        raise ValueError("Insert one command at a time")
    body = command.split(";", 1)[0].strip().upper()
    head = body.split()[0] if body else ""
    if head in _FORBIDDEN:
        raise ValueError(_FORBIDDEN[head])
    if head in ("M117", "M118"):
        # Display / echo a message: free text is the whole point.
        if not command[len(head):].strip() or not command.isprintable():
            raise ValueError(f"{head} needs a short message to show")
        return command
    if not (_COMMAND_OK.match(body) or _MACRO_OK.match(body)):
        raise ValueError(f"'{command}' doesn't look like a G-code or Klipper command")
    if head.startswith("T") and head[1:].isdigit() and int(head[1:]) not in VALID_TOOLS:
        raise ValueError("The U1 has toolheads T0-T3")
    if head in ("M104", "M109"):
        s = _words(body[len(head):]).get("S")
        if s is not None and not 0 <= s <= MAX_NOZZLE_C:
            raise ValueError(f"Nozzle temperature must be 0-{MAX_NOZZLE_C}°C")
    return command


def apply_edit(text, edit):
    """
    Apply one small edit and return the new text. Edit kinds:
      {"kind": "set_value", "line": n, "param": "S", "value": 215}
      {"kind": "comment_out", "line": n}
      {"kind": "insert", "after_line": n, "command": "M117 Hello"}
    Line numbers are 1-based, as shown in the viewer.
    """
    lines = text.split("\n")
    kind = edit.get("kind")

    def line_index(key):
        try:
            n = int(edit.get(key))
        except (TypeError, ValueError):
            raise ValueError(f"'{key}' must be a line number")
        if not 1 <= n <= len(lines):
            raise ValueError(f"Line {n} doesn't exist (the file has {len(lines)} lines)")
        return n - 1

    if kind == "comment_out":
        i = line_index("line")
        if lines[i].lstrip().startswith(";"):
            raise ValueError("That line is already a comment")
        lines[i] = "; " + lines[i] + "  ; commented out in Deja Vu1"
    elif kind == "insert":
        i = line_index("after_line")
        command = validate_command(edit.get("command"))
        lines.insert(i + 1, command + "  ; inserted in Deja Vu1")
    elif kind == "set_value":
        i = line_index("line")
        param = str(edit.get("param") or "").upper()
        if not re.fullmatch(r"[A-Z]", param):
            raise ValueError("Pick one parameter letter, like S, F or Z")
        try:
            value = float(edit.get("value"))
        except (TypeError, ValueError):
            raise ValueError("The new value must be a number")
        code, sep, comment = lines[i].partition(";")
        head = code.strip().split()[0].upper() if code.strip() else ""
        if not re.fullmatch(r"[GM]\d+", head):
            raise ValueError("Only G and M command lines have values to change")
        # Only look at the parameters after the command word itself, so
        # changing "M" on "M104 S200" can never rewrite the command number.
        lead = code[:len(code) - len(code.lstrip())]
        head_text, _, rest = code.strip().partition(" ")
        pattern = re.compile(r"(?<![A-Za-z])" + param + r"[-+]?(\d+\.?\d*|\.\d+)", re.IGNORECASE)
        if not pattern.search(rest):
            raise ValueError(f"Line {i + 1} has no {param} value")
        if param == "F" and value <= 0:
            raise ValueError("A feed rate must be above zero")
        if head in ("M104", "M109") and param == "S" and not 0 <= value <= MAX_NOZZLE_C:
            raise ValueError(f"Nozzle temperature must be 0-{MAX_NOZZLE_C}°C")
        new_rest = pattern.sub(param + f"{value:g}", rest, count=1)
        trail = code[len(code.rstrip()):]
        lines[i] = lead + head_text + " " + new_rest + trail + (sep + comment if sep else "")
    else:
        raise ValueError("Unknown edit - use set_value, comment_out or insert")
    return "\n".join(lines)
