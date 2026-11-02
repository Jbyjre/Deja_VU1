"""
printer_control.py
===================

Direct control over what the printer is doing right now: pause, resume,
cancel, set a temperature, home an axis, or send a raw G-code line.

Like maintenance.py, this module needs no extra hardware, only a live
connection to Moonraker. Every function calls mock_moonraker, which runs
the command against the simulation or hands it to the real printer's
moonraker_client, depending on which printer is selected.
"""

import threading

import file_library
import mock_moonraker
import print_gate
import printer_extras

_start_locks = {}
_start_locks_guard = threading.Lock()


def _start_lock(printer_id):
    with _start_locks_guard:
        return _start_locks.setdefault(printer_id, threading.Lock())

VALID_AXES = {"X", "Y", "Z"}
MIN_TEMP = 0
MAX_TEMP = 300
MAX_BED_TEMP = 120
MAX_GCODE_LENGTH = 200


def get_capabilities():
    """What this dashboard is currently allowed to do to the printer."""
    return {
        "actions": ["start", "pause", "resume", "cancel", "exclude_object", "set_temperature", "home", "gcode",
                    "jog", "move", "z_nudge", "extrude", "speed", "flow", "fan", "pressure_advance", "limits",
                    "motors_off", "bed_mesh", "macro", "tool", "estop"],
        "toolheads": list(mock_moonraker.TOOLHEADS),
        "temperature_range": {"min": MIN_TEMP, "max": MAX_TEMP},
    }


class PrintBlocked(Exception):
    """The safety interlock refused to start a print; carries the reasons."""

    def __init__(self, gate):
        super().__init__("; ".join(gate["blocking"]) or "Confirmation required")
        self.gate = gate


def start_print(filename, confirmed=False):
    """
    Start a print from the file library - with the interlock in front of it.

    The Confirm Print gate runs again here, on the server, at the moment of
    starting (not just when the confirm screen was drawn - things change):
      - "blocked": refused, whatever the caller says.
      - "confirm": refused unless the caller passes confirmed=True, which
        the dashboard only sends from the final confirm screen.
    Then the file is uploaded to the printer and the print is started, the
    same two calls a real Moonraker needs.
    """
    if not file_library.exists(filename):
        raise ValueError(f"No file called {filename} in the library")
    # One start at a time per printer: with a real printer the upload and
    # start take a while, and two devices pressing Start together must get
    # one print and one clear refusal - not two uploads racing.
    lock = _start_lock(mock_moonraker.selected_printer_id())
    if not lock.acquire(blocking=False):
        raise ValueError("A print is being started on this printer right now - wait for it to finish starting")
    try:
        return _start_locked(filename, confirmed)
    finally:
        lock.release()


def _start_locked(filename, confirmed):
    gate = print_gate.summary(filename)
    if gate["verdict"] == "blocked" or (gate["verdict"] == "confirm" and not confirmed):
        raise PrintBlocked(gate)
    if not confirmed:
        raise PrintBlocked({**gate, "blocking": [], "verdict": "confirm",
                            "warnings": gate["warnings"] or ["Confirm the print summary to start"]})
    data = file_library.read_bytes(filename)
    # The file's bytes, not just its size: a real printer stores exactly
    # these (checked on arrival by their SHA-256) before it prints them.
    mock_moonraker.upload_file(filename, len(data), data)
    state = mock_moonraker.start_print(filename, gate["job"])
    file_library.touch(filename, "last_printed")
    return state


def pause_print():
    return mock_moonraker.pause_print()


def resume_print():
    return mock_moonraker.resume_print()


def cancel_print():
    return mock_moonraker.cancel_print()


def clear_error():
    """
    Klipper's FIRMWARE_RESTART, to recover a printer that has stopped with an
    error. Only while it reports an error: a restart at any other time would
    abandon a running print.
    """
    state = mock_moonraker.get_printer_state()
    if state.get("state") != "error":
        raise ValueError("The printer isn't reporting an error, so there is nothing to restart for")
    return mock_moonraker.clear_error()


