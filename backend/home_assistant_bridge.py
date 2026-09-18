"""
home_assistant_bridge.py
=========================

Pushes printer state into Home Assistant as a handful of REST sensors, so it
shows up on an existing HA dashboard alongside everything else in the house.
No MQTT broker, no custom component, no dependency — Home Assistant's REST
API accepts a plain `POST /api/states/<entity_id>` with a long-lived access
token in the Authorization header, which is all this file does.

This only pushes state outward. It never reads anything back from Home
Assistant, and never controls the printer from it — the dashboard's own
printer_control.py stays the only thing that can do that.
"""

import json
import os
import urllib.error
import urllib.request

import mock_moonraker

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_SETTINGS_PATH = os.path.join(_DATA_DIR, "home_assistant_settings.json")

_DEFAULT_SETTINGS = {
    "base_url": "",          # e.g. "http://homeassistant.local:8123"
    "token": "",             # a long-lived access token from HA's profile page
    "entity_prefix": "sensor.dejavu1",
}


def _load_settings():
    if not os.path.exists(_SETTINGS_PATH):
        _save_settings(_DEFAULT_SETTINGS)
        return dict(_DEFAULT_SETTINGS)
    with open(_SETTINGS_PATH, "r", encoding="utf-8") as fh:
        settings = json.load(fh)
    merged = dict(_DEFAULT_SETTINGS)
    merged.update(settings)
    return merged


def _save_settings(settings):
    os.makedirs(_DATA_DIR, exist_ok=True)
    with open(_SETTINGS_PATH, "w", encoding="utf-8") as fh:
        json.dump(settings, fh, indent=2)


def get_settings():
    return _load_settings()


def save_settings(updates):
    settings = _load_settings()
    if "base_url" in updates:
        settings["base_url"] = str(updates["base_url"]).strip().rstrip("/")
    if "token" in updates:
        settings["token"] = str(updates["token"]).strip()
    if "entity_prefix" in updates:
        settings["entity_prefix"] = str(updates["entity_prefix"]).strip()
    _save_settings(settings)
    return settings


def _put_state(base_url, token, entity_id, state, attributes):
    url = f"{base_url}/api/states/{entity_id}"
    body = json.dumps({"state": state, "attributes": attributes}).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        })
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return {"ok": True, "status": resp.status}
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
        return {"ok": False, "error": str(exc)}


def _sensors_from_state(state, prefix):
    return {
        f"{prefix}_state": (state["state"], {"friendly_name": "Deja Vu1 printer state"}),
        f"{prefix}_progress": (
            round(state["progress"] * 100, 1),
            {"unit_of_measurement": "%", "friendly_name": "Deja Vu1 print progress"}),
        f"{prefix}_current_file": (
            state["current_file"] or "none",
            {"friendly_name": "Deja Vu1 current file"}),
        f"{prefix}_active_toolhead": (
            state["active_toolhead"] or "none",
            {"friendly_name": "Deja Vu1 active toolhead"}),
    }


def push_sensors(settings=None):
    """
    Push the printer's current state to Home Assistant as several sensor
    entities. Returns {"ok": False, "error": ...} for a missing or
    unreachable configuration rather than raising.
    """
    settings = settings or get_settings()
    base_url = settings.get("base_url")
    token = settings.get("token")
    if not base_url or not token:
        return {"ok": False, "error": "Home Assistant URL and token must both be set"}

    state = mock_moonraker.get_printer_state()
    sensors = _sensors_from_state(state, settings["entity_prefix"])

    results = {}
    for entity_id, (value, attributes) in sensors.items():
        results[entity_id] = _put_state(base_url, token, entity_id, value, attributes)

    return {"ok": all(r["ok"] for r in results.values()), "results": results}


def reset():
    """Restore default settings. Useful for tests."""
    _save_settings(_DEFAULT_SETTINGS)
    return get_settings()
