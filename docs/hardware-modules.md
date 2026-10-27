# Hardware modules - LED dock rings and colour checker

This document covers the two modules that need physical parts. Both are
unbuilt, and no parts have been bought yet. This is the design they will be
built to.

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

The add-on boards talk to Deja Vu1 over Wi-Fi, never to the printer. Deja Vu1
talks to the printer the way it always does: over the network, through
Moonraker. The boards only report readings or show lights. The one printer
write in this design is the colour checker's offer to set a head's colour,
which runs only when you tap it (see "How it behaves" below).

This matters for three reasons. It does not void the warranty. It does not
require unofficial firmware. And it means anyone can remove the whole thing
and be back to a stock printer in ten minutes.

## Architecture

A small microcontroller board acts as the bridge:

```
  Snapmaker U1
       │  (network)
       ▼
  Moonraker API
       │
       ▼
  Deja Vu1 backend  ──── Wi-Fi ────►  Companion board (Raspberry Pi Pico W)
       │                                       │
       ▼                                  ┌────┴─────┐
  Dashboard (browser)                     ▼          ▼
                                     WS2812     TCS34725 or AS7341
                                    LED rings   colour sensors
```

The companion board does no thinking. The Python backend decides what every
LED should show and what every sensor reading means; the board just carries
signals. That keeps the logic testable on a laptop with no hardware attached,
which is what the current simulation does.

---

## Module 2 - LED dock status rings

### What it is for

When a toolhead is parked in its dock you cannot tell its state at a glance.
Ready, out of filament, faulted, mid-print - they all look identical. A ring
of light around each dock makes the state readable from across the room.

### Color scheme

| State | Color | Effect |
|---|---|---|
| Docked / ready | Soft white | Solid |
| Printing | Green | Slow pulse |
| Heating | Amber | Slow pulse |
| Paused | Blue | Solid |
| Error | Red | Blink |
| Off | Dark | - |

While a toolhead is printing, its ring doubles as a progress bar: LEDs light
up around the circle as the print advances.

### Parts

| Part | Qty | Approx cost |
|---|---|---|
| WS2812B ring, 12 LED, 45 mm | 4 | $6–12 total |
| Raspberry Pi Pico W | 1 | $6 |
| 5 V 2 A USB power supply | 1 | $6 |
| 3-core wire, JST connectors | - | $4 |
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

## Module 3 - "Right colour loaded?" checker

### What it is for

Load the wrong spool and you find out mid-print, or when it finishes.
Confirm Print already stops a print when the colour the U1 reports doesn't
match the file (`backend/print_gate.py`). For a spool without an RFID tag,
and with no colour typed on the printer's screen, the U1 doesn't know the
colour, so Confirm Print can only say "check it by eye". The colour checker
fills that gap for any brand of filament.

### How it works

It's optical. A sensor with its own white LED reads the filament's colour
inside a dark housing, and Deja Vu1 compares that reading with the colour the
print file expects.

The first version reads surface colour. Transmission distance (TD: how thick
a layer of a filament must be before it hides what is under it) comes
second; see "Stage two: TD" below. The colour check doesn't need TD.

Optical sensing detects colour, not material. It cannot tell PLA from PETG
of the same colour. Material still comes from the slicer's settings and the
printer's own report.

### Why optical, not RFID

RFID and NFC spool tags only work with tagged spools from specific vendors.
An optical sensor reads whatever filament is already on the shelf, including
unbranded and re-spooled material. Tagged Snapmaker spools still help: the
printer reports their colour, which makes them the reference for testing the
sensor (see "Testing against known colours").

### Two candidate sensors

Both are off-the-shelf breakout boards. The plan is to test both on the same
real spools, side by side, and keep the one that tells close shades apart
more reliably.

| Sensor | What it measures | I2C address | Notes |
|---|---|---|---|
| TCS34725 | Red, green, blue and clear, with an IR-blocking filter on the chip | 0x29, fixed | Common breakouts carry a white LED. Adafruit's original board (product 1334) is listed as discontinued; other makers still sell the chip on breakouts. |
| AS7341 | Eight visible channels (415 to 680 nm), clear and near-infrared | 0x39, fixed | More channels should separate close shades better. Not verified: whether every AS7341 breakout carries its own white LED. |

The addresses come from Adafruit's CircuitPython drivers on PyPI
(`adafruit_tcs34725.py`, `adafruit_as7341.py`, `adafruit_tca9548a.py`),
read on 27 October 2026.

Each sensor type answers on one fixed address, so four identical sensors
can't share one bus directly. A TCA9548A multiplexer (default address 0x70)
gives each sensor its own channel. A Raspberry Pi Pico W reads them and sends
the readings to Deja Vu1 over Wi-Fi.

### Wiring concept

```
  Pico W  SDA/SCL ──► TCA9548A (0x70) ──┬── ch0 ──► sensor, inlet 1
                                        ├── ch1 ──► sensor, inlet 2
                                        ├── ch2 ──► sensor, inlet 3
                                        └── ch3 ──► sensor, inlet 4
          3.3 V, GND ──► all boards        (spare channels: second sensor type for side-by-side tests)
  5 V supply ──► Pico W
```

### Where the sensor sits

