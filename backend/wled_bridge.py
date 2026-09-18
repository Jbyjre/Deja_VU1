"""
wled_bridge.py
==============

An alternative way to drive the dock status rings: instead of building a
custom WS2812 controller board (see led_status.py), push the same ring
states to a WLED-flashed strip the user already owns, over WLED's own JSON
HTTP API. WLED is a very common firmware for addressable LED strips, and its
JSON API is a single POST of `{"on": ..., "seg": [...]}` to
`http://<device>/json/state` — no SDK, no extra dependency, just
`urllib.request` like every other bridge in this project.

This is a real network client, not a simulation: given a real WLED device's
address it will actually change its lights. Point it at nothing (no host
configured) and every call fails cleanly with a clear error instead of
pretending to succeed.
"""

import json
import os
import urllib.error
import urllib.request

import led_status

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_SETTINGS_PATH = os.path.join(_DATA_DIR, "wled_settings.json")

_DEFAULT_SETTINGS = {
    "host": "",             # e.g. "192.168.1.42" or "wled-dock.local"
    "leds_per_segment": 12,
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
    if "host" in updates:
        settings["host"] = str(updates["host"]).strip()
    if "leds_per_segment" in updates:
        settings["leds_per_segment"] = int(updates["leds_per_segment"])
    _save_settings(settings)
    return settings


def _request(url, payload=None, method="GET"):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = resp.read()
            return {"ok": True, "status": resp.status,
                    "body": json.loads(body) if body else {}}
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}


def test_connection(settings=None):
    settings = settings or get_settings()
    host = settings.get("host")
    if not host:
        return {"ok": False, "error": "No WLED host configured"}
    return _request(f"http://{host}/json/info")


def push_ring_states(ring_states=None, settings=None):
    """
    Send the current dock ring states to a WLED device as one segment per
    toolhead ring. Returns {"ok": False, "error": ...} rather than raising,
    the same pattern notifications.py uses for its webhook posts — a
    misconfigured or offline WLED strip should never take the dashboard
    down with it.
    """
    settings = settings or get_settings()
    host = settings.get("host")
    if not host:
        return {"ok": False, "error": "No WLED host configured"}

    ring_states = ring_states or led_status.get_all_ring_states()
    segments = []
    for i, ring in enumerate(ring_states["rings"]):
        r, g, b = ring["color_rgb"]
        segments.append({
            "id": i,
            "on": ring["state"] != "off",
            "col": [[r, g, b]],
        })

    result = _request(f"http://{host}/json/state", payload={"on": True, "seg": segments}, method="POST")
    result["segments_sent"] = len(segments)
    return result


def reset():
    """Restore default settings. Useful for tests."""
    _save_settings(_DEFAULT_SETTINGS)
    return get_settings()
