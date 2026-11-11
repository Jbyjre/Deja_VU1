"""
ai_assistant.py
===============

The assistant: a chat that can read what Deja Vu1 knows and, inside fixed limits, work the printer.

How it stays safe, in the order a request meets each layer:

  1. The model never talks to the printer. It can only ask for one of the named tools in TOOLS, by
     writing a small block of JSON. Anything else it writes is just words.
  2. Every tool that changes something calls the same checked function the Printer page's buttons
     call (printer_control.py): temperatures inside the heater limits, moves inside the printer's
     own reported size and only after homing, no moves through a running print. On top of that the
     assistant has limits of its own (LIMITS): it keeps the nozzle a few millimetres off the bed,
     can only send read-only G-code, and can never start a print by itself: Confirm Print does that,
     with the owner's tap.
  3. The owner chooses how much it may do without asking (MODES). A step that needs a yes waits in
     the chat with Approve and Decline buttons, and nothing is sent until one is pressed.
  4. Watch-only mode, the hold during a restart and the module switches apply to it like any other
     sender. Demo printers and real printers never mix: a tool acts on the printer the chat is
     about, and answers {"connected": false} when there is none.

The model's answers use one small text convention (ACTION blocks) instead of each service's own
tool-calling format, so every provider in ai_providers.py, the two subscription programs included,
behaves the same way.
"""

import base64
import json
import math
import os
import re
import threading
import time
import uuid

import ai_providers
import cost_calculator
import file_library
import filament_inventory
import insights
import live_feed
import maintenance
import mesh_tools
import mock_moonraker
import modules
import print_gate
import print_queue
import printer_control
import storage
import update_hold
import watch_only

_DATA_DIR = storage.DATA_DIR
_SETTINGS_PATH = os.path.join(_DATA_DIR, "ai_assistant.json")
_lock = threading.Lock()
_threads = {}                      # thread id -> conversation; kept in memory only

MAX_ROUNDS = 6                     # times the model may be asked again within one request
MAX_ACTIONS = 12                   # tool calls carried out for one request
MAX_THREADS = 24
MAX_TEXT = 6000
MAX_RESULT = 2600                  # characters of one tool result shown to the model
MAX_MODEL_BYTES = 30 * 1024 * 1024

MODES = {
    "advice": "Advice only: it reads and explains, and sends the printer nothing.",
    "ask": "Ask every time: every step that changes something waits for your yes.",
    "balanced": "Balanced: it moves, homes, cools and adjusts by itself, and asks before it heats, "
                "pushes filament, runs a macro or cancels a print.",
    "free": "Hands-on: it does everything inside the safety limits by itself, and still asks before "
            "it cancels a print.",
}
DEFAULT_MODE = "balanced"

LIMITS = {
    "nozzle_max_c": printer_control.MAX_TEMP,
    "bed_max_c": printer_control.MAX_BED_TEMP,
    "z_floor_mm": 2.0,              # the assistant never drives the nozzle closer to the bed than this
    "speed_percent": (50, 150),     # outside this it asks first (the hard limits are 10 to 300)
    "extrude_mm": 50,
    "actions_per_request": MAX_ACTIONS,
}

# Read-only G-code the assistant may send as typed text. Everything that moves, heats or changes a
# setting has a named tool with its own checks, so raw commands are for reading only.
_SAFE_GCODE = re.compile(r"^(M105|M114|M115|M119|M117( .{0,60})?|M118( .{0,60})?|STATUS|HELP|GET_POSITION|"
                         r"QUERY_ENDSTOPS|QUERY_PROBE|QUERY_ADC( .{0,40})?|BED_MESH_OUTPUT( .{0,20})?)$", re.I)


class Refused(Exception):
    """The assistant's own limits said no. Shown in the chat as a refusal, in words."""


# ---- settings ---------------------------------------------------------------

def _settings():
    data = storage.load_json(_SETTINGS_PATH, {})
    data = data if isinstance(data, dict) else {}
    data.setdefault("provider", "")
    data.setdefault("models", {})
    if data.get("mode") not in MODES:
        data["mode"] = DEFAULT_MODE
    return data


def status():
    s = _settings()
    rows = ai_providers.describe_all()
    active = next((r for r in rows if r["id"] == s["provider"]), None)
    return {
        "providers": rows,
        "provider": s["provider"],
        "model": s["models"].get(s["provider"], ai_providers.DEFAULT_MODELS.get(s["provider"], "")),
        "models": s["models"],
        "mode": s["mode"],
        "modes": MODES,
        "ready": bool(active and active.get("ready") and s.get("tested") == s["provider"]),
        "limits": LIMITS,
        "tools": [{"name": name, "level": t["level"], "what": t["what"]} for name, t in TOOLS.items()],
    }


