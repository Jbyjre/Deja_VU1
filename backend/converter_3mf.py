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
import zipfile
import xml.etree.ElementTree as ET

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


class ConversionError(ValueError):
    """The file can't be converted; the message says why in plain words."""


def _read_application(archive):
    try:
        root = ET.fromstring(archive.read("3D/3dmodel.model"))
    except KeyError:
        raise ConversionError("This 3MF has no 3D/3dmodel.model part, so it isn't a model project")
    except ET.ParseError:
        raise ConversionError("The 3MF's model part isn't valid XML")
    for m in root.findall(f"{{{CORE_NS}}}metadata"):
        if m.get("name") == "Application":
            return (m.text or "").strip()
    return ""


def detect_source(application, config):
    """Which ecosystem a project came from, judged from what it says about itself."""
    printer = str((config or {}).get("printer_model") or "")
    app = application.lower()
    if app.startswith("snapmaker") or printer.startswith("Snapmaker"):
        return "snapmaker"
    if app.startswith("bambustudio") or printer.startswith("Bambu Lab"):
        return "makerworld"
    if app.startswith("elegooslicer") or "elegoo" in printer.lower():
        return "nexprint"
    return "unknown"


def _nearest(options, value):
    return min(options, key=lambda k: abs(float(k) - value))


def _as_list(value):
    if isinstance(value, list):
        return value
    return [value] if value not in (None, "") else []


def _split_keys(text):
    return [k for k in re.split(r"[;,]", text or "") if k]


def convert(data):
    """
    Convert project bytes. Returns (new_bytes, report). Raises
    ConversionError with a plain explanation when it can't.
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ConversionError("This isn't a 3MF file (3MF files are zip archives)")

    application = _read_application(archive)
    config = None
    if PROJECT_CONFIG in archive.namelist():
        try:
            config = json.loads(archive.read(PROJECT_CONFIG))
        except (ValueError, UnicodeDecodeError):
            raise ConversionError("The project's settings file is damaged and can't be read")

    source = detect_source(application, config)
    if source == "snapmaker":
        raise ConversionError("This project is already set up for a Snapmaker printer - nothing to convert")
    if source == "unknown":
        raise ConversionError(
            "Only MakerWorld (Bambu Studio) and NexPrint (Elegoo Slicer) projects are supported. "
            f"This file says it was made by '{application or 'an unnamed program'}'")
    if config is None:
        raise ConversionError(
            "This 3MF only contains the model, with no print settings to convert. Open it "
            "directly in Snapmaker Orca and pick the Snapmaker U1 printer")

    report = {"source": source,
              "source_label": {"makerworld": "MakerWorld (Bambu Studio)",
                               "nexprint": "NexPrint (Elegoo Slicer)"}[source],
              "application": application, "changes": [], "kept": [], "warnings": [],
              "unverified": ("Built from Snapmaker Orca's source code and profile files; not yet "
                             "confirmed by opening the result in Snapmaker Orca itself.")}
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
    except ValueError:
        nozzle = "0.4"
    if nozzle not in U1_PROCESSES:
        report["warnings"].append(f"The U1 has no {nozzle} mm nozzle profile; converted for 0.4 mm instead")
        nozzle = "0.4"
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
        layer_height = 0.2
    options = U1_PROCESSES[nozzle]
    process = options[_nearest(options.keys(), layer_height)]
    change("print_settings_id", process)

    # -- filaments --------------------------------------------------------------
    colours = _as_list(config.get("filament_colour"))
    types = _as_list(config.get("filament_type"))
    count = max(len(colours), len(types), len(_as_list(config.get("filament_settings_id"))), 1)
    if count > U1_TOOLHEADS:
        report["warnings"].append(
            f"This project uses {count} filaments; the U1 has {U1_TOOLHEADS} toolheads. "
            "Reassign colours in Snapmaker Orca before slicing")
    filament_presets = []
    for i in range(count):
        material = (types[i] if i < len(types) else (types[0] if types else "PLA")).upper()
        preset = U1_FILAMENTS[nozzle].get(material)
        if not preset:
            preset = U1_FILAMENTS[nozzle]["PLA"] if "PLA" in U1_FILAMENTS[nozzle] else "Generic PLA"
            report["warnings"].append(
                f"No U1 profile for {material} with a {nozzle} mm nozzle; filament {i + 1} "
                f"set to {preset} - check it before printing")
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
    # The printer list must be non-empty for Snapmaker Orca to fill every
    # other printer setting from its U1 profile; printer_notes is harmless.
    change("different_settings_to_system", [";".join(print_keep)] + filament_keep + ["printer_notes"])
    for key in ("compatible_printers", "print_compatible_printers"):
        if key in new or key == "print_compatible_printers":
            change(key, [printer_preset])
    report["kept"] = [k for k in print_keep if k != "layer_height"]
    report["layer_height"] = layer_height
    report["print_profile"] = process
    report["printer_profile"] = printer_preset
    report["filament_profiles"] = filament_presets

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
            else:
                target.writestr(item, archive.read(name))
    if dropped:
        report["warnings"].append(
            "Removed G-code that was already sliced for the original printer - "
            "slice again in Snapmaker Orca")
    report["removed_parts"] = dropped
    return out.getvalue(), report


def converted_name(filename):
    stem = re.sub(r"(\.gcode)?\.3mf$", "", filename, flags=re.IGNORECASE)
    return f"{stem}_U1.3mf"
