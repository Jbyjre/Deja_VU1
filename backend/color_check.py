"""
color_check.py
==============

MODULE 3 - "Right Color Loaded?" Checker.
Receives versioned companion readings; sensor drivers and calibration remain separate.

The plan
--------
A multi-toolhead printer makes it easy to load the wrong spool. You start a
two-color print, walk away, and come back to find the logo printed in grey
instead of orange. Confirm Print (print_gate.py) already refuses a file whose
colours don't match what the printer reports, but a spool without an RFID tag
and with no colour typed on the printer's screen reports no colour, so it can
only say "check it by eye".

This module will read an optical colour sensor with its own white LED, in a
dark printed block at each of the U1's rear filament inlets. Two candidates
are to be tested side by side on real spools: the TCS34725 (RGB + clear, I2C
0x29) and the AS7341 (8 visible channels + clear + near-infrared, I2C 0x39).
A TCA9548A multiplexer (0x70) lets four identical sensors share one bus, and a
Raspberry Pi Pico W sends the readings to Deja Vu1 over Wi-Fi.

Planned behaviour: check when filament is loaded and at Confirm Print, never
mid-print; stay quiet when the readings agree; a sensor mismatch is a warning
with a one-click accept until real tests prove the sensor accurate; a
low-confidence reading says "couldn't read". Tagged Snapmaker spools, whose
colours the printer reports, are the reference colours for those tests.

What is here today
------------------
The comparison logic runs in the demo. Real-printer reads use explicitly
assigned companion sensors through companion_sensor.py. Missing, old,
uncalibrated and low-quality readings never become a matching colour.
Calibration (sensor_calibration.py) turns raw counts into a colour from a white
reference recorded in the housing. Confirm Print shows what the sensor reads next
to the file's colour and the printer's report, as advice that never blocks a start.

Why no driver code yet
----------------------
The sensor talks I2C, and the U1's sealed Rockchip SoC exposes no GPIO or I2C
pins. The sensor hangs off the external Pico W, never the printer's board. No
sensor driver or physical accuracy claim is included here. See docs/hardware-modules.md, Module 3.
"""

import os
import random
import re
import socket
import threading
import time

import mock_moonraker
import companion_sensor
import sensor_calibration
import storage
from mock_moonraker import get_current_job_requirements, get_printer_state

_DATA_DIR = storage.DATA_DIR
_OVERRIDES_PATH = os.path.join(_DATA_DIR, "colour_overrides.json")
_overrides_lock = threading.Lock()
MAX_OVERRIDES = 200

# Same fixed seed idea as the mock printer: consistent demos.
_RNG = random.Random(4242)

# How far apart two colors can be and still count as "the same color".
# Measured as straight-line distance in RGB space, where 0 is identical and
# about 441 is the maximum possible (black vs white).
#   under 40  -> confident match
#   40 to 90  -> close, warn the user but do not block
#   over 90   -> mismatch
MATCH_TOLERANCE = 40
WARN_TOLERANCE = 90

# DEMO SETTING - has no effect once real hardware is connected.
# With no sensor attached, every reading would otherwise come back as a
# perfect match, so the dashboard would only ever show green ticks and the
# mismatch warning would never be visible. Listing a toolhead here makes the
# simulation report the wrong spool for it, so a demo shows both outcomes.
DEMO_MISMATCH_TOOLHEADS = {"T1"}

# A reference reading must be this fresh, so the white target is already in the housing when it is taken.
REFERENCE_MAX_AGE_S = 5


def _hex_to_rgb(value):
    """Turn a '#rrggbb' string into an (r, g, b) tuple of numbers."""
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def _rgb_to_hex(rgb):
    """Turn an (r, g, b) tuple back into a '#rrggbb' string."""
    return "#{:02x}{:02x}{:02x}".format(*(int(c) for c in rgb))


def color_distance(hex_a, hex_b):
    """
    Measure how different two colors are.

    Straight-line (Euclidean) distance between the two colors treated as
    points in RGB space. Simple, fast, and good enough to tell orange from
    grey - which is the actual job here. If real sensor testing shows it is
    too crude, this can move to the CIE Lab color space later without
    changing anything that calls it.

    Returns a number: 0 means identical, larger means more different.
    """
    a = _hex_to_rgb(hex_a)
    b = _hex_to_rgb(hex_b)
    return round(sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5, 1)


