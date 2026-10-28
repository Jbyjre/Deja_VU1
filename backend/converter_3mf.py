"""
converter_3mf.py
================

One-click conversion of a print project downloaded from MakerWorld (Bambu
Lab's model site, whose projects are Bambu Studio 3MF files) or NexPrint
(Elegoo's model site, whose projects open in Elegoo Slicer / OrcaSlicer)
into a project that opens in Snapmaker Orca set up for the Snapmaker U1.

Why this works at all: Bambu Studio, OrcaSlicer, Elegoo Slicer and
Snapmaker Orca are one family of slicers (Orca forked Bambu Studio; the
other two fork Orca). They share the same 3MF project layout:

  3D/3dmodel.model                  the geometry (plus 3D/Objects/*.model)
  Metadata/model_settings.config    per-object and per-plate assignments
  Metadata/project_settings.config  every print, filament and printer setting (JSON)
  Metadata/plate_N.png              plate thumbnails

Only project_settings.config names a printer, so that is the one part this
converter rewrites. How it rewrites it follows what Snapmaker Orca's loader
does (PresetBundle.cpp / Preset.cpp, load_external_preset): for each of the
print, filament and printer sections, `inherits_group` names a built-in
parent profile and `different_settings_to_system` lists which settings the
project deliberately changed. Every setting NOT on that list is taken from
the parent profile. So the converter:

  printer  -> parent "Snapmaker U1 (<nozzle> nozzle)". Nothing kept from
              the old printer, so the U1's real bed size, start/end G-code
              and tool-change sequence all come from Snapmaker's profile.
  print    -> parent "<layer height> Standard @Snapmaker U1 (...)", keeping
              the settings the creator deliberately changed (infill, walls...)
              and their exact layer height.
  filament -> parent "Generic <material>" for the U1, keeping each colour.

The old printer's start/end G-code is also replaced with a comment, so even
a slicer without the U1 profile installed can't send another brand's start
sequence to a U1. Sliced G-code stored inside the project (MakerWorld
"print-ready" files) is removed: it was sliced for a different machine.

The profile names used below were read from Snapmaker's own profile folder
(github.com/Snapmaker/OrcaSlicer, resources/profiles/Snapmaker, commit
da53bc5, 22 Sep 2026). This converter has not yet been checked by opening
its output in Snapmaker Orca itself - that is listed as unverified.
"""

import io
import json
import re
import shutil
import zipfile
import math
from xml.parsers import expat

import colour_map
import safe_zip

CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
PROJECT_CONFIG = "Metadata/project_settings.config"

U1_PRINTABLE_AREA = ["0.5x1", "270.5x1", "270.5x271", "0.5x271"]
U1_PRINTABLE_HEIGHT = "270.05"
U1_TOOLHEADS = 4

# Snapmaker's "Standard" process profile per nozzle, by layer height.
U1_PROCESSES = {
    "0.2": {"0.12": "0.12mm Standard @Snapmaker U1 (0.2 nozzle)"},
    "0.4": {
        "0.08": "0.08mm Standard @Snapmaker U1 (0.4 nozzle)",
        "0.12": "0.12mm Standard @Snapmaker U1 (0.4 nozzle)",
        "0.16": "0.16mm Standard @Snapmaker U1 (0.4 nozzle)",
        "0.20": "0.20mm Standard @Snapmaker U1 (0.4 nozzle)",
        "0.24": "0.24mm Standard @Snapmaker U1 (0.4 nozzle)",
        "0.28": "0.28mm Standard @Snapmaker U1 (0.4 nozzle)",
    },
    "0.6": {
        "0.18": "0.18mm Standard @Snapmaker U1 (0.6 nozzle)",
        "0.24": "0.24mm Standard @Snapmaker U1 (0.6 nozzle)",
        "0.30": "0.30mm Standard @Snapmaker U1 (0.6 nozzle)",
    },
    "0.8": {
        "0.24": "0.24mm Standard @Snapmaker U1 (0.8 nozzle)",
        "0.32": "0.32mm Standard @Snapmaker U1 (0.8 nozzle)",
    },
}

