"""Version 1 colour-checker messages. No sensor driver is inferred here.

Bindings survive restart; readings deliberately do not. A companion must send a new
sample after restart, reassignment or replacement before anything can be current.
A colour comes from the companion's own claim, or from this sensor's white reference
(sensor_calibration.py) when the companion sent raw counts only.
"""

import copy
import math
import os
import re
import threading
import time

import mock_moonraker
import sensor_calibration
import storage

_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, "colour_sensors.json")
_lock = threading.RLock()
_readings = {}
_unassigned = {}   # {printer_id: {identity tuple: what a sensor that is not assigned yet last sent}}
_commands = {}     # {printer_id: {toolhead: the latest command for that head's sensor}}
_command_ids = [0]
VERSION = 1
MAX_AGE_S = 30
MAX_FUTURE_S = 2
MIN_CONFIDENCE = 0.8
UNASSIGNED_TTL_S = 600     # a sensor that is not assigned is listed this long after its last message
MAX_UNASSIGNED = 8
COMMAND_TTL_S = 120        # a command nobody picked up in this long is dropped
GAINS = (0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512)
MAX_LED_MA = 20            # the same conservative limit as the firmware: the board's LED limit is not published
COMMANDS = ("set", "autogain", "new_sensor")
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


def _settings(value):
    """How the companion had the sensor set (gain, light, integration): up to 16 named numbers or true/false."""
    if value is None:
        return None
    if not isinstance(value, dict) or len(value) > 16:
        raise ValueError("settings must be up to 16 named numbers or true/false values")
    clean = {}
    for key, item in value.items():
        key = _identifier(key, "settings name")
        clean[key] = item if isinstance(item, bool) else _number(item, "settings value", -10 ** 9, 10 ** 9)
    return clean


def _small(value, name, text=False):
    """A short list of named facts: up to 8 numbers, true/false and (when `text`) short plain strings."""
    if value is None:
        return None
    if not isinstance(value, dict) or len(value) > 8:
        raise ValueError(f"{name} must be up to 8 named values")
    clean = {}
    for key, item in value.items():
        key = _identifier(key, f"{name} name")
        if isinstance(item, bool):
            clean[key] = item
        elif text and isinstance(item, str):
            if len(item) > 200 or not all(32 <= ord(ch) < 127 for ch in item):
                raise ValueError(f"{name} text must be plain and under 200 characters")
            clean[key] = item
        else:
            clean[key] = _number(item, f"{name} value", -10 ** 9, 10 ** 9)
    return clean


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
        # A replaced chip, a moved channel or a removed assignment must not keep an old white reference.
        sensor_calibration.reconcile(saved)
        for removed in set(_readings) - set(saved):
            _readings.pop(removed, None)
        # Even changing back to the same mapping requires a new observation.
        _readings.pop(pid, None)
        listed = _unassigned.get(pid, {})
        for key in [k for k in listed if (k[0], k[1]) in channels]:
            del listed[key]
        _commands.pop(pid, None)
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
    settings = _settings(body.get("settings"))
    info = _small(body.get("info"), "info", text=True)
    result = _small(body.get("command_result"), "command_result", text=True)
    reading = {**identity, "captured_at": captured, "received_at": received,
               "raw": raw, "calibrated": calibrated, "quality_flags": flags, "settings": settings, "info": info}
    with _lock:
        binding = next((b for b in _bindings().get(pid, []) if
                        all(b[key] == value for key, value in identity.items())), None)
        if not binding:
            _note_unassigned(pid, identity, reading)
            raise ValueError("This sensor is not assigned to this printer; check its hub, channel and sensor IDs")
        head = binding["toolhead"]
        if reading["calibrated"] is None:
            # No colour from the companion: use this sensor's own white reference, if it has one.
            reading["calibrated"] = sensor_calibration.apply(pid, head, identity, raw, settings)
        previous = _readings.get(pid, {}).get(head)
        if previous and captured <= previous["reading"]["captured_at"]:
            raise ValueError("This reading is repeated or older than the last one; send a new measurement")
        _readings.setdefault(pid, {})[head] = {"reading": reading, "monotonic": time.monotonic()}
        _unassigned.get(pid, {}).pop(tuple(identity[k] for k in ("device_id", "channel_id", "sensor_id",
                                                                   "sensor_model")), None)
        pending = _deliver(pid, head, result)
        return {"accepted": True, "version": VERSION, "printer_id": pid, "toolhead": head,
                "server_time": int(time.time()), "commands": pending,
                "sensor": _view(binding, _readings[pid][head])}


def _note_unassigned(pid, identity, reading):
    """Remember a sensor that is not assigned yet, so the app can offer it for a head."""
    key = tuple(identity[k] for k in ("device_id", "channel_id", "sensor_id", "sensor_model"))
    listed = _unassigned.setdefault(pid, {})
    now = time.monotonic()
    for stale in [k for k, v in listed.items() if now - v["monotonic"] > UNASSIGNED_TTL_S]:
        del listed[stale]
    if key not in listed and len(listed) >= MAX_UNASSIGNED:
        return
    listed[key] = {"monotonic": now, "identity": dict(identity), "info": reading["info"],
                   "settings": reading["settings"], "quality_flags": reading["quality_flags"]}


