"""
print_record.py
===============

The print record: one entry for every print a printer runs while Deja Vu1 watches it, kept on this
computer. An entry is opened when the live feed sees a print start (the file, what the file says it will
take, which roll is on each head) and filled in when it ends (how it ended, the real time, the filament,
the cost, the time-lapse it got and a camera picture taken at the end). Notes are yours to add.

Older prints the printer itself remembers (Moonraker's job history) are listed beside these, marked as
the printer's, so the record is never empty on a printer that printed before Deja Vu1 was installed.

Entries from the simulated printers are marked as demo and shown only in demo mode, so they never mix
with a real printer's history (the logbook does the same). Entries older than the chosen time (Settings
on the Prints part, default a year) are removed with their pictures.

Stored in <data>/print_record.json, pictures in <data>/print_record/<id>.jpg (or .svg for a demo).
"""

import os
import re
import threading
import time
import uuid
from datetime import datetime, timedelta

import file_library
import storage

_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, "print_record.json")
_PICTURES = os.path.join(_DATA_DIR, "print_record")
_lock = threading.RLock()
MAX_ENTRIES = 2000
KEEP_CHOICES = (30, 90, 365, 0)          # days; 0 keeps everything
DEFAULT_KEEP_DAYS = 365
NOTE_LIMIT = 1000
_ID = re.compile(r"^[a-f0-9]{12}$")
# A printer's own history entry is the same print as one of ours when it names the same file and ended within this many seconds of it.
SAME_PRINT_SECONDS = 15 * 60
ENDED = ("finished", "failed", "cancelled")


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _blank():
    return {"settings": {"keep_days": DEFAULT_KEEP_DAYS}, "prints": []}


def _load():
    data = storage.load_json(_PATH, None)
    if not isinstance(data, dict) or not isinstance(data.get("prints"), list):
        return _blank()
    data.setdefault("settings", {"keep_days": DEFAULT_KEEP_DAYS})
    return data


def _save(data):
    storage.save_json(_PATH, data, indent=None)


def _picture_path(entry_id, kind):
    if not _ID.fullmatch(entry_id or ""):
        raise ValueError("No such print in the record")
    return os.path.join(_PICTURES, f"{entry_id}.{kind}")


