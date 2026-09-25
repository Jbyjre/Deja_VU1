"""
fleet.py
========

More than one printer. Two separate things live here:

  1. The registry - the printers the user has added by address (a
     Moonraker URL on the home network). That is the dashboard's own
     setting, like the filament list, so it is always available. Until a
     real Moonraker client exists, a registered printer honestly shows as
     "not connected" - it is never filled in with made-up numbers.

  2. The overview - one at-a-glance row per printer (state, progress,
     alerts, health). Those are printer figures, so the API only serves
     them for connected printers or, with demo data switched on, for the
     simulated fleet in mock_moonraker.py.

Selecting a printer anywhere in the dashboard adds ?printer=<id> to every
request; the server then answers every existing module for that printer.
"""

import os
import re
import threading
import uuid
from datetime import datetime

import maintenance
import mock_moonraker
import print_gate
import storage

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_PATH = os.path.join(_DATA_DIR, "fleet.json")
_URL = re.compile(r"^https?://[A-Za-z0-9.-]{1,253}(:\d{1,5})?/?$")
_lock = threading.RLock()


def registered():
    with _lock:
        items = storage.load_json(_PATH, [])
        return items if isinstance(items, list) else []


def _save(items):
    storage.save_json(_PATH, items)


def add(name, moonraker_url):
    name = str(name or "").strip()[:40]
    url = str(moonraker_url or "").strip()
    if not name:
        raise ValueError("Give the printer a name")
    if not _URL.match(url):
        raise ValueError("Enter the printer's Moonraker address, like http://192.168.1.50:7125")
    with _lock:
        items = registered()
        if len(items) >= 12:
            raise ValueError("At most 12 printers")
        entry = {"id": f"printer-{uuid.uuid4().hex[:6]}", "name": name,
                 "moonraker_url": url.rstrip("/"),
                 "added_at": datetime.now().isoformat(timespec="seconds"),
                 "connected": mock_moonraker.is_connected()}
        items.append(entry)
        _save(items)
    return entry


def remove(printer_id):
    with _lock:
        items = registered()
        kept = [p for p in items if p["id"] != printer_id]
        if len(kept) == len(items):
            raise ValueError("Unknown printer")
        _save(kept)
    return kept


def registry():
    return {"printers": [{**p, "connected": mock_moonraker.is_connected()} for p in registered()],
            "note": ("Printers you add are saved here. Live data needs a real Moonraker "
                     "connection, which arrives with the hardware - until then they show "
                     "as not connected.")}


def _alerts(state, maint):
    alerts = []
    for th, dock in state["toolheads"].items():
        if dock["status"] == "error":
            alerts.append({"level": "error", "text": f"Dock {th} error"})
    if state["state"] == "error":
        alerts.append({"level": "error", "text": state.get("state_message") or "Printer error"})
    if state["state"] == "paused":
        alerts.append({"level": "warning", "text": "Paused"})
    overdue = maint["summary"]["overdue"]
    if overdue:
        alerts.append({"level": "warning", "text": f"{overdue} maintenance overdue"})
    return alerts


def summary_for(printer_id, state=None):
    """One printer's overview row (call inside nothing - it selects itself)."""
    with mock_moonraker.use_printer(printer_id):
        state = state or mock_moonraker.get_printer_state()
        maint = maintenance.get_status()
        health = print_gate.printer_health()
    progress = state.get("progress") or 0.0
    elapsed = state.get("print_duration_hours") or 0.0
    remaining = (elapsed / progress - elapsed) if 0 < progress < 1 and state["state"] == "printing" else None
    active = state.get("active_toolhead")
    return {
        "id": printer_id,
        "name": mock_moonraker.printer_name(printer_id),
        "state": state["state"],
        "state_message": state.get("state_message"),
        "current_file": state.get("current_file"),
        "progress": round(progress, 4),
        "remaining_hours": round(remaining, 3) if remaining is not None else None,
        "active_toolhead": active,
        "active_color": state["toolheads"][active]["filament_color_hex"] if active else None,
        "nozzle_temperature": state["toolheads"][active]["temperature"] if active else None,
        "bed_temperature": state.get("bed_temperature"),
        "chamber_temperature": state.get("chamber_temperature"),
        "docks": {th: {"status": d["status"], "color": d["filament_color_hex"]}
                  for th, d in state["toolheads"].items()},
        "alerts": _alerts(state, maint),
        "health": health["score"],
    }


def overview():
    return {"printers": [summary_for(pid) for pid in mock_moonraker.printer_ids()]}


def reset():
    with _lock:
        _save([])