# Generic filament profiles Snapmaker ships as compatible with each U1 nozzle.
U1_FILAMENTS = {
    "0.4": {"PLA": "Generic PLA", "PETG": "Generic PETG", "ABS": "Generic ABS",
            "ASA": "Generic ASA @U1 0.4 nozzle", "TPU": "Generic TPU", "PC": "Generic PC",
            "PA": "Generic PA", "PA-CF": "Generic PA-CF", "PLA-CF": "Generic PLA-CF",
            "PETG-CF": "Generic PETG-CF", "PETG-GF": "Generic PETG-GF", "PVA": "Generic PVA",
            "BVOH": "Generic BVOH", "PCTG": "Generic PCTG"},
    "0.2": {m: f"Generic {m} @U1 0.2 nozzle" for m in ("PLA", "PETG", "ABS", "ASA")},
    "0.6": {m: f"Generic {m} @U1 0.6 nozzle" for m in
            ("PLA", "PETG", "ABS", "ASA", "PC", "TPU", "PLA-CF", "PETG-CF", "PETG-GF")},
    "0.8": {m: f"Generic {m} @U1 0.8 nozzle" for m in
            ("PLA", "PETG", "ABS", "ASA", "PC", "TPU", "PLA-CF", "PETG-CF", "PETG-GF")},
}

_MACHINE_GCODE_KEYS = ("machine_start_gcode", "machine_end_gcode", "change_filament_gcode",
                       "before_layer_change_gcode", "layer_change_gcode", "time_lapse_gcode",
                       "machine_pause_gcode", "template_custom_gcode", "printing_by_object_gcode")


# Every way a conversion can fail, with a code to quote in a bug report,
# the stage it failed at, and a concrete recovery suggestion.
ERRORS = {
    "not_3mf":      ("CV-101", "Opening the file",
                     "Download the project again - the file may be incomplete, or it isn't a 3MF"),
    "no_model":     ("CV-102", "Reading the model",
                     "Re-save the project from its slicer, then try again"),
    "bad_model":    ("CV-103", "Reading the model",
                     "Open the project in its own slicer and save it again; the model part is damaged"),
    "bad_settings": ("CV-104", "Reading the print settings",
                     "Open the project in its own slicer and save it again; the settings part is damaged"),
    "damaged":      ("CV-105", "Reading the file",
                     "Download the project again - part of the archive can't be read safely"),
    "snapmaker":    ("CV-201", "Recognising the project",
                     "Nothing to do - open it straight in Snapmaker Orca"),
    "unsupported":  ("CV-202", "Recognising the project",
                     "Open the model in Snapmaker Orca and choose the Snapmaker U1 printer there"),
    "model_only":   ("CV-203", "Recognising the project",
                     "Open it directly in Snapmaker Orca and pick the Snapmaker U1 printer"),
}


class ConversionError(ValueError):
    """The file can't be converted; the message says why in plain words."""

    def __init__(self, message, kind="damaged"):
        super().__init__(message)
        self.code, self.stage, self.action = ERRORS.get(kind, ("CV-900", "Converting", ""))

    def as_dict(self):
        return {"error": str(self), "code": self.code, "stage": self.stage, "action": self.action}


class _Done(Exception):
    pass


def _read_application(archive):
    """
    The <metadata name="Application"> at the top of the model part. Read as
    a stream and stopped as soon as the metadata is over (it comes before
    the meshes), so a large model is never loaded to answer one question.
    """
    if "3D/3dmodel.model" not in archive.namelist():
        raise ConversionError("This 3MF has no 3D/3dmodel.model part, so it isn't a model project", "no_model")
    found, current = {}, {"name": None, "text": []}

    def start(name, attrs):
        tag = name.rsplit("}", 1)[-1]
        if tag == "metadata":
            current["name"], current["text"] = attrs.get("name"), []
        elif tag in ("resources", "build"):
            raise _Done()

    def end(name):
        if name.rsplit("}", 1)[-1] == "metadata" and current["name"] == "Application":
            found["application"] = "".join(current["text"]).strip()[:200]
            raise _Done()
        current["name"] = None

    def text(data):
        if current["name"] == "Application" and sum(map(len, current["text"])) < 200:
            current["text"].append(data)

    parser = expat.ParserCreate(namespace_separator="}")
    parser.StartElementHandler, parser.EndElementHandler, parser.CharacterDataHandler = start, end, text
    try:
        with safe_zip.open_part(archive, "3D/3dmodel.model", what="3MF project") as stream:
            parser.ParseFile(stream)
    except _Done:
        pass
    except safe_zip.DamagedArchive as exc:
        raise ConversionError(str(exc), "damaged")
    except expat.ExpatError:
        raise ConversionError("The 3MF's model part isn't valid XML", "bad_model")
    return found.get("application", "")


