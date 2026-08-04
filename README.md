# Deja Vu1

A dashboard for the Snapmaker U1 that answers three questions you currently
have to walk over and figure out yourself: is that docked toolhead ready or
stuck, is the right filament loaded, and is anything due for maintenance. It
runs on Moonraker, the web API that already sits in front of the printer, and
bundles the three answers into one page. Built on simulated printer data
today — the maintenance module is complete and working, the two hardware
modules are designed and simulated but await access to a physical U1.

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

Each is small. Together they are most of the routine friction of running the
machine, and all three are visible in data the printer already publishes.

## The three modules

### 1. Maintenance reminders — working

Reads print history and tracks cumulative hours, print counts, and calendar
time since each task was last done. Reminds you when something is due, and
resets the counter when you mark it complete.

Six tasks are tracked: nozzle check, bed leveling, belt tension, rail
lubrication, dock alignment, and fan cleaning. Each has its own thresholds —
some by print hours, some by print count, some by days, some by a combination.
Whichever limit is hit first triggers the reminder.

Failed prints still count toward wear hours, because the machine was running
either way.

**Status:** complete and tested. No hardware needed. Runs today.

### 2. LED dock status rings — interface + simulation, hardware pending

A ring of addressable LEDs beside each toolhead dock, showing that dock's
state as a color you can read across the room: white for ready, green for
printing, amber for heating, red for a fault. While printing, the ring
doubles as a progress bar.

The state logic is written and tested. The dashboard shows exactly what the
LEDs would display, driven by live printer state. Only the hardware write is
unimplemented.

**Status:** logic done, driver pending hardware.
**Hardware cost:** ~$6–12 for the LED rings, ~$22–28 for a complete build
including the controller board and power supply.

### 3. "Right color loaded?" checker — interface + simulation, hardware pending

An optical color sensor in the filament path, compared against what the print
file expects. Catches the wrong spool before the print starts instead of after
it finishes.

Optical, not RFID — RFID tags only work with tagged spools from specific
vendors, and the point is to work with whatever filament you already own. The
honest tradeoff is that a color sensor reads color, not material; it cannot
tell PLA from PETG.

The comparison logic is written and tested. Only the sensor read is simulated.

**Status:** logic done, driver pending hardware.
**Hardware cost:** ~$8–20 depending on how many toolheads you instrument.

## Why one dashboard, not three tools

All three read the same data from the same source. Print history drives the
maintenance reminders. Live printer state drives the LED colors. Print file
metadata drives the color check. It all arrives through one Moonraker
connection.

Splitting that into three projects would mean three connections, three setups,
and three tabs to check. They are modules of one application because the data
says they should be.

It also means the modules that need hardware do not block the one that
doesn't. The maintenance module works now, on any Moonraker-connected
printer. The other two switch on when their parts arrive.

## No printer, no numbers

The dashboard does not invent figures. With no printer connected it shows
empty states — not zeroes, not placeholder data dressed up as real readings.

To preview it, there is a **Demo data** switch in the header. Turning it on
loads the simulated print history and labels every panel accordingly, with a
banner saying plainly that nothing is connected.

This is enforced in the server, not just hidden in the interface. Without a
printer and without an explicit demo request, the data endpoints return
`{"connected": false, "demo": false}` and nothing else. `curl` gets the same
answer the browser does.

## Current status

Built and tested on mock data. There is no real printer connection yet.

- The maintenance module is complete. It runs, produces sensible reminders,
  and passes its tests.
- The LED and color modules have working decision logic and console
  simulations, but no hardware drivers.
- `backend/mock_moonraker.py` generates 38 fake print jobs over about two
  months. Swapping it for a real Moonraker client is the only change needed to
  run against an actual printer.

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
- **Storage:** a JSON file
- **Tests:** `unittest` from the standard library, 51 cases
- **Printer API:** Moonraker (simulated for now)

No dependencies. Nothing to install beyond Python itself, and nothing is
fetched from the internet at runtime — no webfonts, no CDN. It works offline.

The interface uses a Liquid Glass treatment: translucent panels with real edge
refraction, a highlight that tracks the pointer, and depth on the cards and
buttons. It respects the system settings for reduced transparency, reduced
motion, and increased contrast.

## Roadmap

**With access to a U1:**

1. Replace the mock layer with a real Moonraker HTTP client.
2. Confirm maintenance thresholds against how the machine actually wears.
3. Build the LED rings — print the dock brackets, wire the WS2812 chain,
   implement the driver.
4. Build the color checker — print the sensor housings, mount on the filament
   path, implement the sensor read and calibration.
5. Add pre-print blocking: pause a print that starts with the wrong filament
   loaded, instead of only warning.

**Beyond that:**

- Package as a proper Moonraker component so it installs alongside Fluidd or
  Mainsail.
- Per-user maintenance thresholds instead of fixed defaults.
- Track filament consumption per spool.

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
print history.

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
