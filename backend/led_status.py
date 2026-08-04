"""
led_status.py
=============

MODULE 2 — LED Dock Status Rings.  STATUS: interface + simulation only.
No hardware driver code lives here yet, on purpose.

The plan
--------
The Snapmaker U1 parks its toolheads in docks. When a toolhead is sitting in
its dock you cannot tell at a glance whether it is ready, in use, out of
filament, or faulted — you have to walk over and read the screen.

This module will drive a small ring of WS2812 addressable LEDs mounted beside
each dock. WS2812 LEDs are individually controllable: one data wire carries a
color for every LED in the chain. Each ring shows that dock's state as a
color, readable from across the room:

    idle / docked   soft white
    active          green, gently pulsing
    heating         amber
    error           red, blinking
    progress        a filling arc of green around the ring

What is here today
------------------
Everything except the hardware. The state-decision logic is real and runs on
mock Moonraker data. `simulate()` prints what each ring *would* show. When a
real LED strip is available, only `_write_to_hardware()` needs to be filled
in — the rest already works.

Why no driver code yet
----------------------
The U1's controller is a sealed Rockchip SoC with no exposed GPIO, so the LEDs
will be driven by a separate small board (a Pi Pico or ESP32) that reads
printer state over the network. Writing a driver before knowing which board is
used would mean throwing it away. See docs/hardware-modules.md.
"""

from mock_moonraker import get_printer_state

# The colors each state maps to, as (red, green, blue), 0-255.
STATE_COLORS = {
    "docked":  (60, 60, 60),     # soft white — parked and ready
    "active":  (0, 200, 60),     # green — this toolhead is printing
    "heating": (255, 150, 0),    # amber — coming up to temperature
    "paused":  (0, 120, 255),    # blue — print is paused
    "error":   (255, 30, 30),    # red — needs attention
    "off":     (0, 0, 0),        # dark — printer is off or idle
}

# How each state should animate.
STATE_EFFECTS = {
    "docked":  "solid",
    "active":  "pulse",          # slow brightness breathing
    "heating": "pulse",
    "paused":  "solid",
    "error":   "blink",          # fast on/off to catch the eye
    "off":     "solid",
}

# How many LEDs are in each dock's ring. 12 is a common, cheap ring size.
LEDS_PER_RING = 12


def _rgb_to_hex(rgb):
    """Turn an (r, g, b) tuple into a '#rrggbb' string for the web dashboard."""
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def decide_ring_state(toolhead_id, toolhead_data, printer_state):
    """
    Work out what one dock's ring should display.

    This is the real decision logic and it already works. It takes the state
    of a single toolhead plus the printer's overall state, and returns a
    description of the color, effect, and progress arc for that ring.

    Args:
        toolhead_id:   e.g. "T0"
        toolhead_data: that toolhead's entry from the printer state
        printer_state: the whole printer state dictionary

    Returns:
        A dictionary describing what to show on that ring.
    """
    status = toolhead_data.get("status", "docked")

    # A toolhead that is actively printing but still below temperature is
    # heating, not printing. Show amber so the user knows to wait.
    if status == "active" and toolhead_data.get("temperature", 0) < 180:
        state = "heating"
    elif printer_state.get("state") == "paused" and status == "active":
        state = "paused"
    elif printer_state.get("state") == "error" and status == "active":
        state = "error"
    else:
        state = status if status in STATE_COLORS else "docked"

    # Only the toolhead doing the printing shows the progress arc.
    progress = printer_state.get("progress", 0.0) if state == "active" else 0.0
    lit_leds = round(progress * LEDS_PER_RING)

    return {
        "toolhead": toolhead_id,
        "state": state,
        "color_rgb": STATE_COLORS[state],
        "color_hex": _rgb_to_hex(STATE_COLORS[state]),
        "effect": STATE_EFFECTS[state],
        "progress": round(progress, 3),
        "leds_lit": lit_leds,
        "leds_total": LEDS_PER_RING,
        "label": {
            "docked": "Docked / ready",
            "active": "Printing",
            "heating": "Heating up",
            "paused": "Paused",
            "error": "Needs attention",
            "off": "Off",
        }[state],
    }


def get_all_ring_states():
    """
    Return what every dock ring should currently display.

    The dashboard calls this to draw its row of colored circles. It works
    entirely off mock printer data today, and will work off real data later
    without any change.
    """
    printer_state = get_printer_state()

    rings = [
        decide_ring_state(th_id, th_data, printer_state)
        for th_id, th_data in sorted(printer_state["toolheads"].items())
    ]

    return {
        "simulated": True,      # the dashboard uses this to show its "sim" badge
        "hardware_connected": False,
        "note": "Simulated output. No LED hardware connected.",
        "printer_state": printer_state["state"],
        "rings": rings,
    }


# ---------------------------------------------------------------------------
# Hardware interface — deliberately not implemented yet
# ---------------------------------------------------------------------------

def connect_hardware(host=None, port=None):
    """
    NOT IMPLEMENTED. Will open a connection to the LED controller board.

    Once built, this will connect to the small companion microcontroller (Pi
    Pico W or ESP32) that physically drives the WS2812 chains, most likely
    over a simple HTTP or MQTT message on the local network.

    Returns False today so callers know to fall back to simulation.
    """
    return False


def _write_to_hardware(ring_states):
    """
    NOT IMPLEMENTED. Will push colors to the physical LEDs.

    Once built, this will send each ring's color, effect, and progress arc to
    the controller board, which writes them onto the WS2812 chains. This is
    the only function that will ever touch hardware — everything above it is
    already final.
    """
    raise NotImplementedError(
        "LED hardware driver not implemented. Awaiting physical U1 access."
    )


def push_update():
    """
    Send the current ring states to the LEDs, or simulate if there is no
    hardware.

    Today this always takes the simulation path. Once `connect_hardware()`
    returns True, the same call will light up real LEDs with no other change.
    """
    states = get_all_ring_states()

    if connect_hardware():
        _write_to_hardware(states["rings"])
        states["simulated"] = False
        states["hardware_connected"] = True

    return states


# ---------------------------------------------------------------------------
# Console simulation:  python3 backend/led_status.py
# ---------------------------------------------------------------------------

def simulate():
    """Print to the terminal what each LED ring would be showing."""
    data = get_all_ring_states()

    print("=" * 62)
    print("Deja Vu1 — LED Dock Rings (SIMULATION — no hardware connected)")
    print("=" * 62)
    print(f"Printer state: {data['printer_state']}")
    print()

    for ring in data["rings"]:
        bar = "#" * ring["leds_lit"] + "." * (ring["leds_total"] - ring["leds_lit"])
        print(f"  Dock {ring['toolhead']}  {ring['color_hex']}  "
              f"{ring['effect']:6}  {ring['label']}")
        if ring["state"] == "active":
            print(f"           ring: [{bar}]  {ring['progress'] * 100:.0f}% complete")

    print()
    print("Pending hardware: WS2812 rings + companion controller board.")
    print("=" * 62)


if __name__ == "__main__":
    simulate()
