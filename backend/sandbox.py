"""
sandbox.py
==========

The digital-twin farm simulator: a control panel bolted onto
mock_moonraker.py, not a second simulator. It adds printers to the same
simulated fleet every other module already reads, and drives the same
simulation clock the live feed does, so the fleet view, automations, the
queue, notifications and the time-lapse all react exactly as they would to
a real farm - because as far as they can tell, it is one.

Three parts:

  build_farm() / teardown()   add or remove simulated printers (up to
                              mock_moonraker.MAX_SANDBOX_PRINTERS), each a
                              SimulatedPrinter like the built-in three
  scenario                    timed steps: "at 20 min, jam a printing
                              printer", "at 30 min, drop the network to
                              the same one"... Built-in presets, or your own
  the clock                   play (the live feed moves it, at the sandbox's
                              speed) or step forward by a chosen amount now

Every step's outcome is logged as what really happened - a jam aimed at a
printer that isn't printing is logged as refused, not as done - and
published as a live event.

Starting a print from a scenario goes through the Confirm Print gate
exactly as the queue does: "blocked" never starts, and "confirm" starts
only when the step says a person accepted the warnings.

Only reachable with demo data on, and never while a real printer is
connected (the API enforces it, like the other demo hooks).
"""

import random
import threading
from datetime import datetime

import file_library
import live_feed
import maintenance
import mock_moonraker
import print_gate
import print_queue
import printer_control
import sample_files

MAX_STEPS = 60
MAX_STEP_SECONDS = 24 * 3600
MAX_SCENARIO_SECONDS = 7 * 24 * 3600
_CHUNK_TICKS = 120            # a "step forward" is cut into at most this many live-feed ticks

EVENTS = {
    "start_print": "Start a print (through Confirm Print)",
    "queue_file": "Add a file to its queue",
    "jam": "Filament jam mid-print",
    "runout": "Filament runs out on a dock",
    "heater_fault": "Heater fault (Klipper shuts down)",
    "bad_swap": "Wrong filament loaded",
    "network_drop": "Network link drops",
    "network_restore": "Network link comes back",
    "wear": "Rack up print hours (maintenance comes due)",
    "pause": "Pause", "resume": "Resume", "cancel": "Cancel",
    "clear_error": "Restart firmware (clears an error)",
}
TARGETS = {"all": "Every printer", "random": "A random printer", "random-printing": "A random printing printer",
           "random-idle": "A random idle printer", "previous": "The same printer as the step before"}

PRESETS = [
    {"id": "jam", "name": "Jam mid-print",
     "about": "A printing printer jams 10 minutes in. Watch the fleet card turn red, the print "
              "fail in history, and any \"print failed\" rule fire.",
     "steps": [{"at_s": 600, "printer": "random-printing", "event": "jam"}]},
    {"id": "network", "name": "Network drop",
     "about": "One printer stops answering for 15 minutes. Its card keeps its last report, "
              "labelled stale; commands to it fail in words; then it comes back.",
     "steps": [{"at_s": 120, "printer": "random", "event": "network_drop"},
               {"at_s": 1020, "printer": "previous", "event": "network_restore"}]},
    {"id": "swap", "name": "Bad filament swap",
     "about": "Someone loads the wrong colour on the active toolhead of a running print. The "
              "filament-mismatch rule fires, and Confirm Print blocks the next start.",
     "steps": [{"at_s": 60, "printer": "random-printing", "event": "bad_swap"}]},
    {"id": "wear", "name": "Maintenance goes overdue",
     "about": "A printer racks up 60 print hours. Maintenance counts them itself and the nozzle "
              "check goes overdue - the fleet alert and any maintenance rule follow.",
     "steps": [{"at_s": 30, "printer": "random", "event": "wear", "params": {"hours": 60}}]},
    {"id": "night", "name": "A rough night",
     "about": "A runout, a jam, a network drop and a heater fault across the farm over an "
              "hour - the farm-scale version, to see everything react at once.",
     "steps": [{"at_s": 300, "printer": "random-printing", "event": "runout", "params": {"toolhead": "active"}},
               {"at_s": 1200, "printer": "random-printing", "event": "jam"},
               {"at_s": 1800, "printer": "random", "event": "network_drop"},
               {"at_s": 2700, "printer": "previous", "event": "network_restore"},
               {"at_s": 3600, "printer": "random-idle", "event": "heater_fault"}]},
]

