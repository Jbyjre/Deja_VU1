# Architecture

## Overview

Deja Vu1 is one web application, grown from three modules to a dozen. It
reads printer state from Moonraker through a single connection, decides what
to show, and serves a dashboard — plus its own settings (pairing, filament
inventory, notification preferences) that aren't printer data at all.

```
   Snapmaker U1
        │
        ▼
   Moonraker  ── the printer's web API
        │
        ▼
 ┌──────────────────────────────────────────┐
 │  mock_moonraker.py                       │  ← the only file that
 │  (today: fake data. later: real HTTP)    │    talks to the printer
 └──────────────────────────────────────────┘
        │
   ┌────┼──────┬───────────┬──────────────┐
   ▼    ▼      ▼           ▼              ▼
 maintenance  printer_control  led_status  color_check  ...
   │    │      │           │              │
   └────┴──────┴─────┬─────┴──────────────┘
                      ▼
                  modules.py  ── on/off registry, gates every route below
                      │
                      ▼
                   app.py  ── HTTP server + JSON API
                      │
                      ▼
                 frontend/  ── the dashboard in a browser
```

## The one rule

**Only `mock_moonraker.py` knows where printer data comes from.**

Every module that reads printer state asks it for print history, live
state, or update status and gets back a plain Python dictionary. None of
them contain a URL, an HTTP call, or any knowledge of Moonraker's wire
format.

The result: connecting a real printer means rewriting one file. The
maintenance logic, printer control, the LED decisions, the colour
comparison, the API, and the entire frontend stay exactly as they are. That
is also why the whole project is testable on a laptop with no printer
attached.

Modules that hold the dashboard's *own* settings — `modules.py`,
`pairing.py`, `filament_inventory.py`, `notifications.py` — don't go through
`mock_moonraker.py` at all, because they aren't printer data. They read and
write their own JSON files directly.

## Files

### `backend/mock_moonraker.py`
Pretends to be Moonraker. Generates 38 fake print jobs spread over about two
months, plus mutable live printer state, a console log of commands sent to
it, and simulated update-status. Print history uses a fixed random seed so
it's identical on every run; live state is a real mutable in-memory object —
pause/resume/cancel and temperature changes genuinely change what
`get_printer_state()` returns next, the same way a real printer's state
changes and then forgets it on a power cycle (this file resets on restart
too, deliberately).

| Function | Real Moonraker endpoint |
|---|---|
| `get_print_history()` | `GET /server/history/list` |
| `get_printer_state()` | `GET /printer/objects/query` |
| `pause_print()` / `resume_print()` / `cancel_print()` | `POST /printer/print/{pause,resume,cancel}` |
| `set_target_temperature()` / `home_axes()` / `run_gcode()` | `POST /printer/gcode/script` |
| `get_update_status()` | `GET /machine/update/status` |
| `get_current_job_requirements()` | G-code file metadata |

### `backend/modules.py`
The on/off registry for every feature. Metadata only — disabling a module
makes its API routes refuse to answer (`403`, `{"module_disabled": true}`);
the code itself is never unloaded. Deliberately not a real plugin system
that runs arbitrary code — that's a security problem this project doesn't
need to take on.

### Modules that need only a Moonraker connection
`maintenance.py`, `printer_control.py` — complete, tested, work the moment a
real printer is wired in.

### Modules that read printer history but add their own logic
`comparison.py` ("what changed?" + likely-cause, by pattern-matching your own
past failures — never a prediction, only ever "this looks like what happened
before"), `sanity_check.py` (combines maintenance + LED + colour-check into
one verdict), `cost_calculator.py` (prices filament by material plus
electricity, for both finished jobs and one in progress — extrapolating
grams from elapsed progress, and explicit about that being an estimate).

