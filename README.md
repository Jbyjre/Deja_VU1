# Deja Vu1

A dashboard and companion app for the Snapmaker U1. It started as an answer
to three questions you currently have to walk over and figure out yourself —
is that docked toolhead ready or stuck, is the right filament loaded, is
anything due for maintenance — and has grown into a fuller companion:
printer control, phone pairing, filament tracking, smart notifications, and
a few games for while a long print runs. It runs on Moonraker, the web API
that already sits in front of the printer, and reads it through one
connection rather than three.

Built and tested on simulated printer data. Most of it needs no hardware and
runs today; two modules (the LED dock rings and the optical colour sensor)
have complete, tested logic waiting on physical parts.

## The problem

**Docked toolheads are silent.** A toolhead parked in its dock looks exactly
the same whether it is ready, out of filament, or faulted. On a multi-toolhead
machine you find out by walking over and reading the screen.

**Wrong filament, discovered too late.** Four toolheads means four chances to
load the wrong spool. Nothing checks. You notice when the print comes out in
the wrong color, which is after the time and material are spent.

**Maintenance gets skipped until something breaks.** Nozzles clog, beds drift,
belts loosen. None of it announces itself on a schedule, so it gets done after
a print fails instead of before.

**You can't tell if it's safe to hit print.** Everything above is scattered
across separate checks nobody remembers to run every time.

Each is small. Together they are most of the routine friction of running the
machine, and all of it is visible in data the printer already publishes.

## What's in it

### Ready today — no hardware needed

| Module | What it does |
|---|---|
| **Maintenance reminders** | Tracks cumulative hours, print counts, and calendar time since each of six tasks (nozzle, bed, belts, rails, dock alignment, fans) was last done. Resets when you mark it complete. |
| **Printer control** | Pause, resume, cancel, set a toolhead's target temperature, home an axis, or send a raw G-code line, with a live console log. |
| **Push notifications** | Alerts on print finish/fail via ntfy.sh, Discord, or Telegram — plain webhooks, no SDK, no account. A failed print always notifies right away; a finished one respects configured quiet hours instead of buzzing your phone at 3am. |
| **Update checker** | Reads Moonraker's own update-status API and flags when Klipper or Moonraker have an update waiting. |
| **Config backup** | One-click download of this dashboard's own settings and history as a zip. |
| **Camera bridge** | Brings the printer's camera feed in, with a watchdog that flags a frozen stream instead of silently showing a stale image. |
| **Phone pairing** | A short one-time code, entered on a second browser, adds it to a paired-devices list — no account, no password, nothing that leaves your network. |

### Optional — on by request

| Module | What it does |
|---|---|
| **Filament inventory** | Tracks spools on hand, flags print files needing a colour you don't have, and nudges you if a spool has sat loaded for weeks. |
| **What changed?** | Compares the job about to print against your last few runs of that file, and flags a likely cause when the file has failed before and shares a pattern (a filament type in common, say). |
| **Pre-print sanity check** | Combines maintenance, dock status, and colour-check into one "safe to print?" verdict. |

### Interface + simulation, hardware pending

| Module | What it does |
|---|---|
| **Dock status rings** | A ring of light beside each toolhead dock — white for ready, green for printing, amber for heating, red for a fault — readable across the room. Two ways to build it: WS2812 rings, or push the same state to a WLED-controlled strip you already own. |
| **"Right colour loaded?"** | An optical sensor in the filament path, compared against what the print file expects, catching the wrong spool before the print starts. |

Every module can be switched on or off from **Modules & devices** — the
toggle you see there is enforced by the server, not just hidden in the
interface: a disabled module's API routes refuse to answer rather than
silently doing nothing.

### While you wait

Five small games, playable from the dashboard while a long print runs —
**Sky Dash** (a gravity dodge, tap to climb), **Echo Maze** (a real 3D maze
rendered in pure CSS, room by room — every room looks the same as the last,
on purpose), **Block Stacker**, **Merge Puzzle**, and **Brick Break**. None
of them read the printer; a status strip stays pinned to the top of every
tab, including mid-game, so a finished or failed print is never missed.
Best scores are remembered per browser.

## Why one dashboard, not several tools

Everything reads from the same Moonraker connection and the same print
history. Splitting that into separate tools would mean separate connections,
separate setups, and separate tabs to check. They are modules of one
application because the data says they should be — and it means the modules
that need hardware never block the ones that don't. Maintenance and printer
control work now, on any Moonraker-connected printer. The LED and colour
modules switch on when their parts arrive.

## No printer, no numbers

The dashboard does not invent figures. With no printer connected it shows
empty states — not zeroes, not placeholder data dressed up as real readings.

