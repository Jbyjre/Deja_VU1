"""
idle_stop.py
============

Deja Vu1 stops by itself when nobody is using it, so Python doesn't keep running all day after its last window
closed.

It stops once, for IDLE_MINUTES in a row, no Deja Vu1 page has been open on any device and nothing is under way:
no print on a real printer, no slice, no engine install, no app update, no time-lapse being copied. Then the
server ends the way Settings > Stop ends it (exit code 0), so the launcher that started it ends too, and nothing of
Deja Vu1 is left running. Opening the dashboard's address or the installed app again shows the offline page, whose
Start button starts it (deja-vu1:// link, launch_link.py); the double-click launcher works as before.

It is armed for every copy the launcher started (start.py sets DEJAVU_BACKGROUND=1): the double-click launchers,
the paste blocks, the offline page's Start button. There is no longer a way to keep it running: since 24 November
2026 Deja Vu1 never starts with the computer (autostart.py removes what older versions made). A server run by hand
(python3 backend/app.py, the tests, a developer) never stops by itself. DEJAVU_IDLE_MINUTES sets the wait for one
start; 0 switches the stop off.

While no page is open the live feed also slows from four looks a second to one every two seconds
(live_feed.QUIET_TICK_SECONDS), so a print being recorded with nobody watching costs almost nothing.

A print never depends on it: the printer runs its file by itself. What stops with Deja Vu1 is what Deja Vu1 does
while it watches (time-lapse frames, the print record, filament use), which is why it waits while a print runs.
"""

import os
import threading
import time

IDLE_MINUTES = 5                 # short on purpose: a laptop with 8 GB should not carry an unused server
CHECK_EVERY = 30                 # seconds between looks
PAGE_GRACE = 90                  # a page that polled (no WebSocket) this recently still counts as open

_lock = threading.Lock()
_state = {"last_page": time.monotonic(), "sockets": 0, "since": time.monotonic(), "stopping": False}


def minutes():
    raw = os.environ.get("DEJAVU_IDLE_MINUTES", "")
    try:
        value = float(raw) if raw.strip() else IDLE_MINUTES
    except ValueError:
        value = IDLE_MINUTES
    return max(0.0, value)


def armed():
    """Does this copy stop by itself? Every copy the launcher started; not one run by hand."""
    return os.environ.get("DEJAVU_BACKGROUND") == "1" and minutes() > 0


# ---- what counts as someone using it --------------------------------------------------------------------------

def page_seen():
    """A page asked for something (the launcher's own checks are not counted; see app.py)."""
    with _lock:
        _state["last_page"] = time.monotonic()


def socket_opened():
    with _lock:
        _state["sockets"] += 1
        _state["last_page"] = time.monotonic()


def socket_closed():
    with _lock:
        _state["sockets"] = max(0, _state["sockets"] - 1)
        _state["last_page"] = time.monotonic()


def pages_open(now=None):
    now = time.monotonic() if now is None else now
    with _lock:
        return _state["sockets"] > 0 or now - _state["last_page"] < PAGE_GRACE


# ---- what keeps it running with no page open -------------------------------------------------------------------

def busy():
    """What is under way, in words. Each check stands alone, so one that fails never hides the others."""
    reasons = []

    def check(fn):
        try:
            words = fn()
        except Exception:             # noqa: BLE001 - an unknown answer counts as busy: never stop mid-job
            words = "a job whose state could not be read"
        if words:
            reasons.append(words)

    def printing():
        import live_feed
        import mock_moonraker
        names = []
        for pid in mock_moonraker.printer_ids():
            if not mock_moonraker.is_real(pid):
                continue
            state = (live_feed.snapshot(pid).get("state") or {}).get("state")
            if state in ("printing", "paused"):
                names.append(pid)
        return f"a print on {len(names)} printer{'s' if len(names) != 1 else ''}" if names else ""

    def slicing():
        import slicer_bridge_part1
        return "a slice" if slicer_bridge_part1.any_active() else ""

    def engine():
        import engine_installer
        with engine_installer._lock:
            return "the slicing engine install" if engine_installer._job.get("state") == "running" else ""

    def copies():
        import timelapse
        with timelapse._lock:
            return "a time-lapse being copied" if any(j.get("state") == "running" for j in timelapse._keeps.values()) else ""

    def update():
        import app_updates
        return "an app update" if app_updates.job_running() else ""

    for fn in (printing, slicing, engine, copies, update):
        check(fn)
    return reasons


# ---- the watcher ------------------------------------------------------------------------------------------------

def status(now=None):
    """For Settings > Desktop app: whether it stops by itself, and when."""
    now = time.monotonic() if now is None else now
    on = armed()
    with _lock:
        quiet_for = 0 if _state["sockets"] else max(0.0, now - _state["last_page"])
        since = _state["since"]
    idle_for = max(0.0, now - since)
    return {"armed": on, "minutes": minutes(),
            "started_by_launcher": os.environ.get("DEJAVU_BACKGROUND") == "1",
            "pages_open": pages_open(now), "quiet_seconds": round(quiet_for),
            "stops_in_seconds": round(max(0.0, minutes() * 60 - idle_for)) if on and not pages_open(now) else None,
            "busy": busy() if on else []}


def should_stop(now=None):
    """Called every CHECK_EVERY seconds. Counts the time with no page and nothing under way; True once it is long enough."""
    now = time.monotonic() if now is None else now
    if not armed():
        with _lock:
            _state["since"] = now
        return False
    if pages_open(now) or busy():
        with _lock:
            _state["since"] = now
        return False
    with _lock:
        return now - _state["since"] >= minutes() * 60


def watch(stop_server, log=None, sleep=time.sleep):
    """The background loop: once should_stop() says so, it says why and stops the server."""
    say = log or (lambda m: print(m, flush=True))
    while True:
        sleep(CHECK_EVERY)
        if should_stop():
            with _lock:
                if _state["stopping"]:
                    return
                _state["stopping"] = True
            say(f"  Stopping by itself: no Deja Vu1 page has been open for {minutes():g} minutes and nothing is "
                "under way. Open the dashboard or the installed app to start it again.")
            stop_server()
            return