def exclude_object(name):
    """
    Skip one labelled object for the rest of the print - the others carry
    on (Klipper's EXCLUDE_OBJECT). The name must be one the running file
    defined; the result is read back, and anything short of the printer
    listing it as skipped is reported as a failure, never as done.
    """
    name = str(name or "").strip().upper()
    if not name or len(name) > 128 or any(c.isspace() or c in ';"\'\\' or ord(c) < 32 for c in name):
        raise ValueError("Choose an object from the plate to skip")
    state = mock_moonraker.exclude_object(name)
    if name not in ((state.get("objects") or {}).get("excluded") or []):
        raise mock_moonraker.PrinterCommandError(f"The printer didn't confirm it is skipping {name}")
    return state


def set_temperature(toolhead, target):
    if toolhead not in mock_moonraker.TOOLHEADS:
        raise ValueError(f"Unknown toolhead: {toolhead}")
    try:
        target = float(target)
    except (TypeError, ValueError):
        raise ValueError("Target temperature must be a number")
    if not (MIN_TEMP <= target <= MAX_TEMP):
        raise ValueError(f"Target temperature must be between {MIN_TEMP} and {MAX_TEMP}")
    return mock_moonraker.set_target_temperature(toolhead, target)


def set_bed_temperature(target):
    try:
        target = float(target)
    except (TypeError, ValueError):
        raise ValueError("Bed temperature must be a number")
    if not (MIN_TEMP <= target <= MAX_BED_TEMP):
        raise ValueError(f"Bed temperature must be between {MIN_TEMP} and {MAX_BED_TEMP}")
    return mock_moonraker.set_bed_temperature(target)


def home(axes):
    axes = axes or ["X", "Y", "Z"]
    if not isinstance(axes, list) or not axes:
        raise ValueError("axes must be a non-empty list")
    cleaned = [str(a).upper() for a in axes]
    bad = [a for a in cleaned if a not in VALID_AXES]
    if bad:
        raise ValueError(f"Unknown axis: {', '.join(bad)}")
    return mock_moonraker.home_axes(cleaned)


def send_gcode(command):
    command = str(command or "").strip()
    if not command:
        raise ValueError("G-code command cannot be empty")
    if len(command) > MAX_GCODE_LENGTH:
        raise ValueError("G-code command is too long")
    return mock_moonraker.run_gcode(command)


def get_console_log(limit=30):
    return mock_moonraker.get_console_log(limit)


# ---------------------------------------------------------------------------
# Hands-on controls: move, extrude, speed, flow, fan, pressure advance, bed mesh,
# the printer's own macros and the emergency stop. Each one becomes standard
# Klipper G-code (docs/G-Codes.md in Snapmaker's u1-klipper), checked here first so
# a typo or a stale page can never send a wild number. Motion is refused while a
# print runs; tuning (speed, flow, fan, pressure advance, Z nudge) is what a running
# print is for, so it stays open.
# ---------------------------------------------------------------------------

JOG_STEPS = (0.01, 0.05, 0.1, 0.5, 1, 5, 10, 25, 50, 100)
MAX_JOG_SPEED = {"X": 300, "Y": 300, "Z": 15}            # mm/s, kept gentle for hand moves
DEFAULT_JOG_SPEED = {"X": 100, "Y": 100, "Z": 10}
MAX_EXTRUDE_MM = 100
MAX_EXTRUDE_SPEED = 15                                   # mm/s of filament
MAX_PRESSURE_ADVANCE = 1.0
MAX_Z_NUDGE = 0.2                                        # mm per press
_MACRO_NAME = __import__("re").compile(r"^[A-Za-z0-9_]{1,64}$")


def _number(value, what, low, high):
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{what} must be a number")
    if value != value or not (low <= value <= high):
        raise ValueError(f"{what} must be between {low:g} and {high:g}")
    return value


def _idle_for(what):
    state = mock_moonraker.get_printer_state() or {}
    if state.get("state") in ("printing", "paused"):
        raise ValueError(f"{what} waits until the print finishes or is cancelled: it would move the head "
                         "through the print")
    return state