def select(provider=None, model=None, mode=None):
    with _lock:
        s = _settings()
        if provider is not None:
            if provider:
                ai_providers.provider(provider)
            if provider != s["provider"]:
                s.pop("tested", None)
            s["provider"] = provider
        if model is not None and s["provider"]:
            model = str(model).strip()
            if len(model) > 200 or re.search(r"[\s\"'`]", model):
                raise ValueError("That isn't a model name")
            s["models"][s["provider"]] = model
        if mode is not None:
            if mode not in MODES:
                raise ValueError("Unknown mode")
            s["mode"] = mode
        storage.save_json(_SETTINGS_PATH, s)
    return status()


def test(provider):
    """Check a connection with one tiny request and, when it answers, make it the one in use."""
    s = _settings()
    model = s["models"].get(provider, "")
    result = ai_providers.test(provider, model)
    with _lock:
        s = _settings()
        s["provider"], s["tested"] = provider, provider
        storage.save_json(_SETTINGS_PATH, s)
    return {**result, **status()}


def forget(provider):
    ai_providers.forget(provider)
    with _lock:
        s = _settings()
        if s["provider"] == provider:
            s["provider"] = ""
            s.pop("tested", None)
        s["models"].pop(provider, None)
        storage.save_json(_SETTINGS_PATH, s)
    return status()


def reset():
    """Forget settings, keys and conversations. For tests."""
    with _lock:
        storage.save_json(_SETTINGS_PATH, {})
        _threads.clear()
    ai_providers.reset()


# ---- the tools --------------------------------------------------------------

def _state():
    return mock_moonraker.get_printer_state() or {}


def _brief_state():
    s = _state()
    heads = {name: {"temperature": h.get("temperature"), "target": h.get("target_temperature"),
                    "filament": " ".join(str(h.get(k) or "") for k in ("filament_color_name", "filament_material")).strip(),
                    "loaded": h.get("filament_loaded")}
             for name, h in (s.get("toolheads") or {}).items()}
    tuning = s.get("tuning") or {}
    machine = s.get("machine") or {}
    return {
        "printer": s.get("printer_name"), "state": s.get("state"), "message": s.get("state_message"),
        "file": s.get("current_file"), "progress_percent": round((s.get("progress") or 0) * 100, 1),
        "layer": s.get("layer"), "active_head": s.get("active_toolhead"), "heads": heads,
        "bed": {"temperature": s.get("bed_temperature"), "target": s.get("bed_target")},
        "chamber_temperature": s.get("chamber_temperature"),
        "position_mm": s.get("toolhead_position"), "homed_axes": s.get("homed_axes"),
        "size_mm": {"min": machine.get("min_mm"), "max": machine.get("max_mm")},
        "speed_percent": round((tuning.get("speed_factor") or 1) * 100),
        "flow_percent": round((tuning.get("extrude_factor") or 1) * 100),
        "fan_percent": round((tuning.get("part_fan") or 0) * 100),
        "macros": tuning.get("macros"),
    }


def _files():
    rows = file_library.list_files()
    rows = rows.get("files", rows) if isinstance(rows, dict) else rows
    return [{"name": f.get("name"), "kind": f.get("kind"), "size_bytes": f.get("size")} for f in rows][:80]


def _file_info(name):
    info = file_library.describe(name)
    summary = info.get("summary") or {}
    keep = ("estimated_time_hours", "filament_grams", "filament_type", "filament_types", "layer_height",
            "nozzle_temp", "bed_temp", "tools_used", "slicer", "layers", "size", "triangles", "warnings",
            "preflight", "per_tool", "objects", "bounds", "filament_colors")
    return {"name": info["name"], "kind": info.get("kind"), **{k: summary[k] for k in keep if k in summary}}


def _position(axis):
    pos = _state().get("toolhead_position")
    if isinstance(pos, (list, tuple)) and len(pos) >= 3:
        try:
            return float(pos["XYZ".index(axis)])
        except (TypeError, ValueError):
            return None
    return None


def _z_floor(z):
    if z is not None and float(z) < LIMITS["z_floor_mm"]:
        raise Refused(f"The assistant keeps the nozzle at least {LIMITS['z_floor_mm']:g} mm above the bed, so it "
                      f"won't go to Z {float(z):g}. Use the Printer page's Move pad for a closer move")


def _move(x=None, y=None, z=None, speed=None):
    if z not in (None, ""):
        _z_floor(printer_control._number(z, "Z", -1000, 1000))
    return printer_control.move_to(x, y, z, speed)


def _move_by(axis, distance, speed=None):
    axis = str(axis or "").upper()
    if axis not in printer_control.VALID_AXES:
        raise ValueError(f"Unknown axis: {axis or 'none'}")
    distance = printer_control._number(distance, "Distance", -300, 300)
    here = _position(axis)
    if here is None:
        raise Refused(f"The printer hasn't reported where {axis} is, so the assistant won't move it blind. Home first")
    return _move(**{axis.lower(): here + distance}, speed=speed)


