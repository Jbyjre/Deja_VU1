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
Physical readings are observations only; print-time advice is not connected yet.

Why no driver code yet
----------------------
The sensor talks I2C, and the U1's sealed Rockchip SoC exposes no GPIO or I2C
pins. The sensor hangs off the external Pico W, never the printer's board. No
sensor driver or physical accuracy claim is included here. See docs/hardware-modules.md, Module 3.
"""

import random

import mock_moonraker
import companion_sensor
from mock_moonraker import get_current_job_requirements, get_printer_state

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


def calibrate(toolhead_id):
    """
    NOT IMPLEMENTED. Will white-balance the sensor.

    Optical sensors read differently depending on ambient light and how far
    the filament sits from the lens. The dark housing fixes both; this will
    still take a reference reading against a known white target so later
    readings can be corrected.
    """
    raise NotImplementedError(
        "Sensor calibration not implemented. Awaiting physical hardware."
    )


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
        sensors = companion_sensor.status()["sensors"]
        return {
            "simulated": False,
            "hardware_connected": any(s["age_s"] is not None and s["age_s"] < companion_sensor.MAX_AGE_S
                                      for s in sensors),
            "note": "Sensor readings are separate from the printer's reported colours. Confirm Print still "
                    "compares the file with what the printer reports loaded; optical advice is not enabled.",
            "filename": job["filename"],
            "overall": "sensor_readings" if sensors else "no_sensor",
            "checks": [],
            "sensors": sensors,
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