def compare(expected_hex, detected_hex):
    """
    Decide whether a detected color matches the expected one.

    This is the real logic and it works today. Returns the verdict, the
    measured distance, and a plain-language message for the dashboard.
    """
    distance = color_distance(expected_hex, detected_hex)

    if distance <= MATCH_TOLERANCE:
        verdict, message = "match", "Loaded filament matches the print file."
    elif distance <= WARN_TOLERANCE:
        verdict, message = "close", "Close, but not an exact match. Check before printing."
    else:
        verdict, message = "mismatch", "Wrong color loaded. This will not look right."

    return {
        "verdict": verdict,
        "distance": distance,
        "message": message,
        "expected_hex": expected_hex,
        "detected_hex": detected_hex,
    }


# ---------------------------------------------------------------------------
# Sensor interface - deliberately not implemented yet
# ---------------------------------------------------------------------------

def connect_sensor(toolhead_id):
    """
    Reports whether an explicitly assigned sensor has a recent observation.
    The companion owns I2C and the sensor's gain and integration time.
    Missing hardware must never cause a real printer to fall back to simulation.
    """
    if not mock_moonraker.is_real(mock_moonraker.selected_printer_id()):
        return False
    reading = companion_sensor.read(toolhead_id)
    return bool(reading and reading["age_s"] is not None and reading["age_s"] < companion_sensor.MAX_AGE_S)


def calibrate(toolhead_id, step="white"):
    """
    Record one reference for a head's sensor from its latest reading: the white
    target ("white"), the empty housing ("dark"), or forget both ("clear").

    Optical sensors read differently with the light and the distance to the
    filament. The dark housing fixes both; the white reference is what turns
    later raw counts into a colour (sensor_calibration.py). The reading used
    must be a few seconds old at most, so the target is already in place.
    """
    pid = mock_moonraker.selected_printer_id()
    if not mock_moonraker.is_real(pid):
        raise ValueError("Calibration needs an added printer with a physical sensor; demo printers have none")
    sensor = companion_sensor.read(toolhead_id)
    if sensor is None:
        raise ValueError(f"No colour sensor is assigned to head {toolhead_id}")
    identity = {key: sensor[key] for key in sensor_calibration.IDENTITY}
    if step == "clear":
        return sensor_calibration.record_reference(pid, toolhead_id, identity, "clear", None, None)
    reading = sensor.get("reading")
    if not reading or sensor["age_s"] is None or sensor["age_s"] > REFERENCE_MAX_AGE_S:
        raise ValueError(f"Wait for a new reading from {toolhead_id}'s sensor (under {REFERENCE_MAX_AGE_S} seconds "
                         "old), then try again")
    # An empty housing is dim on purpose, so "low_light" does not refuse a dark reference.
    blocking = [flag for flag in reading["quality_flags"] if not (step == "dark" and flag == "low_light")]
    if blocking:
        raise ValueError("The sensor flagged this sample (" + ", ".join(blocking) +
                         "). Fix the light or the target's position, then try again")
    return sensor_calibration.record_reference(pid, toolhead_id, identity, step, reading["raw"],
                                               reading["captured_at"], reading.get("settings"))


def connection_info(port):
    """
    What a colour checker on Wi-Fi needs to know to reach this app: the computer's home-network addresses and port,
    the selected printer's id and whether the device lock is on. Local to this computer; never part of the demo.
    """
    import discovery
    import pairing

    name = socket.gethostname()
    pid = mock_moonraker.selected_printer_id()
    return {"printer_id": pid, "physical": mock_moonraker.is_real(pid), "port": port,
            "addresses": [f"{address}:{port}" for address in discovery.home_addresses()],
            "name": f"{name}.local:{port}" if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,62}", name or "") else None,
            "device_lock": pairing.lock_enabled()}


