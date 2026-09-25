"""
file_library.py
===============

The dashboard's own shelf of print files: G-code ready to print, and STL /
3MF models to look at or convert. Files live in backend/data/files/ on the
machine running the dashboard. When a print is started, the chosen file is
uploaded to the printer the same way Moonraker's own upload works, so the
library is also where "start print from phone" gets its files from.

What it keeps per file: when it was added, opened and last printed (for the
"recent" list), where it came from (upload, sample, converted, edited), and
a cached analysis so the list stays fast - thumbnails, estimated time and
grams, and the pre-flight verdict are worked out once per version of the
file, not on every page load.

This is the dashboard's own storage, like the filament list, so it answers
whether or not a printer is connected. It never contains printer readings.
"""

import base64
import os
import re
import threading
from datetime import datetime

import gcode_tools
import mesh_tools
import sample_files
import storage

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
FILES_DIR = os.path.join(_DATA_DIR, "files")
_INDEX_PATH = os.path.join(_DATA_DIR, "file_index.json")
_THUMB_DIR = os.path.join(_DATA_DIR, "thumbs")

ALLOWED_EXTENSIONS = (".gcode", ".gco", ".g", ".3mf", ".stl")
MAX_BYTES = 64 * 1024 * 1024
_lock = threading.RLock()


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _load_index():
    if not os.path.exists(_INDEX_PATH):
        return {}
    return storage.load_json(_INDEX_PATH, {})


def _save_index(index):
    storage.save_json(_INDEX_PATH, index)


def kind_of(name):
    lower = name.lower()
    if lower.endswith((".gcode", ".gco", ".g")):
        return "gcode"
    if lower.endswith(".3mf"):
        return "3mf"
    if lower.endswith(".stl"):
        return "stl"
    return None


def clean_name(name):
    """
    A safe file name: no folders, no hidden files, only ordinary
    characters, and an extension this library understands.
    """
    name = os.path.basename(str(name or "").replace("\\", "/")).strip()
    name = re.sub(r"[^A-Za-z0-9._ ()+-]", "_", name)
    if not name or name.startswith("."):
        raise ValueError("That file name isn't allowed")
    if len(name) > 120:
        raise ValueError("File name is too long (120 characters at most)")
    if not name.lower().endswith(ALLOWED_EXTENSIONS):
        raise ValueError("Only .gcode, .3mf and .stl files can be added")
    return name


def _path(name):
    return os.path.join(FILES_DIR, clean_name(name))


def exists(name):
    try:
        return os.path.isfile(_path(name))
    except ValueError:
        return False


def read_bytes(name):
    path = _path(name)
    if not os.path.isfile(path):
        raise ValueError(f"No file called {name} in the library")
    with open(path, "rb") as fh:
        return fh.read()


def read_text(name):
    if kind_of(name) != "gcode":
        raise ValueError("Only G-code files can be opened as text")
    return read_bytes(name).decode("utf-8", errors="replace")


def save(name, data, origin="upload", note=None):
    """Add or replace a file. Returns its library entry."""
    name = clean_name(name)
    if not data:
        raise ValueError("The file is empty")
    if len(data) > MAX_BYTES:
        raise ValueError("Files over 64 MB can't be added")
    with _lock:
        os.makedirs(FILES_DIR, exist_ok=True)
        with open(os.path.join(FILES_DIR, name), "wb") as fh:
            fh.write(data)
        index = _load_index()
        entry = index.get(name, {"added_at": _now()})
        entry.update({"origin": origin, "size": len(data), "summary": None,
                      "modified_at": _now()})
        if note:
            entry["note"] = note
        index[name] = entry
        _save_index(index)
    return describe(name)


def delete(name):
    name = clean_name(name)
    with _lock:
        for path in (os.path.join(FILES_DIR, name), os.path.join(FILES_DIR, name + ".orig"),
                     os.path.join(_THUMB_DIR, name + ".png")):
            if os.path.exists(path):
                os.remove(path)
        index = _load_index()
        index.pop(name, None)
        _save_index(index)
    return list_files()


def touch(name, field):
    """Record that a file was opened or printed, for the recent list."""
    name = clean_name(name)
    with _lock:
        index = _load_index()
        if name in index:
            index[name][field] = _now()
            _save_index(index)


# ---------------------------------------------------------------------------
# Analysis and thumbnails, cached per file version
# ---------------------------------------------------------------------------

def analysis(name):
    """Full G-code analysis (with toolpath) - not cached, it's large."""
    return gcode_tools.analyze(read_text(name))


