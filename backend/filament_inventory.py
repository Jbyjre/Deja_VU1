"""
filament_inventory.py
======================

Tracks the spools you actually own, separate from what happens to be loaded
in the printer right now (that part is mock_moonraker's job). Two things
this makes possible:

  1. "Do I have what this file needs?" - compare a job's required colors
     against what's in the inventory before you start printing.
  2. "Has this spool been sitting loaded too long?" - filament left loaded
     for weeks absorbs moisture and prints worse. A nudge, not an alarm.

Nothing here needs a printer connection or extra hardware; it is a plain
list the user maintains, the same way the maintenance log is a plain list
Deja Vu1 maintains for you automatically.

Weights carry where they came from. `grams_remaining` is None when nobody
knows it (a Spoolman spool with no starting weight, a spool added without
one), which is never the same as an empty roll. `weight_source` says how far
to trust a number:

  "weighed"    you put the spool on a scale and typed what it showed
  "estimated"  a label or guess, Spoolman's own count, or a weighed figure
               with finished prints subtracted since
  "unknown"    no figure at all (grams_remaining is None)

`weight_from` says whose figure it is: "you" or "spoolman".
"""

import math
import os
import re
import threading
from datetime import datetime

import mock_moonraker
import storage

_DATA_DIR = storage.DATA_DIR
_INVENTORY_PATH = os.path.join(_DATA_DIR, "filament_inventory.json")
# Which roll each head had when a print started, per printer, and the charges made.
_STARTS_PATH = os.path.join(_DATA_DIR, "print_spools.json")
MAX_CHARGES = 50

IDLE_DAYS_THRESHOLD = 21
MAX_SPOOLS = 200
MAX_GRAMS = 100_000
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
WEIGHT_SOURCES = ("weighed", "estimated", "unknown")
_lock = threading.RLock()


def _default_inventory():
    """Ownership and weight must come from the person or their tracker."""
    return []


def _load():
    inventory = storage.load_json(_INVENTORY_PATH, None)
    if not isinstance(inventory, list):
        inventory = _default_inventory()
        _save(inventory)
    for spool in inventory:
        _describe_weight(spool)
    return inventory


def _describe_weight(spool):
    """
    Give a spool saved before weights carried their source one, from what it
    does say. Nothing is changed that the record states: a number stays the
    number, and only the label is added.
    """
    if spool.get("weight_source") in WEIGHT_SOURCES:
        return spool
    spool.setdefault("weight_from", "spoolman" if spool.get("spoolman_id") else "you")
    if spool.get("grams_remaining") is None:
        spool["weight_source"] = "unknown"
    elif spool.get("last_weighed_at") and not spool.get("used_since_weighed"):
        spool["weight_source"] = "weighed"
    else:
        spool["weight_source"] = "estimated"
    spool["weight_legacy"] = True
    return spool


def _save(inventory):
    storage.save_json(_INVENTORY_PATH, inventory)


def get_inventory():
    return list(_load())


def _grams(value, allow_unknown=False):
    """
    A real, sensible weight. NaN or infinity would break the page's data.
    With allow_unknown, None or an empty field means "not known" and comes
    back as None - never as 0, which would say the roll is empty.
    """
    if allow_unknown and (value is None or (isinstance(value, str) and not value.strip())):
        return None
    try:
        grams = float(value)
    except (TypeError, ValueError):
        raise ValueError("Grams remaining must be a number")
    if not math.isfinite(grams) or not 0 <= grams <= MAX_GRAMS:
        raise ValueError(f"Grams remaining must be between 0 and {MAX_GRAMS}")
    return grams


def _source_for(grams, weight_source):
    if grams is None:
        return "unknown"
    if weight_source in (None, ""):
        return "estimated"
    if weight_source not in ("weighed", "estimated"):
        raise ValueError("Say whether the weight was weighed or estimated")
    return weight_source


def add_spool(material, color_name, color_hex, grams_remaining=None, weight_source=None):
    """
    A spool you own. Leave the grams out when you don't know them: the spool
    is then "unknown", and nothing treats it as empty. A typed figure counts
    as an estimate unless you say you weighed it.
    """
    material = str(material or "").strip()[:20] or "PLA"
    color_name = str(color_name or "").strip()[:40] or "Unnamed"
    color_hex = str(color_hex or "").strip()
    if not _HEX.match(color_hex):
        raise ValueError("Colour must be a hex value like #ff7a2f")
    grams = _grams(grams_remaining, allow_unknown=True)
    source = _source_for(grams, weight_source)
    with _lock:
        inventory = _load()
        if len(inventory) >= MAX_SPOOLS:
            raise ValueError(f"At most {MAX_SPOOLS} spools - remove an empty one first")
        next_id = f"spool-{len(inventory) + 1}"
        while any(s["id"] == next_id for s in inventory):
            next_id = f"{next_id}x"
        spool = {
            "id": next_id,
            "material": material,
            "color_name": color_name,
            "color_hex": color_hex.lower(),
            "grams_remaining": grams,
            "weight_source": source,
            "weight_from": "you",
            "loaded_since": datetime.now().isoformat(timespec="seconds"),
        }
        if source == "weighed":
            spool["last_weighed_at"] = spool["loaded_since"]
            spool["used_since_weighed"] = 0.0
        inventory.append(spool)
        _save(inventory)
    return spool


