# Deja Vu1: notes for AI coding sessions

A local dashboard and model-preparation workspace for Snapmaker U1 printers.
It talks to Moonraker, edits plates, invokes an independently installed slicing
engine and inspects G-code. The core uses standard-library Python and plain
HTML/CSS/JS, with no build step or packages. Optional engines and media tools
have separate requirements. README.md is the
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
- Launch video (the owner, 25 October 2026): **16:9 only** from now on, one cut per version (no
  9:16). Set aside, and never build on or reuse: the owner's "V2" (version 13's 60 s pair and
  version 15, its update) and the marketing videos ChatGPT made (none are in this repository).
  The current line is "V1" (version 12's 75 s pair, version 14 at 60 s, versions 16 and 17). Marketing cuts
  are 60 seconds and show the live Dots background and the 3D twin. Each new version shows what changed
  in the app since the last. Version 16 shows the 3DBenchy, the quick tour and scanning a QR code onto a
  phone. Version 17 (the owner, 26 October 2026: "make it smoother and better") is version 16 measured
  frame by frame and smoothed (no 3D flattening when the laptop dims, dissolves where the filmed app
  swaps a whole view, a 60 fps web copy), with what changed since in "and plenty more"; it replaced the
  film in the README and on the product page. Check a new cut with a frame-difference pass over the
  master. Don't edit the video unless asked.
- Internal material lives in the owner's private repository, `Jbyjre/Deja-VU1-Studio` (moved
  27 October 2026; dropping it from this repository's history is still to do, and the kit for
  that is the private repository's `history-rewrite/`): `promo-video/` (the film
  tooling; its `README.md` holds the owner's other video preferences and the version 17 checks),
  `marketing-library/` (finished films in `07-videos/`, `COPY.md`, `MESSAGING.md`, `AD-GUIDE.md`),
  `build-prompts/` (planned build sessions; current goals in
  `07-physical-validation-and-format-fidelity.md`), `docs/marketing-refresh.md`, `docs/copy-review.md`
  and `tools/campaign/` (the 24 campaign cards and the library copy step). Never add them back
  here. Ask for the private repository to be attached to the session when a task needs it. The
  public film copy for the product page stays in `frontend/media/`.
- Every change must also be reflected in the online demo (the owner's rule,
  October 2026; README "For developers and AI coding sessions"). Frontend
  changes reach it by themselves, but check `/?demo` on a static server; a new
  or changed route needs `tools/online-demo/record.py` and `frontend/demo/`.
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
- Install (the owner, 24 October 2026): the copy-and-paste blocks (PowerShell for
  Windows, Terminal for Mac/Linux) are the main install method in README, getting
  started and welcome.html; ZIP and GitHub Desktop are the no-code options. The
  blocks use `releases/latest/download/deja-vu1-update.zip`; keep all copies
  identical (`tests/test_install_blocks.py`).
- Versions (the owner, 25 October 2026): **every merge to `main` is a release**, so
  updates are constant and familiar. The one exception (the owner, 26 October 2026):
  a marketing-video merge is not a release; put `[marketing video]` in its merge
  message (the workflow checks it first, `tests/test_versions.py`). `VERSION`, the top entry of
  `frontend/versions.json` and a `## <version> (<date>): <name>` heading in
  CHANGELOG.md must agree (`tests/test_versions.py`). Raise `VERSION` by hand for a
  named release with its own tour; otherwise `.github/workflows/release.yml` runs
  `tools/next-release.py` (next patch number, merged PR titles as changes), commits
  `Release <version>` to `main` and publishes it. Don't hand-edit around that commit.
  A new version's `highlights` become its in-app tour; point each at a real element.
- Updates (the owner, 25 October 2026): installing must work every time. 0.8.0's Install
  button crashed in `_require_idle_for_update` (now guarded), so 0.8.0 copies need the
  one-paste update once. The update blocks live in `tools/update_blocks.py`; README,
  getting started, welcome.html and Settings show them identically
  (`tests/test_install_blocks.py`). Settings can also Restart, Repair files, make a
  Safety copy and Stop (`/api/app/restart|repair|stop`). Never change the first lines of
  `start-windows.bat`: a running batch file is re-read from its old position after an update.

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
6. Work too big for the session goes in the private repository's `build-prompts/` as a
   prompt that gives the next session goals and freedom, not steps.
7. No subagents; keep output short; read files with offset and limit.

## Writing and code style (the owner, 26 October 2026)

Judges and forum readers asked the same three things of Snapmaker Innovation Fund
Phase 1 entries: what did the author write, is it tested and reproducible, and who
gets credit. Write so the answers are easy to find.

- Public text (README, docs, app strings, descriptions): name who does what, state
  the fact, stop. No em dashes, no "not X, it's Y" turns, no stock praise words
  (seamless, robust, powerful), no adverbs for emphasis. Keep the limits in the
  same plain words the README uses ("has never talked to a real U1").
- Never remove or soften the AI-assistance disclosure (README, CREDITS.md, commit
  trailers). Hiding it would be a bigger risk than showing it.
- Quote a test count and date only from a run you made, and change every copy
  together: README, the "By the numbers" board (`tools/readme-images/boards.html`),
  `docs/slicer-workspace-validation.md` and the private repository's `marketing-library/COPY.md`.
- Python: match the file you are in. One statement per line (no `if x:return y`, no
  `a=1;b=2`), about 120 columns at most, comments only for the why.
  `ruff check --select E701,E702 backend tests tools` must stay clean. GitHub Actions
  still runs Python 3.8, so write no parenthesised `with (a, b):` (3.9 and later only);
  `ruff format` adds one unless it is told `--target-version py38`. Parse the files with a
  real 3.8 (`uv python install 3.8`) before pushing a mass reformat.
- JavaScript: Prettier with single quotes, two spaces, 120 columns, no trailing
  commas, arrows without parentheses for one argument.
- A formatting-only change proves it: compare the syntax trees before and after
  (Python `ast.dump`, JavaScript acorn) and say so in the commit message. Then run the
  whole suite: a few tests read source files as text (`tests/test_frontend_refresh.py`
  reads `games.js`), so they can break on layout alone. Write such tests so they do not
  depend on spacing.

## Commands

```bash
python3 backend/app.py                      # http://localhost:8000 (binds 0.0.0.0; no CLI flags)
PORT=8791 python3 backend/app.py            # another port
python3 -m unittest discover tests          # current count/result: docs/slicer-workspace-validation.md
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
`DEJAVU_NO_BROWSER=1` (read by `start.py`: don't open the browser),
`DEJAVU_WINDOW=browser|window|none` (overrides Settings → Desktop app for one start).

Browser checks in the cloud sandbox: Playwright is installed for Node
(`node script.js`, then `require('playwright').chromium.launch({executablePath:
process.env.DEJAVU_BROWSER || '/usr/bin/chromium', args:['--no-sandbox']})`). Turn on demo data by clicking
`label[for=demo-toggle]`. Full-page screenshots draw sticky and fixed
elements in the wrong place, so check those with viewport screenshots. To
mimic the public static host, serve `frontend/` with any static server; the
root should hand over to `welcome.html`.

## Map

`backend/` (standard library only; runtime data in `backend/data/`, gitignored)
- `app.py`: the whole web server. `_dispatch` picks the printer
  (`?printer=<id>`, else the default), runs the handler inside
  `mock_moonraker.selection_only(id)` and maps exceptions to 400/404/409/502/500.
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
- `machines.py`: printer profiles. The U1 (`machines.U1`) is the reference and the default; any
  other Klipper printer is `from_klipper()`, built only from what it reports (toolhead
  `axis_minimum`/`axis_maximum`, its extruders, `configfile` kinematics and nozzle;
  `print_task_config` marks a U1). Every printer state carries `machine` on both paths;
  `gcode_tools.analyze(machine=...)`, `file_library.checked()` and Confirm Print use it. An
  unreported size disables the bounds check with a warning, never a guess. Cards say
  "untested type"; the twin card shows the printer's facts instead of a U1.
- `fleet.py` (printer registry: at most 12, in `backend/data/fleet.json`),
  `live_feed.py` (250 ms tick, print-event detection, side effects),
  `sandbox.py` (up to 24 added simulated printers plus the 3 built in).
- `layer_planner.py` (mixed-nozzle planner behind `POST /api/tools/layer-plan`,
  and Confirm Print's nozzle check; `frontend/farm.js` `planLayers()` is a
  browser copy for the online demo, kept identical by
  `tests/test_layer_planner.py`), `discovery.py` (Find printers: mDNS, then
  port 7125 on the private /24; `POST /api/printers/discover` and
  `/api/printers/test`).
- `sample_files.py` + `sample_slicer.py` + `sample_assets/3dbenchy.stl`: the sample set (the
  real 3DBenchy, CC0, 60k triangles; a gear and a vase from formulas) and a deliberately simple
  slicer that cuts real layers for the sample G-code. Old cube/bracket names live in `LEGACY`.
  The default demo printer (Demo printer 1, id `u1-workshop`) prints `two_benchies_two_colours.gcode` (orange hull
  / black cabin and the reverse, deck at 15 mm); its `object_tools` plan drives the active head.
- `print_preview.py` (`GET /api/print/preview`): the running print's outer walls and top
  surfaces per head and object from its own G-code (real printer: Moonraker file download;
  else library or samples), delta-encoded, cached per file version. Drawn by twin3d.js.
  Each path point has its nominal time (`walls_t`/`fill_t`) and `timeline` maps file bytes to
  time and nozzle position. Real printers add `state.sync` (Klipper `file_position`, and
  `motion_report.live_position` less `homing_origin`); `Twin3D.sync` in twin3d.js follows the
  G-code between readings and re-syncs on each (tested in Node: `tests/test_twin_sync.py`).
  Byte offsets must count bytes: decode files with `surrogateescape`, never `replace`.
- `colour_map.py` (`GET /api/colours/plan`, `POST /api/colours/apply`, module `converter`):
  which filaments a 3MF really uses (objects, parts, per-feature keys, height ranges, painted
  triangles) and a head for each; writes a copy using at most four. Orca family and PrusaSlicer
  layouts; paint codec per OrcaSlicer TriangleSelector. The converter runs it for more than four
  filaments. Panel: workshop.js `renderColours`, moved under the slice bar by slicer-workspace.js.
- `memory.py` (safety copies in `<data>/snapshots/`, every 6 h / start-up / before updates,
  restore with undo) and `storage.py` (`.<name>.prev` last-good copy on every save; damaged
  files repaired from it or a safety copy). `insights.py` (`/api/insights`, evidence
  thresholds), `orca_import.py` (recent projects from eight slicers' data folders, keys from each
  one's `version.inc`; user presets from Snapmaker_Orca / OrcaSlicer only; paths never sent to
  the browser), `selfcheck.py` (`POST /api/app/selfcheck`).
- `app_updates.py`: channels `stable` (releases, the default; checked hourly) and `latest` (main
  branch: per-file git blob hashes against GitHub's tree, only changed files staged), `watch()`
  thread, `git_update()`, `prepare(repair=True)` (same-version reinstall).
- Demo printers are shown as "Demo printer 1/2/3" (ids `u1-workshop`/`u1-studio`/`u1-garage`, kept so
  saved records match; the owner found the old room names confusing). Sandbox ones continue the count.
- `qr.py` (standard-library QR codes, checked against python-qrcode) and `phone_link()` in app.py
  (`POST /api/pairing/link`: address + one-time code + QR rows). `frontend/phone.js` shows the sheet,
  and on the phone redeems `?pair=` by itself (setup is skipped for a phone arriving that way).
  `Phone.install()` (More → Install app, Settings → Install on this phone) picks the install steps:
  Chrome installs only from https, localhost or an address in chrome://flags "Insecure origins
  treated as secure" (Chromium `installable_evaluator.cc`), so a plain LAN address gets those steps.
- `pairing.py`: device keys (hash stored, HttpOnly cookie) and the optional device lock
  (`app.py` `_locked_out`; localhost via loopback is always allowed).
- `process_settings.py`: the 106 Orca process settings (names/choices checked against Orca's
  `PrintConfig.cpp`), served by `GET /api/slicer/schema` and used by `slicer_profiles.validate_options`.
- `logbook.py`: per-printer problems/fixes/print hours (`/api/logbook`, module `maintenance`);
  `live_feed` logs failures and reasoned pauses; demo entries are flagged and never mix.
- `print_gate.py` (Confirm Print, re-checked by the server at start),
  `printer_control.py`, `maintenance.py` (7 tasks), `automations.py`,
  `notifications.py` (sent only by automation rules), `gcode_tools.py`
  (pre-flight, 270 × 270 × 270 mm), `converter_3mf.py`, `slicer_bridge.py`,
  `home_assistant_bridge.py` (28 sensors), `wled_bridge.py`, `modules.py`
  (29 module ids), `storage.py` (atomic JSON).

`frontend/` (no framework, no build; served as-is, everything here is public)
- Sections (`app.js` `SECTIONS`, `window.Sections`): Overview, Printers, Files, Care and
  Settings show one part at a time (plus "Everything"). Cards are sorted by `#id`, `.class`
  or the start of their h2 title; a card no rule names joins the first part. Anything that
  scrolls to a hidden card opens its part (`Sections.reveal`, via a `scrollIntoView` wrapper;
  `guide.js` resolve calls it too). A new card on those screens needs a rule, or it lands
  in the first part.
- Script order: `app.js` → `orb.js` → `backdrop.js` → `viewer3d.js` → `ar.js` →
  `twin3d-scene.js` → `twin3d.js` → `workshop.js` → `studio.js` → `layer-stack.js` →
  `farm.js` → `guide.js` → `launchpad.js` → `phone.js` → `explain.js` → `versions.js` → `finder.js` → `desk.js` → `telemetry.js` → `logbook.js` → `insights.js` →
  `printroom.js` → `plate.js` → `gcode-view.js` → `slicer-workspace.js` → `backup.js` → `maker.js`. `app.js` defines the shared globals the others
  use: `$`, `esc`, `api()`, `getJSON`, `postJSON`, `paint()`, `doneAt()`,
  `hoursLeft()`, `toast`, `showTab`, `currentPrinter`, `demoOn`.
- `workshop.js`: live WebSocket (polling fallback that retries the WebSocket
  every 30 s), fleet cards, the "Needs you" list, room tint, live pill,
  digital twin (an SVG engineering drawing projected from millimetres,
  `drawTwin`), files, dialogs, morph animations.
- `backdrop.js`: the cursor-reactive background (Dots by default, plus
  Constellation, Flow, Layer lines, Still; six colour sets incl. Time of day;
  Reaction Gentle/Lively/Wild; "Little surprises": click ripple, triple-click
  bloom, long-press charge, minute sweep, the time in dots on the hour, a burst
  when a print finishes, two keyboard secrets). Every dot is ONE colour (the owner,
  26 October 2026): the set's own or Settings → Appearance → Dot colour (`prefs.dot`);
  no print-progress fill in filament colours. New surprises go in its
  SURPRISES section. It draws only while something moves; reduced motion turns
  it Still with no surprises. Content cards drop their blur while it can move.
- `twin3d.js` + `twin3d-scene.js`: the digital twin (WebGL 2, no library), with the real print
  (`setPrint`, clipped per layer), case modes (closed / glass / open, `setCaseMode`), a Print
  close-up view and options (`setOptions`: print, rest, tags, spin), in
  both modes: a realistic model (PBR-style lighting, shadows, reflections) and
  an engineering drawing made from the same geometry (edge-detection ink plus
  SVG dimensions, balloons and title block). Driven by workshop.js
  (`setTwinMode`, `queueTwin`); the old SVG `drawTwin` is the fallback without
  WebGL 2. The look comes from Snapmaker's official product picture (shipped in
  Snapmaker's Orca profile, `resources/profiles/Snapmaker/Snapmaker U1_cover.png`)
  and the plate size from that profile (276 × 293 mm); only facts were used,
  not files (that repo is AGPL). The body's own size (~390 × 460 × 480 mm),
  dock spacing and inside layout are estimates; the card says so.
- Games (`games.js`, moved out of app.js; fetched by app.js `loadGames()` the first time the
  Games tab opens, so it is not in index.html's script list): every game timer goes through `frameEvery()` (rAF-driven fixed
  steps; ms 0 = once per frame for drawing). `fitGameCanvas()` sizes the largest
  canvas to the window. Pac-Man, Tetris, Snake and Sky Dash were rewritten in
  October 2026; the older game code below them in games.js is legacy.
- CSS order: `style.css` → `workshop.css` → `farm.css` → `guide.css` → `theme.css`.
- `orb.js`: the notification orb (bottom right). `toast()` in app.js hands every
  message to `Orb.notify(message, kind, ms, {action})`; the orb keeps the last 30
  and shows version/update news (`Orb.setApp`). `#toasts` is now its bubble stack.
  A repeat of a showing message counts up (×2); time on screen grows with the words;
  timers pause while held or while the tab is hidden; history survives a reload
  (sessionStorage, without actions). The handoff offer folds into the orb after 9 s.
- `guide.js`: the tour engine (`Guide.start(steps)`: a glass callout with a tail and a beacon that
  springs from stop to stop, across screens, below the sticky top bar; full-screen chapters for
  version tours; "Try it" actions limited to buttons a person could press). The quick tour
  (`Guide.everything()`, setup's "The tour" step) is nine stops; the owner found the old 53 far too
  many, so keep it short. More detail lives in `Guide.screen(tab)`, 1 to 4 stops per screen, opened
  by "Show me this screen" in the line under the tab bar.
- `explain.js`: plain-language help. An ⓘ after each known card title (HELP, keyed by the title's
  letters and digits; a MutationObserver decorates cards drawn later) opens a glass note; `[[word]]`
  links a GLOSS definition that opens in place; `[data-glossary]` opens the whole list. The owner
  wants the app understandable at a glance: write notes in the stop-slop style (you, active verbs, no
  filler or em dashes). `tests/test_explain.py` fails when a note's card is renamed or removed.
- `versions.js` + `versions.json`: Settings → Version & updates, the header
  version chip, "Updated to…" news and each version's tour (`Versions.tour(v)`).
  Works on the static demo (plain file). `launchpad.js` holds setup and the
  desktop-app card (`beforeinstallprompt`, launcher window choice).
- Top-level `const` in a classic script is not a `window` property: shared
  modules here assign `window.Orb`, `window.Guide`, `window.Versions`. Scripts
  that use a later script at start-up wait for `DOMContentLoaded`.
  `theme.css` is the "Layer lines" design layer and loads last.
- `welcome.html`: the product page. On a static host `/api/modules` returns
  404 and `app.js` hands over to it; `/?demo` and `/?dashboard` skip that.
- Files › Slicing opens with "Get ready to slice" (`farm.js` `renderReady`): five steps, the
  first undone one has the only button. "Find it for me" is `POST /api/slicer/find`
  (`slicer_bridge.find_slicers`: usual install folders, one level deep, names containing
  "orca", no installers or archives, nothing run). People read "Slicing", never "Auto-print";
  the module id stays `auto_print`.
- `finder.js` matches titles without explain.js's ⓘ button (`.xp-btn`); `tests/test_finder.py`
  checks every place names a real card.
- `layer-stack.js` (mixed heights: base × N per head, smart set-ups; rules mirror
  `slicing_contract.tool_layers`), `finder.js` (Ctrl/Cmd+K search), `desk.js` (Farm desk in
  Printers), `telemetry.js` (Overview readout, fed by workshop's `dv-state` event),
  `logbook.js` (Care). The online demo simulates POSTs for control, queue route, logbook and
  convert in `app.js` (`tourSim`, `tourControl`); the recorder keeps real convert replies.
- `media/`: the launch film for the product page (web encode under Cloudflare's 25 MiB limit).
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
made; the boards and the social card are HTML in that folder (`boards.html`,
`card.html` with `card.css`, `card.js` and `card.json`), rendered by
`tools/readme-images/render.js` (needs Playwright; `--card` for the card only).
Boards quote figures from the code (test count, sensor count, Confirm Print
checks): update them when those change. `sync.py` copies captures and renders
into `docs/img/`, `frontend/img/` and `tools/readme-images/img/` only.

`frontend/img/social-card.png` is the link-preview card (1200 × 630). Both
`index.html` and `welcome.html` name it by absolute URL on the published
worker (`deja-vu1.jmath1110.workers.dev`), because crawlers need a full
address; `test_link_preview_image_is_the_bundled_card` checks it. Rename the
worker in `wrangler.jsonc` and those tags must change too.

`docs/hardware-modules.md` Module 3 is the colour checker design, written to
match the owner's 27 October 2026 email to Snapmaker's community team: TCS34725
and AS7341 tested side by side, a TCA9548A multiplexer and a Pico W over Wi-Fi,
a dark printed block at each rear filament inlet, TD second (TD1s values typed
in), a sensor mismatch as a warning with one-click accept, reported-colour
mismatches still blocking. Keep README's status row, `color_check.py`'s
docstring, `architecture.md` and the explain.js note in step with it. Only the
comparison and simulation exist; the planned behaviour is not written.

`wrangler.jsonc`: Cloudflare publishes `frontend/` as a static site with no
Python behind it. Each PR gets a "Workers Builds" check and a preview-URL
comment from Cloudflare's bot. GitHub Actions also runs the test suite on Python
3.8, 3.10, 3.12 and 3.13 (`.github/workflows/tests.yml`, pinned to Ubuntu
24.04 because Python 3.8 builds stop there). Check the current environment's
network policy before accessing a preview; a permitted production host does not
establish access to every `*.workers.dev` preview. Local static checks do not
prove a public deployment.

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
- `storage.save_json` keeps a hidden `.<name>.prev` beside every record. Code that lists a
  data folder must skip names starting with "." (timelapse frames once counted it).
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

- Windows/macOS engine setup and recovery launchers remain unverified; Linux
  isolated recovery is tested. External engines/exported presets need separate backup.
- Current backend/security/fake-printer coverage passes, but it does not establish
  physical firmware behaviour. Follow the current validation record rather than
  older audit-completion claims.

## Launch-readiness additions

- Inventory starts empty; explicit spool ids feed Confirm Print. Multi-tool
  usage without measured per-head totals is not deducted from a guessed spool.
  Existing inventory files are never cleared by this change. Converter refuses
  unsupported materials/nozzles instead of guessing substitutes. Simulated
  cancel now records history and clears the active head. `selection_only()`
  scopes offline settings and slicing workers without opening printer sockets.

- `model_maker.py`, `maker.js`: native four-tool image tiles, calibrated layer
  stacks, 16-swatch sheets and closed heightmap meshes. Routes belong to
  `photo_studio` (writes also require `file_library`). Only small RGB grids reach
  Python. There is no image library dependency or guessed print estimate.
  `colour_calibration.json` keys include saved spools/nozzles and layer thickness.

- `plate.js`, `plate-worker.js`, `plate_project.py`: source meshes plus affine
  transforms, undo/redo, bounded off-thread contact/ray checks and 3MF save-as.
  Preserve XML prefixes when relocating paths (`requiredextensions` refers to
  those prefixes). List ALL model parts in `3D/_rels/3dmodel.model.rels` or Orca
  can import empty geometry. Original source files live inside `DejaVu/Sources/`.
- `gcode-view.js`: layer index, tool/speed/feature filters and event list.
  Backend toolpath segments now append requested mm/s, feature index and line
  number after the original eight values. Extrusion accounting tracks per-tool
  retraction debt. Nominal time excludes acceleration, heating and macros.

- `slicer_profiles.py`: discover installed Snapmaker presets, resolve parents
  with cycle/size bounds, check compatibility and write private flattened
  working copies under `slicer-presets/`. Preserve system identity for CLI
  compatibility; inherited `printer_settings_id` can be stale. Native profiles
  retain their printer/tool choices and refuse stale assignments before slicing.
  Real Orca 2.4.2 Linux bracket slice verified; other OSs and hardware not tested.

- Time-lapse uses `mock_moonraker.camera_snapshot()` for each real printer.
  One bounded on-demand capture worker per printer keeps camera delays out of
  the live tick. Session identity and module switches are rechecked before save.
  The old manual MJPEG feed is for viewing only. Fleet change listener is wired.

- `tool_setup.py`, `printroom.js`: per-printer preparation records, four-head
  editor and read-only feeder detection. `/api/tools/assignments` is local
  settings under `filament_inventory`; `/api/tools/compatibility` and the
  physical filament write action belong to `printer_control`. Real writes use
  read-back, never FORCE, and never change fitted nozzle readings.

- `VERSION`, `backend/app_updates.py`, `start.py`: opt-in GitHub release checking
  (startup, then daily while running), verified staging and child-process
  rollback. Git/GitHub Desktop copies update by `git fetch` + `merge --ff-only`,
  refused on hand-edited tracked files or local commits, rolled back with
  `git reset --keep`; on Windows it finds GitHub Desktop's own git. v0.8.0 is the
  first release, published by `.github/workflows/release.yml`.
  `docs/releasing.md` is the release checklist. Python is still required.
- `backend/desktop.py`: the launcher opens a browser tab, an Edge/Chrome `--app`
  window or nothing (`/api/app/desktop`, `desktop.json`; shown in `/api/app/info`).
  The launcher opens it once per start, not after an update restart.
- `backend/stock_camera.py`: separate authenticated stock camera monitor per
  real printer. Snapshot GET is module-gated; demo returns a labelled SVG.
  Tries the camera Moonraker lists first (`/server/webcams/list`; the Extended
  Firmware's `/webcam/snapshot.jpg`, printer host only), then Snapmaker's
  `camera.start_monitor` (WebSocket only, integer `req_id`, `{"state":"failed"}` is
  a failure). Real camera unverified; time-lapse uses each printer's camera. Manual
  MJPEG remains a separate global viewing feed; `camera.find_printer_stream()`
  (`POST /api/camera/find`) fills it from the printer's own list.
- Printer sign-in: `discovery.key_from_login()` (`POST /api/printers/login`) uses the
  printer's web-page login once (Moonraker `/access/login` → `/access/api_key`) and
  returns only the API key; never store or log the password. `fleet.normalise_url()`
  turns `192.168.1.50` into `http://192.168.1.50:7125`. Upstream code (u1-moonraker,
  u1-klipper, the Extended Firmware) is GPL-3: match its behaviour, never paste it.
- `remote.py` (Settings → Away from home, `GET /api/remote`, `POST /api/remote/share|stop|link`):
  runs Tailscale's own CLI (`status --json`, `serve status --json`, `serve --bg --yes
  http://127.0.0.1:<port>`, `serve --https=443 off`); never Funnel. Share/stop answer 403
  unless `_this_computer()` (Serve keeps the phone's Host header, so tailnet phones are
  never "this computer"). Tests use a stand-in `tailscale` in `tests/test_remote.py`.
- The notification orb (`guide.css`) is one translucent sphere tinted by `--orb-tint`
  (the owner, 26 October 2026: no centre dot); `data-kind` ok/warn/bad changes the tint.
- Phone layout (≤ 720 px, end of `theme.css`): `.desk-only` cards are hidden on phones
  (desktop app, update commands, recovery, tunnel setup, slicer paths, Stop, phone QR);
  `.phone-only` the reverse. The launch strip and tab intro move into the More sheet
  (`#more-sheet`: search, screens, Camera/tips/help/Install). Keep the first phone
  screen short; give new computer-only cards `desk-only`.
- App wording (the owner, 26 October 2026): the app and product page carry no
  "untested / only simulated / testing pending" notes; demo data stays labelled as
  demo data. README "Current status" and docs keep the full verification record.
- `frontend/launchpad.js`: skippable setup, private browser name, feature search,
  update settings and camera snapshots. Browser-only names never enter requests.
- `sw.js` caches only `offline.html`, never API replies or commands. HTTP LAN
  addresses cannot register it. Public demo info/update controls stay disabled.
- Viewer now has multi-model plate editing and native 3MF save-as, core/vertex
  colours, bounded mesh contact and surface measurements. Complex paint/texture rendering, simultaneous multi-plate editing and AR's edited geometry are still incomplete. Single-plate selection/separation is now verified.
  Real Orca 2.4.2 Linux slices are verified; physical U1 printing is not.
- Detailed remaining work: the private repository's `build-prompts/05-launch-follow-through.md`.

Round-two evidence lives in `docs/native-studio-validation.md` and
`docs/viewer-performance.json`. The software-rendered 200k-triangle test is not
smooth and does not establish real-phone performance. Slice jobs never queue
pre-flight-blocked output; job time/weight come only from engine metadata, with
unknowns preserved. Tool forms reject stale printer selection before any write.


## Unified slicing workspace and recovery

- `slicer-workspace.js` composes the existing plate editor and shared profile/tool
  forms. Mounted plate controls keep instance-specific DOM references after they
  move between panels. Never rebuild mesh buffers just to select another object.
  Edits invalidate preview; stale printer/profile replies cannot accept a new slice.
- `slicing_contract.py`, `slicer_profiles.py`: capable external engines consume
  distinct physical-head heights. Check actual exported schema plus executable
  identity, not version names alone. Only conservative exact grids are accepted.
  Generated colour projects require shared matching heights. First layers,
  bridges and geometry-dependent fallback are explicit exceptions.
- Working process copies also contain fitted nozzle context: some CLI builds
  normalize them before merging machine settings. Legacy standard-flow markers
  migrate to explicit variant fields. No engine source or startup commands are
  copied or modified. Known startup extrusion beyond 270 mm is refused.
- `project_plates.py`: select one plate and preserve original input. Before CLI
  loading, reconcile source preset identity arrays with explicit selected materials;
  keep paint, geometry and per-part metadata. Never feed all plates to the engine
  and assume a zero exit proves correctness.
- Slice jobs are printer-scoped, cancellable process groups and bounded to eight
  active/waiting jobs. Cancellation and automatic queue handoff share a lock.
- Colour calibration can bind to exact process/material settings, backing and
  recipe order; legacy untracked recipes remain labelled. Physical colours still
  need measured owner swatches.
- Full data snapshots have versioned sizes/checksums and omitted credentials.
  Recovery validates before writing and publishes a separate data folder with
  launchers. It never replaces the running data. Disable automatic modules and
  queue advancement in recovery, remap internal paths, reset engine readiness.
- Current evidence: `docs/slicer-workspace-validation.md`,
  `docs/launch-round-three-checklist.md`, `docs/backup-and-recovery.md`.
  Actual mixed-height output and three separated plates passed Linux pre-flight.
  Software-rendered heavy model frame pacing remains poor; disclose regressions.


## Public marketing material

The campaign copy, claim limits, ad guide and the 24 campaign cards moved to the
private repository on 27 October 2026 (see the working rules). What stays here:
the README screenshots, explainer boards and link-preview card
(`tools/readme-images/`), and `check-marketing.js`, which checks the product page
and recorded demo. `img/brand-loop.png` is AI-generated conceptual artwork, not a
physical print or accessory; preserve that distinction in captions. Do not infer
physical readiness, guaranteed update freshness, complete conversion fidelity, or
a competition/detector score from marketing material.