def _nozzle(toolhead, target):
    return printer_control.set_temperature(str(toolhead or "").upper(), target)


def _cool_down():
    done = []
    for head in mock_moonraker.TOOLHEADS:
        printer_control.set_temperature(head, 0)
        done.append(head)
    printer_control.set_bed_temperature(0)
    return {"cooling": done + ["bed"]}


def _extrude(length, speed=5):
    length = printer_control._number(length, "Length", -LIMITS["extrude_mm"], LIMITS["extrude_mm"])
    return printer_control.extrude(length, speed)


def _gcode(command):
    command = re.sub(r"\s+", " ", str(command or "")).strip()
    if not _SAFE_GCODE.match(command):
        raise Refused("The assistant only sends read-only G-code (such as M114 or M105) as typed text. "
                      "Moves, heat and settings go through its named tools, which check every value")
    return printer_control.send_gcode(command)


def _start_print(filename):
    name = file_library.clean_name(filename)
    if not file_library.exists(name):
        raise ValueError(f"No file called {name} in the library")
    return {"handoff": "confirm_print", "filename": name,
            "note": "Confirm Print is open for the owner. Only their tap starts a print."}


def _look():
    data, mime = mock_moonraker.camera_snapshot()
    if not mime.startswith("image/") or "svg" in mime:
        return {"note": "This is a demo printer: its camera is a drawing, so there is no picture to study."}
    if len(data) > 4 * 1024 * 1024:
        return {"note": "The camera picture is too large to send."}
    return {"note": "The camera picture is attached to this message.", "_image": (mime, base64.b64encode(data).decode())}


# -- models: small, exact edits that write a new file beside the original ------

def _triangles(name):
    name = file_library.clean_name(name)
    if file_library.kind_of(name) not in ("stl", "3mf", "obj"):
        raise ValueError(f"{name} isn't a 3D model (STL, 3MF or OBJ)")
    data = file_library.read_bytes(name)
    if len(data) > MAX_MODEL_BYTES:
        raise Refused("That model is larger than 30 MB, which is too big for the assistant to edit here")
    triangles, _ = mesh_tools.parse_model(data, name)
    if not triangles:
        raise ValueError(f"{name} holds no triangles")
    return name, triangles


def _model_info(name):
    name, triangles = _triangles(name)
    box = mesh_tools.bounds(triangles)
    machine = (_state().get("machine") or {}).get("max_mm")
    fits = None
    if isinstance(machine, list) and len(machine) == 3:
        fits = all(box["size"][i] <= float(machine[i]) for i in range(3))
    return {"name": name, "triangles": len(triangles), "size_mm": box["size"], "lowest_z": round(box["min"][2], 3),
            "fits_this_printer": fits}


def _save_model(triangles, stem, what):
    box = mesh_tools.bounds(triangles)
    # Sit it on the bed and centre it, so the result is ready for a plate.
    dx, dy, dz = (-(box["min"][0] + box["max"][0]) / 2, -(box["min"][1] + box["max"][1]) / 2, -box["min"][2])
    triangles = [tuple((p[0] + dx, p[1] + dy, p[2] + dz) for p in t) for t in triangles]
    name = file_library.clean_name(f"{stem}-{what}.stl")
    file_library.save(name, mesh_tools.to_binary_stl(triangles), origin="assistant",
                      note=f"Made by the assistant: {what}")
    return {"saved_as": name, "size_mm": mesh_tools.bounds(triangles)["size"], "triangles": len(triangles)}


def _edit_model(name, scale=None, scale_xyz=None, fit_mm=None, rotate_axis=None, rotate_degrees=None, mirror=None):
    name, triangles = _triangles(name)
    stem, done = os.path.splitext(name)[0], []
    number = printer_control._number
    if fit_mm not in (None, ""):
        longest = max(mesh_tools.bounds(triangles)["size"]) or 1
        scale = number(fit_mm, "Fit size", 1, 1000) / longest
    factors = None
    if scale not in (None, ""):
        f = number(scale, "Scale", 0.01, 100)
        factors = (f, f, f)
    elif isinstance(scale_xyz, list) and len(scale_xyz) == 3:
        factors = tuple(number(v, "Scale", 0.01, 100) for v in scale_xyz)
    if factors:
        triangles = [tuple((p[0] * factors[0], p[1] * factors[1], p[2] * factors[2]) for p in t) for t in triangles]
        done.append("scaled")
    if rotate_degrees not in (None, ""):
        axis = str(rotate_axis or "Z").upper()
        if axis not in printer_control.VALID_AXES:
            raise ValueError("Rotate about X, Y or Z")
        a = math.radians(number(rotate_degrees, "Angle", -360, 360))
        c, s = math.cos(a), math.sin(a)
        turn = {"X": lambda p: (p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c),
                "Y": lambda p: (p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c),
                "Z": lambda p: (p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2])}[axis]
        triangles = [tuple(turn(p) for p in t) for t in triangles]
        done.append("turned")
    if mirror not in (None, ""):
        i = "XYZ".find(str(mirror).upper())
        if i < 0:
            raise ValueError("Mirror across X, Y or Z")
        flip = lambda p: tuple(-v if k == i else v for k, v in enumerate(p))  # noqa: E731
        triangles = [tuple(flip(p) for p in reversed(t)) for t in triangles]   # reversed: the faces stay outward
        done.append("mirrored")
    if not done:
        raise ValueError("Say what to change: scale, fit_mm, rotate_degrees or mirror")
    return _save_model(triangles, stem, "-".join(done))


