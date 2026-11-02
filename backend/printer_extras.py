"""
printer_extras.py
=================

What the Printer page reads from a printer on request, beyond the live state:
its macros and the settings each one takes, its bed mesh, its endstops, its own
list of commands (HELP), the last 20 minutes of temperatures and how its
automatic filament feeders are wired.

A real printer answers through moonraker_client (Moonraker's own endpoints:
printer.objects.query, query_endstops/status, gcode/help, temperature_store).
A simulated printer answers from the functions below, every answer marked
"demo": True. Nothing here is guessed for a real printer: what it doesn't
report is left out, and the page says so.
"""

import math
import re

# Macro settings are read from the macro's own text, the way people write them
# in Klipper's Jinja templates: params.NAME or params["NAME"], optionally
# followed by | default(value).
_PARAM = re.compile(
    r"""params\s*(?:\.\s*([A-Za-z_]\w*)|\[\s*['"]([A-Za-z_]\w*)['"]\s*\])"""
    r"""(?:\s*\|\s*default\s*\(\s*([^()]*?)\s*\))?""")
MAX_PARAMS = 20
MAX_DEFAULT = 40
# What a macro setting may be sent as: one word of letters, digits and . _ - : # +
# (no spaces, quotes or new lines, so a value can't add a second command).
PARAM_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,31}$")
PARAM_VALUE = re.compile(r"^[A-Za-z0-9_.:#+\-]{1,64}$")


def macro_params(gcode):
    """The settings one macro reads, in the order they first appear, with their written defaults."""
    found, seen = [], set()
    for match in _PARAM.finditer(str(gcode or "")):
        name = (match.group(1) or match.group(2) or "").upper()
        if not name or name in seen or name == "RAWPARAMS":
            continue
        seen.add(name)
        default = match.group(3)
        if default is not None:
            default = default.strip().strip("'\"")[:MAX_DEFAULT]
        found.append({"name": name, "default": default})
        if len(found) >= MAX_PARAMS:
            break
    return found


def macros_from_config(config, listed):
    """configfile "config" -> each listed macro with its description and settings."""
    config = config if isinstance(config, dict) else {}
    sections = {}
    for key, body in config.items():
        if isinstance(key, str) and key.lower().startswith("gcode_macro ") and isinstance(body, dict):
            sections[key.split(" ", 1)[1].strip().upper()] = body
    out = []
    for name in listed:
        body = sections.get(name.upper()) or {}
        description = body.get("description")
        out.append({"name": name.upper(),
                    "description": str(description)[:160] if isinstance(description, str) else None,
                    "params": macro_params(body.get("gcode"))})
    return out


def _matrix(value, limit=40):
    """A list of rows of numbers, or None. Capped so a strange mesh can't flood the page."""
    if not isinstance(value, list) or not value or len(value) > limit:
        return None
    rows = []
    for row in value:
        if not isinstance(row, list) or not row or len(row) > limit:
            return None
        try:
            rows.append([round(float(v), 4) for v in row])
        except (TypeError, ValueError):
            return None
    return rows if len({len(r) for r in rows}) == 1 else None


def _pair(value):
    if isinstance(value, (list, tuple)) and len(value) == 2:
        try:
            return [round(float(value[0]), 2), round(float(value[1]), 2)]
        except (TypeError, ValueError):
            return None
    return None


def mesh_from_status(bed_mesh):
    """Klipper's bed_mesh status -> what the mesh view draws."""
    bed_mesh = bed_mesh if isinstance(bed_mesh, dict) else {}
    probed = _matrix(bed_mesh.get("probed_matrix"))
    profiles = bed_mesh.get("profiles")
    names = sorted(str(n)[:40] for n in profiles) if isinstance(profiles, dict) else []
    out = {"profile": bed_mesh.get("profile_name") or None, "profiles": names[:20],
           "probed": probed, "mesh_min": _pair(bed_mesh.get("mesh_min")), "mesh_max": _pair(bed_mesh.get("mesh_max"))}
    if probed:
        flat = [v for row in probed for v in row]
        out["lowest"], out["highest"] = min(flat), max(flat)
        out["range"] = round(out["highest"] - out["lowest"], 4)
    return out


def heater_label(name):
    """Klipper object name -> the word the page shows (T0..T3, Bed, or the sensor's own name)."""
    name = str(name)
    if name == "extruder":
        return "T0"
    match = re.match(r"^extruder(\d+)$", name)
    if match:
        return f"T{match.group(1)}"
    if name == "heater_bed":
        return "Bed"
    return name.split(" ", 1)[-1].replace("_", " ")


def temperatures_from_store(store, keep=1200):
    """Moonraker's temperature_store (one reading a second per sensor) -> chart series."""
    series = []
    for name, data in (store or {}).items():
        if not isinstance(data, dict) or not isinstance(data.get("temperatures"), list):
            continue
        temps = data["temperatures"][-keep:]
        targets = data.get("targets") if isinstance(data.get("targets"), list) else None
        series.append({"id": str(name), "label": heater_label(name),
                       "temperatures": [None if v is None else round(float(v), 1) for v in temps],
                       "targets": None if targets is None else
                       [None if v is None else round(float(v), 1) for v in targets[-keep:]]})
    order = {"T0": 0, "T1": 1, "T2": 2, "T3": 3, "Bed": 4}
    series.sort(key=lambda s: (order.get(s["label"], 9), s["label"]))
    return {"interval_s": 1, "series": series[:12]}


