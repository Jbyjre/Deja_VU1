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
needs to be swapped for a real HTTP/WebSocket client. Nothing else in the
project talks to the printer directly, so nothing else has to change.

More than one printer
---------------------
A workshop can run several U1s, so this file simulates a small fleet: each
simulated printer has its own print history, live state, console log and
current job. Every function below answers for the *selected* printer, which
is the default one unless a caller wraps its work in
`with use_printer("u1-studio"):`. The web server does that per request from a
`?printer=` parameter, which is how every existing module (maintenance,
control, cost, ...) works for any printer without being rewritten.

Live updates
------------
A real Moonraker pushes `notify_status_update` messages for subscribed
printer objects over its WebSocket. Klipper batches those on a fixed
250 ms timer (`SUBSCRIPTION_REFRESH_TIME = .25` in klippy/webhooks.py), so a
quarter of a second is the freshest printer data can ever be. `advance()`
is this file's stand-in for that feed: the live-feed thread calls it every
250 ms and the simulated printer moves forward by that much time - progress
climbs, hotends heat toward their target, the toolhead travels its path.

Real printers
-------------
A printer added by address (fleet.py's registry) is a real one: it is
attached here as a moonraker_client.MoonrakerPrinter, and every function
below hands the call to it instead of the simulation. Callers can't tell
the difference except through is_connected() and the "real" flag in its
state - which is the point. The demo and sandbox hooks at the bottom only
ever touch simulated printers, and refuse a real one.

Real Moonraker endpoints this file imitates:
  GET  /server/history/list       -> get_print_history()
  GET  /printer/objects/query     -> get_printer_state()
  WS   printer.objects.subscribe  -> advance() + get_printer_state()
  POST /server/files/upload       -> upload_file()
  POST /printer/print/start       -> start_print()
  POST /printer/print/pause       -> pause_print()
  POST /printer/print/resume      -> resume_print()
  POST /printer/print/cancel      -> cancel_print()
  POST /printer/gcode/script      -> run_gcode(), home_axes(), set_target_temperature()
  GET  /machine/update/status     -> get_update_status()
"""

import copy
import math
import random
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta

import moonraker_client

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


# ---------------------------------------------------------------------------
# One simulated printer
# ---------------------------------------------------------------------------

# How each simulated printer starts. The first one is the original single
# printer this project always simulated - its numbers are unchanged, so every
# existing screen and test sees exactly what it saw before.
_FLEET_SPEC = [
    {
        "id": "u1-workshop", "name": "U1 · Workshop", "seed": 20260907,
        "jobs": 38, "days": 64,
        "scenario": {
            "state": "printing", "file": "toolhead_cover.gcode",
            "progress": 0.46, "hours": 2.1, "total_hours": 4.6,
            "active": "T2", "layers": 322,
            "loaded": {"T0": 2, "T1": 0, "T2": 4, "T3": 1},
            "required": [("T0", 2, "PLA"), ("T1", 0, "PLA")],
        },
    },
    {
        "id": "u1-studio", "name": "U1 · Studio", "seed": 7117,
        "jobs": 24, "days": 40,
        "scenario": {
            "state": "paused", "file": "gridfinity_bin_2x1.gcode",
            "progress": 0.72, "hours": 1.4, "total_hours": 1.95,
            "active": "T0", "layers": 140,
            "loaded": {"T0": 0, "T1": 1, "T2": 3, "T3": 5},
            "required": [("T0", 0, "PETG")],
        },
    },
    {
        "id": "u1-garage", "name": "U1 · Garage", "seed": 3301,
        "jobs": 30, "days": 55,
        "scenario": {
            "state": "ready", "file": None,
            "progress": 0.0, "hours": 0.0, "total_hours": 0.0,
            "active": None, "layers": 0,
            "loaded": {"T0": 1, "T1": 2, "T2": 5, "T3": 4},
            "required": [],
            "dock_error": "T3",
        },
    },
]


class SimulatedPrinter:
    """Everything one printer knows: its past, its present, its console."""

    def __init__(self, spec):
        self.id = spec["id"]
        self.name = spec["name"]
        self._spec = spec
        self.lock = threading.RLock()
        self.history = _build_print_history(
            random.Random(spec["seed"]), spec["jobs"], spec["days"])
        self.reset()

    # -- lifecycle ----------------------------------------------------------

    def reset(self):
        with self.lock:
            s = self._spec["scenario"]
            self.live = self._initial_live_state(s)
            self.console = []
            self.files = set(_JOB_NAMES)
            self.fail_next = {}
            self.time_scale = 1.0
            self.motion_phase = 0.0
            # Sandbox network drop: while set, commands get no answer and
            # readers see the last state that arrived, labelled as stale.
            self.link_lost_at = None
            self.last_seen = None
            self.job = {
                "filename": s["file"],
                "total_hours": s["total_hours"],
                "layers": s["layers"],
                "filament_grams": round(s["total_hours"] * 12.0, 1),
                "material": (s["required"][0][2] if s["required"] else "PLA"),
                "required_filament": [
                    {
                        "toolhead": th,
                        "expected_color_name": FILAMENT_COLORS[ci]["name"],
                        "expected_color_hex": FILAMENT_COLORS[ci]["hex"],
                        "expected_material": mat,
                    }
                    for th, ci, mat in s["required"]
                ],
                "footprint_mm": [60.0, 40.0],
            }
            # Completed jobs added while the server runs (on top of history).
            self.session_jobs = []

    def _initial_live_state(self, s):
        active = s["active"]
        loaded = {th: FILAMENT_COLORS[i] for th, i in s["loaded"].items()}
        printing = s["state"] in ("printing", "paused")
        layer = int(round(s["progress"] * s["layers"])) if s["layers"] else 0

        if s["state"] == "printing":
            message = f"Printing layer {layer} of {s['layers']}"
        elif s["state"] == "paused":
            message = "Paused"
        else:
            message = "Idle"

        toolheads = {}
        for th in TOOLHEADS:
            is_active = th == active
            toolheads[th] = {
                "status": "active" if is_active else "docked",
                "temperature": 218.0 if (is_active and printing) else 32.5,
                "target_temperature": 220.0 if (is_active and printing) else 0.0,
                "filament_loaded": True,
                "filament_color_hex": loaded[th]["hex"],
                "filament_color_name": loaded[th]["name"],
            }
        if s.get("dock_error"):
            toolheads[s["dock_error"]]["status"] = "error"
            toolheads[s["dock_error"]]["filament_loaded"] = False
            message = f"Filament runout on {s['dock_error']}"

        bed = 60.0 if printing else AMBIENT_C
        return {
            "state": s["state"],              # printing | ready | paused | error | complete
            "state_message": message,
            "current_file": s["file"],
            "progress": s["progress"],        # 0.0 to 1.0
            "print_duration_hours": s["hours"],
            "active_toolhead": active,
            "toolheads": toolheads,
            "bed_temperature": bed,
            "bed_target": 60.0 if printing else 0.0,
            # Klipper reports a chamber reading through a
            # [temperature_sensor chamber] section when the machine has one.
            "chamber_temperature": 34.0 if printing else 25.5,
            "toolhead_position": [135.0, 135.0, round(layer * 0.2, 2)],
            "layer": {"current": layer, "total": s["layers"]},
            "printer_id": self.id,
            "printer_name": self.name,
        }

    # -- helpers ------------------------------------------------------------

    def log(self, kind, detail):
        self.console.append({
            "time": datetime.now().isoformat(timespec="seconds"),
            "kind": kind,
            "detail": detail,
        })
        del self.console[:-100]

    def check_failure(self, action):
        """Raise the failure a test or demo asked for, exactly once."""
        self.check_link(action)
        message = self.fail_next.pop(action, None)
        if message:
            self.log("error", f"{action} failed: {message}")
            raise PrinterCommandError(message)

    def snapshot(self):
        with self.lock:
            if self.link_lost_at:
                frozen = copy.deepcopy(self.last_seen)
                frozen["link_lost"] = True
                frozen["link_lost_at"] = self.link_lost_at
                return frozen
            return copy.deepcopy(self.live)

    def check_link(self, action):
        if self.link_lost_at:
            self.log("error", f"{action}: no answer (network link down)")
            raise PrinterCommandError(
                f"No answer from Moonraker since {self.link_lost_at[11:19]} - the network link "
                "to this printer is down (simulated drop)")

    # -- simulated time -----------------------------------------------------

    def advance(self, seconds, scaled=True):
        """
        Move the simulation forward by `seconds` of wall-clock time.

        Temperatures approach their targets on a first-order lag (roughly
        how a heater under PID control settles), the toolhead travels the
        current layer's outline, and a running print's progress climbs until
        it finishes. `time_scale` (demo only) fast-forwards all of it;
        scaled=False takes `seconds` as simulated time already (the sandbox's
        "step forward" button).
        """
        with self.lock:
            sim = max(0.0, seconds) * (self.time_scale if scaled else 1.0)
            if sim <= 0:
                return None
            live = self.live
            event = None

            for th, data in live["toolheads"].items():
                data["temperature"] = _approach(
                    data["temperature"],
                    data["target_temperature"] or AMBIENT_C + 8.5, sim, 25.0)
            live["bed_temperature"] = _approach(
                live["bed_temperature"], live.get("bed_target") or AMBIENT_C, sim, 90.0)
            chamber_goal = AMBIENT_C + (0.2 * (live["bed_temperature"] - AMBIENT_C))
            if live["state"] == "printing":
                chamber_goal += 6.0
            live["chamber_temperature"] = _approach(
                live["chamber_temperature"], chamber_goal, sim, 480.0)

            if live["state"] == "printing" and self.job["total_hours"] > 0:
                total_s = self.job["total_hours"] * 3600.0
                live["progress"] = min(1.0, live["progress"] + sim / total_s)
                live["print_duration_hours"] = round(
                    live["print_duration_hours"] + sim / 3600.0, 4)
                layers = self.job["layers"] or 1
                layer = min(layers, int(live["progress"] * layers) + 1)
                if layer != live["layer"]["current"]:
                    live["layer"]["current"] = layer
                    self._maybe_tool_change(layer)
                live["state_message"] = f"Printing layer {layer} of {layers}"

                # Travel the layer outline at ~120 mm/s of simulated time.
                w, d = self.job["footprint_mm"]
                perimeter = 2 * (w + d)
                self.motion_phase = (self.motion_phase + sim * 120.0 / perimeter) % 1.0
                x, y = _point_on_rectangle(self.motion_phase, w, d)
                live["toolhead_position"] = [
                    round(135.0 + x, 2), round(135.0 + y, 2), round(layer * 0.2, 2)]

                if live["progress"] >= 1.0:
                    event = self._finish()
            live["bed_temperature"] = round(live["bed_temperature"], 2)
            live["chamber_temperature"] = round(live["chamber_temperature"], 2)
            for data in live["toolheads"].values():
                data["temperature"] = round(data["temperature"], 2)
            return event

    def _maybe_tool_change(self, layer):
        required = [r["toolhead"] for r in self.job["required_filament"]]
        if len(required) < 2 or layer % 12:
            return
        live = self.live
        current = live["active_toolhead"]
        nxt = required[(required.index(current) + 1) % len(required)] \
            if current in required else required[0]
        if nxt == current:
            return
        if current in live["toolheads"]:
            old = live["toolheads"][current]
            old["status"] = "docked" if old["status"] != "error" else "error"
            old["target_temperature"] = 150.0      # standby while docked
        new = live["toolheads"][nxt]
        new["status"] = "active"
        new["target_temperature"] = 220.0
        live["active_toolhead"] = nxt
        self.log("toolchange", f"{current} -> {nxt} at layer {layer}")

    def _finish(self):
        live = self.live
        live["state"] = "complete"
        live["progress"] = 1.0
        live["state_message"] = f"Finished {live['current_file']}"
        live["toolhead_position"] = [135.0, 260.0, live["toolhead_position"][2] + 10]
        for data in live["toolheads"].values():
            if data["status"] == "active":
                data["status"] = "docked"
            data["target_temperature"] = 0.0
        live["bed_target"] = 0.0
        hours = round(live["print_duration_hours"], 2)
        required = self.job["required_filament"]
        first = live["toolheads"][required[0]["toolhead"]] if required else None
        job = {
            "job_id": f"live-{len(self.session_jobs) + 1:03d}",
            "filename": live["current_file"],
            "status": "completed",
            "start_time": (datetime.now() - timedelta(hours=hours)).isoformat(timespec="seconds"),
            "end_time": datetime.now().isoformat(timespec="seconds"),
            "print_duration_hours": hours,
            "filament_used_grams": self.job["filament_grams"],
            "filament_type": self.job["material"],
            "filament_color_name": first["filament_color_name"] if first else "Unknown",
            "filament_color_hex": first["filament_color_hex"] if first else "#888888",
            "toolheads_used": sorted({r["toolhead"] for r in required}) or ["T0"],
        }
        self.session_jobs.append(job)
        live["active_toolhead"] = None
        self.log("complete", live["current_file"])
        return {"type": "print_finished", "job": job}


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


# ---------------------------------------------------------------------------
# The fleet, and which printer the current request is about
# ---------------------------------------------------------------------------

_PRINTERS = {spec["id"]: SimulatedPrinter(spec) for spec in _FLEET_SPEC}
_REAL = {}                    # printer_id -> moonraker_client.MoonrakerPrinter, in the order added
DEFAULT_PRINTER_ID = _FLEET_SPEC[0]["id"]
BUILT_IN_IDS = tuple(_PRINTERS)
_selected = threading.local()
_fleet_lock = threading.RLock()

SimulatedPrinter.real = False


def _get(printer_id):
    printer = _REAL.get(printer_id) or _PRINTERS.get(printer_id)
    if printer is None:
        raise ValueError(f"Unknown printer: {printer_id}")
    return printer


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


def is_real(printer_id):
    return printer_id in _REAL


def printer_name(printer_id):
    return _get(printer_id).name


def has_printer(printer_id):
    return printer_id in _REAL or printer_id in _PRINTERS


def default_printer_id():
    """
    The printer a request without ?printer= is about: the first real
    printer once one is attached, otherwise the first simulated one.
    """
    with _fleet_lock:
        return next(iter(_REAL), DEFAULT_PRINTER_ID)


def selected_printer_id():
    return getattr(_selected, "printer_id", None) or default_printer_id()


@contextmanager
def use_printer(printer_id):
    """Answer every call inside this block for `printer_id`."""
    printer = _get(printer_id)
    previous = getattr(_selected, "printer_id", None)
    _selected.printer_id = printer_id
    try:
        yield printer
    finally:
        if previous is None:
            del _selected.printer_id
        else:
            _selected.printer_id = previous


def _current():
    return _get(selected_printer_id())


# ---------------------------------------------------------------------------
# Real printers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# The Moonraker-shaped API every other module calls
# ---------------------------------------------------------------------------

def is_connected(printer_id=None):
    """
    Is this printer a real one with a live connection right now?

    Always False for a simulated printer - it's the dashboard's rule for
    whether figures may be shown without demo data switched on.
    """
    printer = _REAL.get(printer_id or selected_printer_id())
    return bool(printer and printer.is_connected())


def any_connected():
    with _fleet_lock:
        printers = list(_REAL.values())
    return any(p.is_connected() for p in printers)


def get_print_history():
    """
    Moonraker's GET /server/history/list: every finished job, oldest first.
    The maintenance module reads this to work out how many hours the
    printer has run.
    """
    printer = _current()
    if printer.real:
        return printer.get_print_history()
    with printer.lock:
        return list(printer.history) + list(printer.session_jobs)


def get_printer_state():
    """
    Moonraker's printer objects (GET /printer/objects/query, kept current by
    printer.objects.subscribe): whether it is printing, how far along,
    temperatures, which toolhead is active. A copy, so callers can't
    mutate the live state by editing the dict they were handed.
    """
    return _current().snapshot()


def advance(seconds, printer_id=None, scaled=True):
    """Move one simulated printer forward (a real one moves by itself). Returns a finish event, if any."""
    printer = _get(printer_id) if printer_id else _current()
    return printer.advance(seconds, scaled=scaled)


def pause_print():
    """POST /printer/print/pause."""
    printer = _current()
    if printer.real:
        return printer.pause_print()
    with printer.lock:
        printer.check_link("pause")
        if printer.live["state"] == "paused":
            raise ValueError("Print already paused")      # Klipper's own words (pause_resume.py)
        if printer.live["state"] != "printing":
            raise ValueError("Nothing is printing right now")
        printer.check_failure("pause")
        printer.live["state"] = "paused"
        printer.live["state_message"] = "Paused"
        printer.log("pause", printer.live["current_file"])
        return printer.snapshot()


def resume_print():
    """POST /printer/print/resume."""
    printer = _current()
    if printer.real:
        return printer.resume_print()
    with printer.lock:
        printer.check_link("resume")
        if printer.live["state"] != "paused":
            raise ValueError("Printer is not paused")
        printer.check_failure("resume")
        printer.live["state"] = "printing"
        printer.live["state_message"] = f"Printing {printer.live['current_file']}"
        printer.log("resume", printer.live["current_file"])
        return printer.snapshot()


def cancel_print():
    """POST /printer/print/cancel."""
    printer = _current()
    if printer.real:
        return printer.cancel_print()
    with printer.lock:
        printer.check_link("cancel")
        live = printer.live
        if live["state"] not in ("printing", "paused"):
            raise ValueError("Nothing to cancel")
        printer.check_failure("cancel")
        cancelled_file = live["current_file"]
        live["state"] = "ready"
        live["state_message"] = "Idle"
        live["progress"] = 0.0
        live["current_file"] = None
        live["bed_target"] = 0.0
        for data in live["toolheads"].values():
            if data["status"] == "active":
                data["status"] = "docked"
                data["target_temperature"] = 0.0
        printer.log("cancel", cancelled_file)
        return printer.snapshot()


def upload_file(filename, size_bytes=0, data=None):
    """POST /server/files/upload (root "gcodes"). A real printer needs `data`."""
    printer = _current()
    if printer.real:
        return printer.upload_file(filename, size_bytes, data)
    with printer.lock:
        printer.check_link("upload")
        printer.check_failure("upload")
        printer.files.add(filename)
        printer.log("upload", f"{filename} ({size_bytes} bytes)")
        return {"item": {"path": filename, "root": "gcodes", "size": size_bytes},
                "action": "create_file"}


def start_print(filename, job=None):
    """
    POST /printer/print/start?filename=...

    `job` carries what the dashboard read from the file itself - estimated
    time, layer count, filament grams and which toolheads it needs - so the
    simulation runs the print that was actually chosen rather than a
    made-up one (and a real printer's finish summary has the right grams).
    """
    printer = _current()
    if printer.real:
        return printer.start_print(filename, job)
    job = job or {}
    with printer.lock:
        printer.check_link("start")
        live = printer.live
        if live["state"] in ("printing", "paused"):
            raise ValueError("The printer is busy with another print")
        if live["state"] == "error":
            raise ValueError("The printer is reporting an error; clear it first")
        if filename not in printer.files:
            raise ValueError(f"{filename} has not been uploaded to the printer")
        printer.check_failure("start")

        required = job.get("required_filament") or []
        printer.job = {
            "filename": filename,
            "total_hours": max(0.01, float(job.get("estimated_hours") or 1.0)),
            "layers": int(job.get("layers") or 100),
            "filament_grams": float(job.get("filament_grams") or 0.0),
            "material": job.get("material") or "PLA",
            "required_filament": required,
            "footprint_mm": job.get("footprint_mm") or [60.0, 40.0],
        }
        first_tool = required[0]["toolhead"] if required else "T0"
        live.update({
            "state": "printing",
            "state_message": f"Printing layer 1 of {printer.job['layers']}",
            "current_file": filename,
            "progress": 0.0,
            "print_duration_hours": 0.0,
            "active_toolhead": first_tool,
            "bed_target": float(job.get("bed_temperature") or 60.0),
            "layer": {"current": 1, "total": printer.job["layers"]},
        })
        for th, data in live["toolheads"].items():
            if data["status"] != "error":
                data["status"] = "active" if th == first_tool else "docked"
        live["toolheads"][first_tool]["target_temperature"] = \
            float(job.get("nozzle_temperature") or 220.0)
        printer.log("start", filename)
        return printer.snapshot()


def set_target_temperature(toolhead, target):
    """
    Set a toolhead's heater target (on a real printer:
    SET_HEATER_TEMPERATURE HEATER=extruderN). Only the target: the reading
    then climbs toward it, the way a real heater settles.
    """
    if toolhead not in TOOLHEADS:
        raise ValueError(f"Unknown toolhead: {toolhead}")
    printer = _current()
    if printer.real:
        return printer.set_target_temperature(toolhead, target)
    with printer.lock:
        printer.check_failure("temperature")
        printer.live["toolheads"][toolhead]["target_temperature"] = target
        printer.log("temperature", f"{toolhead} -> {target}°C")
        return printer.snapshot()


def set_bed_temperature(target):
    """The bed heater's target only."""
    printer = _current()
    if printer.real:
        return printer.set_bed_temperature(target)
    with printer.lock:
        printer.check_failure("temperature")
        printer.live["bed_target"] = float(target)
        printer.log("temperature", f"bed -> {target}°C")
        return printer.snapshot()


