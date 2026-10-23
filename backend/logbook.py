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

import maintenance
import mock_moonraker
import storage

_DATA_DIR = storage.DATA_DIR
_lock = threading.Lock()
MAX_ENTRIES = 500
MAX_TEXT = 600


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


def add(problem, fix="", tags=None, printer_id=None, demo=False, auto=False, at=None):
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
    file = state.get("current_file")
    problem = f"{what}{' during ' + file if file else ''}: {words}" if words else f"{what}{' during ' + file if file else ''}"
    try:
        with mock_moonraker.use_printer(printer_id):
            return add(problem[:MAX_TEXT], tags=[event], printer_id=printer_id, demo=demo, auto=True)
    except (ValueError, OSError):
        return None


def reset():
    for name in os.listdir(_DATA_DIR) if os.path.isdir(_DATA_DIR) else []:
        if name.startswith("logbook.") and name.endswith(".json"):
            os.remove(os.path.join(_DATA_DIR, name))
