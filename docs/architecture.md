# Architecture

## Overview

Deja Vu1 is one web application, grown from three modules to about thirty.
It reads printer state from Moonraker through a single connection per
printer, keeps a live copy of it in memory, decides what to show, and
serves a dashboard — plus its own settings and files (pairing, filament
inventory, notification preferences, the file library, automation rules)
that aren't printer data at all.

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
      live_feed.py ───┤  ── 250 ms live cache, events, automations, queue
                      ▼
                   app.py  ── HTTP server + JSON API + WebSocket (/api/live)
                      │        (websocket.py: hand-written RFC 6455)
                      ▼
                 frontend/  ── the dashboard in a browser
```

### Which printer?

`mock_moonraker.py` holds a small fleet of simulated printers. Every call
into it answers for the *selected* printer — the default one, unless the
caller is inside `with mock_moonraker.use_printer("u1-studio"):`. The web
server wraps every request in that, from a `?printer=` parameter, so every
existing module (maintenance, control, cost, sanity check…) works for any
printer without a single change to its own code. Maintenance logs are kept
per printer; the first printer keeps the original file name, so an existing
log carries straight over.

### Live updates

`live_feed.py` runs one background thread. Every 250 ms — Klipper's own
fixed `SUBSCRIPTION_REFRESH_TIME` in `klippy/webhooks.py`, so no dashboard
can see fresher data — it steps each printer forward, stores a numbered
snapshot, and wakes every waiting WebSocket. It also notices *changes*
(started, paused, resumed, finished, failed, cancelled) and turns them into
numbered events: automations are checked, time-lapse frames recorded, the
queue advanced, and a finished print gets its celebration summary. With a
real printer this thread would hold Moonraker's WebSocket open and apply
each `notify_status_update` instead of stepping a simulation.

A control action (pause, start…) doesn't wait for the next tick: the server
sends the command, reads the printer straight back, returns that state to
the caller and pushes it to every other open dashboard at once. The browser
only ever shows what came back — see "honest commands" below.

If a WebSocket can't be opened, the browser falls back to asking
`/api/live/snapshot` and `/api/live/events` once a second, and its status
badge says "Polling 1 s" instead of "Live".

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
| `upload_file()` / `start_print()` | `POST /server/files/upload`, `POST /printer/print/start` |
| `advance()` | one 250 ms step — stands in for `printer.objects.subscribe` updates |

Each simulated printer also has test and demo hooks — `fail_next(action)`
makes the next command fail exactly as a refusing printer would (raising
`PrinterCommandError`, which the API reports as a 502 with the reason),
and `set_time_scale()` fast-forwards the simulation. The API only exposes
them with an explicit demo request, and never while a real printer is
connected.

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

### Files, G-code and 3D
`file_library.py` keeps G-code / 3MF / STL files under `backend/data/files/`
with cached summaries and thumbnails. `gcode_tools.py` walks a G-code file
move by move once and produces metadata, the pre-flight risk check, a
toolpath for the viewer, and small validated edits. `mesh_tools.py` reads
STL and 3MF (following Bambu/Orca-style `<component>` parts) and draws a
PNG thumbnail with a tiny depth-buffered rasterizer. `sample_files.py`
builds the "Add sample files" set, each labelled for what it is.

### Starting prints safely
`print_gate.py` is the Confirm Print summary and the interlock:
`printer_control.start_print()` re-runs it at the moment of starting and
raises `PrintBlocked` when the verdict is "blocked", or "confirm" without
an explicit confirmation. `print_queue.py` runs every queued start through
the same gate. `sanity_check.py` now separates blocking reasons (dock
error, colour mismatch) from warnings (overdue maintenance, a close colour
call), keeping its original `safe_to_print` / `reasons` fields.

### Automations
`automations.py` stores rules as JSON, validates each completely before
saving, fires on the edge (false → true) with a cooldown, and runs actions
on a worker thread so a slow network call never stalls the live feed.
Every run is logged with what actually happened. Rules made with demo data
on only watch simulated printers and label anything they send "[Demo
data]".

### Conversion
`converter_3mf.py` rewrites only `Metadata/project_settings.config` of a
MakerWorld (Bambu Studio) or NexPrint (Elegoo Slicer) project. It follows
Snapmaker Orca's own loader (`PresetBundle.cpp`, `Preset.cpp`
`load_external_preset`): `inherits_group` names Snapmaker's U1 profiles
and `different_settings_to_system` lists what the project keeps, so every
other printer setting — bed, start/end G-code, tool changes — comes from
Snapmaker's profile. Profile names come from Snapmaker's repository
(`resources/profiles/Snapmaker`). Not yet confirmed by opening the result
in Snapmaker Orca.

**Why it hasn't been opened in Orca yet.** We made one attempt to run
Snapmaker Orca headless in the build environment, and it was blocked. The
v2.4.0 release downloads can't be reached from there (GitHub answered 403 for
the release assets page). Building from source means first compiling
about 30 libraries Orca bundles (`deps/CMakeLists.txt`: Boost, wxWidgets,
OpenCASCADE, CGAL, OpenVDB, OpenCV and more; `build_linux.sh -d`), each
downloaded from its own site. That's far beyond the environment's
10-minute limit per command, and it wasn't attempted.

**What checks it instead.** `tests/test_converter_orca_rules.py` holds every
converted project to what Snapmaker Orca's loader actually reads, from its
source at commit `da53bc5` of
[Snapmaker/OrcaSlicer](https://github.com/Snapmaker/OrcaSlicer):
- values are strings or lists of strings (`Config.cpp`, `load_from_json`)
- the filament count is the length of `filament_colour`
- `inherits_group` and `different_settings_to_system` are exactly that count
  + 2 long: print profile first, then each filament, then the printer
  (`PresetBundle.cpp`, `load_config_file_config`)
- every profile named is a real Snapmaker profile that lists the chosen U1 as
  compatible
- every "kept" setting belongs to that kind of profile (`Preset.cpp`'s option
  lists)
- bed size and height match Snapmaker's U1 profile exactly

It runs on 13 kinds of project (both samples, 1 to 6 filaments, every nozzle
size, missing colours, unknown materials). Snapmaker's profile facts are
stored in `tests/fixtures/snapmaker_u1_profiles.json`, made by
`tools/snapshot_snapmaker_profiles.py`. Run that again when Snapmaker updates
its profiles. The check found one real bug, now fixed: a project with more
filament types than colours made Orca read a filament's name as the printer.
Missing colours are now filled with white, with a warning.

### Smaller pieces
`fleet.py` (registered printers + the overview rows), `timelapse.py` (a
frame every two layers, simulated frames drawn as labelled SVG),
`handoff.py` ("continue on another device", memory only), and `camera.py`'s
MJPEG relay, which only ever passes on something that is actually a
camera stream. `webrtc_camera.py` (optional, off by default) passes the
browser's WebRTC offer to a go2rtc the user runs themselves
(`POST /api/webrtc?src=<stream>`, JSON offer → JSON answer, read from go2rtc's
`internal/webrtc/server.go`). It never imports or needs go2rtc: any failure
comes back in words, and the browser falls back to MJPEG. See
[low-latency-camera.md](low-latency-camera.md). `frontend/ar.js` is the "View
on your desk" AR preview: WebXR `immersive-ar` + `hit-test` on the same
geometry `DV3D.parseModel` produces, converted from mm (Z up) to metres
(Y up). See [ar-preview.md](ar-preview.md).

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
Six files — `index.html`, `style.css` and `app.js` (the original dashboard
and the games), `workshop.css` and `workshop.js` (live connection, fleet,
files, automations, phone layout, Liquid Glass 2.0), and `viewer3d.js`
(the STL / 3MF parsers and the WebGL renderer). No framework, no build
step, and nothing fetched from any external host: no webfonts, no CDN. The
dashboard runs fully offline, including phone pairing, which talks
directly to this server over the local network.

**Honest commands.** Every control button goes through one function
(`runCommand` in `app.js`): it shows "Pausing…" at once, sends the command,
and then shows only what the printer reports back — or the failure, in
words. The UI never switches to "Paused" because a button was pressed.

**Smooth, not snapping.** Continuous visuals (the digital twin's toolhead,
the progress rings, the gauge needle) ease toward each new reading with the
same easing Block World uses for movement — each frame closes a fixed
fraction (0.18) of the gap — made frame-rate independent.

**Phones.** Below 720 px wide the top tab bar is replaced by a bottom
navigation bar and a quick-action dock (Pause/Resume, Hold-to-cancel, Start
next). Hold-to-cancel uses `touch-action: none` and releases on
`pointerup` / `pointercancel` anywhere on the page, so a finger sliding off
the button can never leave a hold running.

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

**Liquid Glass 2.0** adds: spring-driven *morphing* (a glass sheet deforms
from one element into another, animating position, size, corner radius and
the displacement filter's strength together); *ambient* motion (the
highlight drifts at rest; hero surfaces use a refraction filter that
breathes); *depth* (dialogs use a deeper displacement filter, so glass
under glass bends more than the background); and *tint* (panels take a
colour from what they're about — filament, printer state, verdict).

Nine tabs (Fleet, Overview, Printer control, Files, Automations,
Maintenance, Filament & colour, Modules & devices, While you wait) hold
everything; a status strip and a floating live "print pill" stay visible on
every tab — including mid-game.

The Block World game (its code is still in `app.js`, though it isn't in the
current game picker) generalizes the same rotate-by-negative-yaw-
around-the-camera trick Echo Maze uses for its room-to-room turns, extended
from 90-degree snaps to continuous free movement:
`world.transform = rotateZ(-yaw) translate3d(-px, -py, 0)`. The translate
runs first (recentring the world on the player), then the rotate turns that
around the now-centered camera — so the terrain slides and spins past
naturally as the player walks and turns, all still plain CSS 3D transforms
with no canvas or WebGL.

Each terrain tile is one flat top face, positioned with real elevation via
`translateZ`, plus a real rotated CSS side face — `rotateX(90deg)` for a
north/south-facing wall, `rotateY(90deg)` for east/west — but only toward a
neighboring tile that's actually lower. That mirrors the face-culling a
real voxel engine does (never draw a face nothing will occlude), done by
hand for the ~80 tiles in one chunk instead of by a renderer. The chunk
itself comes from a small deterministic pseudo-noise function (a few
out-of-phase sine/cosine waves, not real Perlin noise) seeded per level, so
each level is a fresh but reproducible-looking chunk. Player-built blocks
reuse the exact same tile-rendering function with all four neighbor heights
fixed at 0, so a placed block always gets all four side faces — free-
standing, unlike terrain tiles that lean on their neighbors.

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

Plain JSON files under `backend/data/` — maintenance logs (one per
printer), module toggles, filament inventory, notification settings and
queue, paired devices, registered printers, automation rules and their log,
the print queue, camera settings — plus the file library
(`backend/data/files/`), thumbnails and time-lapse frames. No
database to install; each is created on first use and regenerated if
deleted. The whole directory is gitignored, so a fresh clone always starts
from the same seeded demo state.

## Swapping in a real printer

1. Rewrite the functions in `mock_moonraker.py` to call a real Moonraker
   instance over HTTP instead of mutating an in-memory dict, and make
   `advance()` apply Moonraker's `notify_status_update` messages.
2. Map each registered printer (`fleet.py`) to its own client.
3. Nothing else changes — every other module already only talks to this file.

For the hardware modules, implement `_write_to_hardware()` in `led_status.py`
and `connect_sensor()` / `calibrate()` / `read_sensor()` in `color_check.py`.
Everything that calls them already works.

## Testing

317 tests, using Python's built-in `unittest`:

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

The newer modules follow the same one-file-per-module pattern:
`test_mock_moonraker.py`, `test_websocket.py` (the RFC 6455 handshake
example, framing, and a real socket client against `/api/live`),
`test_live_feed.py`, `test_gcode_tools.py`, `test_mesh_tools.py`,
`test_converter_3mf.py`, `test_file_library.py`, `test_print_gate.py`
(including the start-print interlock), `test_print_queue.py`,
`test_automations.py`, `test_fleet.py`, `test_timelapse.py`,
`test_handoff.py`, `test_camera_stream.py` (a local fake MJPEG camera), and
`test_api_features.py` for the new routes — including the automation demo
path end to end, a forced printer failure reported as a failure, and
commands from another website being refused.

The browser side was checked by driving the real dashboard in headless
Chromium (Playwright) at desktop and phone sizes, with touch input for the
hold-to-cancel control. Those scripts aren't part of this repository's test
suite, which stays dependency-free.
