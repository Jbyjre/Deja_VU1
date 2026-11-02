"""
colour_map.py
=============

Puts a multi-colour project's colours onto the U1's four heads.

A project from MakerWorld (Bambu Studio), NexPrint (Elegoo Slicer),
OrcaSlicer, Creality Print, Anycubic Slicer Next, QIDI Studio or another
slicer of that family, or from Printables (PrusaSlicer), can name more
filaments than the U1 has heads: an AMS project often lists eight while the
model uses three, and a painted model can really use five or six. This
module reads which filaments the model actually uses (each object's and
part's filament, the per-feature filament settings, height-range modifiers
and the colour painted onto triangles), suggests which head each one goes
to, and writes a copy of the project that uses at most four.

The suggestion:
  * filaments nothing uses are dropped;
  * four or fewer used filaments each get their own head, in their order;
  * more than four are grouped by how alike they look (distance in the
    OKLab colour space, which follows how people see colour), never putting
    two different materials on one head while another grouping exists;
  * or, when a printer is connected, each colour goes to the head whose
    loaded filament is closest to it.
The person can change any of it before saving.

How the slicers store colour (read from OrcaSlicer's source, which reads
both its own and PrusaSlicer's layout - Format/bbs_3mf.cpp, Format/3mf.cpp,
Model.cpp FacetsAnnotation and TriangleSelector.cpp serialize/deserialize,
commit 97e6c71 of 28 Oct 2026):
  * Orca family: Metadata/project_settings.config (JSON lists, one entry per
    filament), Metadata/model_settings.config (<metadata key="extruder"> on
    each object and part, 1-based), Metadata/layer_config_ranges.xml and the
    "paint_color" attribute on each painted triangle.
  * PrusaSlicer: Metadata/Slic3r_PE_model.config (<metadata type="object"
    key="extruder">) and the "slic3rpe:mmu_segmentation" attribute. Orca
    loads these files with their geometry, paint and extruder numbers but
    keeps its own printer and filament settings, so only those two are
    rewritten here.
  * Painted triangles: a string of hex digits, read from the end, each digit
    one 4-bit code. A code whose low two bits are 0 is a leaf; its high two
    bits are the state (0 = the part's own filament, 1 and 2 = filaments 1
    and 2), or 3, meaning the next digit holds state - 3 (digit F: the digit
    after that holds state - 18). Any other code splits the triangle into
    (low bits + 1) children, which follow. Only the states are changed here;
    the splits are copied as they are.
"""

import io
import json
import math
import re
import shutil
import zipfile

import safe_zip

HEADS = 4
MAX_FILAMENTS = 64
PROJECT_CONFIG = "Metadata/project_settings.config"
MODEL_SETTINGS = "Metadata/model_settings.config"
LAYER_RANGES = "Metadata/layer_config_ranges.xml"
PRUSA_CONFIG = "Metadata/Slic3r_PE.config"
PRUSA_MODEL = "Metadata/Slic3r_PE_model.config"
_PART_LIMIT = 256 * 1024 * 1024

# Settings that name a filament by number. 0 means "the object's own".
# (OrcaSlicer PrintConfig.cpp; the legacy names are renamed on load there.)
FEATURE_KEYS = ("extruder", "support_filament", "support_interface_filament", "wipe_tower_filament",
                "sparse_infill_filament_id", "internal_solid_filament_id", "top_surface_filament_id",
                "bottom_surface_filament_id", "outer_wall_filament_id", "inner_wall_filament_id")
# Older names whose "1" meant "default" (Orca turns that "1" into 0 on load,
# so a "1" is left alone and only other numbers are moved).
LEGACY_KEYS = ("sparse_infill_filament", "solid_infill_filament", "top_solid_infill_filament",
               "bottom_solid_infill_filament", "wall_filament", "inner_wall_filament", "outer_wall_filament",
               "infill_extruder", "solid_infill_extruder", "perimeter_extruder")

