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
  timelapse, handoff, tester: a switch in their own card) and `core` (always on, no switch on screen).
  A new feature that needs something outside Deja Vu1 is an `extra`; anything else is `core`.
- The server enforces every switch (a disabled module's routes answer 403; tests switch core ones
  off). `modules.is_enabled()` returns True for unknown ids, so a typo in a route's module id
  silently ungates it.
- `_defaults` in modules.json versions one-time switch-ons; version 3 switched every `core` module
  back on once.
- `modules.DEFAULTS_ON` (filament_inventory, sanity_check, compare, auto_print) start on.

## Storage and safety copies

- `file_library.clean_name` keeps file names plain: accents come off (Käse is Kase), letters of other alphabets
  become a short code from the whole name (`model-3f9a1c.stl`) so two names never collapse into one file. A
  cleaned name cleans to itself; keep it that way, because every lookup runs through it.
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
- `home_assistant_bridge.py` (28 sensors), `wled_bridge.py`, `modules.py` (31 module ids).
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
  physical observations and simulation only for demo printers. `calibrate(toolhead, step)` records a white or
  dark reference from the head's latest reading (under 5 s old, no quality flag) through `sensor_calibration.py`
  (AS7341 and TCS34725; `reconcile()` drops a calibration when the chip, channel or assignment changes; a
  colour the companion sends itself is left alone). `print_gate._filament_match` adds `measured` evidence per head
  (`color_check.evidence`, `advice`): advice only, demo printers get a repeatable simulation with no advice, and
  `printer_control._start_locked` records a start that went ahead against the sensor (`colour_overrides.json`).
  The companion API saves explicit per-printer channel/sensor bindings, retains readings only in memory,
  expires captures at 30 seconds and never gives optical print approval. Drivers and firmware remain to build.
  Keep the README's hardware line, `color_check.py`'s
  docstring, `docs/architecture.md`, `docs/hardware-modules.md` and the explain.js note in step.

## Split server files (19 November 2026)

- `app.py` keeps the route tables, the security checks and `DejaVuHandler`; its helpers are in `app_part1.py`, its GET
  answers, WebSocket and timed dispatch in `app_get.py` (class `GetRoutes`) and its POST answers in `app_post.py`
  (class `PostRoutes`). `DejaVuHandler(PostRoutes, GetRoutes, SimpleHTTPRequestHandler)` takes them on as mixins, so
  `self.<anything>` works as before. `app.py` imports every helper back, so `app.<name>` still works.
- `ai_assistant.py` is `ai_assistant_part1.py` to `part3.py` (the last holds functions that call each other) plus a
  short `ai_assistant.py` that imports them all back; `moonraker_client.py` keeps `MoonrakerPrinter`, with helpers in
  `moonraker_client_part1.py` and the state and job translation in `moonraker_client_part2.py`. `_count` is defined in
  both parts as it was twice in the old file; the later one (part 2) is the one every caller uses.
- `slicer_bridge.py` (jobs, the engine run) with `slicer_bridge_part1.py`; `mock_moonraker.py` (the fleet and every
  printer function) with `mock_moonraker_part1.py`; `tester_report.py` (a short module: the zip, thinning) with
  `tester_report_part1.py` to `part3.py` (the Aggregator and the findings) and `tester_report_render.py` (the pages).
- Names that tests replace on a module (`app.EXTRA_HOSTS`, `app.SLICE_GRACE`, `tester_report.thin_files`,
  `slicer_bridge.subprocess`, `mock_moonraker.is_real` and the like) stay in the original module with every function
  that reads them, so a replacement still reaches every caller. `app.py` hands `_install_update` and `phone_link` to
  `app_post.py` after defining them.
- New code goes in the part for its area; a name used elsewhere is imported from the original module as before.

## Tester mode (`tester.py`, `tester_report.py` + `tester_report_render.py`, `tester_study.py`, `tester_questions.py`)

`tester_report_render.py` holds report.html, findings.md and the zip's README; `tester_report.py` imports them.

- Module `tester` is always on in this build (`modules.TESTER_ALWAYS_ON = True`: kind `core`, enabled whatever the saved state
  says, and `set_enabled("tester", False)` raises). `DEJAVU_TESTER=0` is the one way to keep a run out of the record: the module
  reads off, every `/api/tester/*` route answers 403 (the module gate) and `tester.record` and `tester.ingest` write nothing.
  With the flag False the module is a `setting`, off by default, and `DEJAVU_TESTER=1` or the Settings switch turns it on. The
  switch is cached for a second; `tester.refresh()` after a change makes it immediate.
