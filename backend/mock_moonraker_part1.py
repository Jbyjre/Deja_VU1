"""
mock_moonraker_part1.py: part 1 of 1 split out of mock_moonraker.py (one interface for simulated and real
printers) on 19 November 2026, so a session reads only the part it needs. mock_moonraker.py imports every name
here back, so `mock_moonraker.<name>` works as before. Holds: AMBIENT_C, BUILD_VOLUME_MM, DEFAULT_PRINTER_ID,
DEMO_MACROS, FILAMENT_COLORS, MAX_SANDBOX_PRINTERS, PrinterCommandError, PrinterRefused, TOOLHEADS, _FLEET_SPEC, _JOB_NAMES,
_REAL, _TUNE_TIMEOUTS, _approach, _build_print_history, _demo_objects, _demo_tuning, _fleet_lock, _plate,
_point_on_rectangle, _record_failed_job, _selected, _stop_with_error, any_connected, attach_real_printer,
detach_real_printer, diagnostics, is_sandbox_printer, printer_ids, real_printer, real_printer_ids,
selection_only, simulated_printer_ids.
"""

from contextlib import contextmanager
from datetime import datetime, timedelta
import copy
import math
import moonraker_client
import printer_problems
import threading


# Filament colors we pretend the user owns. Used by the color checker module.
FILAMENT_COLORS = [
    {"name": "Black", "hex": "#1c1c1e"},
    {"name": "White", "hex": "#f2f2f0"},
    {"name": "Snapmaker Orange", "hex": "#f26a1b"},
    {"name": "Signal Red", "hex": "#c8102e"},
    {"name": "Sky Blue", "hex": "#3b82f6"},
    {"name": "Grass Green", "hex": "#2f9e44"},
]


# The U1 is a multi-toolhead machine. These are the docks we simulate.
TOOLHEADS = ["T0", "T1", "T2", "T3"]


# Build volume of the Snapmaker U1: 270 x 270 x 270 mm (Snapmaker's spec
# sheet; Snapmaker Orca's own U1 profile uses the same 270 mm bed).
BUILD_VOLUME_MM = {"x": 270.0, "y": 270.0, "z": 270.0}


# Names used to make the fake print history look like a real person's folder.
_JOB_NAMES = [
    "bracket_v3.gcode", "phone_stand.gcode", "gridfinity_bin_2x1.gcode",
    "hinge_test.gcode", "cable_clip_x8.gcode", "benchy.gcode",
    "vase_spiral.gcode", "toolhead_cover.gcode", "spool_holder.gcode",
    "drawer_insert.gcode", "gopro_mount.gcode", "articulated_dragon.gcode",
    "fan_duct_r2.gcode", "keycap_set.gcode", "desk_hook.gcode",
    "battery_tray.gcode", "lamp_shade.gcode", "hex_bit_holder.gcode",
]


AMBIENT_C = 24.0


# The printer (or Moonraker) refused or failed a command - separate from
# ValueError ("the dashboard asked for something invalid"). The real client
# raises the same class, so one `except` covers both.
PrinterCommandError = moonraker_client.PrinterCommandError
PrinterRefused = moonraker_client.PrinterRefused


