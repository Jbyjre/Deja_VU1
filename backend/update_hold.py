"""
update_hold.py
==============

While Deja Vu1 restarts (an update, Restart in Settings, a restored safety copy)
it sends your printers nothing that moves, heats, prints, uploads or changes a
setting. A print already running does not depend on Deja Vu1: the printer
holds the file and runs it by itself, so an update never pauses, stops or
changes it. This module makes the other half true as well: Deja Vu1 itself
never starts a command on the way down or on the way back up.

It works like watch-only mode (watch_only.py) and sits in the same two places,
where commands leave the program (moonraker_client's HTTP requests and its
WebSocket calls), so no screen, automation rule or queue can get round it. Two
differences:

  - it is short: it starts when an install is about to restart the program
    and ends with that process, or by itself after HOLD_SECONDS if the restart
    never happens, so a stuck restart can never leave commands refused;
  - it counts the commands being sent right now, and the install waits for
    those to finish (wait_quiet) before it stops the program, so an upload or a
    G-code line is never cut in half.

What still goes out: reading, and the emergency stop (it only ever stops the
printer). Simulated printers send nothing anyway.
"""

import contextlib
import threading
import time

import watch_only
from moonraker_client import PrinterRefused

HOLD_SECONDS = 90
MESSAGE = ("Deja Vu1 is restarting right now, so it sends your printer nothing for a few seconds. "
           "Anything already printing carries on by itself. Try again in a moment")

_cond = threading.Condition()
_until = 0.0
_reason = ""
_writing = 0


class UpdateHold(PrinterRefused):
    """A command refused while Deja Vu1 restarts. Never a printer failure."""


def begin(reason="restart", seconds=HOLD_SECONDS):
    """Start refusing commands to printers. Ends with this process, or after `seconds`."""
    global _until, _reason
    with _cond:
        _until = time.monotonic() + max(1.0, float(seconds))
        _reason = str(reason or "restart")


def end():
    global _until, _reason
    with _cond:
        _until = 0.0
        _reason = ""
        _cond.notify_all()


def active():
    with _cond:
        return time.monotonic() < _until


def status():
    with _cond:
        left = _until - time.monotonic()
        return {"on": left > 0, "reason": _reason if left > 0 else "",
                "seconds_left": max(0, round(left)), "commands_in_flight": _writing}


def in_flight():
    with _cond:
        return _writing


def wait_quiet(timeout=20.0):
    """Wait until no command to a printer is being sent. True when none is."""
    end_at = time.monotonic() + max(0.0, timeout)
    with _cond:
        while _writing:
            left = end_at - time.monotonic()
            if left <= 0:
                return False
            _cond.wait(min(left, 0.25))
        return True


@contextlib.contextmanager
def _counted(refuse):
    """Count a command as it is sent. With the hold on (and `refuse`), the command is not started."""
    global _writing
    with _cond:
        if refuse and time.monotonic() < _until:
            raise UpdateHold(MESSAGE)
        _writing += 1
    try:
        yield
    finally:
        with _cond:
            _writing -= 1
            _cond.notify_all()


def writing_request(method, path):
    """Around one HTTP request to a printer: reads and the emergency stop pass, writes are counted and held."""
    if method.upper() in ("GET", "HEAD", "OPTIONS") or path.split("?")[0] in watch_only.READ_POSTS:
        return contextlib.nullcontext()
    return _counted(True)


def writing_call(method):
    """Around one WebSocket call to a printer, the same way."""
    if method in watch_only.READ_CALLS:
        return contextlib.nullcontext()
    return _counted(True)