# Per-filament settings whose names don't start with "filament_".
_FILAMENT_KEYS = {
    "default_filament_colour", "nozzle_temperature", "nozzle_temperature_initial_layer",
    "nozzle_temperature_range_low", "nozzle_temperature_range_high", "hot_plate_temp",
    "hot_plate_temp_initial_layer", "cool_plate_temp", "cool_plate_temp_initial_layer", "eng_plate_temp",
    "eng_plate_temp_initial_layer", "textured_plate_temp", "textured_plate_temp_initial_layer",
    "supertack_plate_temp", "supertack_plate_temp_initial_layer", "textured_cool_plate_temp",
    "textured_cool_plate_temp_initial_layer", "temperature_vitrification", "fan_min_speed", "fan_max_speed",
    "fan_cooling_layer_time", "slow_down_layer_time", "slow_down_min_speed", "slow_down_for_layer_cooling",
    "close_fan_the_first_x_layers", "full_fan_speed_layer", "overhang_fan_speed", "overhang_fan_threshold",
    "additional_cooling_fan_speed", "reduce_fan_stop_start_freq", "required_nozzle_HRC",
    "chamber_temperature", "chamber_temperatures", "activate_chamber_temp_control", "activate_air_filtration",
    "during_print_exhaust_fan_speed", "complete_print_exhaust_fan_speed", "enable_overhang_bridge_fan",
    "dont_slow_down_outer_wall", "compatible_prints", "compatible_prints_condition", "inherits",
}


class ColourMapError(ValueError):
    """The project can't be mapped; the message says why in plain words."""


# ---------------------------------------------------------------------------
# Colour
# ---------------------------------------------------------------------------

_HEX = re.compile(r"#?([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?")


def clean_hex(value):
    m = _HEX.fullmatch(str(value or "").strip())
    return f"#{m.group(1).upper()}" if m else None


def oklab(hex_colour):
    """(L, a, b) of an sRGB colour (Björn Ottosson's OKLab, 2020)."""
    h = clean_hex(hex_colour) or "#808080"
    rgb = [int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    r, g, b = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    l_ = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m_ = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s_ = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_)


def distance(c1, c2):
    """How different two colours look: 0 is the same, about 0.02 is barely visible, 1 is black to white."""
    a, b = oklab(c1), oklab(c2)
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


# OKLab hue angles: red is near 30 degrees, yellow 110, green 140, blue 265.
_HUES = ((40, "red"), (75, "orange"), (115, "yellow"), (170, "green"), (225, "teal"), (285, "blue"),
         (345, "purple"), (361, "red"))


def colour_name(hex_colour):
    """A plain name for a colour ("dark blue", "light grey"), for reports."""
    h = clean_hex(hex_colour)
    if not h:
        return "no colour"
    lum, a, b = oklab(h)
    chroma = math.hypot(a, b)
    if chroma < 0.035:
        if lum > 0.93:
            return "white"
        if lum < 0.25:
            return "black"
        return "light grey" if lum > 0.7 else "dark grey" if lum < 0.45 else "grey"
    hue = math.degrees(math.atan2(b, a)) % 360
    name = next(n for limit, n in _HUES if hue < limit)
    if name == "red" and lum > 0.75:
        return "pink"
    if name == "purple" and lum > 0.6 and hue > 310:
        return "magenta"
    if name in ("orange", "yellow") and lum < 0.55:
        return "brown"
    if lum < 0.42:
        return "dark " + name
    if lum > 0.86 and chroma < 0.1:
        return "light " + name
    return name


# ---------------------------------------------------------------------------
# Painted triangles
# ---------------------------------------------------------------------------

def _nibbles(text):
    try:
        return [int(c, 16) for c in reversed(text.strip())]
    except ValueError:
        return None


def paint_states(text):
    """The set of states painted in one triangle's string, or None if it can't be read."""
    nib = _nibbles(text)
    if nib is None:
        return None
    states = set()
    if _walk(nib, lambda s: states.add(s) or s) is None:
        return None
    return states


def remap_paint(text, table):
    """
    One triangle's paint string with each state passed through table(state).
    Returns "" when nothing is painted any more, the input unchanged if it
    can't be read (Orca drops such a triangle's paint on load anyway).
    """
    nib = _nibbles(text)
    if nib is None:
        return text
    out = _walk(nib, table)
    if out is None:
        return text
    if all(c == 0 for c in out):
        return ""
    return "".join("0123456789ABCDEF"[c] for c in reversed(out))


