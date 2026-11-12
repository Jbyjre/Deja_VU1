---
paths:
  - "backend/**"
---

# Backend notes

Standard-library Python only, written for 3.8 or newer (GitHub Actions runs 3.8, 3.10, 3.12 and
3.13). Runtime data lives in `backend/data/` (gitignored) or `DEJAVU_DATA_DIR`. Real-printer,
slicing and launcher files have their own notes in this folder.

## The server (`app.py`)

- `_dispatch` picks the printer (`?printer=<id>`, else the default), runs the handler inside
  `mock_moonraker.selection_only(id)` and maps exceptions to 400/404/409/502/500.
- GET routes: `_DATA_ROUTES` (printer figures: module-gated, then connected-or-`?demo=1`) and
  `_APP_ROUTES` (the dashboard's own settings: module-gated only). Write actions: `_CONTROL_ACTIONS`
  and `_QUEUE_ACTIONS`; other POSTs are an if-chain in `_handle_api_post`, some matched piece by
  piece (`parts[...]`, `verb ==`).
- A module-owned GET outside the tables must also be added to `module_routes()`, or the browser
  keeps calling it while the module is off.
- `_tag()` mutates what a `_DATA_ROUTES` producer returns, so return a fresh dict each call.
- `/api/app/alive` is answered in `do_GET` before dispatch and does no slow work. Never do network
  or subprocess work while holding `app_updates._lock`.
- Never write to `sys.stdout` or `sys.stderr` in request code: under `pythonw.exe` there are no
  streams and a log line broke every POST reply. Use `console.write`.
- `app._bind()` retries a busy port, then exits `PORT_IN_USE` (3).

## One printer interface (`mock_moonraker.py`)

- The single interface for simulated and real printers. Real printers delegate to
  `moonraker_client.MoonrakerPrinter`. Every new printer function needs both paths.
- Demo and sandbox hooks start with `_sim()`, which refuses real printers. Demo data never reaches a
  real printer.
- The selected printer is thread-local. A worker thread answers for the default printer unless it
  wraps itself in `mock_moonraker.use_printer(pid)`.
- `machines.py`: printer profiles. `machines.U1` is the reference and default; any other Klipper
  printer is `from_klipper()`, built only from what it reports. An unreported size disables the
  bounds check with a warning, never a guess.
- Demo printers show as "Demo printer 1/2/3" (ids `u1-workshop`/`u1-studio`/`u1-garage`, kept so
  saved records match). Demo printer 1 prints `two_benchies_two_colours.gcode`.

## Modules and switches (`modules.py`)

- Each module has a `kind`: `extra` (Settings → Optional extras lists only these seven: auto_print,
  webrtc_camera, led_status, wled_bridge, home_assistant_bridge, color_check, ai_assistant), `setting` (camera,
  timelapse, handoff: a switch in their own card) and `core` (always on, no switch on screen).
  A new feature that needs something outside Deja Vu1 is an `extra`; anything else is `core`.
- The server enforces every switch (a disabled module's routes answer 403; tests switch core ones
  off). `modules.is_enabled()` returns True for unknown ids, so a typo in a route's module id
  silently ungates it.
- `_defaults` in modules.json versions one-time switch-ons; version 3 switched every `core` module
  back on once.
- `modules.DEFAULTS_ON` (filament_inventory, sanity_check, compare, auto_print) start on.

## Storage and safety copies

- `storage.save_json` writes atomically and keeps a hidden `.<name>.prev`; damaged files are
  repaired from it or a safety copy. Code that lists a data folder must skip names starting with ".".
- A module that keeps files sets `_DATA_DIR = storage.DATA_DIR`
  (`test_tests_never_touch_the_real_data_folder` checks every module).
- `memory.py`: safety copies in `<data>/snapshots/` every 6 h, at start-up and before updates;
  restore with undo. `backup.py`: versioned full app-data ZIP with checksums, credentials omitted;
  recovery validates first and writes a separate data folder, never the running one.
  Recovery switches off automatic modules and queue advancement, remaps internal paths and resets
  engine readiness.

## Checks before a print

- `print_gate.py` is Confirm Print; the server checks again at start. `health(..., blocking)` holds
  the score at `BLOCKED_CEILING` (54) with band `"blocked"` while anything blocks. Never let a score
  read good beside a refused start.
- `gcode_tools.py`: pre-flight against the machine's volume (U1 270 × 270 × 270 mm). Colours from
  files are validated (`_HEX_COLOUR`) because they end up in style attributes.
- Spool weights: `grams_remaining` may be None (unknown, never 0); `weight_source`
  weighed|estimated|unknown. `live_feed` records the head-to-spool map at a real print's start
  (`<data>/print_spools.json`) and `deduct_after_print` charges that roll; `move_charge` corrects it.
- Bed clearance: `print_queue` keeps `bed` per printer (clear | awaiting_clear | in_use);
  `start_next` holds while awaiting; `confirm_bed_clear(job_key)` must name the print that ended
  last. Tests that finish prints must reset the queue.
- Inventory starts empty; multi-tool use without measured per-head totals is not deducted from a
  guessed spool.

## Everything else, briefly

- `maintenance.py`: 7 tasks; `snooze()` 1, 3 or 7 days; `record_swap(..., nozzle=)` also writes
  `tool_setup`. `logbook.py`: per-printer problems and fixes; demo entries never mix.
- `automations.py`: triggers include progress, time_left, layer, error, link_lost; actions include
  cool_down (never mid-print) and macro (must be one the printer lists). `notifications.py` sends
  only from rules.
- `home_assistant_bridge.py` (28 sensors), `wled_bridge.py`, `modules.py` (30 module ids).
- `pairing.py`: device keys (hash stored, HttpOnly cookie); redeeming again from a paired browser
  replaces its entry. The optional device lock (`_locked_out`) always allows loopback.
- `qr.py`: standard-library QR codes, checked against python-qrcode. `phone_link()` in app.py.
- `insights.py` (evidence thresholds), `orca_import.py` (recent projects from eight slicers' data
  folders; paths never sent to the browser), `selfcheck.py`, `readiness.py` (ok / note / bad per
  check, `next` names the paste block).
- `model_maker.py`: four-tool image tiles, layer stacks, swatch sheets, heightmap meshes; only small
  RGB grids reach Python; no image library and no guessed estimates.
  Routes belong to `photo_studio` (writes also need `file_library`). `colour_calibration.json` keys
  include saved spools, nozzles and layer thickness; physical colours still need measured swatches.
- `tool_setup.py`: per-printer preparation records; real writes use read-back, never FORCE.
  `/api/tools/assignments` is local settings under `filament_inventory`; `/api/tools/compatibility`
  and the physical filament write belong to `printer_control`. Fitted nozzle readings are never changed.
- `remote.py` (Settings → Away from home): runs Tailscale's own CLI (`status`, `serve --bg`,
  `serve --https=443 off`), never Funnel. Share and stop answer 403 unless `_this_computer()`
  (Serve keeps the phone's Host header). Tests use a stand-in `tailscale` (`tests/test_remote.py`).
- `fleet.summary_for` tolerates missing heads; a row that still fails keeps the printer's name.
- `websocket.py` is also the client framing for `moonraker_client.py` and shadows PyPI's
  `websocket-client`, so `backend/` must stay first on `sys.path`.
- `led_status.py`: decision logic and simulation. `color_check.py` uses `companion_sensor.py` for
  physical observations and simulation only for demo printers; `calibrate()` raises NotImplementedError.
  The companion API saves explicit per-printer channel/sensor bindings, retains readings only in memory,
  expires captures at 30 seconds and never gives optical print approval. Drivers and firmware remain to build.
  Keep the README's hardware line, `color_check.py`'s
  docstring, `docs/architecture.md`, `docs/hardware-modules.md` and the explain.js note in step.

## The AI assistant

- `ai_providers.py`: every way to reach a model (`PROVIDERS`: the ChatGPT plan as an `account`, two
  subscription programs, 29 key services, two local, one custom); any number stay connected. Two wire formats only (Anthropic
  Messages, chat completions). `describe()` is the only thing the browser sees; error text passes
  through `_scrub`; `_http` follows no redirect and sends a key only over https or to a local host.
  Never hard-code a model name except `DEFAULT_MODELS` (a test checks `PROVIDERS`): lists come from
  the service (`_model_rows`, `_suggest`), `codex debug models` or `CLAUDE_ALIASES`. `ask()` returns
  a `Reply` (text plus `.usage`). The plans' programs get the instructions in a file and the request
  on standard input, never in the command line. After changing an address run
  `python3 tools/check-ai-services.py` and update the date above `PROVIDERS`.
- `ai_vault.py`: where a key rests (DPAPI, `security -i`, `secret-tool`, else the 600 file). Every
  save is read back; a failure falls back to the file and sets `describe()["problem"]`. The record
  fields `api_key` and `api_key_sealed` are blanked by backup.py. Windows and macOS paths are
  untested on those systems. `DEJAVU_KEY_STORE=file` forces the file.
- `ai_assistant.py`: the model never calls the printer. It writes ```` ```action ```` JSON blocks naming a
  tool in `TOOLS`; each tool calls `printer_control` (the same checks as the Printer page) plus
  `LIMITS` (Z floor, read-only G-code allowlist `_SAFE_GCODE`, 12 steps a request). A new tool needs
  a level (read | safe | ask | handoff | proposal), a `_label`, a module in `_GATES` if it has one, a
  place in `_OFFLINE` if it needs no printer, and a test in `tests/test_ai_assistant.py`.
  `start_print` only returns a handoff; never let a tool start a print or send free G-code.
  `JUMPS` is the map of places the assistant can open (`open_page` `to`, with a card `spot`); a new card
  worth reaching gets a row. `_lib_name` finds a file named without its extension. `_card()` gives the
  chat a small picture of a result. Print watch settings live in `_watch_settings` (looks, sensitivity,
  notes, first_layer, compare, confirm, notify); `_watch_one` takes a second picture before pausing.
  Modes: advice, ask, balanced, free (default), open. Only `HIGH_STAKES` asks in free; `never_ask`
  holds the tools the owner released. The instructions (`_system`) must not change between
  requests: readings travel in the message (`chat()`), so services can reuse the instructions.
  `_check_allowed` applies module switches, watch-only and the restart hold. Conversations are saved
  to `<data>/ai_chats/<id>.json` (pictures left out, newest 80 kept) and reload after a restart; a turn
  runs on its own thread inside `selection_only(printer)`. `chat()` takes an attached photo (`_picture`).
- `ai_signin.py`: Sign in with ChatGPT for open-source apps (developers.openai.com/siwc: register with
  `dynamic_agent_client`, PKCE, a loopback listener on 127.0.0.1:1455 or a pasted address, the ID token
  checked against OpenAI's keys with a standard-library RS256 check, tokens in `ai_vault`, refreshed
  five minutes early, revoked on sign-out) and Claude Code's `claude auth login --claudeai` run with the
  code passed on standard input. Its timers are daemon threads. Answers for the ChatGPT plan go through
  `ai_providers._ask_chatgpt` (Responses API, `store: false`, `stream: true`).
- Routes: `/api/assistant`, `/api/assistant/thread`, `/api/assistant/chats` (GET, in `_APP_ROUTES`),
  `/api/assistant/watch/picture` (GET), POST verbs under `/api/assistant/` (key, forget, select, models,
  check, signin, test, chat, decide, stop, clear, watch, watch/now); provider failures answer 502 with
  words.