def home_axes(axes):
    """G28 through POST /printer/gcode/script - refused mid-print, like the real client."""
    printer = _current()
    if printer.real:
        return printer.home_axes(axes)
    with printer.lock:
        printer.check_link("home")
        if printer.live["state"] in ("printing", "paused"):
            raise ValueError("Homing is refused while a print is running or paused - it would drive the "
                             "toolhead through the print")
        printer.check_failure("home")
        printer.log("home", "".join(axes))
    return {"homed": list(axes)}


def run_gcode(command):
    """POST /printer/gcode/script."""
    printer = _current()
    if printer.real:
        return printer.run_gcode(command)
    with printer.lock:
        printer.check_link("gcode")
        printer.check_failure("gcode")
        printer.log("gcode", command)
    return {"command": command, "response": "ok"}


def get_console_log(limit=30):
    """Recent commands sent to the printer (and, for a real one, its replies), newest first."""
    printer = _current()
    if printer.real:
        return printer.get_console_log(limit)
    with printer.lock:
        return list(reversed(printer.console))[:limit]


def get_update_status():
    """
    GET /machine/update/status. A real Moonraker compares local and
    upstream versions of Klipper, Moonraker and other tracked software;
    the simulation fakes that same shape.
    """
    printer = _current()
    if printer.real:
        return printer.get_update_status()
    return {
        "packages": [
            {"name": "klipper", "current_version": "v0.12.0-312", "remote_version": "v0.12.0-312", "update_available": False},
            {"name": "moonraker", "current_version": "v0.9.2-88", "remote_version": "v0.9.2-94", "update_available": True},
        ],
    }