def jog(axis, distance, speed=None):
    """Move one axis by a set distance (G91 relative move, then back to G90)."""
    axis = str(axis or "").upper()
    if axis not in VALID_AXES:
        raise ValueError(f"Unknown axis: {axis or 'none'}")
    distance = _number(distance, "Distance", -100, 100)
    if abs(distance) not in JOG_STEPS:
        raise ValueError("Pick one of the step sizes: " + ", ".join(f"{s:g}" for s in JOG_STEPS) + " mm")
    speed = _number(DEFAULT_JOG_SPEED[axis] if speed in (None, "") else speed, "Speed", 1, MAX_JOG_SPEED[axis])
    state = _idle_for("Moving the head")
    homed = state.get("homed_axes")
    if homed is not None and axis.lower() not in homed:
        raise ValueError(f"Home {axis} first: the printer doesn't know where {axis} is yet")
    script = f"G91\nG1 {axis}{distance:g} F{speed * 60:.0f}\nG90"
    return mock_moonraker.tune("jog", script, {"axis": axis, "distance": distance})


def move_to(x=None, y=None, z=None, speed=None):
    """Go to a point on the bed (G90 absolute move), inside the printer's own limits."""
    state = _idle_for("Moving the head")
    machine = state.get("machine") or {}
    lows, highs = machine.get("min_mm"), machine.get("max_mm")
    if not (isinstance(lows, list) and isinstance(highs, list) and len(lows) == 3 and len(highs) == 3):
        raise ValueError("This printer hasn't reported its size, so Deja Vu1 won't guess where its edges are")
    parts, target = [], {}
    for i, (axis, value) in enumerate((("X", x), ("Y", y), ("Z", z))):
        if value in (None, ""):
            continue
        low, high = float(lows[i]), float(highs[i])
        target[axis] = _number(value, axis, low, high)
        homed = state.get("homed_axes")
        if homed is not None and axis.lower() not in homed:
            raise ValueError(f"Home {axis} first: the printer doesn't know where {axis} is yet")
        parts.append(f"{axis}{target[axis]:.2f}")
    if not parts:
        raise ValueError("Give at least one of X, Y or Z")
    speed = _number(100 if speed in (None, "") else speed, "Speed", 1, MAX_JOG_SPEED["X"])
    script = f"G90\nG1 {' '.join(parts)} F{speed * 60:.0f}"
    return mock_moonraker.tune("move", script, {"to": target})


def z_nudge(delta):
    """Raise or lower the nozzle a little during a first layer (SET_GCODE_OFFSET Z_ADJUST)."""
    delta = _number(delta, "Nudge", -MAX_Z_NUDGE, MAX_Z_NUDGE)
    if delta == 0:
        raise ValueError("Nudge by more than 0 mm")
    return mock_moonraker.tune("z_nudge", f"SET_GCODE_OFFSET Z_ADJUST={delta:+.3f} MOVE=1", {"delta": delta})


def extrude(length, speed=5):
    """Push (or pull back, with a negative length) filament on the active head: M83 + G1 E."""
    length = _number(length, "Length", -MAX_EXTRUDE_MM, MAX_EXTRUDE_MM)
    if length == 0:
        raise ValueError("Length must not be 0")
    speed = _number(speed, "Speed", 0.5, MAX_EXTRUDE_SPEED)
    state = mock_moonraker.get_printer_state() or {}
    if state.get("state") == "printing":
        raise ValueError("Pause the print first: extruding now would push filament into the print")
    active = state.get("active_toolhead")
    if not active:
        raise ValueError("No head is on the toolhead. Pick one up first, then extrude")
    head = (state.get("toolheads") or {}).get(active) or {}
    if head.get("can_extrude") is False or (head.get("can_extrude") is None
                                            and (head.get("temperature") or 0) < 170):
        raise ValueError(f"Heat {active} first: Klipper refuses to extrude below its minimum temperature")
    script = f"M83\nG1 E{length:g} F{speed * 60:.0f}"
    return mock_moonraker.tune("extrude", script, {"length": length, "head": active})


def set_factor(kind, percent):
    """Speed (M220) or flow (M221) override, as a percentage."""
    if kind not in ("speed", "flow"):
        raise ValueError("Factor must be speed or flow")
    low, high = (10, 300) if kind == "speed" else (50, 150)
    percent = round(_number(percent, f"{kind.title()} factor", low, high))
    code = "M220" if kind == "speed" else "M221"
    return mock_moonraker.tune(kind, f"{code} S{percent}", {"percent": percent})