def _walk(nib, table):
    out = []
    i, n = 0, len(nib)
    while i < n:
        pending = 1
        while pending:
            if i >= n:
                return None
            code = nib[i]
            i += 1
            pending -= 1
            sides = code & 3
            if sides:
                if (code >> 2) == 3 and sides != 3:
                    return None
                out.append(code)
                pending += sides + 1
                continue
            state = code >> 2
            if state == 3:
                if i >= n:
                    return None
                state = nib[i] + 3
                i += 1
                if state == 18:
                    if i >= n:
                        return None
                    state = nib[i] + 18
                    i += 1
            state = table(state)
            if state < 3:
                out.append(state << 2)
            elif state <= 17:
                out += [0xC, state - 3]
            else:
                out += [0xC, 0xF, min(15, state - 18)]
    return out


_PAINT_ATTR = {"orca": b"paint_color", "prusa": b"slic3rpe:mmu_segmentation"}


def _paint_re(fmt):
    return re.compile(rb'(\s' + re.escape(_PAINT_ATTR[fmt]) + rb'=")([0-9A-Fa-f]*)(")')


# ---------------------------------------------------------------------------
# Reading a project
# ---------------------------------------------------------------------------

_SOURCES = (
    ("bambustudio", "MakerWorld / Bambu Studio"), ("orcaslicer", "OrcaSlicer"),
    ("elegooslicer", "NexPrint / Elegoo Slicer"), ("crealityprint", "Creality Print"),
    ("creality", "Creality Print"), ("anycubic", "Anycubic Slicer Next"), ("qidi", "QIDI Studio"),
    ("flashforge", "Flashforge Orca"), ("orca-flashforge", "Flashforge Orca"), ("snapmaker", "Snapmaker Orca"),
    ("prusaslicer", "Printables / PrusaSlicer"), ("superslicer", "SuperSlicer"),
)


def source_label(application, fmt):
    app = (application or "").lower().replace(" ", "")
    for key, label in _SOURCES:
        if app.startswith(key):
            return label
    if fmt == "prusa":
        return "a PrusaSlicer-style project"
    return f"an OrcaSlicer-family slicer ({application})" if application else "an OrcaSlicer-family slicer"


_APP_RE = re.compile(rb'<metadata\s+name="Application"\s*>([^<]{0,200})</metadata>')


def _application(archive):
    for name in ("3D/3dmodel.model",):
        if name in archive.namelist():
            with safe_zip.open_part(archive, name, limit=_PART_LIMIT) as fh:
                head = fh.read(64 * 1024)
            m = _APP_RE.search(head)
            if m:
                return m.group(1).decode("utf-8", "replace").strip()
    return ""


def _as_list(value):
    if isinstance(value, list):
        return value
    return [value] if value not in (None, "") else []


def _int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _prusa_ini(text):
    out = {}
    for line in text.splitlines():
        if line.startswith("; ") and " = " in line:
            k, v = line[2:].split(" = ", 1)
            out[k.strip()] = v
    return out


_TAG_RE = re.compile(rb"<metadata\b[^>]*?/?>")
_ATTR_RE = re.compile(rb'(\w[\w:.-]*)="([^"]*)"')
_RANGE_RE = re.compile(rb'(<option\s+opt_key="(\w+)"\s*>)(\s*\d+\s*)(</option>)')


def _metadata_numbers(xml, keys):
    """Every (key, number) a model-settings file assigns for the given keys."""
    found = []
    for m in _TAG_RE.finditer(xml):
        attrs = dict(_ATTR_RE.findall(m.group(0)))
        key = attrs.get(b"key", b"").decode("ascii", "replace")
        if key in keys:
            n = _int(attrs.get(b"value", b"").decode("ascii", "replace"))
            if n is not None:
                found.append((key, n))
    return found


