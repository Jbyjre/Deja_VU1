"""
orca_import.py
==============

Pick up where you are: find the work already in Snapmaker Orca or
OrcaSlicer on this computer and bring it into Deja Vu1, so a U1 owner
doesn't start from nothing.

What is found, and where (checked against the slicers' own source:
SoftFever/OrcaSlicer and Snapmaker/OrcaSlicer, src/slic3r/GUI/GUI_App.cpp,
src/libslic3r/AppConfig.cpp, Preset.hpp, PresetBundle.hpp, version.inc):
  - the data folder is named after the app key, "Snapmaker_Orca" for
    Snapmaker's build and "OrcaSlicer" for the original: %APPDATA%\\<key>
    on Windows, ~/Library/Application Support/<key> on macOS, and
    $XDG_CONFIG_HOME/<key> (normally ~/.config/<key>) on Linux;
  - your own presets are in <data>/user/<account or "default">/ under
    machine/, process/ and filament/, one .json each;
  - your recent projects are listed in <data>/<key>.conf (JSON; Orca may
    add a checksum line after it), in its "recent_projects" section.

Nothing is changed in the slicer's folders. Projects are copied into the
file library; presets are used where they are (a slicing profile points at
them, as when you choose preset files by hand). Paths stay on this
computer: the browser only sees names and an id for each item.
"""

import hashlib
import json
import os
import sys
from pathlib import Path

import file_library

APPS = (("Snapmaker_Orca", "Snapmaker Orca"), ("OrcaSlicer", "OrcaSlicer"))
KINDS = ("machine", "process", "filament")
MAX_PRESETS = 600
MAX_PRESET_BYTES = 4 * 1024 * 1024
MAX_CONF_BYTES = 8 * 1024 * 1024
MAX_PROJECTS = 30
MAX_PROJECT_BYTES = 512 * 1024 * 1024


def data_folders():
    """[(app label, folder)] for every slicer data folder that exists here."""
    override = os.environ.get("DEJAVU_ORCA_DIR")
    if override:
        return [("Orca", Path(override))] if Path(override).is_dir() else []
    home = Path.home()
    bases = []
    if sys.platform.startswith("win"):
        if os.environ.get("APPDATA"):
            bases.append(Path(os.environ["APPDATA"]))
    elif sys.platform == "darwin":
        bases.append(home / "Library" / "Application Support")
    else:
        bases.append(Path(os.environ.get("XDG_CONFIG_HOME") or home / ".config"))
    found = []
    for key, label in APPS:
        for base in bases:
            folder = base / key
            if folder.is_dir():
                found.append((label, folder))
        # Flatpak installs keep their own config folder.
        flatpak = home / ".var" / "app"
        if flatpak.is_dir():
            for app in sorted(flatpak.iterdir())[:50]:
                folder = app / "config" / key
                if folder.is_dir():
                    found.append((label, folder))
    return found


def _id(path):
    return hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:16]


def _presets(folder):
    out = {k: [] for k in KINDS}
    user = folder / "user"
    if not user.is_dir():
        return out
    count = 0
    for account in sorted(p for p in user.iterdir() if p.is_dir() and not p.is_symlink()):
        for kind in KINDS:
            sub = account / kind
            if not sub.is_dir():
                continue
            for path in sorted(sub.glob("*.json")):
                if count >= MAX_PRESETS:
                    return out
                try:
                    if path.is_symlink() or path.stat().st_size > MAX_PRESET_BYTES:
                        continue
                    data = json.loads(path.read_text(encoding="utf-8-sig"))
                except (OSError, ValueError, UnicodeError):
                    continue
                if not isinstance(data, dict):
                    continue
                count += 1
                name = str(data.get("name") or path.stem)[:120]
                inherits = str(data.get("inherits") or "")[:120]
                usable = data.get("type") == kind and data.get("from") in ("system", "User", "user")
                out[kind].append({"id": _id(path), "name": name, "inherits": inherits,
                                  "account": account.name if account.name != "default" else "",
                                  "u1": "u1" in (name + " " + inherits).lower(), "usable": usable,
                                  "_path": str(path)})
    return out