def _make_shape(shape, width=20, depth=20, height=20, diameter=20, segments=48, name=None):
    number = printer_control._number
    shape = str(shape or "").lower()
    h = number(height, "Height", 0.2, 270)
    tris = []
    if shape == "box":
        w, d = number(width, "Width", 0.2, 270), number(depth, "Depth", 0.2, 270)
        v = [(0, 0, 0), (w, 0, 0), (w, d, 0), (0, d, 0), (0, 0, h), (w, 0, h), (w, d, h), (0, d, h)]
        for a, b, c, e in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            tris += [(v[a], v[b], v[c]), (v[a], v[c], v[e])]
    elif shape in ("cylinder", "cone"):
        r = number(diameter, "Diameter", 0.2, 270) / 2
        n = int(number(segments, "Segments", 3, 256))
        top = 0 if shape == "cone" else r
        ring = [(math.cos(2 * math.pi * i / n), math.sin(2 * math.pi * i / n)) for i in range(n)]
        for i in range(n):
            (x0, y0), (x1, y1) = ring[i], ring[(i + 1) % n]
            lo0, lo1, hi0, hi1 = (r * x0, r * y0, 0), (r * x1, r * y1, 0), (top * x0, top * y0, h), (top * x1, top * y1, h)
            tris.append(((0, 0, 0), lo1, lo0))
            tris.append((lo0, lo1, hi1))
            if top:
                tris += [(lo0, hi1, hi0), ((0, 0, h), hi0, hi1)]
    else:
        raise ValueError("The assistant can make a box, a cylinder or a cone")
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", str(name or shape)).strip("-")[:40] or shape
    return _save_model(tris, stem, "shape")


def _tool(level, what, args, run):
    return {"level": level, "what": what, "args": args, "run": run}


