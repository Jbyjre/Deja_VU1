"""
modules.py
==========

The list of features this dashboard offers, and whether each one is turned
on. A module here is metadata, not code that gets loaded dynamically: each
module ID corresponds to one of the other backend files. Disabling a module
just makes its API routes refuse to answer; the code itself is never
unloaded, uninstalled, or swapped out. That is deliberate — dynamically
loading arbitrary code is a security problem this project does not need to
take on to deliver the useful part of the idea, which is "let me see
everything this dashboard can do, and turn off what I don't want."

status meanings:
  "ready"            - works today against a live printer, no extra parts
  "hardware_pending"  - logic is done, waiting on a physical add-on
  "optional"          - works today, off by default, not essential
"""

import json
import os

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_STATE_PATH = os.path.join(_DATA_DIR, "modules.json")

REGISTRY = [
    {
        "id": "maintenance",
        "name": "Maintenance reminders",
        "description": "Tracks nozzle, bed, belt, rail, dock, and fan "
                        "maintenance from print history.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "printer_control",
        "name": "Printer control",
        "description": "Pause, resume, cancel, set temperatures, home "
                        "axes, and send G-code.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "led_status",
        "name": "Dock status rings",
        "description": "WS2812 rings, or push the same state to a WLED "
                        "strip you already own.",
        "status": "hardware_pending",
        "default_enabled": True,
    },
    {
        "id": "color_check",
        "name": "Right colour loaded?",
        "description": "Optical filament colour check before a print starts.",
        "status": "hardware_pending",
        "default_enabled": True,
    },
    {
        "id": "notifications",
        "name": "Push notifications",
        "description": "Alerts on print finish/fail via ntfy.sh, Discord, "
                        "or Telegram. Respects quiet hours.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "filament_inventory",
        "name": "Filament inventory",
        "description": "Tracks spools on hand, flags files needing a "
                        "colour you don't have, nudges on idle spools.",
        "status": "optional",
        "default_enabled": False,
    },
    {
        "id": "sanity_check",
        "name": "Pre-print sanity check",
        "description": "Combines maintenance, dock, and colour status "
                        "into one verdict before you print.",
        "status": "optional",
        "default_enabled": False,
    },
    {
        "id": "compare",
        "name": "What changed?",
        "description": "Compares the next job against your history and "
                        "flags likely causes from past failures.",
        "status": "optional",
        "default_enabled": False,
    },
    {
        "id": "updates",
        "name": "Update checker",
        "description": "Reads Moonraker's update-status API and flags "
                        "when Klipper or Moonraker have updates.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "backup",
        "name": "Config backup",
        "description": "One-click archive of this dashboard's settings "
                        "and history to a local file.",
        "status": "ready",
        "default_enabled": True,
    },
    {
        "id": "camera",
        "name": "Camera bridge",
        "description": "Brings the printer's camera feed in, with a "
                        "watchdog that flags a frozen stream.",
        "status": "ready",
        "default_enabled": True,
    },
]

_BY_ID = {m["id"]: m for m in REGISTRY}


def _default_state():
    return {m["id"]: m["default_enabled"] for m in REGISTRY}


def _load_state():
    if not os.path.exists(_STATE_PATH):
        state = _default_state()
        _save_state(state)
        return state
    with open(_STATE_PATH, "r", encoding="utf-8") as fh:
        state = json.load(fh)
    for module_id, enabled in _default_state().items():
        state.setdefault(module_id, enabled)
    return state


def _save_state(state):
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_STATE_PATH, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)


def get_all():
    """Every module with its metadata and current on/off state."""
    state = _load_state()
    return [
        {**module, "enabled": state.get(module["id"], module["default_enabled"])}
        for module in REGISTRY
    ]


def is_enabled(module_id):
    """
    Is this module currently switched on?

    Unknown IDs count as enabled, so a route with no matching module entry
    is never accidentally blocked.
    """
    if module_id not in _BY_ID:
        return True
    return _load_state().get(module_id, True)


def set_enabled(module_id, enabled):
    if module_id not in _BY_ID:
        raise ValueError(f"Unknown module: {module_id}")
    state = _load_state()
    state[module_id] = bool(enabled)
    _save_state(state)
    return get_all()


def reset_state():
    """Wipe saved toggles and start over. Useful for tests."""
    state = _default_state()
    _save_state(state)
    return state