def set_fan(percent):
    """The part-cooling fan (M106 S0-255, M107 for off)."""
    percent = _number(percent, "Fan speed", 0, 100)
    script = "M107" if percent == 0 else f"M106 S{round(percent * 255 / 100)}"
    return mock_moonraker.tune("fan", script, {"percent": percent})


def set_pressure_advance(toolhead, value, smooth_time=None):
    """SET_PRESSURE_ADVANCE for one head's extruder."""
    if toolhead not in mock_moonraker.TOOLHEADS:
        raise ValueError(f"Unknown toolhead: {toolhead}")
    value = _number(value, "Pressure advance", 0, MAX_PRESSURE_ADVANCE)
    index = mock_moonraker.TOOLHEADS.index(toolhead)
    extruder = "extruder" if index == 0 else f"extruder{index}"
    script = f"SET_PRESSURE_ADVANCE EXTRUDER={extruder} ADVANCE={value:.4f}"
    if smooth_time not in (None, ""):
        smooth_time = _number(smooth_time, "Smooth time", 0, 0.2)
        script += f" SMOOTH_TIME={smooth_time:.3f}"
    return mock_moonraker.tune("pressure_advance", script, {"head": toolhead, "value": value,
                                                            "smooth_time": smooth_time})


def set_limits(velocity=None, accel=None):
    """SET_VELOCITY_LIMIT: never above what the printer started with."""
    state = mock_moonraker.get_printer_state() or {}
    tuning = state.get("tuning") or {}
    parts, change = [], {}
    for key, word, value in (("velocity", "VELOCITY", velocity), ("accel", "ACCEL", accel)):
        if value in (None, ""):
            continue
        ceiling = tuning.get(f"config_{key}") or (1000 if key == "velocity" else 50000)
        change[key] = round(_number(value, f"Max {key}", 1, ceiling))
        parts.append(f"{word}={change[key]}")
    if not parts:
        raise ValueError("Give a velocity or an acceleration")
    return mock_moonraker.tune("limits", "SET_VELOCITY_LIMIT " + " ".join(parts), change)


def motors_off():
    _idle_for("Turning the motors off")
    return mock_moonraker.tune("motors_off", "M84", {})


def bed_mesh():
    """Probe the bed (BED_MESH_CALIBRATE). Homes first when needed, as Klipper requires."""
    state = _idle_for("Probing the bed")
    tuning = state.get("tuning") or {}
    if tuning and not tuning.get("bed_mesh"):
        raise ValueError("This printer has no bed mesh set up in its configuration")
    homed = state.get("homed_axes")
    script = "BED_MESH_CALIBRATE" if homed == "xyz" else "G28\nBED_MESH_CALIBRATE"
    return mock_moonraker.tune("bed_mesh", script, {})


def run_macro(name, params=None):
    """
    One of the printer's own macro buttons, by the exact name it lists, with the
    settings the macro's own text reads (printer_extras.macro_params). Each value
    is one word, so it can't carry a second command.
    """
    name = str(name or "").strip()
    if not _MACRO_NAME.match(name):
        raise ValueError("That isn't a macro name")
    state = mock_moonraker.get_printer_state() or {}
    macros = (state.get("tuning") or {}).get("macros") or []
    if name.upper() not in {m.upper() for m in macros}:
        raise ValueError(f"The printer doesn't list a macro called {name}")
    name = name.upper()
    params = params if isinstance(params, dict) else {}
    parts = []
    if params:
        info = mock_moonraker.printer_reading("macros").get("macros") or []
        known = {p["name"] for m in info if m.get("name") == name for p in m.get("params") or []}
        for key, value in params.items():
            key, value = str(key).strip().upper(), str(value if value is not None else "").strip()
            if value == "":
                continue
            if not printer_extras.PARAM_NAME.match(key) or key not in known:
                raise ValueError(f"{name} doesn't read a setting called {key}")
            if not printer_extras.PARAM_VALUE.match(value):
                raise ValueError(f"{key}: use one word of letters, numbers and . _ - : # + (no spaces)")
            parts.append(f"{key}={value}")
    script = " ".join([name, *parts])
    return mock_moonraker.tune("macro", script, {"name": name, "params": parts})


def _listed(kind, name, what):
    """A fan, light or sensor the printer itself lists, by its config name."""
    name = str(name or "").strip()
    state = mock_moonraker.get_printer_state() or {}
    for item in (state.get("tuning") or {}).get(kind) or []:
        if item.get("id") == name:
            return item, state
    raise ValueError(f"The printer doesn't list a {what} called {name or 'that'}")