_lock = threading.RLock()
_state = {"running": False, "speed": 1.0, "clock_s": 0.0, "steps": [], "log": [], "seed": 1,
          "scenario_name": None, "previous": None, "rng": random.Random(1)}


# ---------------------------------------------------------------------------
# The farm
# ---------------------------------------------------------------------------

def _scenario_for(rng, busy):
    """A starting state for one new printer, in _FLEET_SPEC's shape."""
    loaded = {"T0": 2, "T1": 0, "T2": rng.randrange(6), "T3": rng.randrange(6)}
    if busy:
        total = round(rng.uniform(0.6, 5.0), 2)
        progress = round(rng.uniform(0.05, 0.85), 3)
        layers = rng.randrange(80, 400)
        return {"state": "printing", "file": rng.choice(mock_moonraker._JOB_NAMES), "progress": progress,
                "hours": round(total * progress, 2), "total_hours": total, "active": "T0", "layers": layers,
                "loaded": loaded, "required": [("T0", 2, "PLA")]}
    return {"state": "ready", "file": None, "progress": 0.0, "hours": 0.0, "total_hours": 0.0,
            "active": None, "layers": 0, "loaded": loaded, "required": []}


def build_farm(count, busy_fraction=0.5, seed=None):
    """Add `count` simulated printers; about `busy_fraction` of them mid-print."""
    try:
        count = int(count)
        busy_fraction = float(busy_fraction)
    except (TypeError, ValueError):
        raise ValueError("count must be a whole number and busy_fraction a number")
    if not 1 <= count <= mock_moonraker.MAX_SANDBOX_PRINTERS:
        raise ValueError(f"Add between 1 and {mock_moonraker.MAX_SANDBOX_PRINTERS} printers at a time")
    if not 0 <= busy_fraction <= 1:
        raise ValueError("busy_fraction must be between 0 and 1")
    existing = len(sandbox_printers())
    if existing + count > mock_moonraker.MAX_SANDBOX_PRINTERS:
        raise ValueError(f"The sandbox holds at most {mock_moonraker.MAX_SANDBOX_PRINTERS} extra printers "
                         f"({existing} already)")
    rng = random.Random(seed if seed is not None else 4242 + existing)
    busy_count = round(count * busy_fraction)
    busy_flags = [True] * busy_count + [False] * (count - busy_count)
    rng.shuffle(busy_flags)
    added = []
    for i, busy in enumerate(busy_flags):
        pid = mock_moonraker.add_printer(f"Sim {existing + i + 1:02d}", rng.randrange(1, 10 ** 6),
                                         _scenario_for(rng, busy), jobs=rng.randrange(6, 30),
                                         days=rng.randrange(14, 60))
        with mock_moonraker.use_printer(pid):
            mock_moonraker.set_time_scale(_state["speed"])
        live_feed.refresh(pid)
        added.append(pid)
    _log(None, "farm", True, f"Added {count} printer(s) - {busy_count} mid-print")
    return status()


def sandbox_printers():
    return [pid for pid in mock_moonraker.printer_ids() if mock_moonraker.is_sandbox_printer(pid)]


def teardown():
    """Remove every printer the sandbox added, with their queues and logs."""
    removed = sandbox_printers()
    for pid in removed:
        mock_moonraker.remove_printer(pid)
        live_feed.forget(pid)
        print_queue.forget(pid)
        maintenance.forget_printer(pid)
    if removed:
        _log(None, "farm", True, f"Removed {len(removed)} sandbox printer(s)")
    return status()


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def _clean_step(step):
    if not isinstance(step, dict):
        raise ValueError("Each step must be an object")
    event = step.get("event")
    if event not in EVENTS:
        raise ValueError(f"Unknown event: {event}")
    try:
        at = float(step.get("at_s", 0))
    except (TypeError, ValueError):
        raise ValueError("at_s must be a number of seconds")
    if not 0 <= at <= MAX_SCENARIO_SECONDS:
        raise ValueError("Steps must happen within 7 days of the start")
    printer = str(step.get("printer") or "random")
    if printer not in TARGETS and not mock_moonraker.has_printer(printer):
        raise ValueError(f"Unknown printer: {printer}")
    params = step.get("params") or {}
    if not isinstance(params, dict):
        raise ValueError("params must be an object")
    return {"at_s": at, "printer": printer, "event": event, "params": params}


