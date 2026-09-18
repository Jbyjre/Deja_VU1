"""
mock_moonraker.py
=================

Moonraker is the web API that sits in front of a Klipper-based 3D printer.
Software (like this dashboard) asks Moonraker questions such as "what is the
printer doing right now?" or "show me the list of prints I've run", and
Moonraker answers with JSON.

We do not have a real Snapmaker U1 yet, so this file *pretends* to be
Moonraker. Every function here returns the same shape of data a real
Moonraker instance would return, but the numbers are generated locally.

Why this matters: when a real printer becomes available, only this one file
needs to be swapped for a real HTTP client. Nothing else in the project talks
to the printer directly, so nothing else has to change.

Real Moonraker endpoints this file imitates:
  GET  /server/history/list       -> past print jobs
  GET  /printer/objects/query     -> live printer state (temps, progress, etc.)
  POST /printer/print/pause       -> pause_print()
  POST /printer/print/resume      -> resume_print()
  POST /printer/print/cancel      -> cancel_print()
  POST /printer/gcode/script      -> run_gcode(), home_axes(), set_target_temperature()
  GET  /machine/update/status     -> get_update_status()
"""

import copy
import random
from datetime import datetime, timedelta

# A fixed seed means the "random" data is the same every time you run the
# project. That keeps demos and screenshots consistent instead of changing
# on every reload.
_RNG = random.Random(20260907)

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

# Names used to make the fake print history look like a real person's folder.
_JOB_NAMES = [
    "bracket_v3.gcode", "phone_stand.gcode", "gridfinity_bin_2x1.gcode",
    "hinge_test.gcode", "cable_clip_x8.gcode", "benchy.gcode",
    "vase_spiral.gcode", "toolhead_cover.gcode", "spool_holder.gcode",
    "drawer_insert.gcode", "gopro_mount.gcode", "articulated_dragon.gcode",
    "fan_duct_r2.gcode", "keycap_set.gcode", "desk_hook.gcode",
    "battery_tray.gcode", "lamp_shade.gcode", "hex_bit_holder.gcode",
]


def _build_print_history(job_count=38, days_back=64):
    """
    Create a believable list of past print jobs.

    Spreads `job_count` jobs across the last `days_back` days. Most prints
    succeed (that is realistic); a few fail or get cancelled. Each job records
    how long it ran, how much filament it ate, and which toolheads it used.

    Returns a list of dictionaries, newest job last.
    """
    jobs = []
    now = datetime.now()

    # Pick a random moment for each job. Sorting largest-first means the
    # biggest "days ago" comes first, so the finished list reads oldest-first.
    offsets = sorted(
        (_RNG.uniform(0, days_back) for _ in range(job_count)),
        reverse=True,
    )

    for i, days_ago in enumerate(offsets):
        started = now - timedelta(days=days_ago)

        # Print length: mostly short-to-medium jobs, occasionally an overnighter.
        hours = _RNG.choice([
            _RNG.uniform(0.3, 1.5),    # quick print
            _RNG.uniform(1.5, 5.0),    # normal print
            _RNG.uniform(5.0, 14.0),   # long print
        ])

        # ~85% of prints finish. The rest fail or get cancelled by the user.
        roll = _RNG.random()
        if roll < 0.85:
            status = "completed"
            actual_hours = hours
        elif roll < 0.94:
            status = "error"          # printer aborted it
            actual_hours = hours * _RNG.uniform(0.1, 0.7)
        else:
            status = "cancelled"      # user stopped it
            actual_hours = hours * _RNG.uniform(0.05, 0.5)

        # Rough filament estimate: about 12 grams per hour of printing.
        grams = round(actual_hours * _RNG.uniform(9, 16), 1)

        color = _RNG.choice(FILAMENT_COLORS)

        jobs.append({
            "job_id": f"job-{i + 1:03d}",
            "filename": _RNG.choice(_JOB_NAMES),
            "status": status,
            "start_time": started.isoformat(timespec="seconds"),
            "end_time": (started + timedelta(hours=actual_hours)).isoformat(timespec="seconds"),
            "print_duration_hours": round(actual_hours, 2),
            "filament_used_grams": grams,
            "filament_type": _RNG.choice(["PLA", "PLA", "PETG", "ABS"]),
            "filament_color_name": color["name"],
            "filament_color_hex": color["hex"],
            "toolheads_used": sorted(
                _RNG.sample(TOOLHEADS, _RNG.randint(1, 3))
            ),
        })

    return jobs