def get_current_job_requirements():
    """
    What the running file was sliced for, per toolhead: from the dashboard's
    own reading of the file when it started the print, or from Moonraker's
    metadata for a print started elsewhere.
    """
    printer = _current()
    if printer.real:
        return printer.get_current_job_requirements()
    with printer.lock:
        return {
            "filename": printer.job["filename"],
            "required_filament": copy.deepcopy(printer.job["required_filament"]),
        }


def get_current_job():
    """What is known about the running job (time, grams, size)."""
    printer = _current()
    if printer.real:
        return printer.get_current_job()
    with printer.lock:
        return copy.deepcopy(printer.job)


def diagnostics(printer_id):
    """The connection report for a real printer (None for a simulated one)."""
    printer = _REAL.get(printer_id)
    return printer.diagnostics() if printer else None


# ---------------------------------------------------------------------------
# Test and demo hooks - never reachable without an explicit demo request,
# and never on a real printer: each one refuses a real printer outright,
# whatever route or scenario asked (a second lock behind the API's own).
# ---------------------------------------------------------------------------

def _sim():
    printer = _current()
    if printer.real:
        raise ValueError(f"{printer.name} is a real printer - simulation controls never touch it")
    return printer


def fail_next(action, message="Moonraker did not accept the command"):
    """
    Make the next `action` (pause, resume, cancel, start, ...) on the
    selected printer fail with `message`. Used to prove the dashboard shows a
    failed command as failed, never as done.
    """
    if action not in {"pause", "resume", "cancel", "start", "upload",
                      "temperature", "home", "gcode"}:
        raise ValueError(f"Unknown action: {action}")
    printer = _sim()
    with printer.lock:
        printer.fail_next[action] = str(message)[:200]
    return {"armed": action, "message": printer.fail_next[action]}