def load_scenario(steps=None, preset=None, seed=None):
    """Replace the scenario and rewind its clock (the farm is left as it is)."""
    if preset:
        found = next((p for p in PRESETS if p["id"] == preset), None)
        if not found:
            raise ValueError(f"Unknown preset: {preset}")
        steps, name = found["steps"], found["name"]
    else:
        name = "Custom scenario"
    if not isinstance(steps, list) or not steps:
        raise ValueError("A scenario needs at least one step")
    if len(steps) > MAX_STEPS:
        raise ValueError(f"At most {MAX_STEPS} steps")
    cleaned = sorted((_clean_step(s) for s in steps), key=lambda s: s["at_s"])
    with _lock:
        _state.update(steps=[{**s, "n": i + 1, "fired": False, "outcome": None} for i, s in enumerate(cleaned)],
                      clock_s=0.0, scenario_name=name, previous=None, running=False,
                      seed=int(seed) if seed is not None else 1)
        _state["rng"] = random.Random(_state["seed"])
    _log(None, "scenario", True, f"Loaded \"{name}\" - {len(cleaned)} step(s); clock at 0")
    return status()


def _resolve(target):
    """Which printer(s) a step's target means right now."""
    ids = mock_moonraker.printer_ids()
    if target == "all":
        return ids
    if target == "previous":
        prev = _state["previous"]
        if not prev or not mock_moonraker.has_printer(prev):
            raise ValueError("There's no earlier step's printer to repeat")
        return [prev]
    if target.startswith("random"):
        states = {}
        for pid in ids:
            with mock_moonraker.use_printer(pid):
                states[pid] = mock_moonraker.get_printer_state()["state"]
        pool = ids
        if target == "random-printing":
            pool = [p for p in ids if states[p] == "printing"]
        elif target == "random-idle":
            pool = [p for p in ids if states[p] in ("ready", "complete")]
        if not pool:
            raise ValueError({"random-printing": "No printer is printing", "random-idle": "No printer is idle"}
                             .get(target, "No printers"))
        return [_state["rng"].choice(sorted(pool))]
    if not mock_moonraker.has_printer(target):
        raise ValueError(f"{target} isn't in the farm any more")
    return [target]


def _toolhead(param, state):
    if param in (None, "", "active"):
        return state.get("active_toolhead") or "T0"
    if param not in mock_moonraker.TOOLHEADS:
        raise ValueError(f"Unknown toolhead: {param}")
    return param


def _wrong_colour(toolhead):
    """A colour the running job would call a mismatch on this toolhead."""
    import color_check
    need = next((r for r in mock_moonraker.get_current_job_requirements()["required_filament"]
                 if r["toolhead"] == toolhead), None)
    loaded = mock_moonraker.get_printer_state()["toolheads"][toolhead]["filament_color_hex"]
    for i, c in enumerate(mock_moonraker.FILAMENT_COLORS):
        against = need["expected_color_hex"] if need and need.get("expected_color_hex") else loaded
        if color_check.compare(against, c["hex"])["verdict"] == "mismatch":
            return i
    return 0


def _start(printer_id, params):
    name = params.get("file") or "calibration_cube_20mm.gcode"
    if not file_library.exists(name):
        if name in sample_files.SAMPLES:
            file_library.save(name, sample_files.build(name), origin="sample")
        else:
            raise ValueError(f"No file called {name} in the library")
    # The same order the queue uses: read the gate, respect it, then start
    # (printer_control.start_print runs the gate once more as it starts).
    gate = print_gate.summary(name)
    if gate["verdict"] == "blocked":
        raise ValueError("Confirm Print blocked it: " + "; ".join(gate["blocking"])[:300])
    if gate["verdict"] == "confirm" and not params.get("accept_warnings"):
        raise ValueError("Held - Confirm Print has warnings a person has to accept: "
                         + "; ".join(gate["warnings"])[:300])
    printer_control.start_print(name, confirmed=True)
    return f"Started {name} (Confirm Print: {gate['verdict']})"