def _num(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def _heads(state, job, printer_id):
    """Each head the file uses, with what the printer reported loaded on it and the roll assigned to it."""
    required = (job or {}).get("required_filament") or []
    used = [r.get("toolhead") for r in required if r.get("toolhead")]
    spools = {}
    try:
        import tool_setup
        import filament_inventory
        by_id = {s.get("id"): s for s in filament_inventory.get_inventory()}
        for head in tool_setup.get(printer_id).get("heads") or []:
            spool = by_id.get(head.get("spool_id"))
            if spool:
                spools[head["toolhead"]] = " ".join(str(spool.get(k) or "") for k in ("brand", "material", "color_name")).strip()
    except Exception:
        pass
    toolheads = state.get("toolheads") or {}
    out = []
    for req in required:
        head = req.get("toolhead")
        if not head:
            continue
        loaded = toolheads.get(head) or {}
        out.append({"toolhead": head,
                    "colour": loaded.get("filament_color_hex") or req.get("expected_color_hex"),
                    "colour_name": loaded.get("filament_color_name") or req.get("expected_color_name"),
                    "material": loaded.get("filament_material") or req.get("expected_material"),
                    "grams_in_file": _num(req.get("grams")),
                    "spool": spools.get(head)})
    if not out and not used and state.get("active_toolhead"):
        head = state["active_toolhead"]
        loaded = toolheads.get(head) or {}
        out.append({"toolhead": head, "colour": loaded.get("filament_color_hex"), "colour_name": loaded.get("filament_color_name"),
                    "material": loaded.get("filament_material"), "grams_in_file": None, "spool": spools.get(head)})
    return out


def started(printer_id, printer_name, state, job, demo):
    """A print began: open its entry. Returns the entry. A print already open on this printer is closed as ended unknown."""
    filename = state.get("current_file") or (job or {}).get("filename") or "(unknown file)"
    entry = {
        "id": uuid.uuid4().hex[:12], "printer": printer_id, "printer_name": printer_name, "file": filename,
        "status": "running", "demo": bool(demo), "started_at": _now(), "ended_at": None,
        "estimated_hours": _num((job or {}).get("total_hours")),
        "real_hours": None, "grams": None, "grams_in_file": _num((job or {}).get("filament_grams")),
        "material": (job or {}).get("material"), "heads": _heads(state, job, printer_id),
        "cost": None, "timelapse": None, "picture": None, "note": "",
    }
    with _lock:
        data = _load()
        for old in data["prints"]:
            if old.get("printer") == printer_id and old.get("status") == "running":
                old.update(status="unknown", ended_at=old.get("ended_at") or entry["started_at"])
        data["prints"].append(entry)
        _prune(data)
        _save(data)
    return dict(entry)


def ended(printer_id, how, state, job=None, cost=None, timelapse_session=None, demo=False):
    """
    The open print on this printer ended (`how` is finished, failed or cancelled). Fills in what is known now. Returns the entry,
    or None when no print was open (it started before Deja Vu1 was watching: one is made from what the end says).
    """
    if how not in ENDED:
        raise ValueError("A print ends as finished, failed or cancelled")
    job = job or {}
    with _lock:
        data = _load()
        entry = next((e for e in reversed(data["prints"]) if e.get("printer") == printer_id and e.get("status") == "running"), None)
        if entry is None:
            entry = {"id": uuid.uuid4().hex[:12], "printer": printer_id, "printer_name": state.get("printer_name"),
                     "file": job.get("filename") or state.get("current_file") or "(unknown file)", "demo": bool(demo),
                     "started_at": job.get("start_time"), "estimated_hours": None, "grams_in_file": None,
                     "material": job.get("filament_type"), "heads": [], "picture": None, "note": "",
                     "joined_late": True}
            data["prints"].append(entry)
        real = _num(job.get("print_duration_hours"))
        if real is None and _num(state.get("print_duration_hours")) is not None:
            real = _num(state.get("print_duration_hours"))
        if real is None and entry.get("started_at"):
            try:
                real = round((datetime.now() - datetime.fromisoformat(entry["started_at"])).total_seconds() / 3600.0, 4)
            except ValueError:
                real = None
        grams = _num(job.get("filament_used_grams"))
        entry.update(status=how, ended_at=_now(), real_hours=real, grams=grams,
                     grams_estimated=bool(job.get("filament_grams_estimated")),
                     material=entry.get("material") or job.get("filament_type"),
                     cost=(cost or {}).get("total_cost") if isinstance(cost, dict) else None,
                     timelapse=timelapse_session or entry.get("timelapse"))
        if state.get("state_message") and how != "finished":
            entry["ended_because"] = str(state["state_message"])[:300]
        layer = _layer(state)
        if layer:
            entry["layer"] = layer
        _save(data)
        return dict(entry)


def _layer(state):
    """The layer the print reached, {"current", "total"}, when the printer reports it."""
    layer = (state or {}).get("layer") or {}
    try:
        current = int(layer.get("current") or 0)
        total = int(layer.get("total") or 0)
    except (TypeError, ValueError):
        return None
    if current <= 0:
        return None
    return {"current": current, "total": total if total >= current else None}


def set_identity(entry_id, fingerprint, sliced_from=None, model_fingerprint=None):
    """What recall.py worked out about the print's file in the background: its fingerprint and the model it came from."""
    with _lock:
        data = _load()
        for e in data["prints"]:
            if e.get("id") == entry_id:
                if fingerprint:
                    e["fingerprint"] = fingerprint
                if sliced_from:
                    e["sliced_from"] = sliced_from
                if model_fingerprint:
                    e["model_fingerprint"] = model_fingerprint
                _save(data)
                return


WATCH_NOTES_KEPT = 5


def add_watch_note(printer_id, why, verdict, layer=None):
    """The AI watch worried about the running print, or saw it fail: keep its words on the entry (the last few)."""
    if not why:
        return
    with _lock:
        data = _load()
        entry = next((e for e in reversed(data["prints"]) if e.get("printer") == printer_id and e.get("status") == "running"), None)
        if entry is None:
            return
        notes = entry.setdefault("watch", [])
        notes.append({"at": _now(), "verdict": str(verdict or "")[:20], "why": str(why)[:300],
                      "layer": _layer({"layer": layer}) if isinstance(layer, dict) else None})
        del notes[:-WATCH_NOTES_KEPT]
        _save(data)


def set_timelapse(entry_id, session):
    with _lock:
        data = _load()
        for e in data["prints"]:
            if e.get("id") == entry_id:
                e["timelapse"] = session
                _save(data)
                return


def running_entry(printer_id):
    with _lock:
        return next((dict(e) for e in reversed(_load()["prints"]) if e.get("printer") == printer_id and e.get("status") == "running"), None)


def keep_picture(entry_id, data, content_type):
    """The camera picture from the end of a print. A JPEG from a real camera, or the demo's drawn SVG."""
    kind = "svg" if "svg" in (content_type or "") else "jpg" if "jpeg" in (content_type or "") else None
    if not kind or not data:
        return False
    os.makedirs(_PICTURES, exist_ok=True)
    with open(_picture_path(entry_id, kind), "wb") as fh:
        fh.write(data)
    with _lock:
        record = _load()
        for e in record["prints"]:
            if e.get("id") == entry_id:
                e["picture"] = kind
                _save(record)
                return True
    return False


def picture(entry_id):
    with _lock:
        entry = next((e for e in _load()["prints"] if e.get("id") == entry_id), None)
    if not entry or not entry.get("picture"):
        raise ValueError("This print has no picture")
    path = _picture_path(entry_id, entry["picture"])
    if not os.path.isfile(path):
        raise ValueError("This print's picture is no longer kept")
    with open(path, "rb") as fh:
        return fh.read(), "image/svg+xml" if entry["picture"] == "svg" else "image/jpeg"


def set_note(entry_id, note):
    note = str(note or "").strip()[:NOTE_LIMIT]
    with _lock:
        data = _load()
        for e in data["prints"]:
            if e.get("id") == entry_id:
                e["note"] = note
                _save(data)
                return dict(e)
    raise ValueError("No such print in the record")


def forget(entry_id):
    with _lock:
        data = _load()
        before = len(data["prints"])
        data["prints"] = [e for e in data["prints"] if e.get("id") != entry_id]
        if len(data["prints"]) == before:
            raise ValueError("No such print in the record")
        _save(data)
    for kind in ("jpg", "svg"):
        try:
            os.remove(_picture_path(entry_id, kind))
        except OSError:
            pass
    return {"forgotten": entry_id}


def settings():
    with _lock:
        return dict(_load()["settings"])


def set_settings(keep_days):
    try:
        keep_days = int(keep_days)
    except (TypeError, ValueError):
        raise ValueError("Choose how long to keep the record")
    if keep_days not in KEEP_CHOICES:
        raise ValueError("Keep the record for 30 days, 90 days, a year or always")
    with _lock:
        data = _load()
        data["settings"]["keep_days"] = keep_days
        removed = _prune(data)
        _save(data)
    return {**data["settings"], "removed": removed}


def _prune(data):
    """Drop entries older than the chosen time (running prints always stay) and keep at most MAX_ENTRIES. Returns how many went."""
    keep_days = data["settings"].get("keep_days", DEFAULT_KEEP_DAYS)
    before = list(data["prints"])
    if keep_days:
        cut = (datetime.now() - timedelta(days=keep_days)).isoformat(timespec="seconds")
        data["prints"] = [e for e in data["prints"] if e.get("status") == "running" or (e.get("ended_at") or e.get("started_at") or "") >= cut]
    data["prints"] = data["prints"][-MAX_ENTRIES:]
    kept = {e.get("id") for e in data["prints"]}
    gone = [e for e in before if e.get("id") not in kept]
    for e in gone:
        if e.get("picture"):
            try:
                os.remove(_picture_path(e["id"], e["picture"]))
            except (OSError, ValueError):
                pass
    return len(gone)


def _from_printer(job, printer_id, printer_name, demo):
    """One of the printer's own history entries, in the record's shape."""
    status = {"completed": "finished", "cancelled": "cancelled", "error": "failed", "klippy_shutdown": "failed",
              "klippy_disconnect": "failed", "server_exit": "failed", "interrupted": "failed"}.get(job.get("status"), "unknown")
    return {"id": "printer-" + re.sub(r"[^A-Za-z0-9_-]", "", str(job.get("job_id") or ""))[:40], "printer": printer_id,
            "printer_name": printer_name, "file": job.get("filename") or "(unknown file)", "status": status, "demo": bool(demo),
            "started_at": job.get("start_time"), "ended_at": job.get("end_time"), "estimated_hours": None,
            "real_hours": _num(job.get("print_duration_hours")), "grams": _num(job.get("filament_used_grams")),
            "grams_estimated": bool(job.get("filament_grams_estimated")), "material": job.get("filament_type"),
            "heads": [{"toolhead": t, "colour": job.get("filament_color_hex") if len(job.get("toolheads_used") or []) == 1 else None,
                       "colour_name": None, "material": job.get("filament_type"), "grams_in_file": None, "spool": None}
                      for t in job.get("toolheads_used") or []],
            "cost": None, "timelapse": None, "picture": None, "note": "", "from_printer": True}


def _stamp(text):
    try:
        return datetime.fromisoformat(str(text).replace("Z", "+00:00")).replace(tzinfo=None).timestamp()
    except (TypeError, ValueError):
        return None


def listing(demo=False, query=None, printer_history=None, printer_id=None, printer_name=None, status=None):
    """
    Newest first. Our own entries (real ones outside demo mode, demo ones in it), and the printer's own history entries that are
    not already one of ours. `query` matches words in the file, printer, material, status and note.
    """
    with _lock:
        data = _load()
        own = [dict(e) for e in data["prints"] if bool(e.get("demo")) == bool(demo)]
        keep_days = data["settings"].get("keep_days", DEFAULT_KEEP_DAYS)
    rows = list(own)
    cut = time.time() - keep_days * 86400 if keep_days else None
    for job in printer_history or []:
        if not isinstance(job, dict):
            continue
        end = _stamp(job.get("end_time"))
        if cut and end and end < cut:
            continue
        same = any(e.get("file") == job.get("filename") and end and _stamp(e.get("ended_at")) is not None
                   and abs(_stamp(e.get("ended_at")) - end) < SAME_PRINT_SECONDS for e in own)
        if not same:
            rows.append(_from_printer(job, printer_id, printer_name, demo))
    if status:
        rows = [e for e in rows if e.get("status") == status]
    if query:
        words = str(query).lower().split()

        def text(e):
            return " ".join(str(e.get(k) or "") for k in ("file", "printer_name", "material", "status", "note")).lower()
        rows = [e for e in rows if all(w in text(e) for w in words)]
    rows.sort(key=lambda e: _stamp(e.get("started_at") or e.get("ended_at")) or 0, reverse=True)
    return {"prints": _with_files(rows), "settings": {"keep_days": keep_days}, "keep_choices": list(KEEP_CHOICES)}


def seen_printing(printer_id, printer_name, state, job, demo):
    """
    A print already running when Deja Vu1 started watching has no entry yet (its start was never seen): this row shows it
    under Now until it ends, when ended() records it. Nothing is written. None when the printer isn't printing.
    """
    if (state or {}).get("state") not in ("printing", "paused"):
        return None
    row = {"id": "now-" + str(printer_id), "printer": printer_id, "printer_name": printer_name,
           "file": state.get("current_file") or (job or {}).get("filename") or "(unknown file)", "status": "running",
           "demo": bool(demo), "started_at": None, "ended_at": None, "estimated_hours": _num((job or {}).get("total_hours")),
           "real_hours": None, "grams": None, "grams_in_file": _num((job or {}).get("filament_grams")),
           "material": (job or {}).get("material"), "heads": _heads(state, job, printer_id), "cost": None,
           "timelapse": None, "picture": None, "note": "", "joined_late": True, "from_printer": True}
    return _with_files([row])[0]


_SLICED_FROM = re.compile(r'^Sliced from (.+?) with "')


def _with_files(rows):
    """Say whether each print's file is still in Files (Reprint) and which model it was sliced from (Open in Slicer)."""
    try:
        files = file_library.origins()
    except Exception:
        files = {}
    out = []
    for e in rows:
        entry = files.get(e.get("file") or "")
        found = _SLICED_FROM.match((entry or {}).get("note") or "")
        model = found.group(1) if found and found.group(1) in files else None
        if model is None and e.get("sliced_from") in files:
            model = e["sliced_from"]
        out.append({**e, "in_library": entry is not None, "model": model})
    return out


def get(entry_id, demo=False, printer_history=None, printer_id=None, printer_name=None):
    for e in listing(demo, printer_history=printer_history, printer_id=printer_id, printer_name=printer_name)["prints"]:
        if e.get("id") == entry_id:
            return e
    raise ValueError("No such print in the record")


def reset():
    with _lock:
        _save(_blank())
    if os.path.isdir(_PICTURES):
        for name in os.listdir(_PICTURES):
            try:
                os.remove(os.path.join(_PICTURES, name))
            except OSError:
                pass
