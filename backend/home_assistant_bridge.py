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
import re
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


def _sensors_from_state(state, prefix, extras=None):
    """
    Every entity this bridge publishes. Each is an ordinary REST sensor
    (POST /api/states/<entity_id>), so Home Assistant needs no add-on.
    """
    extras = extras or {}
    name = "Deja Vu1"

    def s(value, friendly, unit=None, device_class=None, icon=None):
        attrs = {"friendly_name": f"{name} {friendly}"}
        if unit:
            attrs["unit_of_measurement"] = unit
        if device_class:
            attrs["device_class"] = device_class
            attrs["state_class"] = "measurement"
        if icon:
            attrs["icon"] = icon
        return (value, attrs)

    progress = state.get("progress") or 0.0
    elapsed = state.get("print_duration_hours") or 0.0
    remaining = (elapsed / progress - elapsed) if 0 < progress < 1 else 0.0
    layer = state.get("layer") or {}
    sensors = {
        f"{prefix}_state": s(state["state"], "printer state", icon="mdi:printer-3d"),
        f"{prefix}_state_message": s(state.get("state_message") or "", "status message"),
        f"{prefix}_progress": s(round(progress * 100, 1), "print progress", "%", icon="mdi:progress-clock"),
        f"{prefix}_current_file": s(state["current_file"] or "none", "current file", icon="mdi:file"),
        f"{prefix}_active_toolhead": s(state["active_toolhead"] or "none", "active toolhead"),
        f"{prefix}_print_duration": s(round(elapsed * 60, 1), "print time so far", "min", "duration"),
        f"{prefix}_time_remaining": s(round(remaining * 60, 1), "time remaining (estimate)", "min", "duration"),
        f"{prefix}_current_layer": s(layer.get("current", 0), "current layer", icon="mdi:layers"),
        f"{prefix}_total_layers": s(layer.get("total", 0), "total layers", icon="mdi:layers-triple"),
        f"{prefix}_bed_temperature": s(round(state.get("bed_temperature", 0.0), 1), "bed temperature", "°C", "temperature"),
        f"{prefix}_bed_target": s(round(state.get("bed_target", 0.0), 1), "bed target", "°C", "temperature"),
    }
    if state.get("chamber_temperature") is not None:
        sensors[f"{prefix}_chamber_temperature"] = s(
            round(state["chamber_temperature"], 1), "chamber temperature", "°C", "temperature")
    for th, data in sorted(state.get("toolheads", {}).items()):
        key = f"{prefix}_{th.lower()}"
        sensors[f"{key}_temperature"] = s(round(data["temperature"], 1), f"{th} temperature", "°C", "temperature")
        sensors[f"{key}_target"] = s(round(data["target_temperature"], 1), f"{th} target", "°C", "temperature")
        sensors[f"{key}_status"] = s(data["status"], f"{th} dock status", icon="mdi:printer-3d-nozzle")
        sensors[f"{key}_filament"] = (data["filament_color_name"] if data["filament_loaded"] else "empty",
                                      {"friendly_name": f"{name} {th} filament",
                                       "color_hex": data["filament_color_hex"], "icon": "mdi:printer-3d-nozzle"})
    if "maintenance_overdue" in extras:
        sensors[f"{prefix}_maintenance_overdue"] = s(extras["maintenance_overdue"], "maintenance tasks overdue", icon="mdi:wrench-clock")
    if "health_score" in extras:
        sensors[f"{prefix}_print_health"] = s(extras["health_score"], "print health", "%", icon="mdi:heart-pulse")
    if "queue_length" in extras:
        sensors[f"{prefix}_queue_length"] = s(extras["queue_length"], "print queue length", icon="mdi:tray-full")
    if "last_automation" in extras:
        sensors[f"{prefix}_last_automation"] = s(extras["last_automation"], "last automation fired", icon="mdi:robot")
    return sensors


def push_sensors(settings=None, extras=None, only=None):
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
    sensors = _sensors_from_state(state, settings["entity_prefix"], extras)
    if only:
        sensors = {k: v for k, v in sensors.items() if k in only}

    results = {}
    unreachable = None
    for entity_id, (value, attributes) in sensors.items():
        if unreachable:
            # One failed connection is enough to know; don't wait out a
            # timeout for each of the remaining entities.
            results[entity_id] = {"ok": False, "error": f"Skipped: {unreachable}"}
            continue
        results[entity_id] = _put_state(base_url, token, entity_id, value, attributes)
        if not results[entity_id]["ok"] and "status" not in results[entity_id]:
            unreachable = results[entity_id]["error"]

    return {"ok": all(r["ok"] for r in results.values()), "results": results,
            "entities": len(results)}


def publish_entity(entity_id, state, attributes=None, settings=None):
    """Publish one entity (used by automations to set a custom sensor)."""
    settings = settings or get_settings()
    base_url, token = settings.get("base_url"), settings.get("token")
    if not base_url or not token:
        return {"ok": False, "error": "Home Assistant URL and token must both be set"}
    if not re.fullmatch(r"sensor\.[a-z0-9_]{1,64}", entity_id or ""):
        raise ValueError("Entity must look like sensor.name_with_underscores")
    return _put_state(base_url, token, entity_id, state, attributes or {})


def reset():
    """Restore default settings. Useful for tests."""
    _save_settings(_DEFAULT_SETTINGS)
    return get_settings()