def endstops_from(reply):
    """query_endstops/status -> [{name, triggered}] in a steady order."""
    reply = reply if isinstance(reply, dict) else {}
    return [{"name": str(k)[:40], "triggered": str(v).upper() == "TRIGGERED"} for k, v in sorted(reply.items())][:16]


def help_from(reply, limit=400):
    """gcode/help -> {COMMAND: description}, capped."""
    reply = reply if isinstance(reply, dict) else {}
    out = {}
    for key in sorted(reply)[:limit]:
        if isinstance(key, str) and re.match(r"^[A-Za-z0-9_]{1,64}$", key):
            out[key.upper()] = str(reply[key])[:160]
    return out


def feeding_from(variables, heads):
    """
    The U1's _FILAMENT_FEED_VARIABLE macro -> which feeder module and channel serve each head.
    Only what the printer's own variable says; a head it doesn't name is left out.
    """
    variables = variables if isinstance(variables, dict) else {}
    modules, channels = variables.get("module_sequence"), variables.get("channel_sequence")
    if not isinstance(modules, (list, tuple)) or not isinstance(channels, (list, tuple)):
        return []
    out = []
    for i, head in enumerate(heads):
        if i < len(modules) and i < len(channels):
            out.append({"head": head, "index": i, "module": str(modules[i])[:20], "channel": channels[i]})
    return out


# ---------------------------------------------------------------------------
# Simulated printers: demo answers in the same shapes, always labelled
# ---------------------------------------------------------------------------

DEMO_MACRO_TEXT = {
    "PREHEAT_PLA": {"description": "Warm the active head and the bed for PLA",
                    "gcode": "{% set t = params.TOOL|default(0)|int %}\nM104 T{t} S{params.NOZZLE|default(210)}\n"
                             "M140 S{params.BED|default(60)}"},
    "CLEAN_NOZZLE": {"gcode": "{% set n = params.WIPES|default(3)|int %}\nG28"},
    "LIGHT_ON": {"gcode": "SET_LED LED=cavity_led WHITE={params.LEVEL|default(1)}"},
    "LIGHT_OFF": {"gcode": "SET_LED LED=cavity_led WHITE=0"},
}


def demo_macros(listed):
    config = {f"gcode_macro {name.lower()}": body for name, body in DEMO_MACRO_TEXT.items()}
    return {"macros": macros_from_config(config, listed), "demo": True}


def demo_mesh(profile):
    """A gentle, made-up bowl with a tilt, 7 x 7 points: demo data only."""
    size = 7
    probed = [[round(0.06 * math.cos(math.pi * (x - 3) / 6) * math.cos(math.pi * (y - 3) / 6) - 0.03
                     + 0.012 * (x - 3) - 0.008 * (y - 3), 4) for x in range(size)] for y in range(size)]
    out = mesh_from_status({"profile_name": profile or "", "probed_matrix": probed if profile else None,
                            "mesh_min": [3, 3], "mesh_max": [267, 267], "profiles": {"default": {}}})
    out["demo"] = True
    return out


DEMO_HELP = {
    # Klipper's own help text for these commands (klippy/gcode.py, extras/*.py).
    "HELP": "Report the list of available extended G-Code commands",
    "STATUS": "Report the printer status",
    "QUERY_ENDSTOPS": "Report on the status of each endstop",
    "GET_POSITION": "Return information on the current location of the toolhead",
    "BED_MESH_CALIBRATE": "Perform Mesh Bed Leveling",
    "BED_MESH_CLEAR": "Clear the Mesh so no z-adjustment is made",
    "SET_PRESSURE_ADVANCE": "Set pressure advance parameters",
    "SET_VELOCITY_LIMIT": "Set printer velocity limits",
    "SET_FAN_SPEED": "Sets the speed of a fan",
    "SET_LED": "Set the color of an LED",
    "SET_FILAMENT_SENSOR": "Sets the filament sensor on/off",
    "FIRMWARE_RESTART": "Restart firmware, host, and reload config",
}


def demo_help(macros):
    commands = dict(DEMO_HELP)
    for name in macros:
        commands[name.upper()] = "G-Code macro"
    return {"commands": commands, "demo": True}


def demo_endstops():
    return {"endstops": [{"name": axis, "triggered": False} for axis in "xyz"], "demo": True}


def demo_feeding(heads):
    # The same order Snapmaker's published U1 config gives (left, left, right, right; 1, 0, 0, 1).
    return {"heads": feeding_from({"module_sequence": ["left", "left", "right", "right"],
                                   "channel_sequence": [1, 0, 0, 1]}, heads),
            "macro": "AUTO_FEEDING", "demo": True}