def set_time_scale(scale):
    """Demo fast-forward: 1 is real time, 60 runs a minute per second."""
    scale = float(scale)
    if not 1 <= scale <= 600:
        raise ValueError("Time scale must be between 1 and 600")
    printer = _sim()
    with printer.lock:
        printer.time_scale = scale
    return {"time_scale": scale}


def get_time_scale():
    printer = _current()
    return 1.0 if printer.real else printer.time_scale


def reset_live_state():
    """Restore the selected printer to its starting point. Useful for tests."""
    _sim().reset()


def reset_all():
    """Restore every simulated printer to its starting point (and drop sandbox ones)."""
    with _fleet_lock:
        for spec in [s for s in _FLEET_SPEC if s.get("sandbox")]:
            _FLEET_SPEC.remove(spec)
            del _PRINTERS[spec["id"]]
        printers = list(_PRINTERS.values())
    for printer in printers:
        printer.reset()


# ---------------------------------------------------------------------------
# Sandbox hooks - a farm of any size, and the faults a real farm runs into.
# Like fail_next, only ever reached through an explicit demo request.
# ---------------------------------------------------------------------------

MAX_SANDBOX_PRINTERS = 24


def add_printer(name, seed, scenario, jobs=12, days=30):
    """
    Add one more simulated printer to the fleet. It is a SimulatedPrinter
    like the built-in three, so every module sees it the moment it exists.
    `scenario` has the same shape as _FLEET_SPEC's.
    """
    with _fleet_lock:
        extra = [s for s in _FLEET_SPEC if s.get("sandbox")]
        if len(extra) >= MAX_SANDBOX_PRINTERS:
            raise ValueError(f"The sandbox holds at most {MAX_SANDBOX_PRINTERS} extra printers")
        n = 1
        while f"sim-{n:02d}" in _PRINTERS:
            n += 1
        spec = {"id": f"sim-{n:02d}", "name": str(name)[:40] or f"Sim {n:02d}", "seed": int(seed),
                "jobs": int(jobs), "days": int(days), "scenario": scenario, "sandbox": True}
        _PRINTERS[spec["id"]] = SimulatedPrinter(spec)
        _FLEET_SPEC.append(spec)
    return spec["id"]