def merge_external(source, rows):
    """
    Spools from another tracker (Spoolman): each row carries the other
    tracker's id under "<source>_id". A spool already imported is updated in
    place; a new one is added; spools added by hand are left alone. Grams
    of None mean the other tracker doesn't know them: a new spool comes in
    as "unknown" (never 0 g), and an update keeps what was there. The one
    exception repairs older imports, which saved an unknown weight as 0 g:
    such a spool, never weighed here, goes back to unknown.
    """
    key = f"{source}_id"
    added = updated = repaired = 0
    with _lock:
        inventory = _load()
        by_ext = {s.get(key): s for s in inventory if s.get(key)}
        for row in rows:
            existing = by_ext.get(row[key])
            fields = {k: row[k] for k in ("material", "color_name", "color_hex")}
            if existing:
                existing.update(fields)
                if row["grams_remaining"] is not None:
                    existing.update(grams_remaining=_grams(row["grams_remaining"]),
                                    weight_source="estimated", weight_from=source)
                    existing.pop("weight_legacy", None)
                elif (existing.get("weight_legacy") and existing.get("grams_remaining") == 0
                      and not existing.get("last_weighed_at")):
                    existing.update(grams_remaining=None, weight_source="unknown", weight_from=source)
                    existing.pop("weight_legacy", None)
                    repaired += 1
                updated += 1
                continue
            if len(inventory) >= MAX_SPOOLS:
                break
            next_id = f"spool-{len(inventory) + 1}"
            while any(s["id"] == next_id for s in inventory):
                next_id = f"{next_id}x"
            grams = _grams(row["grams_remaining"], allow_unknown=True)
            spool = {"id": next_id, **fields, key: row[key],
                     "grams_remaining": grams,
                     "weight_source": "unknown" if grams is None else "estimated",
                     "weight_from": source,
                     "loaded_since": datetime.now().isoformat(timespec="seconds")}
            inventory.append(spool)
            by_ext[row[key]] = spool
            added += 1
        _save(inventory)
    return {"added": added, "updated": updated, "repaired_unknown": repaired,
            "not_added_full": max(0, len(rows) - added - updated)}


def remove_spool(spool_id):
    with _lock:
        inventory = _load()
        filtered = [s for s in inventory if s["id"] != spool_id]
        if len(filtered) == len(inventory):
            raise ValueError(f"Unknown spool: {spool_id}")
        _save(filtered)
    return filtered


def update_grams(spool_id, grams_remaining, weight_source="weighed"):
    """
    A new figure for a spool, weighed unless you say it is an estimate.
    None (or an empty field) sets it back to unknown.
    """
    grams = _grams(grams_remaining, allow_unknown=True)
    source = _source_for(grams, weight_source)
    with _lock:
        inventory = _load()
        for spool in inventory:
            if spool["id"] == spool_id:
                spool.update(grams_remaining=grams, weight_source=source, weight_from="you")
                spool.pop("weight_legacy", None)
                if source == "weighed":
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
    # An unknown weight is not an empty roll, so it still counts as having the colour.
    have_colors = {s["color_name"] for s in inventory
                   if s.get("grams_remaining") is None or s["grams_remaining"] > 0}

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


def estimate_for_job(required, state=None):
    """
    For each toolhead a file uses: which spool it will draw from, how much
    the file itself says it needs, and how much will be left afterwards.
    """
    inventory = _load()
    import tool_setup
    assignments={h['toolhead']:h.get('spool_id') for h in tool_setup.get((state or {}).get('printer_id'))['heads']}
    mapping=(state or {}).get('extruder_map') or {}
    reserved={}
    out = []
    for req in required:
        grams = float(req.get("grams") or 0.0)
        assigned=assignments.get(mapping.get(req['toolhead'],req['toolhead']))
        spool = next((s for s in inventory if s['id']==assigned),None) if assigned else _match_spool(inventory, req.get("expected_material"), req.get("expected_color_hex"))
        if spool is None:
            out.append({"toolhead": req["toolhead"], "status": "no_spool", "grams_needed": grams})
            continue
        reserved[spool['id']]=reserved.get(spool['id'],0)+grams
        row = {
            "toolhead": req["toolhead"], "spool_id": spool["id"],
            "selection": "assigned" if assigned else "nearest matching spool",
            "spool": f"{spool['material']} {spool['color_name']}",
            "grams_needed": round(grams, 1),
            "weight_source": spool.get("weight_source", "estimated"),
        }
        if spool.get("grams_remaining") is None:
            # No figure, so no "enough" or "short": say so instead of guessing.
            row.update(grams_remaining=None, grams_after=None, status="unknown_weight")
        else:
            left = spool["grams_remaining"] - reserved[spool['id']]
            row.update(grams_remaining=round(spool["grams_remaining"], 1), grams_after=round(left, 1),
                       status="short" if left < 0 else ("low" if left < 50 else "ok"))
        out.append(row)
    return out