- Events are JSON Lines under `<data>/tester/events-YYYY-MM-DD.jsonl` (`events-archive.jsonl` holds old days summed up).
  `backup.py` and `memory.py` skip the folder. Nothing is sent anywhere; the tester saves a zip
  (`GET /api/tester/report.zip`) and attaches it to a message. `POST /api/tester/events` takes the browser's batch
  (at most 400 events; only the kinds and fields in `tester._BROWSER`, in the shapes it lists, so no field can carry
  typed text; every event may carry `q`, its order within the visit); `GET /api/tester/report.html?theme=` is the in-app
  viewer (CSP `default-src 'none'`). A note needs words or a tag.
- The kinds the browser sends: session, setup, screen (with `via`), click (`how`, `btn`, `mods`, `dbl`, `x`, `y`, `gap`, `role`),
  change (a switch, slider or list place, never words), key, long, req, err (`stack`, `ctl`, `pstate`), printer, fps, feature,
  note (`tag`, `err`), onboarding (the setup wizard and the tour, each step when it is left), perf (start-up timings, page memory),
  net (offline, the live link closing), study (the questions' funnel) and resize. A new field goes in `_BROWSER` with its shape.
- `tester.mask()` runs on every string, in the browser's events and the server's own, and again in `thin_files`. It hides
  addresses, keys, Wi-Fi names, serial numbers, `/Users/<name>/` folders, and file, printer and spool names the
  app knows (`_known_private()`; names live in memory only, the disk holds salted hashes in `ids.json`). A file shows as
  `file_label()`: "file 3, .3mf, 2.4 MB". An inline replacement carries no dot (`file 3 (3mf)`) so it is never masked again.
  Version strings (`version`, `from`, `to`, `facts`) go through `version_text()`: 1.0.0.123 is a firmware, not an address.
  A Wi-Fi name is masked only when labelled (`ssid=`, "Wi-Fi name"); unquoted names the app doesn't know can leave a few words,
  so the zip says it is readable first and question 4 asks testers to leave the network's name out.
- Server hooks are one line each and never raise: `live_feed.publish_event` (print events) and `_detect_locked`
  (connects and drops), `app._dispatch` (refused POST commands, 500s, and `note_handler` for answers over 1.5 s), `_confirm_print`
  (Confirm Print), `printer_control` (start), `slicer_bridge._work` (slices), `/api/convert`, `app.main` (last update and
  `install_hooks()`, which also starts a sampler that notes the server's memory, processor time, threads and free disk every five
  minutes). Camera and time-lapse pictures are plain images, so those routes call `tester.note_feature()`.
  `MoonrakerPrinter.version_facts()` reads only `server.info` and `machine.system_info`, both allowed in watch-only mode. Which
  `product_info` field holds the U1's firmware version is not verified: every version-named field is recorded.
- Routine background `GET`s arrive as five-minute summaries; every other request, and every failed or slow one, is one
  event. Past `EXPORT_LIMIT` (20 MB) `thin_files` replaces the oldest routine events (clicks that were not slow, working requests,
  screen visits, smoothness samples) with one `thinned` line per day and name; errors, slow actions, notes and printer events are
  never thinned, and the report counts before it thins. `compact()` does the same on disk past 40 MB.
- The test round (`tester_study.py`, `<data>/tester/study.json`): 1, 2 or 3 days (3 by default), `describe()` gives the day and
  the status (`running`, `due`, `finished`), answers are masked and capped, `delete_all()` removes the file and so restarts the
  round. `tester_questions.py` holds the 52 questions in 12 sections in the order of the tester questions sheet (`SECTIONS`,
  `BY_ID`); `bad` marks the answer that points at trouble and `finding` the free answers that go to the findings list.
  Routes: `GET /api/tester/study` (`?questions=1` adds the questions, the answers and the hints), `POST /api/tester/study`
  (`length_days`, `welcomed`, `finish`) and `POST /api/tester/answers`. All answer 403 when the module is off.
- The report's feature rules are `tester_report.FEATURES` (22 features, each with the questions-sheet section); `CATEGORIES`
  names the kinds of error and what each means, `ROUTE_AREAS` ties a request to a part of the app. `_findings()` builds the ranked
  work list (errors, slow controls, failed requests, refused commands, failed slices, low frame rates, notes, troubled answers,
  memory growth); 403 and 409 answers are refusals on purpose and are not findings. The zip holds `report.html`, `findings.md`,
  `report.json` (schema 2), `events.jsonl` and `README.txt`. The report holds no script and loads nothing from outside; everything
  in it goes through `_h()`.

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