def read(data):
    """
    What a project's colours are and which the model uses.

    Returns {"format": "orca"|"prusa", "application", "source_label",
             "filaments": [{"n", "colour", "name", "type", "used", "painted"}], "objects": int}.
    """
    try:
        archive = safe_zip.open_archive(data, "3MF project")
    except safe_zip.DamagedArchive as exc:
        raise ColourMapError(f"This isn't a readable 3MF file: {exc}")
    with archive:
        names = set(archive.namelist())
        application = _application(archive)
        if PROJECT_CONFIG in names:
            fmt = "orca"
        elif PRUSA_MODEL in names or PRUSA_CONFIG in names:
            fmt = "prusa"
        else:
            raise ColourMapError("This 3MF holds a model with no slicer project in it, so it names no filaments. "
                                 "Open it in Snapmaker Orca and pick the colours there")
        colours, types, names_ = [], [], []
        if fmt == "orca":
            config = _load_json(archive)
            colours = [clean_hex(c) for c in _as_list(config.get("filament_colour"))]
            types = [str(t or "") for t in _as_list(config.get("filament_type"))]
            names_ = [str(t or "") for t in _as_list(config.get("filament_settings_id"))]
            count = len(colours) or max(len(types), 1)
        else:
            ini = {}
            if PRUSA_CONFIG in names:
                raw = safe_zip.read(archive, PRUSA_CONFIG, limit=16 * 1024 * 1024)
                ini = _prusa_ini(raw.decode("utf-8", "replace"))
            ext = [clean_hex(c) for c in ini["extruder_colour"].split(";")] if ini.get("extruder_colour") else []
            fil = [clean_hex(c) for c in ini["filament_colour"].split(";")] if ini.get("filament_colour") else []
            count = max(len(ext), len(fil), 1)
            colours = [(ext[i] if i < len(ext) and ext[i] else None) or (fil[i] if i < len(fil) else None)
                       for i in range(count)]
            types = ini.get("filament_type", "").split(";") if ini.get("filament_type") else []
            names_ = [s.strip('"') for s in ini.get("filament_settings_id", "").split(";")] \
                if ini.get("filament_settings_id") else []
        usage = _usage(archive, fmt, names)
        count = min(MAX_FILAMENTS, max(count, max(usage["used"] or {1})))
        if fmt == "orca":
            usage["used"] |= {n for n in _config_numbers(config) if n > 0}
        filaments = []
        for i in range(count):
            n = i + 1
            colour = colours[i] if i < len(colours) else None
            filaments.append({"n": n, "colour": colour, "name": colour_name(colour),
                              "type": (types[i] if i < len(types) else (types[0] if types else "")).strip().upper(),
                              "preset": names_[i] if i < len(names_) else "",
                              "used": n in usage["used"], "painted": usage["painted"].get(n, 0)})
        return {"format": fmt, "application": application, "source_label": source_label(application, fmt),
                "filaments": filaments, "objects": usage["objects"], "unreadable_paint": usage["bad"]}


def _load_json(archive):
    try:
        config = json.loads(safe_zip.read(archive, PROJECT_CONFIG, limit=64 * 1024 * 1024, what="3MF project"))
    except safe_zip.DamagedArchive as exc:
        raise ColourMapError(str(exc))
    except (ValueError, UnicodeDecodeError):
        raise ColourMapError("The project's settings file is damaged and can't be read")
    if not isinstance(config, dict):
        raise ColourMapError("The project's settings must be an object, not a list or a single value")
    return config


def _config_numbers(config):
    out = []
    for key in FEATURE_KEYS:
        n = _int(config.get(key))
        if n is not None:
            out.append(n)
    for key in LEGACY_KEYS:
        n = _int(config.get(key))
        if n is not None and n > 1:
            out.append(n)
    return out


def _model_parts(names):
    return sorted(n for n in names if n.startswith("3D/") and n.lower().endswith(".model"))


def _usage(archive, fmt, names):
    used, painted, objects, bad = set(), {}, 0, 0
    settings = MODEL_SETTINGS if fmt == "orca" else PRUSA_MODEL
    keys = set(FEATURE_KEYS) | set(LEGACY_KEYS) if fmt == "orca" else {"extruder"}
    if settings in names:
        xml = safe_zip.read(archive, settings, limit=64 * 1024 * 1024)
        objects = len(re.findall(rb"<object\b", xml))
        for key, n in _metadata_numbers(xml, keys):
            if n > 0 and not (key in LEGACY_KEYS and n == 1):
                used.add(n)
        # An object with no filament of its own prints with filament 1.
        for block in re.findall(rb"<object\b.*?</object>", xml, re.S):
            if not any(k == "extruder" and n > 0 for k, n in _metadata_numbers(block, {"extruder"})):
                used.add(1)
    else:
        used.add(1)
    if fmt == "orca" and LAYER_RANGES in names:
        for m in _RANGE_RE.finditer(safe_zip.read(archive, LAYER_RANGES, limit=16 * 1024 * 1024)):
            if m.group(2).decode() in keys:
                n = _int(m.group(3).decode())
                if n and n > 0:
                    used.add(n)
    pattern = _paint_re(fmt)
    for part in _model_parts(names):
        body = safe_zip.read(archive, part, limit=_PART_LIMIT)
        if _PAINT_ATTR[fmt] not in body:
            continue
        for m in pattern.finditer(body):
            states = paint_states(m.group(2).decode("ascii"))
            if states is None:
                bad += 1
                continue
            for s in states:
                if s > 0:
                    used.add(s)
                    painted[s] = painted.get(s, 0) + 1
    return {"used": used, "painted": painted, "objects": objects, "bad": bad}


