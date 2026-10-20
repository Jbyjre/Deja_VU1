"""
spoolman_bridge.py
==================

Bring the spools you already track in Spoolman (github.com/Donkie/Spoolman,
the self-hosted filament tracker) into this dashboard's
filament inventory, so you don't type them in twice.

One way, on request: Spoolman stays the record it is. Each imported spool
remembers its Spoolman id, so importing again updates it (grams, colour,
name) instead of adding a duplicate; spools you added here by hand are
never touched.

Spoolman's API as read from its source (spoolman/api/v1, commit d102f94):
  GET <base>/api/v1/spool   every spool that isn't archived, as a JSON list
  spool:    id, remaining_weight (grams, or null when the starting weight
            isn't known), archived, location, filament
  filament: name, material, color_hex ("FF0000", alpha allowed at the end),
            multi_color_hexes ("FF0000,00FF00") for multi-colour filament,
            vendor {name}
"""

import os
import re
from urllib.parse import urlparse

import filament_inventory
import outbound
import storage

_DATA_DIR = storage.DATA_DIR
_SETTINGS_PATH = os.path.join(_DATA_DIR, "spoolman_settings.json")
_HEX = re.compile(r"^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")


def get_settings():
    return {"url": "", **storage.load_json(_SETTINGS_PATH, {})}


def _base(url):
    url = str(url or "").strip().rstrip("/")
    if not url:
        raise ValueError("Enter Spoolman's address, like http://192.168.1.20:7912")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Spoolman's address looks like http://192.168.1.20:7912")
    # Accept the API address too, the way people often copy it.
    return re.sub(r"/api/v1$", "", url)


def _colour(filament):
    hexes = filament.get("color_hex") or str(filament.get("multi_color_hexes") or "").split(",")[0]
    hexes = str(hexes or "").strip().lstrip("#")
    return f"#{hexes[:6].lower()}" if _HEX.match(hexes) else None


def _spool_row(spool):
    """One Spoolman spool -> what the inventory keeps, or (None, reason)."""
    if not isinstance(spool, dict) or not isinstance(spool.get("filament"), dict):
        return None, "not a spool"
    if spool.get("archived"):
        return None, "archived"
    f = spool["filament"]
    colour = _colour(f)
    if not colour:
        return None, "no colour set in Spoolman"
    vendor = (f.get("vendor") or {}).get("name") if isinstance(f.get("vendor"), dict) else None
    name = " ".join(str(p) for p in (vendor, f.get("name")) if p) or "Unnamed"
    grams = spool.get("remaining_weight")
    try:
        grams = max(0.0, min(float(grams), filament_inventory.MAX_GRAMS)) if grams is not None else None
    except (TypeError, ValueError):
        grams = None
    return {"spoolman_id": str(spool.get("id")), "material": str(f.get("material") or "PLA")[:20],
            "color_name": name[:40], "color_hex": colour, "grams_remaining": grams}, None


def import_spools(url=None):
    """Fetch every active spool from Spoolman and merge it in. Returns counts and reasons, in words."""
    base = _base(url if url is not None else get_settings().get("url"))
    storage.save_json(_SETTINGS_PATH, {"url": base})
    reply = outbound.send(f"{base}/api/v1/spool", "Spoolman", timeout=8.0)
    if not reply["ok"]:
        raise ValueError(reply["error"])
    spools = reply.get("body")
    if not isinstance(spools, list):
        raise ValueError("Spoolman answered, but not with a list of spools - is that address really Spoolman?")
    rows, skipped = [], []
    for spool in spools:
        row, why = _spool_row(spool)
        if row:
            rows.append(row)
        elif why != "archived":
            skipped.append(f"Spool {spool.get('id') if isinstance(spool, dict) else '?'}: {why}")
    result = filament_inventory.merge_external("spoolman", rows)
    result.update({"url": base, "found": len(spools), "skipped": skipped,
                   "unknown_weight": sum(1 for r in rows if r["grams_remaining"] is None)})
    return result
