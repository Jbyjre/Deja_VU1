"""
memory.py
=========

Safety copies of everything the dashboard remembers, kept on this computer.

The dashboard's memory is its small JSON files: printers added, spools,
maintenance done, the logbook, rules, queues, profiles, preferences. Losing
them (a disk fault, a bad edit, an update gone wrong, a mistaken click)
means setting everything up again, so this module keeps safety copies:

  - automatically every 6 hours while the dashboard runs, at start-up if the
    newest copy is older than that, and before every app update;
  - on request ("Make a safety copy now" in Settings).

The newest 12 are kept, in <data>/snapshots/ (left out of full backups,
which already hold the same files). A copy holds every JSON record as it
is on disk, connection keys included, because it never leaves this
computer; the library's model files and camera frames are not copied (the
full backup in backup.py covers those).

Restoring writes the chosen copy's files back after taking one more copy of
how things are now ("before-restore"), so a restore can itself be undone.
The dashboard then restarts so every module reads the restored files.
storage.load_json also asks recover() for a damaged file's newest good
version, so one bad file is repaired without anyone having to ask.
"""

import hashlib
import io
import json
import os
import re
import threading
import time
import zipfile
from datetime import datetime

import storage

_DATA_DIR = storage.DATA_DIR
SNAP_DIR = os.path.join(_DATA_DIR, "snapshots")
KEEP = 12
EVERY = 6 * 3600
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 48 * 1024 * 1024
# Folders that are not memory: staging and restore areas, the copies
# themselves, and bulky content the full backup covers.
_SKIP_DIRS = {"snapshots", "restore-staging", "restored", "updates", "update-staging"}
_NAME = re.compile(r"safety-(\d{8}-\d{6})-([a-z-]{1,24})\.zip")
_lock = threading.Lock()


def _records():
    """Every JSON record under the data folder: [(relative name, path)]."""
    out = []
    if not os.path.isdir(_DATA_DIR):
        return out
    for folder, dirs, names in os.walk(_DATA_DIR, followlinks=False):
        rel_folder = os.path.relpath(folder, _DATA_DIR)
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in _SKIP_DIRS
                   and not os.path.islink(os.path.join(folder, d))]
        for name in sorted(names):
            path = os.path.join(folder, name)
            if not name.endswith(".json") or name.startswith(".") or os.path.islink(path):
                continue
            rel = name if rel_folder == "." else f"{rel_folder}/{name}".replace(os.sep, "/")
            out.append((rel, path))
    return sorted(out)


def _safe(rel):
    parts = rel.split("/")
    return (bool(rel) and "\\" not in rel and ":" not in rel and not rel.startswith("/")
            and all(p not in ("", ".", "..") for p in parts) and parts[0] not in _SKIP_DIRS
            and rel.endswith(".json"))