def read_sensor(toolhead_id):
    """
    Read the color currently in a toolhead's filament path.

    For a real printer, returns the assigned sensor's current status, never a
    simulated value. For demo printers, this returns the color the mock
    printer says is loaded, then adds a small random wobble so the numbers
    look like a real measurement rather than a perfect copy. For toolheads
    listed in DEMO_MISMATCH_TOOLHEADS it deliberately reports the wrong spool,
    so the mismatch warning is visible in a demo instead of only green ticks.

    No calibrated value is derived from raw channels here.
    """
    if mock_moonraker.is_real(mock_moonraker.selected_printer_id()):
        return companion_sensor.read(toolhead_id) or {
            "toolhead": toolhead_id, "status": "no_sensor", "simulated": False, "detected_hex": None,
            "message": "No colour sensor is assigned to this head.",
        }
    printer = get_printer_state()
    loaded = printer["toolheads"].get(toolhead_id, {})
    base_hex = loaded.get("filament_color_hex", "#808080")

    # Demo only: pretend the user grabbed the wrong spool for this toolhead.
    if toolhead_id in DEMO_MISMATCH_TOOLHEADS:
        base_hex = "#f2f2f0"      # white loaded where black was expected

    # Add sensor noise: a few points of drift on each channel.
    r, g, b = _hex_to_rgb(base_hex)
    noisy = tuple(
        max(0, min(255, channel + _RNG.randint(-12, 12)))
        for channel in (r, g, b)
    )

    return {
        "toolhead": toolhead_id,
        "detected_hex": _rgb_to_hex(noisy),
        "simulated": True,
        "confidence": round(_RNG.uniform(0.82, 0.99), 2),
    }


# ---------------------------------------------------------------------------
# Confirm Print: the sensor's view, beside the file's colour and the printer's report
# ---------------------------------------------------------------------------

def evidence(toolhead_id, state, expected_hex):
    """
    What the colour sensor says about one head, for Confirm Print. Advice only: it is shown next to the file's
    colour and the printer's own report, and it never blocks a start.

    Returns None when this head has no sensor, so there is nothing to say. Demo printers get a labelled
    simulation with no randomness, so the same file always shows the same thing.
    """
    if mock_moonraker.is_real(mock_moonraker.selected_printer_id()):
        sensor = companion_sensor.read(toolhead_id)
        if sensor is None:
            return None
        item = {"status": sensor["status"], "age_s": sensor["age_s"], "message": sensor["message"],
                "simulated": False, "hex": None}
        if sensor["status"] == "reading":
            calibrated = sensor["reading"]["calibrated"]
            item.update(hex=sensor["detected_hex"], calibration_id=calibrated["calibration_id"],
                        source=calibrated.get("source", "companion"))
    else:
        loaded = (state.get("toolheads") or {}).get(toolhead_id) or {}
        if not loaded.get("filament_color_hex"):
            return None
        item = {"status": "reading", "age_s": 0, "message": "Simulated reading.", "simulated": True,
                "hex": "#f2f2f0" if toolhead_id in DEMO_MISMATCH_TOOLHEADS else loaded["filament_color_hex"]}
    if item["hex"] and expected_hex:
        verdict = compare(expected_hex, item["hex"])
        item["versus_file"] = verdict["verdict"]
        item["distance"] = verdict["distance"]
    return item


def advice(where, expected_hex, printer_hex, seen):
    """
    One plain sentence for a sensor reading, as ("warn" | "info", text), or None when there is nothing to say.
    A warning asks for a look at the spool; it is never proof, because the sensor has not been checked
    against known colours. A simulated reading only ever gets a note, and only when it differs from the file,
    so a demo can show what a mis-loaded spool looks like without changing any verdict.
    """
    if seen["simulated"]:
        if seen.get("versus_file") == "mismatch":
            return "info", (f"{where}: the simulated colour sensor reads {seen['hex']}, far from the file's "
                            f"{expected_hex}. This is demo data showing what a wrong spool looks like")
        return None
    if seen["status"] != "reading":
        return "info", f"{where}: the colour sensor has no current colour. {seen['message']}"
    if "versus_file" not in seen:
        return None
    if seen["versus_file"] == "mismatch":
        if printer_hex and compare(expected_hex, printer_hex)["verdict"] == "match":
            return "warn", (f"{where}: the printer reports the file's colour, but the colour sensor reads "
                            f"{seen['hex']}. Look at the spool, and check this sensor is assigned to the right head")
        return "warn", (f"{where}: the colour sensor reads {seen['hex']}, far from the file's {expected_hex}. "
                        "The sensor has not been checked against known colours, so use this as a reason "
                        "to look at the spool, not as proof")
    if seen["versus_file"] == "close":
        return "info", f"{where}: the colour sensor reads {seen['hex']}, a close call against the file's {expected_hex}"
    return "info", f"{where}: the colour sensor reads {seen['hex']}, which matches the file's colour"