def _conf(folder):
    for key, _ in APPS:
        path = folder / f"{key}.conf"
        if path.is_file():
            try:
                if path.stat().st_size > MAX_CONF_BYTES:
                    return {}
                text = path.read_text(encoding="utf-8-sig", errors="replace")
            except OSError:
                return {}
            # Orca may append a "# MD5 checksum" line after the JSON.
            end = text.rfind("}")
            try:
                data = json.loads(text[:end + 1]) if end >= 0 else {}
            except ValueError:
                return {}
            return data if isinstance(data, dict) else {}
    return {}


def _projects(folder):
    recent = _conf(folder).get("recent_projects")
    paths = list(recent.values()) if isinstance(recent, dict) else recent if isinstance(recent, list) else []
    out = []
    for value in paths:
        if len(out) >= MAX_PROJECTS:
            break
        path = Path(str(value))
        if path.suffix.lower() != ".3mf" or not path.is_file():
            continue
        try:
            st = path.stat()
        except OSError:
            continue
        out.append({"id": _id(path), "name": path.name, "bytes": st.st_size, "modified": int(st.st_mtime),
                    "in_library": file_library.exists(path.name), "_path": str(path)})
    return out


def scan():
    """What can be brought in, per slicer found. Paths are kept back (see public)."""
    apps = []
    for label, folder in data_folders():
        apps.append({"app": label, "presets": _presets(folder), "projects": _projects(folder)})
    return apps


def public(apps=None):
    """scan() without the file paths, for the browser."""
    apps = scan() if apps is None else apps
    clean = []
    for a in apps:
        clean.append({"app": a["app"],
                      "presets": {k: [{x: v for x, v in p.items() if x != "_path"} for p in a["presets"][k]] for k in KINDS},
                      "projects": [{x: v for x, v in p.items() if x != "_path"} for p in a["projects"]]})
    return {"apps": clean, "found": bool(clean),
            "looked_in": "Snapmaker Orca and OrcaSlicer's own settings folders on this computer",
            "note": "Nothing in the slicer's folders is changed. Projects are copied into Files; presets are used where they are."}


def _lookup(ids, pick):
    wanted = set(ids or [])
    found = {}
    for a in scan():
        for item in pick(a):
            if item["id"] in wanted:
                found[item["id"]] = item
    return found


def import_projects(ids):
    """Copy chosen recent projects into the file library."""
    if not isinstance(ids, list) or not ids or len(ids) > MAX_PROJECTS:
        raise ValueError("Choose the projects to bring in")
    found = _lookup(ids, lambda a: a["projects"])
    added, skipped = [], []
    for i in ids:
        item = found.get(i)
        if not item:
            skipped.append({"id": i, "why": "no longer in the slicer's recent list"})
            continue
        path = Path(item["_path"])
        if path.stat().st_size > MAX_PROJECT_BYTES:
            skipped.append({"name": item["name"], "why": "larger than 512 MB"})
            continue
        entry = file_library.save(item["name"], path.read_bytes(), origin="upload",
                                  note="Brought in from your slicer's recent projects")
        added.append(entry.get("name", item["name"]) if isinstance(entry, dict) else item["name"])
    return {"added": added, "skipped": skipped}


def import_profile(body):
    """A Deja Vu1 slicing profile that uses your own Orca presets, where they are."""
    import slicer_bridge
    name = str(body.get("name") or "").strip()[:60]
    machine, process = body.get("machine"), body.get("process")
    filaments = body.get("filaments") or []
    if not isinstance(filaments, list):
        raise ValueError("Choose up to four filament presets")
    found = _lookup([machine, process] + list(filaments),
                    lambda a: [p for k in KINDS for p in a["presets"][k]])
    for need, what in ((machine, "printer (machine)"), (process, "process")):
        if need not in found:
            raise ValueError(f"Choose a {what} preset from the list")
    paths = [found[f]["_path"] for f in filaments if f in found]
    if not paths:
        raise ValueError("Choose at least one filament preset from the list")
    return slicer_bridge.add_profile(name or found[process]["name"], found[machine]["_path"],
                                     found[process]["_path"], paths)
