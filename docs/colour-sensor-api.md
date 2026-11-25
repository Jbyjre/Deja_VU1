# Colour-checker companion API, version 1

Deja Vu1 can receive colour-sensor observations from a separate companion device. This is the
software contract for that device. Firmware for a Raspberry Pi Pico W with a Waveshare AS7341 ships in
`hardware/colour-checker/` ([the guide](colour-checker.md)). The tests use synthetic messages, a stand-in
Pico and a stand-in printer. No physical accuracy result exists.

Raw channels stay raw. A companion can send raw counts only: once a head has a white reference
recorded in Deja Vu1 (see Calibrate a sensor), Deja Vu1 works out the colour and keeps it with
`source: "deja-vu1"` and the calibration's ID. A companion can instead report its own colour,
calibration reference and confidence; those are the companion's claims and are kept as sent. A colour
does not identify a material, measure transmission distance, approve a print or block one. Confirm
Print shows the sensor's colour beside the file's colour and the printer's report (see Confirm Print)
and still decides from the file and what the printer reports loaded.

![The colour card with synthetic current, uncalibrated, old and low-quality samples](img/colour-sensor-status.jpg)

These are synthetic API messages shown alongside a Moonraker stand-in, not physical sensor readings.

## Connection and access

Enable **Right colour loaded?** in Settings, Optional extras. Select an added physical printer. Every
request below names that printer with `?printer=<id>`; find its ID in `GET /api/fleet/registry`.
Demo printers refuse assignments and incoming observations, even with `demo=1`.

Use the dashboard's existing local address and port. Requests pass the same Host, Origin and
optional device-lock checks as the rest of the dashboard; no sensor header bypasses them. With the
device lock on, the companion must pair through `/api/pairing/redeem` and retain its `dv_device`
cookie, just like another device. Keep that cookie private. Cross-site browser writes are refused.
Do not expose the dashboard or this API directly to the internet.

## Assign a sensor channel

`POST /api/colorcheck/sensors?printer=<id>` with JSON:

```json
{
  "version": 1,
  "simulated": false,
  "bindings": [
    {
      "toolhead": "T0",
      "device_id": "pico-1",
      "channel_id": "inlet-0",
      "sensor_id": "as7341-1",
      "sensor_model": "AS7341"
    }
  ]
}
```

This replaces this printer's complete list, with at most one channel for each of T0 to T3.
An empty list disconnects all its sensors. Assignments survive restart in `colour_sensors.json`.
A device/channel pair can belong to only one head on one printer. Moving it requires removing its
old assignment first. Replacing a chip requires updating `sensor_id`; a mismatched identity is
refused rather than silently taking over the previous sensor's calibration.
Assignments for a deleted printer are cleared on the next assignment save so its channels can be
used again. A registered printer that is temporarily offline keeps its assignments.

IDs and the model name use 1 to 64 letters, digits, dots, colons, hyphens or underscores, beginning
with a letter or digit. Use stable, non-personal identifiers. The companion must keep the same
sensor ID for the same physical chip; the server cannot verify hardware identity by itself.
Any assignment save clears that printer's cached observations, including a save of the same list.
Calibration is under Calibrate a sensor below. A screen that tests each channel before first use is
a later step.

## Send an observation

`POST /api/colorcheck/readings?printer=<id>` with JSON:

```json
{
  "version": 1,
  "simulated": false,
  "device_id": "pico-1",
  "channel_id": "inlet-0",
  "sensor_id": "as7341-1",
  "sensor_model": "AS7341",
  "captured_at": 0,
  "raw": {"f1": 100, "clear": 200},
  "quality_flags": [],
  "calibrated": null
}
```

The numbers above are synthetic examples. Replace `captured_at` with the sample's actual capture
time as UTC Unix seconds. Synchronise the companion's clock. A capture more than two seconds in
the future is refused. Delivery time is recorded separately as `received_at` and never renews an
old capture. Repeated or earlier capture times on the same assigned head are refused.

