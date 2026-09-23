"""
print_queue.py
==============

A short, ordered list of files to print one after another on a printer.

Every start goes through the same Confirm Print gate as a manual start
(print_gate.py): when a print finishes and the queue is set to advance on
its own, the next file is checked first -
  clear    -> it starts
  confirm  -> it is held: there are warnings a person has to read
  blocked  -> it is held, with the reasons
so the queue can never start a print a person couldn't have started from
the confirm screen. Held items say exactly why they are waiting.

Stored per printer in backend/data/print_queue.json.
"""

import json
import os
import threading
import uuid
from datetime import datetime

import file_library
import mock_moonraker
import print_gate
import printer_control

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_PATH = os.path.join(_DATA_DIR, "print_queue.json")
MAX_ITEMS = 20
_lock = threading.RLock()


def _load():
    if not os.path.exists(_PATH):
        return {}
    with open(_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _save(data):
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


def _queue(data, printer_id):
    return data.setdefault(printer_id, {"items": [], "auto_advance": False})


def get(printer_id=None):
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    with _lock:
        q = _queue(_load(), printer_id)
    return {"printer": printer_id, **q}


def add(filename, printer_id=None):
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    if file_library.kind_of(filename) != "gcode":
        raise ValueError("Only G-code files can be queued")
    if not file_library.exists(filename):
        raise ValueError(f"No file called {filename} in the library")
    with _lock:
        data = _load()
        q = _queue(data, printer_id)
        waiting = [i for i in q["items"] if i["status"] in ("queued", "held")]
        if len(waiting) >= MAX_ITEMS:
            raise ValueError(f"The queue holds at most {MAX_ITEMS} files")
        q["items"].append({"id": uuid.uuid4().hex[:8], "filename": filename, "status": "queued",
                           "added_at": datetime.now().isoformat(timespec="seconds"), "note": None})
        _save(data)
    return get(printer_id)


def remove(item_id, printer_id=None):
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    with _lock:
        data = _load()
        q = _queue(data, printer_id)
        before = len(q["items"])
        q["items"] = [i for i in q["items"] if i["id"] != item_id]
        if len(q["items"]) == before:
            raise ValueError("That item isn't in the queue")
        _save(data)
    return get(printer_id)


def move(item_id, direction, printer_id=None):
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    if direction not in ("up", "down"):
        raise ValueError("direction must be up or down")
    with _lock:
        data = _load()
        items = _queue(data, printer_id)["items"]
        idx = next((n for n, i in enumerate(items) if i["id"] == item_id), None)
        if idx is None:
            raise ValueError("That item isn't in the queue")
        swap = idx - 1 if direction == "up" else idx + 1
        if 0 <= swap < len(items):
            items[idx], items[swap] = items[swap], items[idx]
            _save(data)
    return get(printer_id)


def set_auto_advance(enabled, printer_id=None):
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    with _lock:
        data = _load()
        _queue(data, printer_id)["auto_advance"] = bool(enabled)
        _save(data)
    return get(printer_id)


def clear_done(printer_id=None):
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    with _lock:
        data = _load()
        q = _queue(data, printer_id)
        q["items"] = [i for i in q["items"] if i["status"] in ("queued", "held")]
        _save(data)
    return get(printer_id)


def start_next(printer_id=None, confirmed=False, automatic=False):
    """
    Try to start the first waiting file. Returns what happened:
    {"started": item} or {"held": item, "gate": ...} or {"empty": True}.
    """
    printer_id = printer_id or mock_moonraker.selected_printer_id()
    with _lock:
        data = _load()
        q = _queue(data, printer_id)
        item = next((i for i in q["items"] if i["status"] in ("queued", "held")), None)
        if item is None:
            return {"empty": True, **get(printer_id)}
        with mock_moonraker.use_printer(printer_id):
            if not file_library.exists(item["filename"]):
                item.update(status="held", note="The file is no longer in the library")
                _save(data)
                return {"held": item, **get(printer_id)}
            gate = print_gate.summary(item["filename"])
            if gate["verdict"] == "blocked" or (gate["verdict"] == "confirm" and not confirmed):
                why = gate["blocking"] or gate["warnings"]
                item.update(status="held",
                            note=("Blocked: " if gate["verdict"] == "blocked" else
                                  "Waiting for you to confirm: ") + "; ".join(why)[:300])
                _save(data)
                return {"held": item, "gate": gate, **get(printer_id)}
            try:
                printer_control.start_print(item["filename"], confirmed=True)
            except (ValueError, mock_moonraker.PrinterCommandError, printer_control.PrintBlocked) as exc:
                item.update(status="held", note=f"The printer refused to start: {exc}")
                _save(data)
                return {"held": item, **get(printer_id)}
        item.update(status="started", started_at=datetime.now().isoformat(timespec="seconds"),
                    note="Started automatically after the last print" if automatic else None)
        _save(data)
        return {"started": item, **get(printer_id)}


def on_print_finished(printer_id):
    """Called by the live feed when a print completes."""
    with _lock:
        data = _load()
        q = _queue(data, printer_id)
        for item in q["items"]:
            if item["status"] == "started":
                item["status"] = "done"
        _save(data)
        auto = q["auto_advance"]
    if auto:
        return start_next(printer_id, automatic=True)
    return None


def reset():
    with _lock:
        _save({})