def detect_source(application, config, prusa=False):
    """Which ecosystem a project came from, judged from what it says about itself."""
    printer = str((config or {}).get("printer_model") or "")
    app = application.lower()
    if app.startswith("snapmaker") or printer.startswith("Snapmaker"):
        return "snapmaker"
    # OrcaSlicer writes the same project layout Snapmaker Orca reads (one
    # is a fork of the other), whichever printer the project was set up for.
    if app.startswith("orcaslicer"):
        return "orca"
    if app.startswith("bambustudio") or printer.startswith("Bambu Lab"):
        return "makerworld"
    if app.startswith("elegooslicer") or "elegoo" in printer.lower():
        return "nexprint"
    if prusa or app.startswith("prusaslicer") or app.startswith("superslicer"):
        return "prusa"
    # Creality Print, Anycubic Slicer Next, QIDI Studio, Flashforge Orca and
    # other forks write the same project_settings.config as Orca does.
    if config is not None and ("filament_colour" in config or "inherits_group" in config):
        return "orca_family"
    return "unknown"


def _nearest(options, value):
    return min(options, key=lambda k: abs(float(k) - value))


def _as_list(value):
    if isinstance(value, list):
        return value
    return [value] if value not in (None, "") else []


def _split_keys(text):
    return [k for k in re.split(r"[;,]", text or "") if k]


