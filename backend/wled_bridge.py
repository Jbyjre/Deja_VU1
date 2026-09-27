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

import os
import re

import led_status
import outbound
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


# WLED's effect numbers (wled00/FX.h): 0 Solid, 1 Blink, 2 Breathe - the
# three the ring states use.
_WLED_FX = {"solid": 0, "blink": 1, "pulse": 2}
RINGS = 4


def _request(url, payload=None, method="GET"):
    return outbound.send(url, "The WLED device", payload=payload, method=method)


def _confirmed(result):
    """
    WLED answers a state change with {"success":true} (wled00/wled_server.cpp),
    or the whole new state when asked to. Anything else wasn't WLED saying yes.
    """
    body = result.get("body") if result.get("ok") else None
    if result.get("ok") and not (isinstance(body, dict) and (body.get("success") is True or "on" in body)):
        return {"ok": False, "status": result.get("status"),
                "error": "The device answered, but not the way WLED confirms a change - is that address a WLED device?"}
    return result


def test_connection(settings=None):
    """GET /json/info: is it WLED, which version, and how many LEDs it drives."""
    settings = settings or get_settings()
    host = settings.get("host")
    if not host:
        return {"ok": False, "error": "No WLED host configured"}
    result = _request(f"http://{host}/json/info")
    if not result["ok"]:
        return result
    info = result.get("body")
    if not isinstance(info, dict) or "ver" not in info:
        return {"ok": False, "status": result.get("status"),
                "error": "The device answered, but it doesn't look like WLED (no version in /json/info)"}
    leds = (info.get("leds") or {}).get("count")
    needed = RINGS * int(settings.get("leds_per_segment") or 12)
    result.update(version=info.get("ver"), name=info.get("name"), leds=leds,
                  message=f"Found WLED {info.get('ver')}" + (f" \"{info['name']}\"" if info.get("name") else "")
                  + (f" driving {leds} LEDs" if leds else ""))
    if isinstance(leds, int) and leds < needed:
        result["warning"] = (f"The strip has {leds} LEDs, but {RINGS} rings of "
                             f"{settings.get('leds_per_segment')} need {needed} - the last rings won't all light")
    return result


def push_ring_states(ring_states=None, settings=None):
    """
    Send the current dock ring states to a WLED device as one segment per
    toolhead ring. Returns {"ok": False, "error": ...} rather than raising,
    the same pattern notifications.py uses for its webhook posts — a
    misconfigured or offline WLED strip should never take the dashboard
    down with it.

    Each segment names where it starts and stops: WLED ignores a segment id
    it doesn't have yet unless it is given a stop (wled00/json.cpp,
    deserializeSegment: "ignore empty/inactive segments"), so without them a
    fresh strip - one segment - would only ever show T0's ring.
    """
    settings = settings or get_settings()
    host = settings.get("host")
    if not host:
        return {"ok": False, "error": "No WLED host configured"}

    ring_states = ring_states or led_status.get_all_ring_states()
    per = int(settings.get("leds_per_segment") or 12)
    segments = []
    for i, ring in enumerate(ring_states["rings"]):
        r, g, b = ring["color_rgb"]
        segments.append({
            "id": i,
            "start": i * per,
            "stop": (i + 1) * per,
            "on": ring["state"] != "off",
            "col": [[r, g, b]],
            "fx": _WLED_FX.get(ring.get("effect"), 0),
        })

    result = _confirmed(_request(f"http://{host}/json/state", payload={"on": True, "seg": segments},
                                 method="POST"))
    result["segments_sent"] = len(segments)
    return result


def push_color(color_hex, settings=None):
    """
    Set the whole strip to one colour - what an automation's "light" action
    sends (for example amber when a print pauses). Same fail-cleanly
    contract as push_ring_states. Every ring segment is named: in WLED a
    list entry without an id means segment 0 only, which after the ring
    push is just T0's ring. (A segment that doesn't exist is skipped by
    WLED, so on an unsplit strip this still colours all of it.)
    """
    settings = settings or get_settings()
    host = settings.get("host")
    if not host:
        return {"ok": False, "error": "No WLED host configured"}
    value = str(color_hex or "").lstrip("#")
    if len(value) != 6 or any(c not in "0123456789abcdefABCDEF" for c in value):
        raise ValueError("Colour must be a hex value like #ffaa00")
    rgb = [int(value[i:i + 2], 16) for i in (0, 2, 4)]
    return _confirmed(_request(f"http://{host}/json/state", method="POST",
                               payload={"on": True, "seg": [{"id": i, "on": True, "col": [rgb], "fx": 0}
                                                            for i in range(RINGS)]}))


def reset():
    """Restore default settings. Useful for tests."""
    _save_settings(_DEFAULT_SETTINGS)
    return get_settings()
