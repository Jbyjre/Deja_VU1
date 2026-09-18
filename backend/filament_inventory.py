"""
filament_inventory.py
======================

Tracks the spools you actually own, separate from what happens to be loaded
in the printer right now (that part is mock_moonraker's job). Two things
this makes possible:

  1. "Do I have what this file needs?" — compare a job's required colors
     against what's in the inventory before you start printing.
  2. "Has this spool been sitting loaded too long?" — filament left loaded
     for weeks absorbs moisture and prints worse. A nudge, not an alarm.

Nothing here needs a printer connection or extra hardware; it is a plain
list the user maintains, the same way the maintenance log is a plain list
Deja Vu1 maintains for you automatically.
"""

import json
import os
from datetime import datetime

import mock_moonraker

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_INVENTORY_PATH = os.path.join(_DATA_DIR, "filament_inventory.json")

IDLE_DAYS_THRESHOLD = 21


def _default_inventory():
    """A reasonable starting shelf, built from the same colors the rest of
    the project already uses, so a first run doesn't show an empty screen."""
    now = datetime.now().isoformat(timespec="seconds")
    colors = mock_moonraker.FILAMENT_COLORS
    return [
        {"id": "spool-1", "material": "PLA", "color_name": colors[2]["name"], "color_hex": colors[2]["hex"], "grams_remaining": 340.0, "loaded_since": now},
        {"id": "spool-2", "material": "PLA", "color_name": colors[0]["name"], "color_hex": colors[0]["hex"], "grams_remaining": 1100.0, "loaded_since": now},
        {"id": "spool-3", "material": "PETG", "color_name": colors[4]["name"], "color_hex": colors[4]["hex"], "grams_remaining": 60.0, "loaded_since": now},
    ]


def _load():
    if not os.path.exists(_INVENTORY_PATH):
        inventory = _default_inventory()
        _save(inventory)
        return inventory
    with open(_INVENTORY_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _save(inventory):
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_INVENTORY_PATH, "w", encoding="utf-8") as fh:
        json.dump(inventory, fh, indent=2)


def get_inventory():
    return list(_load())


def add_spool(material, color_name, color_hex, grams_remaining):
    inventory = _load()
    next_id = f"spool-{len(inventory) + 1}"
    while any(s["id"] == next_id for s in inventory):
        next_id = f"{next_id}x"
    spool = {
        "id": next_id,
        "material": material,
        "color_name": color_name,
        "color_hex": color_hex,
        "grams_remaining": float(grams_remaining),
        "loaded_since": datetime.now().isoformat(timespec="seconds"),
    }
    inventory.append(spool)
    _save(inventory)
    return spool


def remove_spool(spool_id):
    inventory = _load()
    filtered = [s for s in inventory if s["id"] != spool_id]
    if len(filtered) == len(inventory):
        raise ValueError(f"Unknown spool: {spool_id}")
    _save(filtered)
    return filtered


def update_grams(spool_id, grams_remaining):
    inventory = _load()
    for spool in inventory:
        if spool["id"] == spool_id:
            spool["grams_remaining"] = float(grams_remaining)
            _save(inventory)
            return spool
    raise ValueError(f"Unknown spool: {spool_id}")


def check_job_requirements(required_filament=None):
    """
    Does the inventory cover what a job needs?

    `required_filament` defaults to the currently "sliced" job's metadata
    (mock_moonraker.get_current_job_requirements), same source the color
    checker module already reads.
    """
    if required_filament is None:
        required_filament = mock_moonraker.get_current_job_requirements()["required_filament"]

    inventory = _load()
    have_colors = {s["color_name"] for s in inventory if s["grams_remaining"] > 0}

    missing = [
        req for req in required_filament
        if req["expected_color_name"] not in have_colors
    ]

    return {
        "missing": missing,
        "all_covered": len(missing) == 0,
    }


def idle_spools(threshold_days=IDLE_DAYS_THRESHOLD):
    """Spools that have been loaded longer than `threshold_days`."""
    now = datetime.now()
    flagged = []
    for spool in _load():
        loaded_since = datetime.fromisoformat(spool["loaded_since"])
        days = (now - loaded_since).total_seconds() / 86400.0
        if days >= threshold_days:
            flagged.append({**spool, "days_loaded": round(days, 1)})
    return flagged


def reset():
    """Wipe and reseed the default inventory. Useful for tests."""
    inventory = _default_inventory()
    _save(inventory)
    return inventory
