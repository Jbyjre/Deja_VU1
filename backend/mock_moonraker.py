"""
mock_moonraker.py
=================

Moonraker is the web API that sits in front of a Klipper-based 3D printer.
Software (like this dashboard) asks Moonraker questions such as "what is the
printer doing right now?" or "show me the list of prints I've run", and
Moonraker answers with JSON.

This file is the one place the rest of the project asks about a printer.
For the built-in and sandbox printers it *pretends* to be Moonraker: every
function returns the same shape of data a real Moonraker instance would,
with the numbers generated locally. For a printer added by address it
passes the call to a real client (see "Real printers" below). Nothing else
in the project talks to a printer directly.

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

import machines
import moonraker_client
import print_eta
import printer_extras
from mock_moonraker_part1 import (  # noqa: F401  (split out 19 November 2026; names kept here for callers)
    AMBIENT_C, BUILD_VOLUME_MM, DEFAULT_PRINTER_ID, DEMO_MACROS, FILAMENT_COLORS, MAX_SANDBOX_PRINTERS,
    PrinterCommandError, PrinterRefused, TOOLHEADS, _FLEET_SPEC, _JOB_NAMES, _REAL, _TUNE_TIMEOUTS, _approach,
    _build_print_history, _demo_objects, _demo_tuning, _fleet_lock, _plate, _point_on_rectangle,
    _attach_problem, _clear_problem, _record_failed_job, _selected, _stop_with_error, any_connected, attach_real_printer, detach_real_printer,
    diagnostics, is_sandbox_printer, printer_ids, real_printer, real_printer_ids, selection_only,
    simulated_printer_ids,
)


# ---------------------------------------------------------------------------
# One simulated printer
# ---------------------------------------------------------------------------


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
            self.ripple = {}
            self.sim_clock = 0.0
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
                "footprint_mm": list(s.get("footprint") or [60.0, 40.0]),
                "object_tools": dict(s.get("object_tools") or {}),
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
        seed = self._spec.get("seed", 0)
        nozzles = self._spec.get("nozzles", {})
        for i, th in enumerate(TOOLHEADS):
            is_active = th == active
            toolheads[th] = {
                "status": "active" if is_active else "docked",
                "temperature": 218.0 if (is_active and printing) else 32.5,
                "target_temperature": 220.0 if (is_active and printing) else 0.0,
                "filament_loaded": True,
                "filament_color_hex": loaded[th]["hex"],
                "filament_color_name": loaded[th]["name"],
                "filament_material": None,
                # What the U1's firmware reports per toolhead (u1-klipper
                # extruder.get_status); simulated lifetime counts here.
                "nozzle_diameter": nozzles.get(th, 0.4),
                "pressure_advance": 0.04,
                "smooth_time": 0.04,
                "swaps": 180 + (seed // (i + 3)) % 900,
                "swap_retries": (seed >> i) % 4,
                "swap_errors": 1 if (seed + i) % 7 == 0 else 0,
            }
        if s.get("dock_error"):
            toolheads[s["dock_error"]]["status"] = "error"
            toolheads[s["dock_error"]]["filament_loaded"] = False
            message = f"Filament runout on {s['dock_error']}"

        bed = 60.0 if printing else AMBIENT_C
        live = {
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
            "homed_axes": "xyz",
            "tuning": _demo_tuning(),
            "layer": {"current": layer, "total": s["layers"]},
            "printer_id": self.id,
            "printer_name": self.name,
            "machine": machines.public(machines.U1),    # every simulated printer is a U1
            **({"objects": _plate(s.get("objects") or _demo_objects(s["file"]))} if printing else {}),
        }
        if s.get("problem"):
            _attach_problem(live, s["state"], s["problem"]["level"], s["problem"]["id"], s["problem"]["index"],
                            s["problem"]["code"], s["problem"].get("message"))
        return live

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

            # Heaters: the smooth temperature follows its target; what is
            # reported adds the small ripple a real PID loop shows while it
            # holds (a few tenths of a degree), kept apart so it never drifts.
            self.sim_clock = getattr(self, "sim_clock", 0.0) + sim
            ripple = getattr(self, "ripple", None)
            if ripple is None:
                ripple = self.ripple = {}
            def held(key, reported, target, tau, amp, period, phase):
                true, shown = ripple.get(key, (reported, reported))
                if abs(reported - shown) > 0.011:        # set elsewhere (a fault, a reset): follow it
                    true = reported
                true = _approach(true, target, sim, tau)
                near = max(0.0, 1.0 - abs(true - target) / 3.0) if target > AMBIENT_C + 10 else 0.0
                wobble = near * amp * (math.sin(self.sim_clock * 2 * math.pi / period + phase)
                                       + 0.4 * math.sin(self.sim_clock * 2 * math.pi / (period * 0.37) + 2 * phase))
                shown = round(true + wobble, 2)
                ripple[key] = (true, shown)
                return shown
            for i, (th, data) in enumerate(live["toolheads"].items()):
                data["temperature"] = held(th, data["temperature"], data["target_temperature"] or AMBIENT_C + 8.5,
                                           25.0, 0.22, 6.0 + i, i * 1.3)
            live["bed_temperature"] = held("bed", live["bed_temperature"], live.get("bed_target") or AMBIENT_C,
                                           90.0, 0.12, 14.0, 0.5)
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
                plate = live.get("objects")
                if plate:
                    # Each layer prints the objects in turn; skipped ones are passed over.
                    left = [o["name"] for o in plate["list"] if o["name"] not in plate["excluded"]]
                    within = (live["progress"] * layers) % 1.0
                    plate["current"] = left[min(len(left) - 1, int(within * len(left)))] if left else None
                    plan = self.job.get("object_tools", {}).get(plate["current"])
                    if plan:
                        self._switch_to(plan[0] if layer <= plan[2] else plan[1], layer)
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
        if self.job.get("object_tools"):
            return              # the file says which head prints each object (see advance)
        required = [r["toolhead"] for r in self.job["required_filament"]]
        if len(required) < 2 or layer % 12:
            return
        current = self.live["active_toolhead"]
        nxt = required[(required.index(current) + 1) % len(required)] \
            if current in required else required[0]
        self._switch_to(nxt, layer)

    def _switch_to(self, nxt, layer):
        live = self.live
        current = live["active_toolhead"]
        if nxt == current or nxt not in live["toolheads"]:
            return
        if current in live["toolheads"]:
            old = live["toolheads"][current]
            old["status"] = "docked" if old["status"] != "error" else "error"
            old["target_temperature"] = 150.0      # standby while docked
        new = live["toolheads"][nxt]
        new["status"] = "active"
        new["swaps"] = new.get("swaps", 0) + 1
        new["target_temperature"] = 220.0
        live["active_toolhead"] = nxt
        self.log("toolchange", f"{current} -> {nxt} at layer {layer}")

    def _finish(self):
        live = self.live
        live.pop("objects", None)
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


# ---------------------------------------------------------------------------
# The fleet, and which printer the current request is about
# ---------------------------------------------------------------------------

_PRINTERS = {spec["id"]: SimulatedPrinter(spec) for spec in _FLEET_SPEC}
BUILT_IN_IDS = tuple(_PRINTERS)

SimulatedPrinter.real = False


def _get(printer_id):
    printer = _REAL.get(printer_id) or _PRINTERS.get(printer_id)
    if printer is None:
        raise ValueError(f"Unknown printer: {printer_id}")
    return printer


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
    with selection_only(printer_id):
        yield printer


def _current():
    return _get(selected_printer_id())


# ---------------------------------------------------------------------------
# Real printers
# ---------------------------------------------------------------------------


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


def history_loaded():
    """
    Whether the selected printer's print history is known yet: always for a
    simulated printer; for a real one, once its first history fetch (which
    runs in the background after the connection opens) has succeeded.
    """
    printer = _current()
    return printer.history_loaded() if printer.real else True


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
    printer = _current()
    state = printer.snapshot()
    # One estimate of the time left for every screen and rule (print_eta.py): the file's own estimate, how the print is
    # running against it, and a truer share than bytes where the file or the printer gives one.
    if isinstance(state, dict) and state.get("state") in ("printing", "paused"):
        try:
            job = printer.get_current_job() if printer.real else printer.job
            print_eta.attach(state, getattr(printer, "id", None) or selected_printer_id(), (job or {}).get("total_hours"))
        except Exception:                                  # the estimate is an extra: never let it stop the state
            state.pop("eta", None)
    return state


def printer_messages(limit=40):
    """What the printer itself said that matters, newest first. A simulated printer says nothing of its own."""
    printer = _current()
    return printer.recent_messages(limit) if printer.real else []


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
        _clear_problem(printer.live)
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
        _record_failed_job(printer, "Cancelled by the user", status="cancelled")
        _clear_problem(live)
        live.pop("objects", None)
        live["state"] = "ready"
        live["state_message"] = "Idle"
        live["progress"] = 0.0
        live["current_file"] = None
        live["active_toolhead"] = None
        live["bed_target"] = 0.0
        for data in live["toolheads"].values():
            data["target_temperature"] = 0.0
            if data["status"] == "active":
                data["status"] = "docked"
                data["target_temperature"] = 0.0
        printer.log("cancel", cancelled_file)
        return printer.snapshot()


def gcode_version(filename):
    """(size, modified) of a file on a real printer, for knowing when it changed."""
    printer = _current()
    if not printer.real:
        raise ValueError("A simulated printer keeps no file contents")
    return printer.gcode_version(filename)


def fetch_gcode(filename, max_bytes):
    """The bytes of a file as a real printer holds it. Simulated printers keep none."""
    printer = _current()
    if not printer.real:
        raise ValueError("A simulated printer keeps no file contents")
    return printer.fetch_gcode(filename, max_bytes)


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
        _clear_problem(live)
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
        # The file's own EXCLUDE_OBJECT_DEFINE lines, as Klipper would read them.
        plate = _plate(job.get("objects"))
        if plate:
            live["objects"] = plate
        else:
            live.pop("objects", None)
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


def exclude_object(name):
    """POST /printer/gcode/script with EXCLUDE_OBJECT NAME=... (Klipper's skip-one-object)."""
    printer = _current()
    if printer.real:
        return printer.exclude_object(name)
    with printer.lock:
        printer.check_link("exclude")
        refusal = moonraker_client.exclude_refusal(printer.live, name)
        if refusal:
            raise ValueError(refusal)
        printer.check_failure("exclude")
        plate = printer.live["objects"]
        plate["excluded"] = sorted(plate["excluded"] + [name])       # Klipper keeps it sorted
        if plate["current"] == name:
            plate["current"] = None
        printer.log("exclude", name)
        return printer.snapshot()


def run_gcode(command):
    """POST /printer/gcode/script."""
    printer = _current()
    if printer.real:
        return printer.run_gcode(command)
    with printer.lock:
        printer.check_link("gcode")
        printer.check_failure("gcode")
        printer.log("gcode", command)
        if command.strip().upper().split(" ")[0] == "M112":
            printer.live["state"] = "error"
            printer.live["state_message"] = "Emergency stop: Klipper is shut down. Restart the firmware to go on"
            return {"command": command, "response": "Emergency stop sent - Klipper is now shut down"}
    return {"command": command, "response": "ok"}


def tune(action, script, effect):
    """
    A hands-on command built and checked by printer_control (move, extrude,
    speed, flow, fan, pressure advance, limits, bed mesh, macro, head change).
    A real printer runs the G-code through POST /printer/gcode/script and the
    fresh state comes back; a simulated one changes the same fields.
    """
    printer = _current()
    if printer.real:
        return printer.tune(action, script, _TUNE_TIMEOUTS.get(action))
    with printer.lock:
        printer.check_link(action)
        printer.check_failure(action)
        live = printer.live
        tuning = live.setdefault("tuning", _demo_tuning())
        if action in ("jog", "move"):
            pos = list(live.get("toolhead_position") or [0.0, 0.0, 0.0])
            for i, axis in enumerate("XYZ"):
                if action == "jog" and effect.get("axis") == axis:
                    pos[i] += effect["distance"]
                elif action == "move" and axis in effect.get("to", {}):
                    pos[i] = effect["to"][axis]
            lows, highs = live["machine"]["min_mm"], live["machine"]["max_mm"]
            # Klipper refuses a move past an axis limit ("Move out of range"); so does the simulation.
            if any(not (lows[i] <= pos[i] <= highs[i]) for i in range(3)):
                raise ValueError("Move out of range: that would go past the edge of the printer")
            live["toolhead_position"] = [round(v, 2) for v in pos]
        elif action == "speed":
            tuning["speed_factor"] = effect["percent"] / 100
        elif action == "flow":
            tuning["extrude_factor"] = effect["percent"] / 100
        elif action == "fan":
            tuning["part_fan"] = round(effect["percent"] / 100, 3)
        elif action == "pressure_advance":
            head = live["toolheads"][effect["head"]]
            head["pressure_advance"] = effect["value"]
            if effect.get("smooth_time") is not None:
                head["smooth_time"] = effect["smooth_time"]
        elif action == "limits":
            for key in ("velocity", "accel"):
                if key in effect:
                    tuning[f"max_{key}"] = effect[key]
        elif action == "motors_off":
            live["homed_axes"] = ""
        elif action == "bed_mesh":
            live["homed_axes"] = "xyz"
            tuning["mesh_profile"] = "default"
        elif action == "z_nudge":
            tuning["z_offset"] = round((tuning.get("z_offset") or 0.0) + effect["delta"], 3)
        elif action == "fan_generic":
            for fan in tuning.get("fans") or []:
                if fan.get("id") == effect["name"]:
                    fan["speed"] = round(effect["percent"] / 100, 3)
        elif action == "led":
            for led in tuning.get("leds") or []:
                if led.get("id") == effect["name"]:
                    led["color"] = list(effect["color"])
        elif action == "runout":
            for sensor in tuning.get("runout") or []:
                if sensor.get("id") == effect["name"]:
                    sensor["enabled"] = effect["enabled"]
        elif action == "mesh_profile":
            tuning["mesh_profile"] = effect.get("profile")
        elif action == "tool":
            for th, data in live["toolheads"].items():
                if data["status"] != "error":
                    data["status"] = "active" if th == effect["head"] else "docked"
            live["active_toolhead"] = effect["head"]
        printer.log(action, script.replace("\n", " · "))
        return printer.snapshot()


def get_console_log(limit=30):
    """Recent commands sent to the printer (and, for a real one, its replies), newest first."""
    printer = _current()
    if printer.real:
        return printer.get_console_log(limit)
    with printer.lock:
        return list(reversed(printer.console))[:limit]


def fetch_printer_file(path):
    """Copy a G-code file from a real printer's own storage into the file library."""
    printer = _current()
    if not printer.real:
        raise ValueError("Demo printers print from your file library; they keep no files of their own")
    import file_library
    data = printer.fetch_gcode(path, file_library.MAX_BYTES)
    name = str(path).replace("\\", "/").split("/")[-1]
    return file_library.save(name, data, origin="printer", note=f"Copied from {printer.name}")


def printer_reading(kind):
    """
    What the Printer page reads on request (printer_extras.py): a real printer's
    Moonraker answers; a simulated printer gives demo answers, labelled.
    """
    printer = _current()
    if printer.real:
        return printer.extra(kind)
    with printer.lock:
        if printer.link_lost_at:
            raise PrinterCommandError("No answer from Moonraker - the network link to this printer is down "
                                      "(simulated drop)")
        live = printer.live
        tuning = live.get("tuning") or _demo_tuning()
        heads = sorted(live.get("toolheads") or {})
        if kind == "macros":
            return printer_extras.demo_macros(tuning.get("macros") or [])
        if kind == "mesh":
            return printer_extras.demo_mesh(tuning.get("mesh_profile"))
        if kind == "endstops":
            return printer_extras.demo_endstops()
        if kind == "help":
            return printer_extras.demo_help(tuning.get("macros") or [])
        if kind == "feeding":
            return printer_extras.demo_feeding(heads)
        if kind == "temperatures":
            # A simulated printer keeps no history: the page's chart fills from the live readings it sees.
            return {"interval_s": 1, "series": [], "demo": True}
        if kind == "files":
            # A simulated printer prints from your library; it holds no files of its own.
            return {"files": [], "demo": True}
        if kind == "job_queue":
            return {"queue_state": "ready", "queued_jobs": [], "demo": True}
    raise ValueError(f"Unknown reading: {kind}")


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
    if not isinstance(action, str) or action not in {"pause", "resume", "cancel", "start", "upload",
                                                     "temperature", "home", "gcode", "exclude"}:
        raise ValueError(f"Unknown action: {action}")
    printer = _sim()
    with printer.lock:
        printer.fail_next[action] = str(message)[:200]
    return {"armed": action, "message": printer.fail_next[action]}


def set_time_scale(scale):
    """Demo fast-forward: 1 is real time, 60 runs a minute per second."""
    try:
        scale = float(scale)
    except (TypeError, ValueError):
        raise ValueError("Time scale must be a number from 1 to 600") from None
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
        # The faulty head is marked, as a jam marks its head, so its dock ring
        # shows the fault instead of "ready" once the head is put away.
        printer.live["toolheads"][th]["status"] = "error"
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
        runout_paused = live["state"] == "printing" and live["active_toolhead"] == toolhead
        if runout_paused:
            live["state"] = "paused"
        if live["state"] != "printing":
            live["state_message"] = message
        if runout_paused:
            # What a U1 raises for it: 0002-0523-<head>-0000, "Filament runout detected in Toolhead N" (Snapmaker's table).
            _attach_problem(live, "paused", 2, 523, TOOLHEADS.index(toolhead), 0)
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


def discard_saved_print():
    """SDCARD_PRINT_PL_CLEAR_ENV on a real U1 that holds a halted print. A simulated printer never holds one."""
    printer = _current()
    if printer.real:
        return printer.discard_saved_print()
    raise ValueError("The printer isn't holding a halted print")


def clear_error():
    """FIRMWARE_RESTART: an errored printer comes back idle; dock errors clear."""
    printer = _current()
    if printer.real:
        return printer.clear_error()
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


def camera_snapshot():
    """A real U1 JPEG, or an explicitly simulated SVG for demo requests."""
    pid = selected_printer_id()
    if is_real(pid):
        if not is_connected(pid):
            raise ValueError("The printer is not connected. Check its address and power")
        import stock_camera
        return stock_camera.snapshot(real_printer(pid)), "image/jpeg"
    _sim()
    import timelapse
    frame = timelapse.simulated_frame(get_printer_state(), get_current_job())
    return frame if isinstance(frame, bytes) else frame.encode(), "image/svg+xml"


def printer_videos():
    """The selected real printer's own recorded time-lapses. Demo printers record none."""
    pid = selected_printer_id()
    if not is_real(pid):
        return {"videos": [], "roots": [], "demo": True}
    if not is_connected(pid):
        raise ValueError("The printer is not connected. Check its address and power")
    return real_printer(pid).printer_videos()


def printer_video_bytes(root, path, max_bytes):
    pid = selected_printer_id()
    if not is_real(pid):
        raise ValueError("Demo printers record no videos")
    if not is_connected(pid):
        raise ValueError("The printer is not connected. Check its address and power")
    return real_printer(pid).fetch_video(root, path, max_bytes)


def printer_video_stream(root, path, byte_range=None):
    """A context manager for one of the selected printer's videos, passed on as it arrives (Range requests included)."""
    pid = selected_printer_id()
    if not is_real(pid):
        raise ValueError("Demo printers record no videos")
    if not is_connected(pid):
        raise ValueError("The printer is not connected. Check its address and power")
    return real_printer(pid).stream_video(root, path, byte_range)


def printer_video_download(printer_id, root, path, out, max_bytes, on_progress=None):
    """Copy one video from the named printer into the open file `out` as it arrives (a background job calls this)."""
    if not is_real(printer_id):
        raise ValueError("Demo printers record no videos")
    if not is_connected(printer_id):
        raise ValueError("The printer is not connected. Check its address and power")
    return real_printer(printer_id).download_video(root, path, out, max_bytes, on_progress)


def set_filament(body):
    import tool_setup
    tool, colour, material = tool_setup.filament_fields(body)
    printer = _current()
    if printer.real:
        return printer.set_filament(tool, colour, material)
    printer = _sim()
    with printer.lock:
        state = printer.snapshot()
        if state["state"] in ("printing", "paused", "error"):
            raise ValueError("Filament settings can only change while the printer is idle")
        if state["toolheads"][tool].get("filament_loaded") is not True:
            raise ValueError(f"Load filament into {tool} before changing its identity")
        printer.live["toolheads"][tool].update(filament_color_hex=colour, filament_color_name=colour,
                                                 filament_material=material)
        printer.log("filament", f"{tool}: {material} {colour}")
    return {"toolhead": tool, "color_hex": colour, "material": material, "verified": True}