def convert(data, plan=None, loaded=None):
    """
    Convert project bytes. Returns (new_bytes, report). Raises
    ConversionError with a plain explanation when it can't.

    A project with more than four filaments (or a chosen plan) is first put
    onto the U1's four heads by colour_map; plan and loaded are passed on.
    """
    colour_report = None
    try:
        info = colour_map.read(data)
    except colour_map.ColourMapError:
        info = None
    if info and info["format"] == "prusa":
        return _convert_prusa(data, info, plan, loaded)
    if info and (len(info["filaments"]) > U1_TOOLHEADS or plan is not None):
        try:
            data, colour_report = colour_map.apply(data, plan, loaded)
        except colour_map.ColourMapError as exc:
            raise ConversionError(str(exc), "bad_settings")
    try:
        archive = safe_zip.open_archive(data, "3MF project")
    except safe_zip.DamagedArchive as exc:
        raise ConversionError(f"This isn't a readable 3MF file - {exc}", "not_3mf")

    application = _read_application(archive)
    config = None
    if PROJECT_CONFIG in archive.namelist():
        try:
            config = json.loads(safe_zip.read(archive, PROJECT_CONFIG, limit=64 * 1024 * 1024,
                                              what="3MF project"))
        except safe_zip.DamagedArchive as exc:
            raise ConversionError(str(exc), "damaged")
        except (ValueError, UnicodeDecodeError):
            raise ConversionError("The project's settings file is damaged and can't be read", "bad_settings")

    if config is not None and not isinstance(config,dict):
        raise ConversionError("The project's settings must be an object, not a list or a single value", "bad_settings")
    source = detect_source(application, config)
    if source == "snapmaker":
        raise ConversionError("This project is already set up for a Snapmaker printer - nothing to convert",
                              "snapmaker")
    if source == "unknown":
        raise ConversionError(
            "Projects from Bambu Studio, OrcaSlicer and its forks (Elegoo, Creality, Anycubic, QIDI) and "
            f"PrusaSlicer are supported. This file says it was made by '{application or 'an unnamed program'}'",
            "unsupported")
    if config is None:
        raise ConversionError(
            "This 3MF only contains the model, with no print settings to convert. Open it "
            "directly in Snapmaker Orca and pick the Snapmaker U1 printer", "model_only")

    report = {"source": source,
              "source_label": {"makerworld": "MakerWorld (Bambu Studio)",
                               "nexprint": "NexPrint (Elegoo Slicer)",
                               "orca": "OrcaSlicer"}.get(source) or colour_map.source_label(application, "orca"),
              "colours": colour_report,
              "application": application, "changes": [], "kept": [], "warnings": [],
              "unverified": ("Built from Snapmaker Orca's source code and profile files. Open it in "
                             "Snapmaker Orca to look over the plates before you print.")}
    new = dict(config)

    def change(key, value):
        old = new.get(key)
        if old != value:
            report["changes"].append({"setting": key, "from": old, "to": value})
        new[key] = value

    # -- nozzle and printer ---------------------------------------------------
    nozzles = _as_list(config.get("nozzle_diameter")) or ["0.4"]
    try:
        nozzle = f"{float(nozzles[0]):.1f}"
    except (ValueError,TypeError):
        raise ConversionError("The project has an unreadable nozzle diameter. Choose the fitted nozzle in its source slicer first", "bad_settings")
    if nozzle not in U1_PROCESSES:
        raise ConversionError(f"The U1 has no {nozzle} mm nozzle profile. Choose a supported fitted nozzle before converting", "bad_settings")
    if len(set(map(str,nozzles)))>1:
        report['warnings'].append('Different source nozzle sizes are retained. Choose a matching installed mixed-nozzle profile before slicing; this conversion does not implement different per-head layer heights')
    printer_preset = f"Snapmaker U1 ({nozzle} nozzle)"
    original_printer = config.get("printer_settings_id") or config.get("printer_model") or "unknown printer"
    report["original_printer"] = original_printer

    change("printer_model", "Snapmaker U1")
    change("printer_variant", nozzle)
    change("printer_settings_id", printer_preset)
    change("printable_area", list(U1_PRINTABLE_AREA))
    change("printable_height", U1_PRINTABLE_HEIGHT)
    change("printer_notes", f"Converted by Deja Vu1 from {report['source_label']} ({original_printer})")
    for key in _MACHINE_GCODE_KEYS:
        if key in new:
            change(key, f"; {key} for {original_printer} removed by Deja Vu1 - "
                        "select the Snapmaker U1 printer profile to use Snapmaker's own")

    # -- print (process) profile ------------------------------------------------
    try:
        layer_height = float(config.get("layer_height") or 0.2)
    except (TypeError, ValueError):
        raise ConversionError("The project has an unreadable layer height", "bad_settings")
    if not math.isfinite(layer_height) or not .01<=layer_height<=1:
        raise ConversionError("The project has an invalid layer height. Correct it in its source slicer first", "bad_settings")
    options = U1_PROCESSES[nozzle]
    process = options[_nearest(options.keys(), layer_height)]
    change("print_settings_id", process)

    # -- filaments --------------------------------------------------------------
    colours = _as_list(config.get("filament_colour"))
    types = _as_list(config.get("filament_type"))
    count = max(len(colours), len(types), len(_as_list(config.get("filament_settings_id"))), 1)
    # Snapmaker Orca counts filaments by filament_colour alone
    # (PresetBundle::load_config_file_config) and reads the printer from
    # slot count + 1 of inherits_group, so every filament needs a colour -
    # otherwise the printer would be read from a filament's slot.
    if len(colours) < count:
        missing = list(range(len(colours) + 1, count + 1))
        colours = colours + ["#FFFFFF"] * (count - len(colours))
        change("filament_colour", colours)
        report["warnings"].append(
            f"Filament{'s' if len(missing) > 1 else ''} {', '.join(map(str, missing))} had no colour in the "
            "project; set to white - pick the real colour in Snapmaker Orca")
    if colour_report:
        report["warnings"].extend(colour_report["warnings"])
    if count > U1_TOOLHEADS:
        report["warnings"].append(
            f"This project uses {count} filaments; the U1 has {U1_TOOLHEADS} toolheads. "
            "Reassign colours in Snapmaker Orca before slicing")
    filament_presets = []
    for i in range(count):
        material = (types[i] if i < len(types) else (types[0] if types else "PLA")).upper()
        preset = U1_FILAMENTS[nozzle].get(material)
        if not preset:
            raise ConversionError(f"No verified U1 preset for {material} with a {nozzle} mm nozzle (filament {i+1}). Set up that material in Orca; it will not be silently replaced with PLA", "bad_settings")
        filament_presets.append(preset)
    change("filament_settings_id", filament_presets)

    # -- which parent profile each section follows, and what it keeps -------------
    old_diff = _as_list(config.get("different_settings_to_system"))
    old_diff += [""] * (count + 2 - len(old_diff))
    print_keep = sorted(set(_split_keys(old_diff[0])) | {"layer_height"})
    filament_keep = []
    for i in range(count):
        keys = sorted(set(_split_keys(old_diff[1 + i] if 1 + i < len(old_diff) - 1 else "")) |
                      {"filament_colour"})
        filament_keep.append(";".join(keys))
    change("inherits_group", [process] + filament_presets + [printer_preset])
    # Snapmaker Orca fills every printer setting not listed here from the
    # U1 profile; printer_notes carries the "converted from" note.
    change("different_settings_to_system", [";".join(print_keep)] + filament_keep + ["printer_notes"])
    for key in ("compatible_printers", "print_compatible_printers"):
        if key in new or key == "print_compatible_printers":
            change(key, [printer_preset])
    report["kept"] = [k for k in print_keep if k != "layer_height"]
    report["layer_height"] = layer_height
    report["print_profile"] = process
    report["printer_profile"] = printer_preset
    report["filament_profiles"] = filament_presets

    # -- where the objects sit ----------------------------------------------------
    replaced = {}
    layout = reposition_plates(archive, config.get("printable_area"))
    report["plates"] = {k: v for k, v in layout.items() if k != "model"}
    report["warnings"].extend(layout["warnings"])
    if layout.get("model") is not None:
        replaced[MODEL_PART] = layout["model"]

    # -- rebuild the archive ----------------------------------------------------
    out = io.BytesIO()
    dropped = []
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for item in archive.infolist():
            name = item.filename
            if re.match(r"Metadata/plate_\d+\.gcode(\.md5)?$", name) or name == "Metadata/slice_info.config":
                dropped.append(name)
                continue
            if name == PROJECT_CONFIG:
                target.writestr(item, json.dumps(new, indent=4, ensure_ascii=False))
            elif name in replaced:
                target.writestr(item, replaced[name])
            elif item.is_dir():
                target.writestr(item, b"")
            else:
                # Copied as a stream, part by part, each size-checked: a
                # large model never sits in memory twice.
                entry = zipfile.ZipInfo(name, item.date_time)
                entry.compress_type = zipfile.ZIP_DEFLATED
                try:
                    with safe_zip.open_part(archive, name, what="3MF project") as src, \
                            target.open(entry, "w") as dst:
                        shutil.copyfileobj(src, dst, 1024 * 1024)
                except safe_zip.DamagedArchive as exc:
                    raise ConversionError(str(exc), "damaged")
    if dropped:
        report["warnings"].append(
            "Removed G-code that was already sliced for the original printer - "
            "slice again in Snapmaker Orca")
    report["removed_parts"] = dropped
    return out.getvalue(), report


