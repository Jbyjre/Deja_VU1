"""
live_feed.py
============

The dashboard's real-time engine. One background thread keeps a live,
constantly refreshed copy of every printer's state in memory, and wakes
every connected browser the moment something changes.

The rhythm is 250 ms because that is the real ceiling: Klipper sends
subscribed-object updates to Moonraker on a fixed 0.25 s timer
(SUBSCRIPTION_REFRESH_TIME in klippy/webhooks.py), so no dashboard can see
printer data fresher than that. With a real printer this thread would
hold Moonraker's WebSocket open and apply each notify_status_update as it
arrives; today it asks mock_moonraker.advance() for the same 250 ms step.

Besides caching state, each tick it notices *changes* - a print started,
paused, finished, failed or was cancelled - and turns them into events:
  - automation rules are checked (automations.py)
  - time-lapse frames are recorded at layer changes (timelapse.py)
  - a finished print gets a celebration summary and advances the queue
Events are numbered, so a browser that reconnects can tell what it missed.

Honesty rule: side effects for *simulated* printers (automations,
time-lapse, queue) only run while someone is actually using demo data, and
simulated prints never touch the real filament inventory.
"""

import threading
import time
from collections import deque
from datetime import datetime

import automations
import cost_calculator
import filament_inventory
import fleet
import mock_moonraker
import print_queue
import timelapse

TICK_SECONDS = 0.25
DEMO_ACTIVE_SECONDS = 120
CHAMBER_SAMPLE_SECONDS = 5
CHAMBER_SAMPLES = 360          # 30 minutes at one sample per 5 s

_cond = threading.Condition()
_cache = {}                    # printer_id -> {"seq", "t", "state"}
_events = deque(maxlen=200)
_event_seq = 0
_seq = 0
_fleet = {"seq": 0, "t": 0.0, "printers": []}
_climate = {}                  # printer_id -> deque of samples
_prev_state = {}
_detect_lock = threading.RLock()   # the feed thread and request threads both detect changes
_demo_seen_at = 0.0
_thread = None
_running = False


def mark_demo_seen():
    """Someone just asked for demo data; simulated side effects may run."""
    global _demo_seen_at
    _demo_seen_at = time.time()


def demo_active():
    return time.time() - _demo_seen_at <= DEMO_ACTIVE_SECONDS


# ---------------------------------------------------------------------------
# Reading the cache (what the WebSocket and the polling fallback serve)
# ---------------------------------------------------------------------------

def snapshot(printer_id):
    with _cond:
        entry = _cache.get(printer_id)
    if entry is None:
        refresh(printer_id)
        with _cond:
            entry = _cache[printer_id]
    return dict(entry)


def fleet_snapshot():
    with _cond:
        if not _fleet["printers"]:
            pass
        else:
            return dict(_fleet)
    _refresh_fleet()
    with _cond:
        return dict(_fleet)


def climate(printer_id):
    with _cond:
        return list(_climate.get(printer_id, []))


def events_since(event_id):
    with _cond:
        return [e for e in _events if e["id"] > event_id]


def last_event_id():
    with _cond:
        return _event_seq


def wait_for_change(last_seq, last_event, timeout):
    """Block until the state sequence or event id moves on, or timeout."""
    with _cond:
        _cond.wait_for(lambda: _seq != last_seq or _event_seq != last_event or not _running,
                       timeout=timeout)
        return _seq, _event_seq


# ---------------------------------------------------------------------------
# Writing the cache
# ---------------------------------------------------------------------------

def _publish(printer_id, state):
    global _seq
    with _cond:
        _seq += 1
        _cache[printer_id] = {"seq": _seq, "t": time.time(), "state": state}
        _cond.notify_all()


def publish_event(event):
    global _event_seq
    with _cond:
        _event_seq += 1
        event = {"id": _event_seq, "time": datetime.now().isoformat(timespec="seconds"), **event}
        _events.append(event)
        _cond.notify_all()
    return event


def refresh(printer_id):
    """Re-read one printer right now - used straight after a control action."""
    with mock_moonraker.use_printer(printer_id):
        state = mock_moonraker.get_printer_state()
    _detect(printer_id, state)
    _publish(printer_id, state)
    return state


def _refresh_fleet():
    try:
        printers = fleet.overview()["printers"]
    except Exception:                 # noqa: BLE001 - never let the overview kill the feed
        return
    with _cond:
        _fleet.update(seq=_fleet["seq"] + 1, t=time.time(), printers=printers)
        _cond.notify_all()


# ---------------------------------------------------------------------------
# Noticing what changed
# ---------------------------------------------------------------------------

_TRANSITIONS = {
    ("printing", "paused"): "paused",
    ("paused", "printing"): "resumed",
    ("printing", "complete"): "finished",
    ("paused", "complete"): "finished",
    ("printing", "error"): "failed",
    ("paused", "error"): "failed",
    ("printing", "ready"): "cancelled",
    ("paused", "ready"): "cancelled",
}


def _print_events(before, after):
    if before is None or before == after:
        return []
    if after == "printing" and before in ("ready", "complete", "error"):
        return ["started"]
    event = _TRANSITIONS.get((before, after))
    return [event] if event else []