def _perform(printer_id, event, params):
    """Do one event on one printer. Returns what happened, in words."""
    with mock_moonraker.use_printer(printer_id):
        state = mock_moonraker.get_printer_state()
        if event == "start_print":
            return _start(printer_id, params)
        if event == "queue_file":
            name = params.get("file") or "calibration_cube_20mm.gcode"
            if not file_library.exists(name) and name in sample_files.SAMPLES:
                file_library.save(name, sample_files.build(name), origin="sample")
            print_queue.add(name, printer_id=printer_id)
            return f"Queued {name}"
        if event == "jam":
            th = _toolhead(params.get("toolhead"), state)
            return mock_moonraker.inject_jam(th)["state_message"]
        if event == "runout":
            th = _toolhead(params.get("toolhead"), state)
            after = mock_moonraker.inject_runout(th)
            return f"{th} ran out" + (" - the print paused" if after["state"] == "paused" and state["state"] == "printing" else "")
        if event == "heater_fault":
            th = _toolhead(params.get("toolhead"), state)
            return mock_moonraker.inject_heater_fault(th)["state_message"]
        if event == "bad_swap":
            th = _toolhead(params.get("toolhead"), state)
            idx = params.get("color_index")
            idx = _wrong_colour(th) if idx is None else int(idx)
            after = mock_moonraker.load_filament(th, idx)
            return f"{th} now has {after['toolheads'][th]['filament_color_name']} loaded"
        if event == "network_drop":
            mock_moonraker.set_link(False)
            return "Stopped answering (the simulation keeps running behind the drop)"
        if event == "network_restore":
            if mock_moonraker.link_is_up():
                return "Its link was already up"
            mock_moonraker.set_link(True)
            return "Answering again"
        if event == "wear":
            hours = float(params.get("hours", 60))
            r = mock_moonraker.add_wear(hours)
            overdue = maintenance.get_status()["summary"]["overdue"]
            return f"+{r['added_hours']:g} print hours - {overdue} maintenance task(s) now overdue"
        if event == "pause":
            return f"Now {printer_control.pause_print()['state']}"
        if event == "resume":
            return f"Now {printer_control.resume_print()['state']}"
        if event == "cancel":
            return f"Now {printer_control.cancel_print()['state']}"
        if event == "clear_error":
            return f"Now {mock_moonraker.clear_error()['state']}"
    raise ValueError(f"Unknown event: {event}")


def fire(event, printer="random", params=None, step=None):
    """Run one event now, on the printer(s) it targets, and log each outcome."""
    if event not in EVENTS:
        raise ValueError(f"Unknown event: {event}")
    params = params or {}
    outcomes = []
    try:
        targets = _resolve(printer)
    except ValueError as exc:
        outcomes.append(_log(None, event, False, str(exc), step))
        return outcomes
    for pid in targets:
        # Read it first, so the live feed has a "before" to compare with and
        # turns the change this event makes into its usual print event.
        live_feed.refresh(pid)
        try:
            detail = _perform(pid, event, params)
            outcomes.append(_log(pid, event, True, detail, step))
        except mock_moonraker.PrinterCommandError as exc:
            outcomes.append(_log(pid, event, False, f"The printer reported a failure: {exc}", step))
        except (ValueError, printer_control.PrintBlocked) as exc:
            outcomes.append(_log(pid, event, False, str(exc), step))
        with _lock:
            _state["previous"] = pid
        live_feed.refresh(pid)
    return outcomes


def _log(printer_id, event, ok, detail, step=None):
    entry = {"time": datetime.now().isoformat(timespec="seconds"), "clock_s": round(_state["clock_s"], 1),
             "printer": printer_id,
             "printer_name": mock_moonraker.printer_name(printer_id) if printer_id and mock_moonraker.has_printer(printer_id) else None,
             "event": event, "label": EVENTS.get(event, event), "ok": ok, "detail": detail,
             "step": step}
    with _lock:
        _state["log"].append(entry)
        del _state["log"][:-200]
    live_feed.publish_event({"type": "sandbox", **entry})
    return entry