# ---------------------------------------------------------------------------
# Suggesting heads
# ---------------------------------------------------------------------------

def _material(f):
    t = (f.get("type") or "PLA").upper()
    return re.split(r"[\s+-]", t)[0] or "PLA"


def suggest(filaments, loaded=None, heads=HEADS):
    """
    Which head (0..heads-1) each filament goes to, or None for unused ones.

    loaded: optional [{"colour", "type"}] per head, what the printer has in
    it now; each colour then goes to the closest of those.
    """
    used = [f for f in filaments if f.get("used")]
    plan = [None] * len(filaments)
    if loaded and any(clean_hex(h.get("colour")) for h in loaded):
        for f in used:
            best, score = 0, None
            for h, head in enumerate(loaded[:heads]):
                c = clean_hex(head.get("colour"))
                if not c:
                    continue
                same = not head.get("type") or _material(head) == _material(f)
                d = distance(f.get("colour"), c) + (0 if same else 1.0)
                if score is None or d < score:
                    best, score = h, d
            plan[f["n"] - 1] = best
        return plan
    groups = [[f] for f in used]
    while len(groups) > heads:
        best = None
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                pairs = [(a, b) for a in groups[i] for b in groups[j]]
                d = sum(distance(a.get("colour"), b.get("colour")) for a, b in pairs) / len(pairs)
                if any(_material(a) != _material(b) for a, b in pairs):
                    d += 10.0
                if best is None or d < best[0]:
                    best = (d, i, j)
        _, i, j = best
        groups[i] = groups[i] + groups[j]
        del groups[j]
    groups.sort(key=lambda g: min(f["n"] for f in g))
    for h, group in enumerate(groups):
        for f in group:
            plan[f["n"] - 1] = h
    return plan


def check_plan(filaments, plan, heads=HEADS):
    if not isinstance(plan, list) or len(plan) != len(filaments):
        raise ColourMapError(f"Give a head for each of the {len(filaments)} filaments (or leave unused ones empty)")
    out = []
    for f, h in zip(filaments, plan):
        if h is None or h == "":
            if f.get("used"):
                raise ColourMapError(f"Filament {f['n']} ({f['name']}) is used by the model, so it needs a head")
            out.append(None)
            continue
        h = _int(h)
        if h is None or not 0 <= h < heads:
            raise ColourMapError(f"Head numbers go from 1 to {heads}")
        out.append(h)
    if not any(h is not None for h in out):
        raise ColourMapError("Give at least one filament a head")
    return out


def describe(filaments, plan):
    """What each head gets: [{"head", "colour", "name", "type", "from": [n...]}], plus warnings."""
    heads, warnings = {}, []
    for f, h in zip(filaments, plan):
        if h is None:
            continue
        heads.setdefault(h, []).append(f)
    out = []
    for h in sorted(heads):
        group = heads[h]
        lead = max(group, key=lambda f: (f.get("used"), f.get("painted", 0), -f["n"]))
        out.append({"head": h, "toolhead": f"T{h}", "colour": lead.get("colour"), "name": lead.get("name"),
                    "type": lead.get("type"), "from": [f["n"] for f in group]})
        mats = sorted({_material(f) for f in group})
        if len(mats) > 1:
            warnings.append(f"Head {h + 1} gets different materials ({', '.join(mats)}). They need different "
                            "temperatures, so choose another head for one of them")
        if len(group) > 1:
            names = ", ".join(f"{f['n']} ({f['name']})" for f in group)
            warnings.append(f"Head {h + 1} prints filaments {names} in one colour: {lead.get('name')}, "
                            "the one painted most")
    return out, warnings


# ---------------------------------------------------------------------------
# Writing the mapped project
# ---------------------------------------------------------------------------