# level: read (looks only) | safe (reversible, low energy) | ask (heats, extrudes, or hard to undo)
#        | handoff (opens a screen for the owner; the assistant can't finish it)
TOOLS = {
    "status": _tool("read", "The printer's state, temperatures, position, file and progress.", "", lambda: _brief_state()),
    "files": _tool("read", "The files in the library.", "", lambda: {"files": _files()}),
    "file_info": _tool("read", "What a file needs: time, filament, heads, warnings.", "name", _file_info),
    "queue": _tool("read", "The print queue.", "", lambda: print_queue.get()),
    "maintenance": _tool("read", "Care tasks and what is due.", "", lambda: maintenance.get_status()),
    "filament": _tool("read", "Spools on hand and their remaining weight.", "", lambda: filament_inventory.get_inventory()),
    "filament_check": _tool("read", "Whether the loaded job has enough of the right filament.", "",
                            lambda: filament_inventory.check_job_requirements()),
    "history": _tool("read", "Past prints: success rate and findings from them.", "", lambda: insights.current()),
    "costs": _tool("read", "What past prints cost, from the owner's prices.", "",
                   lambda: {"jobs": cost_calculator.cost_history()[:15]}),
    "health": _tool("read", "The pre-print health score and what blocks a start.", "", lambda: print_gate.printer_health()),
    "console": _tool("read", "Recent commands and the printer's replies.", "",
                     lambda: {"log": printer_control.get_console_log(20)}),
    "look": _tool("read", "Take a camera picture and study it.", "", _look),
    "model_info": _tool("read", "A 3D model's size, triangle count and whether it fits.", "name", _model_info),

    "home": _tool("safe", "Home axes.", 'axes: ["X","Y","Z"] (optional, default all)', lambda axes=None: printer_control.home(axes)),
    "move_to": _tool("safe", "Move the head to a position in mm.", "x, y, z, speed (all optional, mm and mm/s)", _move),
    "move_by": _tool("safe", "Move one axis by a distance in mm.", "axis, distance, speed (optional)", _move_by),
    "fan": _tool("safe", "Set the part-cooling fan.", "percent 0-100", lambda percent: printer_control.set_fan(percent)),
    "speed": _tool("safe", "Set the print speed factor.", "percent", lambda percent: printer_control.set_factor("speed", percent)),
    "light": _tool("safe", "Set a light the printer lists.", "name, red, green, blue, white (each 0-1)",
                   lambda name, red=0, green=0, blue=0, white=0: printer_control.set_led(name, red, green, blue, white)),
    "pause": _tool("safe", "Pause the print.", "", lambda: printer_control.pause_print()),
    "resume": _tool("safe", "Resume a paused print.", "", lambda: printer_control.resume_print()),
    "cool_down": _tool("safe", "Switch every heater off.", "", _cool_down),
    "queue_add": _tool("safe", "Add a file to the print queue.", "filename", lambda filename: print_queue.add(filename)),
    "gcode": _tool("safe", "Send one read-only G-code command (M114, M105, M115, M119, STATUS...).", "command", _gcode),
    "emergency_stop": _tool("safe", "Stop the printer at once (M112).", "", lambda: printer_control.emergency_stop()),
    "edit_model": _tool("safe", "Make a changed copy of a model: scale, fit to a size, turn or mirror.",
                        "name, scale | scale_xyz [x,y,z] | fit_mm, rotate_axis, rotate_degrees, mirror", _edit_model),
    "make_shape": _tool("safe", "Make a simple model: box, cylinder or cone, in mm.",
                        "shape, width, depth, height, diameter, name (optional)", _make_shape),

    "nozzle_temp": _tool("ask", "Heat or cool one head.", "toolhead T0-T3, target in C", _nozzle),
    "bed_temp": _tool("ask", "Heat or cool the bed.", "target in C", lambda target: printer_control.set_bed_temperature(target)),
    "extrude": _tool("ask", "Push filament (negative pulls back).", "length mm, speed mm/s (optional)", _extrude),
    "flow": _tool("ask", "Set the flow factor.", "percent 50-150", lambda percent: printer_control.set_factor("flow", percent)),
    "z_nudge": _tool("ask", "Raise or lower the nozzle a little during a first layer.", "delta mm, -0.2 to 0.2",
                     lambda delta: printer_control.z_nudge(delta)),
    "pick_head": _tool("ask", "Change to another head.", "toolhead T0-T3",
                       lambda toolhead: printer_control.pick_up(str(toolhead or "").upper())),
    "feed": _tool("ask", "Run the printer's automatic filament feed for a head.", "toolhead T0-T3",
                  lambda toolhead: printer_control.feed(str(toolhead or "").upper())),
    "macro": _tool("ask", "Run one of the printer's own macros by name.", "name, params (optional object)",
                   lambda name, params=None: printer_control.run_macro(name, params)),
    "bed_mesh": _tool("ask", "Probe the bed (bed mesh calibration).", "", lambda: printer_control.bed_mesh()),
    "motors_off": _tool("ask", "Switch the motors off.", "", lambda: printer_control.motors_off()),
    "cancel_print": _tool("ask", "Cancel the running print.", "", lambda: printer_control.cancel_print()),

    "start_print": _tool("handoff", "Open Confirm Print for a file. Only the owner's tap starts it.", "filename", _start_print),
}
_ALWAYS_ASK = {"cancel_print"}
_NEEDS_PRINTER = {name for name, t in TOOLS.items() if t["level"] != "read"} - {"edit_model", "make_shape", "queue_add"}
_NEEDS_PRINTER |= {"status", "console", "look", "health", "filament_check"}
_FILE_TOOLS = {"files", "file_info", "model_info", "edit_model", "make_shape", "start_print"}
_WRITES_PRINTER = _NEEDS_PRINTER - {"status", "console", "look", "health", "filament_check", "start_print"}


def _label(name, args):
    """What a step does, in the owner's words, for the chat and the approval card."""
    a = args
    g = lambda k, d="": a.get(k, d)  # noqa: E731
    words = {
        "home": lambda: "Home " + (", ".join(str(x).upper() for x in g("axes")) if g("axes") else "all axes"),
        "move_to": lambda: "Move to " + " ".join(f"{k.upper()} {a[k]}" for k in ("x", "y", "z") if a.get(k) not in (None, "")),
        "move_by": lambda: f"Move {str(g('axis')).upper()} by {g('distance')} mm",
        "fan": lambda: f"Set the fan to {g('percent')}%",
        "speed": lambda: f"Set print speed to {g('percent')}%",
        "flow": lambda: f"Set flow to {g('percent')}%",
        "light": lambda: f"Set the light {g('name')}",
        "pause": lambda: "Pause the print", "resume": lambda: "Resume the print",
        "cool_down": lambda: "Switch every heater off",
        "queue_add": lambda: f"Add {g('filename')} to the queue",
        "gcode": lambda: f"Send {g('command')}",
        "emergency_stop": lambda: "Emergency stop",
        "nozzle_temp": lambda: f"Set {str(g('toolhead')).upper()} to {g('target')} °C",
        "bed_temp": lambda: f"Set the bed to {g('target')} °C",
        "extrude": lambda: f"{'Pull back' if _neg(g('length')) else 'Push'} {str(g('length')).lstrip('-')} mm of filament",
        "z_nudge": lambda: f"Nudge the nozzle {g('delta')} mm",
        "pick_head": lambda: f"Change to head {str(g('toolhead')).upper()}",
        "feed": lambda: f"Feed filament to {str(g('toolhead')).upper()}",
        "macro": lambda: f"Run the macro {g('name')}",
        "bed_mesh": lambda: "Probe the bed", "motors_off": lambda: "Switch the motors off",
        "cancel_print": lambda: "Cancel the print",
        "start_print": lambda: f"Open Confirm Print for {g('filename')}",
        "edit_model": lambda: f"Make a changed copy of {g('name')}",
        "make_shape": lambda: f"Make a {g('shape')}",
        "look": lambda: "Look through the camera",
    }
    try:
        return words[name]() if name in words else TOOLS[name]["what"].rstrip(".")
    except Exception:
        return name