def remove_printer(printer_id):
    """Remove a sandbox printer. The built-in three can't be removed."""
    with _fleet_lock:
        spec = next((s for s in _FLEET_SPEC if s["id"] == printer_id), None)
        if spec is None:
            raise ValueError(f"Unknown printer: {printer_id}")
        if not spec.get("sandbox"):
            raise ValueError("Only printers the sandbox added can be removed")
        _FLEET_SPEC.remove(spec)
        del _PRINTERS[printer_id]


def is_sandbox_printer(printer_id):
    with _fleet_lock:
        return any(s["id"] == printer_id and s.get("sandbox") for s in _FLEET_SPEC)


def _record_failed_job(printer, message):
    """A print that stops with an error lands in history, as Moonraker's does."""
    live = printer.live
    hours = round(live["print_duration_hours"], 2)
    total = printer.job["total_hours"] or 1.0
    printer.session_jobs.append({
        "job_id": f"live-{len(printer.session_jobs) + 1:03d}",
        "filename": live["current_file"], "status": "error",
        "start_time": (datetime.now() - timedelta(hours=hours)).isoformat(timespec="seconds"),
        "end_time": datetime.now().isoformat(timespec="seconds"),
        "print_duration_hours": hours,
        "filament_used_grams": round(printer.job["filament_grams"] * min(1.0, hours / total), 1),
        "filament_type": printer.job["material"],
        "filament_color_name": "Unknown", "filament_color_hex": "#888888",
        "toolheads_used": sorted({r["toolhead"] for r in printer.job["required_filament"]}) or ["T0"],
        "error": message,
    })