def _unassigned_view(pid):
    now = time.monotonic()
    rows = []
    for value in _unassigned.get(pid, {}).values():
        age = now - value["monotonic"]
        if age <= UNASSIGNED_TTL_S:
            rows.append({**value["identity"], "age_s": round(age, 1), "info": value["info"],
                         "settings": value["settings"], "quality_flags": value["quality_flags"]})
    return sorted(rows, key=lambda row: row["age_s"])


# -- commands to a sensor (carried in the reply to its next message) -----------------------------------------

def _command_args(name, body):
    if name == "set":
        args = {}
        if "gain" in body:
            if isinstance(body["gain"], bool) or body["gain"] not in GAINS:
                raise ValueError("gain must be one of " + ", ".join(str(g) for g in GAINS))
            args["gain"] = body["gain"]
        if "led_ma" in body:
            value = body["led_ma"]
            if isinstance(value, bool) or not isinstance(value, int) or not 4 <= value <= MAX_LED_MA:
                raise ValueError(f"led_ma must be a whole number from 4 to {MAX_LED_MA}")
            args["led_ma"] = value
        if "led" in body:
            if not isinstance(body["led"], bool):
                raise ValueError("led must be true or false")
            args["led"] = body["led"]
        if not args:
            raise ValueError("Say what to set: gain, led_ma or led")
        return args
    return {}


def queue_command(body):
    """Queue one command for a head's sensor. It reaches the sensor in the reply to its next reading."""
    if not isinstance(body, dict):
        raise ValueError("Send a command as a JSON object")
    pid = _printer()
    head = body.get("toolhead")
    name = body.get("cmd")
    if head not in ("T0", "T1", "T2", "T3"):
        raise ValueError("Choose a head from T0 to T3")
    if name not in COMMANDS:
        raise ValueError("Unknown command. Choose one of: " + ", ".join(COMMANDS))
    args = _command_args(name, body)
    with _lock:
        if not any(b["toolhead"] == head for b in _bindings().get(pid, [])):
            raise ValueError(f"No colour sensor is assigned to head {head}")
        _command_ids[0] += 1
        entry = {"id": _command_ids[0], "cmd": name, "args": args, "state": "waiting",
                 "message": "Waiting for the sensor's next reading to carry it.", "monotonic": time.monotonic()}
        _commands.setdefault(pid, {})[head] = entry
        return _command_view(entry)


def _command_view(entry):
    if entry is None:
        return None
    state, message = entry["state"], entry["message"]
    if state in ("waiting", "sent") and time.monotonic() - entry["monotonic"] > COMMAND_TTL_S:
        state, message = "expired", "The sensor did not answer in time. Check that it is powered and on Wi-Fi."
    return {"id": entry["id"], "cmd": entry["cmd"], "state": state, "message": message,
            "result": entry.get("result")}


def _deliver(pid, head, result):
    """Record a command's result from this message and hand over a waiting command, once."""
    entry = _commands.get(pid, {}).get(head)
    if not entry:
        return []
    if result and result.get("id") == entry["id"]:
        entry["state"] = "done" if result.get("ok") else "failed"
        entry["message"] = str(result.get("message") or ("Done." if result.get("ok") else "The sensor refused it."))
        entry["result"] = result
        return []
    if entry["state"] == "waiting" and time.monotonic() - entry["monotonic"] <= COMMAND_TTL_S:
        entry["state"] = "sent"
        entry["message"] = "Sent to the sensor. Waiting for its answer."
        return [{"id": entry["id"], "cmd": entry["cmd"], **entry["args"]}]
    return []


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
        sensors = []
        for b in bindings:
            view = _view(b, _readings.get(pid, {}).get(b["toolhead"]))
            latest = view["reading"].get("settings") if view.get("reading") else False
            view["calibration"] = sensor_calibration.head_status(pid, b, latest)
            if view["status"] == "uncalibrated" and view["calibration"]["state"] == "settings_changed":
                view["message"] = view["calibration"]["message"]
            view["command"] = _command_view(_commands.get(pid, {}).get(b["toolhead"]))
            sensors.append(view)
        # server_time lets a sensor that has no clock of its own line up with this computer's. A whole number of
        # seconds: a CircuitPython float cannot hold a Unix time to better than minutes.
        return {"version": VERSION, "printer_id": pid, "simulated": not mock_moonraker.is_real(pid),
                "max_age_s": MAX_AGE_S, "server_time": int(time.time()), "sensors": sensors,
                "unassigned": _unassigned_view(pid) if mock_moonraker.is_real(pid) else []}


def read(toolhead):
    return next((sensor for sensor in status()["sensors"] if sensor["toolhead"] == toolhead), None)