# Built once when the program starts so every module sees the same history.
_PRINT_HISTORY = _build_print_history()


def is_connected():
    """
    Is a real printer connected?

    Always False right now — there is no Moonraker instance to talk to, only
    this file pretending to be one. The dashboard uses this to decide whether
    it is allowed to show any figures at all.

    When a real Moonraker client replaces this module, this becomes an actual
    reachability check against the printer.
    """
    return False


def get_print_history():
    """
    Stand-in for Moonraker's GET /server/history/list.

    Returns every simulated print job, oldest first. The maintenance module
    reads this to work out how many hours the printer has run.
    """
    return list(_PRINT_HISTORY)


def _initial_live_state():
    """The starting point for the printer's live, mutable state."""
    active = "T2"

    # Which spool is sitting in each toolhead right now. T0 and T1 are set to
    # what the current print file asks for (see get_current_job_requirements),
    # so the color checker's "everything matches" path is the normal case.
    loaded = {
        "T0": FILAMENT_COLORS[2],   # Snapmaker Orange — matches the job
        "T1": FILAMENT_COLORS[0],   # Black — matches the job
        "T2": FILAMENT_COLORS[4],   # Sky Blue
        "T3": FILAMENT_COLORS[1],   # White
    }

    return {
        "state": "printing",              # printing | ready | paused | error
        "state_message": "Printing layer 148 of 322",
        "current_file": "toolhead_cover.gcode",
        "progress": 0.46,                 # 0.0 to 1.0
        "print_duration_hours": 2.1,
        "active_toolhead": active,
        "toolheads": {
            # Each dock reports its own condition. "docked" means parked and
            # idle, "active" means currently printing, "error" means something
            # is wrong (clog, no filament, thermal fault).
            th: {
                "status": "active" if th == active else "docked",
                "temperature": 218.0 if th == active else 32.5,
                "target_temperature": 220.0 if th == active else 0.0,
                "filament_loaded": True,
                "filament_color_hex": loaded[th]["hex"],
                "filament_color_name": loaded[th]["name"],
            }
            for th in TOOLHEADS
        },
        "bed_temperature": 60.0,
    }


# The printer's live state, and the console log of commands sent to it.
# Unlike print history (fixed once at startup, like a real machine's past),
# this changes while the server runs — a real printer's live state isn't
# saved to disk either, so neither is this one. It resets on restart, which
# is the correct behavior: a real printer forgets "paused" when power-cycled.
_LIVE_STATE = _initial_live_state()
_CONSOLE_LOG = []
_MAX_CONSOLE_LOG = 100


def _log_command(kind, detail):
    _CONSOLE_LOG.append({
        "time": datetime.now().isoformat(timespec="seconds"),
        "kind": kind,
        "detail": detail,
    })
    del _CONSOLE_LOG[:-_MAX_CONSOLE_LOG]


def get_printer_state():
    """
    Stand-in for Moonraker's GET /printer/objects/query.

    Returns what the printer is "doing" right now: whether it is printing,
    how far along it is, temperatures, and which toolhead is active. The LED
    module uses this to decide what color each dock ring should be.

    Returns a copy so callers can't accidentally mutate the live state by
    editing the dict they were handed.
    """
    return copy.deepcopy(_LIVE_STATE)