To preview it, there is a **Demo data** switch in the header. Turning it on
loads simulated print history and labels every panel accordingly, with a
banner saying plainly that nothing is connected.

This is enforced in the server, not just hidden in the interface. Without a
printer and without an explicit demo request, the data endpoints return
`{"connected": false, "demo": false}` and nothing else. `curl` gets the same
answer the browser does. Settings that belong to the dashboard itself —
modules, pairing, notification preferences, the filament list — aren't
printer figures, so they work the same with or without a printer connected.

## Current status

Built and tested on mock data. There is no real printer connection yet.

- Maintenance, printer control, notifications, updates, backup, camera
  watchdog, and pairing are complete and tested against the simulated
  Moonraker layer. Swapping `backend/mock_moonraker.py` for a real Moonraker
  HTTP client is the only change needed to run any of it against an actual
  printer — nothing else in the project talks to the printer directly.
- Filament inventory, the What-changed check, and the pre-print sanity check
  are complete and tested; they're optional and off by default.
- The LED and colour-check modules have working decision logic and console
  simulations, but no hardware drivers yet.
- `backend/mock_moonraker.py` generates 38 fake print jobs over about two
  months, and now also holds mutable live state so pause/resume/cancel and
  temperature changes actually do something in the simulation.

I do not own a Snapmaker U1. This project is part of an application to the
Snapmaker Innovation Fund, partly to request a unit. Everything that can be
built without the machine has been built; the rest is designed and documented
so it can be finished quickly once hardware is available.

Both hardware modules are deliberately non-invasive — external add-ons that
mount to the frame and read printer state over the network. Nothing is
soldered to the mainboard and no firmware is modified. The U1's sealed
Rockchip SoC exposes no GPIO, so this is both a design requirement and the
only sensible approach. Details in
[docs/hardware-modules.md](docs/hardware-modules.md).

## Tech stack

- **Backend:** Python 3.8+, standard library only
- **Web server:** `http.server` from the standard library
- **Frontend:** HTML, CSS, and JavaScript — no framework, no build step
- **Storage:** plain JSON files
- **Tests:** `unittest` from the standard library, 143 cases
- **Printer API:** Moonraker (simulated for now)

No dependencies. Nothing to install beyond Python itself, and nothing is
fetched from the internet at runtime — no webfonts, no CDN, no analytics.
It works offline, including the phone pairing, which talks directly to this
server over your local network rather than through any cloud relay.

The interface uses an Apple Liquid Glass treatment: translucent panels with
real edge refraction (an SVG displacement filter, not just a blur), a
specular highlight that tracks the pointer, a bright rim, and elevation
shadow — the five layers that separate genuine glass from a blurred box.
Repeated small panels share one glass surface with plain dividers rather
than each getting its own blur, both for the look and for performance. It
respects the system settings for reduced transparency, reduced motion, and
increased contrast, and the layout collapses cleanly to a phone-width screen.

## Roadmap

**With access to a U1:**

1. Replace the mock layer with a real Moonraker HTTP client.
2. Confirm maintenance thresholds against how the machine actually wears.
3. Build the LED rings — print the dock brackets, wire the WS2812 chain,
   implement the driver (or wire up WLED instead).
4. Build the color checker — print the sensor housings, mount on the filament
   path, implement the sensor read and calibration.
5. Add pre-print blocking: pause a print that starts with the wrong filament
   loaded, instead of only warning.

**Beyond that:**

- Home Assistant bridge (simple HTTP sensors, no MQTT dependency needed).
- Chamber climate monitoring and control.
- An import-compatibility check for files converted from other slicer
  ecosystems.
- Package as a proper Moonraker component so it installs alongside Fluidd or
  Mainsail.

## How to run it

You need Python 3.8 or newer. Nothing else.

```bash
git clone https://github.com/jbyjre/deja_vu1.git
cd deja_vu1
python3 backend/app.py
```

Then open **http://localhost:8000** in a browser.

The dashboard will report that no printer is connected and show empty panels.
Flip the **Demo data** switch in the header to fill it with the simulated
print history. To try it from a phone on the same network, open
**Modules & devices → Pair another device** to get a code.

To see the maintenance module on its own, printed to the terminal:

```bash
python3 backend/maintenance.py
```

The two hardware modules have console simulations too:

```bash
python3 backend/led_status.py
python3 backend/color_check.py
```

To run the tests:

```bash
python3 -m unittest discover tests
```

Everything runs on simulated data. No printer is contacted at any point.

## Documentation

- [docs/architecture.md](docs/architecture.md) — how the pieces fit together
  and how to swap in a real printer
- [docs/hardware-modules.md](docs/hardware-modules.md) — parts lists, wiring,
  and the non-invasive design constraint

## License

MIT. See [LICENSE](LICENSE).