def _convert_prusa(data, info, plan, loaded):
    """
    A PrusaSlicer project for the U1. Snapmaker Orca opens these with their
    geometry, paint and each object's extruder number, and keeps its own
    printer and filament settings (OrcaSlicer Plater.cpp, En3mfType::From_Prusa),
    so only the colours need to fit four heads; the settings stay as they are.
    """
    try:
        new, colours = colour_map.apply(data, plan, loaded)
    except colour_map.ColourMapError as exc:
        raise ConversionError(str(exc), "bad_settings")
    heads = ", ".join(f"head {h['head'] + 1}: {h['name']} {h['type'] or ''}".strip() for h in colours["heads"])
    report = {"source": "prusa", "source_label": info["source_label"], "application": info["application"],
              "colours": colours, "changes": [], "kept": [], "warnings": list(colours["warnings"]),
              "original_printer": "the PrusaSlicer printer", "printer_profile": "Snapmaker U1 (pick it in Snapmaker Orca)",
              "print_profile": "Snapmaker Orca's own", "layer_height": None, "filament_profiles": [],
              "plates": None, "removed_parts": [],
              "unverified": ("Snapmaker Orca reads PrusaSlicer projects through OrcaSlicer's importer. Open it with "
                             "the Snapmaker U1 printer selected and check the colours before you slice.")}
    report["warnings"].insert(0, f"Load these colours: {heads}")
    return new, report


