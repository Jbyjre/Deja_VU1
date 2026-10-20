# Deja Vu1: notes for AI coding sessions

A dashboard for the Snapmaker U1 3D printer (and a farm of them), talking to
the printer's Moonraker API. Python standard-library backend, plain
HTML/CSS/JS frontend, no build step, no dependencies. README.md is the
human-facing overview; this file is the working context. Facts here were
checked against the code in October 2026. If code and this file disagree,
trust the code and fix this file.

## Working rules

- The owner is not a programmer. Explain changes in plain words and define
  any technical term the first time you use it.
- Verify before you state anything (APIs, paths, counts, claims about the
  U1 or other products), and say plainly what you could not verify. The
  product has the same rule: it never invents figures.
- Do every part of what is asked, exactly, including counts and formats.
  Never trim a deliverable to save tokens.
- Apply the owner's feedback with judgement, the way they would want it, not
  mechanically everywhere: "bring back the laptop and phone" meant about half
  the scenes, not every one. Re-read every earlier request in the thread
  before finishing, and go a step beyond each one.
- Launch video: 75 seconds for the marketing cuts (the owner, version 8) unless the owner says otherwise
  (`promo-video/README.md` holds the owner's other video preferences).
- Read before editing. Grep first, then read with offset and limit. Cap
  command output.
- Never auto-subscribe to PR or CI activity, enable auto-fix or auto-merge,
  or poll checks unless asked in this session. Cloud sessions included.
- Never spawn subagents, agent teams or workflows, and never start /loop,
  scheduled or background jobs, unless asked. (Large workflows here have hit
  the account's usage limit mid-run.)
- Never change model, effort, fast mode or permission mode unless asked.
- Confirm before delete, overwrite, force-push or reset --hard.
- Default: commit finished work on a branch, open a PR, and merge it with one
  merge commit (the repo's convention) when there are no conflicts and checks
  are green or absent. Don't wait on pending CI. Never force-push.

## How to work here (the method that has worked)

1. Turn the request into a checklist, item by item, and re-read the
   original message before finishing. Counts and formats exactly.
2. Research from primary sources: shallow or sparse `git clone` of the
   upstream repo (Snapmaker's u1-klipper, u1-moonraker, OrcaSlicer, the
   winning forks), read the actual file, and retain private repo/commit/licence notes outside the shipped repository.
   Do not name study projects as feature sources in app text, comments, README
   or commits. Product pages only for specs. Say what is unverified.
3. Build the smallest real version end to end (backend, both printer paths,
   frontend, tests) before polishing. Implement ideas independently. Never copy or closely adapt external code
   without stopping to check the owner's licence requirements. Keep required
   third-party notices; private study notes do not replace notices for copied work.
4. Verify three ways: the unit tests for the module, the full suite once
   before pushing, and Playwright screenshots at 1366 px and 390 px (look
   at them). For anything animated, measure frame time before and after.
5. One commit per feature with a plain-language message, then README
   ("What's new", status table), CHANGELOG, this file, and the pictures
   (`tools/readme-images/`) and the online demo recording if screens or
   routes changed.
6. Work too big for the session goes in `build-prompts/` as a prompt that
   gives the next session goals and freedom, not steps.
7. No subagents; keep output short; read files with offset and limit.

## Commands

```bash
python3 backend/app.py                      # http://localhost:8000 (binds 0.0.0.0; no CLI flags)
PORT=8791 python3 backend/app.py            # another port
python3 -m unittest discover tests          # 659 tests, about 140 s
python3 -m unittest tests.test_api          # one module
python3 -m unittest tests.test_api.TestRoutingAndErrors.test_every_file_the_pages_load_is_served
python3 -c "import unittest; print(unittest.defaultTestLoader.discover('tests').countTestCases())"
python3 backend/maintenance.py              # console demos (also led_status.py, color_check.py)
python3 tools/online-demo/record.py         # re-record the online demo (about 3 min)
```

User-facing startup settings include: `PORT` (default 8000),
`DEJAVU_ALLOWED_HOSTS` (comma-separated extra host names, e.g. a Cloudflare
Tunnel domain), `DEJAVU_MOONRAKER_LOG=1` (print every Moonraker exchange),
`DEJAVU_SLICER_PATH` (OrcaSlicer binary for auto-print), `DEJAVU_DATA_DIR`
(where settings and files live; default `backend/data/`),
`DEJAVU_NO_BROWSER=1` (read by `start.py`: don't open the browser).

Browser checks in the cloud sandbox: Playwright is installed for Node
(`NODE_PATH=/opt/node22/lib/node_modules node script.js`, then
`require('playwright').chromium.launch()`). Turn on demo data by clicking
`label[for=demo-toggle]`. Full-page screenshots draw sticky and fixed
elements in the wrong place, so check those with viewport screenshots. To
mimic the public static host, serve `frontend/` with any static server; the
root should hand over to `welcome.html`.

## Map

`backend/` (standard library only; runtime data in `backend/data/`, gitignored)
- `app.py`: the whole web server. `_dispatch` picks the printer
  (`?printer=<id>`, else the default), runs the handler inside
  `mock_moonraker.use_printer(id)` and maps exceptions to 400/404/409/502/500.
  GET routes live in `_DATA_ROUTES` (printer figures: module-gated, then
  connected-or-`?demo=1`) and `_APP_ROUTES` (the dashboard's own settings:
  module-gated only). Write actions go in `_CONTROL_ACTIONS` and
  `_QUEUE_ACTIONS`; other POSTs are an if-chain in `_handle_api_post`. A
  module-owned GET outside the tables must also be added to
  `module_routes()`, or the browser keeps calling it while the module is off.
- `mock_moonraker.py`: the single printer interface for simulated and real
  printers. Real printers delegate to `moonraker_client.MoonrakerPrinter`
  (one WebSocket for live state, plus HTTP for commands, history and
  uploads). Every new printer function needs both paths. Demo and sandbox
  hooks must start with `_sim()`, which refuses real printers.
- `fleet.py` (printer registry: at most 12, in `backend/data/fleet.json`),
  `live_feed.py` (250 ms tick, print-event detection, side effects),
  `sandbox.py` (up to 24 added simulated printers plus the 3 built in).
- `layer_planner.py` (mixed-nozzle planner behind `POST /api/tools/layer-plan`,
  and Confirm Print's nozzle check; `frontend/farm.js` `planLayers()` is a
  browser copy for the online demo, kept identical by
  `tests/test_layer_planner.py`), `discovery.py` (Find printers: mDNS, then
  port 7125 on the private /24; `POST /api/printers/discover` and
  `/api/printers/test`).
- `print_gate.py` (Confirm Print, re-checked by the server at start),
  `printer_control.py`, `maintenance.py` (7 tasks), `automations.py`,
  `notifications.py` (sent only by automation rules), `gcode_tools.py`
  (pre-flight, 270 × 270 × 270 mm), `converter_3mf.py`, `slicer_bridge.py`,
  `home_assistant_bridge.py` (28 sensors), `wled_bridge.py`, `modules.py`
  (29 module ids), `storage.py` (atomic JSON).

`frontend/` (no framework, no build; served as-is, everything here is public)
- Script order: `app.js` → `viewer3d.js` → `ar.js` → `workshop.js` →
  `studio.js` → `farm.js` → `launchpad.js`. `app.js` defines the shared globals the others
  use: `$`, `esc`, `api()`, `getJSON`, `postJSON`, `paint()`, `doneAt()`,
  `hoursLeft()`, `toast`, `showTab`, `currentPrinter`, `demoOn`.
- `workshop.js`: live WebSocket (polling fallback that retries the WebSocket
  every 30 s), fleet cards, the "Needs you" list, room tint, live pill,
  digital twin (an SVG engineering drawing projected from millimetres,
  `drawTwin`), files, dialogs, morph animations.
- CSS order: `style.css` → `workshop.css` → `farm.css` → `theme.css`.
  `theme.css` is the "Layer lines" design layer and loads last.
- `welcome.html`: the product page. On a static host `/api/modules` returns
  404 and `app.js` hands over to it; `/?demo` and `/?dashboard` skip that.
- `demo/`: the online demo's recording (`recording.json`, sample files),
  made by `tools/online-demo/record.py` (about 3 minutes). Where no server
  answers `/api/health`, `app.js` `startTour()` swaps `window.fetch` for
  `/api/` addresses and answers from it. Re-run the recorder when routes or
  screens change; `tests/test_online_demo.py` fails on a missing route.
- `fonts/`: Bricolage Grotesque, Instrument Sans, IBM Plex Mono (OFL).
  `img/`: screenshots from the simulated farm.

`tests/`: unittest. API tests start the real server on a spare port.
`tests/fake_moonraker.py` is a Moonraker stand-in built from Moonraker's
source. `tests/test_audit_fixes.py` holds regression tests for the October
2026 audit.

Root: `start.py` (checks the Python version, starts the server, opens the
browser; `DEJAVU_NO_BROWSER=1` skips that) and the double-click wrappers
`start-windows.bat`, `start-mac.command`, `start-linux.sh`.

`docs/`: `getting-started.md` (download to printer on screen, for
non-programmers), `architecture.md` (the long version), `real-printer.md`,
`first-connection.md` (the U1-owner tester call the README links to),
`remote-access.md`, `hardware-modules.md`, `low-latency-camera.md`,
`ar-preview.md`.

`docs/img/`: the README's pictures (screenshots from the simulated farm, five
explainer boards, a GIF). `tools/readme-images/README.md` says how each was
made; the boards and the social card are HTML in that folder, rendered by
`tools/readme-images/render.js` (needs Playwright). Boards quote figures from
the code (test count, sensor count, Confirm Print checks): update them when
those change.

`frontend/img/social-card.png` is the link-preview card (1200 × 630). Both
`index.html` and `welcome.html` name it by absolute URL on the published
worker (`deja-vu1.jmath1110.workers.dev`), because crawlers need a full
address; `test_link_preview_image_is_the_bundled_card` checks it. Rename the
worker in `wrangler.jsonc` and those tags must change too.

`marketing-library/` and `build-prompts/` are temporary, for the owner:
copies of every marketing picture plus `MESSAGING.md` (the agreed feature
order and wording), and one prompt per planned build session. Nothing reads
them; both go before the launch post (`build-prompts/04-real-u1-and-launch.md`).

`promo-video/`: the launch video (HyperFrames compositions, frame-by-frame filming
scripts that drive the real app on the simulated farm, synthesised music);
`promo-video/README.md` is its working guide. The finished videos are copied into
`marketing-library/07-videos/`.

`wrangler.jsonc`: Cloudflare publishes `frontend/` as a static site with no
Python behind it. Each PR gets a "Workers Builds" check and a preview-URL
comment from Cloudflare's bot. GitHub Actions also runs the test suite on Python
3.8, 3.10, 3.12 and 3.13 (`.github/workflows/tests.yml`, pinned to Ubuntu
24.04 because Python 3.8 builds stop there). `*.workers.dev` is blocked from the cloud
sandbox, so you can't fetch the preview from here.

## Rules the code depends on

- No invented figures. Without a connected printer and without `?demo=1`, a
  data route returns exactly `{"connected": false, "demo": false}`.
- Demo data never reaches a real printer.
- Module switches are enforced by the server (a disabled module's routes
  answer 403). Background automation, queue advancement, camera capture, time-lapse and
  filament deduction are also gated. An in-flight request cannot be recalled.
  `ar_preview` is browser-only, and pairing is always on.
- Honest controls: a command the printer refuses is shown as refused, in
  words.
- Security: there is no login. Protection is a Host-header allowlist (421),
  an Origin check on POSTs and the WebSocket (403), and anti-framing
  headers. Never add an exception keyed on a request header; a web page can
  set it (DNS rebinding). A tunnel's domain goes in `DEJAVU_ALLOWED_HOSTS`.
- Escape everything that reaches `innerHTML` with `esc()`, including file
  metadata. Colours from files are validated server-side
  (`gcode_tools._HEX_COLOUR`) because they end up in style attributes.
- Accessibility: `theme.css` loads last, so its reduced-transparency and
  increased-contrast blocks must repeat the overrides with selectors at
  least as specific as the rules they override (`:not(.is-morph-target)`).
- Keep README's "Current status" honest: say what isn't verified.

## Pitfalls

- The tests run in a temporary data folder (`storage.DATA_DIR`, set when
  the test runner imports `storage`), never the real `backend/data/`. A new
  module that keeps files must set `_DATA_DIR = storage.DATA_DIR`;
  `test_tests_never_touch_the_real_data_folder` checks every module. Don't
  run a demo server while the full suite runs: one run failed an
  automation test that passed on its own.
- Don't `pkill -f 'backend/app.py'` from a shell whose own command line
  contains that text, because it kills the shell. Kill by PID.
- The selected printer is thread-local. Code on a worker thread answers for
  the default printer unless it wraps itself in
  `mock_moonraker.use_printer(pid)`.
- `_tag()` mutates what a `_DATA_ROUTES` producer returns, so return a fresh
  dict each call.
- `modules.is_enabled()` returns True for unknown ids, so a typo in a
  route's module id silently ungates it.
- `backend/websocket.py` is also the client framing for `moonraker_client.py`,
  and its name shadows PyPI's `websocket-client`, so `backend/` must stay
  first on `sys.path`.
- Panels on the 5-second refresh must render through `paint()`. It skips
  unchanged HTML and stops the entrance animation replaying (that replay
  used to flicker).
- A `backdrop-filter` blur of about 1.5 px or more erases the 5 px layer
  lines, and high-frequency displacement noise scrambles them. The clear bars
  use `#lg-lens-clear` with a 0.4 px blur.

## Known open issues (found in the October 2026 audit, not fixed yet)

- Config backup holds only 4 files. It misses real printers' maintenance
  logs, `fleet.json`, automations, the queue and other settings, and there
  is no restore (`backup.py`).
- A missing API key over the WebSocket shows only "Not connected:
  Unauthorized" (`moonraker_client._call`).
- A simulated cancel records no history entry and keeps the active toolhead
  (`mock_moonraker.cancel_print`). A simulated heater fault docks the head,
  so its LED ring reads "ready".
- `fleet.set_change_listener()` is never called, so real-printer updates wait
  for the next 250 ms tick. `MoonrakerPrinter.clear_error()` is unreachable.
- Not checked by the audit (its agents hit the usage limit): the feature
  backends in depth (automations, converter, slicer bridge, studio, queue,
  camera) and `docs/architecture.md` beyond the frontend section.

## Launch-readiness additions

- Time-lapse uses `mock_moonraker.camera_snapshot()` for each real printer.
  One bounded on-demand capture worker per printer keeps camera delays out of
  the live tick. Session identity and module switches are rechecked before save.
  The old manual MJPEG feed is for viewing only. Fleet change listener is wired.

- `tool_setup.py`, `printroom.js`: per-printer preparation records, four-head
  editor and read-only feeder detection. `/api/tools/assignments` is local
  settings under `filament_inventory`; `/api/tools/compatibility` and the
  physical filament write action belong to `printer_control`. Real writes use
  read-back, never FORCE, and never change fitted nozzle readings.

- `VERSION`, `backend/app_updates.py`, `start.py`: opt-in GitHub release checking,
  verified staging and child-process rollback. No stable package published yet.
  `docs/releasing.md` is the release checklist. Python is still required.
- `backend/stock_camera.py`: separate authenticated stock camera monitor per
  real printer. Snapshot GET is module-gated; demo returns a labelled SVG.
  Real camera unverified; manual MJPEG/time-lapse remains globally configured.
- `frontend/launchpad.js`: skippable setup, private browser name, feature search,
  update settings and camera snapshots. Browser-only names never enter requests.
- `sw.js` caches only `offline.html`, never API replies or commands. HTTP LAN
  addresses cannot register it. Public demo info/update controls stay disabled.
- Viewer accepts triangular OBJ geometry; transforms save a new STL. This drops
  colours/materials/tool assignments. Do not claim overlap checks or multi-model
  plate editing. Slicer auto-detection is present; real Orca remains untested.
- Detailed remaining work: `build-prompts/05-launch-follow-through.md`.