def _neg(value):
    try:
        return float(value) < 0
    except (TypeError, ValueError):
        return False


def _needs_yes(name, args, mode):
    """Does this step wait for the owner? Cooling and stopping never do; they only make things safer."""
    level = TOOLS[name]["level"]
    if level in ("read", "handoff") or name == "emergency_stop":
        return False
    if name in _ALWAYS_ASK:
        return True
    if mode == "ask":
        return True
    if mode == "free":
        return False
    if name in ("nozzle_temp", "bed_temp"):
        try:
            return float(args.get("target")) > 0
        except (TypeError, ValueError):
            return True
    if name == "speed":
        try:
            return not (LIMITS["speed_percent"][0] <= float(args.get("percent")) <= LIMITS["speed_percent"][1])
        except (TypeError, ValueError):
            return True
    return level == "ask"


def _check_allowed(name, ctx):
    """The gates every sender passes: module switches, a printer to talk to, watch-only, the restart hold."""
    if name in _FILE_TOOLS and not modules.is_enabled("file_library"):
        raise Refused("The file library is switched off")
    if name in ("queue", "queue_add") and not modules.is_enabled("print_queue"):
        raise Refused("The print queue is switched off")
    if name == "look" and not modules.is_enabled("camera"):
        raise Refused("The camera is switched off in Settings")
    if name in _NEEDS_PRINTER:
        if not ctx["live"]:
            raise Refused("No printer is connected, so there is nothing to read or move. Add a printer, or turn "
                          "on demo data to try this on a simulated one")
        if name in _WRITES_PRINTER:
            if not modules.is_enabled("printer_control"):
                raise Refused("Printer control is switched off")
            real = mock_moonraker.is_real(ctx["printer"])
            if real and name != "emergency_stop":
                if watch_only.is_on():
                    raise Refused(watch_only.MESSAGE)
                if update_hold.active():
                    raise Refused(update_hold.MESSAGE)


def _carry_out(name, args, ctx):
    """Run one tool. Returns (ok, result). Never raises: a refusal is a result the model reads."""
    tool = TOOLS[name]
    try:
        _check_allowed(name, ctx)
        result = tool["run"](**args)
        if name in _WRITES_PRINTER:
            try:
                live_feed.refresh(ctx["printer"])       # the twin shows the change now, not at the next tick
            except Exception:
                pass
        return True, result if isinstance(result, dict) else {"result": result}
    except TypeError as error:
        return False, {"refused": f"Wrong arguments for {name} ({tool['args'] or 'it takes none'}): {error}"}
    except Exception as error:                          # the printer's refusal, a limit, a missing file
        return False, {"refused": str(error) or error.__class__.__name__}


# ---- the conversation -------------------------------------------------------

_ACTION = re.compile(r"```action\s*(.*?)```", re.S | re.I)


def parse(answer):
    """Split a model's answer into the words for the owner and the steps it asks for."""
    actions = []
    for block in _ACTION.findall(answer or ""):
        try:
            data = json.loads(block)
        except ValueError:
            actions.append({"tool": "", "args": {}, "error": "That action block wasn't valid JSON"})
            continue
        for item in data if isinstance(data, list) else [data]:
            if isinstance(item, dict):
                args = item.get("args")
                actions.append({"tool": str(item.get("tool") or ""), "args": args if isinstance(args, dict) else {}})
    return _ACTION.sub("", answer or "").strip(), actions