def _stop_with_error(printer, message):
    live = printer.live
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


def inject_jam(toolhead=None):
    """The extruder stops pushing filament mid-print: Klipper halts with an error."""
    printer = _sim()
    with printer.lock:
        if printer.live["state"] not in ("printing", "paused"):
            raise ValueError("A jam needs a print running on this printer")
        th = toolhead or printer.live["active_toolhead"] or "T0"
        if th not in TOOLHEADS:
            raise ValueError(f"Unknown toolhead: {th}")
        printer.live["toolheads"][th]["status"] = "error"
        _stop_with_error(printer, f"Filament jam on {th}: extruder stopped")
        return printer.snapshot()


def inject_heater_fault(toolhead=None):
    """Klipper's heater check trips and it shuts the heaters down."""
    printer = _sim()
    with printer.lock:
        th = toolhead or printer.live["active_toolhead"] or "T0"
        if th not in TOOLHEADS:
            raise ValueError(f"Unknown toolhead: {th}")
        # Klipper's own wording (klippy/extras/verify_heater.py).
        _stop_with_error(printer, f"Heater {th} not heating at expected rate")
        return printer.snapshot()


def inject_runout(toolhead):
    """
    A dock runs out of filament. If it's the toolhead printing, the print
    pauses the way Klipper's filament sensor pauses it.
    """
    if toolhead not in TOOLHEADS:
        raise ValueError(f"Unknown toolhead: {toolhead}")
    printer = _sim()
    with printer.lock:
        live = printer.live
        dock = live["toolheads"][toolhead]
        dock["status"] = "error"
        dock["filament_loaded"] = False
        message = f"Filament runout on {toolhead}"
        if live["state"] == "printing" and live["active_toolhead"] == toolhead:
            live["state"] = "paused"
        if live["state"] != "printing":
            live["state_message"] = message
        printer.log("runout", toolhead)
        return printer.snapshot()