def pause_print():
    """Stand-in for Moonraker's POST /printer/print/pause."""
    if _LIVE_STATE["state"] != "printing":
        raise ValueError("Nothing is printing right now")
    _LIVE_STATE["state"] = "paused"
    _LIVE_STATE["state_message"] = "Paused"
    _log_command("pause", _LIVE_STATE["current_file"])
    return get_printer_state()


def resume_print():
    """Stand-in for Moonraker's POST /printer/print/resume."""
    if _LIVE_STATE["state"] != "paused":
        raise ValueError("Printer is not paused")
    _LIVE_STATE["state"] = "printing"
    _LIVE_STATE["state_message"] = f"Printing {_LIVE_STATE['current_file']}"
    _log_command("resume", _LIVE_STATE["current_file"])
    return get_printer_state()


def cancel_print():
    """Stand-in for Moonraker's POST /printer/print/cancel."""
    if _LIVE_STATE["state"] not in ("printing", "paused"):
        raise ValueError("Nothing to cancel")
    cancelled_file = _LIVE_STATE["current_file"]
    _LIVE_STATE["state"] = "ready"
    _LIVE_STATE["state_message"] = "Idle"
    _LIVE_STATE["progress"] = 0.0
    _LIVE_STATE["current_file"] = None
    _log_command("cancel", cancelled_file)
    return get_printer_state()


def set_target_temperature(toolhead, target):
    """
    Stand-in for sending an M104/M109-style G-code through Moonraker.

    Only sets the target — this file does not simulate the temperature
    gradually climbing to meet it, the same way the rest of this project
    does not invent data it cannot back up.
    """
    if toolhead not in TOOLHEADS:
        raise ValueError(f"Unknown toolhead: {toolhead}")
    _LIVE_STATE["toolheads"][toolhead]["target_temperature"] = target
    _log_command("temperature", f"{toolhead} -> {target}°C")
    return get_printer_state()


def home_axes(axes):
    """Stand-in for sending a G28 through Moonraker."""
    _log_command("home", "".join(axes))
    return {"homed": list(axes)}


def run_gcode(command):
    """Stand-in for Moonraker's POST /printer/gcode/script."""
    _log_command("gcode", command)
    return {"command": command, "response": "ok"}


def get_console_log(limit=30):
    """Recent commands sent to the printer, newest first."""
    return list(reversed(_CONSOLE_LOG))[:limit]


def get_update_status():
    """
    Stand-in for Moonraker's GET /machine/update/status.

    A real Moonraker instance compares local vs. upstream git commits for
    Klipper, Moonraker, and any git-tracked app, and reports which ones have
    an update waiting. This fakes that same shape.
    """
    return {
        "packages": [
            {"name": "klipper", "current_version": "v0.12.0-312", "remote_version": "v0.12.0-312", "update_available": False},
            {"name": "moonraker", "current_version": "v0.9.2-88", "remote_version": "v0.9.2-94", "update_available": True},
        ],
    }


def reset_live_state():
    """Restore printer state to its starting point. Useful for tests."""
    global _LIVE_STATE, _CONSOLE_LOG
    _LIVE_STATE = _initial_live_state()
    _CONSOLE_LOG = []


def get_current_job_requirements():
    """
    Stand-in for reading the metadata block of the G-code file being printed.

    A slicer writes into each print file which material and color it was
    sliced for. The color checker module compares this against whatever the
    (future) color sensor actually sees in the filament path.
    """
    return {
        "filename": "toolhead_cover.gcode",
        "required_filament": [
            {
                "toolhead": "T0",
                "expected_color_name": "Snapmaker Orange",
                "expected_color_hex": "#f26a1b",
                "expected_material": "PLA",
            },
            {
                "toolhead": "T1",
                "expected_color_name": "Black",
                "expected_color_hex": "#1c1c1e",
                "expected_material": "PLA",
            },
        ],
    }