# ---------------------------------------------------------------------------
# Which roll a print used: fixed when it starts, not read again when it ends
# ---------------------------------------------------------------------------

def _starts():
    data = storage.load_json(_STARTS_PATH, None)
    if not isinstance(data, dict):
        data = {}
    data.setdefault("printing", {})
    data.setdefault("charges", [])
    return data


def _now():
    return datetime.now().isoformat(timespec="seconds")


def record_print_start(printer_id, state):
    """
    Keep the head-to-roll map as it is when a print starts, so the print is
    later charged to the rolls that were really loaded, even if someone
    assigns another roll to a head before it ends.
    """
    import tool_setup
    heads = {h["toolhead"]: (h.get("spool_id") or None) for h in tool_setup.get(printer_id)["heads"]}
    record = {"file": state.get("current_file"), "started_at": _now(), "heads": heads,
              "extruder_map": dict(state.get("extruder_map") or {}), "changes": []}
    with _lock:
        data = _starts()
        data["printing"][printer_id] = record
        storage.save_json(_STARTS_PATH, data)
    return record


def print_start_record(printer_id):
    with _lock:
        return _starts()["printing"].get(printer_id)


def note_assignment_change(printer_id, before, after):
    """
    A head's roll changed in Preparation. While a print runs on that printer
    the change is written down beside its start record; the charge at the end
    still goes to the roll it started with.
    """
    with _lock:
        data = _starts()
        record = data["printing"].get(printer_id)
        if not record:
            return []
        changed = [{"at": _now(), "toolhead": th, "from": before.get(th), "to": after.get(th)}
                   for th in sorted(set(before) | set(after)) if before.get(th) != after.get(th)]
        if changed:
            record["changes"] = (record.get("changes") or []) + changed
            storage.save_json(_STARTS_PATH, data)
        return changed


def forget_print_start(printer_id):
    """A print that failed or was cancelled charges nothing; its record goes."""
    with _lock:
        data = _starts()
        if data["printing"].pop(printer_id, None) is not None:
            storage.save_json(_STARTS_PATH, data)


def recent_charges(printer_id=None):
    """The last charges, newest first, each with what it says about the roll it hit."""
    with _lock:
        charges = list(_starts()["charges"])
    if printer_id:
        charges = [c for c in charges if c.get("printer") == printer_id]
    return list(reversed(charges))


