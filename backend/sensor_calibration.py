"""
sensor_calibration.py
=====================

Turns a companion's raw channel counts into a colour, from references the owner records in the sensor's
own housing. The companion (a Pico W) only has to send raw counts; the calibration lives here, versioned
by what was recorded, so replacing or moving a sensor can never reuse an old one.

What a calibration is
---------------------
* A white reference: the counts the sensor reads from a white target in the housing, with its light on.
* An optional dark reference: the counts with nothing in front of the sensor (removes the sensor's offset).
* Each later sample is divided channel by channel by the white reference (after removing the dark one), which
  gives how much of the light that channel's band came back from the sample. A flat 100 % is the white target.

From reflectance to a colour
----------------------------
* TCS34725 (red, green, blue, clear): the three ratios are the colour's linear red, green and blue.
* AS7341 (eight visible bands, 415 to 680 nm): the eight ratios are joined into a spectrum, weighted by a
  daylight-like light and the eye's colour-matching curves, and converted to sRGB. The curves are the
  multi-lobe fit in Table 1 of Wyman, Sloan and Shirley, "Simple Analytic Approximations to the CIE XYZ Color
  Matching Functions", Journal of Computer Graphics Techniques 2(2), 2013. The white reference maps to white.

What this does not do
---------------------
It does not measure accuracy: that needs bench readings on known colours. The confidence values below are a
display policy (as in companion_sensor.py), not a measurement. A colour does not identify a material.
"""

import hashlib
import json
import math
import os
import threading
import time

import storage

_DATA_DIR = storage.DATA_DIR
_PATH = os.path.join(_DATA_DIR, "colour_calibrations.json")
_lock = threading.RLock()

IDENTITY = ("device_id", "channel_id", "sensor_id", "sensor_model")
STEPS = ("white", "dark", "clear")
HIGH_CONFIDENCE = 0.9
LOW_CONFIDENCE = 0.5          # below companion_sensor.MIN_CONFIDENCE: shown as "low confidence"
ABOVE_WHITE = 1.3             # a sample this much brighter than the white target means the set-up moved

# Centre wavelength in nm of the AS7341's eight visible channels (ams datasheet; clear and NIR are not used).
AS7341_BANDS = (("f1", 415), ("f2", 445), ("f3", 480), ("f4", 515),
                ("f5", 555), ("f6", 590), ("f7", 630), ("f8", 680))
RGB_CHANNELS = ("r", "g", "b")
MODELS = {"AS7341": "spectral", "TCS34725": "rgb"}

_D65_WHITE = (0.95047, 1.0, 1.08883)
_XYZ_TO_RGB = ((3.2404542, -1.5371385, -0.4985314),
               (-0.9692660, 1.8760108, 0.0415560),
               (0.0556434, -0.2040259, 1.0572252))


def _lobe(wave, centre, below, above):
    t = (wave - centre) * (below if wave < centre else above)
    return math.exp(-0.5 * t * t)


def _cmf(wave):
    """CIE 1931 x, y, z at one wavelength: the multi-lobe fit, Table 1 of the paper named above."""
    x = (0.362 * _lobe(wave, 442.0, 0.0624, 0.0374) + 1.056 * _lobe(wave, 599.8, 0.0264, 0.0323)
         - 0.065 * _lobe(wave, 501.1, 0.0490, 0.0382))
    y = 0.821 * _lobe(wave, 568.8, 0.0213, 0.0247) + 0.286 * _lobe(wave, 530.9, 0.0613, 0.0322)
    z = 1.217 * _lobe(wave, 437.0, 0.0845, 0.0278) + 0.681 * _lobe(wave, 459.0, 0.0385, 0.0725)
    return x, y, z


def _daylight(wave):
    """A 6504 K black body: close to daylight in shape. The white reference removes what is left."""
    metres = wave * 1e-9
    return metres ** -5 / (math.exp(1.4388e-2 / (metres * 6504.0)) - 1.0)