### Modules that are their own small settings stores
`filament_inventory.py`, `notifications.py` (priority-aware: failures always
send immediately, successes respect configured quiet hours), `pairing.py`
(device pairing by one-time code — connects devices, doesn't gate access;
this dashboard has no login wall and pairing doesn't add one), `backup.py`
(zips the dashboard's own data directory), `camera.py` (a frozen-feed
watchdog; the actual video stream needs a real camera), `updates.py` (reads
`mock_moonraker.get_update_status()`).

### Modules that push this dashboard's data outward
`wled_bridge.py` (pushes dock ring colours to a WLED device over its own
JSON HTTP API — a real network client, not a simulation) and
`home_assistant_bridge.py` (publishes printer state as REST sensors via
Home Assistant's `POST /api/states/<entity_id>`, with a bearer token). Both
fail cleanly with `{"ok": false, "error": ...}` rather than raising when
unconfigured or unreachable, the same pattern `notifications.py` uses for
its webhooks — a misconfigured strip or HA instance should never take the
dashboard down with it.

### `backend/led_status.py` / `backend/color_check.py`
Hardware-pending placeholders. The decision logic (state → colour, colour
distance) is real and tested. The hardware write / sensor read is faked.
See `hardware-modules.md`.

### `backend/app.py`
The web server, built on Python's standard-library `http.server`. Serves the
frontend folder as static files and answers `/api/*` with JSON. Every route
that reads printer data checks its module's on/off state before checking
the connection; every route that reads the dashboard's own settings checks
only its module state. No framework, so there is nothing to install.

### `frontend/`
Three files — HTML, CSS, and JavaScript. No framework, no build step, and
nothing fetched from any external host: no webfonts, no CDN. The dashboard
runs fully offline, including phone pairing, which talks directly to this
server over the local network.

The visual treatment is Apple Liquid Glass, built from five layers: a
backdrop blur, edge refraction via an SVG displacement filter, a specular
highlight that tracks the pointer, a thin bright rim, and an elevation
shadow. Only Chromium applies an SVG filter inside `backdrop-filter`; Safari
and Firefox drop that one declaration and keep the plain blur, which still
looks correct.

Repeated elements — task rows, module rows, stat tiles — deliberately share
one glass surface with plain dividers rather than each getting its own
`backdrop-filter`. One blurred region per row is both slower and the most
common tell of imitation glass; a real pane of glass can't cleanly sample
another pane of glass sitting right next to it either.

`prefers-reduced-transparency`, `prefers-reduced-motion`, and
`prefers-contrast` are all handled: the first two drop the blur and the
animation, the third swaps in solid panels with real borders.

Six tabs (Overview, Printer control, Maintenance, Filament & colour,
Modules & devices, While you wait) hold everything; a status strip stays
pinned above all six so a print's progress is visible no matter which tab —
including mid-game — you're on.

The games tab's newest addition, Beacon Run, generalizes the same rotate-
by-negative-yaw-around-the-camera trick Echo Maze uses for its room-to-room
turns, extended from 90-degree snaps to continuous free movement:
`world.transform = rotateZ(-yaw) translate3d(-px, -py, 0)`. The translate
runs first (recentring the world on the player), then the rotate turns that
around the now-centered camera — so beacons slide and spin past naturally
as the player walks and turns, all still plain CSS 3D transforms with no
canvas or WebGL.

## API

See the docstring at the top of `backend/app.py` for the full, current route
list — it's kept there rather than duplicated here so it can't drift out of
sync with the code.

### No printer, no figures

With no printer connected, every route that reads *printer* data returns
exactly this and nothing else:

```json
{"connected": false, "demo": false}
```

Adding `?demo=1` opts in to simulated data explicitly — what the dashboard's
"Demo data" switch sends. Everything returned that way is flagged
`"demo": true`. This gate is enforced in the server, not hidden in CSS —
`curl` gets the same answer the browser does.

Routes that read the dashboard's *own* settings (modules, pairing,
notification preferences, filament inventory) are never gated by
connection/demo — only by their own module's on/off state, since they
aren't printer figures and work the same with or without a printer.

## Storage

Plain JSON files under `backend/data/` — maintenance log, module toggles,
filament inventory, notification settings and queue, paired devices. No
database to install; each is created on first use and regenerated if
deleted. The whole directory is gitignored, so a fresh clone always starts
from the same seeded demo state.

## Swapping in a real printer

1. Rewrite the functions in `mock_moonraker.py` to call a real Moonraker
   instance over HTTP instead of mutating an in-memory dict.
2. Nothing else changes — every other module already only talks to this file.

For the hardware modules, implement `_write_to_hardware()` in `led_status.py`
and `connect_sensor()` / `calibrate()` / `read_sensor()` in `color_check.py`.
Everything that calls them already works.

## Testing

170 tests, using Python's built-in `unittest`:

```
python3 -m unittest discover tests
```

One test file per backend module (`test_maintenance.py`,
`test_printer_control.py`, `test_notifications.py`, `test_filament_inventory.py`,
`test_comparison.py`, `test_sanity_check.py`, `test_support_modules.py`,
`test_modules_registry.py`, `test_cost_calculator.py`, `test_bridges.py`
(WLED + Home Assistant, pointed at unreachable addresses to confirm they
fail cleanly rather than hang or raise), plus the original `test_modules.py`
for the LED and colour-check placeholders), and `test_api.py` starting the
real server on a spare port to test what a browser would actually receive —
module gating, connection gating, and the no-printer-no-figures rule.
