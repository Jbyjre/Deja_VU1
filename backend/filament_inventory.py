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
            spool["last_weighed_at"] = datetime.now().isoformat(timespec="seconds")
            spool["used_since_weighed"] = 0.0
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


# ---------------------------------------------------------------------------
# Weight-based estimates: what a file will use, and what prints actually used
# ---------------------------------------------------------------------------

def _match_spool(inventory, material, color_hex):
    """The spool that best fits a toolhead's needs: same material, nearest colour."""
    import color_check
    best = None
    for spool in inventory:
        if material and spool["material"].upper() != str(material).upper():
            continue
        if color_hex:
            distance = color_check.color_distance(color_hex, spool["color_hex"])
            if distance > color_check.WARN_TOLERANCE:
                continue
        else:
            distance = 0
        if best is None or distance < best[0]:
            best = (distance, spool)
    return best[1] if best else None


def estimate_for_job(required):
    """
    For each toolhead a file uses: which spool it will draw from, how much
    the file itself says it needs, and how much will be left afterwards.
    """
    inventory = _load()
    out = []
    for req in required:
        grams = float(req.get("grams") or 0.0)
        spool = _match_spool(inventory, req.get("expected_material"), req.get("expected_color_hex"))
        if spool is None:
            out.append({"toolhead": req["toolhead"], "status": "no_spool", "grams_needed": grams})
            continue
        left = spool["grams_remaining"] - grams
        out.append({
            "toolhead": req["toolhead"], "spool_id": spool["id"],
            "spool": f"{spool['material']} {spool['color_name']}",
            "grams_needed": round(grams, 1), "grams_remaining": round(spool["grams_remaining"], 1),
            "grams_after": round(left, 1),
            "status": "short" if left < 0 else ("low" if left < 50 else "ok"),
        })
    return out


def deduct_after_print(job):
    """
    Take a finished print's filament off the spool it most likely used, so
    the remaining weight follows what was actually printed rather than
    waiting for someone to weigh the spool again.
    """
    inventory = _load()
    spool = _match_spool(inventory, job.get("filament_type"), job.get("filament_color_hex"))
    if spool is None:
        return None
    grams = float(job.get("filament_used_grams") or 0.0)
    spool["grams_remaining"] = round(max(0.0, spool["grams_remaining"] - grams), 1)
    spool["used_since_weighed"] = round(spool.get("used_since_weighed", 0.0) + grams, 1)
    _save(inventory)
    return {"spool_id": spool["id"], "deducted": grams, "grams_remaining": spool["grams_remaining"]}


def forecast(history):
    """
    Per spool: grams left, the average a completed print in the same
    material and colour has used in your history, and how many more such
    prints that leaves - an estimate from real print records.
    """
    out = []
    for spool in _load():
        similar = [j["filament_used_grams"] for j in history
                   if j["status"] == "completed"
                   and j["filament_type"].upper() == spool["material"].upper()
                   and j["filament_color_name"] == spool["color_name"]]
        avg = sum(similar) / len(similar) if similar else None
        out.append({
            "id": spool["id"], "material": spool["material"], "color_name": spool["color_name"],
            "color_hex": spool["color_hex"], "grams_remaining": spool["grams_remaining"],
            "used_since_weighed": spool.get("used_since_weighed", 0.0),
            "last_weighed_at": spool.get("last_weighed_at"),
            "similar_prints": len(similar),
            "avg_grams_per_print": round(avg, 1) if avg else None,
            "prints_left": int(spool["grams_remaining"] // avg) if avg else None,
        })
    return out


def reset():
    """Wipe and reseed the default inventory. Useful for tests."""
    inventory = _default_inventory()
    _save(inventory)
    return inventory