# ---------------------------------------------------------------------------
# Plates
#
# Bambu Studio, OrcaSlicer and Snapmaker Orca lay a project's plates out in
# a grid, each plate one bed-width plus a fifth apart (PartPlate.cpp in
# Snapmaker's OrcaSlicer: LOGICAL_PART_PLATE_GAP = 1/5, plate i's origin at
# column * width * 1.2, -row * depth * 1.2, with the plate width and depth
# taken as whole millimetres of the bed's extent - Plater.cpp reset_size).
# When a project is opened, which plate an object belongs to is rebuilt
# from where the object is (PartPlateList::load_from_3mf_structure: "we
# will rebuild later"), not from the plate list in the file.
#
# A Bambu bed is 256 mm and the U1's 270 mm, so plate 2 of a MakerWorld
# project sits 307.2 mm along in the file but the U1's plate 2 starts at
# 324 mm: without moving them, objects from plate 2 on would land between
# plates or on the wrong one. So every object on a plate is moved by the
# same amount - to the same spot on the U1's plate, centred the same way -
# keeping its height, rotation, scale and its place among its neighbours.
# A plate whose objects can't all be matched up safely is left exactly as
# it was rather than moved in part, and the report says which.
#
# Plate positions follow the slicer's documented bed-coordinate layout.
# ---------------------------------------------------------------------------

MODEL_PART = "3D/3dmodel.model"
MODEL_SETTINGS = "Metadata/model_settings.config"
PLATE_GAP = 1.0 / 5.0
_MAX_BUILD_PART = 64 * 1024 * 1024     # the build list is rewritten in memory


def _bed(area):
    """printable_area (["0x0", "256x0", ...] or "0x0,256x0,...") -> extent, or None."""
    if isinstance(area, str):
        area = area.split(",")
    points = []
    for p in area or []:
        try:
            x, y = str(p).lower().split("x")
            points.append((float(x), float(y)))
        except ValueError:
            return None
    if len(points) < 3:
        return None
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    width, depth = int(max(xs) - min(xs)), int(max(ys) - min(ys))
    if width <= 0 or depth <= 0:
        return None
    return {"min_x": min(xs), "max_x": max(xs), "min_y": min(ys), "max_y": max(ys),
            "cx": (min(xs) + max(xs)) / 2, "cy": (min(ys) + max(ys)) / 2,
            "width": width, "depth": depth,
            "stride_x": width * (1 + PLATE_GAP), "stride_y": depth * (1 + PLATE_GAP)}


def _plate_instances(data):
    """Metadata/model_settings.config -> [(plate id, [(object id, instance index), ...]), ...]."""
    plates, stack, cur = [], [], {}

    def start(name, attrs):
        stack.append(name)
        if name == "plate":
            cur["plate"] = {"id": str(len(plates) + 1), "instances": []}
        elif name == "model_instance" and "plate" in cur:
            cur["instance"] = {}
        elif name == "metadata" and "plate" in cur:
            key, value = attrs.get("key"), attrs.get("value")
            if "instance" in cur and len(stack) >= 2 and stack[-2] == "model_instance":
                cur["instance"][key] = value
            elif len(stack) >= 2 and stack[-2] == "plate" and key == "plater_id":
                cur["plate"]["id"] = str(value)

    def end(name):
        stack.pop()
        if name == "model_instance" and "instance" in cur:
            inst = cur.pop("instance")
            cur["plate"]["instances"].append((inst.get("object_id"), inst.get("instance_id")))
        elif name == "plate" and "plate" in cur:
            plates.append(cur.pop("plate"))

    parser = expat.ParserCreate()
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.Parse(data, True)
    return plates


_ITEM = re.compile(rb"<(?:[A-Za-z_][\w.-]*:)?item\b[^>]*>")
_ATTR = re.compile(rb'([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"')
_BUILD = re.compile(rb"<(?:[A-Za-z_][\w.-]*:)?build[\s>/]")


