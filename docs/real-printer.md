# Connecting a real printer

Deja Vu1 talks to a printer through **Moonraker**, the web API that runs on
the printer (on the Snapmaker U1 it is built in). There is nothing to
install on the printer.

## Adding it

1. Find the printer's address on your network - the same one Fluidd or
   Mainsail uses, usually `http://<printer-ip>:7125`.
2. In the dashboard: **Printers → Add a printer**. Give it a name and type the
   address (just `192.168.1.50` is enough: the app adds `http://` and port
   7125). Press **Test**. If the printer's web page asks for a login (the
   Extended Firmware's **Web Authentication** creates an `admin` user with a
   random password), a sign-in row appears: enter that username and password
   once. The app signs in (`POST /access/login`), reads the printer's API key
   with that token (`GET /access/api_key`, both from Moonraker's
   `authorization.py`) and keeps only the key. You can also paste an API key
   yourself.
3. It connects straight away. The row shows **Connected** within a few
   seconds, or says in words why it isn't (see below). The dashboard then
   opens on that printer, with demo data off.

`Details` on the printer's row shows everything a first connection needs
someone to see: whether the link is open, Klipper's state, which toolheads
and chamber sensor were found, how much print history was read, and the
newest 14 exchanges with Moonraker - what was sent and what came back. The
full record, with the last 300 exchanges, is at
`GET /api/printers/diagnostics?printer=<id>` (the id is listed at
`GET /api/fleet/registry`). The
server's terminal prints every command sent and every failure; start it
with `DEJAVU_MOONRAKER_LOG=1` to print every exchange, WebSocket messages
included.

## Finding it without typing an address

**Printers → Add a printer → Find printers on my network** (`backend/discovery.py`):