def _build_print_history(rng, job_count=38, days_back=64):
    """
    Create a believable list of past print jobs.

    Spreads `job_count` jobs across the last `days_back` days. Most prints
    succeed (that is realistic); a few fail or get cancelled. Each job records
    how long it ran, how much filament it ate, and which toolheads it used.

    Returns a list of dictionaries, newest job last.
    """
    jobs = []
    now = datetime.now()

    # Pick a random moment for each job to have ended.
    offsets = sorted(
        (rng.uniform(0, days_back) for _ in range(job_count)),
        reverse=True,
    )

    for i, days_ago in enumerate(offsets):
        # Each job's end is the random moment, so every job in the history
        # has already finished - none ends in the future.
        ended = now - timedelta(days=days_ago)

        # Print length: mostly short-to-medium jobs, occasionally an overnighter.
        hours = rng.choice([
            rng.uniform(0.3, 1.5),    # quick print
            rng.uniform(1.5, 5.0),    # normal print
            rng.uniform(5.0, 14.0),   # long print
        ])

        # ~85% of prints finish. The rest fail or get cancelled by the user.
        roll = rng.random()
        if roll < 0.85:
            status = "completed"
            actual_hours = hours
        elif roll < 0.94:
            status = "error"          # printer aborted it
            actual_hours = hours * rng.uniform(0.1, 0.7)
        else:
            status = "cancelled"      # user stopped it
            actual_hours = hours * rng.uniform(0.05, 0.5)

        # Rough filament estimate: about 12 grams per hour of printing.
        grams = round(actual_hours * rng.uniform(9, 16), 1)

        color = rng.choice(FILAMENT_COLORS)
        started = ended - timedelta(hours=actual_hours)

        jobs.append({
            "job_id": f"job-{i + 1:03d}",
            "filename": rng.choice(_JOB_NAMES),
            "status": status,
            "start_time": started.isoformat(timespec="seconds"),
            "end_time": ended.isoformat(timespec="seconds"),
            "print_duration_hours": round(actual_hours, 2),
            "filament_used_grams": grams,
            "filament_type": rng.choice(["PLA", "PLA", "PETG", "ABS"]),
            "filament_color_name": color["name"],
            "filament_color_hex": color["hex"],
            "toolheads_used": sorted(
                rng.sample(TOOLHEADS, rng.randint(1, 3))
            ),
        })

    # Oldest start first, as Moonraker lists its history, numbered in that order.
    jobs.sort(key=lambda job: job["start_time"])
    for i, job in enumerate(jobs):
        job["job_id"] = f"job-{i + 1:03d}"
    return jobs


# How each simulated printer starts. Shown as "Demo printer 1/2/3" so it is
# plain they are pretend. They were "U1 · Workshop/Studio/Garage", which read
# like features (Photo studio is a tab); the ids keep those names so saved
# records still match. The first one is the original single
# printer this project always simulated - its numbers are unchanged, so every
# existing screen and test sees exactly what it saw before.
_FLEET_SPEC = [
    {
        "id": "u1-workshop", "name": "Demo printer 1", "seed": 20260907,
        "jobs": 38, "days": 64,
        # Printing the two-colour Benchy pair from the sample files
        # (sample_files.two_colour_benchy_pair_gcode): orange in T0 and
        # black in T1, as loaded, so the twin can draw the real boats in
        # their real colours. Its layer count, time and outlines are that
        # file's own.
        "scenario": {
            "state": "printing", "file": "two_benchies_two_colours.gcode",
            "progress": 0.46, "hours": 0.73, "total_hours": 1.58,
            "active": "T1", "layers": 240,
            "loaded": {"T0": 2, "T1": 0, "T2": 4, "T3": 1},
            "required": [("T0", 2, "PLA"), ("T1", 0, "PLA")],
            "footprint": [60.0, 77.0],
            "objects": [
                {"name": "3DBENCHY.STL_ID_0_COPY_0", "center": [135.0, 112.0],
                 "polygon": [[105.0, 96.5], [165.0, 96.5], [165.0, 127.5], [105.0, 127.5]]},
                {"name": "3DBENCHY.STL_ID_0_COPY_1", "center": [135.0, 158.0],
                 "polygon": [[105.0, 142.5], [165.0, 142.5], [165.0, 173.5], [105.0, 173.5]]},
            ],
            # Which head prints each boat: hull colour up to the deck (layer
            # 75, 15.0 mm), cabin colour above it.
            "object_tools": {"3DBENCHY.STL_ID_0_COPY_0": ["T0", "T1", 75],
                             "3DBENCHY.STL_ID_0_COPY_1": ["T1", "T0", 75]},
        },
    },
    {
        "id": "u1-studio", "name": "Demo printer 2", "seed": 7117,
        # A mixed-nozzle machine: a 0.2 mm detail nozzle on T3.
        "nozzles": {"T3": 0.2},
        "jobs": 24, "days": 40,
        "scenario": {
            "state": "paused", "file": "gridfinity_bin_2x1.gcode",
            # Paused the way a U1 pauses on its own: a level 2 problem, here "Printing Anomaly" for toolhead 1 (a code
            # in Snapmaker's table, with its guide and videos).
            "problem": {"level": 2, "id": 523, "index": 0, "code": 38},
            "progress": 0.72, "hours": 1.4, "total_hours": 1.95,
            "active": "T0", "layers": 140,
            "loaded": {"T0": 0, "T1": 1, "T2": 3, "T3": 5},
            "required": [("T0", 0, "PETG")],
        },
    },
    {
        "id": "u1-garage", "name": "Demo printer 3", "seed": 3301,
        "jobs": 30, "days": 55,
        "scenario": {
            "state": "ready", "file": None,
            "progress": 0.0, "hours": 0.0, "total_hours": 0.0,
            "active": None, "layers": 0,
            # Orange in T0 and black in T1: what the sample cube and coaster
            # were sliced for, so the demo tour can really start a print here.
            "loaded": {"T0": 2, "T1": 0, "T2": 5, "T3": 4},
            "required": [],
            "dock_error": "T3",
        },
    },
]