`raw` holds 1 to 16 named, finite, non-negative sensor values, each no greater than 1,000,000,000.
Deja Vu1 does not convert these values to RGB. `quality_flags` is an explicit list of up to 16
identifiers, empty when the companion reports no issue. Examples include `low_light`, `saturated`,
`unstable` and `unsupported_sample`. Any flag, including an unknown one, suppresses the current colour.

When the companion has a calibrated colour, it can replace `calibrated: null` with:

```json
{"hex": "#f26a1b", "calibration_id": "white-dark-1", "confidence": 0.95}
```

All three fields are required. Hex colours have six digits. Confidence is finite and between 0
and 1; values below 0.8 suppress the current colour. This is an initial display policy, not a
measured accuracy threshold. A calibration ID records provenance; it does not prove that the
reference, lighting, housing or sample is suitable. Only a bench test on known colours shows that.

Three optional fields travel with a reading:

| Field | Holds |
|---|---|
| `settings` | Up to 16 named numbers or true/false values for how the sensor was set (`gain`, `led_ma`, `led`, `atime`, `astep`, `full_scale`, `average` for the Pico firmware). A white reference records them. A later sample taken at other settings gets no colour and a sentence naming the difference. `average` does not count: it changes how steady a reading is, not how bright. |
| `info` | Up to 8 named facts about the sender: numbers, true/false, plain text under 200 characters. The firmware sends `firmware`, `transport` (`wifi` or `usb`) and `rssi`, the Wi-Fi signal in dBm. |
| `command_result` | The sensor's answer to a command (see Commands). |

