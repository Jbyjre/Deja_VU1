# Connecting a real printer

Deja Vu1 talks to a printer through **Moonraker**, the web API that runs on
the printer (on the Snapmaker U1 it is built in). There is nothing to
install on the printer.

## Adding it

1. Find the printer's address on your network — the same one Fluidd or
   Mainsail uses, usually `http://<printer-ip>:7125`.
2. In the dashboard: **Fleet → Add a printer**. Give it a name, paste the
   address, and add an API key only if your Moonraker asks for one.
3. It connects straight away. The row shows **Connected** within a few
   seconds, or says in words why it isn't (see below). The dashboard then
   opens on that printer, with demo data off.

`Details` on the printer's row shows everything a first connection needs
someone to see: whether the link is open, Klipper's state, which toolheads
and chamber sensor were found, how much print history was read, and the
last few hundred exchanges with Moonraker — what was sent and what came
back. The same is at `GET /api/printers/diagnostics?printer=<id>`. The
server's terminal prints every command sent and every failure; start it
with `DEJAVU_MOONRAKER_LOG=1` to print every exchange, WebSocket messages
included.

## What happens if something is wrong

| What's wrong | What you see |
|---|---|
| Wrong address or port | "…refused the connection - is Moonraker running there, and is 7125 its port?" |
| Printer off / not on this network | "No answer from … within 5 s - is the printer on and on this network?" |
| A name that doesn't resolve | "Can't find 'u1.local' on the network - check the printer's address" |
| Moonraker wants a key | "Moonraker refused the dashboard (401) … Add this printer's API key in Settings, or add this computer's address to [authorization] trusted_clients" |
| Moonraker up, Klipper not | "Moonraker is running, but Klipper isn't connected to it" (retried every 2 s, as Moonraker's docs say) |
| Klipper restarting | The printer shows "error: Klipper stopped talking to Moonraker (restarting?)", then recovers by itself |
| Wi-Fi drops | Its last reading stays on screen, labelled "No answer since 14:02"; commands are refused in words; it reconnects by itself (1 s, 2 s, 4 s … up to 30 s apart) |
| The address is some other web page | "…answered 200, but not with JSON (it began "<!DOCTYPE html>") - is that address Moonraker itself?" |

A printer that isn't connected never shows numbers, and demo data never
fills it in: demo data only ever means the simulation.

## What was checked, and against what

There is no physical printer in this project's build environment, so the
connection (`backend/moonraker_client.py`) was written against the real
thing's **source code and documentation**, and tested against a stand-in
server built from the same source (`tests/fake_moonraker.py`), over real
sockets — real HTTP, a real WebSocket handshake, masked frames, JSON-RPC.

Sources, at the commits read:

- Moonraker — [Arksine/moonraker](https://github.com/Arksine/moonraker) `1cfb0c4`
- Snapmaker's U1 Moonraker — [Snapmaker/u1-moonraker](https://github.com/Snapmaker/u1-moonraker) `a308cfa`
- Klipper — [Klipper3d/klipper](https://github.com/Klipper3d/klipper) `ce7002b`
- Snapmaker's U1 Klipper — [Snapmaker/u1-klipper](https://github.com/Snapmaker/u1-klipper) `10f2f69`

What reading them changed — each of these would have been a bug on the
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
  heads. "NONE" there means unknown — shown as unknown, never as white.
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

Said plainly, because a good test suite is not a real machine:

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