_WAVES = tuple(range(400, 705, 5))
_WEIGHTS = []
for _w in _WAVES:
    _x, _y, _z = _cmf(_w)
    _light = _daylight(_w)
    _WEIGHTS.append((_light * _x, _light * _y, _light * _z))
_SCALE = sum(w[1] for w in _WEIGHTS)
_WHITE_XYZ = tuple(sum(w[i] for w in _WEIGHTS) / _SCALE for i in range(3))


def _srgb_byte(linear):
    linear = min(1.0, max(0.0, linear))
    value = 12.92 * linear if linear <= 0.0031308 else 1.055 * linear ** (1 / 2.4) - 0.055
    return int(round(255 * min(1.0, max(0.0, value))))


def _hex(linear_rgb):
    return "#{:02x}{:02x}{:02x}".format(*(_srgb_byte(v) for v in linear_rgb))


def _spectrum_to_linear_rgb(reflectance):
    """Eight band ratios to linear sRGB. A flat ratio of 1 gives white; a flat 0.5 gives mid grey."""
    centres = [wave for _, wave in AS7341_BANDS]
    xyz = [0.0, 0.0, 0.0]
    for wave, weight in zip(_WAVES, _WEIGHTS):
        if wave <= centres[0]:
            ratio = reflectance[0]
        elif wave >= centres[-1]:
            ratio = reflectance[-1]
        else:
            i = max(k for k in range(len(centres) - 1) if centres[k] <= wave)
            span = (wave - centres[i]) / float(centres[i + 1] - centres[i])
            ratio = reflectance[i] + span * (reflectance[i + 1] - reflectance[i])
        for axis in range(3):
            xyz[axis] += ratio * weight[axis] / _SCALE
    # Scale so the white target lands exactly on the sRGB white point.
    xyz = [xyz[axis] * _D65_WHITE[axis] / _WHITE_XYZ[axis] for axis in range(3)]
    return [sum(_XYZ_TO_RGB[row][axis] * xyz[axis] for axis in range(3)) for row in range(3)]


def _norm(values):
    return {str(name).lower(): float(number) for name, number in (values or {}).items()}


def _kind(model):
    kind = MODELS.get(str(model).upper())
    if kind is None:
        raise ValueError("This calibration covers the AS7341 and the TCS34725. "
                         "Another sensor has to report its own colour")
    return kind


def _names(kind):
    return [name for name, _ in AS7341_BANDS] if kind == "spectral" else list(RGB_CHANNELS)


def colour_from(model, white, dark, raw):
    """
    The colour of one sample against its references: returns (hex, flags).
    Raises ValueError, in words, for a missing channel or a white reference that is not brighter than the dark one.
    """
    kind = _kind(model)
    names = _names(kind)
    white, dark, raw = _norm(white), _norm(dark), _norm(raw)
    missing = [name for name in names if name not in raw or name not in white]
    if missing:
        raise ValueError("The sensor's raw values are missing channels: " + ", ".join(missing))
    ratio = []
    for name in names:
        floor = dark.get(name, 0.0)
        span = white[name] - floor
        if span <= 0:
            raise ValueError(f"The white reference is not brighter than the dark one on {name}. "
                             "Check the sensor's light and put the white target in the housing")
        ratio.append(max(0.0, (raw[name] - floor) / span))
    flags = []
    if max(ratio) > ABOVE_WHITE:
        flags.append("above_white")
        ratio = [min(value, ABOVE_WHITE) for value in ratio]
    ratio = [min(1.0, value) for value in ratio]
    linear = ratio if kind == "rgb" else _spectrum_to_linear_rgb(ratio)
    return _hex(linear), flags


def _calibration_id(entry):
    body = json.dumps({key: entry.get(key) for key in ("identity", "white", "dark")}, sort_keys=True)
    return "dv1-" + hashlib.sha1(body.encode("utf-8")).hexdigest()[:8]


def _load():
    return storage.load_json(_PATH, {})


def _entry_for(data, printer_id, toolhead, identity):
    entry = (data.get(printer_id) or {}).get(toolhead)
    if entry and all(entry["identity"].get(key) == identity.get(key) for key in IDENTITY):
        return entry
    return None