def deduct_after_print(job, printer_id=None):
    """
    Take a finished print's filament off the roll it used, so the remaining
    weight follows what was printed rather than waiting for someone to weigh
    the spool again.

    The roll is the one assigned to the head when the print started (its
    start record). A roll assigned later is never charged instead; the result
    names the change so it can be corrected by hand (move_charge). Without a
    start record (the print was already running when Deja Vu1 started), a
    roll assigned now is not charged either, because nothing shows it was
    the one loaded; only an unassigned head falls back to the nearest
    matching spool, as before.
    """
    with _lock:                           # runs on the live feed's thread
        data = _starts()
        start = data["printing"].pop(printer_id, None) if printer_id else None
        if start is not None:
            storage.save_json(_STARTS_PATH, data)
        inventory = _load()
        used = job.get('toolheads_used') or []
        if len(used) > 1:
            return None                  # no measured per-tool consumption: do not charge it all to one spool
        logical = used[0] if used else None
        changes = []
        if start is not None:
            head = (start.get("extruder_map") or {}).get(logical, logical)
            assigned = (start.get("heads") or {}).get(head)
            changes = [c for c in start.get("changes") or [] if c["toolhead"] == head]
            basis = "assigned at start" if assigned else "nearest matching spool"
        else:
            import tool_setup
            head = logical
            now_assigned = next((h.get('spool_id') for h in tool_setup.get(printer_id)['heads']
                                 if logical and h['toolhead'] == logical), None)
            if now_assigned:
                return {"spool_id": None, "deducted": 0.0, "charged": False,
                        "reason": f"Not charged: Deja Vu1 didn't see this print start, so it can't tell which roll "
                                  f"{logical} had then. Weigh the spool to bring its weight up to date"}
            assigned = None
            basis = "nearest matching spool"
        if assigned:
            spool = next((s for s in inventory if s['id'] == assigned), None)
            if spool is None:
                return {"spool_id": assigned, "deducted": 0.0, "charged": False,
                        "reason": "Not charged: the roll assigned when this print started has been removed"}
        else:
            spool = _match_spool(inventory, job.get("filament_type"), job.get("filament_color_hex"))
        if spool is None:
            return None
        grams = float(job.get("filament_used_grams") or 0.0)
        if spool.get("grams_remaining") is not None:
            spool["grams_remaining"] = round(max(0.0, spool["grams_remaining"] - grams), 1)
            if grams > 0:
                spool["weight_source"] = "estimated"     # a weighed figure, less the slicer's estimate
        # An unknown weight stays unknown; the use is still counted for the next weighing.
        spool["used_since_weighed"] = round(spool.get("used_since_weighed", 0.0) + grams, 1)
        _save(inventory)
        data = _starts()
        charge = {"id": f"c{int(datetime.now().timestamp() * 1000)}-{len(data['charges'])}", "at": _now(), "printer": printer_id,
                  "file": job.get("filename"), "toolhead": head, "spool_id": spool["id"],
                  "spool": f"{spool['material']} {spool['color_name']}", "grams": round(grams, 1),
                  "basis": basis, "assignment_changed": changes}
        data["charges"] = (data["charges"] + [charge])[-MAX_CHARGES:]
        storage.save_json(_STARTS_PATH, data)
    result = {"spool_id": spool["id"], "deducted": grams, "grams_remaining": spool["grams_remaining"],
              "weight_source": spool.get("weight_source"), "charged": True, "basis": basis,
              "charge_id": charge["id"]}
    if changes:
        result["assignment_changed"] = changes
        result["reason"] = (f"Charged to {charge['spool']}, the roll {head} had when the print started. "
                            f"{head}'s roll was changed during the print: if that was a real swap, move the charge")
    return result


def move_charge(charge_id, to_spool_id):
    """
    The explicit correction: give a charge's grams back to the roll it was
    made against and take them from another one. Moving it twice is refused.
    """
    with _lock:
        data = _starts()
        charge = next((c for c in data["charges"] if c["id"] == charge_id), None)
        if charge is None:
            raise ValueError("That charge isn't in the recent list any more")
        if charge.get("moved_to"):
            raise ValueError("That charge was already moved")
        if to_spool_id == charge["spool_id"]:
            raise ValueError("Choose a different roll")
        inventory = _load()
        by_id = {s["id"]: s for s in inventory}
        target = by_id.get(to_spool_id)
        if target is None:
            raise ValueError(f"Unknown spool: {to_spool_id}")
        grams = float(charge["grams"])
        source = by_id.get(charge["spool_id"])
        if source is not None:
            if source.get("grams_remaining") is not None:
                source["grams_remaining"] = round(min(MAX_GRAMS, source["grams_remaining"] + grams), 1)
            source["used_since_weighed"] = round(max(0.0, source.get("used_since_weighed", 0.0) - grams), 1)
        if target.get("grams_remaining") is not None:
            target["grams_remaining"] = round(max(0.0, target["grams_remaining"] - grams), 1)
            if grams > 0:
                target["weight_source"] = "estimated"
        target["used_since_weighed"] = round(target.get("used_since_weighed", 0.0) + grams, 1)
        _save(inventory)
        charge.update(moved_to=to_spool_id, moved_to_name=f"{target['material']} {target['color_name']}",
                      moved_at=_now())
        storage.save_json(_STARTS_PATH, data)
        return dict(charge)


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
        grams = spool.get("grams_remaining")
        out.append({
            "id": spool["id"], "material": spool["material"], "color_name": spool["color_name"],
            "color_hex": spool["color_hex"], "grams_remaining": grams,
            "weight_source": spool.get("weight_source"),
            "used_since_weighed": spool.get("used_since_weighed", 0.0),
            "last_weighed_at": spool.get("last_weighed_at"),
            "similar_prints": len(similar),
            "avg_grams_per_print": round(avg, 1) if avg else None,
            "prints_left": int(grams // avg) if avg and grams is not None else None,
        })
    return out


def reset():
    """Wipe and reseed the default inventory, with no start records or charges. Useful for tests."""
    inventory = _default_inventory()
    _save(inventory)
    storage.save_json(_STARTS_PATH, {"printing": {}, "charges": []})
    return inventory