def apply(data, plan=None, loaded=None):
    """
    A copy of the project with its filaments on heads 1..K (K at most 4).
    Returns (new_bytes, report). plan: head per filament (0-based, None for
    unused), or None for the suggestion.
    """
    info = read(data)
    filaments = info["filaments"]
    plan = suggest(filaments, loaded) if plan is None else check_plan(filaments, plan)
    heads, warnings = describe(filaments, plan)
    # Filament slot k is head k (the U1's heads are fixed places), so a plan
    # using heads 1, 2 and 4 keeps four slots; slot 3 gets a stand-in.
    count = max(h["head"] for h in heads) + 1
    rep = {h["head"]: h["from"] for h in heads}
    # source filament (1-based) -> slot (1-based); 0 stays 0 (the object's own).
    table = {f["n"]: plan[i] + 1 for i, f in enumerate(filaments) if plan[i] is not None}
    first_used = next((h["from"][0] for h in heads), 1)
    remap = lambda n: 0 if n <= 0 else table.get(n, table.get(first_used, 1))
    unused = [f["n"] for f, h in zip(filaments, plan) if h is None]
    filler = [h for h in range(count) if h not in rep]
    if filler:
        warnings.append("Nothing goes to head " + ", ".join(str(h + 1) for h in filler)
                        + "; its slot keeps filament 1's settings so the heads after it stay in place")

    archive = safe_zip.open_archive(data, "3MF project")
    replaced = {}
    with archive:
        names = set(archive.namelist())
        if info["format"] == "orca":
            config = _load_json(archive)
            replaced[PROJECT_CONFIG] = json.dumps(
                _map_config(config, len(filaments), count, rep, remap, heads), indent=4, ensure_ascii=False).encode()
            if MODEL_SETTINGS in names:
                replaced[MODEL_SETTINGS] = _map_settings(safe_zip.read(archive, MODEL_SETTINGS, limit=64 * 1024 * 1024),
                                                         set(FEATURE_KEYS) | set(LEGACY_KEYS), remap, len(filaments),
                                                         count, rep)
            if LAYER_RANGES in names:
                replaced[LAYER_RANGES] = _map_ranges(safe_zip.read(archive, LAYER_RANGES, limit=16 * 1024 * 1024),
                                                     remap)
        elif PRUSA_MODEL in names:
            replaced[PRUSA_MODEL] = _map_settings(safe_zip.read(archive, PRUSA_MODEL, limit=64 * 1024 * 1024),
                                                  {"extruder"}, remap, len(filaments), count, rep)
        pattern = _paint_re(info["format"])
        for part in _model_parts(names):
            body = safe_zip.read(archive, part, limit=_PART_LIMIT)
            if _PAINT_ATTR[info["format"]] in body:
                replaced[part] = _map_paint(body, pattern, remap)
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
            for item in archive.infolist():
                name = item.filename
                if re.match(r"Metadata/plate_\d+\.gcode(\.md5)?$", name) or name == "Metadata/slice_info.config":
                    continue
                if name in replaced:
                    target.writestr(item, replaced[name])
                elif item.is_dir():
                    target.writestr(item, b"")
                else:
                    entry = zipfile.ZipInfo(name, item.date_time)
                    entry.compress_type = zipfile.ZIP_DEFLATED
                    with safe_zip.open_part(archive, name, limit=_PART_LIMIT) as src, target.open(entry, "w") as dst:
                        shutil.copyfileobj(src, dst, 1024 * 1024)
    if info["unreadable_paint"]:
        warnings.append(f"{info['unreadable_paint']} painted triangles couldn't be read and were left as they were")
    if info["format"] == "prusa":
        warnings.append("Snapmaker Orca opens PrusaSlicer projects with its own filament colours. Set each head's "
                        "colour to the one listed here (or load those colours in the printer and slice in Deja Vu1)")
    report = {"format": info["format"], "source_label": info["source_label"], "application": info["application"],
              "filaments": filaments, "plan": plan, "heads": heads, "dropped": unused, "warnings": warnings,
              "count_before": len(filaments), "count_after": count,
              "summary": _summary(filaments, heads, unused)}
    return out.getvalue(), report


def _summary(filaments, heads, unused):
    used = sum(1 for f in filaments if f.get("used"))
    parts = [f"{used} colour{'s' if used != 1 else ''} used on {len(heads)} head{'s' if len(heads) != 1 else ''}"]
    if unused:
        parts.append(f"{len(unused)} unused filament{'s' if len(unused) != 1 else ''} removed")
    return "; ".join(parts)