def snapshot(reason="manual"):
    """Write one safety copy. Returns its summary."""
    reason = re.sub(r"[^a-z-]", "", str(reason or "manual").lower())[:24] or "manual"
    with _lock:
        os.makedirs(SNAP_DIR, exist_ok=True)
        entries, total, buffer = [], 0, io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for rel, path in _records():
                try:
                    size = os.path.getsize(path)
                    if size > MAX_FILE_BYTES or total + size > MAX_TOTAL_BYTES:
                        continue
                    with open(path, "rb") as fh:
                        data = fh.read()
                    json.loads(data.decode("utf-8"))           # only good records go in
                except (OSError, ValueError, UnicodeDecodeError):
                    continue
                total += len(data)
                archive.writestr(rel, data)
                entries.append({"name": rel, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            manifest = {"format": "dejavu1-safety-copy", "version": 1, "reason": reason,
                        "created_at": datetime.now().isoformat(timespec="seconds"), "entries": entries}
            archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        name = f"safety-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{reason}.zip"
        while os.path.exists(os.path.join(SNAP_DIR, name)):       # two in the same second: wait for the next
            time.sleep(0.25)
            name = f"safety-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{reason}.zip"
        tmp = os.path.join(SNAP_DIR, f".tmp-{name}")
        with open(tmp, "wb") as fh:
            fh.write(buffer.getvalue())
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, os.path.join(SNAP_DIR, name))
        _prune()
    return {"id": name, "reason": reason, "created_at": manifest["created_at"], "files": len(entries), "bytes": total}


def automatic_snapshot(reason="automatic"):
    return snapshot(reason)


def _list_names():
    try:
        return sorted((n for n in os.listdir(SNAP_DIR) if _NAME.fullmatch(n)), reverse=True)
    except OSError:
        return []


def _prune():
    for old in _list_names()[KEEP:]:
        try:
            os.remove(os.path.join(SNAP_DIR, old))
        except OSError:
            pass


def _open(snapshot_id):
    if not isinstance(snapshot_id, str) or not _NAME.fullmatch(snapshot_id) or snapshot_id not in _list_names():
        raise ValueError("Choose one of the safety copies listed")
    return zipfile.ZipFile(os.path.join(SNAP_DIR, snapshot_id))


def _manifest(archive):
    data = json.loads(archive.read("manifest.json").decode("utf-8"))
    if data.get("format") != "dejavu1-safety-copy":
        raise ValueError("That file is not a Deja Vu1 safety copy")
    return data


def list_copies():
    out = []
    for name in _list_names():
        try:
            with zipfile.ZipFile(os.path.join(SNAP_DIR, name)) as archive:
                m = _manifest(archive)
            out.append({"id": name, "reason": m.get("reason", ""), "created_at": m.get("created_at", ""),
                        "files": len(m.get("entries", [])), "bytes": sum(e.get("bytes", 0) for e in m.get("entries", []))})
        except (OSError, ValueError, KeyError, zipfile.BadZipFile):
            continue
    return out


def status():
    copies = list_copies()
    newest = copies[0]["created_at"] if copies else None
    return {"copies": copies, "newest": newest, "keep": KEEP, "every_hours": EVERY // 3600,
            "records": len(_records()), "repairs": storage.repairs(),
            "where": "Kept on this computer, in the data folder's snapshots folder. Never uploaded."}


def due(now=None):
    names = _list_names()
    if not names:
        return True
    try:
        made = time.mktime(time.strptime(_NAME.fullmatch(names[0]).group(1), "%Y%m%d-%H%M%S"))
    except (ValueError, AttributeError):
        return True
    return (now or time.time()) - made >= EVERY


def recover(path):
    """
    The newest safety copy's version of one record, for storage.load_json:
    (data, "the safety copy of <time>") or (None, None).
    """
    try:
        rel = os.path.relpath(os.path.abspath(path), os.path.abspath(_DATA_DIR)).replace(os.sep, "/")
    except ValueError:
        return None, None
    if not _safe(rel):
        return None, None
    for name in _list_names():
        try:
            with zipfile.ZipFile(os.path.join(SNAP_DIR, name)) as archive:
                manifest = _manifest(archive)
                entry = next((e for e in manifest.get("entries", []) if e.get("name") == rel), None)
                if not entry:
                    continue
                data = archive.read(rel)
                if hashlib.sha256(data).hexdigest() != entry.get("sha256"):
                    continue
                return json.loads(data.decode("utf-8")), f"the safety copy of {manifest.get('created_at', '')}"
        except (OSError, ValueError, KeyError, zipfile.BadZipFile, UnicodeDecodeError):
            continue
    return None, None


def restore(snapshot_id, only=None):
    """
    Write a safety copy's records back (all of them, or just `only`, one
    file name). Takes a "before-restore" copy first. Every file is checked
    against the copy's own list before any is written.
    """
    with _open(snapshot_id) as archive:
        manifest = _manifest(archive)
        entries = manifest.get("entries", [])
        if only is not None:
            entries = [e for e in entries if e.get("name") == only]
            if not entries:
                raise ValueError("That safety copy doesn't hold that file")
        checked = []
        for e in entries:
            rel = e.get("name")
            if not isinstance(rel, str) or not _safe(rel):
                raise ValueError("The safety copy contains an unsafe file name. Nothing was restored")
            data = archive.read(rel)
            if hashlib.sha256(data).hexdigest() != e.get("sha256"):
                raise ValueError(f"{rel} in the safety copy is damaged. Nothing was restored")
            checked.append((rel, json.loads(data.decode("utf-8"))))
    before = snapshot("before-restore")
    for rel, value in checked:
        storage.save_json(os.path.join(_DATA_DIR, *rel.split("/")), value)
    return {"restored": len(checked), "from": manifest.get("created_at", ""), "undo": before["id"]}


def watch(stop=None, tick=600):
    """For the server's lifetime: a safety copy whenever the newest is 6 hours old."""
    stop = stop or threading.Event()
    while not stop.is_set():
        try:
            if due():
                snapshot("automatic")
        except Exception:
            pass                 # a copy that can't be written is tried again next round
        if stop.wait(tick):
            break