# Simulated printers list the macros a U1 owner sees in the printer's own web page
# only by kind: demo data, never a claim about which macros a real U1 has.
DEMO_MACROS = ["PREHEAT_PLA", "CLEAN_NOZZLE", "LIGHT_ON", "LIGHT_OFF"]


def _demo_tuning():
    # The chamber fan and light and the four runout sensors use the names in Snapmaker's
    # published U1 config (u1-klipper lava/printer.cfg); their values here are demo data.
    return {"speed_factor": 1.0, "extrude_factor": 1.0, "part_fan": 0.0, "max_velocity": 500, "max_accel": 20000,
            "config_velocity": 500, "config_accel": 20000, "z_offset": 0.0, "macros": list(DEMO_MACROS),
            "bed_mesh": True, "mesh_profile": None, "idle_state": "Ready", "sensors": [],
            "fans": [{"id": "cavity_fan", "name": "cavity fan", "speed": 0.0, "temperature": None, "settable": True}],
            "leds": [{"id": "cavity_led", "name": "cavity led", "color": [0.0, 0.0, 0.0, 1.0]}],
            "pins": [],
            "runout": [{"id": f"e{i}_filament", "name": f"e{i} filament", "detected": True, "enabled": True}
                       for i in range(4)],
            "feeder": True}


def _demo_objects(filename, count=3):
    """
    A plate of labelled objects for the demo farm's prints that were already
    running at start-up: named the way Orca names them (Klipper upper-cases
    them), side by side around the bed's middle, each with an outline.
    """
    stem = (filename or "part").rsplit(".", 1)[0].upper()
    out = []
    for i in range(count):
        cx, cy = 135.0 + (i - (count - 1) / 2) * 48.0, 135.0 + (12.0 if i % 2 else -12.0)
        w, d = 34.0, 26.0 + 6 * (i % 2)
        out.append({"name": f"{stem}.STL_ID_{i}_COPY_0", "center": [cx, cy],
                    "polygon": [[cx - w / 2, cy - d / 2], [cx + w / 2, cy - d / 2],
                                [cx + w / 2, cy + d / 2], [cx - w / 2, cy + d / 2]]})
    return out


def _plate(objects):
    return {"list": copy.deepcopy(objects), "excluded": [], "current": None} if objects else None


def _approach(value, target, seconds, tau):
    """First-order lag: move `value` toward `target` with time constant tau."""
    return target + (value - target) * math.exp(-seconds / tau)


def _point_on_rectangle(phase, w, d):
    """A point `phase` (0..1) of the way around a w x d rectangle's outline."""
    perimeter = 2 * (w + d)
    dist = phase * perimeter
    hw, hd = w / 2, d / 2
    if dist < w:
        return -hw + dist, -hd
    dist -= w
    if dist < d:
        return hw, -hd + dist
    dist -= d
    if dist < w:
        return hw - dist, hd
    dist -= w
    return -hw, hd - dist


_REAL = {}                    # printer_id -> moonraker_client.MoonrakerPrinter, in the order added


DEFAULT_PRINTER_ID = _FLEET_SPEC[0]["id"]


_selected = threading.local()


_fleet_lock = threading.RLock()