A successful reply has `accepted: true`, `version`, `printer_id`, `toolhead`, the current
`sensor` observation, `server_time` (the app's Unix time in whole seconds) and `commands` (see Commands).
Invalid messages answer 400 without changing the previous observation.
Disabled modules answer 403. Incoming samples never send a command to a printer.

### Time stamps for a sensor with no clock

A CircuitPython float has about seven significant digits, so it cannot hold a Unix time to better than a few
minutes. Send `captured_at` as a whole number of seconds. `GET /api/colorcheck/sensors` and every accepted reading
return `server_time` as a whole number. A sensor that learns the offset between `server_time` and its own
monotonic clock can stamp each reading on the app's clock. Never stamp ahead: a reading more than two seconds
in the future is refused. The firmware also refuses to repeat a second, so readings two seconds apart never collide.

### A sensor that is not assigned yet

A reading from a sensor with no head answers 400 ("not assigned"), and the app remembers the sensor for ten
minutes (at most 8). `GET /api/colorcheck/sensors` lists them under `unassigned` with their identity, `info`,
`settings` and age, and the setup window offers them for a head. Assigning one takes it off the list.

### Commands to a sensor

`POST /api/colorcheck/command?printer=<id>` with `{"toolhead": "T0", "cmd": "autogain"}` queues one command for
that head's sensor. The commands are:

| `cmd` | Arguments | Does |
|---|---|---|
| `autogain` | none | Picks the highest gain that keeps the brightest channel under half of the chip's range. Put the white target in first. |
| `set` | `gain` (0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256 or 512), `led_ma` (whole number, 4 to 20), `led` (true or false) | Changes the settings. The sensor keeps them across a power cycle. |
| `new_sensor` | none | Gives the chip a new `sensor_id`, for after a board swap. The old calibration drops once the new ID is assigned. |

A command waits for the sensor's next reading. The reply to that reading carries it in `commands`
(`[{"id": 7, "cmd": "autogain"}]`) once, and the sensor answers in `command_result` on a later reading:
`{"id": 7, "ok": true, "message": "..."}`. `GET /api/colorcheck/sensors` shows each head's `command` as `waiting`,
`sent`, `done`, `failed` or `expired` (after 120 seconds) with the sensor's own words. One command waits per head,
and a newer one replaces it. A sensor on USB answers its commands at once instead (see the serial protocol).

### Connection details

`GET /api/colorcheck/connection?printer=<id>` returns this computer's home-network addresses with the port, a
`name.local` spare, the printer id, whether it is a physical printer and whether the device lock is on. The
Right colour loaded? module switch gates it, and it stays out of the online demo's recording.

### Pico serial protocol (USB)

The firmware prints one line per message that starts with `DV1 ` and holds one JSON object. A host sends commands the
same way, one line each. Anything else on the line is console chatter and a host ignores it. Never send Ctrl-C: it
stops the program.

| `t` | From the Pico | Holds |
|---|---|---|
| `hello` | on start, on request, when the sensor comes up | `protocol`, `firmware`, `sensor_ready`, the identity (`device_id`, `channel_id`, `sensor_id`, `sensor_model`), `settings` and `net` (the Wi-Fi's state without its password) |
| `reading` | every two seconds | `seq`, `raw`, `quality_flags`, `settings` and the identity: everything the app's reading needs except `captured_at` |
| `error` | on a fault, then every ten seconds | `code` (`wiring`, `no_sensor`, `library`, `sensor_lost`) and a sentence |
| `ack`, `autogain` | after a command | `cmd`, `ok`, `message` and the command's own results |
| `net` | when the Wi-Fi state changes | the same facts as `net` in `hello` |

Commands to the Pico (`{"cmd": ...}`): `hello`, `set`, `autogain`, `new_sensor` as above, and over USB only
`wifi_set` (`ssid`, `password`, `server`, `printer`, `code`: any of them), `wifi_clear` (erase what the app saved), `wifi_test`
(join and reach the app now) and `net` (report the Wi-Fi state). The Pico stores the Wi-Fi details in its non-volatile
memory, never repeats the password and refuses `wifi_*` commands that arrive over Wi-Fi.

`quality_flags` from the firmware: `saturated` (the chip's own saturation bit, or a count at full scale), `low_light` (the
brightest of the eight bands under 100 counts) and `unstable` (a band moved more than 10 % and 25 counts between the readings it
averages, or the two banks of channels disagreed about the clear channel). A dark reference accepts `low_light`, because an
empty holder is dim on purpose, and refuses every other flag.

### Pico Wi-Fi behaviour

The firmware reads `CIRCUITPY_WIFI_SSID`, `CIRCUITPY_WIFI_PASSWORD`, `DV1_SERVER` (addresses separated by commas),
`DV1_PRINTER` and `DV1_PAIR_CODE` from `settings.toml`, joins the network, asks `GET /api/colorcheck/sensors?printer=<id>` for the time
and posts each reading with `User-Agent: DejaVu1-sensor/<version>`. That agent does not count as an open page, so a powered sensor
does not keep the app running. With the device lock on, a 401 with `pairing_required` makes the firmware redeem its pairing code
once at `/api/pairing/redeem` and send the `dv_device` key it receives in `Set-Cookie` from then on.

### Bench readings

`POST /api/colorcheck/bench?printer=<id>` keeps the head's latest reading (under five seconds old, and newer than the last one
kept) as a labelled sample: `{"toolhead", "spool": {"brand", "material", "name", "hex"}, "blind", "insertion", "mode"}`, where
`hex` is the colour on the spool's label or listing and `mode` is `strand` or `surface`. The sample holds the app's own raw
counts, flags, settings and the references in force, never values from the page. `GET /api/colorcheck/bench` lists them
(`?full=1` adds the counts), and `POST /api/colorcheck/bench/delete` removes a sample (`id`) or a spool (`spool`). `tools/colour-bench.py`
reports on them.

## Read status

`GET /api/colorcheck/sensors?printer=<id>` returns the configured channels and their statuses,
even while the printer's own network connection is down. No assignments means an empty `sensors`
list. The existing `/api/colorcheck` route also exposes these observations to the colour card when
the printer is connected; its `checks` list stays empty for real printers.

| Status | Meaning |
|---|---|
| `no_reading` | Assigned, but no sample has arrived since start-up or the last assignment save |
| `stale` | Capture is at least 30 seconds old |
| `unreadable` | Companion reported one or more quality flags |
| `uncalibrated` | Raw sample received, with no calibrated colour |
| `low_confidence` | Reported confidence is below 0.8 |
| `reading` | A recent, unflagged, sufficiently confident colour was reported |

Only `reading` has a non-null `detected_hex`. The original raw and calibrated payload remains
under `reading` for inspection, including for an old or rejected-quality sample; it is not a current
measurement. Age uses both capture time and the computer's monotonic clock, so changing the
computer's clock backwards cannot keep a reading current. A stopped companion expires without a
special disconnect message. Restarting Deja Vu1 keeps assignments but discards all observations.
If the dashboard cannot refresh the card, it clears the previous colour and says readings are unavailable.

## Calibrate a sensor

Deja Vu1 calibrates the AS7341 and the TCS34725. A companion for the AS7341 sends the channels
`f1` to `f8` (415, 445, 480, 515, 555, 590, 630 and 680 nm); one for the TCS34725 sends `r`, `g` and
`b`. Other raw names, such as `clear` and `nir`, are stored and not used. Any other sensor model has to
report its own colour.

1. Put a white target in the housing where the filament goes, with the sensor's light on, and wait for
   a new reading.
2. `POST /api/colorcheck/calibration?printer=<id>` with `{"toolhead": "T0", "step": "white"}`.
3. Optional: empty the housing, wait for a reading, and send `{"toolhead": "T0", "step": "dark"}`. It
   removes the sensor's own offset and helps dark colours.
4. `{"toolhead": "T0", "step": "clear"}` forgets both references.

The reply is the head's calibration: `state` (`none`, `needs_white`, `ready`, `settings_changed` or `unsupported`), `id`
(`dv1-` and eight characters that change whenever a reference changes), whether a white and a dark
reference exist, and a sentence saying what to do next. The same block is under `calibration` for each
sensor in `GET /api/colorcheck/sensors`. The Right colour loaded? card has buttons for the three steps.

A reference is taken from the head's latest reading, which must be under 5 seconds old and carry no
quality flag, so the target is in place when it is recorded. A dark reference that is not darker than
the white one, a missing channel or an unsupported model answers 400 in words and changes nothing.
Replacing the chip (`sensor_id`), moving the channel or removing the assignment drops that head's
calibration at once; a deleted printer's calibrations go with its assignments on the next assignment save.
Saving the same assignment again keeps the calibration. Calibration needs the
Right colour loaded? module and a physical printer; demo printers answer 400.

How it works: each channel is divided by its white reference after the dark one is subtracted. The
TCS34725's three ratios are the colour's linear red, green and blue. For the AS7341 the eight ratios
are joined into a spectrum, weighted by a daylight-like light and the CIE 1931 colour-matching curves
(the multi-lobe fit in Table 1 of Wyman, Sloan and Shirley, *Journal of Computer Graphics Techniques*
2(2), 2013) and converted to sRGB. The white target maps to white. A sample more than 1.3 times as
bright as the white target in any channel means the set-up moved: it gets confidence 0.5 and no current
colour.
Otherwise confidence is 0.9. Both are display settings, as for a companion's own value, and are not
measured accuracies. The tests check this arithmetic against known spectra and the rules around it;
they do not show how close a physical sensor comes to a spool's colour.

## Confirm Print

For each head the file uses that has an assigned sensor, Confirm Print shows three colours apart: what
the file expects, what the printer reports loaded, and what the sensor reads (`measured` in
`GET /api/print/confirm`, with `versus_file` as `match`, `close` or `mismatch`). A mismatch adds a warning
that asks for a look at the spool, or at which head the sensor is assigned to when the printer already
reports the file's colour. A sensor with no current colour adds a note. None of this blocks a start or
changes the printer's own checks. A head with no sensor shows nothing extra. Demo printers show a
labelled simulation, the same every time, with no warnings.

A start that goes ahead after a sensor mismatch is recorded: `GET /api/colorcheck/overrides?printer=<id>`
lists the newest 50, each with the file, the file's, the printer's and the sensor's colour per head, the
distance and the calibration used.

## Repeat the contract checks

```bash
python3 -m unittest tests.test_companion_sensor tests.test_sensor_calibration tests.test_sensor_settings tests.test_sensor_wifi tests.test_sanity_check
```

These checks cover synthetic input, the local HTTP routes, printer separation, access checks, the
calibration arithmetic and rules, and the Confirm Print advice. They do not establish the accuracy of a
sensor, housing or calibration. `node tools/browser-walk.js --flows-only --flow sensor` runs the
calibration button and Confirm Print in a browser against `tools/stand-in-printer.py`.