def head_status(printer_id, binding):
    """Where this head's calibration stands, in words a person can act on."""
    identity = {key: binding[key] for key in IDENTITY}
    if str(identity["sensor_model"]).upper() not in MODELS:
        return {"state": "unsupported", "supported": False, "has_white": False, "has_dark": False, "id": None,
                "message": "Deja Vu1 calibrates the AS7341 and the TCS34725. This sensor has to report its own colour."}
    with _lock:
        entry = _entry_for(_load(), printer_id, binding["toolhead"], identity)
    if not entry or not entry.get("white"):
        had_dark = bool(entry and entry.get("dark"))
        return {"state": "needs_white" if had_dark else "none", "supported": True, "id": None,
                "has_white": False, "has_dark": had_dark, "updated_at": entry and entry.get("updated_at"),
                "message": "Put the white target in the housing, wait for a reading, then record the white reference."}
    return {"state": "ready", "supported": True, "id": _calibration_id(entry), "has_white": True,
            "has_dark": bool(entry.get("dark")), "updated_at": entry.get("updated_at"),
            "message": "Calibrated against a white reference" +
                       ("" if entry.get("dark") else ". A dark reference is optional; it improves dark colours")}


def record_reference(printer_id, toolhead, identity, step, raw, captured_at):
    """Keep one reference for a head's sensor, or clear them all (step "clear"). Returns the head's status."""
    if step not in STEPS:
        raise ValueError("Choose white, dark or clear")
    binding = dict(identity, toolhead=toolhead)
    kind = _kind(identity["sensor_model"])
    with _lock:
        data = _load()
        if step == "clear":
            (data.get(printer_id) or {}).pop(toolhead, None)
            if printer_id in data and not data[printer_id]:
                del data[printer_id]
            storage.save_json(_PATH, data)
            return head_status(printer_id, binding)
        values = _norm(raw)
        missing = [name for name in _names(kind) if name not in values]
        if missing:
            raise ValueError("The sensor's raw values are missing channels: " + ", ".join(missing))
        entry = _entry_for(data, printer_id, toolhead, identity) or {
            "identity": {key: identity[key] for key in IDENTITY}, "white": None, "dark": None}
        entry[step] = {"raw": values, "captured_at": captured_at}
        entry["updated_at"] = time.time()
        if entry["white"]:
            colour_from(identity["sensor_model"], entry["white"]["raw"], (entry["dark"] or {}).get("raw"),
                        entry["white"]["raw"])
        data.setdefault(printer_id, {})[toolhead] = entry
        storage.save_json(_PATH, data)
    return head_status(printer_id, binding)


def apply(printer_id, toolhead, identity, raw):
    """A calibrated colour for a sample, or None when this exact sensor has no white reference."""
    with _lock:
        entry = _entry_for(_load(), printer_id, toolhead, identity)
    if not entry or not entry.get("white"):
        return None
    try:
        colour, flags = colour_from(identity["sensor_model"], entry["white"]["raw"], (entry["dark"] or {}).get("raw"),
                                    raw)
    except ValueError:
        return None
    return {"hex": colour, "calibration_id": _calibration_id(entry),
            "confidence": LOW_CONFIDENCE if flags else HIGH_CONFIDENCE, "source": "deja-vu1", "flags": flags}


def reconcile(assigned):
    """
    Drop every calibration whose sensor is no longer assigned to that head exactly as it was: a replaced chip,
    a moved channel, a removed assignment or a deleted printer. `assigned` is {printer_id: [bindings]}.
    """
    with _lock:
        data = _load()
        changed = False
        for printer_id in list(data):
            heads = {row["toolhead"]: row for row in assigned.get(printer_id, [])}
            for toolhead in list(data[printer_id]):
                row = heads.get(toolhead)
                saved = data[printer_id][toolhead]["identity"]
                if row is None or any(row.get(key) != saved.get(key) for key in IDENTITY):
                    del data[printer_id][toolhead]
                    changed = True
            if not data[printer_id]:
                del data[printer_id]
                changed = True
        if changed:
            storage.save_json(_PATH, data)