1. It asks the network over multicast DNS (mDNS). Snapmaker's U1 build of
   Moonraker announces `_snapmaker._tcp.local.`, with its IP address in the
   record's text and a host name `U1-<serial>.local.`
   ([Snapmaker/u1-moonraker](https://github.com/Snapmaker/u1-moonraker)
   `a308cfa`, `moonraker/components/zeroconf.py`; `lava/moonraker.conf`
   turns `[zeroconf]` on). Stock Moonraker announces `_moonraker._tcp.local.`.
2. Where a router drops multicast, it tries port 7125 (the port in the
   U1's shipped `lava/moonraker.conf`) on every address of this computer's
   own home network: 10.x, 172.16-31.x or 192.168.x only, never anything
   else.
3. Each answer is checked with `GET /server/info` and
   `GET /printer/objects/list`: only real Moonrakers are listed, a U1 is
   recognised by Snapmaker's `print_task_config` object, and one that
   needs an API key says so.

**Test** (`POST /api/printers/test`) runs step 3 on a typed address before
it's added. A port outside 1-65535 is refused in words.

Not yet confirmed on a real U1: that its announcement reaches a computer
on the same network (some routers block multicast; step 2 covers that).

## What happens if something is wrong

| What's wrong | What you see |
|---|---|
| Wrong address or port | "…refused the connection - is Moonraker running there, and is <port> its port? (Moonraker usually uses 7125)" |
| Printer off / not on this network | "No answer from … within 5 s - is the printer on and on this network?" |
| A name that doesn't resolve | "Can't find 'u1.local' on the network - check the printer's address" |
| Moonraker wants a key | "The printer answered and asks for a sign-in", "Not connected: Unauthorized", or "Moonraker refused the live connection (401) - it needs an API key, or this computer added to trusted_clients". Remove the printer and add it again, using the sign-in row or its key (**Printers → Add a printer**), or add this computer to `[authorization] trusted_clients` |
| Wrong printer password | "The printer didn't accept that username and password. Check them on the printer's own web page and try again" |
| A file name with `#`, `*` or `;` | "The U1 can't start a file whose name contains #, * or ;". Klipper ends a command's arguments at those characters (`klippy/gcode.py`), and firmware 2.0.0 refuses the empty name that results. Rename the file |
| Moonraker up, Klipper not | "Moonraker is running, but Klipper isn't connected to it" (retried every 2 s, as Moonraker's docs say) |
| Klipper restarting | The printer shows an error ("Moonraker is running, but Klipper isn't connected to it", or "Klipper is starting up"), then recovers by itself |
| Wi-Fi drops | Its last reading stays on screen, labelled "No answer since 14:02"; commands are refused (the dashboard says no printer is connected); it reconnects by itself (1 s, 2 s, 4 s … up to 30 s apart) |
| The address is some other web page | "…answered "HTTP/1.1 200 OK" instead of opening a live connection - is that address Moonraker?" (or "… has no /websocket" when it answers 404) |

A printer that isn't connected never shows numbers, and demo data never
fills it in: demo data only ever means the simulation.

## What was checked, and against what

There is no physical printer in this project's build environment, so the
connection (`backend/moonraker_client.py`) was written against the real
thing's **source code and documentation**, and tested against a stand-in
server built from the same source (`tests/fake_moonraker.py`), over real
sockets - real HTTP, a real WebSocket handshake, masked frames, JSON-RPC.

Sources, at the commits read:

- Moonraker - [Arksine/moonraker](https://github.com/Arksine/moonraker) `1cfb0c4`
- Snapmaker's U1 Moonraker - [Snapmaker/u1-moonraker](https://github.com/Snapmaker/u1-moonraker) `a308cfa`
- Klipper - [Klipper3d/klipper](https://github.com/Klipper3d/klipper) `ce7002b`
- Snapmaker's U1 Klipper - [Snapmaker/u1-klipper](https://github.com/Snapmaker/u1-klipper) `10f2f69`, re-read at `93cb12f` (firmware 2.0.0, October 2026)
- The community Extended Firmware - [paxx12/SnapmakerU1-Extended-Firmware](https://github.com/paxx12/SnapmakerU1-Extended-Firmware) `417e639`, and its camera service [paxx12/v4l2-mpp](https://github.com/paxx12/v4l2-mpp) `9279584` (camera addresses, the Web Authentication login)

What reading them changed - each of these would have been a bug on the
first real connection, and none of them could show up against the
simulation:

- **States.** Klipper's idle state is `standby`, and a cancelled print
  stays `cancelled` (the simulation used `ready` for both). A state Klipper
  might add later is reported as an error, never guessed at.
- **Partial updates.** `notify_status_update` carries only the fields that
  changed (Klipper's `webhooks.py`); each is merged into the last full
  copy. Replacing the copy would have lost every temperature that didn't
  change.
- **Commands return "ok", not a state.** `PAUSE` and `CANCEL` change the
  state before replying; `RESUME` and `SDCARD_PRINT_FILE` only schedule it
  (`virtual_sdcard.py`), so the dashboard reads the printer back until it
  moves, and says so if it doesn't. `PAUSE` on an idle printer answers
  "ok" and does nothing useful, so the dashboard's own checks come first.
- **The U1's refusal looks like success.** Its Moonraker refuses a start on
  a busy printer with a *200* whose result is `{"state": "error", ...}`
  (`klippy_apis.py`); that is treated as a failure.
- **Temperatures name the physical heater.** On the U1, `M104 T1` goes
  through the print's filament mapping (`extruder_map_table`), so "heat
  T1" could heat another head. The dashboard sends
  `SET_HEATER_TEMPERATURE HEATER=extruder1`.
- **The U1's own objects.** Its toolheads are `extruder` …
  `extruder3`; each head's dock sensor reports `PARKED`/`ACTIVATE`;
  `print_task_config` says what each head has loaded (`filament_exist`,
  `filament_type`, `filament_color_rgba`) and how the file's T0–T3 map to
  heads. "NONE" there means unknown - shown as unknown, never as white.
  The Confirm Print check follows the mapping to the head that will really
  print.
- **History.** 50 jobs a page unless asked for more (maintenance would
  have undercounted print hours); newest first; the running job listed as
  `in_progress` (it was being counted as a failure); times in Unix
  seconds; filament in millimetres (weighed with the slicer's own figure
  where the file has one).
- **File metadata.** The U1's Moonraker names its fields differently from
  upstream (`filament_colour` as one `#RRGGBB;#RRGGBB` string,
  `filament_weight` per filament, no `referenced_tools`); both are read.
- **Uploads.** Sent with a SHA-256 checksum, which Moonraker checks (422 if
  the file arrived damaged), so a truncated upload is never printed. The
  upload reply is the one reply not wrapped in `{"result": ...}`.
- **Errors.** `{"error": {"code", "message"}}`; Klipper's refusals are 400
  with its own words; the U1 sometimes sends a JSON-coded message, which is
  unpacked into words.
- **M112** typed in the console uses Moonraker's emergency stop (on the U1,
  over the WebSocket only), because `M112` through the G-code endpoint
  waits behind every queued move.
- **Homing mid-print is refused.** Klipper would run `G28` between the
  print's own moves.
- **Layers.** Klipper only knows the layer when the slicer sends
  `SET_PRINT_STATS_INFO`; otherwise it is estimated from the nozzle height
  and the file's layer height (the way Mainsail and Fluidd do), and marked
  as an estimate.

## What cannot be checked without the printer

A good test suite is not a real machine:

- **None of this has talked to a physical U1.** The stand-in follows the
  source; if Snapmaker's firmware on a real machine differs from the
  published source, or the U1 needs something the source doesn't show,
  the first connection is where it appears. The Details panel and the
  terminal log are there for exactly that.
- **The U1's filament and dock objects** (`print_task_config`, the park
  sensors) are read from Snapmaker's source, not seen live. How a
  hand-loaded spool appears there is inferred from the defaults in
  `print_task_config.py`.
- **Whether Snapmaker's U1 profile sends layer numbers to Klipper** isn't
  in the published profiles; if not, layers are estimated.
- **The chamber sensor's name** on a U1 isn't in the published source; any
  `temperature_sensor`/`temperature_fan`/`heater_generic` whose name
  contains "chamber", "cavity" or "enclosure" is used, and none found means
  the chamber panel says it isn't reported.
- **Dock errors.** A runout on the U1 shows as the print pausing with the
  printer's own message; a separate per-dock error light isn't mapped yet.
- **Whether the U1 enables Moonraker's update manager.** If it doesn't,
  the Updates panel says so instead of "up to date".
- **Timing.** Commands wait up to 90 s (macros), homing 180 s, a start is
  read back for 12 s; these are generous guesses, not measurements.
- **Authorization.** API-key and trusted-client handling follows
  Moonraker's docs; the U1's defaults haven't been seen.
- **Skipping one object.** The `exclude_object` status and command follow
  Snapmaker's u1-klipper source, and Snapmaker's U1 process profile turns
  object labels on, but whether the stock U1's `printer.cfg` loads
  `[exclude_object]` hasn't been seen. The client only subscribes to it when
  the printer lists it; if it doesn't, the Control tab says the print's
  objects aren't labelled.
- **Filament after a touchscreen change.** Asked for every 30 s as well as
  pushed. This interval is a design choice, not measured device latency.
- **The U1's own chamber camera.** Camera → Show built-in camera first asks
  Moonraker which cameras it knows (`/server/webcams/list`, Moonraker's
  `webcam.py`). The Extended Firmware lists its camera there with
  `snapshot_url: /webcam/snapshot.jpg`, served on port 80; a partial address is
  on the printer itself, the way Moonraker resolves it. If no listed camera
  answers, it opens a dedicated monitor connection using Snapmaker's
  `camera.start_monitor` (WebSocket only, with the integer `req_id` that
  `repeater.py` expects; a `{"state": "failed"}` reply counts as a failure),
  reads `/server/files/camera/monitor.jpg` and closes it after idle time. A
  listed address on any other machine is ignored. Automated tests use a
  stand-in. Camera quality, refresh cadence and compatibility on physical U1
  firmware remain unverified.
- **Find my printer's camera** (Settings → Camera) tries the listed camera's
  MJPEG feed next to its player (`/webcam/stream.mjpg` from the Extended
  Firmware's `stream-http.py`), then `/webcam/?action=stream`, keeps the first
  that answers with a picture and saves it as the live feed address. The manual stream and time-lapse settings are
  separate, globally configured features.
