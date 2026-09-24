# Deja Vu1

A dashboard and companion app for the Snapmaker U1. It started as an answer
to three questions you currently have to walk over and figure out yourself —
is that docked toolhead ready or stuck, is the right filament loaded, is
anything due for maintenance — and has grown into a fuller companion:
printer control, phone pairing, filament tracking, smart notifications, a
running cost estimate, bridges to smart-home gear you likely already own,
and ten games for while a long print runs. It now also runs a whole fleet
of printers, updates live four times a second, starts prints from your
phone behind a real safety check, reads and edits print files in 2D and 3D,
converts MakerWorld and NexPrint projects for the U1, and runs local
"when this happens, do that" automations. It runs on Moonraker, the web API
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
| **Print cost calculator** | Prices filament by material and adds electricity, for a print in progress and for recent history — editable $/kg per material, $/kWh, and printer wattage. |

### Live, fleet-wide, and hands-on — no hardware needed

| Feature | What it does |
|---|---|
| **Live updates** | Printer state refreshes every 250 ms — the same rhythm Klipper itself reports at, so nothing could be fresher — pushed to the browser over a WebSocket written from scratch in standard-library Python. If a network blocks WebSockets, the dashboard notices and asks once a second instead, and says which it's doing. |
| **Printer fleet** | Every printer at a glance — state, progress, the filament in each dock, temperatures, alerts, a health score — and one tap points the whole dashboard (maintenance, control, cost, queue, everything) at any of them. |
| **Start a print from your phone** | Pick a file, read one Confirm Print summary — pre-flight check, filament match, spool weight, maintenance, time, grams and cost — and start it. The server re-checks at the moment of starting and **refuses** if something is wrong. |
| **Honest controls** | Every button says what it's sending straight away ("Pausing…"), then shows only what the printer actually reports back. A command the printer refuses is shown as refused, in words — never as done. |
| **File library** | Your G-code, 3MF and STL files, with real thumbnails, estimated time and grams, a pre-flight verdict, and a recent list. |
| **G-code viewer + small edits** | Read the file line by line, search it, change one number, comment a line out or insert one command — each edit validated first (no emergency-stop lines, no toolheads the U1 doesn't have), the original kept, the pre-flight re-run. |
| **Interactive 3D viewer** | The toolpath of any G-code file, scrubbable layer by layer, and any STL or 3MF model — drawn with plain WebGL and parsers written for this project, no 3D library. |
| **Pre-flight risk check** | Flags extrusion outside the U1's 270 × 270 × 270 mm volume, the nozzle below the bed, unknown toolheads, unsafe temperatures, travel moves below plastic already printed, and more — with line numbers. |
| **MakerWorld / NexPrint → U1** | One click turns a Bambu Studio (MakerWorld) or Elegoo Slicer (NexPrint) project into one set up for the Snapmaker U1 in Snapmaker Orca, keeping the creator's own settings and colours. |
| **View on your desk (AR)** | Places an STL or 3MF model on your real desk at its real printed size, through the phone's camera. Works on Android/WebXR browsers; iOS Safari has no equivalent. The button only appears where AR is supported, and it needs an `https://` address, such as the Cloudflare Tunnel. See [docs/ar-preview.md](docs/ar-preview.md). |
| **Automations** | Local rules: a temperature crosses a line, a print starts / pauses / finishes / fails, the wrong filament is loaded, maintenance is overdue → send a notification, set a WLED light, set a Home Assistant sensor, or pause the print. Every firing is logged with what really happened. |
| **Print queue** | Files to print one after another. Each one passes the same Confirm Print check before it starts; anything that doesn't pass waits, with the reason. |
| **Digital twin** | A live 3D view of the toolhead, the part growing layer by layer, and the four docks — pure CSS 3D, the same technique as the games' 3D scenes. |
| **Print health gauge, chamber climate, time-lapse flipbook, celebration card, "continue on another device", calibration reminder after a nozzle swap, weight-based filament forecast, side-by-side settings diff, 28 Home Assistant sensors, MJPEG camera relay** | The supporting cast — see [docs/architecture.md](docs/architecture.md). |

On a phone the layout is rebuilt thumb-first: the main sections and the
Pause / Hold-to-cancel / Start-next controls sit at the bottom of the
screen, and a small live "print pill" follows you across every tab.

### Optional — on by request

| Module | What it does |
|---|---|
| **Filament inventory** | Tracks spools on hand, flags print files needing a colour you don't have, and nudges you if a spool has sat loaded for weeks. |
| **What changed?** | Compares the job about to print against your last few runs of that file, and flags a likely cause when the file has failed before and shares a pattern (a filament type in common, say). |
| **Pre-print sanity check** | Combines maintenance, dock status, and colour-check into one "safe to print?" verdict. |
| **WLED bridge** | Pushes dock ring colours to a WLED-flashed LED strip you already own, over WLED's own JSON HTTP API — no extra hardware to build. |
| **Home Assistant bridge** | Publishes printer state as a handful of REST sensors, so it shows up on an existing HA dashboard — no MQTT broker, no custom component. |
| **Low-latency camera (WebRTC)** | Plays the camera with almost no delay through [go2rtc](https://github.com/AlexxIT/go2rtc), **a separate program you install yourself**. It's one step beyond "nothing to install", so it's off by default. MJPEG stays the default, and the dashboard falls back to it automatically, saying which feed is on. See [docs/low-latency-camera.md](docs/low-latency-camera.md). |

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

Ten games, playable from the dashboard while a long print runs: **Sky
Dash**, **Pong**, **Minesweeper**, **Tetris**, **Pac-Man**, **Brick Break**,
**Blackjack**, **Asteroids**, **Snake** and **2048**. None of them read the
printer; the status strip and the live print pill stay visible on every
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

- The live engine, the fleet, start-print with its interlock, the file
  library, G-code viewer and editor, 3D viewer, pre-flight check, the
  converter, automations, the queue, the digital twin, health gauge,
  chamber panel, time-lapse, celebration card and handoff are complete,
  covered by tests, and were played through in a real (headless) browser
  on desktop and phone sizes, including touch.
- The simulation is now a fleet of three U1s (Workshop, Studio, Garage),
  each with its own history, and it moves: hotends heat toward their
  target, prints progress and finish, the toolhead travels. Demo controls
  can fast-forward it, restart it, or make the next command fail on purpose
  to show how a failure is reported.
- Not verified yet, and said so: the converter's output hasn't been opened
  in Snapmaker Orca itself. Getting Orca running here was tried and blocked
  (see [docs/architecture.md](docs/architecture.md#conversion)). Instead,
  every converted project is checked by a test against the rules in
  Snapmaker Orca's loader source and a snapshot of Snapmaker's real U1
  profiles. That check caught and fixed one real bug. Nothing has touched a
  real Moonraker, a real camera, go2rtc, or a real Cloudflare Tunnel. The AR
  preview has only run against a stand-in for a phone's WebXR, never on a
  real device.

- Maintenance, printer control, notifications, updates, backup, camera
  watchdog, pairing, and the print cost calculator are complete and tested
  against the simulated Moonraker layer. Swapping
  `backend/mock_moonraker.py` for a real Moonraker HTTP client is the only
  change needed to run any of it against an actual printer — nothing else
  in the project talks to the printer directly.
- Filament inventory, the What-changed check, and the pre-print sanity check
  are complete and tested; they're optional and off by default.
- The WLED and Home Assistant bridges are complete and tested outbound HTTP
  clients — point either at a real device or instance and it works today;
  leave the host or URL blank and they fail cleanly instead of pretending.
- The LED and colour-check modules have working decision logic and console
  simulations, but no hardware drivers yet.
- `backend/mock_moonraker.py` generates fake print histories (38 jobs over
  about two months for the first printer) and live state that pause /
  resume / cancel / start and temperature changes genuinely change.

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
- **Web server:** `http.server` from the standard library (the threading
  version), plus a hand-written RFC 6455 WebSocket for live updates
- **Frontend:** HTML, CSS, and JavaScript — no framework, no build step;
  raw WebGL for the 3D viewer, the browser's own `DecompressionStream` to
  unzip 3MF files
- **Storage:** plain JSON files
- **Tests:** `unittest` from the standard library, 317 cases
- **Printer API:** Moonraker (simulated for now)

No dependencies. Nothing to install beyond Python itself, and nothing is
fetched from the internet at runtime — no webfonts, no CDN, no analytics.
(Reaching it from outside your home uses Cloudflare's own `cloudflared`
program, which you install separately if you want that — see
[docs/remote-access.md](docs/remote-access.md). The optional low-latency
camera works the same way: it uses go2rtc, which you'd install yourself —
see [docs/low-latency-camera.md](docs/low-latency-camera.md).)
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

Liquid Glass 2.0 adds four things on top: panels **morph** — a sheet of
glass deforms on a spring from one element into another (a printer card
into the overview, a file into its detail view, a button into its dialog,
the active tab sliding along the tab bar); the highlight and some surfaces
**drift gently even at rest**; glass laid over glass (dialogs) uses a
**deeper refraction**, so what's underneath visibly bends more than the
background; and panels **take a tint** from what they're about — the active
filament's colour, a printer's state, a verdict.

## Roadmap

**With access to a U1:**

1. Replace the mock layer with a real Moonraker HTTP client.
2. Confirm maintenance thresholds against how the machine actually wears.
3. Build the LED rings — print the dock brackets, wire the WS2812 chain,
   implement the driver (or wire up WLED instead).
4. Build the color checker — print the sensor housings, mount on the filament
   path, implement the sensor read and calibration.
5. Connect the pre-print blocking (built — it already refuses a print whose
   file doesn't match the filament the printer reports) to the optical
   colour sensor once it exists.
6. Open the converter's output in Snapmaker Orca to confirm it, and test
   the Cloudflare Tunnel setup end to end.

**Beyond that:**

- Chamber climate control (monitoring is built, read-only).
- A full macro builder — deliberately waiting for real hardware to test
  macros against.
- Try the AR preview on a real Android phone, and the low-latency camera
  with a real go2rtc install.
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

With demo data on, a quick tour of the newer parts: **Fleet** to switch
between the three simulated printers; **Files → Add sample files**, open
one, then **Print…** to see the Confirm Print check (the "unsafe example"
file is refused on purpose); **Automations** to build a rule and watch it
fire; and **Modules & devices → Demo controls** to fast-forward a print to
its finish, or to make the next Pause fail and see how that is reported.

(Developed and tested on Python 3.11.)

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
- [docs/remote-access.md](docs/remote-access.md) — reaching the dashboard
  away from home with a Cloudflare Tunnel, safely
- [docs/ar-preview.md](docs/ar-preview.md) — "View on your desk": where AR
  works, and what was and wasn't tested
- [docs/low-latency-camera.md](docs/low-latency-camera.md) — the optional
  WebRTC camera through go2rtc (an extra program you install)

## License

MIT. See [LICENSE](LICENSE).
