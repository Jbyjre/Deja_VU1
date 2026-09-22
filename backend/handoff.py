"""
handoff.py
==========

"Continue on your phone." Every open dashboard tells the server, now and
then, what it is looking at: which printer, which tab, which file. When
you open the dashboard on another device, it can offer to pick up exactly
there - the way a phone offers to continue what the laptop was doing.

Paired devices already read the same server state (pairing.py), so there
is no syncing to do; this module only remembers the last few "I'm looking
at..." notes, for a short while, in memory. Nothing is written to disk and
nothing leaves the local network.
"""

import threading
import time

FRESH_SECONDS = 15 * 60
_lock = threading.Lock()
_views = {}          # device_id -> view


def report(device_id, device_name, view):
    device_id = str(device_id or "")[:64]
    if not device_id:
        raise ValueError("device_id is required")
    clean = {
        "device_id": device_id,
        "device_name": str(device_name or "Another device")[:40],
        "printer": str(view.get("printer") or "")[:40] or None,
        "tab": str(view.get("tab") or "")[:30] or None,
        "file": str(view.get("file") or "")[:120] or None,
        "at": time.time(),
    }
    with _lock:
        _views[device_id] = clean
        for key in [k for k, v in _views.items() if time.time() - v["at"] > FRESH_SECONDS]:
            _views.pop(key)
    return clean


def offer_for(device_id):
    """The most recent view from any *other* device, if it is recent."""
    now = time.time()
    with _lock:
        others = [v for k, v in _views.items() if k != device_id and now - v["at"] <= FRESH_SECONDS]
    if not others:
        return {"offer": None}
    latest = max(others, key=lambda v: v["at"])
    return {"offer": {**latest, "seconds_ago": round(now - latest["at"])}}


def reset():
    with _lock:
        _views.clear()
