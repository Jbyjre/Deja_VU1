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
import re
import urllib.error
import urllib.request

import led_status
import storage

_HOST = re.compile(r"^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$")

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
    settings = storage.load_json(_SETTINGS_PATH, {})
    merged = dict(_DEFAULT_SETTINGS)
    merged.update(settings)
    return merged


def _save_settings(settings):
    storage.save_json(_SETTINGS_PATH, settings)


def get_settings():
    return _load_settings()


def save_settings(updates):
    settings = _load_settings()
    if "host" in updates:
        host = str(updates["host"] or "").strip()
        # Just a name or address (and port): it is put into http://<host>/json/...
        # so anything else could point those requests somewhere unexpected.
        if host and not _HOST.match(host):
            raise ValueError("Enter the WLED device's address, like 192.168.1.42 or wled.local")
        settings["host"] = host
    if "leds_per_segment" in updates:
        try:
            leds = int(updates["leds_per_segment"])
        except (TypeError, ValueError):
            raise ValueError("LEDs per ring must be a whole number")
        if not 1 <= leds <= 1000:
            raise ValueError("LEDs per ring must be between 1 and 1000")
        settings["leds_per_segment"] = leds
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


def push_color(color_hex, settings=None):
    """
    Set the whole strip to one colour - what an automation's "light" action
    sends (for example amber when a print pauses). Same fail-cleanly
    contract as push_ring_states.
    """
    settings = settings or get_settings()
    host = settings.get("host")
    if not host:
        return {"ok": False, "error": "No WLED host configured"}
    value = str(color_hex or "").lstrip("#")
    if len(value) != 6 or any(c not in "0123456789abcdefABCDEF" for c in value):
        raise ValueError("Colour must be a hex value like #ffaa00")
    rgb = [int(value[i:i + 2], 16) for i in (0, 2, 4)]
    return _request(f"http://{host}/json/state",
                    payload={"on": True, "seg": [{"col": [rgb]}]}, method="POST")


def reset():
    """Restore default settings. Useful for tests."""
    _save_settings(_DEFAULT_SETTINGS)
    return get_settings()