def _pick(values, count, rep, width=1):
    """A per-filament list cut down to `count` slots, each slot taking its group's lead filament."""
    out = []
    for h in range(count):
        src = rep.get(h, [1])[0] - 1
        out.extend(values[src * width:(src + 1) * width])
    return out


def _map_config(config, n, count, rep, remap, heads):
    new = dict(config)
    extruders = len(_as_list(config.get("nozzle_diameter")))
    for key, value in config.items():
        if not isinstance(value, list):
            continue
        per_filament = key.startswith("filament_") or key in _FILAMENT_KEYS
        if len(value) == n and n > 0 and (per_filament or n != extruders):
            new[key] = _pick(value, count, rep)
    for key in ("inherits_group", "different_settings_to_system"):
        value = config.get(key)
        if isinstance(value, list) and len(value) == n + 2:
            new[key] = value[:1] + _pick(value[1:-1], count, rep) + value[-1:]
    vec = config.get("flush_volumes_vector")
    if isinstance(vec, list) and len(vec) == 2 * n:
        new["flush_volumes_vector"] = _pick(vec, count, rep, width=2)
    mat = config.get("flush_volumes_matrix")
    if isinstance(mat, list) and len(mat) == n * n:
        def flush(a, b):
            vals = []
            for i in rep.get(a, [1]):
                for j in rep.get(b, [1]):
                    try:
                        vals.append(float(mat[(i - 1) * n + (j - 1)]))
                    except (TypeError, ValueError):
                        pass
            return max(vals) if vals else 0.0
        new["flush_volumes_matrix"] = [_fmt(0 if a == b else flush(a, b)) for a in range(count) for b in range(count)]
    elif isinstance(mat, list) and len(mat) != count * count:
        new.pop("flush_volumes_matrix", None)
    colours = _pick([c or "#FFFFFF" for c in _as_list(config.get("filament_colour"))] or ["#FFFFFF"] * n, count, rep)
    for h in heads:
        if h["colour"]:
            colours[h["head"]] = h["colour"]
    new["filament_colour"] = colours
    for key in FEATURE_KEYS:
        n_ = _int(config.get(key))
        if n_ is not None:
            new[key] = str(remap(n_)) if isinstance(config.get(key), str) else remap(n_)
    for key in LEGACY_KEYS:
        n_ = _int(config.get(key))
        if n_ is not None and n_ > 1:
            new[key] = str(remap(n_)) if isinstance(config.get(key), str) else remap(n_)
    return new


def _fmt(v):
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def _map_settings(xml, keys, remap, n, count, rep):
    def tag(m):
        text = m.group(0)
        attrs = dict(_ATTR_RE.findall(text))
        key = attrs.get(b"key", b"").decode("ascii", "replace")
        value = attrs.get(b"value")
        if value is None:
            return text
        if key in keys:
            num = _int(value.decode("ascii", "replace"))
            if num is None or (key in LEGACY_KEYS and num <= 1):
                return text
            new = str(remap(num)).encode()
        elif key == "filament_maps":
            parts = value.decode("ascii", "replace").split()
            if len(parts) != n:
                return text
            new = " ".join(_pick(parts, count, rep)).encode()
        else:
            return text
        return text.replace(b'value="' + value + b'"', b'value="' + new + b'"', 1)
    return _TAG_RE.sub(tag, xml)


def _map_ranges(xml, remap):
    def opt(m):
        if m.group(2).decode() not in FEATURE_KEYS:
            return m.group(0)
        num = _int(m.group(3).decode())
        if num is None:
            return m.group(0)
        return m.group(1) + str(remap(num)).encode() + m.group(4)
    return _RANGE_RE.sub(opt, xml)


def _map_paint(body, pattern, remap):
    cache = {}

    def one(m):
        old = m.group(2)
        new = cache.get(old)
        if new is None:
            new = cache[old] = remap_paint(old.decode("ascii"), remap).encode()
        if not new:
            return b""
        return m.group(1) + new + m.group(3)
    return pattern.sub(one, body)


def mapped_name(filename):
    stem = filename[:-4] if filename.lower().endswith(".3mf") else filename
    stem = re.sub(r" \(U1 colours\)$", "", stem)
    return f"{stem} (U1 colours).3mf"
