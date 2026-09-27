"""
printer_control.py
===================

Direct control over what the printer is doing right now: pause, resume,
cancel, set a temperature, home an axis, or send a raw G-code line.

Like maintenance.py, this module needs no extra hardware — it only needs a
live connection to Moonraker. Every function here calls through to
mock_moonraker today; swapping that file for a real Moonraker HTTP client is
the only change needed to make these commands reach a real printer.
"""

import threading

import file_library
import mock_moonraker
import print_gate

_start_locks = {}
_start_locks_guard = threading.Lock()


def _start_lock(printer_id):
    with _start_locks_guard:
        return _start_locks.setdefault(printer_id, threading.Lock())

VALID_AXES = {"X", "Y", "Z"}
MIN_TEMP = 0
MAX_TEMP = 300
MAX_BED_TEMP = 120
MAX_GCODE_LENGTH = 200


def get_capabilities():
    """What this dashboard is currently allowed to do to the printer."""
    return {
        "actions": ["start", "pause", "resume", "cancel", "set_temperature", "home", "gcode"],
        "toolheads": list(mock_moonraker.TOOLHEADS),
        "temperature_range": {"min": MIN_TEMP, "max": MAX_TEMP},
    }


class PrintBlocked(Exception):
    """The safety interlock refused to start a print; carries the reasons."""

    def __init__(self, gate):
        super().__init__("; ".join(gate["blocking"]) or "Confirmation required")
        self.gate = gate


def start_print(filename, confirmed=False):
    """
    Start a print from the file library - with the interlock in front of it.

    The Confirm Print gate runs again here, on the server, at the moment of
    starting (not just when the confirm screen was drawn - things change):
      - "blocked": refused, whatever the caller says.
      - "confirm": refused unless the caller passes confirmed=True, which
        the dashboard only sends from the final confirm screen.
    Then the file is uploaded to the printer and the print is started, the
    same two calls a real Moonraker needs.
    """
    if not file_library.exists(filename):
        raise ValueError(f"No file called {filename} in the library")
    # One start at a time per printer: with a real printer the upload and
    # start take a while, and two devices pressing Start together must get
    # one print and one clear refusal - not two uploads racing.
    lock = _start_lock(mock_moonraker.selected_printer_id())
    if not lock.acquire(blocking=False):
        raise ValueError("A print is being started on this printer right now - wait for it to finish starting")
    try:
        return _start_locked(filename, confirmed)
    finally:
        lock.release()


def _start_locked(filename, confirmed):
    gate = print_gate.summary(filename)
    if gate["verdict"] == "blocked" or (gate["verdict"] == "confirm" and not confirmed):
        raise PrintBlocked(gate)
    if not confirmed:
        raise PrintBlocked({**gate, "blocking": [], "verdict": "confirm",
                            "warnings": gate["warnings"] or ["Confirm the print summary to start"]})
    data = file_library.read_bytes(filename)
    # The file's bytes, not just its size: a real printer stores exactly
    # these (checked on arrival by their SHA-256) before it prints them.
    mock_moonraker.upload_file(filename, len(data), data)
    state = mock_moonraker.start_print(filename, gate["job"])
    file_library.touch(filename, "last_printed")
    return state


def pause_print():
    return mock_moonraker.pause_print()


def resume_print():
    return mock_moonraker.resume_print()


def cancel_print():
    return mock_moonraker.cancel_print()


def set_temperature(toolhead, target):
    if toolhead not in mock_moonraker.TOOLHEADS:
        raise ValueError(f"Unknown toolhead: {toolhead}")
    try:
        target = float(target)
    except (TypeError, ValueError):
        raise ValueError("Target temperature must be a number")
    if not (MIN_TEMP <= target <= MAX_TEMP):
        raise ValueError(f"Target temperature must be between {MIN_TEMP} and {MAX_TEMP}")
    return mock_moonraker.set_target_temperature(toolhead, target)


def set_bed_temperature(target):
    try:
        target = float(target)
    except (TypeError, ValueError):
        raise ValueError("Bed temperature must be a number")
    if not (MIN_TEMP <= target <= MAX_BED_TEMP):
        raise ValueError(f"Bed temperature must be between {MIN_TEMP} and {MAX_BED_TEMP}")
    return mock_moonraker.set_bed_temperature(target)


def home(axes):
    axes = axes or ["X", "Y", "Z"]
    if not isinstance(axes, list) or not axes:
        raise ValueError("axes must be a non-empty list")
    cleaned = [str(a).upper() for a in axes]
    bad = [a for a in cleaned if a not in VALID_AXES]
    if bad:
        raise ValueError(f"Unknown axis: {', '.join(bad)}")
    return mock_moonraker.home_axes(cleaned)


def send_gcode(command):
    command = str(command or "").strip()
    if not command:
        raise ValueError("G-code command cannot be empty")
    if len(command) > MAX_GCODE_LENGTH:
        raise ValueError("G-code command is too long")
    return mock_moonraker.run_gcode(command)


def get_console_log(limit=30):
    return mock_moonraker.get_console_log(limit)