def _system(ctx, mode):
    lines = [
        "You are the assistant built into Deja Vu1, a dashboard for Snapmaker U1 3D printers (four heads, "
        "T0 to T3, 270 x 270 x 270 mm). You help the owner run, understand and look after their printer.",
        "Write short, plain answers. Say what you did and what the printer reported. Never invent a reading: "
        "use a tool to get it, and say so when something isn't known.",
        "",
        "To use a tool, write a fenced block exactly like this, with one JSON object (or a list of them):",
        '```action\n{"tool": "home", "args": {"axes": ["X", "Y"]}}\n```',
        "You may put a sentence before the block. After your message Deja Vu1 runs the steps in order and "
        "sends you the results; then you answer the owner. Ask for several steps at once when the task needs "
        "them. Don't repeat a step that was refused with the same values; explain the refusal instead.",
        "",
        "Safety, enforced by Deja Vu1 whatever you write: temperatures above the heater limits, moves outside "
        f"the printer's size, moves before homing and moves closer than {LIMITS['z_floor_mm']:g} mm to the bed "
        "are refused. You cannot start a print: start_print opens Confirm Print and the owner taps it. "
        "Raw G-code is read-only. Heat only what the task needs, and cool down when asked to stop.",
        f"The owner's setting is: {MODES[mode]} A step that needs their yes is shown to them with Approve and "
        "Decline; you get the outcome.",
        "",
        "Tools (name: arguments, then what it does):",
    ]
    for name, tool in TOOLS.items():
        if mode == "advice" and tool["level"] != "read":
            continue
        lines.append(f"- {name}: {tool['args'] or 'no arguments'}. {tool['what']}")
    lines.append("")
    if ctx["live"]:
        try:
            lines.append("The printer right now: " + json.dumps(_brief_state(), default=str)[:1800])
        except Exception:
            lines.append("The printer's state couldn't be read just now.")
        if ctx["demo"] and not mock_moonraker.is_real(ctx["printer"]):
            lines.append("This is a simulated demo printer. Say so if the owner asks whether it is real.")
    else:
        lines.append("No printer is connected right now. You can still explain, plan and work with files.")
    return "\n".join(lines)


def _thread(tid, printer=None):
    tid = str(tid or "")
    if not re.match(r"^[A-Za-z0-9_-]{6,64}$", tid):
        raise ValueError("Bad conversation id")
    with _lock:
        thread = _threads.get(tid)
        if thread is None:
            while len(_threads) >= MAX_THREADS:
                _threads.pop(min(_threads, key=lambda k: _threads[k]["touched"]))
            thread = _threads[tid] = {"id": tid, "printer": printer, "messages": [], "history": [], "busy": False,
                                      "pending": None, "work": None, "stop": False, "seq": 0, "touched": time.time()}
        thread["touched"] = time.time()
        return thread


def _add(thread, role, **fields):
    thread["seq"] += 1
    row = {"n": thread["seq"], "role": role, "at": time.time(), **fields}
    thread["messages"].append(row)
    del thread["messages"][:-200]
    return row


def view(tid, since=0):
    """The conversation for the browser: messages after `since`, whether it is working, what waits for a yes."""
    thread = _thread(tid)
    try:
        since = int(since)
    except (TypeError, ValueError):
        since = 0
    return {"id": thread["id"], "busy": thread["busy"], "seq": thread["seq"],
            "messages": [m for m in thread["messages"] if m["n"] > since or m.get("changed", 0) > since],
            "pending": thread["pending"]}


def _touch(thread, row):
    thread["seq"] += 1
    row["changed"] = thread["seq"]


def _results_text(results):
    lines = ["[Deja Vu1] Results of your steps:"]
    for name, ok, result in results:
        shown = {k: v for k, v in result.items() if not k.startswith("_") and k != "confirmed_state"}
        lines.append(f"- {name}: {'done' if ok else 'NOT done'} {json.dumps(shown, default=str)[:MAX_RESULT]}")
    return "\n".join(lines)


def _advance(thread, ctx):
    """
    Carry on with the steps of the current answer until they are done or one waits for the owner.
    Returns True when the results are ready to go back to the model.
    """
    work = thread["work"]
    mode = _settings()["mode"]
    while work["index"] < len(work["actions"]):
        if thread["stop"]:
            return False
        action = work["actions"][work["index"]]
        name, args = action["tool"], action["args"]
        if action.get("error") or name not in TOOLS:
            work["results"].append((name or "?", False, {"refused": action.get("error") or f"There is no tool called {name}"}))
            work["index"] += 1
            continue
        tool = TOOLS[name]
        row = action.get("row")
        if row is None:
            row = action["row"] = _add(thread, "action", tool=name, level=tool["level"], label=_label(name, args),
                                       args=args, status="running")
        decided = action.get("decided")
        if tool["level"] != "read" and mode == "advice" and name != "emergency_stop":
            ok, result = False, {"refused": "The owner set the assistant to advice only, so it sends the printer nothing"}
        elif work["done"] >= MAX_ACTIONS:
            ok, result = False, {"refused": f"That is more than {MAX_ACTIONS} steps for one request"}
        elif decided is False:
            ok, result = False, {"refused": "The owner declined this step"}
        elif decided is None and _needs_yes(name, args, mode):
            row["status"] = "waiting"
            _touch(thread, row)
            thread["pending"] = {"n": row["n"], "tool": name, "label": row["label"], "args": args}
            return False
        else:
            ok, result = _carry_out(name, args, ctx)
            work["done"] += 1
        image = result.pop("_image", None)
        if image:
            work["images"].append(image)
        row["status"] = "declined" if decided is False else "done" if ok else "refused"
        row["detail"] = result.get("refused") or result.get("note") or ""
        if result.get("handoff"):
            row["handoff"] = {"kind": result["handoff"], "filename": result.get("filename")}
        if result.get("saved_as"):
            row["file"] = result["saved_as"]
        _touch(thread, row)
        work["results"].append((name, ok, result))
        work["index"] += 1
    return True