def set_fan_generic(name, percent):
    """SET_FAN_SPEED for one of the printer's own fans (fan_generic only: the others follow a heater)."""
    fan, _ = _listed("fans", name, "fan")
    if not fan.get("settable"):
        raise ValueError(f"{fan['name']} runs by itself (it follows its heater or board), so it can't be set by hand")
    percent = _number(percent, "Fan speed", 0, 100)
    return mock_moonraker.tune("fan_generic", f"SET_FAN_SPEED FAN={fan['id']} SPEED={percent / 100:.2f}",
                               {"name": fan["id"], "percent": percent})


def set_led(name, red=0, green=0, blue=0, white=0):
    """SET_LED with each channel 0 to 1. A white-only light ignores the colour channels, as Klipper does."""
    led, _ = _listed("leds", name, "light")
    color = [_number(v if v not in (None, "") else 0, label, 0, 1)
             for v, label in ((red, "Red"), (green, "Green"), (blue, "Blue"), (white, "White"))]
    script = (f"SET_LED LED={led['id']} RED={color[0]:.2f} GREEN={color[1]:.2f} BLUE={color[2]:.2f} "
              f"WHITE={color[3]:.2f}")
    return mock_moonraker.tune("led", script, {"name": led["id"], "color": color})


def set_runout(name, enabled):
    """SET_FILAMENT_SENSOR: switch one runout sensor's check on or off."""
    sensor, _ = _listed("runout", name, "filament sensor")
    if not isinstance(enabled, bool):
        raise ValueError("Say whether the sensor should be on or off")
    return mock_moonraker.tune("runout", f"SET_FILAMENT_SENSOR SENSOR={sensor['id']} ENABLE={int(enabled)}",
                               {"name": sensor["id"], "enabled": enabled})


def mesh_profile(action, profile=None):
    """Load a saved bed mesh (BED_MESH_PROFILE LOAD=) or stop using one (BED_MESH_CLEAR). Not mid-print."""
    _idle_for("Changing the bed mesh")
    if action == "clear":
        return mock_moonraker.tune("mesh_profile", "BED_MESH_CLEAR", {"profile": None})
    if action != "load":
        raise ValueError("Load a saved mesh or clear the one in use")
    profile = str(profile or "").strip()
    saved = mock_moonraker.printer_reading("mesh").get("profiles") or []
    if profile not in saved:
        raise ValueError(f"The printer has no saved bed mesh called {profile or 'that'}")
    if not _MACRO_NAME.match(profile):
        raise ValueError("That mesh name has characters Deja Vu1 won't put in a command; load it from the console")
    return mock_moonraker.tune("mesh_profile", f"BED_MESH_PROFILE LOAD={profile}", {"profile": profile})


def feed(toolhead):
    """
    Snapmaker's automatic feeding for one head: the printer's own AUTO_FEEDING macro, which looks up
    that head's feeder module and channel itself (_FILAMENT_FEED_VARIABLE). Deja Vu1 names neither.
    """
    if toolhead not in mock_moonraker.TOOLHEADS:
        raise ValueError(f"Unknown toolhead: {toolhead}")
    _idle_for("Feeding filament")
    info = mock_moonraker.printer_reading("feeding")
    head = next((h for h in info.get("heads") or [] if h.get("head") == toolhead), None)
    if not head:
        raise ValueError(info.get("none") or f"The printer doesn't say which feeder serves {toolhead}")
    return mock_moonraker.tune("feed", f"AUTO_FEEDING EXTRUDER={head['index']}",
                               {"head": toolhead, "module": head["module"], "channel": head["channel"]})


def pick_up(toolhead):
    """Change to another head (the U1's T0-T3 tool change). Not while a print runs."""
    if toolhead not in mock_moonraker.TOOLHEADS:
        raise ValueError(f"Unknown toolhead: {toolhead}")
    _idle_for("Changing heads")
    return mock_moonraker.tune("tool", toolhead, {"head": toolhead})


def emergency_stop():
    """M112: Klipper shuts down at once. A firmware restart brings it back."""
    return mock_moonraker.run_gcode("M112")
