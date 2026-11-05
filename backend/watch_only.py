"""
watch_only.py
=============

Watch-only mode: Deja Vu1 reads your printers and sends them nothing that
moves, heats, prints, uploads or changes a setting. It is for trying Deja
Vu1 on a real U1 knowing nothing will happen to the printer.

It is enforced where commands leave the program, not on the page:
moonraker_client refuses every write to a real printer while it is on (its
HTTP requests and its WebSocket calls), so no screen, automation rule or
queue can get round it. What still goes out:

  reading          status, files, history, temperatures, the camera list
  the camera       starting the printer's camera stream and WebRTC signalling
  emergency stop   it only ever stops the printer, so it is never refused

Simulated printers are not affected: they never send anything anyway.

Settings -> Watch-only mode switches it. DEJAVU_WATCH_ONLY=1 keeps it on for
that start whatever the switch says, so a test can begin watch-only.
"""

import os
import threading
from datetime import datetime

import storage
from moonraker_client import PrinterRefused

_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, "watch_only.json")
_lock = threading.Lock()

# The only requests other than GET that may reach a printer while watch-only is on.
READ_POSTS = {
    "/printer/objects/query",        # a status read that Moonraker takes as a POST
    "/printer/emergency_stop",       # stopping is always allowed
    "/access/login",                 # signing in to read the printer's API key
    "/access/refresh_jwt",
}
# WebSocket methods that only read (or stop).
READ_CALLS = {
    "server.connection.identify", "server.info", "machine.system_info",
    "printer.objects.list", "printer.objects.query", "printer.objects.subscribe",
    "printer.emergency_stop",
}
MESSAGE = ("Watch-only mode is on, so Deja Vu1 sends nothing to your printers that moves, heats, "
           "prints or changes a setting. Turn it off in Settings, Watch-only mode")


class WatchOnly(PrinterRefused):
    """A command refused because watch-only mode is on. Never a printer failure."""


def _forced():
    return os.environ.get("DEJAVU_WATCH_ONLY", "").strip().lower() in ("1", "true", "yes", "on")


def _saved():
    data = storage.load_json(_PATH, None)
    return data if isinstance(data, dict) else {}


def is_on():
    return _forced() or bool(_saved().get("on"))


def status():
    saved = _saved()
    return {"on": is_on(), "forced": _forced(), "since": saved.get("since") if saved.get("on") else None,
            "allowed": ["reading", "camera", "emergency stop"]}


def set_on(on):
    """Switch it. Refused while DEJAVU_WATCH_ONLY keeps it on for this start."""
    on = bool(on)
    if not on and _forced():
        raise ValueError("Watch-only mode was switched on when Deja Vu1 started (DEJAVU_WATCH_ONLY), "
                         "so it stays on until Deja Vu1 starts without it")
    with _lock:
        storage.save_json(_PATH, {"on": on, "since": datetime.now().isoformat(timespec="seconds") if on else None})
    return status()


def check_request(method, path):
    """Raise WatchOnly for an HTTP write to a printer while the mode is on."""
    if method.upper() in ("GET", "HEAD", "OPTIONS"):
        return
    if path.split("?")[0] in READ_POSTS:
        return
    if is_on():
        raise WatchOnly(MESSAGE)


def check_call(method):
    """Raise WatchOnly for a WebSocket call that is not a read while the mode is on."""
    if method in READ_CALLS:
        return
    if is_on():
        raise WatchOnly(MESSAGE)


def reset():
    """Off, for tests."""
    with _lock:
        storage.save_json(_PATH, {"on": False, "since": None})