Each sensor sits in a short printed block placed in the filament path at one
of the U1's rear filament inlets. The block has:

- a standard PTFE coupler at each end, so the existing tube clicks in and out;
- an open window in front of the sensor, so nothing sits between the sensor
  and the filament;
- light-tight walls, so room light doesn't change the reading;
- a fixed dark back wall, so see-through filaments always read against the
  same background.

Two reasons for this spot. White PTFE tube between the sensor and the
filament would change every reading. And the rear inlets stay still while
the toolheads move, so the sensor and its wire don't travel.

This is reasoning still to be tested on a real U1. The rear-inlet layout
comes from community designs only; it needs checking against the machine
before any housing is printed.

### How it behaves

The sensor is there to help, so it speaks up only when a reading disagrees
with the file. This is the planned behaviour:

- **When it checks:** when filament is loaded, and at Confirm Print. Never
  during a print.
- **Readings agree:** it stays quiet.
- **Close call:** a note inside Confirm Print, nothing more.
- **Sensor disagrees with the file:** a warning with a one-click accept.
  The sensor's verdict won't block a print until tests on real spools show it
  is accurate. A mismatch between the file and the colour the printer
  reports still blocks the print, as Confirm Print does today.
- **Low-confidence reading:** it says "couldn't read" and raises no alarm.
- **Setting the colour on the U1:** it offers to set the head's colour on the
  printer with one tap, so you stop typing colours on the printer's screen.
  This uses the existing set-filament command
  (`MoonrakerPrinter.set_filament()` in `backend/moonraker_client.py`, which
  sends `SET_PRINT_FILAMENT_CONFIG` and reads the result back). That command
  has never run on a real U1.

### How the comparison works

The comparison is written and runs today in `backend/color_check.py`:

1. Read the expected colour from the print file's slicer metadata.
2. Read the actual colour from the sensor (simulated for now).
3. Measure the straight-line distance between the two colours in RGB space.
4. Under 40 is a match. 40–90 is a close call. Over 90 is a mismatch.

RGB distance is crude. If real spools show it struggling with close shades,
the next step is the CIE Lab colour space, which measures difference closer
to how the eye sees it. Only `color_distance()` would change.

### Testing against known colours

Snapmaker RFID spools give reference colours: the printer reports their
colour, so each sensor reading can be checked against a colour the printer
already knows. A few tagged spools in different colours cover the test.

### Calibration

Room light and the distance to the filament both shift readings. The dark
housing removes most of the first and fixes the second. The sensor still
needs a white-balance reference before first use; `calibrate()` is stubbed
for this.

### Stage two: TD

TD is not part of the colour check. The plan for it:

1. Measure each spool with a TD1s tester (AJAX 3D and BIQU) and type the
   values in.
2. The Photo-to-Print Studio uses those measured values to plan layered
   colour prints. Today it starts from an estimate (`estimate_td()` in
   `backend/photo_studio.py`) and lets you type a TD for each colour in the
   stack; saving a measured TD with each spool is still to build.

The TD1s connects over USB, but its data format is not publicly documented,
so reading it into Deja Vu1 automatically is unproven. Building TD into the
inline sensor would need light shone through the filament and calibration
against printed step tests. That is future research.

### Parts for the first build

| Part | Qty | Estimated cost |
|---|---|---|
| TCS34725 sensor breakout (one per inlet) | 4 | about $5–10 each |
| AS7341 sensor breakout (side-by-side comparison) | 2 | about $19 each |
| TCA9548A I2C multiplexer | 1 | about $7–14 |
| Raspberry Pi Pico W | 2 | about $5–6 each |
| TD1s filament tester (stage two) | 1 | about $80–90 |
| Snapmaker RFID spools in different colours (reference colours) | a few | not priced |
| Wiring, PTFE couplers, 5 V power supply | - | about $10–20 |
| Printed sensor blocks | 4 | filament only |

All costs are estimates from search-result listings seen on 27 October 2026
(Adafruit's AS7341 at $18.95, BIQU's TD1s at $79.99 to $89.99 and shown sold
out, the Pico W's $6 launch price). The store pages themselves could not be
opened from the build environment, so check current prices before buying.

### Software status

`backend/color_check.py` contains the working comparison logic and a
simulation. With a real printer and no sensor fitted, it reports "no sensor
fitted" and never passes off a simulated reading. The unwritten functions
are `connect_sensor()`, `calibrate()` and the real body of `read_sensor()`.
The behaviour above (checking on load, the one-click accept, "couldn't
read", the one-tap colour offer) is planned and not written yet.

### Plan once a U1 is available

- One working sensor within 6 weeks of the U1 arriving.
- All four inlets, with accuracy results, within 12 weeks.
- Results on real spools, shared with Snapmaker's team first and then
  published here.
- Open-source code (MIT licence) and printable housing files any U1 owner
  can build.

---

## What is needed to finish both

Access to a physical Snapmaker U1. Every design decision above is made
against the published spec, photos of the machine and community designs:
dock geometry, the rear filament inlets, mounting points and filament path
clearances all need confirming against the real thing before anything gets
built.

For the sensor read and the LED write, the arrival of the hardware changes
four functions and nothing else. The colour checker's planned behaviour
(checking on load, the one-click accept, the one-tap colour offer) is new
code on top of those.