def _run(thread, ctx):
    """One request, start to finish (or until a step waits). Runs on its own thread."""
    try:
        with mock_moonraker.selection_only(ctx["printer"]):
            settings = _settings()
            pid, model = settings["provider"], settings["models"].get(settings["provider"], "")
            while not thread["stop"]:
                work = thread["work"]
                if work is not None:
                    if not _advance(thread, ctx):
                        return                              # waiting for a yes, or stopped
                    images = work["images"] if ai_providers.supports_pictures(pid) else []
                    text = _results_text(work["results"])
                    if work["images"] and not images:
                        text += "\n(The picture can't be sent over this connection. Say so; don't describe it.)"
                    thread["history"].append({"role": "user", "text": text, "images": images})
                    thread["work"] = None
                    if thread["rounds"] >= MAX_ROUNDS:
                        _add(thread, "note", text="That was a lot of steps for one request, so the assistant stopped "
                                                  "here. Ask it to carry on if there is more to do.")
                        return
                thread["rounds"] += 1
                answer = ai_providers.ask(pid, model, _system(ctx, settings["mode"]), thread["history"][-40:])
                thread["history"].append({"role": "assistant", "text": answer})
                say, actions = parse(answer)
                if say:
                    _add(thread, "assistant", text=say[:MAX_TEXT])
                if not actions:
                    return
                thread["work"] = {"actions": actions, "index": 0, "results": [], "images": [], "done": 0}
    except ai_providers.AIError as error:
        _add(thread, "error", text=str(error))
    except Exception as error:
        _add(thread, "error", text=f"The assistant stopped: {error}")
    finally:
        if thread["stop"]:
            thread["work"], thread["pending"] = None, None
        thread["busy"] = False
        thread["seq"] += 1


def _start(thread, ctx):
    thread["busy"], thread["stop"] = True, False
    threading.Thread(target=_run, args=(thread, ctx), daemon=True, name="assistant").start()


def _ctx(printer_id, demo):
    connected = mock_moonraker.is_connected(printer_id)
    return {"printer": printer_id, "demo": bool(demo), "live": bool(connected or demo)}


def chat(tid, text, printer_id, demo=False, context=None):
    """The owner says something. The answer arrives through view()."""
    text = str(text or "").strip()
    if not text:
        raise ValueError("Type a message first")
    if len(text) > MAX_TEXT:
        raise ValueError("That message is too long")
    s = status()
    if not s["ready"]:
        raise ValueError("Connect an AI first: open the assistant's Connect screen")
    thread = _thread(tid, printer_id)
    if thread["busy"] or thread["pending"]:
        raise ValueError("The assistant is still working on the last request. Stop it first to send another")
    _add(thread, "user", text=text)
    sent = text
    if context:
        sent = "[What the owner is looking at]\n" + str(context)[:4000] + "\n\n[Their message]\n" + text
    thread["history"].append({"role": "user", "text": sent})
    thread["rounds"], thread["work"] = 0, None
    _start(thread, _ctx(printer_id, demo))
    return view(tid, thread["seq"] - 1)


def decide(tid, n, approve, printer_id, demo=False):
    """The owner's yes or no to the step that is waiting."""
    thread = _thread(tid)
    pending = thread["pending"]
    if not pending or pending["n"] != n or thread["busy"] or not thread["work"]:
        raise ValueError("That step isn't waiting any more")
    action = thread["work"]["actions"][thread["work"]["index"]]
    action["decided"] = bool(approve)
    thread["pending"] = None
    _start(thread, _ctx(printer_id, demo))
    return view(tid, 0)


def stop(tid):
    thread = _thread(tid)
    thread["stop"] = True
    if not thread["busy"]:
        for m in thread["messages"]:
            if m.get("status") == "waiting":
                m["status"] = "declined"
                _touch(thread, m)
        thread["work"], thread["pending"] = None, None
    return view(tid, 0)


def clear(tid):
    stop(tid)
    with _lock:
        _threads.pop(str(tid), None)
    return {"cleared": True}
