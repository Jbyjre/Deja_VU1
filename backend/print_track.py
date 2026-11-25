"""
print_track.py
==============

A light trace of each print Deja Vu1 watches, so the print can be replayed later on the 3D twin (RECALL.2). A point is
taken when the layer changes, and otherwise every EVERY_SECONDS while the print runs. Each point holds the seconds since
the print started, the layer, how far through the file the printer was, the bed's and each head's temperature, the head
in use, how many time-lapse frames had been taken and whether the print was paused.

A print keeps at most MAX_POINTS points. Past that, every other point is dropped and points are taken half as often, so a
long print keeps its whole length at a coarser grain. A trace is a few hundred kilobytes at most.

The trace lives in memory while the print runs and is written to <data>/print_record/<id>.track.json every
WRITE_SECONDS and when the print ends, so a restart in the middle of a print loses at most the last few minutes. It is
removed with its print (print_record.forget and the record's own clean-up). Nothing is sent anywhere.
"""

import os
import re
import threading

import storage

_DIR = os.path.join(storage.DATA_DIR, "print_record")
_ID = re.compile(r"^[a-f0-9]{12}$")
FIELDS = ("t", "layer", "progress", "bed", "heads", "active", "frames", "paused")
HEADS = ("T0", "T1", "T2", "T3")
EVERY_SECONDS = 30
MAX_POINTS = 3000
WRITE_SECONDS = 300
_lock = threading.Lock()
_active = {}                     # printer id -> {"id", "t0", "points", "every", "last_t", "last_layer", "written"}


def _path(entry_id):
    if not _ID.fullmatch(entry_id or ""):
        raise ValueError("No such print in the record")
    return os.path.join(_DIR, f"{entry_id}.track.json")


def _num(value, places=1):
    return round(value, places) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def begin(printer_id, entry_id, now):
    """Start a trace for the print `entry_id` that just started on `printer_id`. `now` is time.time()."""
    if not _ID.fullmatch(entry_id or ""):
        return
    with _lock:
        _active[printer_id] = {"id": entry_id, "t0": now, "points": [], "every": EVERY_SECONDS, "last_t": None,
                               "last_layer": None, "written": now}


def _point(tr, state, now, frames):
    layer = state.get("layer")
    current = layer.get("current") if isinstance(layer, dict) else layer
    heads = state.get("toolheads") or {}
    active = state.get("active_toolhead")
    return [round(now - tr["t0"]), current if isinstance(current, int) else None, _num(state.get("progress"), 4),
            _num(state.get("bed_temperature")), [_num((heads.get(h) or {}).get("temperature")) for h in HEADS],
            HEADS.index(active) if active in HEADS else -1, frames if isinstance(frames, int) else None,
            1 if state.get("state") == "paused" else 0]


def sample(printer_id, state, now, frames=None):
    """Called on the live feed's tick. Cheap when nothing is due: no file is touched."""
    tr = _active.get(printer_id)
    if tr is None or (state or {}).get("state") not in ("printing", "paused"):
        return False
    layer = state.get("layer")
    current = layer.get("current") if isinstance(layer, dict) else layer
    due = tr["last_t"] is None or now - tr["last_t"] >= tr["every"] or (isinstance(current, int) and current != tr["last_layer"])
    if not due:
        return False
    write = None
    with _lock:
        if _active.get(printer_id) is not tr:
            return False
        tr["points"].append(_point(tr, state, now, frames))
        tr["last_t"] = now
        if isinstance(current, int):
            tr["last_layer"] = current
        if len(tr["points"]) > MAX_POINTS:
            tr["points"] = tr["points"][::2]
            tr["every"] *= 2
        if now - tr["written"] >= WRITE_SECONDS:
            tr["written"] = now
            write = (tr["id"], list(tr["points"]))
    if write:
        _write(*write)
    return True


def _write(entry_id, points, ended=False):
    try:
        os.makedirs(_DIR, exist_ok=True)
        storage.save_json(_path(entry_id), {"fields": list(FIELDS), "heads": list(HEADS), "points": points,
                                            "ended": bool(ended)}, indent=None)
    except (OSError, ValueError):
        pass                      # a trace that cannot be written never stops the live readings


def end(printer_id, state=None, now=None, frames=None):
    """The print on `printer_id` ended: take a last point and write the trace. Returns the entry id, or None."""
    with _lock:
        tr = _active.pop(printer_id, None)
        if tr is None:
            return None
        if state is not None and now is not None:
            tr["points"].append(_point(tr, state, now, frames))
        points = list(tr["points"])
    _write(tr["id"], points, ended=True)
    return tr["id"]


def resume(printer_id, filename):
    """
    Deja Vu1 restarted while this printer was printing: carry on with the trace the running print already has (from its
    last write) instead of starting one with the wrong start time. True when one was taken up.
    """
    import print_record
    from datetime import datetime
    if printer_id in _active or not filename:
        return False
    entry = print_record.running_entry(printer_id)
    if not entry or entry.get("file") != filename or not _ID.fullmatch(entry.get("id") or ""):
        return False
    try:
        t0 = datetime.fromisoformat(entry["started_at"]).timestamp()
    except (KeyError, TypeError, ValueError):
        return False
    kept = load(entry["id"]) or {}
    points = kept.get("points") if isinstance(kept.get("points"), list) else []
    with _lock:
        if printer_id in _active:
            return False
        _active[printer_id] = {"id": entry["id"], "t0": t0, "points": points, "every": EVERY_SECONDS, "last_t": None,
                               "last_layer": None, "written": t0}
    return True


def tracking(printer_id):
    tr = _active.get(printer_id)
    return tr["id"] if tr else None


def load(entry_id):
    """The trace of a print, or None when none was kept (it ran before Deja Vu1 kept traces, or on another computer)."""
    with _lock:
        live = next((tr for tr in _active.values() if tr["id"] == entry_id), None)
        if live is not None:
            return {"fields": list(FIELDS), "heads": list(HEADS), "points": list(live["points"]), "ended": False}
    data = storage.load_json(_path(entry_id), None)
    if not isinstance(data, dict) or not isinstance(data.get("points"), list):
        return None
    return data


def remove(entry_id):
    try:
        os.remove(_path(entry_id))
    except (OSError, ValueError):
        pass


def reset():
    with _lock:
        _active.clear()