def _fire_due():
    """Fire every step whose time has come, in order."""
    while True:
        with _lock:
            due = next((s for s in _state["steps"] if not s["fired"] and s["at_s"] <= _state["clock_s"]), None)
            if due is None:
                return
            due["fired"] = True
        outcomes = fire(due["event"], due["printer"], due["params"], step=due["n"])
        with _lock:
            due["outcome"] = {"ok": all(o["ok"] for o in outcomes),
                              "detail": "; ".join((f"{o['printer_name']}: " if o["printer_name"] else "") + o["detail"]
                                                  for o in outcomes)}


# ---------------------------------------------------------------------------
# The clock
# ---------------------------------------------------------------------------

def set_running(running):
    with _lock:
        _state["running"] = bool(running)
    _fire_due()
    return status()


def set_speed(speed):
    try:
        speed = float(speed)
    except (TypeError, ValueError):
        raise ValueError("Speed must be a number")
    if not 1 <= speed <= 600:
        raise ValueError("Speed must be between 1× and 600×")
    for pid in mock_moonraker.printer_ids():
        with mock_moonraker.use_printer(pid):
            mock_moonraker.set_time_scale(speed)
    with _lock:
        _state["speed"] = speed
    return status()


def step(seconds):
    """
    Move the whole farm forward by `seconds` of simulated time, now. It goes
    through the live feed's own tick, cut into short slices and split at
    each scenario step, so every event, automation and queue advance
    happens at the moment it would have in real time.
    """
    try:
        seconds = float(seconds)
    except (TypeError, ValueError):
        raise ValueError("seconds must be a number")
    if not 0 < seconds <= MAX_STEP_SECONDS:
        raise ValueError("Step forward by between 1 second and 24 hours")
    live_feed.mark_demo_seen()
    remaining = seconds
    chunk = max(1.0, seconds / _CHUNK_TICKS)
    count = 0
    while remaining > 1e-9:
        with _lock:
            upcoming = [s["at_s"] - _state["clock_s"] for s in _state["steps"]
                        if not s["fired"] and s["at_s"] > _state["clock_s"]]
        slice_s = min(chunk, remaining, *(u for u in upcoming if u > 0)) if upcoming else min(chunk, remaining)
        live_feed.tick(slice_s, count, scaled=False)
        with _lock:
            _state["clock_s"] += slice_s
        _fire_due()
        remaining -= slice_s
        count += 1
    return status()


def on_tick(seconds, scaled):
    """The live feed's heartbeat: while playing, the scenario clock moves too."""
    if not scaled or not live_feed.demo_active():
        return                      # step() moves the clock itself; no demo, no scenario
    with _lock:
        if not _state["running"]:
            return
        _state["clock_s"] += seconds * _state["speed"]
    _fire_due()


live_feed.add_tick_listener(on_tick)


def status():
    farm = []
    for pid in mock_moonraker.printer_ids():
        with mock_moonraker.use_printer(pid):
            st = mock_moonraker.get_printer_state()
        farm.append({"id": pid, "name": mock_moonraker.printer_name(pid), "state": st["state"],
                     "sandbox": mock_moonraker.is_sandbox_printer(pid), "link_lost": bool(st.get("link_lost")),
                     "message": st.get("state_message")})
    with _lock:
        steps = [{k: v for k, v in s.items()} for s in _state["steps"]]
        return {"running": _state["running"], "speed": _state["speed"], "clock_s": round(_state["clock_s"], 1),
                "scenario_name": _state["scenario_name"], "steps": steps,
                "pending": sum(1 for s in steps if not s["fired"]),
                "log": list(reversed(_state["log"][-60:])), "farm": farm,
                "sandbox_count": sum(1 for f in farm if f["sandbox"]),
                "max_printers": mock_moonraker.MAX_SANDBOX_PRINTERS,
                "presets": [{k: p[k] for k in ("id", "name", "about", "steps")} for p in PRESETS],
                "events": EVENTS, "targets": TARGETS}


def reset():
    """Stop, forget the scenario, and remove the sandbox's printers."""
    teardown()
    with _lock:
        _state.update(running=False, clock_s=0.0, steps=[], log=[], scenario_name=None, previous=None, seed=1)
        _state["rng"] = random.Random(1)
    set_speed(1)
    return status()