def load_filament(toolhead, color_index):
    """Someone swaps the spool on a dock - to the right colour or the wrong one."""
    if toolhead not in TOOLHEADS:
        raise ValueError(f"Unknown toolhead: {toolhead}")
    if not isinstance(color_index, int) or not 0 <= color_index < len(FILAMENT_COLORS):
        raise ValueError("Pick one of the simulated filament colours")
    colour = FILAMENT_COLORS[color_index]
    printer = _sim()
    with printer.lock:
        dock = printer.live["toolheads"][toolhead]
        dock.update(filament_loaded=True, filament_color_hex=colour["hex"],
                    filament_color_name=colour["name"])
        if dock["status"] == "error":
            dock["status"] = "docked"
        printer.log("filament", f"{toolhead} loaded {colour['name']}")
        return printer.snapshot()


def clear_error():
    """FIRMWARE_RESTART: an errored printer comes back idle; dock errors clear."""
    printer = _sim()
    with printer.lock:
        printer.check_link("restart")
        live = printer.live
        for data in live["toolheads"].values():
            if data["status"] == "error":
                data.update(status="docked", filament_loaded=True)
        if live["state"] in ("error", "complete"):
            live.update(state="ready", state_message="Idle", current_file=None, progress=0.0,
                        active_toolhead=None)
        printer.log("restart", "FIRMWARE_RESTART")
        return printer.snapshot()


