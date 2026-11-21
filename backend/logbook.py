"""
logbook.py
==========

A logbook for each printer: what went wrong, what fixed it, and how many
print hours the printer had at the time, so the next time a nozzle clogs
you can search "clog" and see what worked before.

You add entries yourself. Pauses and failures the printer reports are
added by themselves (live_feed.py), in the printer's own words, waiting
for you to write what fixed them. Entries from the simulated farm are
marked as demo and only shown in demo mode, so they never mix with a real
printer's history.

Stored per printer in <data>/logbook.<printer>.json.
"""

import os
import threading
import time
import uuid
from collections import deque

import maintenance
import mock_moonraker
import storage

_DATA_DIR = storage.DATA_DIR
_lock = threading.Lock()
MAX_ENTRIES = 500
MAX_TEXT = 600
ADOPT_HOURS = 12            # a problem still open after a restart is the same incident, not a new one
SAMPLE_EVERY = 5.0          # seconds between the readings kept for "what the printer was doing just before"
SAMPLES = 8
_samples = {}               # printer id -> deque of recent readings
_sampled = {}               # printer id -> when the last one was taken (monotonic)


def _path(printer_id):
    safe = "".join(c for c in str(printer_id) if c.isalnum() or c in "-_") or "default"
    return os.path.join(_DATA_DIR, f"logbook.{safe}.json")


def _load(printer_id):
    data = storage.load_json(_path(printer_id), [])
    return data if isinstance(data, list) else []


def _text(value, field):
    text = " ".join(str(value or "").split())
    if len(text) > MAX_TEXT:
        raise ValueError(f"Keep the {field} under {MAX_TEXT} characters")
    return text


def _hours():
    try:
        return maintenance.get_printer_totals()["total_print_hours"]
    except Exception:              # a printer without history still gets an entry
        return None


def entries(printer_id=None, demo=False, query=None):
    """Newest first. Demo entries only in demo mode; real entries only outside it."""
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    rows = [e for e in _load(printer_id) if bool(e.get("demo")) == bool(demo)]
    if query:
        words = str(query).lower().split()
        rows = [e for e in rows if all(w in (e.get("problem", "") + " " + e.get("fix", "") + " " + " ".join(e.get("tags", []))).lower() for w in words)]
    rows.sort(key=lambda e: e.get("at", ""), reverse=True)
    open_count = sum(1 for e in rows if not e.get("fix"))
    return {"printer": printer_id, "entries": rows, "open": open_count}


def add(problem, fix="", tags=None, printer_id=None, demo=False, auto=False, at=None, incident=None):
    problem = _text(problem, "problem")
    if not problem:
        raise ValueError("Say what happened")
    fix = _text(fix, "fix")
    tags = [t for t in (_text(t, "tag")[:30] for t in (tags or [])[:6]) if t]
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    with _lock:
        rows = _load(printer_id)
        entry = {"id": uuid.uuid4().hex[:10], "at": at or time.strftime("%Y-%m-%dT%H:%M:%S"),
                 "print_hours": _hours(), "problem": problem, "fix": fix, "tags": tags,
                 "auto": bool(auto), "demo": bool(demo)}
        if incident:
            entry["incident"] = incident
        rows.append(entry)
        storage.save_json(_path(printer_id), rows[-MAX_ENTRIES:])
    return entry


def update(entry_id, fix=None, printer_id=None):
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    with _lock:
        rows = _load(printer_id)
        for e in rows:
            if e["id"] == entry_id:
                if fix is not None:
                    e["fix"] = _text(fix, "fix")
                    e["fixed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S") if e["fix"] else None
                storage.save_json(_path(printer_id), rows)
                return e
    raise KeyError("That logbook entry no longer exists")


def delete(entry_id, printer_id=None):
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    with _lock:
        rows = _load(printer_id)
        kept = [e for e in rows if e["id"] != entry_id]
        if len(kept) == len(rows):
            raise KeyError("That logbook entry no longer exists")
        storage.save_json(_path(printer_id), kept)
    return {"deleted": entry_id}


def record_event(printer_id, event, state, demo):
    """A pause or failure, in the printer's own words, waiting for its fix."""
    words = (state.get("state_message") or "").strip()
    what = {"paused": "Paused", "failed": "Print failed"}.get(event)
    if not what:
        return None
    if event == "paused" and words.lower().rstrip(".") in ("", "paused", "print paused", "printing paused", "paused by user"):
        return None                # a pause you pressed yourself is not a problem to log
    if state.get("problem"):
        return None                # a code the printer gave is recorded with its explanation (record_problem)
    file = state.get("current_file")
    problem = f"{what}{' during ' + file if file else ''}: {words}" if words else f"{what}{' during ' + file if file else ''}"
    try:
        with mock_moonraker.use_printer(printer_id):
            return add(problem[:MAX_TEXT], tags=[event], printer_id=printer_id, demo=demo, auto=True)
    except (ValueError, OSError):
        return None


