# Hardware modules — LED dock rings and color checker

This document covers the two modules that need physical parts. Both are
unbuilt. This is the design they will be built to.

## The constraint that shapes both designs

The Snapmaker U1 runs on a sealed Rockchip SoC. There is no exposed GPIO
header, no accessible I2C bus, and no documented way to attach sensors or
LEDs to the printer's own board.

That rules out the obvious approach. Both modules are therefore designed as
**non-invasive external add-ons**:

- Nothing is soldered to, or plugged into, the printer's mainboard.
- No firmware is replaced or patched.
- The printer is never opened beyond removing external panels.
- Everything mounts to the frame or enclosure and runs off its own power.

The add-ons talk to the printer the same way this dashboard does — over the
network, through Moonraker. They read printer state; they never write to it.

This matters for three reasons. It does not void the warranty. It does not
require unofficial firmware. And it means anyone can remove the whole thing
and be back to a stock printer in ten minutes.

## Architecture

A single small microcontroller board acts as the bridge:

```
  Snapmaker U1
       │  (network)
       ▼
  Moonraker API
       │
       ▼
  Deja Vu1 backend  ──── network ────►  Companion board (Pi Pico W / ESP32)
       │                                       │
       ▼                                  ┌────┴────┐
  Dashboard (browser)                     ▼         ▼
                                     WS2812      TCS34725
                                    LED rings   color sensors
```

The companion board does no thinking. The Python backend decides what every
LED should show and what every sensor reading means; the board just carries
signals. That keeps the logic testable on a laptop with no hardware attached
— which is exactly what the current simulation does.

---

## Module 2 — LED dock status rings

### What it is for

When a toolhead is parked in its dock you cannot tell its state at a glance.
Ready, out of filament, faulted, mid-print — they all look identical. A ring
of light around each dock makes the state readable from across the room.

### Color scheme

| State | Color | Effect |
|---|---|---|
| Docked / ready | Soft white | Solid |
| Printing | Green | Slow pulse |
| Heating | Amber | Slow pulse |
| Paused | Blue | Solid |
| Error | Red | Blink |
| Off | Dark | — |

While a toolhead is printing, its ring doubles as a progress bar: LEDs light
up around the circle as the print advances.

### Parts

| Part | Qty | Approx cost |
|---|---|---|
| WS2812B ring, 12 LED, 45 mm | 4 | $6–12 total |
| Raspberry Pi Pico W | 1 | $6 |
| 5 V 2 A USB power supply | 1 | $6 |
| 3-core wire, JST connectors | — | $4 |
| Printed mounting brackets | 4 | filament only |

**Roughly $22–28 total**, or $6–12 if you already have a spare
microcontroller and power supply.

### Wiring concept

WS2812 LEDs chain: data flows out of one ring and into the next, so four
rings need only one data pin on the board.

```
  Pico W  GPIO0 ──► DIN [Ring T0] DOUT ──► DIN [Ring T1] DOUT ──► T2 ──► T3
          5V    ──► VCC on all four rings
          GND   ──► GND on all four rings  (shared ground with the PSU)
```

Notes for whoever builds this:

- Power the rings from the external 5 V supply, not from the Pico's own 5 V
  pin. Forty-eight LEDs at full white draw close to 3 A, which no
  microcontroller can source.
- Tie the PSU ground and the Pico ground together, or the data signal has no
  reference and the LEDs flicker.
- A 300–500 Ω resistor on the data line and a 1000 µF capacitor across the
  power rails are the standard protection for WS2812 chains.
- The Pico's 3.3 V data output usually drives WS2812s fine. If it proves
  unreliable, a level shifter fixes it.

### Mounting

Printed brackets clip to the frame beside each dock. Nothing adhesive touches
the printer, and nothing sits in the toolhead's path.

### Software status

`backend/led_status.py` already contains the full state-decision logic and a
console simulation. The only unwritten function is `_write_to_hardware()`,
which will send colors to the companion board over HTTP or MQTT.

---

## Module 3 — "Right color loaded?" checker

### What it is for

Load the wrong spool and you find out mid-print, or worse, when it finishes.
The printer has no idea what color is in it. This module checks before the
print starts.

### Why optical, not RFID

RFID and NFC spool tags only work with tagged spools from specific vendors.
An optical sensor reads whatever filament is already on the shelf, including
unbranded and re-spooled material. For an open-source add-on aimed at people
who buy filament on price, that is the difference between useful and useless.

The tradeoff is honest: optical sensing detects color, not material. It
cannot tell PLA from PETG of the same color. Material still has to come from
the slicer's own settings.

### Parts

| Part | Qty | Approx cost |
|---|---|---|
| TCS34725 RGB color sensor breakout | 2–4 | $8–20 total |
| I2C multiplexer (TCA9548A) | 1 | $5 |
| Printed sensor housing | 2–4 | filament only |
| Ribbon cable | — | $3 |

**Roughly $16–28 total.** The multiplexer is only needed for more than one
sensor: every TCS34725 ships with the same fixed I2C address, so they cannot
share a bus without one.

Starting with a single sensor on the most-used toolhead is a reasonable first
build and skips the multiplexer entirely.

### Wiring concept

```
  Pico W  SDA/SCL ──► TCA9548A ──┬──► TCS34725 (T0)
                                 ├──► TCS34725 (T1)
                                 ├──► TCS34725 (T2)
                                 └──► TCS34725 (T3)
          3.3V, GND ──► all boards
```

### Sensor placement

The sensor sits in a printed housing clamped around the PTFE tube a few
centimetres before the filament enters the toolhead. The housing has two
jobs: hold the sensor a fixed distance from the filament, and block ambient
light. Both matter — the reading drifts badly without them.

The TCS34725 has its own white LED for illumination, so the housing can be
fully enclosed.

### How the comparison works

This part is already written and working in `backend/color_check.py`:

1. Read the expected color from the print file's slicer metadata.
2. Read the actual color from the sensor.
3. Measure the straight-line distance between the two colors in RGB space.
4. Under 40 is a match. 40–90 warns. Over 90 is a mismatch.

RGB distance is crude but sufficient — the job is telling orange from grey,
not matching paint. If real-world testing shows it struggling with similar
shades, the fix is to switch to the CIE Lab color space, which measures
difference closer to how the eye sees it. Only `color_distance()` would
change.

### Calibration

Ambient light and sensor distance both shift readings, so the sensor needs a
white-balance reference before first use. `calibrate()` is stubbed for this.

### Software status

`backend/color_check.py` contains the working comparison logic and a
simulation. The unwritten functions are `connect_sensor()`, `calibrate()`,
and the real body of `read_sensor()`.

---

## What is needed to finish both

Access to a physical Snapmaker U1. Every design decision above is made
against the published spec and photos of the machine — dock geometry,
mounting points, and filament path clearances all need confirming against the
real thing before anything gets built.

The software is written so that arrival of the hardware changes four
functions and nothing else.