def record_override(filename, gate):
    """
    Keep a note when a print starts after the colour sensor disagreed with the file, so there is a record of
    who went ahead and what the sensor, the printer and the file each said. Real sensors only.
    """
    heads = [{"toolhead": row["toolhead"], "file_hex": row.get("expected_hex"), "printer_hex": row.get("loaded_hex"),
              "sensor_hex": row["measured"]["hex"], "distance": row["measured"].get("distance"),
              "calibration_id": row["measured"].get("calibration_id"), "source": row["measured"].get("source")}
             for row in gate.get("filament", [])
             if row.get("measured") and not row["measured"]["simulated"]
             and row["measured"].get("versus_file") == "mismatch"]
    if not heads:
        return
    entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "printer_id": mock_moonraker.selected_printer_id(),
             "file": filename, "heads": heads}
    with _overrides_lock:
        rows = storage.load_json(_OVERRIDES_PATH, [])
        rows.append(entry)
        storage.save_json(_OVERRIDES_PATH, rows[-MAX_OVERRIDES:])


def overrides(limit=50):
    """The recorded starts that went ahead against the sensor's reading, newest first, for the selected printer."""
    pid = mock_moonraker.selected_printer_id()
    with _overrides_lock:
        rows = [row for row in storage.load_json(_OVERRIDES_PATH, []) if row.get("printer_id") == pid]
    return {"printer_id": pid, "overrides": list(reversed(rows))[:limit]}


# ---------------------------------------------------------------------------
# Public API - what the dashboard calls
# ---------------------------------------------------------------------------

def check_current_job():
    """
    Check every toolhead the current print file needs.

    Demo values are compared with the sample file. For real printers, return
    companion observations separately without issuing an optical print verdict.
    """
    job = get_current_job_requirements()
    if mock_moonraker.is_real(mock_moonraker.selected_printer_id()):
        listing = companion_sensor.status()
        sensors = listing["sensors"]
        return {
            "simulated": False,
            "hardware_connected": any(s["age_s"] is not None and s["age_s"] < companion_sensor.MAX_AGE_S
                                      for s in sensors),
            "note": "Sensor readings are kept apart from the printer's reported colours. Confirm Print shows both "
                    "beside the file's colour as advice: a sensor that disagrees asks for a look at the spool and "
                    "never blocks a start or identifies a material.",
            "filename": job["filename"],
            "overall": "sensor_readings" if sensors else "no_sensor",
            "checks": [],
            "sensors": sensors,
            "unassigned": listing["unassigned"],
        }
    results = []

    for requirement in job["required_filament"]:
        toolhead = requirement["toolhead"]
        if not requirement.get("expected_color_hex"):
            continue   # the file doesn't say which colour: nothing to compare
        reading = read_sensor(toolhead)

        result = compare(requirement["expected_color_hex"], reading["detected_hex"])
        result.update({
            "toolhead": toolhead,
            "expected_color_name": requirement["expected_color_name"],
            "expected_material": requirement["expected_material"],
            "confidence": reading["confidence"],
        })
        results.append(result)

    # The whole job is only OK if every toolhead is OK. A file that names no
    # colour for any toolhead has nothing to compare, which isn't a match.
    if not results:
        overall = "nothing_to_check"
    elif any(r["verdict"] == "mismatch" for r in results):
        overall = "mismatch"
    elif any(r["verdict"] == "close" for r in results):
        overall = "close"
    else:
        overall = "match"

    return {
        "simulated": True,
        "hardware_connected": False,
        "note": "Simulated readings. No color sensor connected.",
        "filename": job["filename"],
        "overall": overall,
        "checks": results,
    }


# ---------------------------------------------------------------------------
# Console simulation:  python3 backend/color_check.py
# ---------------------------------------------------------------------------

def simulate():
    """Print to the terminal what the color checker would report."""
    data = check_current_job()
    icons = {"match": "[ok]", "close": "[~]", "mismatch": "[!]"}

    print("=" * 62)
    print("Deja Vu1 - Filament Color Check (SIMULATION - no sensor connected)")
    print("=" * 62)
    print(f"Print file: {data['filename']}")
    print()

    for check in data["checks"]:
        print(f"  {icons[check['verdict']]:5} {check['toolhead']}  "
              f"expected {check['expected_color_name']} ({check['expected_hex']})  "
              f"detected {check['detected_hex']}")
        print(f"        distance {check['distance']} - {check['message']}")

    print()
    print(f"Overall: {data['overall'].upper()}")
    print("Pending hardware: a TCS34725 or AS7341 colour sensor per filament inlet.")
    print("=" * 62)


if __name__ == "__main__":
    simulate()
