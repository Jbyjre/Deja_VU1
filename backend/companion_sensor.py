"""Version 1 colour-checker messages. No sensor driver or calibration is inferred here.

Bindings survive restart; readings deliberately do not. A companion must send a new
sample after restart, reassignment or replacement before anything can be current.
"""

import copy
import math
import os
import re
import threading
import time

import mock_moonraker
import storage

_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, "colour_sensors.json")
_lock = threading.RLock()
_readings = {}
VERSION = 1
MAX_AGE_S = 30
MAX_FUTURE_S = 2
MIN_CONFIDENCE = 0.8
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}\Z")
_HEX = re.compile(r"#[0-9a-fA-F]{6}\Z")


def _identifier(value, field):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError(f"{field} must be 1 to 64 letters, digits, dots, colons, hyphens or underscores")
    return value


def _number(value, field, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a finite number")
    if not low <= value <= high or not math.isfinite(value):
        raise ValueError(f"{field} must be between {low} and {high}")
    return value


def _version(body):
    if not isinstance(body, dict) or type(body.get("version")) is not int or body["version"] != VERSION:
        raise ValueError("This colour checker needs message version 1")
    if body.get("simulated") is not False:
        raise ValueError("A physical colour-checker message must declare simulated: false")


def _printer():
    pid = mock_moonraker.selected_printer_id()
    if not mock_moonraker.is_real(pid):
        raise ValueError("Select an added printer; physical sensors cannot be assigned to demo printers")
    return pid


def _bindings():
    return storage.load_json(_PATH, {})


def configure(body):
    """Replace this printer's explicitly assigned channels, at most one per U1 head."""
    import fleet

    _version(body)
    pid = _printer()
    rows = body.get("bindings")
    if not isinstance(rows, list) or len(rows) > 4:
        raise ValueError("Supply up to four colour-sensor bindings")
    bindings, heads, channels = [], set(), set()
    for row in rows:
        if not isinstance(row, dict) or row.get("toolhead") not in ("T0", "T1", "T2", "T3"):
            raise ValueError("Each sensor binding needs a head from T0 to T3")
        clean = {key: _identifier(row.get(key), key) for key in
                 ("device_id", "channel_id", "sensor_id", "sensor_model")}
        head = clean["toolhead"] = row["toolhead"]
        channel = (clean["device_id"], clean["channel_id"])
        if head in heads or channel in channels:
            raise ValueError("A head and a sensor channel can each appear only once")
        heads.add(head)
        channels.add(channel)
        bindings.append(clean)
    with _lock:
        registered = {p["id"] for p in fleet.registered()}
        saved = {other: assigned for other, assigned in _bindings().items()
                 if other == pid or other in registered or mock_moonraker.is_real(other)}
        for other, assigned in saved.items():
            if other != pid and any((b["device_id"], b["channel_id"]) in channels for b in assigned):
                raise ValueError("That sensor channel is assigned to another printer; disconnect it there first")
        saved[pid] = bindings
        storage.save_json(_PATH, saved)
        for removed in set(_readings) - set(saved):
            _readings.pop(removed, None)
        # Even changing back to the same mapping requires a new observation.
        _readings.pop(pid, None)
        return status()


def ingest(body):
    """Accept one observation only for an explicitly bound physical sensor identity."""
    _version(body)
    pid = _printer()
    identity = {key: _identifier(body.get(key), key) for key in
                ("device_id", "channel_id", "sensor_id", "sensor_model")}
    captured = _number(body.get("captured_at"), "captured_at", 0, 10 ** 12)
    received = time.time()
    if captured > received + MAX_FUTURE_S:
        raise ValueError("The sensor's clock is ahead of this computer; synchronise its clock and send a new reading")
    raw = body.get("raw")
    if not isinstance(raw, dict) or not 1 <= len(raw) <= 16:
        raise ValueError("A reading needs 1 to 16 named raw sensor values")
    raw = {_identifier(key, "raw channel"): _number(value, "raw value", 0, 10 ** 9)
           for key, value in raw.items()}
    flags = body.get("quality_flags")
    if not isinstance(flags, list) or len(flags) > 16:
        raise ValueError("quality_flags must be a list of up to 16 flags, empty for a clear reading")
    flags = list(dict.fromkeys(_identifier(flag, "quality flag") for flag in flags))
    calibrated = body.get("calibrated")
    if calibrated is not None:
        if not isinstance(calibrated, dict) or not isinstance(calibrated.get("hex"), str) or \
                not _HEX.fullmatch(calibrated["hex"]):
            raise ValueError("A calibrated reading needs a six-digit hex colour")
        calibrated = {
            "hex": calibrated["hex"].lower(),
            "calibration_id": _identifier(calibrated.get("calibration_id"), "calibration_id"),
            "confidence": _number(calibrated.get("confidence"), "confidence", 0, 1),
        }
    reading = {**identity, "captured_at": captured, "received_at": received,
               "raw": raw, "calibrated": calibrated, "quality_flags": flags}
    with _lock:
        binding = next((b for b in _bindings().get(pid, []) if
                        all(b[key] == value for key, value in identity.items())), None)
        if not binding:
            raise ValueError("This sensor is not assigned to this printer; check its hub, channel and sensor IDs")
        head = binding["toolhead"]
        previous = _readings.get(pid, {}).get(head)
        if previous and captured <= previous["reading"]["captured_at"]:
            raise ValueError("This reading is repeated or older than the last one; send a new measurement")
        _readings.setdefault(pid, {})[head] = {"reading": reading, "monotonic": time.monotonic()}
        return {"accepted": True, "version": VERSION, "printer_id": pid, "toolhead": head,
                "sensor": _view(binding, _readings[pid][head])}


def _view(binding, entry):
    result = {**binding, "status": "no_reading", "age_s": None, "detected_hex": None,
              "simulated": False, "message": "No reading received. Check the colour checker's power and connection."}
    if not entry or any(entry["reading"][key] != binding[key] for key in
                        ("device_id", "channel_id", "sensor_id", "sensor_model")):
        return result
    reading = entry["reading"]
    # The capture clock prevents delayed/replayed samples becoming new. The monotonic
    # clock also expires a sample if the computer's wall clock is put back.
    age = max(0, time.time() - reading["captured_at"],
              time.monotonic() - entry["monotonic"] + max(0, reading["received_at"] - reading["captured_at"]))
    result.update({"reading": copy.deepcopy(reading), "age_s": round(age, 1)})
    calibrated = reading["calibrated"]
    if age >= MAX_AGE_S:
        result.update(status="stale", message="This reading is old. Check the colour checker's power and connection.")
    elif reading["quality_flags"]:
        result.update(status="unreadable", message="Couldn't read this sample. Check the light and filament position.")
    elif calibrated is None:
        result.update(status="uncalibrated", message="Raw readings received. A calibrated colour is not available.")
    elif calibrated["confidence"] < MIN_CONFIDENCE:
        result.update(status="low_confidence", message="Couldn't read this colour with enough confidence. Try another sample.")
    else:
        result.update(status="reading", detected_hex=calibrated["hex"],
                      message="Colour reported by the sensor. It does not confirm the material or approve a print.")
    return result


def status():
    pid = mock_moonraker.selected_printer_id()
    with _lock:
        bindings = _bindings().get(pid, []) if mock_moonraker.is_real(pid) else []
        return {"version": VERSION, "printer_id": pid, "simulated": not mock_moonraker.is_real(pid),
                "max_age_s": MAX_AGE_S,
                "sensors": [_view(b, _readings.get(pid, {}).get(b["toolhead"])) for b in bindings]}


def read(toolhead):
    return next((sensor for sensor in status()["sensors"] if sensor["toolhead"] == toolhead), None)
