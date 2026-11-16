# Check Deja Vu1 yourself

Deja Vu1 is a free dashboard and preparation workspace for Snapmaker U1 printers. This page is for
someone reviewing it: where the project comes from, how to try it in ten minutes without a printer,
what is new since Phase 1 and what is not done. Facts carry a date. The record of what ran where is
[What has been tested](testing.md).

## Where it comes from

Deja Vu1 took part in Phase 1 of the Snapmaker Innovation Fund and received the U1 Hardware
Sponsorship. The printer arrived on 31 October 2026. This is the same project, continued: the author's
own prior work, MIT licensed. Much of the code is written with Claude Code under the author's
direction. [CREDITS.md](../CREDITS.md) lists everything Deja Vu1 talks to or builds on, and every
change is in the public git history.

## Ten minutes, no printer needed

1. **Look at it.** The [online demo](https://deja-vu1.jmath1110.workers.dev/?demo) plays a recording
   of three simulated printers. It never connects to a printer.
2. **Run it.** Follow the [install steps](../README.md#install). You need Python 3.8 or newer and
   nothing else. Open the dashboard and switch on **Demo data** in the header for three simulated
   printers.
3. **Add a pretend printer.** In a second terminal run `python3 tools/stand-in-printer.py`. It prints
   an address. Paste it under Printers, **Add a printer**. This is the Moonraker stand-in the test suite
   uses, so it answers like a printer and nothing it shows is a measurement.
4. **Try to get a bad file through Confirm Print.** In Files choose **Add sample files**, open
   `unsafe_example_purge_past_bed.gcode` and press **Print…**. Deja Vu1 refuses it and says why: the
   file moves outside the U1's 270 mm build volume. The server checks again at the moment a print
   starts, so a changed printer state cannot slip past a dialog that was drawn earlier.
5. **Run the checks.**

   ```bash
   python3 -m unittest discover tests     # the test suite, about 15 minutes
   node tools/browser-walk.js             # every screen and the main workflows in a real browser
   ```

   The browser walk needs Node, Playwright for Node and a Chromium. It starts its own server, opens
   each of the 17 places at 1366 px and 390 px in light and dark, with and without demo data, and runs
   the workflows: importing a file, Confirm Print on every sample file, a slow answer arriving for an
   earlier file, the queue, opening a model, the slicer set-up card, phone pairing, and the colour
   sensor on the stand-in printer. It also plants script payloads in file names, printer names, spools and
   notes and checks they show as plain text. It fails on script errors, server errors, sideways scrolling
   and stray `undefined` or `NaN` text. `--axe` adds an automated accessibility check (WCAG 2.2 AA) and
   needs `npm install axe-core` first.

## What is new since Phase 1

Phase 1 (the entry of 5 August 2026) ran on simulated printers only.

| Area | Now (version 0.20.14, 16 November 2026) | Where to look |
|---|---|---|
| Real printers | A Moonraker client: live state over a WebSocket, commands over HTTP, up to 12 printers, a watch-only mode that lets no write through. Run on a real U1 with stock firmware: adding it, live readings and the 3D twin, prints through Confirm Print, pause and cancel, the camera and time-lapses, the Printer page controls (8 November). | [testing.md](testing.md), [real-printer.md](real-printer.md) |
| Before a print | Confirm Print reads the file and the printer: moves outside the build volume, the loaded colour and material against the file, spool weight, bed clearance, overdue care. It blocks, warns or clears, and the server runs it again at the start. | [architecture.md](architecture.md) |
| Prepare, slice, inspect | Plates, tool and colour assignment, slicing with an engine you install, and a layer-by-layer view with time, filament and heads. Engine support is listed per build. | [engine-support.md](engine-support.md) |
| Colour checker | A versioned API for a companion device, white-reference calibration for the AS7341 and TCS34725, and the sensor's reading shown in Confirm Print beside the file's colour and the printer's report as advice that never blocks a start. Tested with synthetic readings and a stand-in printer. | [colour-sensor-api.md](colour-sensor-api.md) |
| AI assistant | Optional. Talks to the printer inside safety limits; nothing in the app needs it. Run on the real U1 and through a paid API key (13 November). | [ai-assistant.md](ai-assistant.md) |
| Checks | The test suite on Python 3.8, 3.10, 3.12 and 3.13, a browser walk of every place and workflow, an automated accessibility check (WCAG 2.2 AA) and script-injection probes. Dated results are in testing.md. | [testing.md](testing.md) |

## What is not done

These are the limits as of 16 November 2026.

- **The colour sensor hardware.** The parts are on order. No Pico firmware, sensor driver or bench
  reading exists yet, so there is no measure of how close a sensor comes to a spool's colour. The
  calibration arithmetic is checked against known spectra, not against a physical sensor.
- **LED dock rings and spool scales.** The on-screen states exist. The hardware does not.
- **Real runs on other systems.** The Windows engine check, macOS, Android AR, a second printer, the
  Extended Firmware, Spoolman, WLED, Home Assistant, go2rtc and Tailscale are tested with stand-ins that
  the suite names, not on the real thing.
- **The tested U1's firmware version** is still to be recorded.

If you find a claim that this page or the README cannot back up, please open an issue.
