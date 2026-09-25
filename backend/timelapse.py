"""
timelapse.py
============

Keeps a still frame from the camera at every few layers of a print, so the
whole print can be played back afterwards as a fast flipbook in the
browser. The frames are kept as the images they arrived as; nothing is
encoded into a video file (that would need a video encoder, which is
outside this project's no-dependencies rule).

Where frames come from:
  a real camera  - camera.py's MJPEG bridge hands over its latest JPEG
  demo printers  - a drawn SVG of the simulated print at that layer,
                   clearly marked "simulated" on the frame itself

Frames live in backend/data/timelapse/<printer>/<session>/, at most
MAX_FRAMES per print and the last KEEP_SESSIONS prints per printer.
"""

import json
import os
import re
import shutil
import threading
from datetime import datetime
import storage

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_ROOT = os.path.join(_DATA_DIR, "timelapse")
MAX_FRAMES = 400
KEEP_SESSIONS = 5
EVERY_N_LAYERS = 2
_lock = threading.RLock()
_active = {}          # printer_id -> {"session": id, "last_layer": n}
_SAFE = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")


def _dir(*parts):
    for p in parts:
        if not _SAFE.match(p):
            raise ValueError("Bad time-lapse name")
    return os.path.join(_ROOT, *parts)


def _meta_path(printer_id, session):
    return os.path.join(_dir(printer_id, session), "session.json")


def begin(printer_id, filename, source):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    session = f"{stamp}-{re.sub(r'[^A-Za-z0-9_-]', '_', filename or 'print')[:40]}"
    with _lock:
        os.makedirs(_dir(printer_id, session), exist_ok=True)
        storage.save_json(_meta_path(printer_id, session),
                          {"session": session, "filename": filename, "source": source,
                           "started_at": datetime.now().isoformat(timespec="seconds"),
                           "frames": 0, "finished": False}, indent=None)
        _active[printer_id] = {"session": session, "last_layer": -99}
        _prune(printer_id)
    return session


def _prune(printer_id):
    sessions = sorted(os.listdir(_dir(printer_id))) if os.path.isdir(_dir(printer_id)) else []
    for old in sessions[:-KEEP_SESSIONS]:
        shutil.rmtree(_dir(printer_id, old), ignore_errors=True)


def maybe_capture(printer_id, layer, frame_bytes, extension):
    """Store a frame if this layer is due for one. Returns True if stored."""
    with _lock:
        info = _active.get(printer_id)
        if not info or layer - info["last_layer"] < EVERY_N_LAYERS:
            return False
        meta_path = _meta_path(printer_id, info["session"])
        meta = storage.load_json(meta_path, None)
        if not isinstance(meta, dict):
            return False
        if meta["frames"] >= MAX_FRAMES:
            return False
        meta["frames"] += 1
        name = f"{meta['frames']:05d}.{extension}"
        with open(os.path.join(_dir(printer_id, info["session"]), name), "wb") as fh:
            fh.write(frame_bytes)
        storage.save_json(meta_path, meta, indent=None)
        info["last_layer"] = layer
        return True


def finish(printer_id):
    with _lock:
        info = _active.pop(printer_id, None)
        if not info:
            return
        path = _meta_path(printer_id, info["session"])
        meta = storage.load_json(path, None)
        if not isinstance(meta, dict):
            return
        meta.update(finished=True, finished_at=datetime.now().isoformat(timespec="seconds"))
        storage.save_json(path, meta, indent=None)


def is_recording(printer_id):
    return printer_id in _active


def sessions(printer_id):
    folder = _dir(printer_id)
    if not os.path.isdir(folder):
        return []
    out = []
    for session in sorted(os.listdir(folder), reverse=True):
        try:
            with open(_meta_path(printer_id, session), "r", encoding="utf-8") as fh:
                out.append(json.load(fh))
        except (OSError, ValueError):
            continue
    return out


def frames(printer_id, session):
    folder = _dir(printer_id, session)
    if not os.path.isdir(folder):
        raise ValueError("No such time-lapse")
    return sorted(n for n in os.listdir(folder) if n != "session.json")


def frame(printer_id, session, name):
    path = os.path.join(_dir(printer_id, session, name))
    if not os.path.isfile(path):
        raise ValueError("No such frame")
    with open(path, "rb") as fh:
        data = fh.read()
    kind = "image/svg+xml" if name.endswith(".svg") else "image/jpeg"
    return data, kind


def simulated_frame(state, job):
    """
    An SVG still of a simulated print: the bed, the part built up to the
    current layer, and the toolhead - drawn from the simulated state, and
    labelled as simulated on the image.
    """
    layer = state.get("layer", {}).get("current", 0)
    total = max(1, state.get("layer", {}).get("total", 1))
    w_mm, d_mm = (job.get("footprint_mm") or [60, 40])[:2]
    frac = min(1.0, layer / total)
    part_w = 40 + min(160, w_mm * 2.2)
    part_h = 8 + 150 * frac
    x0 = 200 - part_w / 2
    colour = "#f26a1b"
    active = state.get("active_toolhead")
    if active and active in state.get("toolheads", {}):
        colour = state["toolheads"][active]["filament_color_hex"]
    head_x = 200 + ((state.get("toolhead_position") or [135, 135, 0])[0] - 135) * 2.2
    head_y = 262 - part_h - 34
    stripes = "".join(
        f'<rect x="{x0:.1f}" y="{262 - (i + 1) * part_h / 6:.1f}" width="{part_w:.1f}" '
        f'height="{part_h / 12:.1f}" fill="#000" opacity="0.06"/>' for i in range(6))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'
        '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#1b2230"/><stop offset="1" stop-color="#0c1018"/></linearGradient></defs>'
        '<rect width="400" height="300" fill="url(#bg)"/>'
        '<rect x="40" y="262" width="320" height="10" rx="2" fill="#3a4454"/>'
        f'<rect x="{x0:.1f}" y="{262 - part_h:.1f}" width="{part_w:.1f}" height="{part_h:.1f}" rx="3" fill="{colour}"/>'
        f'{stripes}'
        f'<rect x="20" y="{head_y - 18:.1f}" width="360" height="6" rx="3" fill="#56627a"/>'
        f'<rect x="{head_x - 16:.1f}" y="{head_y - 26:.1f}" width="32" height="30" rx="5" fill="#d9dee8"/>'
        f'<polygon points="{head_x - 5:.1f},{head_y + 4:.1f} {head_x + 5:.1f},{head_y + 4:.1f} {head_x:.1f},{head_y + 12:.1f}" fill="#d9dee8"/>'
        '<text x="14" y="24" font-family="monospace" font-size="13" fill="#ffb37a">SIMULATED FRAME</text>'
        f'<text x="386" y="24" font-family="monospace" font-size="13" fill="#9aa6bb" text-anchor="end">layer {layer}/{total}</text>'
        '</svg>'
    ).encode("utf-8")


def reset():
    with _lock:
        _active.clear()
        shutil.rmtree(_ROOT, ignore_errors=True)