def reposition_plates(archive, source_area):
    """
    Move each plate's objects onto the matching U1 plate. Returns a dict:
    count, moved, skipped (plate ids), shift_mm per moved plate, warnings,
    and "model" - the rewritten 3D/3dmodel.model bytes, or None if nothing
    had to change.
    """
    result = {"count": 0, "moved": [], "skipped": [], "shift_mm": {}, "warnings": [], "model": None}
    names = set(archive.namelist())
    if MODEL_SETTINGS not in names:
        return result
    try:
        plates = _plate_instances(safe_zip.read(archive, MODEL_SETTINGS, limit=16 * 1024 * 1024,
                                                what="3MF project"))
    except (safe_zip.DamagedArchive, expat.ExpatError):
        result["warnings"].append("The project's plate list couldn't be read, so objects were left "
                                  "where they were - check each plate in Snapmaker Orca")
        return result
    plates = [p for p in plates if p["instances"]]
    result["count"] = len(plates)
    if not plates:
        return result
    src, dst = _bed(source_area), _bed(U1_PRINTABLE_AREA)
    if src is None:
        result["warnings"].append("The project doesn't say how big its original bed was, so objects were "
                                  "left where they were - check each plate in Snapmaker Orca")
        return result
    if (src["width"], src["depth"], src["cx"], src["cy"]) == (dst["width"], dst["depth"], dst["cx"], dst["cy"]):
        return result
    info = archive.getinfo(MODEL_PART)
    if info.file_size > _MAX_BUILD_PART:
        result["warnings"].append("The model is too large to re-place safely, so objects were left where they "
                                  "were - check each plate in Snapmaker Orca")
        return result
    try:
        model = safe_zip.read(archive, MODEL_PART, limit=_MAX_BUILD_PART, what="3MF project")
    except safe_zip.DamagedArchive as exc:
        raise ConversionError(str(exc), "damaged")

    build = _BUILD.search(model)
    if not build:
        return result
    items, seen = {}, {}
    for m in _ITEM.finditer(model, build.start()):
        attrs = {k.decode(): v.decode("utf-8", "replace") for k, v in _ATTR.findall(m.group(0))}
        oid = attrs.get("objectid")
        index = seen.get(oid, 0)
        seen[oid] = index + 1
        items[(oid, index)] = (m, attrs.get("transform"))

    edits = []
    for plate in plates:
        found = []
        for oid, inst in plate["instances"]:
            try:
                hit = items.get((str(oid), int(inst)))
                values = [float(v) for v in hit[1].split()] if hit and hit[1] else None
            except (TypeError, ValueError):
                values = None
            if not values or len(values) != 12:
                found = None
                break
            col = round((values[9] - src["cx"]) / src["stride_x"])
            row = round((src["cy"] - values[10]) / src["stride_y"])
            found.append((hit[0], values, col, row))
        if not found or len({(c, r) for _, _, c, r in found}) != 1:
            result["skipped"].append(plate["id"])
            continue
        col, row = found[0][2], found[0][3]
        dx = (dst["cx"] - src["cx"]) + col * (dst["stride_x"] - src["stride_x"])
        dy = (dst["cy"] - src["cy"]) - row * (dst["stride_y"] - src["stride_y"])
        overhang = False
        for match, values, _, _ in found:
            local_x = values[9] + dx - col * dst["stride_x"]
            local_y = values[10] + dy + row * dst["stride_y"]
            overhang |= not (dst["min_x"] <= local_x <= dst["max_x"] and dst["min_y"] <= local_y <= dst["max_y"])
            values = values[:9] + [values[9] + dx, values[10] + dy] + values[11:]
            edits.append((match, values))
        result["moved"].append(plate["id"])
        result["shift_mm"][plate["id"]] = [round(dx, 3), round(dy, 3)]
        if overhang:
            result["warnings"].append(
                f"Plate {plate['id']}: an object's centre is outside the U1's 270 x 270 mm bed - "
                "the original bed was bigger. Rearrange that plate in Snapmaker Orca")

    if result["skipped"]:
        result["warnings"].append(
            f"Plate{'s' if len(result['skipped']) > 1 else ''} {', '.join(result['skipped'])} couldn't be "
            "matched up object by object, so left exactly as it was - check its position in Snapmaker Orca")
    if not edits:
        return result
    out, last = [], 0
    for match, values in sorted(edits, key=lambda e: e[0].start()):
        tag = match.group(0)
        new_transform = " ".join(_fmt(v) for v in values).encode()
        tag = re.sub(rb'(\btransform\s*=\s*")[^"]*(")', lambda m: m.group(1) + new_transform + m.group(2), tag, count=1)
        out += [model[last:match.start()], tag]
        last = match.end()
    out.append(model[last:])
    result["model"] = b"".join(out)
    return result


def _fmt(v):
    text = f"{v:.9g}"
    return "0" if text == "-0" else text


def converted_name(filename):
    stem = re.sub(r"(\.gcode)?\.3mf$", "", filename, flags=re.IGNORECASE)
    return f"{stem}_U1.3mf"