def printer_ids():
    """Every printer - real ones first, then the simulated ones - in display order."""
    with _fleet_lock:
        return list(_REAL) + [spec["id"] for spec in _FLEET_SPEC]


def real_printer_ids():
    with _fleet_lock:
        return list(_REAL)


def simulated_printer_ids():
    with _fleet_lock:
        return [spec["id"] for spec in _FLEET_SPEC]


@contextmanager
def selection_only(printer_id):
    """Scope local settings to an already-validated id without connecting a device."""
    previous = getattr(_selected, "printer_id", None)
    _selected.printer_id = printer_id
    try:
        yield
    finally:
        if previous is None:
            del _selected.printer_id
        else:
            _selected.printer_id = previous


def attach_real_printer(printer_id, name, url, api_key=None, on_change=None, start=True):
    """Connect a printer added by address. Replaces an earlier attachment of the same id."""
    printer = moonraker_client.MoonrakerPrinter(printer_id, name, url, api_key=api_key, on_change=on_change)
    with _fleet_lock:
        old = _REAL.pop(printer_id, None)
        _REAL[printer_id] = printer
    if old:
        old.stop()
    if start:
        printer.start()
    return printer


def detach_real_printer(printer_id):
    with _fleet_lock:
        printer = _REAL.pop(printer_id, None)
    if printer:
        printer.stop()
    return printer is not None


def real_printer(printer_id):
    return _REAL.get(printer_id)


def any_connected():
    with _fleet_lock:
        printers = list(_REAL.values())
    return any(p.is_connected() for p in printers)


# Feeding heats the head and pulls filament from the feeder, so it gets the macro allowance.
_TUNE_TIMEOUTS = {"bed_mesh": 600, "move": 120, "jog": 60, "tool": 180, "macro": 600, "feed": 600}


def diagnostics(printer_id):
    """The connection report for a real printer (None for a simulated one)."""
    printer = _REAL.get(printer_id)
    return printer.diagnostics() if printer else None


MAX_SANDBOX_PRINTERS = 24


def is_sandbox_printer(printer_id):
    with _fleet_lock:
        return any(s["id"] == printer_id and s.get("sandbox") for s in _FLEET_SPEC)


def _record_failed_job(printer, message, status="error"):
    """A print that stops with an error lands in history, as Moonraker's does."""
    live = printer.live
    hours = round(live["print_duration_hours"], 2)
    total = printer.job["total_hours"] or 1.0
    printer.session_jobs.append({
        "job_id": f"live-{len(printer.session_jobs) + 1:03d}",
        "filename": live["current_file"], "status": status,
        "start_time": (datetime.now() - timedelta(hours=hours)).isoformat(timespec="seconds"),
        "end_time": datetime.now().isoformat(timespec="seconds"),
        "print_duration_hours": hours,
        "filament_used_grams": round(printer.job["filament_grams"] * min(1.0, hours / total), 1),
        "filament_type": printer.job["material"],
        "filament_color_name": "Unknown", "filament_color_hex": "#888888",
        "toolheads_used": sorted({r["toolhead"] for r in printer.job["required_filament"]}) or ["T0"],
        "error": message,
    })


def _attach_problem(live, state_name, level, ident, index, number, message=None):
    """A simulated problem in the shape a real U1 gives it: the code with Snapmaker's words, and a state line naming it."""
    found = printer_problems.collect(state_name, {"level": level, "id": ident, "index": index, "code": number,
                                                  "message": message})
    if found:
        shown = printer_problems.public(found[0])
        live["problem"], live["problems"] = shown, [shown]
        live["state_message"] = ("Paused: " if state_name == "paused" else "") + printer_problems.words(shown)


def _clear_problem(live):
    live.pop("problem", None)
    live.pop("problems", None)


def _stop_with_error(printer, message):
    live = printer.live
    _clear_problem(live)
    if live["state"] in ("printing", "paused"):
        _record_failed_job(printer, message)
    live["state"] = "error"
    live["state_message"] = message
    live["bed_target"] = 0.0
    for data in live["toolheads"].values():
        data["target_temperature"] = 0.0
        if data["status"] == "active":
            data["status"] = "docked"
    printer.log("error", message)