def _detect(printer_id, state, finish_event=None):
    """Compare with the previous state and run what the change calls for."""
    with _detect_lock:
        return _detect_locked(printer_id, state, finish_event)


def _detect_locked(printer_id, state, finish_event):
    before = _prev_state.get(printer_id)
    _prev_state[printer_id] = state["state"]
    events = _print_events(before, state["state"])
    simulated = not mock_moonraker.is_connected(printer_id)
    side_effects = (not simulated) or demo_active()

    for name in events:
        payload = {"type": "print_event", "event": name, "printer": printer_id,
                   "printer_name": mock_moonraker.printer_name(printer_id),
                   "file": state.get("current_file"), "demo": simulated}
        if name == "finished" and finish_event:
            job = finish_event["job"]
            cost = cost_calculator.compute_job_cost(job["filament_type"], job["filament_used_grams"],
                                                    job["print_duration_hours"])
            payload["summary"] = {"file": job["filename"], "hours": job["print_duration_hours"],
                                  "grams": job["filament_used_grams"], "material": job["filament_type"],
                                  "color": job["filament_color_hex"], "cost": cost}
            if not simulated:
                payload["filament"] = filament_inventory.deduct_after_print(job)
        publish_event(payload)
        if side_effects:
            if name == "started":
                timelapse.begin(printer_id, state.get("current_file"), "simulated" if simulated else "camera")
            elif name in ("finished", "failed", "cancelled"):
                timelapse.finish(printer_id)
            if name == "finished":
                threading.Thread(target=_advance_queue, args=(printer_id,), daemon=True).start()
    if events and side_effects:
        # Print events are checked against the rules here, where they are
        # detected - whether that is the 250 ms loop or straight after a
        # button press - so an event can never slip past the rules.
        automations.evaluate(printer_id, state, set(events), demo_printer=simulated, slow_checks=False)
    return events, side_effects, simulated


def _advance_queue(printer_id):
    result = print_queue.on_print_finished(printer_id)
    if result and (result.get("started") or result.get("held")):
        publish_event({"type": "queue", "printer": printer_id,
                       "started": result.get("started"), "held": result.get("held")})
        refresh(printer_id)


def _on_automation(entry):
    publish_event({"type": "automation", **entry})


# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------

def tick(seconds=TICK_SECONDS, count=0):
    """One step for every printer. Separate from the loop so tests can drive it."""
    now = time.time()
    for printer_id in mock_moonraker.printer_ids():
        finish = mock_moonraker.advance(seconds, printer_id)
        with mock_moonraker.use_printer(printer_id):
            state = mock_moonraker.get_printer_state()
        events, side_effects, simulated = _detect(printer_id, state, finish)
        _publish(printer_id, state)

        if side_effects:
            # Continuous triggers (temperatures, mismatch, maintenance);
            # print events were already handled in _detect.
            automations.evaluate(printer_id, state, set(), demo_printer=simulated,
                                 slow_checks=(count % 4 == 0))
            if timelapse.is_recording(printer_id) and state["state"] == "printing":
                with mock_moonraker.use_printer(printer_id):
                    job = mock_moonraker.get_current_job()
                layer = state["layer"]["current"]
                if simulated:
                    timelapse.maybe_capture(printer_id, layer, timelapse.simulated_frame(state, job), "svg")
                else:
                    import camera
                    frame = camera.latest_frame()
                    if frame:
                        timelapse.maybe_capture(printer_id, layer, frame, "jpg")

        samples = _climate.setdefault(printer_id, deque(maxlen=CHAMBER_SAMPLES))
        if not samples or now - samples[-1]["t"] >= CHAMBER_SAMPLE_SECONDS:
            samples.append({"t": round(now, 1), "chamber": state.get("chamber_temperature"),
                            "bed": state.get("bed_temperature")})
    if count % 4 == 0:
        _refresh_fleet()


def _loop():
    count = 0
    last = time.monotonic()
    while _running:
        now = time.monotonic()
        # Advance by the time that really passed, so a slow tick never
        # makes the simulated printer run slow.
        try:
            tick(min(2.0, now - last), count)
        except Exception as exc:      # noqa: BLE001 - keep the feed alive
            import sys
            sys.stderr.write(f"  live feed tick failed: {exc}\n")
        last = now
        count += 1
        time.sleep(max(0.0, TICK_SECONDS - (time.monotonic() - now)))


# Automation firings become live events as soon as this module is loaded,
# whether or not the background loop has been started.
automations.add_listener(_on_automation)


def start():
    global _thread, _running
    if _thread and _thread.is_alive():
        return
    _running = True
    for printer_id in mock_moonraker.printer_ids():
        refresh(printer_id)
    _thread = threading.Thread(target=_loop, name="live-feed", daemon=True)
    _thread.start()


def stop():
    global _running
    _running = False
    with _cond:
        _cond.notify_all()
    if _thread:
        _thread.join(timeout=2)


def reset():
    """Forget cached state and events. Useful for tests."""
    global _seq, _event_seq, _demo_seen_at
    with _cond:
        _cache.clear()
        _events.clear()
        _climate.clear()
        _prev_state.clear()
        _seq = 0
        _event_seq = 0
        _demo_seen_at = 0.0
        _fleet.update(seq=0, t=0.0, printers=[])
