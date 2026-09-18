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

import mock_moonraker

VALID_AXES = {"X", "Y", "Z"}
MIN_TEMP = 0
MAX_TEMP = 300
MAX_GCODE_LENGTH = 200


def get_capabilities():
    """What this dashboard is currently allowed to do to the printer."""
    return {
        "actions": ["pause", "resume", "cancel", "set_temperature", "home", "gcode"],
        "toolheads": list(mock_moonraker.TOOLHEADS),
        "temperature_range": {"min": MIN_TEMP, "max": MAX_TEMP},
    }


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
    command = (command or "").strip()
    if not command:
        raise ValueError("G-code command cannot be empty")
    if len(command) > MAX_GCODE_LENGTH:
        raise ValueError("G-code command is too long")
    return mock_moonraker.run_gcode(command)


def get_console_log(limit=30):
    return mock_moonraker.get_console_log(limit)
