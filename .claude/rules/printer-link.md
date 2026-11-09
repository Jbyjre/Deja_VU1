---
paths:
  - "backend/moonraker_client.py"
  - "backend/mock_moonraker.py"
  - "backend/live_feed.py"
  - "backend/fleet.py"
  - "backend/discovery.py"
  - "backend/refind.py"
  - "backend/printer_control.py"
  - "backend/printer_extras.py"
  - "backend/stock_camera.py"
  - "backend/camera.py"
  - "backend/webrtc_relay.py"
  - "backend/webrtc_camera.py"
  - "backend/timelapse.py"
  - "backend/watch_only.py"
  - "backend/update_hold.py"
  - "backend/machines.py"
  - "backend/remote.py"
  - "backend/print_preview.py"
  - "tests/fake_moonraker.py"
  - "tests/test_real_printer.py"
  - "frontend/printer-page.js"
  - "frontend/printer-extras.js"
---

# Talking to a real printer

Deja Vu1 has run on a real Snapmaker U1 with stock firmware (see `docs/testing.md`). It talks to
Moonraker: one WebSocket per printer for live state, HTTP for commands, history and uploads.
Upstream code (u1-moonraker, u1-klipper, the Extended Firmware, paxx12/v4l2-mpp) is GPL-3: match
its behaviour, never paste it.

## Connection

- The U1 answers on 7125 and on port 80 (its web server forwards to Moonraker).
  `Endpoint.other_door()` and `MoonrakerPrinter._switch_door` try the other after two misses;
  `/api/printers/test` tries `fleet.web_port_variant` too. The saved URL never changes.
- `fleet.normalise_url` keeps only scheme, host and port and turns `192.168.1.50` into
  `http://192.168.1.50:7125`. At most 12 printers, in `<data>/fleet.json`. Reconnects wait at most
  `RECONNECT_MAX` (10 s). `ComputerWoke` (wall clock ran, monotonic didn't) drops a link at once
  after sleep.
- Sign-in: `discovery.key_from_login()` uses the printer's web login once (`/access/login` then
  `/access/api_key`) and returns only the API key. Never store or log the password.
- Find printers: mDNS, then port 7125 on each home /24 (`home_networks`). Look further
  (`wider=True`) adds common home networks and the tailnet (`remote.tailnet_places()`). `probe`
  reads `/machine/system_info` for the serial and `machine_type`.
- `refind.py` keeps each U1's serial; after 90 s silent it searches at most every 10 minutes and
  moves an entry only on the same serial (`fleet.move`, event `printer_moved`).
- `discovery.network_hint(url)` explains a printer on another network in words. There is no relay.
- A U1 is `print_task_config` OR product_info `machine_type` "Snapmaker U1"; its own name comes
  from `machine.system_info` product_info.device_name.

## Live state

- `live_feed._tick_one` (250 ms) publishes the reading before `_detect` and side effects (each
  guarded, logged once a minute). It keeps each real printer's print state in
  `<data>/live_state.json` so a finish during a restart is still seen; such a finish has no print
  summary, so no filament is deducted for it.
- `_catch_up_if_quiet`: printing and no status update for 5 s means `printer.objects.query` every
  2 s; state carries `reading_age_s` and `reading_directly`.
- `toolhead_position` is motion_report `live_position` (`position_source: "live"`), else toolhead
  `position` labelled `"commanded"`; `homed_axes` is reported. `state.sync` carries Klipper's
  `file_position` and `live_position` less `homing_origin` for the twin, and `extruding` from
  motion_report `live_extruder_velocity`.
- A `link_lost` state disables Pause, Cancel and Home and never offers the firmware restart. A fresh
  page gets `{"connected": false}` instead, and the empty state names the added printer.

## Commands

- `printer_control` builds standard Klipper G-code after checking every value; motion is refused
  mid-print, tuning is not. Both paths go through `mock_moonraker.tune()`.
- A command the printer refuses is shown as refused, in words. Every Cancel asks twice.
- The U1 ignores PAUSE over a skipped object (`pause_resume.py`); `pause_print` says so.
- Watch-only mode (`watch_only.py`): `HttpTransport.request` allows only GET and `READ_POSTS`
  (objects query, emergency stop, login) and `MoonrakerPrinter._call` only `READ_CALLS`; anything
  else raises `WatchOnly` (409 `watch_only: true`). E-stop and the camera always pass; simulated
  printers are unaffected. `DEJAVU_WATCH_ONLY=1` forces it on for one start.
- Update hold (`update_hold.py`): from an update or restart on, every write raises `UpdateHold`
  (409 `updating: true`); reads and the emergency stop pass; writes on the wire get `WRITE_GRACE`
  (20 s); it lapses after 90 s. Never add a "wait for the print" check to updates: the printer runs
  its file by itself.
- `printer_extras.py`: the Printer page's on-request readings (macros, mesh, endstops, G-code help,
  temperatures, feeding) through `mock_moonraker.printer_reading(kind)`. Names follow Snapmaker's
  published U1 config (cavity_fan, cavity_led, e0..e3_filament, AUTO_FEEDING). Pins are shown,
  never switched (on the U1 they are heater switches). Feeding runs `AUTO_FEEDING EXTRUDER=n`.
- Printer files: `POST /api/printer/files/fetch` copies a printer file into the library so
  Confirm Print still checks it.

## Camera

- `stock_camera.py`: tries the camera Moonraker lists first (`/server/webcams/list`; the Extended
  Firmware's `/webcam/snapshot.jpg`, printer host only), then Snapmaker's `camera.start_monitor`
  (WebSocket only, integer `req_id`, `{"state":"failed"}` is a failure), then `monitor.jpg` on
  Moonraker's port and port 80. `GET /api/camera/live` streams MJPEG (15 a second at most).
- `webrtc_relay.py`: the Extended Firmware's WebRTC camera; only request, answer and
  remote_candidate, only to the printer's own host, 64 KB max; the page falls back to pictures
  after 8 s.
- Time-lapse uses `mock_moonraker.camera_snapshot()` per real printer, one bounded capture worker
  per printer, session and module switches rechecked before save.

## Testing without the printer

`tests/fake_moonraker.py` is a Moonraker stand-in built from Moonraker's source. To check the twin
against a "real" printer, run it mid-print walking `virtual_sdcard.file_position` and
`motion_report.live_position` through a real G-code file, add it in Printers and read
`#twin-sync-text` in Chromium. `DEJAVU_MOONRAKER_LOG=1` prints every exchange.
