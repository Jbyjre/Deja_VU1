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
  GET /server/history/list    -> past print jobs
  GET /printer/objects/query  -> live printer state (temps, progress, etc.)
"""

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


def get_printer_state():
    """
    Stand-in for Moonraker's GET /printer/objects/query.

    Returns what the printer is "doing" right now: whether it is printing,
    how far along it is, temperatures, and which toolhead is active. The LED
    module uses this to decide what color each dock ring should be.
    """
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
                "filament_loaded": True,
                "filament_color_hex": loaded[th]["hex"],
                "filament_color_name": loaded[th]["name"],
            }
            for th in TOOLHEADS
        },
        "bed_temperature": 60.0,
    }


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