def add_wear(hours):
    """
    Add `hours` of completed prints to history, as if the printer had been
    busy - which is what makes maintenance come due, through maintenance.py's
    own counting rather than by editing its log.
    """
    hours = float(hours)
    if not 0 < hours <= 2000:
        raise ValueError("Wear must be between 0 and 2000 print hours")
    printer = _sim()
    with printer.lock:
        left, n = hours, 0
        while left > 0:
            chunk = min(left, 6.0)
            end = datetime.now() - timedelta(hours=n * 7)
            n += 1
            printer.session_jobs.append({
                "job_id": f"wear-{len(printer.session_jobs) + 1:03d}", "filename": "sandbox_wear.gcode",
                "status": "completed", "start_time": (end - timedelta(hours=chunk)).isoformat(timespec="seconds"),
                "end_time": end.isoformat(timespec="seconds"), "print_duration_hours": round(chunk, 2),
                "filament_used_grams": round(chunk * 12.0, 1), "filament_type": "PLA",
                "filament_color_name": FILAMENT_COLORS[0]["name"], "filament_color_hex": FILAMENT_COLORS[0]["hex"],
                "toolheads_used": ["T0"],
            })
            left -= chunk
        printer.log("wear", f"+{hours:g} print hours")
    return {"added_hours": hours, "jobs": n}


def set_link(up):
    """Drop or restore the network link to the selected printer."""
    printer = _sim()
    with printer.lock:
        if up:
            printer.link_lost_at = None
            printer.last_seen = None
        elif not printer.link_lost_at:
            printer.last_seen = copy.deepcopy(printer.live)
            printer.link_lost_at = datetime.now().isoformat(timespec="seconds")
        return {"link": "up" if up else "down", "since": printer.link_lost_at}


def link_is_up(printer_id=None):
    printer = _get(printer_id) if printer_id else _current()
    if printer.real:
        return printer.is_connected()
    return printer.link_lost_at is None