def problems_view(printer_id=None):
    """What the printer reports now, what it has reported before (the incident timeline) and what it said lately."""
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    demo = not mock_moonraker.is_connected(printer_id)
    state = mock_moonraker.get_printer_state()
    rows = [e for e in entries(printer_id, demo=demo)["entries"] if e.get("incident")][:40]
    return {"printer": printer_id, "now": list(state.get("problems") or []), "incidents": rows,
            "messages": mock_moonraker.printer_messages(), "state": state.get("state")}


def remember_readings(printer_id, state):
    """A reading every few seconds, kept briefly, so a problem can say what the printer was doing just before it."""
    now = time.monotonic()
    if now - _sampled.get(printer_id, float("-inf")) < SAMPLE_EVERY or state.get("never_connected"):
        return
    _sampled[printer_id] = now
    heads = {name: {"temp": head.get("temperature"), "target": head.get("target_temperature")}
             for name, head in (state.get("toolheads") or {}).items()
             if isinstance(head, dict) and (head.get("status") == "active" or head.get("target_temperature"))}
    _samples.setdefault(printer_id, deque(maxlen=SAMPLES)).append({
        "at": time.strftime("%H:%M:%S"), "state": state.get("state"), "bed": state.get("bed_temperature"),
        "bed_target": state.get("bed_target"), "chamber": state.get("chamber_temperature"), "heads": heads,
        "progress": state.get("progress"), "layer": (state.get("layer") or {}).get("current")})


def _incident(problem, state, before):
    keep = {k: problem.get(k) for k in ("code", "level", "level_name", "effect", "title", "module_name", "known",
                                        "message", "origin", "raised_at")}
    keep["details"] = (problem.get("details") or "")[:300] or None
    keep["guide"] = (problem.get("guide") or {}).get("slug")
    keep["video"] = (problem.get("video") or {}).get("id")
    keep.update({"state": state.get("state"), "file": state.get("current_file"), "progress": state.get("progress"),
                 "layer": (state.get("layer") or {}).get("current"), "layers": (state.get("layer") or {}).get("total"),
                 "before": list(before)[-6:], "cleared_at": None})
    return keep


def _open_entry(printer_id, code, demo):
    """The entry of a problem that is still open, if this one was already recorded (before a restart, say)."""
    cutoff = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - ADOPT_HOURS * 3600))
    for e in sorted(_load(printer_id), key=lambda e: e.get("at", ""), reverse=True):
        inc = e.get("incident") or {}
        if inc.get("code") == code and not inc.get("cleared_at") and e.get("at", "") >= cutoff and bool(e.get("demo")) == bool(demo):
            return e
    return None


def record_problem(printer_id, state, problem, demo):
    """
    A code the printer reported: one logbook entry in the wiki's words, with what was printing and the readings from
    just before. Returns (entry, new): `new` is False when the same problem was already open (after a restart).
    """
    open_one = _open_entry(printer_id, problem["code"], demo)
    if open_one:
        return open_one, False
    what = {"paused": "Paused", "error": "Print stopped"}.get(state.get("state"), "The printer reported")
    file = state.get("current_file")
    said = f"{problem['title']} ({problem['code']})" if problem.get("title") else f"Printer error {problem['code']}"
    text = f"{what}{' during ' + file if file and what != 'The printer reported' else ''}: {said}."
    if problem.get("details"):
        text += " " + problem["details"]
    elif problem.get("message"):
        text += " The printer said: " + problem["message"]
    incident = _incident(problem, state, _samples.get(printer_id) or [])
    tags = [t for t in (problem["code"], problem.get("effect") or (problem.get("level_name") or "").lower()) if t]
    try:
        with mock_moonraker.use_printer(printer_id):
            return add(text[:MAX_TEXT], tags=tags, printer_id=printer_id, demo=demo, auto=True, incident=incident), True
    except (ValueError, OSError):
        return None, False


def clear_problem(printer_id, code):
    """The printer no longer reports this code: its entry keeps a time for when it went away."""
    with _lock:
        rows = _load(printer_id)
        changed = False
        for e in rows:
            inc = e.get("incident")
            if inc and inc.get("code") == code and not inc.get("cleared_at"):
                inc["cleared_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                changed = True
        if changed:
            storage.save_json(_path(printer_id), rows)


def reset():
    _samples.clear()
    _sampled.clear()
    for name in os.listdir(_DATA_DIR) if os.path.isdir(_DATA_DIR) else []:
        if name.startswith("logbook.") and name.endswith(".json"):
            os.remove(os.path.join(_DATA_DIR, name))