def _summarize(name):
    kind = kind_of(name)
    data = read_bytes(name)
    summary = {"kind": kind}
    thumb = None
    try:
        if kind == "gcode":
            text = data.decode("utf-8", errors="replace")
            result = gcode_tools.analyze(text, want_toolpath=False)
            summary.update({
                "estimated_hours": result["estimated_hours"],
                "filament_grams": result["filament_grams"],
                "layers": result["layers"],
                "tools_used": result["tools_used"],
                "footprint_mm": result["footprint_mm"],
                "preflight": result["preflight"]["verdict"],
                "materials": result["meta"].get("filament_types"),
                "colours": result["meta"].get("filament_colours"),
            })
            uri = gcode_tools.extract_thumbnail(text)
            if uri:
                thumb = base64.b64decode(uri.split(",", 1)[1])
        else:
            triangles, info = mesh_tools.parse_model(data, name)
            b = mesh_tools.bounds(triangles)
            summary.update({"triangles": len(triangles), "size_mm": b["size"] if b else None,
                            "application": info.get("application")})
            if kind == "3mf":
                import zipfile, io
                z = zipfile.ZipFile(io.BytesIO(data))
                for part in ("Metadata/plate_1.png", "Metadata/thumbnail.png"):
                    if part in z.namelist():
                        thumb = z.read(part)
                        break
            if thumb is None:
                thumb = mesh_tools.png_thumbnail(triangles)
    except (ValueError, KeyError, OSError) as exc:
        summary["error"] = str(exc)
    if thumb:
        os.makedirs(_THUMB_DIR, exist_ok=True)
        with open(os.path.join(_THUMB_DIR, name + ".png"), "wb") as fh:
            fh.write(thumb)
    summary["has_thumbnail"] = bool(thumb)
    return summary


def describe(name):
    name = clean_name(name)
    with _lock:
        index = _load_index()
        entry = index.get(name)
        if entry is None:
            raise ValueError(f"No file called {name} in the library")
        if not entry.get("summary"):
            entry["summary"] = _summarize(name)
            index[name] = entry
            _save_index(index)
    return {"name": name, "kind": kind_of(name),
            "has_original": os.path.exists(os.path.join(FILES_DIR, name + ".orig")), **entry}


def thumbnail(name):
    describe(name)          # makes sure it has been generated
    path = os.path.join(_THUMB_DIR, clean_name(name) + ".png")
    if not os.path.exists(path):
        return None
    with open(path, "rb") as fh:
        return fh.read()


def list_files():
    with _lock:
        index = _load_index()
        # Drop entries whose file was removed outside the dashboard.
        missing = [n for n in index if not os.path.isfile(os.path.join(FILES_DIR, n))]
        for n in missing:
            index.pop(n)
        if missing:
            _save_index(index)
        names = list(index)
    files = [describe(n) for n in names]
    files.sort(key=lambda f: f.get("added_at", ""), reverse=True)
    recent = sorted((f for f in files if f.get("last_opened") or f.get("last_printed")),
                    key=lambda f: max(f.get("last_opened") or "", f.get("last_printed") or ""),
                    reverse=True)[:5]
    return {"files": files, "recent": [f["name"] for f in recent]}


# ---------------------------------------------------------------------------
# Edits (G-code only) - the original is kept the first time
# ---------------------------------------------------------------------------

def save_edit(name, edits):
    """Apply a list of small edits, re-check the file, and save it."""
    if not isinstance(edits, list) or not edits:
        raise ValueError("No edits to apply")
    if len(edits) > 20:
        raise ValueError("Apply at most 20 edits at a time")
    text = read_text(name)
    for edit in edits:
        text = gcode_tools.apply_edit(text, edit)
    name = clean_name(name)
    original = os.path.join(FILES_DIR, name + ".orig")
    with _lock:
        if not os.path.exists(original):
            with open(original, "wb") as fh:
                fh.write(read_bytes(name))
    entry = save(name, text.encode("utf-8"), origin="edited")
    return {"file": entry, "preflight": gcode_tools.preflight(text)}


def restore_original(name):
    name = clean_name(name)
    original = os.path.join(FILES_DIR, name + ".orig")
    if not os.path.exists(original):
        raise ValueError("There is no saved original for this file")
    with open(original, "rb") as fh:
        data = fh.read()
    os.remove(original)
    return save(name, data, origin="restored")


def add_samples():
    added = []
    for sample in sample_files.SAMPLES:
        if not exists(sample):
            save(sample, sample_files.build(sample), origin="sample")
            added.append(sample)
    return {"added": added, **list_files()}


def reset():
    """Empty the library. Useful for tests."""
    with _lock:
        for folder in (FILES_DIR, _THUMB_DIR):
            if os.path.isdir(folder):
                for n in os.listdir(folder):
                    os.remove(os.path.join(folder, n))
        _save_index({})
