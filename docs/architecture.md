# Architecture

## Overview

Deja Vu1 is one web application, grown from three modules to about thirty-five.
It reads printer state from Moonraker through a single connection per
printer, keeps a live copy of it in memory, decides what to show, and
serves a dashboard — plus its own settings and files (pairing, filament
inventory, notification preferences, the file library, automation rules)
that aren't printer data at all.

```
   Snapmaker U1                         (no printer: demo data)
        │
        ▼
   Moonraker  ── the printer's web API (HTTP + WebSocket JSON-RPC)
        │
        ▼
 ┌──────────────────────────────────────────┐
 │  moonraker_client.py  (a real printer)   │
 │  mock_moonraker.py    (the one interface │  ← the only files that
 │   every module calls; simulated printers │    know where printer
 │   live here too)                         │    data comes from
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

`mock_moonraker.py` holds a small fleet of simulated printers and, once
you add one by address, real ones. Every call into it answers for the
*selected* printer — the default one (the first real printer if there is
one, otherwise the first simulated one), unless the caller is inside
`with mock_moonraker.use_printer("u1-studio"):`. The web
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
queue advanced, and a finished print gets its celebration summary. A real
printer isn't stepped: its own connection thread keeps Moonraker's
WebSocket open and merges each `notify_status_update` into its copy, and
the tick only reads that copy from memory — so a slow or lost printer can
never stall the feed. Each printer is its own step of the tick: one that
fails is logged and skipped, and the others still update.

A control action (pause, start…) doesn't wait for the next tick: the server
sends the command, reads the printer straight back, returns that state to
the caller and pushes it to every other open dashboard at once. The browser
only ever shows what came back — see "honest commands" below.

If a WebSocket can't be opened, the browser falls back to asking
`/api/live/snapshot` and `/api/live/events` once a second, and its status
badge says "Polling 1 s" instead of "Live".

## The one rule

**Only `mock_moonraker.py` (and, behind it, `moonraker_client.py`) knows
where printer data comes from.**

Every module that reads printer state asks it for print history, live
state, or update status and gets back a plain Python dictionary. None of
them contain a URL, an HTTP call, or any knowledge of Moonraker's wire
format.

The result: connecting a real printer didn't change the maintenance logic,
printer control, the LED decisions, the colour comparison or the API's
shape. `moonraker_client.py` translates Moonraker's replies into exactly
the dictionaries the simulation has always returned, and
`mock_moonraker.py` passes each call to it for a real printer. That is also
why the whole project is still testable on a laptop with no printer.

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

For a printer added by address, each of these goes to
`moonraker_client.MoonrakerPrinter` instead (see below). The demo and
sandbox hooks refuse a real printer outright.

Each simulated printer also has test and demo hooks — `fail_next(action)`
makes the next command fail exactly as a refusing printer would (raising
`PrinterCommandError`, which the API reports as a 502 with the reason),
and `set_time_scale()` fast-forwards the simulation. The API only exposes
them with an explicit demo request, and never while a real printer is
connected.

The farm sandbox (below) adds more hooks of the same kind, all in this
file: `add_printer()` / `remove_printer()` grow the simulated fleet (up to
24 extra printers; the built-in three can't be removed, and `reset_all()`
drops the extras), and the faults a real farm runs into —
`inject_jam()` and `inject_heater_fault()` (the print stops in error and
lands in history as failed, with Klipper's own wording for the heater
check), `inject_runout()` (the dock errors; the print pauses if that
toolhead was printing), `load_filament()` (a spool swap, right or wrong),
`clear_error()` (a firmware restart), `add_wear()` (completed print hours
added to history, so maintenance comes due by its own counting rather than
by editing its log) and `set_link()` (a network drop: commands fail with
`PrinterCommandError`, readers see the last state that arrived marked
`link_lost`, and the simulation keeps running behind the drop, the way a
printer keeps printing when the Wi-Fi goes). `advance(..., scaled=False)`
takes simulated seconds directly, for the sandbox's "step forward".

### `backend/moonraker_client.py` — the real printer

One `MoonrakerPrinter` per printer added by address (fleet.py's registry,
when the `printer_link` module is on). It keeps a WebSocket open to
Moonraker (JSON-RPC: identify, `server.info`, `printer.objects.list`,
`printer.objects.subscribe`), merges each partial `notify_status_update`
into its copy, re-subscribes after a Klipper restart, pings every 15 s and
reconnects on its own (1 s up to 30 s apart). History and file metadata are
fetched over HTTP on a worker thread, so reading them never waits on the
network. Commands go over HTTP, each checked first against a fresh
reading and then read back until the printer reports the change (or said
not to have). Every exchange is kept in a log for the Details panel
(`GET /api/printers/diagnostics`). Written against Moonraker's, Klipper's
and Snapmaker's U1 source — see [real-printer.md](real-printer.md) for
exactly what was read, what it changed, and what can't be checked without
a printer.

`tests/fake_moonraker.py` is a stand-in Moonraker built from the same
source (not a copy of the simulation): real HTTP and WebSocket, partial
updates, `RESUME` that only takes effect a moment later, the U1's
200-with-error refusal, checksum-checked uploads, 50-job history pages.
`tests/test_moonraker_client.py` holds the client to it, and
`tests/test_real_printer.py` runs the whole dashboard against it with the
printer added through the API.

**Demo and real never mix.** Demo data only ever means simulated printers:
a real printer without a live link answers "not connected" even with demo
data on; the fleet overview lists simulated printers only on a demo
request; "all printers" in a broadcast means the real ones, or — with demo
on — only the simulated ones; the sandbox's targets (`all`, `random`, …)
never include a real printer; and the live WebSocket labels every message
by the printer it is about.

### `backend/modules.py`
The on/off registry for every feature. Metadata only — disabling a module
makes its API routes refuse to answer (`403`, `{"module_disabled": true}`);
the code itself is never unloaded. Deliberately not a real plugin system
that runs arbitrary code — that's a security problem this project doesn't
need to take on.

`GET /api/modules` also returns `routes`: which module owns each GET route,
built by `app.module_routes()` from the same tables the gate reads. The
browser uses it to not ask a switched-off module for data at all (a 403
is logged by every browser as a console error); `getJSON` answers such a
request itself with the same `{"module_disabled": true}`. It re-reads the
module list at least every 20 s, so a module switched on from another
device is noticed.

### Modules that need only a Moonraker connection
`maintenance.py`, `printer_control.py` — complete and tested, against the
simulation and against the stand-in Moonraker. `printer_control` refuses
homing while a print runs (a real `G28` would drive the head through it),
and starts one print at a time per printer.

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
JSON HTTP API) and `home_assistant_bridge.py` (publishes printer state as
REST sensors via Home Assistant's `POST /api/states/<entity_id>`, with a
bearer token). Both, and `notifications.py`'s ntfy / Discord / Telegram
posts, go through `outbound.py`, which turns every network failure into a
sentence (`{"ok": false, "error": ...}`) — a misconfigured strip or HA
instance never takes the dashboard down with it. Each was checked against
the service's own source (`tests/test_outbound.py` has stand-ins that follow
it): WLED ignores a segment it doesn't have unless the request says where
it stops (`wled00/json.cpp`), so every ring segment is sent with its start
and stop, and a one-colour change names every segment; Home Assistant
refuses a state over 255 characters (`MAX_LENGTH_STATE_STATE`) and a
non-admin token; Discord's webhook drops a message silently without
`wait=true`; each service's length limit is respected. Notifications held
back by quiet hours are sent by the live feed once they end, and kept if
they still can't be delivered.

### Files, G-code and 3D
`file_library.py` keeps G-code / 3MF / STL files under `backend/data/files/`
with cached summaries and thumbnails. `gcode_tools.py` walks a G-code file
move by move once and produces metadata, the pre-flight risk check, a
toolpath for the viewer, and small validated edits. It reads every line
**the way Klipper will**: split at `\n` only (`virtual_sdcard.py`),
tokenised with Klipper's own rules (`gcode.py`: upper-cased, words may run
together, a leading `N` line number skipped, only `;` starts a comment),
extrusion relative under `M83` *or* `G91` (`gcode_move.py`), and arcs
followed along their curve with the U1's `gcode_arcs.py` rules — so a file
can't hide an unsafe move in a form the checker skips and the printer runs.
Its result is remembered per file version (size + modification time).
`mesh_tools.py` reads STL and 3MF (following Bambu/Orca-style
`<component>` parts) as a stream — 3MF XML with expat callbacks into compact
arrays, STL a triangle at a time — and draws a PNG thumbnail from an even
sample with a tiny depth-buffered rasterizer, so the largest model an
upload allows takes about 120 MB rather than 1.5 GB. `safe_zip.py` opens
uploaded archives: each part's size is checked before and while it's
unpacked (a zip bomb is refused in words), and every kind of damage is a
worded refusal, never a crash. `sample_files.py`
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

### Running the farm: fleet command center
`fleet.py` also operates printers as a group. `broadcast(action, printers,
params)` sends preheat / pause / resume / cancel / home to several printers
at once — in parallel (a thread pool), each inside its own
`use_printer()`, through `printer_control`'s per-printer functions, so
every existing check still applies. Each printer's outcome is its own row:
`done`, `refused` (the dashboard said no, e.g. nothing to pause),
`printer_failed` (the printer refused), `not_confirmed` (accepted, but the
state read back isn't what the action should leave — the same "expect"
check the single-printer buttons use: the state for pause / resume /
cancel, the target temperatures for preheat), or `not_connected` for
printers registered by address. The headline names every printer that failed.
Preheat values are validated once, before anything is sent.
`route_file()` puts a library file on another printer's queue — or moves
a waiting queue item, removing it from the first queue only once it's on
the second. `history(days, bucket)` sums each printer's
`get_print_history()` into counts, completion / failure / cancel rates
(`None`, not 0%, when there are no prints), grams (split by outcome, so
material spent on failed prints is visible) and hours, per day or week,
per printer and for the farm. A print counts in the day it ended, when
its outcome happened, so a failure just after midnight is today's.
Registered as the `fleet_command` module; broadcasting also needs
`printer_control` on, and routing needs `print_queue` on.

### Making new things: Photo-to-Print Studio
`frontend/studio.js` turns a photo into a colour-layered relief (the
"HueForge" technique) entirely in the browser: the photo is never
uploaded. Each filament colour is a partially translucent layer — a layer
of thickness *h* lets through `exp(-3h / TD)` of the light, Beer–Lambert
style, where TD (transmission distance) is the thickness that hides ~95% —
composited top-down in linear light. For every possible column height it
computes the colour that column shows; each pixel takes the height whose
colour is nearest the photo's in OKLab; where each colour starts is
optimised by coordinate descent over a sample of the image. The mesh is
one column per pixel joined into a single closed solid (walls split at
every height that meets them, so there are no T-junctions; checked by a
script that every edge is met equally from both sides and the volume is
exact). It previews through `DV3D.parseSTL` and `DV3D.Viewer` like any
other model — the viewer gained optional height bands so it can show which
filament prints where — and saves as a binary STL or a 3MF written by a
small built-in ZIP writer (deflated with the browser's `CompressionStream`
where available). The 3MF carries the tool changes in
`Metadata/custom_gcode_per_layer.xml`, in the layout OrcaSlicer's own
reader expects (`bbs_3mf.cpp`, type 2 = ToolChange); not yet confirmed by
opening one in Orca. `backend/photo_studio.py` is the server half: the
palette (your filament inventory's spools when that module is on, with an
*estimated* TD each, labelled as such; otherwise clearly-labelled
suggestions) and `save()`, which checks the model reads, fits the U1's
270 mm volume and isn't absurdly large, reads back the tool changes from a
3MF, and adds it to the file library with origin `studio`.

### Closing the loop: auto-print pipeline
`backend/slicer_bridge.py` slices STL / 3MF models with an OrcaSlicer the
user installed — off by default, never bundled, like go2rtc and
cloudflared. It runs Orca's command line with `subprocess`:
`--slice 0 --load-settings "machine.json;process.json" --load-filaments
"…" --outputdir <temp> model.stl`, which was read from Orca's source
(tag v2.3.2 and main, September 2026: `PrintConfig.cpp` for the options,
`OrcaSlicer.cpp` for `plate_<n>.gcode` and the Linux-only `result.json`,
`Utils.hpp` for the error codes). Preset files are checked before Orca
starts (`type` and `from`, which Orca's loader requires). Every run has a
hard time limit and is killed with its whole process group past it; its
result is judged by what came out — a G-code file that exists and has
printable layers — not by the exit code alone; failures come back in
words with the end of Orca's output; the Orca version is recorded in the
new file's note. The G-code joins the library with origin `sliced`; "slice
and queue" adds it to a printer's queue, where the Confirm Print gate
still decides whether it starts. Slicing runs as a background job (one at
a time) and publishes a `slicer` live event when it ends. For safety the
program path set from the dashboard must be named like Orca (this
dashboard has no login); `DEJAVU_SLICER_PATH` set by whoever starts the
server overrides it. Tested against a stand-in program, never a real
Orca install yet.

### Testing it all: farm sandbox
`backend/sandbox.py` is a control panel on `mock_moonraker.py`'s demo
hooks, not a second simulator. `build_farm()` adds simulated printers
(some mid-print), `teardown()` removes them along with their queues,
maintenance logs and cached live state. A scenario is a list of timed
steps (`at_s`, a target — a printer, `all`, `random`, `random-printing`,
`random-idle` or `previous` — an event and its parameters); five presets
ship with it. The scenario clock moves while playing (a live-feed tick
listener, at the sandbox's speed) or in one jump with `step()`, which
drives `live_feed.tick()` itself in short slices, split at each step's
time — so events, automations, the queue, time-lapse and notifications
all happen when they would have in real time. Each step's outcome is
logged as what really happened (a jam aimed at an idle printer is logged
as refused) and published as a `sandbox` live event. Starting a print
goes through the Confirm Print gate exactly as the queue does. Demo only,
like every other demo hook.

### `backend/led_status.py` / `backend/color_check.py`
Hardware-pending placeholders. The decision logic (state → colour, colour
distance) is real and tested. The hardware write / sensor read is faked —
so with a real printer the colour check reports "no sensor fitted" rather
than passing a simulated reading (with its deliberate demo mismatch) off as
that printer's, and the rings say what they *would* show. See
`hardware-modules.md`.

### `backend/app.py`
The web server, built on Python's standard-library `http.server`. Serves the
frontend folder as static files and answers `/api/*` with JSON. Every route
that reads printer data checks its module's on/off state before checking
the connection; every route that reads the dashboard's own settings checks
only its module state. No framework, so there is nothing to install.

### `frontend/`
Nine files — `index.html`, `style.css` and `app.js` (the original dashboard
and the games), `workshop.css` and `workshop.js` (live connection, fleet,
files, automations, phone layout, Liquid Glass 2.0), `viewer3d.js`
(the STL / 3MF parsers and the WebGL renderer), `studio.js` (the
Photo-to-Print Studio) and `farm.js` + `farm.css` (fleet command center,
fleet history, farm sandbox, auto-print pipeline). `workshop.js` tells the
newer files what happens through window events — `dv-tab`, `dv-refresh`,
`dv-fleet`, `dv-live-event`, `dv-model-open` — rather than them reaching
into its internals. No framework, no build
step, and nothing fetched from any external host: no webfonts, no CDN. The
dashboard runs fully offline, including phone pairing, which talks
directly to this server over the local network.

**No server behind the pages.** The pages can be served without
`backend/app.py` (the public Cloudflare link publishes `frontend/` alone as
static files). `app.js` asks `/api/health` once before any other request;
a network error, a 404 or a non-JSON answer means the server isn't there.
Then `getJSON` / `postJSON` stop sending requests and answer at once with
`{server_missing: true, connected: false}`, `showServerMissing()` shows
the banner, switches Demo data off (the remembered choice is kept), and
gives every card without `data-browser-only` a one-line "needs the Deja Vu1
server" note in place of its body. The browser-only parts: the Studio
(built-in palette, download instead of save), local G-code / STL / 3MF
viewing (`DV3D.parseGcode` in `viewer3d.js` reads the toolpath in the
browser — moves, arcs, G92, T0–T3; its footprint includes every extrusion,
where the server's pre-flight leaves out-of-bounds points out of the
footprint and reports them instead), AR, the games and the preferences.

**Honest commands.** Every control button goes through one function
(`runCommand` in `app.js`): it shows "Pausing…" at once, sends the command,
and then shows only what the printer reports back — or the failure, in
words. The UI never switches to "Paused" because a button was pressed.

**Smooth, not snapping.** Continuous visuals (the digital twin's toolhead,
the progress rings, the status strip's bar, the gauge needle) ease toward each new reading with the
same easing Block World uses for movement — each frame closes a fixed
fraction (0.18) of the gap — made frame-rate independent.

**Phones.** Below 720 px wide the top tab bar is replaced by a bottom
navigation bar and a quick-action dock (Pause/Resume, Hold-to-cancel, Start
next). Hold-to-cancel uses `touch-action: none` and releases on
`pointerup` / `pointercancel` anywhere on the page, so a finger sliding off
the button can never leave a hold running. While the quick actions show,
their top line carries the print's progress, so the floating print pill
isn't stacked on top as a second pane of glass. The pill (when it does
show) and the "continue here" offer move into the dock's own column
(`initDockStack`), so they sit above it by its real height, and the page's
bottom padding follows that height. The header is one row, and tucks away
while you scroll down a page, coming back as soon as you scroll up.

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

Nine tabs hold everything, and every one is always showing: Fleet (with
the farm sandbox at the bottom), Overview, Control, Files (with Auto-print),
Photo studio, Automations, Care (maintenance, then filament & colour),
Settings (modules & devices) and Games. The folded-in sections keep their
own ids (`tab-sandbox`, `tab-autoprint`, `tab-filament`, class `tab-sub`);
their old tab names still work in `showTab()`, opening the parent tab and
scrolling to the section. The labels fit one line on a laptop; on a
narrower screen the bar wraps to a second row rather than hiding a tab.
On a phone the bottom bar holds Fleet, Now, Control and Files, and More
opens the other five. A status strip and a floating live "print pill" stay
visible on every tab — including mid-game. The printer chip in the header
opens a list of printers; choosing one there keeps you on the tab you're
on. That list is a small glass menu that live updates never re-render, so
a refresh can't close it under the pointer.

**Accent colour.** Blue by default; Settings > Preferences switches it.
Each choice in `ACCENTS` (app.js) sets `--accent`, `--accent-light`,
`--on-accent` (text on an accent fill) and `--accent-text` together, each
pair measured for WCAG AA. Only a colour someone picks is remembered.

**Colour for text.** `--accent`, `--ok`, `--warn` and `--bad` are for fills,
dots, bars and borders; as small text they fall below WCAG's 4.5:1 (the
old orange measured about 2.4:1). Text uses `--accent-text`, `--ok-text`,
`--warn-text` and `--bad-text`, each measured at 4.7:1 or better on white,
on the page background and on the pale tint of its own colour that badges
sit on.

**Switched-off modules.** A panel whose module is off says so the same way
everywhere (`moduleDisabledEmpty`), with a Turn on button. Controls that
belong to a module carry `data-module-body="<id>"` and hide while it is
off; a `data-module-off="<id>"` slot shows the off state in their place.
Settings fields have visible labels (`.field`), because a placeholder
disappears the moment the box holds a value.

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

## Connecting a real printer

Done: add it under **Fleet → Add a printer**. See
[real-printer.md](real-printer.md).

For the hardware modules, implement `_write_to_hardware()` in `led_status.py`
and `connect_sensor()` / `calibrate()` / `read_sensor()` in `color_check.py`.
Everything that calls them already works.

## Testing

544 tests, using Python's built-in `unittest`:

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

The four flagship features follow it too: `test_fleet_command.py`
(partial broadcasts name each failure, printer failures vs. refusals, a
dropped link, routing and moving queue items, history totals matching the
raw history), `test_photo_studio.py`, `test_slicer_bridge.py` (a stand-in
"orca-slicer" that can succeed, fail with an Orca error code, crash, hang
past the time limit, or write nothing, an empty file or one with no
printable layers — each must end in a worded failure with nothing added to
the library), `test_sandbox.py` (scenarios fire in order at their time, the
live feed sees the failures they cause, starts go through Confirm Print),
the sandbox hooks in `test_mock_moonraker.py`, and `test_api_flagship.py`
for their routes, module switches and the no-printer-no-figures rule. The
studio's mesh builder was checked separately in Node (every edge met
equally from both sides, exact volume), outside the stdlib test suite.

The real-hardware pass added `test_moonraker_client.py` (the client against
`fake_moonraker.py` over real sockets, and every network failure ending in
words), `test_real_printer.py` (the whole dashboard with a printer added
through the API: every printer route, printing from the library, the
finish summary and spool deduction, and demo and real kept apart),
`test_outbound.py` (WLED, Home Assistant and the notification services
against stand-ins built from their source), `test_concurrency.py` (slow
printers on real threads: the queue never freezes, two devices never start
two prints, a move is all-or-nothing), and hostile-input cases in
`test_gcode_tools.py` and `test_mesh_tools.py`.

The browser side was checked by driving the real dashboard in headless
Chromium (Playwright) at desktop and phone sizes, with touch input for the
hold-to-cancel control. Those scripts aren't part of this repository's test
suite, which stays dependency-free.
